import { describe, it, expect } from 'vitest';
import type { Transaction } from '../types.js';
import { detectIncome, dataMonths } from './detect.js';

let seq = 0;
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${seq++}`, date: p.date ?? '2025-01-01', amount: p.amount ?? 0,
  direction: p.direction ?? 'in', counterparty: p.counterparty ?? '', source: p.source ?? 'kbank',
  category: p.category ?? 'income', ...p,
});

describe('detectIncome', () => {
  it('detects salary as 40(1) and annualizes a 6-month window', () => {
    const txns = [
      tx({ counterparty: 'บริษัท เงินเดือน', amount: 50000, date: '2025-01-25', category: 'income' }),
      tx({ counterparty: 'บริษัท เงินเดือน', amount: 50000, date: '2025-06-25', category: 'income' }),
    ];
    const items = detectIncome(txns, { annualize: true });
    const salary = items.find((i) => i.type === '40(1)')!;
    // 100,000 over 6 months (Jan..Jun) → ×(12/6) = 200,000
    expect(salary.amount).toBe(200000);
    expect(salary.source).toBe('detected');
  });

  it('detects interest as 40(4) with 15% estimated WHT', () => {
    const txns = [tx({ counterparty: 'ดอกเบี้ยเงินฝาก', amount: 1000, date: '2025-03-01', category: 'income' })];
    const items = detectIncome(txns, { annualize: false });
    const interest = items.find((i) => i.type === '40(4)')!;
    expect(interest.amount).toBe(1000);
    expect(interest.withholding).toBe(150);
  });

  it('dataMonths counts inclusive month span', () => {
    expect(dataMonths([tx({ date: '2025-01-10' }), tx({ date: '2025-06-20' })])).toBe(6);
  });
});
