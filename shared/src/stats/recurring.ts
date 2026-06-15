import type { Transaction } from '../types.js';
import { mean, stdev, round } from './descriptive.js';
import { diffDays } from './dates.js';

export interface RecurringItem {
  /** ชื่อร้าน/ผู้รับที่จับกลุ่มได้ */
  merchant: string;
  category: string;
  source: string;
  /** จำนวนเงินเฉลี่ยต่อรอบ */
  averageAmount: number;
  /** จำนวนครั้งที่พบ */
  occurrences: number;
  /** ระยะห่างเฉลี่ยระหว่างครั้ง (วัน) */
  avgIntervalDays: number;
  /** ความสม่ำเสมอของรอบ 0..1 (ยิ่งสูงยิ่งเป็นรอบชัด) */
  regularity: number;
  /** วันที่ของรายการล่าสุด */
  lastDate: string;
  ids: string[];
}

/**
 * ตรวจจับรายจ่ายประจำ/ค่าสมาชิก (subscription) ด้วยการวิเคราะห์ความเป็นคาบ:
 *  - จับกลุ่มรายการที่ผู้รับเดียวกัน + จำนวนเงินใกล้กัน
 *  - คำนวณระยะห่างระหว่างครั้ง (intervals) แล้วดูว่าสม่ำเสมอไหม
 *    regularity = 1 − clamp(CV ของ intervals, 0, 1)
 *  - ถือว่าเป็น recurring เมื่อพบ ≥ minOccurrences และ regularity ≥ minRegularity
 */
export function detectRecurring(
  txns: Transaction[],
  opts: { minOccurrences?: number; minRegularity?: number; amountTolRatio?: number } = {},
): RecurringItem[] {
  const { minOccurrences = 3, minRegularity = 0.5, amountTolRatio = 0.15 } = opts;

  // จับกลุ่มตามผู้รับ (normalize) — แล้วแยกย่อยตามระดับจำนวนเงิน
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.direction !== 'out' || t.isTransfer) continue;
    const key = normalizeMerchant(t.counterparty);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const results: RecurringItem[] = [];
  for (const [merchant, list] of groups) {
    if (list.length < minOccurrences) continue;
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));

    // กรองให้จำนวนเงินใกล้เคียงกัน (ค่ามัธยฐาน ± tol)
    const amounts = sorted.map((t) => t.amount);
    const avgAmt = mean(amounts);
    const consistentAmt = sorted.filter((t) => Math.abs(t.amount - avgAmt) <= avgAmt * amountTolRatio);
    if (consistentAmt.length < minOccurrences) continue;

    const intervals: number[] = [];
    for (let i = 1; i < consistentAmt.length; i++) {
      intervals.push(diffDays(consistentAmt[i - 1]!.date, consistentAmt[i]!.date));
    }
    if (intervals.length === 0) continue;
    const avgInterval = mean(intervals);
    if (avgInterval <= 0) continue;
    const cv = avgInterval > 0 ? stdev(intervals, true) / avgInterval : 1;
    const regularity = Math.max(0, 1 - Math.min(cv, 1));
    if (regularity < minRegularity) continue;

    const last = consistentAmt[consistentAmt.length - 1]!;
    results.push({
      merchant: last.alias || last.counterparty,
      category: last.category,
      source: last.source,
      averageAmount: round(mean(consistentAmt.map((t) => t.amount))),
      occurrences: consistentAmt.length,
      avgIntervalDays: round(avgInterval, 1),
      regularity: round(regularity, 2),
      lastDate: last.date,
      ids: consistentAmt.map((t) => t.id),
    });
  }

  return results.sort((a, b) => b.averageAmount * b.occurrences - a.averageAmount * a.occurrences);
}

function normalizeMerchant(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[*x#]+\d+/g, '')
    .trim();
}
