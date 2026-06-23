import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ALL_CATEGORIES, classifyByKeyword } from '@finflow/shared';
import type { CategoryId, Source, Transaction } from '@finflow/shared';
import { updateCategory, clearTransactions, countTransactions } from '../db.js';
import { ingestAndStore } from '../services/store.js';
import { loadTransactions } from './_helpers.js';

export const transactionsRouter = Router();

/** GET /api/transactions — รายการทั้งหมด (กรองด้วย query ได้) */
transactionsRouter.get('/', (req, res) => {
  const txns = loadTransactions(req);
  res.json({ count: txns.length, transactions: txns });
});

/** POST /api/transactions — เพิ่มรายการเอง (เข้า pipeline เดียวกับการนำเข้าอัตโนมัติ) */
transactionsRouter.post('/', async (req, res) => {
  const schema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().optional(),
    amount: z.number().positive(),
    direction: z.enum(['in', 'out']),
    counterparty: z.string().min(1),
    category: z.enum(ALL_CATEGORIES as [CategoryId, ...CategoryId[]]).optional(),
    source: z.enum(['kbank', 'make', 'truemoney', 'manual']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ข้อมูลรายการไม่ถูกต้อง' });
  const d = parsed.data;
  const txn: Transaction = {
    id: `manual-${randomUUID().slice(0, 8)}`,
    date: d.date,
    time: d.time,
    amount: d.amount,
    direction: d.direction,
    counterparty: d.counterparty,
    source: (d.source ?? 'manual') as Source,
    category: d.category ?? classifyByKeyword(d.counterparty, d.direction),
  };
  res.json({ ok: true, transaction: txn, ...(await ingestAndStore([txn])) });
});

/** PATCH /api/transactions/:id/category — แก้หมวด (รองรับการแก้ที่ AI จัดผิด) */
transactionsRouter.patch('/:id/category', (req, res) => {
  const schema = z.object({ category: z.enum(ALL_CATEGORIES as [CategoryId, ...CategoryId[]]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'หมวดไม่ถูกต้อง' });
  updateCategory(req.params.id, parsed.data.category);
  res.json({ ok: true });
});

/** DELETE /api/transactions — ล้างข้อมูลทั้งหมด */
transactionsRouter.delete('/', (_req, res) => {
  clearTransactions();
  res.json({ ok: true, count: countTransactions() });
});
