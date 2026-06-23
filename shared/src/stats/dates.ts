/**
 * ตัวช่วยจัดการวันที่แบบ string (เลี่ยงปัญหา timezone ของ Date)
 * รูปแบบมาตรฐานในระบบคือ 'YYYY-MM-DD'
 */

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'YYYY-MM-DD' -> 'YYYY-MM' */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** 'YYYY-MM-DD' -> 'YYYY' */
export function yearKey(date: string): string {
  return date.slice(0, 4);
}

/** ป้ายเดือนภาษาไทย เช่น '2025-03' -> 'มี.ค. 68' (พ.ศ. ย่อ) */
export function thaiMonthLabel(key: string): string {
  const [y, m] = key.split('-');
  const month = THAI_MONTHS[Number(m) - 1] ?? m;
  const be = (Number(y) + 543) % 100;
  return `${month} ${be.toString().padStart(2, '0')}`;
}

/** ป้ายวันที่ไทยแบบสั้น '2025-03-09' -> '9 มี.ค.' */
export function thaiDayLabel(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${THAI_MONTHS[Number(m) - 1] ?? m}`;
}

/** บวกวัน (คืน 'YYYY-MM-DD') */
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ความต่างเป็นจำนวนวัน (b - a) */
export function diffDays(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  return Math.round((db - da) / 86_400_000);
}

/** รายการวันที่ทั้งหมดตั้งแต่ start ถึง end (รวมปลายทั้งสอง) */
export function enumerateDays(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 100_000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

/** วันในสัปดาห์ 0=อาทิตย์..6=เสาร์ */
export function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

/** 'YYYY-MM-DD' → วันแรกของเดือนนั้น 'YYYY-MM-01' */
export function startOfMonth(date: string): string {
  return date.slice(0, 7) + '-01';
}

/** 'YYYY-MM-DD' → วันสุดท้ายของเดือนนั้น (รองรับปีอธิกสุรทิน) */
export function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายเดือนนี้
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** บวก n เดือนให้ 'YYYY-MM-DD' (clamp วันให้อยู่ในเดือนผลลัพธ์ เช่น 31 ม.ค. +1 = 28/29 ก.พ.) */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const base = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const yy = base.getUTCFullYear();
  const mm = base.getUTCMonth(); // 0-based
  const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const dd = Math.min(d!, lastDay);
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
