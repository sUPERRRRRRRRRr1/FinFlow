import type { Source, Transaction, Direction } from '@finflow/shared';
import { makeTxn, extractAccountNo, toCE } from './common.js';

/** ตัดคำนำหน้า/Ref/เลขอ้างอิง/ตัวตัด "++" ออกจากรายละเอียด เหลือชื่อผู้รับ/ร้าน */
function cleanName(d: string): string {
  return d
    .replace(/^(โอนไปยัง|รับโอนจาก|เพื่อชำระ|ชำระไป|โอนเข้า|โอนไป|จาก)\s*/u, '')
    .replace(/พร้อมเพย์\s*/u, '')
    .replace(/\bRef\s*[0-9A-Za-z]{2,}\s*/iu, '') // Ref 266 / Ref X5001
    .replace(/\bX[0-9A-Z]{3,}\s*/u, '') // เลขบัญชีย่อ X0470
    .replace(/\s*\+\s*\+\s*$/u, '') // ตัวตัดชื่อ "++" (บางทีมีช่องว่างคั่น)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * แปลงข้อความจาก PDF รายการเดินบัญชีออมทรัพย์ KBank (K-eDocument, STM_SA*)
 * รูปแบบต่อแถว: DD-MM-YY  HH:MM  <ช่องทาง>  <ยอดคงเหลือ>  <รายละเอียด>  <ประเภท>  <จำนวนเงิน>
 * ปีอ่านจาก "รอบระหว่างวันที่ dd/mm/yyyy - dd/mm/yyyy" ในหัวกระดาษ
 */
export function parseSavingsStatement(text: string, source: Source = 'kbank'): Transaction[] {
  // รอบบัญชี dd/mm/yyyy - dd/mm/yyyy → ใช้กำหนดปีของแต่ละแถว (รองรับไฟล์รวบหลายเดือน/ข้ามปี)
  const period = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const startMonth = period ? Number(period[2]) : 1;
  // หัวกระดาษระบุปีเป็น พ.ศ. (เช่น 2568) → แปลงเป็น ค.ศ. ก่อนใช้ ไม่งั้นวันที่จะเป็น 2568-.. แล้วถูกกรองทิ้ง
  const startYear = period ? toCE(Number(period[3])) : new Date().getFullYear();
  const endYear = period ? toCE(Number(period[6])) : startYear;
  const yearOf = (mm: string) =>
    startYear === endYear ? startYear : Number(mm) >= startMonth ? startYear : endYear;

  // เลขบัญชีจากหัวกระดาษ → แยกบัญชีในแบงก์เดียวกัน (KBank ใช้จ่าย vs เงินเก็บ)
  const account = extractAccountNo(text);

  // ป้องกัน pdfjs ต่อหลายแถวรายการเป็นบรรทัดเดียว (เช่น แถว CDM/ATM/QR มีบรรทัดอ้างอิงต่อท้าย
  // แล้วหลุดเข้าไปในแถวถัดไป) — ใส่ \n ก่อนทุกรูปแบบวันที่-เวลา DD-MM-YY HH:MM
  // เพราะ regex ใช้ . ที่ไม่ match \n (ไม่มี flag s) แต่ละรายการจึงถูกจำกัดภายในบรรทัดเดียว
  const normalized = text.replace(/(?<!\n)(\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2})/g, '\n$1');

  // รูปแบบต่อแถว: <วันที่ เวลา> <ช่องทาง> <ยอดคงเหลือ> <รายละเอียด> <ประเภท> <จำนวนเงิน>
  // ประเภทรายการ: เรียง "คำยาวก่อนคำสั้น" เพราะหลายคำเป็นคำนำหน้ากัน (ถอนเงิน⊂ถอนเงินสด, ฝากเงิน⊂ฝากเงินสด)
  // ถ้าเรียงสั้นก่อน regex จะ match แค่ส่วนหน้าแล้วเหลือหาง → ทั้งแถวเพี้ยน (เคยทำยอดคงเหลือผิด → เงินเข้าปลอม)
  // \S* ท้ายบางคำ = เผื่อหางที่ต่างไป (รับดอกเบี้ยเงินฝาก / ค่าธรรมเนียม...) ครอบคลุมประเภทที่พบในไฟล์จริง
  const re =
    /(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+(.+?)\s+([\d,]+\.\d{2})\s+(.+?)\s+(รับโอนเงิน|รับดอกเบี้ย\S*|ดอกเบี้ย\S*|ฝากเงินสด|ฝากเงิน|โอนเงิน|ชำระเงิน|ถอนเงินสด|ถอนเงิน|ค่าธรรมเนียม\S*)\s+([\d,]+\.\d{2})/gu;
  const out: Transaction[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    // group 7 = ยอดคงเหลือหลังรายการ (balanceAfter) — ใช้แสดงยอดเงินจริงของบัญชี
    const [, dd, mm, , HH, MM, , bal, detail, type, amt] = m;
    // เงินเข้า = รับ.../ฝาก.../ดอกเบี้ย · เงินออก = โอน/ชำระ/ถอน/ค่าธรรมเนียม ฯลฯ
    const direction: Direction = /^(รับ|ฝาก)/.test(type) || type.includes('ดอกเบี้ย') ? 'in' : 'out';
    out.push(
      makeTxn({
        date: `${yearOf(mm)}-${mm}-${dd}`,
        time: `${HH}:${MM}`,
        amount: Number(amt.replace(/,/g, '')),
        direction,
        counterparty: cleanName(detail) || (direction === 'in' ? 'เงินเข้า' : 'รายการ'),
        source,
        account,
        balanceAfter: bal ? Number(bal.replace(/,/g, '')) : undefined,
        rawDesc: detail.trim().slice(0, 200),
      }),
    );
  }
  return out;
}
