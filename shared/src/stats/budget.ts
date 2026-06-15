import type { CategoryId, Transaction } from '../types.js';
import { CATEGORY_META } from '../categories.js';
import { round } from './descriptive.js';
import { monthKey } from './dates.js';
import { isConsumption } from './timeseries.js';

export interface Budget {
  category: CategoryId;
  /** วงเงินต่อเดือน (บาท) */
  limit: number;
}

export interface BudgetStatus {
  category: CategoryId;
  label: string;
  color: string;
  limit: number;
  spent: number;
  remaining: number;
  /** สัดส่วนที่ใช้ไป 0..1+ */
  ratio: number;
  status: 'ok' | 'warn' | 'over';
}

/**
 * เทียบงบประมาณรายหมวดกับยอดใช้จริงของเดือนที่ระบุ
 * - ratio ≥ 1     → 'over'  (เกินงบ)
 * - ratio ≥ 0.8   → 'warn'  (ใกล้เต็มงบ)
 * - อื่นๆ          → 'ok'
 */
export function budgetStatus(
  txns: Transaction[],
  budgets: Budget[],
  month: string,
): BudgetStatus[] {
  const spent = new Map<string, number>();
  for (const t of txns) {
    if (!isConsumption(t)) continue;
    if (monthKey(t.date) !== month) continue;
    spent.set(t.category, (spent.get(t.category) ?? 0) + t.amount);
  }

  return budgets.map((b) => {
    const used = round(spent.get(b.category) ?? 0);
    const ratio = b.limit > 0 ? used / b.limit : 0;
    const meta = CATEGORY_META[b.category];
    return {
      category: b.category,
      label: meta?.label ?? b.category,
      color: meta?.color ?? '#64748b',
      limit: b.limit,
      spent: used,
      remaining: round(b.limit - used),
      ratio: round(ratio, 3),
      status: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok',
    };
  });
}
