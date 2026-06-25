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
