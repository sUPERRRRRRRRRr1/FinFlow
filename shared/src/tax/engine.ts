import type { Bracket, BracketDetail, IncomeItem, IncomeType, TaxRules } from './types.js';

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
