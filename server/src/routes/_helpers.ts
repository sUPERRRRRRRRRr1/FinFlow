import type { Request } from 'express';
import type { Transaction } from '@finflow/shared';
import { monthKey } from '@finflow/shared';
import { getAllTransactions } from '../db.js';

/** โหลดธุรกรรมจาก DB แล้วกรองตาม query (from/to/month/source/category) */
export function loadTransactions(req: Request): Transaction[] {
  let txns = getAllTransactions();
  const { from, to, month, source, category, data } = req.query as Record<string, string | undefined>;

  if (data === 'real') txns = txns.filter((t) => !t.demo);
  else if (data === 'demo') txns = txns.filter((t) => t.demo);
  if (month) txns = txns.filter((t) => monthKey(t.date) === month);
  if (from) txns = txns.filter((t) => t.date >= from);
  if (to) txns = txns.filter((t) => t.date <= to);
  if (source) txns = txns.filter((t) => t.source === source);
  if (category) txns = txns.filter((t) => t.category === category);

  return txns;
}
