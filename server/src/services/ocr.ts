import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, flags } from '../config.js';

/**
 * OCR สลิป: ใช้ Gemini multimodal ก่อน (แม่นกว่ากับภาษาไทย)
 * ถ้าไม่มี key ลองใช้ Tesseract.js (lazy import) เป็น fallback
 * คืน null + เหตุผล ถ้าทำไม่ได้
 */
export async function ocrSlip(
  imageBase64: string,
  mimeType = 'image/jpeg',
): Promise<{ text: string; source: 'gemini' | 'tesseract' } | { text: null; reason: string }> {
  const data = imageBase64.replace(/^data:[^;]+;base64,/, '');

  if (flags.geminiEnabled) {
    try {
      const genai = new GoogleGenerativeAI(config.gemini.apiKey);
      const model = genai.getGenerativeModel({ model: config.gemini.model });
      const res = await model.generateContent([
        {
          text: 'อ่านข้อความทั้งหมดจากสลิปโอนเงินนี้ คืนเป็นข้อความล้วน คงตัวเลขจำนวนเงิน วันที่ เวลา และชื่อผู้รับให้ครบ',
        },
        { inlineData: { data, mimeType } },
      ]);
      return { text: res.response.text().trim(), source: 'gemini' };
    } catch (err) {
      console.error('[ocr] gemini failed:', (err as Error).message);
    }
  }

  // Fallback: Tesseract.js (โหลดเฉพาะตอนใช้ เพราะ data ภาษาใหญ่)
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['tha', 'eng']);
    const {
      data: { text },
    } = await worker.recognize(Buffer.from(data, 'base64'));
    await worker.terminate();
    return { text: text.trim(), source: 'tesseract' };
  } catch (err) {
    return {
      text: null,
      reason:
        'OCR ต้องใช้ Gemini API key หรือ Tesseract.js — ใส่ GEMINI_API_KEY ใน .env หรือพิมพ์รายการเอง (' +
        (err as Error).message +
        ')',
    };
  }
}
