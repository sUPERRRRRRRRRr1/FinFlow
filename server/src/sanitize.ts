import type { Transaction } from '@finflow/shared';

/**
 * กรองข้อมูลอ่อนไหวออกจากข้อความก่อนส่งให้ AI (Responsible AI / PDPA)
 *  - เลขบัตรประชาชน 13 หลัก
 *  - เลขบัญชี/เลขยาว ≥ 9 หลัก
 *  - เลขบัญชีที่ถูกปิดบังบางส่วน (xxx-x-x1234-x)
 * แทนที่ด้วย [ปกปิด] โดยไม่ทำลายความหมายของรายการ
 */
export function sanitizeText(input: string): string {
  if (!input) return '';
  return input
    .replace(/\b\d{1}-?\d{4}-?\d{5}-?\d{2}-?\d{1}\b/g, '[เลขบัตร]') // เลขบัตร ปชช.
    .replace(/[xX*]{2,}[-\s]?\d{3,}/g, '[เลขบัญชี]') // เลขบัญชีปิดบัง
    .replace(/\b\d{9,}\b/g, '[เลขอ้างอิง]') // เลขยาว
    .replace(/\b\d{3}-\d-\d{5}-\d\b/g, '[เลขบัญชี]') // รูปแบบเลขบัญชีไทย
    .trim();
}

/** ข้อมูลธุรกรรมรูปแบบย่อ + ปลอดภัย สำหรับส่งเข้า LLM (ตัดข้อมูลระบุตัวตน) */
export interface SafeTransaction {
  date: string;
  amount: number;
  direction: 'in' | 'out';
  merchant: string;
  category: string;
  source: string;
}

export function toSafeTransaction(t: Transaction): SafeTransaction {
  return {
    date: t.date,
    amount: t.amount,
    direction: t.direction,
    merchant: sanitizeText(t.counterparty),
    category: t.category,
    source: t.source,
  };
}
