import { describe, it, expect } from 'vitest';
import type { Transaction } from '../types.js';
import { computeHealthScore, WEIGHTS } from './healthScore.js';
import { levenshtein, stringSimilarity, deduplicate } from './dedup.js';
import { matchTransfers } from './transfers.js';
import { buildSankey } from './sankey.js';
import { categoryTrends } from './trends.js';
import { detectRecurring } from './recurring.js';

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: p.id ?? `t${seq++}`,
    date: p.date ?? '2025-01-01',
    amount: p.amount ?? 100,
    direction: p.direction ?? 'out',
    counterparty: p.counterparty ?? 'ร้านค้า',
    source: p.source ?? 'kbank',
    category: p.category ?? 'other',
    ...p,
  };
}

describe('Levenshtein & string similarity', () => {
  it('edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
  it('normalized similarity ignores case/space', () => {
    expect(stringSimilarity('Cafe Amazon', 'cafe amazon')).toBeCloseTo(1, 6);
    expect(stringSimilarity('Café Amazon', 'Cafe Amazon')).toBeGreaterThan(0.8);
  });
});

describe('cross-source deduplication', () => {
  it('merges a statement+slip near-duplicate and keeps the statement', () => {
    const txns = [
      tx({ id: 'stmt', source: 'kbank', counterparty: 'Café Amazon', amount: 60, date: '2025-03-09' }),
      tx({ id: 'slip', source: 'slip', counterparty: 'Cafe Amazon', amount: 60, date: '2025-03-09' }),
    ];
    const { unique, duplicates } = deduplicate(txns);
    expect(unique).toHaveLength(1);
    expect(unique[0]!.id).toBe('stmt'); // statement มี rank สูงกว่า
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.removed).toBe('slip');
  });

  it('keeps genuinely different transactions', () => {
    const txns = [
      tx({ id: 'a', counterparty: 'ร้าน A', amount: 60, date: '2025-03-09' }),
      tx({ id: 'b', counterparty: 'ร้าน B ไกลมาก', amount: 999, date: '2025-03-20' }),
    ];
    expect(deduplicate(txns).unique).toHaveLength(2);
  });
});

describe('inter-wallet transfer matching', () => {
  it('pairs an out in wallet A with an equal in to wallet B', () => {
    const txns = [
      tx({ id: 'out', source: 'kbank', direction: 'out', amount: 500, date: '2025-04-01' }),
      tx({ id: 'in', source: 'truemoney', direction: 'in', amount: 500, date: '2025-04-01' }),
    ];
    const { matches, tagged } = matchTransfers(txns);
    expect(matches).toHaveLength(1);
    expect(tagged.every((t) => t.isTransfer)).toBe(true);
    expect(tagged.every((t) => t.category === 'transfer')).toBe(true);
  });

  it('does not pair transfers within the same wallet', () => {
    const txns = [
      tx({ id: 'out', source: 'kbank', direction: 'out', amount: 500 }),
      tx({ id: 'in', source: 'kbank', direction: 'in', amount: 500 }),
    ];
    expect(matchTransfers(txns).matches).toHaveLength(0);
  });
});

describe('Sankey flow conservation', () => {
  it('every pool node is balanced (inflow=outflow)', () => {
    const txns = [
      tx({ direction: 'in', category: 'income', amount: 10000, counterparty: 'เงินเดือน' }),
      tx({ direction: 'out', category: 'food', amount: 4000 }),
      tx({ direction: 'out', category: 'shopping', amount: 2000 }),
      tx({ direction: 'out', category: 'savings', amount: 1000 }),
    ];
    const g = buildSankey(txns);
    expect(g.balance.balanced).toBe(true);
    expect(g.balance.maxImbalance).toBeLessThanOrEqual(0.5);
  });
});

describe('Financial Health Score', () => {
  const txns: Transaction[] = [
    tx({ direction: 'in', category: 'income', amount: 10000, date: '2025-01-01' }),
    tx({ direction: 'out', category: 'food', amount: 2000, date: '2025-01-05' }),
    tx({ direction: 'out', category: 'shopping', amount: 2000, date: '2025-01-12' }),
    tx({ direction: 'out', category: 'transport', amount: 1500, date: '2025-01-18' }),
    tx({ direction: 'out', category: 'bills', amount: 1500, date: '2025-01-25' }),
  ];

  it('savings component is full at exactly 30% savings rate', () => {
    const h = computeHealthScore(txns); // income 10000, consumption 7000 → s=0.3
    const savings = h.components.find((c) => c.id === 'savings')!;
    expect(savings.score).toBeCloseTo(100, 1);
  });

  it('total is 0..100 and equals the weighted sum of components', () => {
    const h = computeHealthScore(txns);
    expect(h.total).toBeGreaterThanOrEqual(0);
    expect(h.total).toBeLessThanOrEqual(100);
    const recombined = h.components.reduce((a, c) => a + c.score * c.weight, 0);
    expect(h.total).toBeCloseTo(recombined, 0);
  });

  it('weights sum to 1', () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('category trends', () => {
  it('computes period-over-period % change', () => {
    const txns = [
      tx({ category: 'food', amount: 1000, date: '2025-01-10' }),
      tx({ category: 'food', amount: 2000, date: '2025-02-10' }),
    ];
    const t = categoryTrends(txns).find((x) => x.category === 'food')!;
    expect(t.current).toBe(2000);
    expect(t.previous).toBe(1000);
    expect(t.pctChange).toBeCloseTo(100, 1);
    expect(t.direction).toBe('up');
  });
});

describe('recurring detection', () => {
  it('detects a monthly subscription', () => {
    const txns = [
      tx({ counterparty: 'Netflix', category: 'entertainment', amount: 419, date: '2025-01-05' }),
      tx({ counterparty: 'Netflix', category: 'entertainment', amount: 419, date: '2025-02-05' }),
      tx({ counterparty: 'Netflix', category: 'entertainment', amount: 419, date: '2025-03-05' }),
    ];
    const r = detectRecurring(txns);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0]!.merchant).toBe('Netflix');
    expect(r[0]!.avgIntervalDays).toBeGreaterThan(25);
    expect(r[0]!.avgIntervalDays).toBeLessThan(35);
  });
});
