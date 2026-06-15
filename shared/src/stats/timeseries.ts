import type { CategoryId, Granularity, Transaction } from '../types.js';
import { monthKey, yearKey, enumerateDays } from './dates.js';

export interface Bucket {
  /** คีย์ของช่วงเวลา: 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY' */
  key: string;
  /** รายรับ (inflow ที่ไม่ใช่การโอนระหว่างกระเป๋า) */
  income: number;
  /** รายจ่ายเพื่อการบริโภค (out, ไม่ใช่โอน, ไม่ใช่ออม/ลงทุน) */
  expense: number;
  /** เงินที่กันไปออม/ลงทุน */
  savings: number;
  /** จำนวนรายการ */
  count: number;
}

/** รายการนี้นับเป็น "รายจ่ายเพื่อการบริโภค" หรือไม่ */
export function isConsumption(t: Transaction): boolean {
  return t.direction === 'out' && !t.isTransfer && t.category !== 'savings';
}

/** รายการนี้นับเป็น "รายรับจริง" หรือไม่ */
export function isRealIncome(t: Transaction): boolean {
  return t.direction === 'in' && !t.isTransfer;
}

function keyOf(date: string, gran: Granularity): string {
  if (gran === 'day') return date;
  if (gran === 'month') return monthKey(date);
  return yearKey(date);
}

/**
 * รวมยอดตามช่วงเวลา (day/month/year) — ตัดการโอนระหว่างกระเป๋าออกจากรายรับ/จ่าย
 */
export function aggregate(txns: Transaction[], gran: Granularity): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const t of txns) {
    const key = keyOf(t.date, gran);
    let b = map.get(key);
    if (!b) {
      b = { key, income: 0, expense: 0, savings: 0, count: 0 };
      map.set(key, b);
    }
    b.count++;
    if (t.isTransfer) continue;
    if (t.direction === 'in') b.income += t.amount;
    else if (t.category === 'savings') b.savings += t.amount;
    else b.expense += t.amount;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** netSavings ของ bucket = income - expense (เงินที่ไม่ได้ใช้บริโภค รวมที่กันไปออม) */
export function netSavings(b: Bucket): number {
  return b.income - b.expense;
}

/**
 * Moving average (ค่าเฉลี่ยเคลื่อนที่) — trailing window
 * @param values ชุดข้อมูล
 * @param window ขนาดหน้าต่าง (เช่น 7 วัน)
 */
export function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return [...values];
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i]!;
    if (i >= window) acc -= values[i - window]!;
    const denom = Math.min(i + 1, window);
    out.push(acc / denom);
  }
  return out;
}

/**
 * ยอดรายจ่ายบริโภครายวัน เฉพาะ "วันที่มีการใช้จ่าย" (active days)
 * ใช้วัดความสม่ำเสมอ (CV) — ตอบโจทย์ว่า "เวลาใช้จ่าย ใช้สม่ำเสมอไหม"
 */
export function dailyExpenseActive(txns: Transaction[]): number[] {
  const byDay = new Map<string, number>();
  for (const t of txns) {
    if (!isConsumption(t)) continue;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  }
  return [...byDay.values()];
}

/** จำนวนวันที่มีกิจกรรม (มีรายการอย่างน้อย 1) ในชุดข้อมูล */
export function activeDayCount(txns: Transaction[]): number {
  return new Set(txns.map((t) => t.date)).size;
}

/** ยอดรวมรายจ่ายต่อหมวด (เฉพาะรายจ่ายบริโภค) */
export function expenseByCategory(txns: Transaction[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txns) {
    if (!isConsumption(t)) continue;
    out[t.category] = (out[t.category] ?? 0) + t.amount;
  }
  return out;
}

/** ยอดรายจ่ายบริโภครายวัน เติมวันที่ว่างด้วย 0 (ใช้กับกราฟไทม์ไลน์) */
export interface DailyPoint {
  date: string;
  expense: number;
  income: number;
  ma7?: number;
}
export function dailySeriesFilled(txns: Transaction[]): DailyPoint[] {
  if (txns.length === 0) return [];
  const dates = txns.map((t) => t.date).sort();
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  const exp = new Map<string, number>();
  const inc = new Map<string, number>();
  for (const t of txns) {
    if (isConsumption(t)) exp.set(t.date, (exp.get(t.date) ?? 0) + t.amount);
    if (isRealIncome(t)) inc.set(t.date, (inc.get(t.date) ?? 0) + t.amount);
  }
  const days = enumerateDays(start, end);
  const expense = days.map((d) => exp.get(d) ?? 0);
  const ma = movingAverage(expense, 7);
  return days.map((d, i) => ({
    date: d,
    expense: expense[i]!,
    income: inc.get(d) ?? 0,
    ma7: ma[i],
  }));
}

/** Heatmap หมวด × เดือน (สำหรับการแสดงผลแนวโน้มรายหมวด) */
export function categoryMonthMatrix(txns: Transaction[]): {
  months: string[];
  categories: CategoryId[];
  /** matrix[category][month] = ยอดรวม */
  matrix: Record<string, Record<string, number>>;
} {
  const monthsSet = new Set<string>();
  const catsSet = new Set<CategoryId>();
  const matrix: Record<string, Record<string, number>> = {};
  for (const t of txns) {
    if (!isConsumption(t)) continue;
    const mk = monthKey(t.date);
    monthsSet.add(mk);
    catsSet.add(t.category);
    matrix[t.category] ??= {};
    matrix[t.category]![mk] = (matrix[t.category]![mk] ?? 0) + t.amount;
  }
  return {
    months: [...monthsSet].sort(),
    categories: [...catsSet],
    matrix,
  };
}
