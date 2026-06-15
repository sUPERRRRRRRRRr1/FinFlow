import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ALL_CATEGORIES } from '@finflow/shared';
import type { CategoryId } from '@finflow/shared';
import { getRules, upsertRule, deleteRule } from '../db.js';
import { reapplyRules } from '../services/store.js';

export const rulesRouter = Router();

/** GET /api/rules — กฎร้านค้าทั้งหมด */
rulesRouter.get('/', (_req, res) => {
  res.json({ rules: getRules() });
});

/** POST /api/rules — เพิ่ม/แก้กฎ แล้วใช้กับธุรกรรมทั้งหมดทันที (Sankey/หมวด/คะแนนอัปเดตตาม) */
rulesRouter.post('/', (req, res) => {
  const schema = z.object({
    id: z.string().optional(),
    matchType: z.enum(['account', 'name']),
    matchValue: z.string().min(1),
    alias: z.string().optional(),
    category: z.enum(ALL_CATEGORIES as [CategoryId, ...CategoryId[]]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ข้อมูลกฎไม่ถูกต้อง' });
  const rule = { ...parsed.data, id: parsed.data.id ?? `rule-${randomUUID().slice(0, 8)}` };
  upsertRule(rule);
  const result = reapplyRules();
  res.json({ ok: true, rule, ...result, rules: getRules() });
});

/** DELETE /api/rules/:id — ลบกฎ แล้วคำนวณใหม่ */
rulesRouter.delete('/:id', (req, res) => {
  deleteRule(req.params.id);
  const result = reapplyRules();
  res.json({ ok: true, ...result, rules: getRules() });
});
