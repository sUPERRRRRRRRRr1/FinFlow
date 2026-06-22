import type { Bracket, BracketDetail } from './types.js';

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
