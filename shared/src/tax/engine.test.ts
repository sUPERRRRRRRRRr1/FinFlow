import { describe, it, expect } from 'vitest';
import { RULES_2567 } from './rules2567.js';
import { progressiveTax, marginalRate, expenseDeduction } from './engine.js';
import type { IncomeItem } from './types.js';

describe('progressiveTax', () => {
  const b = RULES_2567.brackets;
  it('is zero up to the 150k exemption', () => {
    expect(progressiveTax(150000, b).tax).toBe(0);
  });
  it('taxes only the amount inside each bracket', () => {
    // 300,000 → 5% of (300k-150k) = 7,500
    expect(progressiveTax(300000, b).tax).toBeCloseTo(7500, 2);
  });
  it('stacks brackets correctly at 1,000,000', () => {
    // 7,500 + 10%*200k(20,000) + 15%*250k(37,500) + 20%*250k(50,000) = 115,000
    expect(progressiveTax(1000000, b).tax).toBeCloseTo(115000, 2);
  });
  it('reports the marginal rate of the top reached bracket', () => {
    expect(marginalRate(400000, b)).toBe(0.1);
    expect(marginalRate(6000000, b)).toBe(0.35);
  });
});

const inc = (type: IncomeItem['type'], amount: number): IncomeItem => ({ type, amount, source: 'user' });

describe('expenseDeduction', () => {
  it('caps 40(1)+(2) combined at 100,000', () => {
    expect(expenseDeduction([inc('40(1)', 1000000)], RULES_2567)).toBe(100000);
    // 40(1)=120k(→60k) + 40(2)=120k(→60k) but combined capped at 100k
    expect(expenseDeduction([inc('40(1)', 120000), inc('40(2)', 120000)], RULES_2567)).toBe(100000);
  });
  it('gives no deduction for 40(4) interest/dividends', () => {
    expect(expenseDeduction([inc('40(4)', 50000)], RULES_2567)).toBe(0);
  });
  it('applies 60% flat to 40(8)', () => {
    expect(expenseDeduction([inc('40(8)', 100000)], RULES_2567)).toBe(60000);
  });
});
