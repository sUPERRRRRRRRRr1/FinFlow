import type { CategoryId, Transaction } from '../types.js';
import { CATEGORY_META } from '../categories.js';
import { mean, round, stdev } from './descriptive.js';
import { linearRegression } from './regression.js';
import { monthKey } from './dates.js';
import { isConsumption } from './timeseries.js';

export interface CategoryTrend {
  category: CategoryId;
  label: string;
  color: string;
  /** ยอดเดือนล่าสุด */
  current: number;
  /** ยอดเดือนก่อนหน้า */
  previous: number;
  /** % เปลี่ยนแปลงเทียบเดือนก่อน */
  pctChange: number;
  /** z-score เทียบ baseline ของตัวเอง (เดือนก่อนๆ) — z>2 = พุ่งผิดปกติจริง */
  baselineZ: number;
  /** ความชันของเทรนด์ระยะยาว (บาท/เดือน) */
  slope: number;
  /** ทิศทาง */
  direction: 'up' | 'down' | 'flat';
  /** ค่ารายเดือนทั้งชุด (เก่า→ใหม่) สำหรับ sparkline */
  series: number[];
}

/**
 * ติดตามแนวโน้มรายหมวด:
 *  - % เปลี่ยนแปลง = (ช่วงนี้ − ช่วงก่อน) / ช่วงก่อน × 100
 *  - baseline z-score = (ค่าล่าสุด − μ ย้อนหลัง) / σ ย้อนหลัง
 *  - slope = regression ของยอดรายเดือน
 */
export function categoryTrends(txns: Transaction[]): CategoryTrend[] {
  // months ทั้งหมดที่มีข้อมูล (เรียงเก่า→ใหม่)
  const monthSet = new Set<string>();
  for (const t of txns) if (isConsumption(t)) monthSet.add(monthKey(t.date));
  const months = [...monthSet].sort();
  if (months.length === 0) return [];

  // ยอดรายเดือนต่อหมวด
  const byCat = new Map<CategoryId, Map<string, number>>();
  for (const t of txns) {
    if (!isConsumption(t)) continue;
    const mk = monthKey(t.date);
    if (!byCat.has(t.category)) byCat.set(t.category, new Map());
    const m = byCat.get(t.category)!;
    m.set(mk, (m.get(mk) ?? 0) + t.amount);
  }

  const trends: CategoryTrend[] = [];
  for (const [cat, m] of byCat) {
    const series = months.map((mk) => round(m.get(mk) ?? 0));
    const current = series[series.length - 1]!;
    const previous = series.length >= 2 ? series[series.length - 2]! : 0;
    const pctChange = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;

    // baseline = เดือนก่อนหน้าทั้งหมด (ไม่รวมเดือนล่าสุด)
    const baseline = series.slice(0, -1);
    const mu = mean(baseline);
    const sd = stdev(baseline, true);
    const baselineZ = sd > 0 ? (current - mu) / sd : 0;

    const fit = linearRegression(
      series.map((_, i) => i),
      series,
    );
    const meta = CATEGORY_META[cat];
    const direction: CategoryTrend['direction'] =
      Math.abs(pctChange) < 5 ? 'flat' : pctChange > 0 ? 'up' : 'down';

    trends.push({
      category: cat,
      label: meta?.label ?? cat,
      color: meta?.color ?? '#64748b',
      current,
      previous,
      pctChange: round(pctChange, 1),
      baselineZ: round(baselineZ, 2),
      slope: round(fit.slope),
      direction,
      series,
    });
  }

  // เรียงตามขนาดยอดล่าสุดมาก→น้อย
  return trends.sort((a, b) => b.current - a.current);
}
