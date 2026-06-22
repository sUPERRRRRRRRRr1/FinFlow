import type { Transaction } from '../types.js';
import { isRealIncome } from '../stats/timeseries.js';
import { monthKey } from '../stats/dates.js';
import { RULES_2567 } from './rules2567.js';
import type { IncomeItem } from './types.js';

const SALARY_RE = /เงินเดือน|payroll|salary/i;
const INTEREST_RE = /ดอกเบี้ย|interest/i;
const DIVIDEND_RE = /ปันผล|dividend/i;

/** จำนวนเดือน (inclusive) ที่ข้อมูลครอบคลุม */
export function dataMonths(txns: Transaction[]): number {
  if (txns.length === 0) return 1;
  const keys = txns.map((t) => monthKey(t.date)).sort();
  const [fy, fm] = keys[0]!.split('-').map(Number);
  const [ly, lm] = keys[keys.length - 1]!.split('-').map(Number);
  return Math.max(1, (ly - fy) * 12 + (lm - fm) + 1);
}

/**
 * เดาเงินได้แยกประเภทจากธุรกรรม (รายรับจริงเท่านั้น)
 *  - เงินเดือน/payroll → 40(1)
 *  - ดอกเบี้ย → 40(4) + WHT 15% (ประมาณ)
 *  - ปันผล → 40(4) dividend + WHT 10% (ประมาณ)
 * ถ้า annualize และข้อมูล < 12 เดือน คูณ (12/เดือน) เพื่อประมาณทั้งปี
 */
export function detectIncome(txns: Transaction[], opts: { annualize: boolean }): IncomeItem[] {
  const r = RULES_2567;
  const months = dataMonths(txns);
  const factor = opts.annualize && months < 12 ? 12 / months : 1;
  let salary = 0, interest = 0, dividend = 0;
  for (const t of txns) {
    if (!isRealIncome(t)) continue;
    const text = `${t.counterparty} ${t.rawDesc ?? ''}`;
    if (DIVIDEND_RE.test(text)) dividend += t.amount;
    else if (INTEREST_RE.test(text)) interest += t.amount;
    else if (SALARY_RE.test(text)) salary += t.amount;
  }
  const items: IncomeItem[] = [];
  const round = (n: number) => Math.round(n * factor);
  if (salary > 0) items.push({ type: '40(1)', amount: round(salary), source: 'detected', note: 'เดาจากเงินเดือน' });
  if (interest > 0) items.push({ type: '40(4)', amount: round(interest), withholding: Math.round(round(interest) * r.interestWhtRate), source: 'detected', note: 'เดาจากดอกเบี้ย' });
  if (dividend > 0) items.push({ type: '40(4)', amount: round(dividend), withholding: Math.round(round(dividend) * r.dividendWhtRate), dividend: true, source: 'detected', note: 'เดาจากเงินปันผล' });
  return items;
}
