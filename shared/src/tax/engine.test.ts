import { describe, it, expect } from 'vitest';
import { RULES_2567 } from './rules2567.js';
import { progressiveTax, marginalRate, expenseDeduction, computeAllowances, computeTax, filingInfo, defaultTaxProfile, suggestSavings } from './engine.js';
import type { IncomeItem, Deductions, TaxProfile } from './types.js';

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

const emptyDed: Deductions = {
  spouse: false, children: 0, childrenSecondChildPlus: 0, parents: 0, disabled: 0, maternity: 0,
  socialSecurity: 0, lifeInsurance: 0, healthInsurance: 0, parentHealthInsurance: 0, pensionInsurance: 0,
  providentFund: 0, rmf: 0, ssf: 0, thaiEsg: 0, nsf: 0,
  homeLoanInterest: 0, donationGeneral: 0, donationEducation: 0, easyEReceipt: 0,
};

describe('computeAllowances', () => {
  it('always includes the 60,000 personal allowance', () => {
    expect(computeAllowances(emptyDed, 500000, 400000, RULES_2567).total).toBe(60000);
  });
  it('caps combined retirement funds at 500,000', () => {
    const d = { ...emptyDed, rmf: 500000, ssf: 200000, providentFund: 500000 };
    // each individually capped, then combined clipped to 500k; +60k personal
    expect(computeAllowances(d, 5000000, 4000000, RULES_2567).total).toBe(560000);
  });
  it('caps SSF at 30% of income and 200,000', () => {
    const d = { ...emptyDed, ssf: 200000 };
    // income 400k → 30% = 120k is the binding cap
    const r = computeAllowances(d, 400000, 300000, RULES_2567);
    const ssf = r.breakdown.find((x) => x.id === 'retirement')!;
    expect(ssf.used).toBe(120000);
  });
  it('limits donations to 10% of income after other allowances', () => {
    const d = { ...emptyDed, donationGeneral: 100000 };
    // after-expense 300k, minus 60k personal = 240k base → 10% = 24,000
    const r = computeAllowances(d, 400000, 300000, RULES_2567);
    const don = r.breakdown.find((x) => x.id === 'donation')!;
    expect(don.used).toBe(24000);
  });
});

const baseProfile = (over: Partial<TaxProfile> = {}): TaxProfile => ({
  ...defaultTaxProfile(2567),
  ...over,
});

describe('computeTax', () => {
  it('salary 600k, only personal allowance → expected PIT', () => {
    const p = baseProfile({ income: [{ type: '40(1)', amount: 600000, source: 'user' }] });
    const r = computeTax(p, RULES_2567);
    // expense 100k, allowance 60k → net 440,000
    expect(r.netIncome).toBe(440000);
    // 5%*150k(7,500) + 10%*140k(14,000) = 21,500
    expect(r.taxBeforeCredit).toBeCloseTo(21500, 0);
  });

  it('subtracts WHT credit and reports a refund as negative taxDue', () => {
    const p = baseProfile({ income: [{ type: '40(1)', amount: 600000, withholding: 30000, source: 'user' }] });
    const r = computeTax(p, RULES_2567);
    expect(r.withholdingCredit).toBe(30000);
    expect(r.taxDue).toBeCloseTo(21500 - 30000, 0); // -8,500 = ขอคืน
  });

  it('applies the 0.5% minimum-tax method when 40(2)-(8) ≥ 120k and it exceeds the progressive tax', () => {
    // 40(8) 3,000,000, 60% expense → 1.2m, minus 60k personal = net 1,140,000
    const p = baseProfile({ income: [{ type: '40(8)', amount: 3000000, source: 'user' }] });
    const r = computeTax(p, RULES_2567);
    // min tax = 0.5% * 3,000,000 = 15,000 (> 5,000 floor); progressive on 1.14m is larger → progressive wins
    expect(r.minimumTax).toBe(15000);
    expect(r.taxBeforeCredit).toBe(Math.max(r.progressiveTax, r.minimumTax));
  });

  it('excludes final-tax dividends from the taxable base', () => {
    const p = baseProfile({
      dividendMode: 'final',
      income: [{ type: '40(4)', amount: 100000, withholding: 10000, dividend: true, source: 'user' }],
    });
    const r = computeTax(p, RULES_2567);
    expect(r.grossTaxable).toBe(0);
    expect(r.withholdingCredit).toBe(0);
  });
});

describe('filingInfo', () => {
  it('flags ภ.ง.ด.91 for salary-only above 120k single', () => {
    const p = baseProfile({ income: [{ type: '40(1)', amount: 200000, source: 'user' }] });
    const f = filingInfo(p, computeTax(p, RULES_2567), RULES_2567);
    expect(f.mustFile).toBe(true);
    expect(f.form).toBe('ภ.ง.ด.91');
  });
});

describe('suggestSavings', () => {
  it('estimates SSF room × marginal rate and respects the cap', () => {
    const p = baseProfile({ income: [{ type: '40(1)', amount: 1200000, source: 'user' }] });
    const r = computeTax(p, RULES_2567);
    const s = suggestSavings(p, RULES_2567, r);
    const ssf = s.find((x) => x.id === 'ssf')!;
    expect(ssf.room).toBe(200000); // min(30%*1.2m=360k, 200k cap), nothing used
    expect(ssf.estimatedSaving).toBeCloseTo(200000 * r.marginalRate, 0);
  });

  it('returns nothing actionable when marginal rate is 0', () => {
    const p = baseProfile({ income: [{ type: '40(1)', amount: 200000, source: 'user' }] });
    const r = computeTax(p, RULES_2567); // net below 150k → marginal 0
    expect(suggestSavings(p, RULES_2567, r)).toHaveLength(0);
  });
});
