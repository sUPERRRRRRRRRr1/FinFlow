export interface Bracket {
  from: number;
  to: number;
  rate: number;
}

export interface BracketDetail extends Bracket {
  taxable: number;
  tax: number;
}

export type IncomeType =
  | '40(1)'
  | '40(2)'
  | '40(3)'
  | '40(4)'
  | '40(5)'
  | '40(6)'
  | '40(7)'
  | '40(8)';

export interface IncomeItem {
  type: IncomeType;
  amount: number;
  source: string;
}

export interface ExpenseRule {
  rate: number;
  cap?: number;
}

export interface TaxRules {
  year: number;
  brackets: Bracket[];
  expense: Record<IncomeType, ExpenseRule>;
  employmentCombinedCap: number;
  personalAllowance: number;
  spouseAllowance: number;
  childAllowance: number;
  childSecondAllowance: number;
  parentAllowance: number;
  parentMaxCount: number;
  disabledAllowance: number;
  maternityCap: number;
  socialSecurityCap: number;
  lifeHealthCap: number;
  healthSubCap: number;
  parentHealthCap: number;
  pensionInsRate: number;
  pensionInsCap: number;
  providentRate: number;
  rmfRate: number;
  rmfCap: number;
  ssfRate: number;
  ssfCap: number;
  nsfCap: number;
  retirementCombinedCap: number;
  thaiEsgRate: number;
  thaiEsgCap: number;
  homeLoanCap: number;
  donationRateCap: number;
  easyEReceiptCap: number;
  minTaxThreshold: number;
  minTaxRate: number;
  minTaxExemptBelow: number;
  filing: { salarySingle: number; salaryMarried: number; otherSingle: number; otherMarried: number };
  dividendWhtRate: number;
  interestWhtRate: number;
  freelanceWhtRate: number;
}

export interface Deductions {
  spouse: boolean;
  children: number;
  childrenSecondChildPlus: number;
  parents: number;
  disabled: number;
  maternity: number;
  socialSecurity: number;
  lifeInsurance: number;
  healthInsurance: number;
  parentHealthInsurance: number;
  pensionInsurance: number;
  providentFund: number;
  rmf: number;
  ssf: number;
  thaiEsg: number;
  nsf: number;
  homeLoanInterest: number;
  donationGeneral: number;
  donationEducation: number;
  easyEReceipt: number;
}

export interface AllowanceLine {
  id: string;
  label: string;
  used: number;
  cap: number;
  ref: string;
}
