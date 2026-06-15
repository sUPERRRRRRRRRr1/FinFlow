import type { Source, Transaction } from '@finflow/shared';
import { makeTxn, parseThaiDate, parseTime, parseAmount } from './common.js';

/**
 * แปลงข้อความ OCR จากสลิปโอนเงิน → 1 รายการ
 * รองรับสลิปทั่วไปของไทย (KBank/SCB/TrueMoney/PromptPay)
 * มองหา: จำนวนเงิน, วันที่/เวลา, ชื่อผู้รับ
 */
export function parseSlip(ocrText: string, source: Source = 'slip'): Transaction | null {
  const text = ocrText.replace(/ /g, ' ');

  // จำนวนเงิน: หาบรรทัดที่มีคำว่า จำนวน/บาท/amount
  let amount: number | null = null;
  const amtLine = text
    .split(/\r?\n/)
    .find((l) => /(จำนวน|จำนวนเงิน|amount|บาท|baht)/i.test(l) && /\d/.test(l));
  if (amtLine) amount = parseAmount(amtLine);
  if (amount == null) {
    // fallback: เลขที่มีทศนิยม 2 ตำแหน่งตัวใหญ่สุด
    const nums = [...text.matchAll(/\d{1,3}(?:,\d{3})*\.\d{2}/g)].map((m) => Number(m[0]!.replace(/,/g, '')));
    if (nums.length) amount = Math.max(...nums);
  }
  if (amount == null || amount <= 0) return null;

  // วันที่/เวลา
  const date = parseThaiDate(text) ?? new Date().toISOString().slice(0, 10);
  const time = parseTime(text);

  // ผู้รับ: บรรทัดหลัง "ไปยัง"/"ผู้รับ"/"to"
  let recipient = 'โอนเงิน (สลิป)';
  const recMatch = text.match(/(?:ไปยัง|ผู้รับ|รับเงิน|to)\s*[:：]?\s*([^\n]{2,60})/i);
  if (recMatch?.[1]) recipient = recMatch[1].trim();

  return makeTxn({
    date,
    time,
    amount,
    direction: 'out',
    counterparty: recipient,
    source,
    rawDesc: text.slice(0, 200),
  });
}
