import { describe, it, expect } from 'vitest';
import type { Transaction } from '../types.js';
import { reconcileBalances, projectBalances } from './reconcile.js';

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: p.id ?? `t${seq++}`,
    date: p.date ?? '2026-06-01',
    amount: p.amount ?? 0,
    direction: p.direction ?? 'out',
    counterparty: p.counterparty ?? '-',
    source: p.source ?? 'kbank',
    category: p.category ?? 'other',
    ...p,
  };
}

describe('reconcileBalances — เงินเข้า/ออกที่อนุมานจากยอดคงเหลือ', () => {
  it('ตรวจไม่พบช่องว่างเมื่อยอดคงเหลือสอดคล้องกับทุกรายการ', () => {
    const txns = [
      tx({ id: 'a', account: 'A', direction: 'in', amount: 1000, balanceAfter: 1000, date: '2026-06-01' }),
      tx({ id: 'b', account: 'A', direction: 'out', amount: 200, balanceAfter: 800, date: '2026-06-02' }),
      tx({ id: 'c', account: 'A', direction: 'out', amount: 300, balanceAfter: 500, date: '2026-06-03' }),
    ];
    const r = reconcileBalances(txns);
    expect(r.flows).toHaveLength(0);
    expect(r.inferredIncome).toBe(0);
    expect(r.inferredExpense).toBe(0);
  });

  it('จับ "เงินเข้าที่ไม่มีสลิป" เมื่อยอดคงเหลือสูงกว่าที่รายการอธิบายได้', () => {
    // ระหว่าง b→c ยอดควรเป็น 800−300=500 แต่จริง 1,500 → มีเงินเข้า 1,000 ที่ไม่มีหลักฐาน
    const txns = [
      tx({ id: 'a', account: 'A', direction: 'in', amount: 1000, balanceAfter: 1000, date: '2026-06-01' }),
      tx({ id: 'b', account: 'A', direction: 'out', amount: 200, balanceAfter: 800, date: '2026-06-02' }),
      tx({ id: 'c', account: 'A', direction: 'out', amount: 300, balanceAfter: 1500, date: '2026-06-10' }),
    ];
    const r = reconcileBalances(txns);
    expect(r.external).toHaveLength(1);
    const f = r.external[0]!;
    expect(f.direction).toBe('in');
    expect(f.amount).toBe(1000);
    expect(f.afterId).toBe('b'); // ขอบเวลา: หลัง b
    expect(f.beforeId).toBe('c'); // ก่อน/ถึง c
    expect(r.inferredIncome).toBe(1000);
  });

  it('นับรายการที่ไม่มี balanceAfter (เช่น สลิป) ที่อยู่ระหว่าง anchor ด้วย', () => {
    // มีสลิปจ่าย 100 ระหว่าง a→c : 1000 −100(สลิป) −300(c) = 600 = ยอดจริง → ไม่มีช่องว่าง
    const txns = [
      tx({ id: 'a', account: 'A', direction: 'in', amount: 1000, balanceAfter: 1000, date: '2026-06-01' }),
      tx({ id: 'slip', account: 'A', source: 'slip', direction: 'out', amount: 100, date: '2026-06-02' }),
      tx({ id: 'c', account: 'A', direction: 'out', amount: 300, balanceAfter: 600, date: '2026-06-03' }),
    ];
    expect(reconcileBalances(txns).flows).toHaveLength(0);
  });

  it('ไม่รายงานช่วงก่อน anchor แรก (ยังไม่รู้ยอดตั้งต้น)', () => {
    const txns = [
      tx({ id: 'a', account: 'A', direction: 'out', amount: 50, date: '2026-06-01' }), // ไม่มี balanceAfter
      tx({ id: 'b', account: 'A', direction: 'out', amount: 200, balanceAfter: 800, date: '2026-06-02' }),
    ];
    expect(reconcileBalances(txns).flows).toHaveLength(0);
  });

  it('ทำเครื่องหมาย likelyTransfer เมื่อขาออก↔ขาเข้า จำนวนใกล้กัน เวลาใกล้กัน', () => {
    // A: ออก 5,000 ที่ไม่มีหลักฐาน · B: เข้า 5,000 ที่ไม่มีหลักฐาน วันเดียวกัน → ย้ายระหว่างบัญชีตัวเอง
    const txns = [
      tx({ id: 'a1', account: 'A', direction: 'in', amount: 100, balanceAfter: 6000, date: '2026-06-01' }),
      tx({ id: 'a2', account: 'A', direction: 'in', amount: 0, balanceAfter: 1000, date: '2026-06-05' }), // ยอดหาย 5000
      tx({ id: 'b1', account: 'B', direction: 'in', amount: 100, balanceAfter: 200, date: '2026-06-01' }),
      tx({ id: 'b2', account: 'B', direction: 'in', amount: 0, balanceAfter: 5200, date: '2026-06-05' }), // ยอดเพิ่ม 5000
    ];
    const r = reconcileBalances(txns);
    expect(r.flows).toHaveLength(2);
    expect(r.flows.every((f) => f.likelyTransfer)).toBe(true);
    expect(r.external).toHaveLength(0); // หักโอนตัวเองออกแล้ว ไม่เหลือเงินภายนอก
    expect(r.inferredIncome).toBe(0);
    expect(r.inferredExpense).toBe(0);
  });
});

describe('projectBalances — ยอดเรียลไทม์จากการโอนข้ามบัญชี', () => {
  it('โอนเข้าบัญชีออมหลัง anchor → ยอดออมเพิ่มทันที (ยังไม่ต้องมี statement ฝั่งออม)', () => {
    const txns = [
      // บัญชีออม SAV: รู้ยอดจริงล่าสุด 1,000 ณ 1 มิ.ย.
      tx({ id: 's0', account: 'SAV', direction: 'in', amount: 0, balanceAfter: 1000, date: '2026-06-01' }),
      // บัญชีหลัก: "โอนไป SAV" 500 วันที่ 5 มิ.ย. (รู้จากฝั่งต้นทาง ยังไม่จับคู่)
      tx({ id: 'd1', account: 'MAIN', direction: 'out', amount: 500, transferTo: 'SAV', date: '2026-06-05' }),
    ];
    const p = projectBalances(txns).get('SAV')!;
    expect(p.anchorBalance).toBe(1000);
    expect(p.pendingNet).toBe(500);
    expect(p.projected).toBe(1500); // ออม = 1,000 + 500 ที่เพิ่งโอนเข้า
  });

  it('โอนออกจากบัญชีออม (อีกบัญชีรับเข้าจากออม) → ยอดออมลด', () => {
    const txns = [
      tx({ id: 's0', account: 'SAV', direction: 'in', amount: 0, balanceAfter: 1000, date: '2026-06-01' }),
      // บัญชีหลัก "รับโอนจาก SAV" 300 → เงินออกจากออม
      tx({ id: 'd1', account: 'MAIN', direction: 'in', amount: 300, transferTo: 'SAV', date: '2026-06-05' }),
    ];
    expect(projectBalances(txns).get('SAV')!.projected).toBe(700);
  });

  it('ไม่นับการโอนที่เกิด "ก่อน" anchor (สะท้อนในยอดจริงแล้ว) — กันนับซ้ำ', () => {
    const txns = [
      tx({ id: 'd1', account: 'MAIN', direction: 'out', amount: 500, transferTo: 'SAV', date: '2026-06-01' }),
      tx({ id: 's0', account: 'SAV', direction: 'in', amount: 0, balanceAfter: 1000, date: '2026-06-10' }), // anchor ทีหลัง
    ];
    const p = projectBalances(txns).get('SAV')!;
    expect(p.pendingNet).toBe(0);
    expect(p.projected).toBe(1000);
  });
});
