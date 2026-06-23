import { randomUUID } from 'node:crypto';
import type { Source, Transaction, Direction } from '@finflow/shared';
import { classifyByKeyword } from '@finflow/shared';

const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 1, มกราคม: 1, 'ก.พ.': 2, กุมภาพันธ์: 2, 'มี.ค.': 3, มีนาคม: 3,
  'เม.ย.': 4, เมษายน: 4, 'พ.ค.': 5, พฤษภาคม: 5, 'มิ.ย.': 6, มิถุนายน: 6,
  'ก.ค.': 7, กรกฎาคม: 7, 'ส.ค.': 8, สิงหาคม: 8, 'ก.ย.': 9, กันยายน: 9,
  'ต.ค.': 10, ตุลาคม: 10, 'พ.ย.': 11, พฤศจิกายน: 11, 'ธ.ค.': 12, ธันวาคม: 12,
};

/** แปลงปี พ.ศ. → ค.ศ. (ถ้าจำเป็น) */
export function toCE(year: number): number {
  if (year >= 2400) return year - 543; // พ.ศ. เต็ม
  if (year >= 100 && year < 200) return year + 1957; // ปี 2 หลักแบบ พ.ศ. (เช่น 68 -> 2568 -> 2025) จัดการแยกด้านล่าง
  return year;
}

/**
 * แปลงวันที่หลายรูปแบบของ statement ไทย → 'YYYY-MM-DD'
 * รองรับ: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, 'd MMM yy(yy)' (เดือนไทย)
 */
export function parseThaiDate(raw: string): string | null {
  const s = raw.trim();

  // yyyy-mm-dd (ISO)
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  // dd/mm/yyyy หรือ dd-mm-yyyy
  m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2500; // ปี 2 หลัก = พ.ศ. ย่อ (เช่น 68 → 2568) ให้ตรงกับรูปเดือนไทยด้านล่าง
    return iso(toCE(y), mo, d);
  }

  // d MMM yy(yy) เดือนไทย
  m = s.match(/(\d{1,2})\s*([฀-๿.]+)\s*(\d{2,4})/);
  if (m && THAI_MONTHS[m[2]!]) {
    const d = Number(m[1]);
    const mo = THAI_MONTHS[m[2]!]!;
    let y = Number(m[3]);
    if (y < 100) y += 2500; // 68 -> 2568
    return iso(toCE(y), mo, d);
  }

  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** แปลงข้อความจำนวนเงิน '1,234.56' → 1234.56 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

/** เวลา HH:mm จากข้อความ */
export function parseTime(raw: string): string | undefined {
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

const OUT_HINTS = ['ถอน', 'โอนออก', 'ชำระ', 'จ่าย', 'ซื้อ', 'withdraw', 'payment', 'debit', 'transfer out'];
const IN_HINTS = ['ฝาก', 'รับโอน', 'เงินเข้า', 'รับเงิน', 'deposit', 'credit', 'received', 'transfer in', 'เงินเดือน'];

/** เดาทิศทางจากคำใบ้ในข้อความ */
export function guessDirection(text: string, fallback: Direction = 'out'): Direction {
  const t = text.toLowerCase();
  if (IN_HINTS.some((h) => t.includes(h.toLowerCase()))) return 'in';
  if (OUT_HINTS.some((h) => t.includes(h.toLowerCase()))) return 'out';
  return fallback;
}

export function makeTxn(p: {
  date: string;
  amount: number;
  direction: Direction;
  counterparty: string;
  source: Source;
  time?: string;
  balanceAfter?: number;
  rawDesc?: string;
  account?: string;
}): Transaction {
  return {
    id: `${p.source}-${randomUUID().slice(0, 8)}`,
    date: p.date,
    time: p.time,
    amount: p.amount,
    direction: p.direction,
    counterparty: p.counterparty.trim() || (p.direction === 'in' ? 'เงินเข้า' : 'รายการ'),
    source: p.source,
    account: p.account,
    category: classifyByKeyword(p.counterparty || p.rawDesc || '', p.direction),
    rawDesc: p.rawDesc,
    balanceAfter: p.balanceAfter,
  };
}

/**
 * ดึงเลขบัญชีไทยรูปแบบ xxx-x-xxxxx-x (เช่น KBank '160-3-73798-5') จากหัว statement
 * ใช้แยกหลายบัญชีในแบงก์เดียวกัน — ถ้าไม่พบคืน undefined (รายการจะถูกจัดกลุ่มตามชนิดกระเป๋าแทน)
 */
export function extractAccountNo(text: string): string | undefined {
  const m = text.match(/\d{3}-\d-\d{4,6}-\d/);
  return m ? m[0] : undefined;
}

export interface ParserContext {
  sender?: string;
  filename?: string;
}

export interface Parser {
  source: Source;
  label: string;
  matches(text: string, ctx: ParserContext): boolean;
  parse(text: string, ctx: ParserContext): Transaction[];
}
