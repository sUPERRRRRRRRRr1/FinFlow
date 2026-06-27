import { Router } from 'express';
import { z } from 'zod';
import { getAllTransactions, getScoreProfile, getTaxProfile } from '../db.js';
import { buildChatContext } from '../services/chat.js';
import { buildSnapshot } from '../services/snapshot.js';
import { answerQuestion } from '../services/gemini.js';

export const chatRouter = Router();

/**
 * POST /api/chat { question, history? }
 * โค้ดสร้าง fact-sheet ครบทุกด้าน (ตัวเลขคำนวณเอง) + โฟกัสคำถาม แล้วให้ LLM เลือก/เรียบเรียง
 * ถ้าไม่มี LLM key จะ fallback เป็น rule-based (เลือก section ที่เกี่ยวข้อง)
 */
chatRouter.post('/', async (req, res) => {
  const schema = z.object({
    question: z.string().min(1).max(500),
    history: z
      .array(z.object({ role: z.enum(['user', 'bot']), text: z.string().max(2000) }))
      .max(12)
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'กรุณาพิมพ์คำถาม' });

  const txns = getAllTransactions();
  const snapshot = buildSnapshot(txns, { scoreProfile: getScoreProfile(), taxProfile: getTaxProfile() });
  const { focus, sample } = buildChatContext(parsed.data.question, txns);
  const { text, source } = await answerQuestion(
    parsed.data.question,
    snapshot,
    focus,
    sample,
    parsed.data.history ?? [],
  );

  res.json({
    answer: text,
    facts: focus ? `${focus}\n\n${snapshot}` : snapshot,
    source,
    contextSize: sample.length,
  });
});
