import { describe, it, expect } from 'vitest';
import { parseThaiDate } from './common.js';
import { parseSavingsStatement } from './kbankStatement.js';
import { parseStatement } from './registry.js';
import { parseSlip } from './slip.js';
import { ingestTransactions } from '../services/ingest.js';
import { stringSimilarity } from '@finflow/shared';

// KBank STM จริง (รูปแบบที่ parseSavingsStatement รองรับ)
const KBANK_PDF = `รายการเดินบัญชี ธนาคารกสิกรไทย KBank
เลขที่บัญชี 160-3-73798-5
รอบระหว่างวันที่ 01/03/2568 - 31/03/2568
09-03-68 12:45 K PLUS 12,090.00 โอนไปยัง ร้านก๋วยเตี๋ยวเรือรุ่งเรือง โอนเงิน 250.00`;

describe('ปี พ.ศ. → ค.ศ.', () => {
  it('parseThaiDate รับปี 2 หลักแบบ พ.ศ. (DD-MM-YY / DD/MM/YY)', () => {
    expect(parseThaiDate('09-03-68')).toBe('2025-03-09');
    expect(parseThaiDate('09/03/68')).toBe('2025-03-09');
    expect(parseThaiDate('25-12-67')).toBe('2024-12-25');
  });

  it('parseSavingsStatement แปลงปีจากหัวกระดาษเป็น ค.ศ. + แยกยอด/คงเหลือถูก', () => {
    const txns = parseSavingsStatement(KBANK_PDF, 'kbank');
    expect(txns).toHaveLength(1);
    expect(txns[0]!.date).toBe('2025-03-09');
    expect(txns[0]!.amount).toBe(250);
    expect(txns[0]!.balanceAfter).toBe(12090);
    expect(txns[0]!.counterparty).toBe('ร้านก๋วยเตี๋ยวเรือรุ่งเรือง'); // ตัด "โอนไปยัง" หมด
    expect(txns[0]!.account).toBe('160-3-73798-5');
  });

  it('รายการ KBank ผ่าน pipeline ได้จริง (ไม่ถูก isPlausibleTxn กรองทิ้ง)', () => {
    const { transactions } = ingestTransactions(parseSavingsStatement(KBANK_PDF, 'kbank'));
    expect(transactions).toHaveLength(1);
  });
});

describe('รวม KBank เป็น parser เดียว', () => {
  it('parseStatement (ทางอัปโหลดเอง) ใช้ parseSavingsStatement ให้ผลตรงกับทาง Gmail', () => {
    const viaRegistry = parseStatement(KBANK_PDF, {});
    expect(viaRegistry.source).toBe('kbank');
    expect(viaRegistry.transactions).toHaveLength(1);
    expect(viaRegistry.transactions[0]!.amount).toBe(250);
    expect(viaRegistry.transactions[0]!.balanceAfter).toBe(12090);
    expect(viaRegistry.transactions[0]!.date).toBe('2025-03-09');
  });
});

describe('สลิป: ทิศทาง + กันซ้ำกับ STM', () => {
  it('สลิปจ่ายปกติ = out (แม้มีคำว่า "ผู้รับเงิน")', () => {
    const t = parseSlip(`โอนเงินสำเร็จ
ธนาคารผู้รับเงิน: กสิกรไทย
ชื่อบัญชี ร้านค้า เอ
จำนวนเงิน 100.00 บาท
09/03/2568 12:45`)!;
    expect(t.direction).toBe('out');
  });

  it('สลิปรับเงิน = in', () => {
    const t = parseSlip(`รับเงินสำเร็จ
ชื่อบัญชี สมหญิง ใจดี
จำนวนเงิน 250.00 บาท
09/03/2568 12:45`)!;
    expect(t.direction).toBe('in');
  });

  it('สลิปจ่าย "โอนเงินเข้าบัญชี <ผู้รับ>" = out (ไม่ถูกตีว่าเงินเข้าเพราะมีคำว่า "เงินเข้า")', () => {
    const t = parseSlip(`โอนเงินเข้าบัญชี
น.ส. วริศรา ภาคภูมินันทพันธ์
จำนวนเงิน 299.00 บาท
20/06/2569 19:16`)!;
    expect(t.direction).toBe('out');
  });

  it('marker "ทิศทาง: in" จาก OCR ไม่พลิกสลิปจ่ายเป็นรับเข้า (เนื้อสลิปนำ marker)', () => {
    // โมเดล vision เดา in ผิด ทั้งที่เนื้อสลิปคือ "โอนเงิน ... ผู้รับ: สมชาย" = จ่ายออก → ต้องเป็น out
    const wrongMarker = parseSlip(`ประเภท: โอนเงิน
ทิศทาง: in
ผู้รับ: สมชาย
จำนวน: 500.00 บาท`)!;
    expect(wrongMarker.direction).toBe('out');
  });

  it('marker=in ใช้ตัดสินเฉพาะสลิปที่ไม่มีร่องรอยการจ่ายออกเลย (กำกวมจริง)', () => {
    const ambiguous = parseSlip(`ทิศทาง: in
จำนวน: 500.00 บาท
เลขที่รายการ: 0123456789`)!;
    expect(ambiguous.direction).toBe('in');
  });

  it('สลิป + KBank STM รายการเดียวกัน → เหลือ 1 (STM ชนะ)', () => {
    const stm = parseSavingsStatement(KBANK_PDF, 'kbank');
    const slip = parseSlip(`โอนเงินสำเร็จ
ชื่อบัญชี ร้านก๋วยเตี๋ยวเรือรุ่งเรือง
จำนวนเงิน 250.00 บาท
09/03/2568 12:45`)!;
    const { transactions, stats } = ingestTransactions([...stm, slip]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.source).toBe('kbank');
    expect(stats.duplicatesRemoved).toBe(1);
  });
});

describe('กันซ้ำ: ตัดคำนำหน้าชื่อไทย', () => {
  it('"นาย สมชาย รักเรียน" ≈ "สมชาย รักเรียน" → similarity = 1', () => {
    expect(stringSimilarity('สมชาย รักเรียน', 'นาย สมชาย รักเรียน')).toBe(1);
  });

  it('สลิป "นาย X" กับ STM "X" → กันซ้ำได้', () => {
    const stmPdf = `รายการเดินบัญชี ธนาคารกสิกรไทย KBank
เลขที่บัญชี 160-3-73798-5
รอบระหว่างวันที่ 01/03/2568 - 31/03/2568
09-03-68 12:45 K PLUS 12,090.00 โอนไปยัง สมชาย รักเรียน โอนเงิน 250.00`;
    const stm = parseSavingsStatement(stmPdf, 'kbank');
    const slip = parseSlip(`โอนเงินสำเร็จ
ชื่อบัญชี นาย สมชาย รักเรียน
จำนวนเงิน 250.00 บาท
09/03/2568 12:45`)!;
    const { transactions } = ingestTransactions([...stm, slip]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.source).toBe('kbank');
  });
});
