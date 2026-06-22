// Canonical tax type contract for the FinFlow Thai income-tax engine.
// Defined once here; engine.ts / detect.ts / server / client all import from this file.

export type IncomeType = '40(1)' | '40(2)' | '40(3)' | '40(4)' | '40(5)' | '40(6)' | '40(7)' | '40(8)';

export interface IncomeItem {
  type: IncomeType;
  amount: number; // เงินได้ทั้งปี (บาท)
  withholding?: number; // WHT ที่ถูกหักไว้ (บาท)
  dividend?: boolean; // true = เงินปันผล (มีผลกับ dividendMode)
  source: 'detected' | 'user';
  note?: string;
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

export type DividendMode = 'final' | 'include';

export interface TaxProfile {
  taxYear: number;
  married: boolean;
  income: IncomeItem[];
  deductions: Deductions;
  dividendMode: DividendMode;
  annualize: boolean;
}

export interface Bracket {
  from: number;
  to: number;
  rate: number;
}

export interface ExpenseRule {
  rate: number;
  cap?: number;
}

export interface TaxRules {
  year: number;
  brackets: Bracket[];
  expense: Record<IncomeType, ExpenseRule>;
  employmentCombinedCap: number; // 40(1)+(2) รวม cap 100,000
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

export interface BracketDetail extends Bracket {
  taxable: number;
  tax: number;
}

export interface AllowanceLine {
  id: string;
  label: string;
  used: number;
  cap: number;
  ref: string;
}

export interface TaxResult {
  taxYear: number;
  grossTaxable: number;
  grossByType: Partial<Record<IncomeType, number>>;
  expenseDeduction: number;
  totalAllowances: number;
  allowanceBreakdown: AllowanceLine[];
  netIncome: number;
  progressiveTax: number;
  minimumTax: number;
  taxBeforeCredit: number;
  withholdingCredit: number;
  taxDue: number; // >0 ต้องจ่ายเพิ่ม, <0 ขอคืน
  effectiveRate: number;
  marginalRate: number;
  brackets: BracketDetail[];
}

export interface SavingSuggestion {
  id: string;
  label: string;
  used: number;
  cap: number;
  room: number;
  estimatedSaving: number;
  ref: string;
}

export interface FilingInfo {
  mustFile: boolean;
  form: 'ภ.ง.ด.90' | 'ภ.ง.ด.91';
  deadlinePaper: string;
  deadlineOnline: string;
  refundable: number;
}

export interface TaxOverview {
  result: TaxResult;
  suggestions: SavingSuggestion[];
  filing: FilingInfo;
  vatPaidEstimate: number; // 7/107 ของยอดบริโภคในช่วง (เชิงข้อมูล)
  dataMonths: number;
  annualized: boolean;
}
