import type { CategoryId, Transaction } from '@finflow/shared';
import {
  ALL_CATEGORIES,
  CATEGORY_META,
  isConsumption,
  monthKey,
  round,
  thaiMonthLabel,
} from '@finflow/shared';
import { toSafeTransaction, type SafeTransaction } from '../sanitize.js';

const THAI_MONTH_NAMES: Record<string, number> = {
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
};

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

/** ดึงรายชื่อเดือนที่มีข้อมูล เรียงเก่า→ใหม่ */
function monthsOf(txns: Transaction[]): string[] {
  return [...new Set(txns.map((t) => monthKey(t.date)))].sort();
}

/** ระบุหมวดที่ผู้ใช้พูดถึง (จากชื่อไทยของหมวด) */
function detectCategory(q: string): CategoryId | null {
  for (const c of ALL_CATEGORIES) {
    const head = CATEGORY_META[c].label.split(/[/]/)[0]!;
    if (q.includes(head)) return c;
  }
  if (/กิน|ข้าว|กาแฟ|อาหาร/.test(q)) return 'food';
  if (/เดินทาง|รถ|น้ำมัน|แท็กซี่|grab/i.test(q)) return 'transport';
  if (/ช้อป|ซื้อของ|เสื้อผ้า/.test(q)) return 'shopping';
  if (/บิล|ค่าไฟ|ค่าน้ำ|ค่าเช่า/.test(q)) return 'bills';
  return null;
}

/** ระบุเดือนที่ผู้ใช้พูดถึง คืน month key หรือ null */
function detectMonth(q: string, txns: Transaction[]): string | null {
  const months = monthsOf(txns);
  if (months.length === 0) return null;
  if (/เดือนนี้|เดือนล่าสุด|ปัจจุบัน/.test(q)) return months[months.length - 1]!;
  if (/เดือนที่แล้ว|เดือนก่อน/.test(q)) return months[months.length - 2] ?? months[months.length - 1]!;
  for (const [name, num] of Object.entries(THAI_MONTH_NAMES)) {
    if (q.includes(name) || q.includes(name.slice(0, 3))) {
      return months.find((m) => Number(m.split('-')[1]) === num) ?? null;
    }
  }
  return null;
}

export interface ChatFocus {
  /** ข้อความโฟกัส 1 บรรทัด (อาจว่าง) ช่วยชี้เป้าให้ LLM */
  focus: string;
  /** ตัวอย่างรายการที่เกี่ยวข้อง (sanitize แล้ว) */
  sample: SafeTransaction[];
}

/**
 * โฟกัสคำถาม: เลือกตัวอย่างรายการให้ตรงคำถาม + สร้างบรรทัดโฟกัส
 * ตัวเลขสรุปทั้งหมดย้ายไปอยู่ใน buildSnapshot แล้ว — ฟังก์ชันนี้ไม่คำนวณ facts อีก
 */
export function buildChatContext(question: string, txns: Transaction[]): ChatFocus {
  const category = detectCategory(question);
  const month = detectMonth(question, txns);
  const parts: string[] = [];

  let scope = txns;
  if (month) {
    scope = scope.filter((t) => monthKey(t.date) === month);
    parts.push(`เดือน ${thaiMonthLabel(month)}`);
  }

  let relevant = scope;
  if (category) {
    relevant = scope.filter((t) => t.category === category && isConsumption(t));
    const total = relevant.reduce((a, t) => a + t.amount, 0);
    parts.push(`หมวด "${CATEGORY_META[category].label}" รวม ${fmt(round(total))} บาท (${relevant.length} รายการ)`);
  }

  const focus = parts.length ? `🎯 โฟกัส: ${parts.join(' · ')}` : '';
  const sample = (category ? relevant : scope)
    .filter((t) => !t.isTransfer)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 40)
    .map(toSafeTransaction);

  return { focus, sample };
}
