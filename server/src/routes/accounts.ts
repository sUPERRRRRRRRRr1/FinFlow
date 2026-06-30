import { Router } from 'express';
import { z } from 'zod';
import { walletKey } from '@finflow/shared';
import type { AccountConfig } from '@finflow/shared';
import { getAccounts, setAccounts, getAllTransactions, getSelfNames, setSelfNames } from '../db.js';
import { retagTransfers } from '../services/store.js';

export const accountsRouter = Router();

const SOURCES = ['kbank', 'make', 'truemoney', 'manual', 'slip'] as const;
const KINDS = ['daily', 'savings', 'wallet', 'credit', 'other'] as const;

type AcctCount = { source: string; real: number; demo: number };

/** นับรายการจริง/เดโม แยกกันต่อคีย์บัญชี (walletKey = เลขบัญชี/คีย์กระเป๋า) */
function accountCounts(): Map<string, AcctCount> {
  const map = new Map<string, AcctCount>();
  for (const t of getAllTransactions()) {
    const key = walletKey(t);
    const e = map.get(key) ?? { source: t.source, real: 0, demo: 0 };
    if (t.demo) e.demo++;
    else e.real++;
    map.set(key, e);
  }
  return map;
}

/** บัญชีนี้เป็น "เดโมล้วน" ไหม — มีแต่รายการตัวอย่าง ไม่มีข้อมูลจริงเลย (บัญชีที่ผู้ใช้เพิ่มเองแต่ยังว่าง ไม่นับเป็นเดโม) */
function isDemoAccount(c?: AcctCount): boolean {
  return !!c && c.real === 0 && c.demo > 0;
}

/**
 * บัญชี/กระเป๋าที่ระบบ "ตรวจพบ" จากข้อมูล — แยกจำนวนรายการจริง/เดโม + ติด flag เดโม
 * การกรองตาม scope (จริง/เดโม/ทั้งหมด) ทำที่ฝั่ง client เพื่อให้ปุ่มบันทึกยังเห็น config ครบทุกบัญชี (ไม่ลบของกันเอง)
 */
function detectAccounts(counts: Map<string, AcctCount>) {
  return [...counts.entries()]
    .map(([id, v]) => ({
      id,
      source: v.source,
      count: v.real + v.demo,
      realCount: v.real,
      demoCount: v.demo,
      demo: isDemoAccount(v),
    }))
    .sort((a, b) => b.count - a.count);
}

/** GET /api/accounts — การตั้งค่าบัญชี (+flag เดโม) + บัญชีที่ตรวจพบ (แยกจริง/เดโม) + ชื่อเจ้าของบัญชี */
accountsRouter.get('/', (_req, res) => {
  const counts = accountCounts();
  const accounts = getAccounts().map((a) => ({ ...a, demo: isDemoAccount(counts.get(a.id)) }));
  res.json({ accounts, detected: detectAccounts(counts), selfNames: getSelfNames() });
});

/** PUT /api/accounts — บันทึกการตั้งค่าบัญชี + ชื่อเจ้าของบัญชี แล้วคำนวณ transfer/own-transfer ใหม่ */
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
    // ชื่อเจ้าของบัญชี (กรอกเอง) — ใช้จับ "โอนเข้าบัญชีตัวเอง" ไม่ให้นับเป็นรายจ่าย
    selfNames: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ข้อมูลบัญชีไม่ถูกต้อง' });
  // กันคีย์บัญชีซ้ำ (เก็บอันสุดท้าย)
  const byId = new Map<string, AccountConfig>();
  for (const a of parsed.data.accounts) byId.set(a.id, a);
  const accounts = [...byId.values()];
  setAccounts(accounts);
  if (parsed.data.selfNames) {
    // ตัดช่องว่าง/ค่าว่าง/ซ้ำ ออกก่อนเก็บ
    setSelfNames([...new Set(parsed.data.selfNames.map((n) => n.trim()).filter(Boolean))]);
  }
  // ตั้งค่าบัญชี/ชื่อ มีผลต่อการแยก "โอนเข้าบัญชีตัวเอง" → คำนวณใหม่ทันที (ไม่งั้นรายการเดิมไม่อัปเดต)
  const { total } = retagTransfers();
  res.json({ ok: true, accounts, selfNames: getSelfNames(), retagged: total });
});
