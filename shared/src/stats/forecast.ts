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
  /** ยอดจริงย้อนหลัง (เฉพาะเดือนที่จบแล้ว) สำหรับเป็นจุดอ้างอิงก่อนคาดการณ์ */
  history: Array<{ label: string; total: number }>;
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
  // ตัดเดือนปัจจุบันที่ยังไม่จบออกจากการเทรน — ข้อมูลไม่เต็มเดือนทำให้ EWMA ดึง forecast ต่ำผิด
  const currentMk = today.slice(0, 7);
  const completeMonths = allMonths.filter((mk) => mk < currentMk);
  const trainMonths = completeMonths.length > 0 ? completeMonths : allMonths;
  const n = trainMonths.length;

  // เดือนจริงล่าสุด (จบแล้ว) ที่จะแสดงเป็นจุดอ้างอิงในกราฟ — 2 เดือนพอเป็น anchor และไม่ให้เดือน outlier ดันสเกล
  const HISTORY = 2;
  const histMonths = trainMonths.slice(-HISTORY);

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
    const V_c = trainMonths.map((mk) => Math.max(0, (monthlyCatSpend.get(mk)?.get(cat) ?? 0) - R_c));
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
    const monthNums = trainMonths.map((mk) => parseInt(mk.split('-')[1]!, 10));
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
      history: histMonths.map((mk) => ({
        label: thaiMonthLabel(mk),
        total: round(monthlyCatSpend.get(mk)?.get(cat) ?? 0),
      })),
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
    backtest: backtestForecast(txns, budgets, today),
    horizon,
    seasonalActive,
  };
}

/**
 * Backtest ด้วย rolling-origin บน total monthly expense
 * folds = min(n−3, 3)
 */
export function backtestForecast(
  txns: Transaction[],
  _budgets: Budget[],
  today = new Date().toISOString().slice(0, 10),
): ForecastData['backtest'] {
  // ใช้เฉพาะเดือนที่จบแล้ว (ตัดเดือนปัจจุบันที่ข้อมูลยังไม่เต็ม)
  const currentMk = today.slice(0, 7);
  const trainTxns = txns.filter((t) => monthKey(t.date) < currentMk);
  const months = aggregate(trainTxns.length > 0 ? trainTxns : txns, 'month');
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
