import { describe, it, expect } from 'vitest';
import type { Transaction } from '@finflow/shared';
import { buildChatContext } from './chat.js';

let n = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${n++}`,
    date: '2026-02-15',
    amount: 100,
    direction: 'out',
    counterparty: 'ร้านอาหาร',
    source: 'kbank',
    category: 'food',
    ...p,
  };
}

describe('buildChatContext', () => {
  const txns: Transaction[] = [
    tx({ date: '2026-02-10', amount: 200, category: 'food' }),
    tx({ date: '2026-02-11', amount: 500, category: 'shopping' }),
  ];

  it('ตรวจจับหมวด+เดือน: ใส่ focus และ sample เฉพาะหมวดที่ถาม', () => {
    const { focus, sample } = buildChatContext('เดือนนี้ค่าอาหารเท่าไหร่', txns);
    expect(focus).toContain('🎯');
    expect(focus).toContain('อาหาร');
    expect(sample.every((s) => s.category === 'food')).toBe(true);
  });

  it('คำถามทั่วไปที่ไม่ระบุหมวด/เดือน: focus ว่าง แต่ยังมี sample', () => {
    const { focus, sample } = buildChatContext('ช่วยดูการเงินหน่อย', txns);
    expect(focus).toBe('');
    expect(sample.length).toBeGreaterThan(0);
  });
});
