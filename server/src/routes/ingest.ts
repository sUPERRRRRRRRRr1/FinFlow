import { Router } from 'express';
import { z } from 'zod';
import { clearTransactions, clearDemoTransactions, getAccounts, setAccounts, insertTransactions } from '../db.js';
import { parseStatement } from '../parsers/registry.js';
import { parseSlip } from '../parsers/slip.js';
import { ocrSlip } from '../services/ocr.js';
import { fetchBankTransactions } from '../services/gmail.js';
import { generateDemoTransactions, mergeDemoAccounts } from '../demo/seed.js';
import { ingestAndStore } from '../services/store.js';
import { ingestTransactions } from '../services/ingest.js';
import { flags } from '../config.js';

export const ingestRouter = Router();

/** POST /api/ingest/statement { text, sender?, filename? } — ข้อความ statement (ปลดรหัสฝั่ง client แล้ว) */
ingestRouter.post('/statement', async (req, res) => {
  const schema = z.object({ text: z.string().min(1), sender: z.string().optional(), filename: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'ต้องส่งข้อความ statement' });
  const { source, transactions } = parseStatement(parsed.data.text, {
    sender: parsed.data.sender,
    filename: parsed.data.filename,
  });
  if (transactions.length === 0)
    return res.status(422).json({ error: 'ไม่พบรายการใน statement (ตรวจรูปแบบข้อความ)' });
  res.json({ source, ...(await ingestAndStore(transactions)) });
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
  res.json({ parsed: txn, ...(await ingestAndStore([txn])) });
});

/** POST /api/ingest/gmail — ดึงเมลธนาคารจริง (ต้องตั้งค่า + เชื่อม Gmail) */
let gmailBusy = false; // กันดึง Gmail ซ้อนกัน (auto-sync + กดเอง พร้อมกัน) ไม่ให้ ingest ชนกัน
ingestRouter.post('/gmail', async (req, res) => {
  if (!flags.gmailConfigured)
    return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Gmail OAuth ใน .env (โหมดเดโมไม่ต้องใช้)' });
  if (gmailBusy) return res.json({ added: 0, busy: true });
  gmailBusy = true;
  try {
    // รหัส STM ที่ client บันทึกไว้ (localStorage) ส่งมาเพื่อปลดล็อก PDF อัตโนมัติ — ใช้ชั่วคราว ไม่เก็บลง DB
    const pdfPasswords = z.array(z.string()).safeParse(req.body?.passwords).data ?? [];
    // ?recent=1 → auto-sync ตอนเข้าเว็บ (เร็ว) · ไม่ใส่ = ปุ่มดึงเอง (ทั้งปี)
    // ใช้ 45 วัน (ไม่ใช่ 21) สำหรับ auto-sync เพื่อไม่ให้พลาด statement รายเดือนที่มาต้นเดือน หากเปิดเว็บห่างกันเกิน 3 สัปดาห์
    const recent = req.query.recent === '1';
    const { transactions, lockedPdfs } = await fetchBankTransactions(
      recent ? 100 : 250,
      recent ? 'newer_than:45d' : 'newer_than:13m',
      pdfPasswords,
    );
    res.json({ ...(await ingestAndStore(transactions)), lockedPdfs });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  } finally {
    gmailBusy = false;
  }
});

/** POST /api/ingest/demo — สร้าง/รีเซ็ตข้อมูลตัวอย่าง (ลบข้อมูลเดิมทั้งหมดก่อน) */
ingestRouter.post('/demo', async (_req, res) => {
  clearTransactions();
  const result = await ingestAndStore(generateDemoTransactions());
  // เติมการตั้งค่าบัญชีเดโมให้ครบ (ไม่ทับชื่อเล่นที่ผู้ใช้ตั้งเอง)
  setAccounts(mergeDemoAccounts(getAccounts()));
  res.json({ ok: true, ...result });
});

/**
 * POST /api/ingest/demo/add — เพิ่มข้อมูลตัวอย่าง "ควบคู่" ข้อมูลจริง (ไม่ลบของจริง)
 * ลบเฉพาะ demo เดิมก่อน (idempotent) แล้ว ingest ชุดเดโมแยกเดี่ยว (จับคู่โอน/กันซ้ำภายในชุด)
 * → insert เพิ่มโดยไม่แตะข้อมูลจริง ดูได้ผ่านสกอป "🧪 เดโม"
 */
ingestRouter.post('/demo/add', (_req, res) => {
  clearDemoTransactions();
  const { transactions, stats } = ingestTransactions(generateDemoTransactions());
  const added = insertTransactions(transactions);
  setAccounts(mergeDemoAccounts(getAccounts()));
  res.json({ ok: true, added, stats });
});
