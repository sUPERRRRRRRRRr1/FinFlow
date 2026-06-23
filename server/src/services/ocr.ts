import sharp from 'sharp';
import { flags } from '../config.js';
import { groqVision } from './groq.js';
import { geminiVision } from './gemini.js';

type OcrOk = { text: string; source: 'groq' | 'gemini' | 'tesseract' };
type OcrFail = { text: null; reason: string };

const SLIP_JSON_PROMPT = `คุณคือระบบ OCR สำหรับสลิปโอนเงิน/ชำระเงินของธนาคารไทย อ่านรูปสลิปแล้วตอบเป็น JSON object เท่านั้น ห้ามมีข้อความอธิบายอื่น
กติกา:
- คงข้อความภาษาไทยตามต้นฉบับเป๊ะ ห้ามแปลหรือถอดเสียงเป็นอังกฤษ
- "จำนวนเงิน" ใส่เฉพาะตัวเลข เช่น 100.00 (ไม่ต้องมีคำว่าบาท)
- "วันเวลา" ใส่ตามที่พิมพ์บนสลิป เช่น "15 มิ.ย. 69 16:58 น."
- "ผู้รับ" คือปลายทางที่เงินโอนเข้า (ชื่อร้าน/บุคคล) ไม่ใช่ผู้โอน
- "ทิศทาง" ตอบ "out" ถ้าสลิปเป็นการ "โอนออก/จ่าย/ชำระ/เติมเงิน/ซื้อ" (เจ้าของสลิปเป็นผู้จ่าย) ซึ่งเป็นกรณีปกติของสลิปเกือบทั้งหมด; ตอบ "in" เฉพาะใบ "เงินเข้า/รับโอน/รับเงิน/เงินเดือน" ที่เจ้าของสลิปเป็นผู้รับเงินจริงๆ เท่านั้น — เมื่อไม่แน่ใจให้ตอบ "out"
- ถ้าฟิลด์ไหนไม่พบให้ใส่ "" (ยกเว้น "ทิศทาง" ที่ดีฟอลต์เป็น "out")
ตอบรูปแบบนี้: {"ประเภท":"","ทิศทาง":"out","วันเวลา":"","ผู้รับ":"","จำนวนเงิน":"","เลขที่รายการ":""}`;

/**
 * แต่งรูปก่อน OCR: เกรย์สเกล + เพิ่มคอนทราสต์ (ลบลายน้ำ) + ขยาย 2x
 * → ตัวอักษรไทยตัวเล็กบนพื้นลายน้ำชัดขึ้นมาก (พิสูจน์แล้วว่าแม่นขึ้นจริง)
 */
async function preprocess(base64Data: string, fallbackMime = 'image/jpeg'): Promise<{ data: string; mime: string }> {
  try {
    const buf = Buffer.from(base64Data, 'base64');
    const meta = await sharp(buf).metadata();
    const targetW = Math.min((meta.width ?? 1000) * 2, 2400);
    const out = await sharp(buf)
      .rotate() // auto-orient ตาม EXIF
      .greyscale()
      .linear(1.7, -0.7 * 128) // เพิ่มคอนทราสต์รอบกลางภาพ → ลบลายน้ำ
      .resize({ width: targetW, withoutEnlargement: false })
      .png()
      .toBuffer();
    return { data: out.toString('base64'), mime: 'image/png' };
  } catch {
    return { data: base64Data, mime: fallbackMime }; // แต่งรูปพลาด → ส่งรูปดิบ
  }
}

/** JSON จาก Groq → ข้อความรูปแบบที่ parseSlip (regex) อ่านได้ */
function jsonToSlipText(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  let j: Record<string, string>;
  try {
    j = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!j['จำนวนเงิน']) return null; // ไม่มียอด = อ่านไม่สำเร็จ
  // ทิศทางที่โมเดลสรุป → normalize เป็น out/in (ดีฟอลต์ out) ให้ parseSlip อ่านเป็น marker ที่เชื่อถือได้
  const dirRaw = (j['ทิศทาง'] || '').toLowerCase();
  const dir = dirRaw === 'in' || dirRaw.includes('เข้า') || dirRaw.includes('รับ') ? 'in' : 'out';
  return [
    j['ประเภท'] && `ประเภท: ${j['ประเภท']}`,
    `ทิศทาง: ${dir}`,
    j['วันเวลา'] && `วันเวลา: ${j['วันเวลา']}`,
    j['ผู้รับ'] && `ผู้รับ: ${j['ผู้รับ']}`,
    `จำนวน: ${j['จำนวนเงิน']} บาท`,
    j['เลขที่รายการ'] && `เลขที่รายการ: ${j['เลขที่รายการ']}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * OCR สลิป: Gemini multimodal (flash-lite + แต่งรูป + JSON mode) เป็นตัวหลัก
 * ถ้าไม่มี Gemini/อ่านไม่ได้ → Groq vision (Llama 4) → Tesseract.js (offline)
 * ทั้ง Gemini และ Groq ใช้ prompt JSON ตัวเดียวกัน → ได้ฟิลด์ "ทิศทาง" ที่เชื่อถือได้เหมือนกัน
 */
export async function ocrSlip(
  imageBase64: string,
  mimeType = 'image/jpeg',
): Promise<OcrOk | OcrFail> {
  const data = imageBase64.replace(/^data:[^;]+;base64,/, '');

  // 1) Gemini vision (flash-lite) — แต่งรูป + JSON mode → สรุป "ทิศทาง" มาตรงๆ (โมเดลหลัก)
  if (flags.geminiEnabled) {
    try {
      const pre = await preprocess(data, mimeType);
      const raw = await geminiVision(pre.data, pre.mime, SLIP_JSON_PROMPT);
      const text = raw ? jsonToSlipText(raw) : null;
      if (text) return { text, source: 'gemini' };
    } catch (err) {
      console.error('[ocr] gemini failed:', (err as Error).message);
    }
  }

  // 2) Groq vision (Llama 4) — แต่งรูป + JSON mode (ตัวสำรอง)
  if (flags.groqEnabled) {
    try {
      const pre = await preprocess(data, mimeType);
      const raw = await groqVision(pre.data, pre.mime, SLIP_JSON_PROMPT);
      const text = raw ? jsonToSlipText(raw) : null;
      if (text) return { text, source: 'groq' };
    } catch (err) {
      console.error('[ocr] groq failed:', (err as Error).message);
    }
  }

  // 3) Tesseract.js (โหลดเฉพาะตอนใช้ — offline fallback)
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
        'OCR ไม่สำเร็จ — ต้องมี GROQ_API_KEY / GEMINI_API_KEY หรือ Tesseract.js (' +
        (err as Error).message +
        ')',
    };
  }
}
