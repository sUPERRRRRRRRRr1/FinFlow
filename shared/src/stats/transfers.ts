import type { Transaction, AccountKind, CategoryId } from '../types.js';
import { walletKey } from '../types.js';
import { diffDays } from './dates.js';

/** 4 ตัวท้ายของเลขบัญชี (ตัวเลขล้วน) — STM/สลิปปิดบังเลขบัญชีเป็น "X####" ด้วย 4 ตัวท้ายนี้ */
export function accountLast4(accountId: string): string | null {
  const digits = accountId.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export interface OwnAccountCode {
  /** 4 ตัวท้ายของเลขบัญชี (= ที่ STM ปิดบังเป็น X####) */
  code: string;
  kind: AccountKind;
  /** เลขบัญชีเต็ม (id) */
  account: string;
}

/**
 * ตั้งธง "การโอนระหว่างบัญชีของตัวเอง" จากเลข 4 ตัวท้าย (X####) ที่อยู่ใน rawDesc/ชื่อผู้รับ
 * เทียบกับบัญชีที่ผู้ใช้ตั้งค่าไว้ — แก้ปัญหา matchTransfers จับคู่ไม่ได้เมื่อมี statement แค่ฝั่งเดียว
 * (เช่น STM บัญชีออมครอบคลุมไม่ครบทุกเดือน) ทำเฉพาะรายการที่ยังไม่ถูกจับเป็น transfer:
 *  - ออก → บัญชี "ออม" ของตัวเอง : category='savings' (นับเป็นเงินออม ไม่ใช่รายจ่าย)
 *  - ออก → บัญชีตัวเองอื่น       : isTransfer=true (เป็นกลาง)
 *  - เข้า ← บัญชีตัวเอง           : isTransfer=true (ไม่ใช่รายรับจริง เป็นเงินตัวเองที่ย้ายกลับ)
 */
export function tagOwnTransfers(txns: Transaction[], own: OwnAccountCode[]): Transaction[] {
  const byCode = new Map(own.filter((o) => o.code).map((o) => [o.code, o] as const));
  if (byCode.size === 0) return txns;
  return txns.map((t) => {
    if (t.isTransfer) return t; // จับคู่ได้แล้ว (matchTransfers) ไม่ต้องแตะ
    const selfCode = t.account ? accountLast4(t.account) : null;
    const text = `${t.rawDesc ?? ''} ${t.counterparty ?? ''}`;
    const matches = text.match(/X(\d{4})(?!\d)/g);
    if (!matches) return t;
    let ref: OwnAccountCode | undefined;
    for (const m of matches) {
      const code = m.slice(1);
      if (code === selfCode) continue; // อ้างถึงบัญชีตัวเอง (เลขเดียวกัน) ข้าม
      const o = byCode.get(code);
      if (o) {
        ref = o;
        break;
      }
    }
    if (!ref) return t;
    if (t.direction === 'out' && ref.kind === 'savings') {
      return { ...t, category: 'savings' as CategoryId };
    }
    return { ...t, isTransfer: true, category: 'transfer' as CategoryId };
  });
}

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
      if (walletKey(inc.t) === walletKey(o.t)) continue; // ต้องคนละบัญชี (แยกตามเลขบัญชี ไม่ใช่แค่ชนิดกระเป๋า)
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
        fromSource: walletKey(outTx),
        toSource: walletKey(inTx),
        group: g,
      });
    }
  }

  return { tagged, matches };
}
