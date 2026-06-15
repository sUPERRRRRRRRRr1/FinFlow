import type { Transaction } from '../types.js';
import { diffDays } from './dates.js';

export interface TransferMatch {
  outId: string;
  inId: string;
  amount: number;
  fromSource: string;
  toSource: string;
  group: string;
}

export interface TransferResult {
  /** ธุรกรรมที่ตั้งธง isTransfer/transferGroup แล้ว */
  tagged: Transaction[];
  matches: TransferMatch[];
}

/**
 * จับคู่การโอนระหว่างกระเป๋าตัวเอง:
 *  มองหา รายการ "ออก" จากกระเป๋า A ที่มี รายการ "เข้า" กระเป๋า B
 *  ด้วยจำนวนเงินเท่ากัน (±amountTol) ภายในกรอบเวลา dayWindow และคนละกระเป๋า
 *  คู่ที่จับได้จะถูกตั้ง isTransfer=true เพื่อไม่ให้นับเป็นรายรับ/รายจ่ายซ้ำ
 */
export function matchTransfers(
  txns: Transaction[],
  opts: { dayWindow?: number; amountTol?: number } = {},
): TransferResult {
  const { dayWindow = 1, amountTol = 1 } = opts;
  const tagged = txns.map((t) => ({ ...t }));
  const matches: TransferMatch[] = [];
  const usedIn = new Set<number>();

  const outs = tagged
    .map((t, i) => ({ t, i }))
    .filter((x) => x.t.direction === 'out');
  const ins = tagged
    .map((t, i) => ({ t, i }))
    .filter((x) => x.t.direction === 'in');

  let group = 0;
  for (const o of outs) {
    let best = -1;
    let bestGap = Infinity;
    for (const inc of ins) {
      if (usedIn.has(inc.i)) continue;
      if (inc.t.source === o.t.source) continue; // ต้องคนละกระเป๋า
      if (Math.abs(inc.t.amount - o.t.amount) > amountTol) continue;
      const gap = Math.abs(diffDays(o.t.date, inc.t.date));
      if (gap > dayWindow) continue;
      if (gap < bestGap) {
        best = inc.i;
        bestGap = gap;
      }
    }
    if (best >= 0) {
      usedIn.add(best);
      const g = `xfer-${group++}`;
      const outTx = tagged[o.i]!;
      const inTx = tagged[best]!;
      outTx.isTransfer = true;
      outTx.transferGroup = g;
      outTx.category = 'transfer';
      inTx.isTransfer = true;
      inTx.transferGroup = g;
      inTx.category = 'transfer';
      matches.push({
        outId: outTx.id,
        inId: inTx.id,
        amount: outTx.amount,
        fromSource: outTx.source,
        toSource: inTx.source,
        group: g,
      });
    }
  }

  return { tagged, matches };
}
