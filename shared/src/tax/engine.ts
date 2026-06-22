import type { Bracket, BracketDetail, IncomeItem, IncomeType, TaxRules, Deductions, AllowanceLine, TaxProfile, TaxResult, FilingInfo } from './types.js';

/** ภาษีวิธีขั้นบันได: เก็บภาษีเฉพาะส่วนที่อยู่ในแต่ละขั้น */
export function progressiveTax(netIncome: number, brackets: Bracket[]): { tax: number; brackets: BracketDetail[] } {
  const detail: BracketDetail[] = [];
  let tax = 0;
  for (const br of brackets) {
    if (netIncome <= br.from) break;
    const taxable = Math.min(netIncome, br.to) - br.from;
    const bracketTax = taxable * br.rate;
    tax += bracketTax;
    detail.push({ from: br.from, to: br.to, rate: br.rate, taxable, tax: bracketTax });
  }
  return { tax, brackets: detail };
}

/** อัตราภาษีขั้นสุดท้าย (marginal) ที่เงินได้สุทธินี้ไปถึง */
export function marginalRate(netIncome: number, brackets: Bracket[]): number {
  let rate = 0;
  for (const br of brackets) {
    if (netIncome > br.from) rate = br.rate;
    else break;
  }
  return rate;
}

export function sumByType(income: IncomeItem[]): Partial<Record<IncomeType, number>> {
  const out: Partial<Record<IncomeType, number>> = {};
  for (const i of income) out[i.type] = (out[i.type] ?? 0) + i.amount;
  return out;
}

export function computeAllowances(
  d: Deductions,
  grossTaxable: number,
  incomeAfterExpense: number,
  rules: TaxRules,
): { total: number; breakdown: AllowanceLine[] } {
  const lines: AllowanceLine[] = [];
  const push = (id: string, label: string, used: number, cap: number, ref: string) => {
    if (used > 0) lines.push({ id, label, used: Math.round(used), cap: Math.round(cap), ref });
  };

  push('personal', 'ส่วนตัว', rules.personalAllowance, rules.personalAllowance, 'ม.47(1)(ก)');
  if (d.spouse) push('spouse', 'คู่สมรส', rules.spouseAllowance, rules.spouseAllowance, 'ม.47(1)(ข)');

  const children = d.children * rules.childAllowance + d.childrenSecondChildPlus * rules.childSecondAllowance;
  push('children', 'บุตร', children, children, 'ม.47(1)(ค)');

  const parents = Math.min(d.parents, rules.parentMaxCount) * rules.parentAllowance;
  push('parents', 'บิดามารดา', parents, rules.parentMaxCount * rules.parentAllowance, 'ม.47(1)(ญ)');

  push('disabled', 'ผู้พิการ/ทุพพลภาพ', d.disabled * rules.disabledAllowance, d.disabled * rules.disabledAllowance, 'ม.47(1)(ฎ)');
  push('maternity', 'ฝากครรภ์/คลอดบุตร', Math.min(d.maternity, rules.maternityCap), rules.maternityCap, 'กฎกระทรวง');
  push('socialSecurity', 'ประกันสังคม', Math.min(d.socialSecurity, rules.socialSecurityCap), rules.socialSecurityCap, 'ม.47(1)(ฌ)');

  const health = Math.min(d.healthInsurance, rules.healthSubCap);
  const lifeHealth = Math.min(d.lifeInsurance + health, rules.lifeHealthCap);
  push('lifeHealth', 'ประกันชีวิต+สุขภาพ', lifeHealth, rules.lifeHealthCap, 'ม.47(1)(ง) + ประกาศอธิบดี');
  push('parentHealth', 'ประกันสุขภาพบิดามารดา', Math.min(d.parentHealthInsurance, rules.parentHealthCap), rules.parentHealthCap, 'ประกาศอธิบดี');

  // กลุ่มเกษียณ: cap แต่ละตัวก่อน แล้วรวมไม่เกิน retirementCombinedCap
  const pension = Math.min(d.pensionInsurance, Math.min(rules.pensionInsRate * grossTaxable, rules.pensionInsCap));
  const pvd = Math.min(d.providentFund, rules.providentRate * grossTaxable);
  const rmf = Math.min(d.rmf, Math.min(rules.rmfRate * grossTaxable, rules.rmfCap));
  const ssf = Math.min(d.ssf, Math.min(rules.ssfRate * grossTaxable, rules.ssfCap));
  const nsf = Math.min(d.nsf, rules.nsfCap);
  const retirement = Math.min(pension + pvd + rmf + ssf + nsf, rules.retirementCombinedCap);
  push('retirement', 'กองทุนเกษียณ (PVD/RMF/SSF/บำนาญ/กอช.)', retirement, rules.retirementCombinedCap, 'รวมไม่เกิน 500,000');

  const thaiEsg = Math.min(d.thaiEsg, Math.min(rules.thaiEsgRate * grossTaxable, rules.thaiEsgCap));
  push('thaiEsg', 'Thai ESG', thaiEsg, rules.thaiEsgCap, 'พ.ร.ฎ. (แยกจากเพดานเกษียณ)');

  push('homeLoan', 'ดอกเบี้ยกู้ซื้อบ้าน', Math.min(d.homeLoanInterest, rules.homeLoanCap), rules.homeLoanCap, 'ม.47(1)(ซ)');

  // เงินบริจาค: รวมไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่ายและค่าลดหย่อนอื่น
  const beforeDonation = lines.reduce((a, l) => a + l.used, 0);
  const donationBase = Math.max(0, incomeAfterExpense - beforeDonation);
  const donationRaw = d.donationEducation * 2 + d.donationGeneral;
  const donation = Math.min(donationRaw, rules.donationRateCap * donationBase);
  push('donation', 'เงินบริจาค', donation, rules.donationRateCap * donationBase, 'ม.47(7) (≤10%)');

  push('easyEReceipt', 'Easy E-Receipt', Math.min(d.easyEReceipt, rules.easyEReceiptCap), rules.easyEReceiptCap, 'มาตรการกระตุ้น');

  const total = lines.reduce((a, l) => a + l.used, 0);
  return { total, breakdown: lines };
}

/** หักค่าใช้จ่ายตามประเภทเงินได้ — 40(1)+(2) ใช้เพดานรวมเดียว */
export function expenseDeduction(income: IncomeItem[], rules: TaxRules): number {
  const by = sumByType(income);
  let total = 0;
  // 40(1)+(2): เหมา 50% รวมกันไม่เกิน employmentCombinedCap
  const employment = (by['40(1)'] ?? 0) + (by['40(2)'] ?? 0);
  total += Math.min(employment * rules.expense['40(1)'].rate, rules.employmentCombinedCap);
  // ประเภทอื่น: ใช้ rate/cap ของตัวเอง
  for (const t of ['40(3)', '40(4)', '40(5)', '40(6)', '40(7)', '40(8)'] as IncomeType[]) {
    const gross = by[t] ?? 0;
    const rule = rules.expense[t];
    const deduct = rule.cap != null ? Math.min(gross * rule.rate, rule.cap) : gross * rule.rate;
    total += deduct;
  }
  return total;
}

// ─── Task 4: computeTax, filingInfo, defaultTaxProfile ───────────────────────

const EMPTY_DEDUCTIONS: Deductions = {
  spouse: false, children: 0, childrenSecondChildPlus: 0, parents: 0, disabled: 0, maternity: 0,
  socialSecurity: 0, lifeInsurance: 0, healthInsurance: 0, parentHealthInsurance: 0, pensionInsurance: 0,
  providentFund: 0, rmf: 0, ssf: 0, thaiEsg: 0, nsf: 0,
  homeLoanInterest: 0, donationGeneral: 0, donationEducation: 0, easyEReceipt: 0,
};

export function defaultTaxProfile(year: number): TaxProfile {
  return { taxYear: year, married: false, income: [], deductions: { ...EMPTY_DEDUCTIONS }, dividendMode: 'final', annualize: true };
}

/** เงินได้ที่นำมาคำนวณ (ตัดปันผลที่เลือก final ออก) */
function taxableIncome(profile: TaxProfile): IncomeItem[] {
  return profile.income.filter((i) => !(i.dividend && profile.dividendMode === 'final'));
}

export function computeTax(profile: TaxProfile, rules: TaxRules): TaxResult {
  const income = taxableIncome(profile);
  const grossByType = sumByType(income);
  const grossTaxable = income.reduce((a, i) => a + i.amount, 0);

  const expense = expenseDeduction(income, rules);
  const incomeAfterExpense = Math.max(0, grossTaxable - expense);
  const { total: totalAllowances, breakdown } = computeAllowances(
    profile.deductions,
    grossTaxable,
    incomeAfterExpense,
    rules,
  );

  const netIncome = Math.max(0, incomeAfterExpense - totalAllowances);
  const prog = progressiveTax(netIncome, rules.brackets);

  // วิธีภาษีขั้นต่ำ 0.5%: เงินได้พึงประเมิน 40(2)-(8) รวม ≥ threshold
  const otherIncome = (Object.entries(grossByType) as [IncomeType, number][])
    .filter(([t]) => t !== '40(1)')
    .reduce((a, [, v]) => a + v, 0);
  let minimumTax = 0;
  if (otherIncome >= rules.minTaxThreshold) {
    const m = otherIncome * rules.minTaxRate;
    if (m > rules.minTaxExemptBelow) minimumTax = m;
  }

  const taxBeforeCredit = Math.max(prog.tax, minimumTax);
  const withholdingCredit = income.reduce((a, i) => a + (i.withholding ?? 0), 0);
  const taxDue = taxBeforeCredit - withholdingCredit;

  return {
    taxYear: profile.taxYear,
    grossTaxable: Math.round(grossTaxable),
    grossByType,
    expenseDeduction: Math.round(expense),
    totalAllowances: Math.round(totalAllowances),
    allowanceBreakdown: breakdown,
    netIncome: Math.round(netIncome),
    progressiveTax: Math.round(prog.tax),
    minimumTax: Math.round(minimumTax),
    taxBeforeCredit: Math.round(taxBeforeCredit),
    withholdingCredit: Math.round(withholdingCredit),
    taxDue: Math.round(taxDue),
    effectiveRate: grossTaxable > 0 ? taxBeforeCredit / grossTaxable : 0,
    marginalRate: marginalRate(netIncome, rules.brackets),
    brackets: prog.brackets,
  };
}

export function filingInfo(profile: TaxProfile, result: TaxResult, rules: TaxRules): FilingInfo {
  const hasOther = Object.keys(result.grossByType).some((t) => t !== '40(1)');
  const threshold = hasOther
    ? profile.married ? rules.filing.otherMarried : rules.filing.otherSingle
    : profile.married ? rules.filing.salaryMarried : rules.filing.salarySingle;
  const fy = profile.taxYear + 1;
  return {
    mustFile: result.grossTaxable > threshold,
    form: hasOther ? 'ภ.ง.ด.90' : 'ภ.ง.ด.91',
    deadlinePaper: `31 มี.ค. ${fy}`,
    deadlineOnline: `~8 เม.ย. ${fy}`,
    refundable: result.taxDue < 0 ? -result.taxDue : 0,
  };
}
