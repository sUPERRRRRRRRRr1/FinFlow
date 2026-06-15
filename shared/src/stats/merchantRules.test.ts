import { describe, it, expect } from 'vitest';
import type { MerchantRule, Transaction } from '../types.js';
import { applyMerchantRules, displayName } from './merchantRules.js';

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: p.id ?? 't',
    date: '2026-01-01',
    amount: 80,
    direction: 'out',
    counterparty: 'นาย วิรัช ขายดี',
    source: 'truemoney',
    category: 'other',
    ...p,
  };
}

describe('merchant rules', () => {
  it('maps by account number → overrides category + alias', () => {
    const rules: MerchantRule[] = [
      { id: 'r1', matchType: 'account', matchValue: 'xxx-x-x1234-5', alias: 'ร้านน้ำเจ๊', category: 'food' },
    ];
    const txns = [
      tx({ id: 'a', accountRef: 'xxx-x-x1234-5' }),
      tx({ id: 'b', accountRef: 'xxx-x-x9999-9' }),
    ];
    const out = applyMerchantRules(txns, rules);
    expect(out[0]!.category).toBe('food');
    expect(out[0]!.alias).toBe('ร้านน้ำเจ๊');
    expect(out[1]!.category).toBe('other'); // ไม่ตรงบัญชี ไม่เปลี่ยน
  });

  it('maps by name (ignoring spacing/case) when no account match', () => {
    const rules: MerchantRule[] = [
      { id: 'r1', matchType: 'name', matchValue: 'นาย วิรัช ขายดี', category: 'food', alias: 'ก๋วยเตี๋ยววิรัช' },
    ];
    const out = applyMerchantRules([tx({ counterparty: 'นาย วิรัช  ขายดี' })], rules);
    expect(out[0]!.category).toBe('food');
    expect(displayName(out[0]!)).toBe('ก๋วยเตี๋ยววิรัช');
  });

  it('never re-categorizes an inter-wallet transfer', () => {
    const rules: MerchantRule[] = [{ id: 'r1', matchType: 'name', matchValue: 'นาย วิรัช ขายดี', category: 'food' }];
    const out = applyMerchantRules([tx({ isTransfer: true, category: 'transfer' })], rules);
    expect(out[0]!.category).toBe('transfer');
  });

  it('displayName falls back to counterparty', () => {
    expect(displayName(tx({ counterparty: 'Starbucks' }))).toBe('Starbucks');
  });
});
