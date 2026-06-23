import { Router } from 'express';
import { z } from 'zod';
import { walletKey } from '@finflow/shared';
import type { AccountConfig } from '@finflow/shared';
import { getAccounts, setAccounts, getAllTransactions } from '../db.js';

export const accountsRouter = Router();

const SOURCES = ['kbank', 'make', 'truemoney', 'manual', 'slip'] as const;
const KINDS = ['daily', 'savings', 'wallet', 'credit', 'other'] as const;

/** บัญชี/กระเป๋าที่ระบบ "ตรวจพบ" ในข้อมูลจริง (คีย์กระเป๋า + ชนิด + จำนวนรายการ) */
function detectAccounts(): { id: string; source: string; count: number }[] {
  const map = new Map<string, { source: string; count: number }>();
  for (const t of getAllTransactions()) {
    const key = walletKey(t);
    const e = map.get(key) ?? { source: t.source, count: 0 };
    e.count++;
    map.set(key, e);
  }
  return [...map.entries()]
    .map(([id, v]) => ({ id, source: v.source, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

/** GET /api/accounts — การตั้งค่าบัญชีที่บันทึกไว้ + บัญชีที่ตรวจพบจากข้อมูล */
accountsRouter.get('/', (_req, res) => {
  res.json({ accounts: getAccounts(), detected: detectAccounts() });
});

/** PUT /api/accounts — บันทึกการตั้งค่าบัญชีทั้งชุด ("บัญชีเล่มนี้คือบัญชีอะไร") */
accountsRouter.put('/', (req, res) => {
  const schema = z.object({
    accounts: z.array(
      z.object({
        id: z.string().min(1),
        source: z.enum(SOURCES),
        nickname: z.string().min(1),
        kind: z.enum(KINDS),
        note: z.string().optional(),
      }),
    ),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ข้อมูลบัญชีไม่ถูกต้อง' });
  // กันคีย์บัญชีซ้ำ (เก็บอันสุดท้าย)
  const byId = new Map<string, AccountConfig>();
  for (const a of parsed.data.accounts) byId.set(a.id, a);
  const accounts = [...byId.values()];
  setAccounts(accounts);
  res.json({ ok: true, accounts });
});
