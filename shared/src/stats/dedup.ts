import type { Transaction } from '../types.js';
import { diffDays } from './dates.js';

/**
 * Levenshtein distance (edit distance) — เขียนเอง ด้วย dynamic programming
 * จำนวนการแก้ไขขั้นต่ำ (เพิ่ม/ลบ/แทนที่อักขระ) เพื่อเปลี่ยน a เป็น b
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // ลบ
        curr[j - 1]! + 1, // เพิ่ม
        prev[j - 1]! + cost, // แทนที่
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** ความคล้ายของสตริง 0..1 = 1 - dist/maxLen (normalized Levenshtein)
 *  บวกคะแนนพิเศษ: ถ้าสตริงสั้นกว่า (≥8 ตัว) เป็น prefix ของสตริงยาวกว่า
 *  → รองรับชื่อที่ถูกตัดทอนใน KBank STM (~20 ตัว) กับชื่อเต็มใน OCR สลิป
 */
export function stringSimilarity(a: string, b: string): number {
  const s1 = normalize(a);
  const s2 = normalize(b);
  if (!s1 && !s2) return 1;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  const base = 1 - levenshtein(s1, s2) / maxLen;
  // ชื่อถูกตัดทอน: สตริงสั้น (≥8 ตัว) เป็น prefix ของสตริงยาว → ถือว่าเหมือนกัน
  const [shorter, longer] = s1.length <= s2.length ? [s1, s2] : [s2, s1];
  if (shorter.length >= 8 && longer.startsWith(shorter)) return Math.max(base, 0.88);
  return base;
}

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    // ตัดชื่อธนาคารนำหน้าที่ slip แสดงชื่อเจ้าของบัญชีล้วนๆ แต่ STM ขึ้นต้นด้วย "SCB นาย..."
    .replace(/^(scb|gsb|kbank|bbl|krungthai|bay|ttb|uob|cimb|lhbank|kkp|tbank)\s+/u, '')
    // ตัดคำนำหน้าชื่อบุคคล: สลิปมักมี "นาย/นางสาว ..." แต่ STM ตัดทิ้ง — ตัดทั้งคู่ให้เทียบชื่อตรงกัน
    // (normalize สมมาตรกับทั้งสองสตริง การตัดเกินจึงไม่ทำให้คู่ที่ควรแมตช์หลุด)
    .replace(/^(นางสาว|นาง|นาย|น\.?ส\.?|ด\.?ช\.?|ด\.?ญ\.?|mr|mrs|ms|miss)\.?\s*/iu, '')
    .replace(/\s+/g, '')
    .replace(/[*x#]+\d+/g, '') // ตัดเลขบัญชีที่ถูกปิดบัง
    .trim();
}

/**
 * Fingerprint แบบหยาบ: รวมจำนวนเงิน + วันที่ ไว้กรองคู่ที่อาจซ้ำเร็วๆ
 */
export function fingerprint(t: Transaction): string {
  return `${t.direction}|${Math.round(t.amount)}|${t.date}`;
}

export interface DedupResult {
  /** รายการหลังกันซ้ำ (เก็บตัวที่ข้อมูลครบกว่า) */
  unique: Transaction[];
  /** คู่ที่ตัดสินว่าซ้ำกัน */
  duplicates: { kept: string; removed: string; similarity: number }[];
}

/**
 * กันรายการซ้ำข้ามแหล่ง ด้วย fuzzy matching
 *  1) กรองหยาบ: จำนวนเงินเท่ากัน (±1 บาท) และวันต่างกันไม่เกิน dayWindow
 *  2) วัดความคล้ายชื่อร้าน/ผู้รับด้วย normalized Levenshtein
 *  3) คล้ายเกิน threshold = รายการเดียวกัน → รวมเหลืออันเดียว
 *
 * ลำดับความสำคัญในการเก็บ: statement (kbank/make/truemoney) > สลิป/manual
 * เพราะ statement เป็นแกนหลักที่เชื่อถือได้
 */
export function deduplicate(
  txns: Transaction[],
  opts: { threshold?: number; dayWindow?: number; amountTol?: number } = {},
): DedupResult {
  const { threshold = 0.8, dayWindow = 1, amountTol = 1 } = opts;
  const sourceRank: Record<string, number> = { kbank: 3, make: 3, truemoney: 3, manual: 2, slip: 1 };

  const kept: Transaction[] = [];
  const duplicates: DedupResult['duplicates'] = [];

  for (const t of txns) {
    let matchedIndex = -1;
    let matchedSim = 0;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i]!;
      if (k.direction !== t.direction) continue;
      if (Math.abs(k.amount - t.amount) > amountTol) continue;
      const sameBucket = k.source === t.source && (k.account ?? '') === (t.account ?? '');
      if (sameBucket) {
        // รายการจากแหล่ง+บัญชีเดียวกัน: ต้องวันที่ตรงกันพอดี (ไม่ขยาย dayWindow)
        // ถ้าทั้งคู่มีเวลาด้วย ต้องตรงกัน — ป้องกัน "45฿ DIGITAL SCHOOL 10:59" กับ "45฿ DIGITAL SCHOOL 11:27"
        // ถูก dedup ทั้งที่เป็นคนละรายการในวันเดียวกัน
        if (k.date !== t.date) continue;
        if (k.time && t.time && k.time !== t.time) continue;
      } else {
        // ข้ามแหล่ง: อนุญาต dayWindow=1 วัน (รองรับ posted date vs value date ต่างกัน 1 วัน)
        if (Math.abs(diffDays(k.date, t.date)) > dayWindow) continue;
      }
      const sim = stringSimilarity(k.counterparty, t.counterparty);
      if (sim >= threshold && sim > matchedSim) {
        matchedIndex = i;
        matchedSim = sim;
      }
    }

    if (matchedIndex >= 0) {
      const existing = kept[matchedIndex]!;
      const existingRank = sourceRank[existing.source] ?? 0;
      const newRank = sourceRank[t.source] ?? 0;
      // เก็บตัวที่ดีกว่า ตามลำดับ: แหล่งน่าเชื่อถือกว่า → มีเลขบัญชี (STM ระบุบัญชีได้) → มียอดคงเหลือ
      // "มีเลขบัญชีชนะไม่มี" สำคัญ: รายการจาก STM (มี account) ต้องแทนรายการจากเนื้อเมล (ไม่มี) ไม่งั้นแยกบัญชีไม่ติด
      const equalRank = newRank === existingRank;
      const takeNew =
        newRank > existingRank ||
        (equalRank && !existing.account && !!t.account) ||
        (equalRank && !!existing.account === !!t.account && !existing.balanceAfter && !!t.balanceAfter);
      if (takeNew) {
        kept[matchedIndex] = t;
        duplicates.push({ kept: t.id, removed: existing.id, similarity: matchedSim });
      } else {
        duplicates.push({ kept: existing.id, removed: t.id, similarity: matchedSim });
      }
    } else {
      kept.push({ ...t, fingerprint: fingerprint(t) });
    }
  }

  return { unique: kept, duplicates };
}
