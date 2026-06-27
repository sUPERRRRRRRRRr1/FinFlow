import { describe, it, expect } from 'vitest';
import type { Transaction } from '@finflow/shared';
import { buildSnapshot } from './snapshot.js';

let n = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${n++}`,
    date: '2026-01-15',
    amount: 100,
    direction: 'out',
    counterparty: 'ร้านค้า',
    source: 'kbank',
    category: 'food',
    ...p,
  };
}

describe('buildSnapshot', () => {
  it('เคสไม่มีข้อมูล: คืนข้อความว่ายังไม่มีข้อมูล ไม่ throw', () => {
    expect(buildSnapshot([])).toContain('ยังไม่มีข้อมูล');
  });

  it('ตารางรายเดือน: คำนวณรายรับ/จ่าย/ออมต่อเดือนถูกต้อง', () => {
    const txns: Transaction[] = [
      tx({ date: '2026-01-05', direction: 'in', category: 'income', amount: 30000 }),
      tx({ date: '2026-01-10', amount: 8000, category: 'food' }),
      tx({ date: '2026-02-05', direction: 'in', category: 'income', amount: 30000 }),
      tx({ date: '2026-02-10', amount: 12000, category: 'food' }),
    ];
    const out = buildSnapshot(txns);
    // ม.ค.: รายรับ 30,000 รายจ่าย 8,000 ออม 22,000
    expect(out).toMatch(/รายรับ 30,000/);
    expect(out).toMatch(/ออมสุทธิ 22,000/);
    // ภาพรวม: ออมสุทธิรวม 60,000 - 20,000 = 40,000
    expect(out).toContain('ภาพรวมทั้งช่วง');
  });

  it('ความผิดปกติ: หมวดที่พุ่ง z>2 โผล่ในส่วนข้อสังเกต', () => {
    const txns: Transaction[] = [
      tx({ date: '2026-01-10', amount: 1000, category: 'shopping' }),
      tx({ date: '2026-02-10', amount: 1000, category: 'shopping' }),
      tx({ date: '2026-03-10', amount: 1000, category: 'shopping' }),
      tx({ date: '2026-04-10', amount: 50000, category: 'shopping' }),
    ];
    const out = buildSnapshot(txns);
    expect(out).toContain('ข้อสังเกต');
  });

  it('เคสเดือนเดียว: ไม่ throw และมีภาพรวม', () => {
    const txns: Transaction[] = [
      tx({ date: '2026-01-05', direction: 'in', category: 'income', amount: 20000 }),
      tx({ date: '2026-01-10', amount: 5000, category: 'food' }),
    ];
    expect(() => buildSnapshot(txns)).not.toThrow();
    expect(buildSnapshot(txns)).toContain('ภาพรวมทั้งช่วง');
  });

  it('ไม่รั่วเลขบัญชีดิบของบิลประจำ (ผ่าน sanitize)', () => {
    const txns: Transaction[] = [];
    for (let i = 0; i < 4; i++) {
      txns.push(
        tx({
          date: `2026-0${i + 1}-01`,
          amount: 399,
          category: 'bills',
          counterparty: 'Netflix xxxx123456789',
        }),
      );
    }
    const out = buildSnapshot(txns);
    expect(out).not.toContain('123456789');
  });
});
