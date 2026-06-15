import { Router } from 'express';
import { flags } from '../config.js';
import { countTransactions } from '../db.js';
import { getAuthUrl, exchangeCode, isConnected } from '../services/gmail.js';

export const systemRouter = Router();

/** GET /api/status — สถานะระบบ + ฟีเจอร์ที่เปิดใช้ */
systemRouter.get('/status', (_req, res) => {
  res.json({
    ok: true,
    transactions: countTransactions(),
    features: {
      geminiEnabled: flags.geminiEnabled,
      gmailConfigured: flags.gmailConfigured,
      gmailConnected: isConnected(),
    },
  });
});

/** GET /api/auth/google — เริ่ม OAuth (อ่านอย่างเดียว) */
systemRouter.get('/auth/google', (_req, res) => {
  if (!flags.gmailConfigured)
    return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Gmail OAuth ใน .env' });
  res.redirect(getAuthUrl());
});

/** GET /api/auth/google/callback — รับ code แล้วแลก token */
systemRouter.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).send('ไม่มี authorization code');
  try {
    await exchangeCode(code);
    res.redirect('/?gmail=connected');
  } catch (err) {
    res.status(400).send('เชื่อม Gmail ไม่สำเร็จ: ' + (err as Error).message);
  }
});
