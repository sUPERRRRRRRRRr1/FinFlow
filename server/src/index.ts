import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, flags } from './config.js';
import { countTransactions, insertTransactions, setMeta, getBudgets, setBudget, getAccounts, setAccounts } from './db.js';
import { ingestTransactions } from './services/ingest.js';
import { generateDemoTransactions, DEMO_ACCOUNTS } from './demo/seed.js';
import { systemRouter } from './routes/system.js';
import { transactionsRouter } from './routes/transactions.js';
import { analyticsRouter } from './routes/analytics.js';
import { budgetsRouter } from './routes/budgets.js';
import { ingestRouter } from './routes/ingest.js';
import { chatRouter } from './routes/chat.js';
import { exportRouter } from './routes/export.js';
import { rulesRouter } from './routes/rules.js';
import { accountsRouter } from './routes/accounts.js';
import { taxRouter } from './routes/tax.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── seed ข้อมูลตัวอย่างเมื่อฐานข้อมูลว่าง (โหมดเดโม) ──
function seedIfEmpty() {
  if (config.seedDemo && countTransactions() === 0) {
    const { transactions, stats } = ingestTransactions(generateDemoTransactions());
    insertTransactions(transactions);
    setMeta('ingestStats', JSON.stringify(stats));
    console.log(`[seed] เพิ่มข้อมูลตัวอย่าง ${transactions.length} รายการ (กันซ้ำ ${stats.duplicatesRemoved}, จับคู่โอน ${stats.transfersMatched})`);
  }
  // การตั้งค่าบัญชีเริ่มต้น (ตั้งครั้งแรกครั้งเดียว — ไม่ทับของผู้ใช้)
  if (config.seedDemo && getAccounts().length === 0) setAccounts(DEMO_ACCOUNTS);
  // งบประมาณตัวอย่าง (ตั้งครั้งแรกครั้งเดียว)
  if (config.seedDemo && getBudgets().length === 0) {
    const defaults: [string, number][] = [
      ['food', 5000],
      ['transport', 3000],
      ['shopping', 4000],
      ['bills', 11000],
      ['entertainment', 1000],
      ['health', 2000],
    ];
    for (const [cat, limit] of defaults) setBudget(cat as never, limit);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));

app.use('/api', systemRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/ingest', ingestRouter);
app.use('/api/chat', chatRouter);
app.use('/api/export', exportRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/tax', taxRouter);

// ── เสิร์ฟไฟล์ build ของ client ใน production ──
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ── error handler กลาง: ตอบ JSON (ไม่ใช่หน้า HTML 500) เพื่อให้ฝั่ง client อ่าน error ได้ ──
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: (err as Error)?.message ?? 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

// ── กัน process ตายทั้งตัวจาก error ที่หลุดมา (เช่น async route ที่ throw) — log ไว้ ไม่ exit ──
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

seedIfEmpty();

app.listen(config.port, () => {
  console.log(`\n🪙  FinFlow API พร้อมใช้งานที่ http://localhost:${config.port}`);
  console.log(`   • ข้อมูลในระบบ: ${countTransactions()} รายการ`);
  const textAi = flags.geminiEnabled ? `Gemini (${config.gemini.model}) ✅` : flags.groqEnabled ? 'Groq ✅' : 'ปิด (ใช้ fallback) — ใส่ GEMINI_API_KEY หรือ GROQ_API_KEY เพื่อเปิด';
  console.log(`   • AI คำแนะนำ/แชท/จัดหมวด: ${textAi}`);
  const ocr = flags.geminiEnabled ? `Gemini vision (${config.gemini.model}) ✅` : flags.groqEnabled ? 'Groq vision (Llama 4) ✅' : 'Tesseract (offline)';
  console.log(`   • OCR สลิป: ${ocr}`);
  console.log(`   • Gmail: ${flags.gmailConfigured ? 'ตั้งค่าแล้ว ✅' : 'ปิด (โหมดเดโม)'}\n`);
});
