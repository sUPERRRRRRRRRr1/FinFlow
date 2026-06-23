import type { Parser } from './common.js';
import { scanStatement } from './statementScanner.js';
import { parseSavingsStatement } from './kbankStatement.js';

/** Parser สำหรับ statement ของ KBank (K PLUS) */
export const kbankParser: Parser = {
  source: 'kbank',
  label: 'KBank (K PLUS)',
  matches(text, ctx) {
    const hay = `${ctx.sender ?? ''} ${ctx.filename ?? ''} ${text.slice(0, 400)}`.toLowerCase();
    return (
      hay.includes('kasikornbank') ||
      hay.includes('kasikorn') ||
      hay.includes('kbank') ||
      hay.includes('k plus') ||
      hay.includes('ธนาคารกสิกรไทย')
    );
  },
  // ใช้ parser เฉพาะของ KBank STM ก่อน (แยกยอด/คงเหลือ/เลขบัญชี/ปีถูกต้อง)
  // ถ้ารูปแบบไม่เข้า (เช่นแจ้งเตือนสั้นๆ/บัตรเครดิต) ค่อย fallback ตัวสแกนทั่วไป
  // → ทั้งอัปโหลดเอง และดึงจาก Gmail ใช้ทางเดียวกัน ไม่ให้ผลต่างกัน
  parse(text) {
    const savings = parseSavingsStatement(text, 'kbank');
    return savings.length > 0 ? savings : scanStatement(text, 'kbank');
  },
};
