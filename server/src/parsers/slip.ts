import type { Source, Transaction, Direction } from '@finflow/shared';
import { makeTxn, parseThaiDate, parseTime, parseAmount } from './common.js';

/**
 * ทิศทางของสลิป: ดีฟอลต์ "จ่ายออก" (out) เพราะสลิปที่ผู้ใช้อัป/ส่งต่อ ส่วนใหญ่เป็นการ "จ่าย"
 * ตัดสินตามลำดับ:
 *  1) marker "ทิศทาง: in|out" ที่ vision OCR สรุปมา (โมเดลเห็นสลิปทั้งใบ — เชื่อถือสุด)
 *  2) ตัด "โอนเงินเข้า(บัญชี…)" ทิ้งก่อน — นั่นคือเงินเข้าบัญชี "ผู้รับ" = เราจ่ายออก ไม่ใช่รับเข้า
 *     (กันบั๊ก: สลิปจ่ายถูกจัดเป็น "เงินเข้า" เพราะเจอคำว่า "เงินเข้า" ในประโยค "โอนเงินเข้าบัญชี")
 *  3) เป็นเงินเข้า (in) เฉพาะเมื่อพบสัญญาณรับเงินชัดเจน — negative lookbehind กัน "ผู้รับเงิน" ในสลิปจ่าย
 */
function slipDirection(text: string): Direction {
  const marker = text.match(/ทิศทาง\s*[:：]\s*(in|out|เข้า|ออก)/i);
  if (marker) return /^(in|เข้า)$/i.test(marker[1]!) ? 'in' : 'out';

  const t = text.replace(/โอน\s*เงินเข้า\S*/gi, ' ');
  const inSignal =
    /รับโอน|ได้รับเงิน|(?<!ผู้)รับเงิน|เงินเข้า|received|money\s*in|deposit|เงินเดือน|salary|payroll/i;
  return inSignal.test(t) ? 'in' : 'out';
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

  return makeTxn({
    date,
    time,
    amount,
    direction: slipDirection(text),
    counterparty: recipient,
    source,
    rawDesc: text.slice(0, 200),
  });
}
