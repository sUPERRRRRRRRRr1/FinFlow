import { describe, it, expect } from 'vitest';
import type { Transaction } from '../types.js';
import { computeHealthScore, PROFILES, type ScoreProfile } from './healthScore.js';
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

describe('Financial Health Score (4-pillar FinHealth)', () => {
  const txns: Transaction[] = [
    tx({ direction: 'in', category: 'income', amount: 10000, date: '2025-01-01' }),
    tx({ direction: 'out', category: 'food', amount: 2000, date: '2025-01-05' }),
    tx({ direction: 'out', category: 'shopping', amount: 2000, date: '2025-01-12' }),
    tx({ direction: 'out', category: 'transport', amount: 1500, date: '2025-01-18' }),
    tx({ direction: 'out', category: 'bills', amount: 1500, date: '2025-01-25' }),
  ];

  const metric = (h: ReturnType<typeof computeHealthScore>, pid: string, mid: string) =>
    h.pillars.find((p) => p.id === pid)!.metrics.find((m) => m.id === mid)!;

  it('savings-rate metric is full when rate ≥ profile target', () => {
    const h = computeHealthScore(txns); // income 10000, consumption 7000 → s=0.3 ≥ 0.20
    expect(metric(h, 'save', 'savingsRate').score).toBeCloseTo(100, 1);
  });

  it('total is 0..100 and equals the weighted sum of pillars', () => {
    const h = computeHealthScore(txns);
    expect(h.total).toBeGreaterThanOrEqual(0);
    expect(h.total).toBeLessThanOrEqual(100);
    const recombined = h.pillars.reduce((a, p) => a + p.score * p.weight, 0);
    expect(h.total).toBeCloseTo(recombined, 0);
  });

  it('pillar weights sum to 1 in every profile', () => {
    for (const profile of Object.keys(PROFILES) as ScoreProfile[]) {
      const h = computeHealthScore(txns, profile);
      const total = h.pillars.reduce((a, p) => a + p.weight, 0);
      expect(total).toBeCloseTo(1, 6);
      expect(h.profile).toBe(profile);
    }
  });

  it('student profile rewards a lower savings rate more than adult', () => {
    // s = (10000-8500)/10000 = 0.15 → adult (full@20%)=75, student (full@10%)=100
    const lean: Transaction[] = [
      tx({ direction: 'in', category: 'income', amount: 10000, date: '2025-01-01' }),
      tx({ direction: 'out', category: 'food', amount: 8500, date: '2025-01-10' }),
    ];
    const adult = metric(computeHealthScore(lean, 'adult'), 'save', 'savingsRate').score;
    const student = metric(computeHealthScore(lean, 'student'), 'save', 'savingsRate').score;
    expect(student).toBeGreaterThan(adult);
    expect(student).toBeCloseTo(100, 1);
  });

  it('borrow pillar drops when debt-like payments appear in transactions', () => {
    const withDebt: Transaction[] = [
      ...txns,
      tx({ direction: 'out', category: 'bills', amount: 3000, counterparty: 'ผ่อนรถ Leasing', date: '2025-01-20' }),
    ];
    const base = computeHealthScore(txns).pillars.find((p) => p.id === 'borrow')!.score;
    const debt = computeHealthScore(withDebt).pillars.find((p) => p.id === 'borrow')!.score;
    expect(base).toBe(100); // ตรวจไม่พบหนี้
    expect(debt).toBeLessThan(base);
  });

  it('grade levels follow the FinHealth 3-band scheme', () => {
    const h = computeHealthScore(txns);
    const expected = h.total >= 80 ? 'healthy' : h.total >= 40 ? 'coping' : 'vulnerable';
    expect(h.level).toBe(expected);
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
