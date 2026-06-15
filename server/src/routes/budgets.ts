import { Router } from 'express';
import { z } from 'zod';
import { ALL_CATEGORIES, budgetStatus, monthKey } from '@finflow/shared';
import type { CategoryId } from '@finflow/shared';
import { getAllTransactions, getBudgets, setBudget } from '../db.js';

export const budgetsRouter = Router();

function latestMonth(): string {
  const months = [...new Set(getAllTransactions().map((t) => monthKey(t.date)))].sort();
  return months[months.length - 1] ?? new Date().toISOString().slice(0, 7);
}

/** GET /api/budgets?month=YYYY-MM — งบประมาณ + สถานะใช้จริง */
budgetsRouter.get('/', (req, res) => {
  const month = (req.query.month as string) ?? latestMonth();
  const budgets = getBudgets();
  const status = budgetStatus(getAllTransactions(), budgets, month);
  res.json({ month, budgets, status });
});

/** PUT /api/budgets/:category { limit } — ตั้ง/แก้/ลบ (limit=0) งบรายหมวด */
budgetsRouter.put('/:category', (req, res) => {
  const cat = req.params.category as CategoryId;
  if (!ALL_CATEGORIES.includes(cat)) return res.status(400).json({ error: 'หมวดไม่ถูกต้อง' });
  const schema = z.object({ limit: z.number().min(0) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'วงเงินไม่ถูกต้อง' });
  setBudget(cat, parsed.data.limit);
  res.json({ ok: true });
});
