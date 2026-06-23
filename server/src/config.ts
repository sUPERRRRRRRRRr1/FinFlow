import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY?.trim() || '',
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
  },
  /** Groq (groq.com) — REST แบบ OpenAI-compatible ใช้กับงาน text + OCR สลิป (vision) */
  groq: {
    apiKey: process.env.GROQ_API_KEY?.trim() || '',
    model: process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
    /** โมเดล multimodal สำหรับ OCR สลิป (Llama 4) */
    visionModel: process.env.GROQ_VISION_MODEL?.trim() || 'meta-llama/llama-4-scout-17b-16e-instruct',
    baseUrl: process.env.GROQ_BASE_URL?.trim() || 'https://api.groq.com/openai/v1',
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID?.trim() || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET?.trim() || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:4000/api/auth/google/callback',
    /** ป้ายกำกับ (label) ใน Gmail ที่ผู้ใช้ forward สลิปมาเก็บไว้ (เช่น 'FinFlow') — เสริมจากเมลธนาคาร */
    slipLabel: process.env.GMAIL_SLIP_LABEL?.trim() || '',
  },
  /** รหัสเปิด PDF statement ที่ใส่รหัส (เช่น K-eDocument ของ KBank) — ดึงจาก Gmail แล้วถอดรหัสฝั่ง server */
  statement: {
    pdfPassword: process.env.STATEMENT_PDF_PASSWORD?.trim() || '',
  },
  seedDemo: process.env.SEED_DEMO !== '0',
};

export const flags = {
  get geminiEnabled() {
    return config.gemini.apiKey.length > 0;
  },
  get groqEnabled() {
    return config.groq.apiKey.length > 0;
  },
  /** มี provider สำหรับงาน text อย่างน้อยหนึ่งตัว (Groq หรือ Gemini) */
  get textAiEnabled() {
    return config.groq.apiKey.length > 0 || config.gemini.apiKey.length > 0;
  },
  get gmailConfigured() {
    return config.gmail.clientId.length > 0 && config.gmail.clientSecret.length > 0;
  },
};
