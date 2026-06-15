import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY?.trim() || '',
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash',
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID?.trim() || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET?.trim() || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:4000/api/auth/google/callback',
    /** ป้ายกำกับ (label) ใน Gmail ที่ผู้ใช้ forward สลิปมาเก็บไว้ (เช่น 'FinFlow') — เสริมจากเมลธนาคาร */
    slipLabel: process.env.GMAIL_SLIP_LABEL?.trim() || '',
  },
  seedDemo: process.env.SEED_DEMO !== '0',
};

export const flags = {
  get geminiEnabled() {
    return config.gemini.apiKey.length > 0;
  },
  get gmailConfigured() {
    return config.gmail.clientId.length > 0 && config.gmail.clientSecret.length > 0;
  },
};
