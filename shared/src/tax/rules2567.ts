import type { TaxRules, IncomeType, ExpenseRule } from './types.js';

const expense: Record<IncomeType, ExpenseRule> = {
  '40(1)': { rate: 0.5, cap: 100000 },
  '40(2)': { rate: 0.5, cap: 100000 },
  '40(3)': { rate: 0.5, cap: 100000 },
  '40(4)': { rate: 0 },
  '40(5)': { rate: 0.3 },
  '40(6)': { rate: 0.3 },
  '40(7)': { rate: 0.6 },
  '40(8)': { rate: 0.6 },
};

export const RULES_2567: TaxRules = {
  year: 2567,
  brackets: [
    { from: 0, to: 150000, rate: 0 },
    { from: 150000, to: 300000, rate: 0.05 },
    { from: 300000, to: 500000, rate: 0.1 },
    { from: 500000, to: 750000, rate: 0.15 },
    { from: 750000, to: 1000000, rate: 0.2 },
    { from: 1000000, to: 2000000, rate: 0.25 },
    { from: 2000000, to: 5000000, rate: 0.3 },
    { from: 5000000, to: Infinity, rate: 0.35 },
  ],
  expense,
  employmentCombinedCap: 100000,
  personalAllowance: 60000,
  spouseAllowance: 60000,
  childAllowance: 30000,
  childSecondAllowance: 60000,
  parentAllowance: 30000,
  parentMaxCount: 4,
  disabledAllowance: 60000,
  maternityCap: 60000,
  socialSecurityCap: 9000,
  lifeHealthCap: 100000,
  healthSubCap: 25000,
  parentHealthCap: 15000,
  pensionInsRate: 0.15,
  pensionInsCap: 200000,
  providentRate: 0.15,
  rmfRate: 0.3,
  rmfCap: 500000,
  ssfRate: 0.3,
  ssfCap: 200000,
  nsfCap: 30000,
  retirementCombinedCap: 500000,
  thaiEsgRate: 0.3,
  thaiEsgCap: 300000,
  homeLoanCap: 100000,
  donationRateCap: 0.1,
  easyEReceiptCap: 50000,
  minTaxThreshold: 120000,
  minTaxRate: 0.005,
  minTaxExemptBelow: 5000,
  filing: { salarySingle: 120000, salaryMarried: 220000, otherSingle: 60000, otherMarried: 120000 },
  dividendWhtRate: 0.1,
  interestWhtRate: 0.15,
  freelanceWhtRate: 0.03,
};

export const RULES_BY_YEAR: Record<number, TaxRules> = { 2567: RULES_2567 };

/** คืน ruleset ของปีภาษีที่ขอ (fallback = ปีล่าสุดที่รองรับ) */
export function getRules(year: number): TaxRules {
  return RULES_BY_YEAR[year] ?? RULES_2567;
}
