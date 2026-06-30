import type { Source, Transaction, Direction } from '@finflow/shared';
import { makeTxn, parseThaiDate, parseTime, parseAmount } from './common.js';

/**
 * ทิศทางของสลิป: ดีฟอลต์ "จ่ายออก" (out) เพราะสลิปที่ผู้ใช้อัป/ส่งต่อ ส่วนใหญ่เป็นการ "จ่าย"
 *
 * สำคัญ: ให้ "เนื้อสลิป" นำ marker "ทิศทาง: in|out" ที่ vision OCR สรุปมา — โมเดลอ่าน"คำ"ได้แม่น
 * แต่ "เดาทิศทาง" พลาดบ่อย โดยเฉพาะเห็นคำว่า "ผู้รับเงิน" บนสลิป "โอนออก" แล้วสรุปเป็น in
 * (= บั๊กที่ทำให้รายจ่ายไปโผล่รายรับ เช่น แจ้งโอนพร้อมเพย์ K PLUS)
 * ตัดสินตามลำดับ:
 *  1) ตัด "โอนเงินเข้า(บัญชีผู้รับ)" ทิ้งก่อน — เงินเข้าบัญชี "ผู้รับ" = เราจ่ายออก ไม่ใช่รับเข้า
 *  2) พบสัญญาณ "รับเงินเข้า" ชัดเจน → in (negative lookbehind กัน "ผู้รับเงิน" บนสลิปจ่าย)
 *     ระวังอีเมลแจ้งเตือน K PLUS เป็น "สองภาษา" — ส่วนอังกฤษมี "Received Name:" (= ชื่อผู้รับเงิน = จ่ายออก)
 *     จึงจับ received เฉพาะบริบทรับเงินจริง (received funds/from/…) ไม่ใช่ป้าย "Received Name"
 *  3) ไม่พบ → จ่ายออก; เชื่อ marker=in จาก OCR เฉพาะสลิปที่ "ไม่มีร่องรอยการจ่ายออก" เลย
 *     (สลิปกำกวมจริง ๆ) — ถ้าสลิปมีคำว่า โอน/จ่าย/ชำระ/ผู้รับเงิน/transfer/payment อย่าให้ marker พลิกเป็นรับเข้า
 */
function slipDirection(text: string): Direction {
  const t = text.replace(/โอน\s*เงินเข้า\S*/gi, ' ');
  const inSignal =
    /รับโอน|ได้รับเงิน|(?<!ผู้)รับเงิน|เงินเข้า|เงินเดือน|salary|payroll|deposit|credited|money\s*in|received\s+(?:from|funds?|money|payment|amount|baht|thb|฿)|(?:funds?|money|payment|amount)\s+received/i;
  if (inSignal.test(t)) return 'in';

  // ร่องรอยว่าเป็น "จ่ายออก/โอนออก" (ไทย+อังกฤษ) — ถ้ามี อย่าให้ marker=in ที่ OCR เดามาพลิกเป็นรับเข้า
  const looksLikePayment = /โอน|จ่าย|ชำระ|ซื้อ|เติมเงิน|ผู้รับเงิน|ยอดถอน|transfer|payment|paid|purchase|withdraw/i.test(text);
  const markerIn = /ทิศทาง\s*[:：]\s*(in|เข้า)/i.test(text);
  if (markerIn && !looksLikePayment) return 'in';
  return 'out';
}

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

  // ผู้รับ: ไล่ pattern ตามลำดับความสำคัญ (เจอตัวแรกที่แมตช์ก็หยุด)
  //  1) เพื่อเข้าบัญชีบริษัท → ชื่อร้าน/บริษัท (จ่ายร้านค้า ไม่ใช่โอนเปล่า)
  //  2) ชื่อบัญชี → ชื่อเจ้าของบัญชีปลายทาง (เอาก่อน "ธนาคารผู้รับเงิน" ที่ให้แค่ชื่อธนาคาร)
  //  3) คีย์เวิร์ดไทยทั่วไป  4) "to" อังกฤษ (word-boundary กัน Cus(to)mer)
  const recipientPatterns = [
    /เพื่อเข้าบัญชีบริษัท\s*[:：]?\s*([^\n]{2,80})/,
    /ชื่อบัญชี\s*[:：]?\s*([^\n]{2,80})/,
    /(?:ผู้รับเงิน|บัญชีผู้รับ|ปลายทาง|ไปยัง|ผู้รับ|รับเงิน)\s*[:：]?\s*([^\n]{2,60})/,
    /\bto\b\s*[:：]?\s*([^\n]{2,60})/i,
  ];
  let recipient = 'โอนเงิน (สลิป)';
  for (const re of recipientPatterns) {
    let r = text.match(re)?.[1]?.trim();
    // ปฏิเสธ boilerplate ของอีเมล KBank (ไม่ใช่ชื่อผู้รับ)
    if (r && /payment request|as follows|k ?plus service/i.test(r)) r = undefined;
    if (r) {
      recipient = r;
      break;
    }
  }

  // ── อีเมลแจ้งเตือน K PLUS: ยอดคงเหลือหลังรายการ ("ยอดถอนได้"/"ยอดเงินคงเหลือ") + บัญชีต้นทาง ──
  // ใช้ทำ "เงินคงเหลือ" ให้สดกว่า statement รายเดือน — ยอดที่ธนาคารบอกเอง แม่นทั้งขาเข้า-ขาออก
  let balanceAfter: number | undefined;
  const balLine = text
    .split(/\r?\n/)
    .find((l) => /(ยอดถอนได้|ยอดเงินคงเหลือ|ยอดคงเหลือ|เงินคงเหลือ|คงเหลือ|available\s*balance)/i.test(l) && /\d/.test(l));
  if (balLine) {
    const b = parseAmount(balLine);
    if (b != null && b > 0) balanceAfter = b;
  }

  // บัญชีต้นทางถูกปิดบัง (เช่น "xxx-x-x3798-x") → เก็บเฉพาะ "เลขที่เปิดเผย" ให้ชั้น store จับคู่บัญชีจริง
  let account: string | undefined;
  const srcAcct = text.match(
    /(?:โอนเงินจากบัญชี|จากบัญชี|บัญชีต้นทาง|from\s*account)\s*[:：]?\s*([xX*\d][xX*\d-]{3,})/i,
  )?.[1];
  if (srcAcct) {
    const digits = srcAcct.replace(/\D/g, '');
    if (digits.length >= 3) account = digits;
  }

  // บัญชีปลายทาง (อีเมลแจ้งเตือนโอนเข้าบัญชี): "เพื่อเข้าบัญชี: 222-8-72180-0" → ใช้รู้ว่าโอนเข้าบัญชีไหน
  // เลขเต็ม (มีขีด) = ใช้เป็น transferTo ได้เลย · ที่ปิดบัง (X####) = เก็บเลขที่เปิดเผยให้ store จับคู่
  let transferTo: string | undefined;
  const destAcct = text.match(
    /(?:เพื่อเข้าบัญชี|บัญชีปลายทาง|เข้าบัญชีเลขที่|โอนเข้าบัญชี|to\s*account)\s*[:：]?\s*([xX*\d][xX*\d-]{5,})/i,
  )?.[1];
  if (destAcct) {
    transferTo = /\d{3}-\d{1}-\d{4,6}-\d/.test(destAcct) ? destAcct.trim() : destAcct.replace(/\D/g, '') || undefined;
  }

  return makeTxn({
    date,
    time,
    amount,
    direction: slipDirection(text),
    counterparty: recipient,
    source,
    rawDesc: text.slice(0, 200),
    balanceAfter,
    account,
    transferTo,
  });
}
