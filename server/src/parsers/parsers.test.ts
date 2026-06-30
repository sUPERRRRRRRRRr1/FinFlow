import { describe, it, expect } from 'vitest';
import { parseStatement, pickParser } from './registry.js';
import { parseSavingsStatement } from './kbankStatement.js';
import { parseSlip } from './slip.js';
import { parseThaiDate, parseAmount } from './common.js';

describe('date & amount helpers', () => {
  it('parses Buddhist-era dd/mm/yyyy', () => {
    expect(parseThaiDate('09/03/2568')).toBe('2025-03-09');
  });
  it('parses ISO and Thai-month dates', () => {
    expect(parseThaiDate('2025-03-09')).toBe('2025-03-09');
    expect(parseThaiDate('9 มี.ค. 68')).toBe('2025-03-09');
  });
  it('parses amounts with commas', () => {
    expect(parseAmount('45,000.00')).toBe(45000);
    expect(parseAmount('-60.00')).toBe(60);
  });
});

const KBANK_STATEMENT = `รายการเดินบัญชี ธนาคารกสิกรไทย KBank
วันที่ เวลา รายการ ถอน ฝาก คงเหลือ
09/03/2568 12:45 ชำระเงิน Cafe Amazon -60.00 12,340.00
25/03/2568 00:05 เงินเดือน บริษัท ฟินเทค +45,000.00 57,340.00
15/03/2568 14:22 ซื้อสินค้า Power Buy -32,900.00 24,440.00`;

describe('statement parsing + parser routing', () => {
  it('routes to KBank parser by content', () => {
    const p = pickParser(KBANK_STATEMENT, {});
    expect(p?.source).toBe('kbank');
  });

  it('extracts dated rows with correct direction/amount/balance', () => {
    const { source, transactions } = parseStatement(KBANK_STATEMENT, {});
    expect(source).toBe('kbank');
    expect(transactions).toHaveLength(3);

    const salary = transactions.find((t) => t.amount === 45000)!;
    expect(salary.direction).toBe('in');
    expect(salary.date).toBe('2025-03-25');

    const coffee = transactions.find((t) => t.amount === 60)!;
    expect(coffee.direction).toBe('out');
    expect(coffee.balanceAfter).toBe(12340);
  });

  it('routes to TrueMoney by sender', () => {
    const p = pickParser('some text', { sender: 'service@truemoney.com' });
    expect(p?.source).toBe('truemoney');
  });
});

describe('KBank STM (K-eDocument): แถวถอนเงินสด ATM ต้องอ่านยอดคงเหลือถูก', () => {
  // รูปแบบจริงจากไฟล์ STM_SA: <วันที่> <เวลา> <ช่องทาง> <ยอดคงเหลือ> <รายละเอียด> <ประเภท> <จำนวนเงิน>
  // เคยมีบั๊ก: ประเภท "ถอนเงินสด" ไม่ตรงกับ regex (มีแค่ "ถอนเงิน") → หยิบจำนวนเงินถอน (100) มาเป็นยอดคงเหลือ
  // ทำให้ยอดร่วงผิด → เกิด "เงินเข้าปลอม" ตอนกระทบยอด (reconcileBalances)
  const STM = `รอบระหว่างวันที่ 01/07/2025 - 31/12/2025  เลขที่บัญชี 160-3-73798-5
12-10-25   16:17   EDC/K SHOP/MYQR 12,951.82   เพื่อชำระ Ref X3001 เอ็ม เค สุกี้ ชำระเงิน   203.00
12-10-25   17:13   ATM Airport Link มักกะสัน (812) 12,851.82   รหัสอ้างอิง ATMA5792 ถอนเงินสด   100.00
13-10-25   17:36   K PLUS 12,830.82   เพื่อชำระ Ref X2870 Readtoon ชำระเงิน   21.00`;

  it('อ่านแถว "ถอนเงินสด" เป็นยอดคงเหลือจริง ไม่ใช่จำนวนเงินที่ถอน', () => {
    const txns = parseSavingsStatement(STM);
    const atm = txns.find((t) => (t.rawDesc ?? '').includes('ATMA5792'))!;
    expect(atm).toBeTruthy();
    expect(atm.direction).toBe('out');
    expect(atm.amount).toBe(100); // จำนวนที่ถอน
    expect(atm.balanceAfter).toBe(12851.82); // ยอดคงเหลือจริง (ไม่ใช่ 100)
  });

  it('แถวถัดมาไม่ถูกกลืน — ยอดคงเหลือต่อเนื่องถูกต้อง', () => {
    const txns = parseSavingsStatement(STM);
    const readtoon = txns.find((t) => (t.rawDesc ?? '').includes('Readtoon'))!;
    expect(readtoon.amount).toBe(21);
    expect(readtoon.balanceAfter).toBe(12830.82);
    expect(readtoon.date).toBe('2025-10-13');
  });
});

describe('slip OCR parsing', () => {
  it('extracts amount and recipient from a slip', () => {
    const slip = `โอนเงินสำเร็จ
จำนวนเงิน 250.00 บาท
ไปยัง ร้านก๋วยเตี๋ยวเรือ
09/03/2568 12:45`;
    const t = parseSlip(slip)!;
    expect(t).not.toBeNull();
    expect(t.amount).toBe(250);
    expect(t.direction).toBe('out');
    expect(t.counterparty).toContain('ก๋วยเตี๋ยว');
    expect(t.date).toBe('2025-03-09');
  });
});

describe('slip direction: transfer-out must not be classified as income', () => {
  // อีเมล K PLUS จริง เป็น "สองภาษา" — ส่วนอังกฤษมี "Received Name:" ที่เคยทำให้ regex เจอ "received"
  // แล้วจัดเป็นรายรับผิด ทั้งที่เป็นการโอนออก (มี "ชื่อผู้รับเงิน" / "From Account")
  const KPLUS_OUT = `เรื่อง แจ้งผลการทำรายการโอนเงินพร้อมเพย์ (สำเร็จ)
ตามที่คุณได้ทำรายการโอนเงินพร้อมเพย์ผ่านบริการ K PLUS โดยมีรายละเอียด ดังนี้
	วันที่ทำรายการ: 25/06/2026  17:10:44
	โอนเงินจากบัญชี: xxx-x-x3798-x
	ชื่อผู้รับเงิน: นางสาว นงคราญ วงสาเคน
	จำนวนเงิน (บาท): 10.00
	ยอดถอนได้ (บาท): 2,987.82
ธนาคารได้ดำเนินการโอนเงินตามที่คุณได้ทำรายการไว้เรียบร้อยแล้ว

Subject: Result of PromptPay Funds Transfer (Success)
With reference to your request for funds transfer via K PLUS Service as follows:
	From Account: xxx-x-x3798-x
	Received Name: NONGKAN WONGS
	Amount (THB): 10.00
We wish to inform you that the funds transfer has been successfully completed.`;

  it('parses K PLUS PromptPay transfer-out as expense (real bilingual email text)', () => {
    const t = parseSlip(KPLUS_OUT)!;
    expect(t.amount).toBe(10);
    expect(t.direction).toBe('out');
    expect(t.counterparty).toContain('นงคราญ');
  });

  it('ignores a wrong OCR "ทิศทาง: in" marker when slip has payment fingerprints', () => {
    // จำลอง Gemini OCR เผลอสรุป in เพราะเห็น "ผู้รับเงิน" บนสลิปจ่าย
    const ocr = `ประเภท: โอนเงินพร้อมเพย์
ทิศทาง: in
ผู้รับ: นางสาว นงคราญ วงสาเคน
จำนวน: 10.00 บาท`;
    expect(parseSlip(ocr)!.direction).toBe('out');
  });

  it('still classifies a genuine money-received slip as income', () => {
    const incoming = `รับเงินโอนพร้อมเพย์ สำเร็จ
ทิศทาง: in
จำนวนเงิน 500.00 บาท
เงินเข้าบัญชี xxx-x-x3798-x`;
    expect(parseSlip(incoming)!.direction).toBe('in');
  });

  it('honors an explicit salary slip as income', () => {
    const salary = `เงินเดือน บริษัท ฟินเทค
จำนวนเงิน 45,000.00 บาท
25/06/2569`;
    expect(parseSlip(salary)!.direction).toBe('in');
  });

  it('still detects a genuine English "funds received" slip as income', () => {
    const received = `PromptPay Funds Received
Received from: SOMCHAI J.
Amount (THB): 500.00`;
    expect(parseSlip(received)!.direction).toBe('in');
  });
});

describe('K PLUS notification: balanceAfter + source account (สำหรับยอดคงเหลือสด)', () => {
  // อีเมลแจ้งเตือนจริงจาก K PLUS — มี "ยอดถอนได้" (= ยอดคงเหลือหลังรายการ) + "โอนเงินจากบัญชี"
  // ใช้ยอดนี้อัปเดต "เงินคงเหลือ" ให้สดกว่า statement รายเดือน (ยอดที่ธนาคารบอกเอง แม่นทั้งเข้า-ออก)
  const KPLUS_NOTIFY = `วันที่ทำรายการ: 29/06/2026  15:46:19
	เลขที่รายการ: 016180154619CPP10110
	โอนเงินจากบัญชี: xxx-x-x3798-x
	ให้รหัสพร้อมเพย์: x-xxxx-xxxx2-68-9
	ชื่อผู้รับเงิน: นางสาว นงคราญ วงสาเคน
	จำนวนเงิน (บาท): 10.00
	ค่าธรรมเนียม (บาท): 0.00
	ยอดถอนได้ (บาท): 5,073.82`;

  it('ดึง balanceAfter จาก "ยอดถอนได้" (ไม่ใช่จำนวนเงิน/ค่าธรรมเนียม)', () => {
    const t = parseSlip(KPLUS_NOTIFY)!;
    expect(t.amount).toBe(10); // จำนวนเงินจริง
    expect(t.balanceAfter).toBe(5073.82); // ยอดคงเหลือหลังรายการ
  });

  it('เก็บเลขบัญชีต้นทางที่เปิดเผย (3798) ไว้ให้ store จับคู่บัญชีจริง', () => {
    expect(parseSlip(KPLUS_NOTIFY)!.account).toBe('3798');
  });

  it('ยังเป็นรายจ่าย (out) + ชื่อผู้รับถูกต้อง', () => {
    const t = parseSlip(KPLUS_NOTIFY)!;
    expect(t.direction).toBe('out');
    expect(t.counterparty).toContain('นงคราญ');
  });

  // โอนเข้าบัญชีตัวเอง: อีเมลมี "เพื่อเข้าบัญชี: <เลขบัญชีปลายทาง>" → ใช้รู้ว่าโอนเข้าบัญชีไหน (เช่น เงินเก็บ)
  const KPLUS_TO_OWN = `เรื่อง แจ้งผลการทำรายการโอนเงิน (สำเร็จ)
	วันที่ทำรายการ: 28/06/2026  20:27:05
	โอนเงินจากบัญชี: xxx-x-x3798-x
	ธนาคารผู้รับเงิน: ธนาคารกสิกรไทย
	เพื่อเข้าบัญชี: 222-8-72180-0
	ชื่อบัญชี: ด.ช. สุวิจักขณ์ ปิ่นรัมย์
	จำนวนเงิน (บาท): 2,300.00
	ยอดถอนได้ (บาท): 239.82`;

  it('ดึงบัญชีปลายทางจาก "เพื่อเข้าบัญชี" → transferTo (ไว้บวกเข้ายอดบัญชีออม)', () => {
    const t = parseSlip(KPLUS_TO_OWN)!;
    expect(t.amount).toBe(2300);
    expect(t.transferTo).toBe('222-8-72180-0'); // บัญชีเงินเก็บ
    expect(t.balanceAfter).toBe(239.82); // ยอดบัญชีต้นทางหลังโอน
    expect(t.account).toBe('3798'); // เลขต้นทางที่เปิดเผย
  });
});
