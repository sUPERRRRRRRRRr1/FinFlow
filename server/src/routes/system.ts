import { Router } from 'express';
import { config, flags } from '../config.js';
import { countTransactions, getScoreProfile, setScoreProfile } from '../db.js';
import { getAuthUrl, exchangeCode, isConnected } from '../services/gmail.js';

export const systemRouter = Router();

/** GET /api/score-profile — โปรไฟล์เกณฑ์คะแนนสุขภาพการเงินที่ใช้อยู่ (นักเรียน/ผู้ใหญ่) */
systemRouter.get('/score-profile', (_req, res) => {
  res.json({ profile: getScoreProfile() });
});

/** PUT /api/score-profile — ตั้งโปรไฟล์เกณฑ์ ({ profile: 'adult' | 'student' }) */
systemRouter.put('/score-profile', (req, res) => {
  const profile = (req.body as { profile?: string })?.profile;
  if (profile !== 'adult' && profile !== 'student')
    return res.status(400).json({ error: "profile ต้องเป็น 'adult' หรือ 'student'" });
  setScoreProfile(profile);
  res.json({ ok: true, profile });
});

/** GET /api/status — สถานะระบบ + ฟีเจอร์ที่เปิดใช้ */
systemRouter.get('/status', (_req, res) => {
  res.json({
    ok: true,
    transactions: countTransactions(),
    features: {
      geminiEnabled: flags.geminiEnabled,
      groqEnabled: flags.groqEnabled,
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
    // dev: กลับไปหน้า client ที่ vite (5173) · prod: relative (พอร์ตเดียวกัน)
    res.redirect(`${config.appUrl}/?gmail=connected`);
  } catch (err) {
    res.status(400).send('เชื่อม Gmail ไม่สำเร็จ: ' + (err as Error).message);
  }
});
