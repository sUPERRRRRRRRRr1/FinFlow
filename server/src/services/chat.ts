import type { CategoryId, Transaction } from '@finflow/shared';
import {
  ALL_CATEGORIES,
  CATEGORY_META,
  computeHealthScore,
  expenseByCategory,
  getRules,
  isConsumption,
  isRealIncome,
  monthKey,
  round,
  taxOverview,
  thaiMonthLabel,
} from '@finflow/shared';
import { toSafeTransaction, type SafeTransaction } from '../sanitize.js';
import { getScoreProfile, getTaxProfile } from '../db.js';

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
    const label = CATEGORY_META[c].label;
    // เทียบคำหลักของ label เช่น "อาหาร", "ช้อปปิ้ง"
    const head = label.split(/[/]/)[0]!;
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

export interface ChatContext {
  facts: string;
  sample: SafeTransaction[];
}

/**
 * RAG ของเรา: ดึงรายการที่เกี่ยวข้อง + คำนวณตัวเลขทั้งหมดด้วยโค้ด
 * คืน "ข้อเท็จจริงเชิงตัวเลข" + ตัวอย่างรายการ (sanitize แล้ว) เพื่อส่งให้ LLM เรียบเรียง
 */
export function buildChatContext(question: string, txns: Transaction[]): ChatContext {
  const q = question.toLowerCase();
  const category = detectCategory(question);
  const month = detectMonth(question, txns);
  const facts: string[] = [];

  let scope = txns;
  if (month) {
    scope = scope.filter((t) => monthKey(t.date) === month);
    facts.push(`ขอบเขต: เดือน ${thaiMonthLabel(month)}`);
  }

  // กรองตามหมวดถ้าระบุ
  let relevant = scope;
  if (category) {
    relevant = scope.filter((t) => t.category === category && isConsumption(t));
    const total = relevant.reduce((a, t) => a + t.amount, 0);
    facts.push(`รายจ่ายหมวด "${CATEGORY_META[category].label}": ${fmt(round(total))} บาท จาก ${relevant.length} รายการ`);

    // เทียบเดือนก่อน
    if (month) {
      const months = monthsOf(txns);
      const idx = months.indexOf(month);
      const prev = months[idx - 1];
      if (prev) {
        const prevTotal = txns
          .filter((t) => monthKey(t.date) === prev && t.category === category && isConsumption(t))
          .reduce((a, t) => a + t.amount, 0);
        const diff = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
        facts.push(`เทียบเดือนก่อน (${thaiMonthLabel(prev)}: ${fmt(round(prevTotal))} บาท) → ${diff >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${round(Math.abs(diff), 1)}%`);
      }
    }
  }

  // คำถามเชิงสรุป/ออม/รายรับ
  const income = scope.filter(isRealIncome).reduce((a, t) => a + t.amount, 0);
  const expense = scope.filter(isConsumption).reduce((a, t) => a + t.amount, 0);

  if (/ออม|เก็บเงิน|เหลือ/.test(q) || (!category && /เท่าไหร่|เท่าไร|สรุป|ภาพรวม/.test(q))) {
    facts.push(`รายรับรวม ${fmt(round(income))} บาท, รายจ่ายรวม ${fmt(round(expense))} บาท`);
    facts.push(`เงินเหลือ/ออมสุทธิ ${fmt(round(income - expense))} บาท (อัตราการออม ${round(income > 0 ? ((income - expense) / income) * 100 : 0, 1)}%)`);
  }

  if (/หมวด|มากที่สุด|เยอะ|top/i.test(q) && !category) {
    const cat = expenseByCategory(scope);
    const top = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    facts.push('หมวดที่ใช้จ่ายมากที่สุด:');
    top.forEach(([id, amt], i) => {
      facts.push(`  ${i + 1}. ${CATEGORY_META[id as keyof typeof CATEGORY_META]?.label ?? id}: ${fmt(round(amt))} บาท`);
    });
  }

  if (/คะแนน|สุขภาพ|health|score/i.test(q)) {
    const h = computeHealthScore(scope, getScoreProfile());
    facts.push(`คะแนนสุขภาพการเงิน ${h.total}/100 (${h.grade})`);
  }

  if (/ภาษี|ลดหย่อน|ยื่น|ssf|rmf|thaiesg|บริจาค|เงินได้/i.test(q)) {
    const profile = getTaxProfile();
    const o = taxOverview(scope, profile, getRules(profile.taxYear));
    const r = o.result;
    facts.push(`ภาษี: เงินได้สุทธิ ${fmt(round(r.netIncome))} บาท, ภาษีก่อนเครดิต ${fmt(round(r.taxBeforeCredit))} บาท, ${r.taxDue >= 0 ? `ต้องจ่ายเพิ่ม ${fmt(round(r.taxDue))}` : `ขอคืนได้ ${fmt(round(-r.taxDue))}`} บาท (อัตราขั้นสุดท้าย ${(r.marginalRate * 100).toFixed(0)}%)`);
    if (o.suggestions[0]) facts.push(`แนะนำประหยัดภาษี: ${o.suggestions[0].label} อีก ${fmt(o.suggestions[0].room)} → ประหยัด ~${fmt(o.suggestions[0].estimatedSaving)} บาท`);
    facts.push(o.filing.mustFile ? `ต้องยื่น ${o.filing.form} ภายใน ${o.filing.deadlineOnline}` : 'รายได้ยังไม่ถึงเกณฑ์ต้องยื่น');
  }

  // ถ้ายังไม่มี fact เลย ให้สรุปภาพรวม
  if (facts.length === 0 || (facts.length === 1 && month)) {
    facts.push(`รายรับรวม ${fmt(round(income))} บาท, รายจ่ายรวม ${fmt(round(expense))} บาท จาก ${scope.length} รายการ`);
  }

  // ตัวอย่างรายการที่เกี่ยวข้อง (เรียงตามจำนวนเงิน)
  const sample = (category ? relevant : scope)
    .filter((t) => !t.isTransfer)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 40)
    .map(toSafeTransaction);

  return { facts: facts.join('\n'), sample };
}
