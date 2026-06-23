import type { Transaction, Direction } from '@finflow/shared';
import { makeTxn } from './common.js';

/** แปลงรหัส/รายละเอียดดิบของ TrueMoney เป็นชื่อที่อ่านง่าย (ช่วยจัดหมวด + แสดงผล) */
function cleanTmnDetail(d: string): string {
  const s = d.trim();
  if (/^kbankimobiledd/i.test(s)) return 'เติมเงินจาก KBank';
  if (/^prepaidcard/i.test(s)) return 'บัตรพรีเพด (Mastercard)';
  if (/^im_onlinepaymentrelate/i.test(s)) return 'ชำระเงินออนไลน์';
  if (/^im_onlinepayment/i.test(s)) return 'ชำระเงินออนไลน์';
  if (/^im_disablesettle/i.test(s)) return 'ชำระเงิน (TrueMoney)';
  if (/^im_gncrossborder/i.test(s)) return 'ชำระเงินต่างประเทศ';
  if (/^im_vastopup/i.test(s)) return 'เติมเงิน/บริการ';
  if (/^im_voucher/i.test(s)) return 'ซื้อ Voucher';
  if (/^campaign/i.test(s)) return 'โปรโมชั่น TrueMoney';
  if (/^0\d{9}$/.test(s)) return `พร้อมเพย์ ${s}`; // เบอร์โทร = โอน P2P
  return s.replace(/\s+\d{6,}$/, '').trim() || s; // ตัดเลขอ้างอิงยาวๆ ท้ายรายละเอียด
}

/** ตรวจว่าเป็น statement ของ TrueMoney Wallet หรือไม่ (รูปแบบ STM_TMN) */
export function isTrueMoneyStatement(text: string): boolean {
  return /ใบแสดงรายการ\s*Statement of Account/u.test(text) && /(เงินออก|เงินเข้า)/u.test(text);
}

/**
 * แปลงข้อความจาก PDF รายการเดินบัญชี TrueMoney Wallet (ไฟล์ STM_TMN*)
 * รูปแบบต่อแถว: DD/MM/YYYY HH:MM:SS <เงินออก|เงินเข้า> <±จำนวน> <รายละเอียด> <ยอดก่อนหน้า> <ยอดคงเหลือ>
 * (ปีเป็น ค.ศ. อยู่แล้ว · รายละเอียดมีช่องว่างได้ จึงจับยอดคงเหลือ 2 ตัวท้ายเพื่อตัดท้ายแถว)
 */
export function parseTrueMoneyStatement(text: string): Transaction[] {
  const re =
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):\d{2}\s+(เงินออก|เงินเข้า)\s+-?([\d,]+\.\d{2})\s+(.+?)\s+[\d,]+\.\d{2}\s+([\d,]+\.\d{2})/gu;
  const out: Transaction[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [, dd, mm, yyyy, HH, MM, type, amt, detail, balAfter] = m;
    const direction: Direction = type === 'เงินเข้า' ? 'in' : 'out';
    out.push(
      makeTxn({
        date: `${yyyy}-${mm}-${dd}`,
        time: `${HH}:${MM}`,
        amount: Number(amt!.replace(/,/g, '')),
        direction,
        counterparty: cleanTmnDetail(detail!),
        source: 'truemoney',
        balanceAfter: Number(balAfter!.replace(/,/g, '')),
        rawDesc: detail!.trim().slice(0, 200),
      }),
    );
  }
  return out;
}
