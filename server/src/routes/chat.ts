import { Router } from 'express';
import { z } from 'zod';
import { getAllTransactions } from '../db.js';
import { buildChatContext } from '../services/chat.js';
import { answerQuestion } from '../services/gemini.js';

export const chatRouter = Router();

/**
 * POST /api/chat { question }
 * RAG ของเรา: โค้ดดึงรายการที่เกี่ยวข้อง + คำนวณตัวเลข แล้วให้ LLM เรียบเรียง
 * (ถ้าไม่มี Gemini key จะคืนคำตอบจากตัวเลขที่คำนวณแบบ rule-based)
 */
chatRouter.post('/', async (req, res) => {
  const schema = z.object({ question: z.string().min(1).max(500) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'กรุณาพิมพ์คำถาม' });

  const txns = getAllTransactions();
  const { facts, sample } = buildChatContext(parsed.data.question, txns);
  const { text, source } = await answerQuestion(parsed.data.question, facts, sample);

  res.json({ answer: text, facts, source, contextSize: sample.length });
});
