import { describe, it, expect } from 'vitest';
import { parseStatement, pickParser } from './registry.js';
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
