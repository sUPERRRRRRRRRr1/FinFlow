import { Router } from 'express';
import { z } from 'zod';
import { clearTransactions } from '../db.js';
import { parseStatement } from '../parsers/registry.js';
import { parseSlip } from '../parsers/slip.js';
import { ocrSlip } from '../services/ocr.js';
import { fetchBankTransactions } from '../services/gmail.js';
import { generateDemoTransactions } from '../demo/seed.js';
import { ingestAndStore } from '../services/store.js';
import { flags } from '../config.js';

export const ingestRouter = Router();

/** POST /api/ingest/statement { text, sender?, filename? } — ข้อความ statement (ปลดรหัสฝั่ง client แล้ว) */
ingestRouter.post('/statement', (req, res) => {
  const schema = z.object({ text: z.string().min(1), sender: z.string().optional(), filename: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ต้องส่งข้อความ statement' });
  const { source, transactions } = parseStatement(parsed.data.text, {
    sender: parsed.data.sender,
    filename: parsed.data.filename,
  });
  if (transactions.length === 0)
    return res.status(422).json({ error: 'ไม่พบรายการใน statement (ตรวจรูปแบบข้อความ)' });
  res.json({ source, ...ingestAndStore(transactions) });
});

/** POST /api/ingest/slip { ocrText? , imageBase64?, mimeType? } — สลิป */
ingestRouter.post('/slip', async (req, res) => {
  const schema = z.object({
    ocrText: z.string().optional(),
    imageBase64: z.string().optional(),
    mimeType: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });

  let text = parsed.data.ocrText ?? '';
  if (!text && parsed.data.imageBase64) {
    const result = await ocrSlip(parsed.data.imageBase64, parsed.data.mimeType);
    if (result.text == null) return res.status(422).json({ error: result.reason });
    text = result.text;
  }
  if (!text) return res.status(400).json({ error: 'ต้องส่ง ocrText หรือ imageBase64' });

  const txn = parseSlip(text);
  if (!txn) return res.status(422).json({ error: 'อ่านสลิปไม่สำเร็จ' });
  res.json({ parsed: txn, ...ingestAndStore([txn]) });
});

/** POST /api/ingest/gmail — ดึงเมลธนาคารจริง (ต้องตั้งค่า + เชื่อม Gmail) */
ingestRouter.post('/gmail', async (_req, res) => {
  if (!flags.gmailConfigured)
    return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Gmail OAuth ใน .env (โหมดเดโมไม่ต้องใช้)' });
  try {
    const txns = await fetchBankTransactions();
    res.json(ingestAndStore(txns));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** POST /api/ingest/demo — สร้าง/รีเซ็ตข้อมูลตัวอย่าง */
ingestRouter.post('/demo', (_req, res) => {
  clearTransactions();
  const result = ingestAndStore(generateDemoTransactions());
  res.json({ ok: true, ...result });
});
