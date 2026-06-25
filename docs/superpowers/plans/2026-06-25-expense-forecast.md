# Expense Forecast by Category — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มแท็บ "คาดการณ์" ในหน้า Timeline ที่พยากรณ์ค่าใช้จ่ายแต่ละหมวดล่วงหน้า 3 เดือน ด้วย Decomposition model (recurring + damped trend + seasonal) พร้อม prediction interval และ backtest MAPE

**Architecture:** Pure-function engine ใน `shared/src/stats/forecast.ts` รับ `Transaction[]` + `Budget[]` คืน `ForecastData`; server เรียก engine แล้ว expose เป็น `GET /api/analytics/forecast`; client เพิ่มแท็บใน Timeline.tsx โดย fetch แยกต่างหาก

**Tech Stack:** TypeScript (ESM `.js` imports), vitest, Express, React + Recharts ที่มีอยู่แล้ว

## Global Constraints

- ESM imports ต้องใช้ `.js` extension เสมอ (esbuild/tsx resolve `.ts` → `.js`)
- ทุก function ใน `shared/` ต้องเป็น pure function (ไม่อ่าน DB / env)
- ตัวเลขทางการเงินทั้งหมด `round(x, 2)` ก่อน return (ใช้ `round` จาก `descriptive.ts`)
- ข้อความ UI ภาษาไทย
- สูตรทุกข้อเขียนเอง ห้ามใช้ library คณิตศาสตร์ภายนอก
- vitest test ใช้ `describe/it/expect` pattern (ดู `engine.test.ts` เป็นแม่แบบ)
- server analytics functions อยู่ใน `server/src/services/analytics.ts`, routes ใน `server/src/routes/analytics.ts`

---

## File Map

| Action | File | หน้าที่ |
|--------|------|---------|
| Create | `shared/src/stats/forecast.ts` | engine: types + ฟังก์ชันคณิตศาสตร์ทุกตัว |
| Create | `shared/src/stats/forecast.test.ts` | vitest unit tests |
| Modify | `shared/src/stats/index.ts` | re-export จาก `forecast.ts` |
| Modify | `server/src/services/analytics.ts` | เพิ่ม `forecastExpense(txns, budgets)` |
| Modify | `server/src/routes/analytics.ts` | เพิ่ม `GET /forecast` |
| Modify | `client/src/lib/types.ts` | เพิ่ม `ForecastData`, `CategoryForecast`, `CategoryForecastMonth` |
| Modify | `client/src/pages/Timeline.tsx` | เพิ่มแท็บ "คาดการณ์" + 3 cards |

---

## Task 1: Stats Engine (`shared/src/stats/forecast.ts`)

**Files:**
- Create: `shared/src/stats/forecast.ts`
- Create: `shared/src/stats/forecast.test.ts`
- Modify: `shared/src/stats/index.ts` (เพิ่ม 1 บรรทัด)

**Interfaces (ประกาศใน `forecast.ts`):**
```ts
export interface CategoryForecastMonth {
  label: string;       // เช่น 'ก.ค. 68'
  recurring: number;   // R_c (บาท/เดือน)
  variable: number;    // S_c × V̂_c[+k]
  total: number;       // F_c[+k] = recurring + variable
  low: number;         // PI ล่าง (clamp ≥ 0)
  high: number;        // PI บน
  exceedProb: number | null; // null ถ้าไม่มีงบ
}

export interface CategoryForecast {
  category: CategoryId;
  label: string;
  color: string;
  months: CategoryForecastMonth[]; // length = horizon (3)
  budget: number | null;
  hasSeasonal: boolean;
}

export interface ForecastData {
  categories: CategoryForecast[];  // เรียงตาม month[0].total desc
  total: Array<{ label: string; low: number; mid: number; high: number }>;
  backtest: { mape: number; baselineMape: number; skillScore: number; folds: number };
  horizon: number;         // 3
  seasonalActive: boolean; // true ถ้า n ≥ 12 เดือน
}
```

**Interfaces that are consumed:**
- `import type { CategoryId, Transaction } from '../types.js'`
- `import type { Budget } from './budget.js'`
- `import type { RecurringItem } from './recurring.js'`
- `import { CATEGORY_META } from '../categories.js'`
- `import { mean, stdev, round } from './descriptive.js'`
- `import { monthKey, thaiMonthLabel, addMonths, diffDays } from './dates.js'`
- `import { linearRegression } from './regression.js'`
- `import { aggregate, isConsumption } from './timeseries.js'`
- `import { detectRecurring } from './recurring.js'`

- [ ] **Step 1: เขียน failing tests ก่อน implement**

สร้างไฟล์ `shared/src/stats/forecast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Transaction } from '../types.js';
import type { Budget } from './budget.js';
import {
  normalCdf,
  exceedanceProbability,
  ewmaLevel,
  dampedIncrement,
  forecastByCategory,
  backtestForecast,
} from './forecast.js';

// ── helper สร้าง Transaction ──
let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: p.id ?? `t${seq++}`,
    date: p.date ?? '2025-01-01',
    amount: p.amount ?? 100,
    direction: p.direction ?? 'out',
    counterparty: p.counterparty ?? 'ร้านค้า',
    source: p.source ?? 'kbank',
    category: p.category ?? 'food',
    isTransfer: false,
    ...p,
  };
}

// สร้างข้อมูล synthetic 6 เดือน ค่าอาหารสม่ำเสมอ ~3000/เดือน
function makeSixMonths(): Transaction[] {
  const txns: Transaction[] = [];
  for (let m = 1; m <= 6; m++) {
    const monthStr = `2025-0${m}`;
    // อาหาร ~3000/เดือน (10 รายการ ×300)
    for (let d = 1; d <= 10; d++) {
      txns.push(tx({
        date: `${monthStr}-${String(d).padStart(2, '0')}`,
        amount: 300,
        category: 'food',
        counterparty: 'ร้านอาหาร',
      }));
    }
    // ค่าเน็ต recurring 599/เดือน
    txns.push(tx({
      date: `${monthStr}-05`,
      amount: 599,
      category: 'bills',
      counterparty: 'AIS Fiber',
    }));
  }
  return txns;
}

const BUDGETS: Budget[] = [
  { category: 'food', limit: 4000 },
  { category: 'bills', limit: 700 },
];

describe('normalCdf', () => {
  it('cdf(0) ≈ 0.5', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
  });
  it('cdf(1.96) ≈ 0.975', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
  });
  it('cdf(-∞) = 0, cdf(+∞) = 1', () => {
    expect(normalCdf(-10)).toBe(0);
    expect(normalCdf(10)).toBe(1);
  });
});

describe('exceedanceProbability', () => {
  it('P(exceed) ≈ 0.5 เมื่อ budget = forecast (σ > 0)', () => {
    expect(exceedanceProbability(3000, 500, 3000)).toBeCloseTo(0.5, 1);
  });
  it('P(exceed) → 1 เมื่อ budget << forecast', () => {
    expect(exceedanceProbability(3000, 100, 100)).toBeGreaterThan(0.99);
  });
  it('P(exceed) → 0 เมื่อ budget >> forecast', () => {
    expect(exceedanceProbability(1000, 100, 9999)).toBeLessThan(0.01);
  });
  it('σ=0, forecast>budget → 1', () => {
    expect(exceedanceProbability(3000, 0, 2999)).toBe(1);
  });
  it('σ=0, forecast≤budget → 0', () => {
    expect(exceedanceProbability(3000, 0, 3001)).toBe(0);
  });
});

describe('ewmaLevel', () => {
  it('single value → returns it', () => {
    expect(ewmaLevel([500])).toBe(500);
  });
  it('trailing 3 weighted average', () => {
    // weights: 0.5, 1/3, 1/6  → 0.5×6 + (1/3)×5 + (1/6)×4 = 3 + 1.667 + 0.667 = 5.333
    expect(ewmaLevel([4, 5, 6])).toBeCloseTo(5.333, 2);
  });
  it('เมื่อมีมากกว่า 3 ค่า ใช้เฉพาะ 3 ล่าสุด', () => {
    expect(ewmaLevel([100, 200, 4, 5, 6])).toBeCloseTo(5.333, 2);
  });
});

describe('dampedIncrement', () => {
  it('φ=0 → increment=0 ทุก k (flat)', () => {
    expect(dampedIncrement(100, 0, 1)).toBe(0);
    expect(dampedIncrement(100, 0, 3)).toBe(0);
  });
  it('φ=1 → increment = slope×k (undamped)', () => {
    expect(dampedIncrement(10, 1, 3)).toBeCloseTo(30, 5);
  });
  it('φ=0.8 → k=1 ให้ผลน้อยกว่า slope', () => {
    const inc1 = dampedIncrement(100, 0.8, 1);
    expect(inc1).toBeLessThan(100);
    expect(inc1).toBeGreaterThan(0);
  });
  it('increment k=3 > k=2 > k=1 เมื่อ slope>0, φ∈(0,1)', () => {
    const i1 = dampedIncrement(10, 0.8, 1);
    const i2 = dampedIncrement(10, 0.8, 2);
    const i3 = dampedIncrement(10, 0.8, 3);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });
});

describe('forecastByCategory — 6 เดือน synthetic', () => {
  const txns = makeSixMonths();
  const result = forecastByCategory(txns, BUDGETS, 3, '2025-07-01');

  it('มีหมวดใน output', () => {
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it('ทุกหมวดมี 3 เดือน (horizon=3)', () => {
    for (const c of result.categories) {
      expect(c.months).toHaveLength(3);
    }
  });

  it('low ≤ total ≤ high ทุก horizon', () => {
    for (const c of result.categories) {
      for (const m of c.months) {
        expect(m.low).toBeLessThanOrEqual(m.total + 0.01);
        expect(m.total).toBeLessThanOrEqual(m.high + 0.01);
      }
    }
  });

  it('total.low ≤ total.mid ≤ total.high', () => {
    for (const t of result.total) {
      expect(t.low).toBeLessThanOrEqual(t.mid + 0.01);
      expect(t.mid).toBeLessThanOrEqual(t.high + 0.01);
    }
  });

  it('food forecast mid > 0', () => {
    const food = result.categories.find(c => c.category === 'food');
    expect(food).toBeDefined();
    expect(food!.months[0]!.total).toBeGreaterThan(0);
  });

  it('seasonalActive=false เมื่อข้อมูลน้อยกว่า 12 เดือน', () => {
    expect(result.seasonalActive).toBe(false);
  });

  it('exceedProb ∈ [0,1] เมื่อมีงบ', () => {
    const food = result.categories.find(c => c.category === 'food');
    const prob = food!.months[0]!.exceedProb;
    expect(prob).not.toBeNull();
    expect(prob!).toBeGreaterThanOrEqual(0);
    expect(prob!).toBeLessThanOrEqual(1);
  });

  it('exceedProb=null เมื่อไม่มีงบ', () => {
    const others = result.categories.filter(c => c.category !== 'food' && c.category !== 'bills');
    if (others.length > 0) {
      expect(others[0]!.months[0]!.exceedProb).toBeNull();
    }
  });
});

describe('forecastByCategory — ข้อมูลน้อย (2 เดือน)', () => {
  const txns = [
    tx({ date: '2025-01-10', amount: 1000, category: 'food' }),
    tx({ date: '2025-02-10', amount: 1200, category: 'food' }),
  ];

  it('ไม่ crash, low ≤ total ≤ high', () => {
    const result = forecastByCategory(txns, [], 3, '2025-03-01');
    for (const c of result.categories) {
      for (const m of c.months) {
        expect(m.low).toBeLessThanOrEqual(m.total + 0.01);
        expect(m.total).toBeLessThanOrEqual(m.high + 0.01);
      }
    }
  });
});

describe('backtestForecast', () => {
  it('folds ≥ 1 เมื่อข้อมูล ≥ 4 เดือน', () => {
    const result = backtestForecast(makeSixMonths(), BUDGETS);
    expect(result.folds).toBeGreaterThanOrEqual(1);
  });

  it('mape ≥ 0', () => {
    const result = backtestForecast(makeSixMonths(), BUDGETS);
    expect(result.mape).toBeGreaterThanOrEqual(0);
  });

  it('skillScore ≤ 1', () => {
    const result = backtestForecast(makeSixMonths(), BUDGETS);
    expect(result.skillScore).toBeLessThanOrEqual(1);
  });

  it('folds=0 เมื่อข้อมูล < 4 เดือน', () => {
    const tiny = [
      tx({ date: '2025-01-01', amount: 100 }),
      tx({ date: '2025-02-01', amount: 100 }),
    ];
    const result = backtestForecast(tiny, []);
    expect(result.folds).toBe(0);
  });
});
```

- [ ] **Step 2: รัน tests ตรวจว่า fail (ยังไม่มี implementation)**

```bash
cd C:\Users\User\Desktop\FinFlow
npm test -- --reporter=verbose shared/src/stats/forecast.test.ts
```

Expected: `Error: Failed to resolve import "./forecast.js"` หรือ `Cannot find module`

- [ ] **Step 3: implement `shared/src/stats/forecast.ts`**

สร้างไฟล์ใหม่ `shared/src/stats/forecast.ts`:

```ts
import type { CategoryId, Transaction } from '../types.js';
import type { Budget } from './budget.js';
import type { RecurringItem } from './recurring.js';
import { CATEGORY_META } from '../categories.js';
import { mean, stdev, round } from './descriptive.js';
import { monthKey, thaiMonthLabel, addMonths, diffDays } from './dates.js';
import { linearRegression } from './regression.js';
import { aggregate, isConsumption } from './timeseries.js';
import { detectRecurring } from './recurring.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CategoryForecastMonth {
  label: string;
  recurring: number;
  variable: number;
  total: number;
  low: number;
  high: number;
  exceedProb: number | null;
}

export interface CategoryForecast {
  category: CategoryId;
  label: string;
  color: string;
  months: CategoryForecastMonth[];
  budget: number | null;
  hasSeasonal: boolean;
}

export interface ForecastData {
  categories: CategoryForecast[];
  total: Array<{ label: string; low: number; mid: number; high: number }>;
  backtest: { mape: number; baselineMape: number; skillScore: number; folds: number };
  horizon: number;
  seasonalActive: boolean;
}

// ── Math helpers ───────────────────────────────────────────────────────────

/**
 * CDF ของ Normal มาตรฐาน ด้วย rational approximation (Abramowitz & Stegun 26.2.17)
 * ความแม่น |ε| < 7.5×10⁻⁸
 */
export function normalCdf(z: number): number {
  if (z < -6) return 0;
  if (z > 6) return 1;
  const abs = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * abs);
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * abs * abs) / Math.sqrt(2 * Math.PI);
  const p = 1 - pdf * poly;
  return z < 0 ? 1 - p : p;
}

/**
 * โอกาสที่ค่าใช้จ่ายจริงจะเกินงบ L
 * P(X > L) = 1 − Φ((L − μ) / σ)
 */
export function exceedanceProbability(forecast: number, sigma: number, budget: number): number {
  if (sigma <= 0) return forecast > budget ? 1 : 0;
  return 1 - normalCdf((budget - forecast) / sigma);
}

/**
 * EWMA level: ค่าเฉลี่ยถ่วงน้ำหนัก trailing 3 จุดล่าสุด
 * น้ำหนัก: 0.5 (ล่าสุด), 1/3, 1/6
 */
export function ewmaLevel(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0]!;
  if (n === 2) return 0.5 * values[n - 1]! + 0.5 * values[n - 2]!;
  return 0.5 * values[n - 1]! + (1 / 3) * values[n - 2]! + (1 / 6) * values[n - 3]!;
}

/**
 * Damped trend increment สะสม k ก้าว
 * Σ_{i=1}^{k} φ^i × slope = slope × φ × (1 − φᵏ) / (1 − φ)
 * เมื่อ φ=0 → 0, เมื่อ φ=1 → slope×k
 */
export function dampedIncrement(slope: number, phi: number, k: number): number {
  if (phi === 0) return 0;
  if (phi === 1) return slope * k;
  return slope * phi * (1 - Math.pow(phi, k)) / (1 - phi);
}

/**
 * Seasonal indices รายเดือน (1-12) ด้วย ratio-to-moving-average
 * คืน array 12 ตัว (index 0 = มกราคม)
 * normalize ให้ผลรวม = 12
 */
function computeSeasonalIndices(values: number[], monthNums: number[]): number[] {
  const groups: number[][] = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < values.length; i++) {
    const m = (monthNums[i]! - 1) % 12;
    groups[m]!.push(values[i]!);
  }
  const grandMean = mean(values) || 1;
  const raw = groups.map((g) => (g.length > 0 ? mean(g) / grandMean : 1.0));
  const total = raw.reduce((a, b) => a + b, 0) || 12;
  return raw.map((s) => (s * 12) / total);
}

/**
 * คำนวณยอดรายจ่ายประจำต่อเดือนสำหรับหมวด cat
 * R_c = Σ(averageAmount_i × 30.44 / avgIntervalDays_i)
 * กรองเฉพาะ item ที่ active (lastDate ไม่เก่าเกิน 1.5× interval)
 */
function recurringMonthlyForCategory(
  items: RecurringItem[],
  cat: CategoryId,
  today: string,
): number {
  return items
    .filter((item) => item.category === cat)
    .filter((item) => diffDays(item.lastDate, today) <= 1.5 * item.avgIntervalDays)
    .reduce((sum, item) => sum + item.averageAmount * (30.44 / item.avgIntervalDays), 0);
}

// ── Main forecast engine ───────────────────────────────────────────────────

const PHI = 0.8; // damping factor
const Z = 1.28;  // ~80% prediction interval

/**
 * พยากรณ์ค่าใช้จ่ายรายหมวด horizon เดือนข้างหน้า
 * @param txns รายการธุรกรรมทั้งหมด
 * @param budgets งบประมาณรายหมวด (ถ้ามี)
 * @param horizon จำนวนเดือนที่พยากรณ์ (default 3)
 * @param today วันที่ปัจจุบัน 'YYYY-MM-DD' (default today)
 */
export function forecastByCategory(
  txns: Transaction[],
  budgets: Budget[],
  horizon = 3,
  today = new Date().toISOString().slice(0, 10),
): ForecastData {
  // 1. รวมรายจ่ายต่อหมวดต่อเดือน
  const monthlyCatSpend = new Map<string, Map<CategoryId, number>>();
  for (const t of txns) {
    if (!isConsumption(t)) continue;
    const mk = monthKey(t.date);
    if (!monthlyCatSpend.has(mk)) monthlyCatSpend.set(mk, new Map());
    const catMap = monthlyCatSpend.get(mk)!;
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + t.amount);
  }
  const allMonths = [...monthlyCatSpend.keys()].sort();
  const n = allMonths.length;

  // 2. recurring items + budget map
  const recurringItems = detectRecurring(txns);
  const budgetMap = new Map(budgets.map((b) => [b.category, b.limit]));

  // 3. หมวดทั้งหมดที่มีข้อมูล
  const allCats = new Set<CategoryId>();
  for (const catMap of monthlyCatSpend.values()) {
    for (const cat of catMap.keys()) allCats.add(cat);
  }

  const seasonalActive = n >= 12;

  // helper: เดือนเป้าหมายสำหรับ horizon k
  const targetMk = (k: number): string => addMonths(today, k).slice(0, 7);
  const targetMonthNum = (k: number): number => parseInt(targetMk(k).split('-')[1]!, 10);

  // 4. forecast ต่อหมวด
  const catResults: CategoryForecast[] = [];
  const catSigmas: number[] = [];

  for (const cat of allCats) {
    const R_c = recurringMonthlyForCategory(recurringItems, cat, today);
    const V_c = allMonths.map((mk) => Math.max(0, (monthlyCatSpend.get(mk)?.get(cat) ?? 0) - R_c));
    const nc = V_c.length;

    // EWMA level + regression
    const level = ewmaLevel(V_c);
    const xs = V_c.map((_, i) => i);
    const fit = linearRegression(xs, V_c);
    const useFlat = nc < 3 || Math.abs(fit.slope) < 0.01 * Math.max(level, 1);

    // residuals (in-sample) → σ_c
    const fitted = xs.map((x) => Math.max(0, fit.intercept + fit.slope * x));
    const residuals = V_c.map((v, i) => v - fitted[i]!);
    const sigma_c = nc >= 2 ? stdev(residuals) : Math.max(level * 0.3, 1);

    // ตัวแปรสำหรับ PI formula
    const xBar = nc > 0 ? (nc - 1) / 2 : 0;
    const Sxx = xs.reduce((acc, x) => acc + (x - xBar) ** 2, 0) || 1;

    // seasonal indices (เปิดถ้า ≥ 12 เดือน)
    const monthNums = allMonths.map((mk) => parseInt(mk.split('-')[1]!, 10));
    const sIndices = seasonalActive ? computeSeasonalIndices(V_c, monthNums) : null;

    // forecast k = 1..horizon
    const months: CategoryForecastMonth[] = [];
    for (let k = 1; k <= horizon; k++) {
      const rawForecast = useFlat
        ? level
        : Math.max(0, level + dampedIncrement(fit.slope, PHI, k));

      const S = sIndices ? (sIndices[targetMonthNum(k) - 1] ?? 1.0) : 1.0;
      const F_c = R_c + S * rawForecast;

      const x0 = nc + k - 1;
      const halfWidth = Z * sigma_c * Math.sqrt(1 + 1 / Math.max(nc, 1) + (x0 - xBar) ** 2 / Sxx);
      const low = Math.max(0, F_c - halfWidth);
      const high = F_c + halfWidth;

      const budgetLimit = budgetMap.get(cat) ?? null;
      const exceedProb =
        budgetLimit != null ? round(exceedanceProbability(F_c, sigma_c, budgetLimit), 3) : null;

      months.push({
        label: thaiMonthLabel(targetMk(k)),
        recurring: round(R_c),
        variable: round(S * rawForecast),
        total: round(F_c),
        low: round(low),
        high: round(high),
        exceedProb,
      });
    }

    catSigmas.push(sigma_c);
    const meta = CATEGORY_META[cat];
    catResults.push({
      category: cat,
      label: meta?.label ?? cat,
      color: meta?.color ?? '#64748b',
      months,
      budget: budgetMap.get(cat) ?? null,
      hasSeasonal: seasonalActive,
    });
  }

  // เรียงตาม total month[0] desc
  catResults.sort((a, b) => (b.months[0]?.total ?? 0) - (a.months[0]?.total ?? 0));

  // 5. ยอดรวม (σ_total = √(Σ σ_c²), สมมติหมวดอิสระต่อกัน)
  const sigma_total = Math.sqrt(catSigmas.reduce((sum, s) => sum + s * s, 0));
  const total = Array.from({ length: horizon }, (_, ki) => {
    const k = ki + 1;
    const mid = round(catResults.reduce((sum, c) => sum + (c.months[ki]?.total ?? 0), 0));
    const halfWidth = Z * sigma_total * Math.sqrt(1 + 1 / Math.max(n, 1));
    return {
      label: thaiMonthLabel(targetMk(k)),
      low: round(Math.max(0, mid - halfWidth)),
      mid,
      high: round(mid + halfWidth),
    };
  });

  return {
    categories: catResults,
    total,
    backtest: backtestForecast(txns, budgets),
    horizon,
    seasonalActive,
  };
}

/**
 * Backtest ด้วย rolling-origin บน total monthly expense
 * folds = min(n−3, 3)
 */
export function backtestForecast(txns: Transaction[], _budgets: Budget[]): ForecastData['backtest'] {
  const months = aggregate(txns, 'month');
  const n = months.length;
  const folds = Math.min(n - 3, 3);
  if (folds < 1) return { mape: 0, baselineMape: 0, skillScore: 0, folds: 0 };

  const modelErrors: number[] = [];
  const baselineErrors: number[] = [];

  for (let f = 0; f < folds; f++) {
    const trainSize = n - folds + f;
    const actual = months[trainSize]!.expense;
    if (actual === 0) continue;

    const trainExpenses = months.slice(0, trainSize).map((b) => b.expense);
    const xs = trainExpenses.map((_, i) => i);
    const fit = linearRegression(xs, trainExpenses);
    const level = ewmaLevel(trainExpenses);
    const predicted = Math.max(0, level + dampedIncrement(fit.slope, PHI, 1));

    const baselineWindow = trainExpenses.slice(-3);
    const baseline = mean(baselineWindow.length > 0 ? baselineWindow : trainExpenses);

    modelErrors.push(Math.abs(actual - predicted) / actual);
    baselineErrors.push(Math.abs(actual - baseline) / actual);
  }

  if (modelErrors.length === 0) return { mape: 0, baselineMape: 0, skillScore: 0, folds: 0 };

  const mape = round(mean(modelErrors), 4);
  const baselineMape = round(mean(baselineErrors), 4);
  const skillScore = round(1 - mape / Math.max(baselineMape, 0.0001), 4);

  return { mape, baselineMape, skillScore, folds: modelErrors.length };
}
```

- [ ] **Step 4: เพิ่ม re-export ใน `shared/src/stats/index.ts`**

เพิ่มบรรทัดนี้ต่อท้ายไฟล์ (หลัง `export * from './merchantRules.js'`):

```ts
export * from './forecast.js';
```

- [ ] **Step 5: รัน tests ตรวจว่า pass**

```bash
npm test -- --reporter=verbose shared/src/stats/forecast.test.ts
```

Expected: ทุก test ผ่าน (ประมาณ 20+ tests)

- [ ] **Step 6: Commit**

```bash
git add shared/src/stats/forecast.ts shared/src/stats/forecast.test.ts shared/src/stats/index.ts
git commit -m "feat(stats): expense forecast engine — decomposition, damped trend, PI, backtest"
```

---

## Task 2: Server Endpoint

**Files:**
- Modify: `server/src/services/analytics.ts`
- Modify: `server/src/routes/analytics.ts`

**Interfaces consumed from Task 1:**
- `forecastByCategory(txns: Transaction[], budgets: Budget[], horizon?: number, today?: string): ForecastData`
- `ForecastData` (exported from `@finflow/shared`)

**Interfaces produced (for Task 3):**
- `GET /api/analytics/forecast` → JSON ของ `ForecastData`

- [ ] **Step 1: เพิ่ม `forecastExpense` function ใน `server/src/services/analytics.ts`**

เพิ่มที่ด้านบน import ของไฟล์ (เพิ่มใน import จาก `@finflow/shared`):

```ts
import {
  // ... imports เดิม ...
  forecastByCategory,   // เพิ่มบรรทัดนี้
} from '@finflow/shared';
```

และเพิ่ม import `getBudgets` จาก db (มีอยู่แล้วใน `../db.js` แต่ยังไม่ได้ import ใน analytics.ts):

```ts
import { getAccounts, getScoreProfile, getBudgets } from '../db.js';
```

จากนั้นเพิ่ม function ใหม่ต่อท้ายไฟล์ (หลัง `export function dailyExpense`):

```ts
/** พยากรณ์ค่าใช้จ่ายรายหมวด 3 เดือนข้างหน้า */
export function forecastExpense(txns: Transaction[]) {
  const budgets = getBudgets();
  return forecastByCategory(txns, budgets);
}
```

- [ ] **Step 2: เพิ่ม route ใน `server/src/routes/analytics.ts`**

เพิ่ม import `forecastExpense`:

```ts
import { overview, timeline, categories, anomalies, forecastExpense } from '../services/analytics.js';
```

เพิ่ม route ต่อท้ายไฟล์ (หลัง `/advice`):

```ts
/** GET /api/analytics/forecast — พยากรณ์ค่าใช้จ่ายรายหมวด 3 เดือนข้างหน้า */
analyticsRouter.get('/forecast', (req, res) => {
  const txns = loadTransactions(req);
  res.json(forecastExpense(txns));
});
```

- [ ] **Step 3: ทดสอบ endpoint ด้วย curl (เปิด server ก่อน)**

```bash
npm run dev
```

แล้วในอีก terminal:

```bash
curl -s http://localhost:4000/api/analytics/forecast | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const r=JSON.parse(d);console.log('categories:',r.categories.length,'horizon:',r.horizon,'folds:',r.backtest.folds)"
```

Expected output: `categories: N horizon: 3 folds: M` (N>0, M>=1)

- [ ] **Step 4: Commit**

```bash
git add server/src/services/analytics.ts server/src/routes/analytics.ts
git commit -m "feat(server): GET /api/analytics/forecast endpoint"
```

---

## Task 3: Client — Types + UI

**Files:**
- Modify: `client/src/lib/types.ts`
- Modify: `client/src/pages/Timeline.tsx`

**Interfaces consumed from Task 1:**
- `ForecastData`, `CategoryForecast`, `CategoryForecastMonth` (imported จาก `@finflow/shared`)

- [ ] **Step 1: เพิ่ม types ใน `client/src/lib/types.ts`**

เพิ่มใน import บรรทัดแรก (ใน `import type { ... } from '@finflow/shared'`):

```ts
import type {
  // ... imports เดิม ...
  ForecastData,
  CategoryForecast,
  CategoryForecastMonth,
} from '@finflow/shared';

export type { ..., ForecastData, CategoryForecast, CategoryForecastMonth };
```

- [ ] **Step 2: แก้ `client/src/pages/Timeline.tsx` — เพิ่มแท็บ "คาดการณ์"**

แทนที่ทั้งไฟล์ด้วยเนื้อหาต่อไปนี้:

```tsx
import { useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApi } from '../lib/api';
import type { TimelineData, ForecastData } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb, compact } from '../lib/format';

type View = 'day' | 'month' | 'year' | 'forecast';

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

// ── Forecast sub-components ────────────────────────────────────────────────

function FlagBadge({ prob }: { prob: number }) {
  const pct = Math.round(prob * 100);
  const color = prob >= 0.7 ? 'var(--red, #ef4444)' : 'var(--orange, #f97316)';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color,
      background: `${color}18`, borderRadius: 6,
      padding: '2px 6px', marginLeft: 6,
    }}>
      {pct}% เกินงบ
    </span>
  );
}

function CategoryCard({
  cat,
  horizonIdx,
}: {
  cat: import('../lib/types').CategoryForecast;
  horizonIdx: number;
}) {
  const m = cat.months[horizonIdx]!;
  const meta = { color: cat.color };
  const barPct = cat.budget ? Math.min(100, (m.total / cat.budget) * 100) : null;
  const recurringPct = m.total > 0 ? (m.recurring / m.total) * 100 : 0;

  return (
    <div style={{
      padding: '12px 16px',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.label}</span>
        {m.exceedProb != null && m.exceedProb >= 0.4 && (
          <FlagBadge prob={m.exceedProb} />
        )}
      </div>

      {/* Stacked bar: recurring (solid) + variable (lighter) */}
      <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', display: 'flex' }}>
          <div style={{
            width: `${recurringPct}%`,
            background: meta.color,
            borderRadius: '4px 0 0 4px',
            transition: 'width 0.3s',
          }} />
          <div style={{
            width: `${100 - recurringPct}%`,
            background: `${meta.color}55`,
            borderRadius: '0 4px 4px 0',
          }} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{thb(m.total)}</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
            {thb(m.low)} – {thb(m.high)}
          </span>
        </div>
        {cat.budget && (
          <span className="muted" style={{ fontSize: 11 }}>งบ {thb(cat.budget)}</span>
        )}
      </div>

      {/* bar vs budget */}
      {barPct != null && (
        <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${barPct}%`,
            background: barPct >= 100 ? '#ef4444' : barPct >= 80 ? '#f97316' : '#16a34a',
            transition: 'width 0.3s',
          }} />
        </div>
      )}

      <div className="muted" style={{ fontSize: 11 }}>
        ประจำ {thb(m.recurring)} · ผันแปร {thb(m.variable)}
      </div>
    </div>
  );
}

function ForecastView({ data }: { data: ForecastData }) {
  const [hi, setHi] = useState(0); // horizon index 0/1/2

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Card 1: รายหมวด */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0 }}>คาดการณ์รายจ่ายรายหมวด</h3>
            <div className="sub">
              Decomposition: บิลประจำ + Damped trend (φ=0.8)
              {data.seasonalActive && ' + seasonal index'}
              {' · '}<span style={{ fontStyle: 'italic' }}>80% PI</span>
            </div>
          </div>
          <div className="spacer" />
          <div className="seg">
            {data.categories[0]?.months.map((m, i) => (
              <button key={i} className={hi === i ? 'active' : ''} onClick={() => setHi(i)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}>
          {data.categories.map((cat) => (
            <CategoryCard key={cat.category} cat={cat} horizonIdx={hi} />
          ))}
        </div>
      </div>

      {/* Card 2: ยอดรวม 3 เดือน */}
      <div className="card">
        <h3>ยอดรวมทุกหมวด — 3 เดือนข้างหน้า</h3>
        <div className="sub">
          σ_total = √(Σ σ_c²) สมมติหมวดอิสระต่อกัน · ช่วงความเชื่อมั่น 80%
        </div>
        <div className="row wrap" style={{ gap: 24, marginTop: 12 }}>
          {data.total.map((t, i) => (
            <div key={i} style={{
              flex: 1, minWidth: 160,
              padding: '16px',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}>
              <div className="muted" style={{ fontSize: 12 }}>{t.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, margin: '4px 0' }}>{thb(t.mid)}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                ต่ำสุด {thb(t.low)} · สูงสุด {thb(t.high)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Card 3: Backtest */}
      <div className="card">
        <h3>ความแม่นของโมเดล (Backtest)</h3>
        <div className="sub">
          Rolling-origin {data.backtest.folds} fold — เปรียบเทียบกับ baseline (เฉลี่ย 3 เดือนล่าสุด)
        </div>
        <div className="row wrap" style={{ gap: 24, marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>MAPE โมเดล</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {data.backtest.folds > 0 ? `${(data.backtest.mape * 100).toFixed(1)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>MAPE baseline</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {data.backtest.folds > 0 ? `${(data.backtest.baselineMape * 100).toFixed(1)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Skill Score</div>
            <div style={{
              fontSize: 22, fontWeight: 700,
              color: data.backtest.skillScore > 0 ? 'var(--green, #16a34a)' : 'var(--red, #ef4444)',
            }}>
              {data.backtest.folds > 0 ? `${(data.backtest.skillScore * 100).toFixed(1)}%` : '—'}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {data.backtest.skillScore > 0 ? 'แม่นกว่า naive' : 'ไม่ดีกว่า naive'}
            </div>
          </div>
        </div>

        {/* Accordion: วิธีคิด */}
        <details style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            วิธีคิดสูตร (สำหรับกรรมการ)
          </summary>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['Decomposition', 'F_c[+k] = R_c + S_c[m] · V̂_c[+k]'],
              ['บิลประจำ', 'R_c = Σ avgAmt_i × 30.44 / interval_i  (active items)'],
              ['Damped trend', 'V̂_c[+k] = level + slope × φ(1−φᵏ)/(1−φ),  φ=0.8'],
              ['Level (EWMA)', 'level = 0.5·v[n−1] + ⅓·v[n−2] + ⅙·v[n−3]'],
              ['Prediction Interval', 'F_c ± 1.28·σ_c·√(1+1/n+(x₀−x̄)²/Sxx)  [80% CI]'],
              ['รวมทุกหมวด', 'σ_total = √(Σ σ_c²)  [สมมติ independent]'],
              ['โอกาสเกินงบ', 'P = 1 − Φ((L_c − F_c) / σ_c)'],
              ['Skill Score', 'S = 1 − MAPE_model / MAPE_baseline'],
            ].map(([name, formula]) => (
              <div key={name} style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, minWidth: 130, display: 'inline-block' }}>{name}:</span>
                <code style={{
                  background: 'var(--surface-2, var(--border))',
                  padding: '1px 6px', borderRadius: 4, fontSize: 11,
                }}>{formula}</code>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Timeline() {
  const [view, setView] = useState<View>('month');
  const state = useApi<TimelineData>('/analytics/timeline');
  const forecastState = useApi<ForecastData>(view === 'forecast' ? '/analytics/forecast' : null);

  return (
    <>
      <PageHead
        title="ไทม์ไลน์หลายระดับ"
        desc="รายวัน (MA 7 วัน) · รายเดือน · รายปี · คาดการณ์ 3 เดือน (Decomposition + Damped Trend)"
        action={
          <div className="seg">
            {(['day', 'month', 'year', 'forecast'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v === 'day' ? 'รายวัน' : v === 'month' ? 'รายเดือน' : v === 'year' ? 'รายปี' : 'คาดการณ์'}
              </button>
            ))}
          </div>
        }
      />

      {view !== 'forecast' && (
        <Async state={state} height={380}>
          {(t) => (
            <>
              {view === 'day' && (
                <div className="card">
                  <h3>รายจ่ายรายวัน + เส้นค่าเฉลี่ยเคลื่อนที่ 7 วัน</h3>
                  <div className="sub">moving average ช่วยให้เห็นแนวโน้มท่ามกลางความผันผวนรายวัน</div>
                  <ResponsiveContainer width="100%" height={360}>
                    <ComposedChart data={t.daily} margin={{ left: -8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} interval={Math.ceil(t.daily.length / 12)} />
                      <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => thb(v)} contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="expense" name="รายจ่าย" fill="#f9731680" radius={[3, 3, 0, 0]} />
                      <Line dataKey="ma7" name="เฉลี่ย 7 วัน" stroke="#0f766e" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {view === 'month' && (
                <div className="card">
                  <h3>รายรับ–รายจ่าย–ออม รายเดือน</h3>
                  <div className="sub">เทียบแต่ละเดือน พร้อมเส้นเงินออมสุทธิ</div>
                  <ResponsiveContainer width="100%" height={360}>
                    <ComposedChart data={t.monthly} margin={{ left: -8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <Tooltip formatter={(v: number) => thb(v)} contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="income" name="รายรับ" fill="#16a34a" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" name="รายจ่าย" fill="#f97316" radius={[4, 4, 0, 0]} />
                      <Line dataKey="net" name="ออมสุทธิ" stroke="#0ea5e9" strokeWidth={2.5} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {view === 'year' && (
                <div className="grid" style={{ gap: 18 }}>
                  <div className="card">
                    <h3>แนวโน้มเงินออมสุทธิรายเดือน</h3>
                    <div className="sub">พื้นที่ใต้กราฟ = เงินออมสะสมแต่ละเดือน</div>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={t.monthly} margin={{ left: -8, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                        <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                        <Tooltip formatter={(v: number) => thb(v)} contentStyle={tooltipStyle} />
                        <Area dataKey="net" name="ออมสุทธิ" stroke="#0f766e" fill="#0f766e30" strokeWidth={2.5} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card">
                    <h3>พยากรณ์ด้วย Linear Regression</h3>
                    <div className="sub">least-squares บนเงินออมสุทธิรายเดือน เพื่อคาดการณ์ 3 เดือนข้างหน้า</div>
                    <div className="row wrap" style={{ gap: 24 }}>
                      {t.forecast.netSavings.map((v, i) => (
                        <div key={i}>
                          <div className="muted" style={{ fontSize: 12 }}>+{i + 1} เดือน</div>
                          <div style={{ fontSize: 22, fontWeight: 700 }} className={v >= 0 ? 'down' : 'up'}>
                            {thb(v)}
                          </div>
                        </div>
                      ))}
                      <div className="spacer" />
                      <div>
                        <div className="muted" style={{ fontSize: 12 }}>ความชัน (slope)</div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{thb(t.forecast.slope)}/เดือน</div>
                        <div className="muted" style={{ fontSize: 12 }}>R² = {t.forecast.r2}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </Async>
      )}

      {view === 'forecast' && (
        <Async state={forecastState} height={400}>
          {(data) => <ForecastView data={data} />}
        </Async>
      )}
    </>
  );
}
```

- [ ] **Step 3: ตรวจ TypeScript compile**

```bash
cd client && npx tsc --noEmit
```

Expected: ไม่มี error

- [ ] **Step 4: ทดสอบในเบราว์เซอร์**

เปิด `http://localhost:5173` → ไปที่ Timeline → คลิก "คาดการณ์"

ตรวจสอบ:
- [ ] การ์ดรายหมวดแสดง (ต้องมีอย่างน้อย 2-3 หมวด)
- [ ] selector +1/+2/+3 เดือน switch ได้
- [ ] card 2 ยอดรวม 3 คอลัมน์แสดง low/mid/high
- [ ] card 3 แสดง MAPE + skill score
- [ ] accordion "วิธีคิดสูตร" เปิด/ปิดได้
- [ ] `low ≤ mid ≤ high` ในทุกตัวเลข (ตรวจด้วยตา)
- [ ] `seasonalActive = false` (เดโม 6 เดือน)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/types.ts client/src/pages/Timeline.tsx
git commit -m "feat(ui): คาดการณ์ tab in Timeline — category forecast cards, PI, backtest"
```

---

## Self-Review Checklist

ตรวจ spec ครอบคลุมทุกข้อ:

| Spec requirement | Task ที่ implement |
|---|---|
| แยกบิลประจำ (R_c) | Task 1: `recurringMonthlyForCategory` |
| Damped trend (φ=0.8) | Task 1: `dampedIncrement` |
| EWMA level | Task 1: `ewmaLevel` |
| Seasonal index (≥12 เดือน) | Task 1: `computeSeasonalIndices`, `seasonalActive` flag |
| Prediction interval (z=1.28) | Task 1: ใน `forecastByCategory` loop |
| σ_total = √(Σ σ_c²) | Task 1: ใน total block |
| โอกาสเกินงบ Φ | Task 1: `normalCdf` + `exceedanceProbability` |
| Backtest MAPE + skill score | Task 1: `backtestForecast` |
| GET /api/analytics/forecast | Task 2 |
| แท็บ "คาดการณ์" ใน Timeline | Task 3 |
| card 1: รายหมวด + PI + เตือนงบ | Task 3: `CategoryCard` |
| card 2: ยอดรวม 3 เดือน | Task 3: total section |
| card 3: backtest + accordion วิธีคิด | Task 3: ForecastView |
| ทำงานกับเดโม 6 เดือน | seasonalActive=false, naive fallback เมื่อ nc<3 |
