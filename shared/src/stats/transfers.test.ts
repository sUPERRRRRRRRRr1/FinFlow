import { describe, it, expect } from 'vitest';
import { accountLast4, tagOwnTransfers, type OwnAccountCode } from './transfers.js';
import type { Transaction } from '../types.js';

const OWN: OwnAccountCode[] = [
  { code: '7985', kind: 'daily', account: '160-3-73798-5' },
  { code: '1800', kind: 'savings', account: '222-8-72180-0' },
];

function txn(p: Partial<Transaction>): Transaction {
  return {
    id: 'x',
    date: '2025-09-03',
    amount: 1000,
    direction: 'out',
    counterparty: '',
    source: 'kbank',
    category: 'transfer',
    ...p,
  } as Transaction;
}

describe('accountLast4', () => {
  it('ดึง 4 ตัวท้ายจากเลขบัญชี', () => {
    expect(accountLast4('160-3-73798-5')).toBe('7985');
    expect(accountLast4('222-8-72180-0')).toBe('1800');
    expect(accountLast4('truemoney')).toBeNull();
  });
});

describe('tagOwnTransfers', () => {
  it('โอนออกจากบัญชีใช้จ่าย → บัญชีออมตัวเอง (X1800) = นับเป็นเงินออม ไม่ใช่รายจ่าย', () => {
    const [r] = tagOwnTransfers(
      [txn({ account: '160-3-73798-5', direction: 'out', rawDesc: 'โอนไป X1800 นาย สุวิจักขณ์ ปิ่++', category: 'transfer' })],
      OWN,
    );
    expect(r!.category).toBe('savings');
    expect(r!.isTransfer).toBeFalsy(); // ยังเป็น out ที่นับเป็นออม (ไม่ใช่ transfer เป็นกลาง)
  });

  it('โอนออกไปคนอื่น (X9999 ไม่ใช่บัญชีตัวเอง) = คงเป็นรายจ่ายเดิม', () => {
    const [r] = tagOwnTransfers(
      [txn({ account: '160-3-73798-5', direction: 'out', rawDesc: 'โอนไป X9999 นาย ใครก็ไม่รู้++', category: 'transfer' })],
      OWN,
    );
    expect(r!.category).toBe('transfer');
    expect(r!.isTransfer).toBeFalsy();
  });

  it('โอนจากบัญชีออม → บัญชีใช้จ่ายตัวเอง (X7985) = transfer เป็นกลาง', () => {
    const [r] = tagOwnTransfers(
      [txn({ account: '222-8-72180-0', direction: 'out', rawDesc: 'โอนไป X7985 นาย สุวิจักขณ์ ปิ่++', category: 'transfer' })],
      OWN,
    );
    expect(r!.isTransfer).toBe(true);
    expect(r!.category).toBe('transfer');
  });

  it('เงินเข้า ← บัญชีตัวเอง (X1800) = ไม่ใช่รายรับจริง (เป็นกลาง)', () => {
    const [r] = tagOwnTransfers(
      [txn({ account: '160-3-73798-5', direction: 'in', rawDesc: 'จาก X1800 นาย สุวิจักขณ์ ปิ่++', category: 'income' })],
      OWN,
    );
    expect(r!.isTransfer).toBe(true);
  });

  it('ไม่แตะรายการที่ matchTransfers จับคู่แล้ว (isTransfer=true)', () => {
    const [r] = tagOwnTransfers(
      [txn({ account: '160-3-73798-5', direction: 'out', rawDesc: 'โอนไป X1800', isTransfer: true, category: 'transfer' })],
      OWN,
    );
    expect(r!.category).toBe('transfer'); // คงเดิม ไม่ถูกเปลี่ยนเป็น savings
  });

  it('อ้างถึงเลขบัญชีตัวเอง (self) ไม่ทำให้กลายเป็น transfer', () => {
    const [r] = tagOwnTransfers(
      [txn({ account: '160-3-73798-5', direction: 'out', rawDesc: 'ค่าธรรมเนียม X7985', category: 'bills' })],
      OWN,
    );
    expect(r!.category).toBe('bills');
    expect(r!.isTransfer).toBeFalsy();
  });

  it('ไม่มีบัญชีตั้งค่า = คืนค่าเดิมทั้งหมด', () => {
    const input = [txn({ account: '160-3-73798-5', rawDesc: 'โอนไป X1800' })];
    expect(tagOwnTransfers(input, [])).toBe(input);
  });
});
