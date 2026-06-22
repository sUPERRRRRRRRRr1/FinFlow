import { Router } from 'express';
import { z } from 'zod';
import { taxOverview, getRules, defaultTaxProfile } from '@finflow/shared';
import type { TaxProfile } from '@finflow/shared';
import { getTaxProfile, setTaxProfile } from '../db.js';
import { loadTransactions } from './_helpers.js';

export const taxRouter = Router();

/** GET /api/tax — ผลภาษี + คำแนะนำ + ข้อมูลยื่น (เดารายได้จากธุรกรรมถ้ายังไม่ตั้งค่า) */
taxRouter.get('/', (req, res) => {
  const txns = loadTransactions(req);
  const profile = getTaxProfile();
  res.json({ profile, ...taxOverview(txns, profile, getRules(profile.taxYear)) });
});

/** PUT /api/tax — บันทึกโปรไฟล์ภาษี (รายได้ที่แก้เอง + ค่าลดหย่อน) */
taxRouter.put('/', (req, res) => {
  const schema = z.object({
    taxYear: z.number().int(),
    married: z.boolean(),
    dividendMode: z.enum(['final', 'include']),
    annualize: z.boolean(),
    income: z.array(
      z.object({
        type: z.enum(['40(1)', '40(2)', '40(3)', '40(4)', '40(5)', '40(6)', '40(7)', '40(8)']),
        amount: z.number().min(0),
        withholding: z.number().min(0).optional(),
        dividend: z.boolean().optional(),
        source: z.enum(['detected', 'user']),
        note: z.string().optional(),
      }),
    ),
    deductions: z.record(z.union([z.number(), z.boolean()])),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ข้อมูลภาษีไม่ถูกต้อง' });
  const merged: TaxProfile = { ...defaultTaxProfile(parsed.data.taxYear), ...(parsed.data as unknown as TaxProfile) };
  setTaxProfile(merged);
  res.json({ ok: true, profile: merged });
});
