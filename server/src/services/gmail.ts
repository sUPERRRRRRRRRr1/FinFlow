import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Transaction } from '@finflow/shared';
import { config, flags } from '../config.js';
import { parseStatement } from '../parsers/registry.js';
import { parseSlip } from '../parsers/slip.js';
import { ocrSlip } from './ocr.js';
import { extractPdfText } from './pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.resolve(__dirname, '..', '..', 'data', 'tokens.json');

/** scope อ่านอย่างเดียว — ไม่ขอสิทธิ์ลบ/ส่ง */
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/** ผู้ส่งอีเมลของธนาคาร/กระเป๋าเงิน ที่อนุญาตให้เข้าถึง (allow-list) */
const BANK_SENDERS = [
  'kasikornbank.com',
  'kbank.co.th',
  'truemoney.com',
  'ascendcorp.com',
  'scb.co.th',
  'krungsri.com',
];

function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret, config.gmail.redirectUri);
}

export function isConnected(): boolean {
  return existsSync(TOKEN_PATH);
}

export function getAuthUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens), 'utf-8');
}

function authedClient(): OAuth2Client {
  const client = oauthClient();
  client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')));
  return client;
}

function decodeBody(data?: string): string {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/** ดึงข้อความ text/plain จาก payload ของเมล (เดินทุก part) */
function extractText(payload: any): string {
  let text = '';
  const walk = (p: any) => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data) text += decodeBody(p.body.data) + '\n';
    if (p.parts) p.parts.forEach(walk);
  };
  walk(payload);
  return text;
}

function headerValue(headers: any[], name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** เก็บรูปภาพแนบ/inline ทั้งหมดในเมล (สลิปมักเป็นรูป) */
async function imageAttachments(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  payload: any,
): Promise<{ data: string; mime: string }[]> {
  const out: { data: string; mime: string }[] = [];
  const parts: any[] = [];
  const collect = (p: any) => {
    if (!p) return;
    if (p.mimeType?.startsWith('image/')) parts.push(p);
    if (p.parts) p.parts.forEach(collect);
  };
  collect(payload);

  for (const p of parts) {
    let raw = p.body?.data as string | undefined;
    if (!raw && p.body?.attachmentId) {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: p.body.attachmentId,
      });
      raw = att.data.data ?? undefined;
    }
    if (raw) {
      // base64url → base64 มาตรฐาน (ให้ OCR/Buffer อ่านได้)
      out.push({ data: raw.replace(/-/g, '+').replace(/_/g, '/'), mime: p.mimeType });
    }
  }
  return out;
}

/** เก็บ PDF statement ที่ใส่รหัส (K-eDocument: ไฟล์ STM_SA*.pdf) — ข้ามเอกสารทั่วไป */
async function statementPdfs(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  payload: any,
): Promise<Buffer[]> {
  const parts: any[] = [];
  const collect = (p: any) => {
    if (!p) return;
    // รับเฉพาะไฟล์ statement จริง (ชื่อขึ้นต้น STM_ เช่น STM_SA*, STM_TMN*) — กันไฟล์แนบอื่น
    // (เช่น channel_bankuse.pdf, เอกสารข้อกำหนด/เงื่อนไข) ถูก parse เป็นรายการขยะ
    if (p.mimeType === 'application/pdf' && /^STM_/i.test(p.filename ?? '')) parts.push(p);
    if (p.parts) p.parts.forEach(collect);
  };
  collect(payload);

  const out: Buffer[] = [];
  for (const p of parts) {
    let raw = p.body?.data as string | undefined;
    if (!raw && p.body?.attachmentId) {
      const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: p.body.attachmentId });
      raw = att.data.data ?? undefined;
    }
    if (raw) out.push(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  }
  return out;
}

/**
 * ปลดล็อก + ดึงข้อความจาก PDF โดยลองหลายรหัส (รหัส STM ที่ผู้ใช้บันทึกไว้ส่งมาจาก client)
 * ลองไม่ใส่รหัสก่อน แล้วไล่รหัสที่ให้มา — ใช้ตัวแรกที่อ่านได้ (รหัสใช้ชั่วคราว ไม่เก็บลง DB)
 */
async function extractPdfWithPasswords(buf: Buffer, passwords: string[]): Promise<string | null> {
  for (const pw of ['', ...passwords]) {
    const text = await extractPdfText(buf, pw);
    if (text && text.trim()) return text;
  }
  return null;
}

/**
 * ดึงเมลธนาคาร/กระเป๋าเงิน (+ป้ายสลิปที่ผู้ใช้ตั้ง) ย้อนหลัง แล้วแปลงเป็นรายการ
 * 3 ทาง ต่อ 1 เมล:
 *   1) statement/notification เป็นข้อความ → parser
 *   2) สลิปเป็นข้อความใน body → parseSlip
 *   3) สลิปเป็น "รูปภาพแนบ/inline" → OCR (Gemini/Tesseract) → parseSlip
 * ความเป็นส่วนตัว: กรองเฉพาะผู้ส่ง allow-list หรือป้ายที่ผู้ใช้กำหนด ไม่แตะเมลอื่น
 * หมายเหตุ: statement PDF ใส่รหัส → ปลดล็อคฝั่ง client แล้วอัปโหลดข้อความแทน
 */
export async function fetchBankTransactions(
  maxResults = 250,
  windowExpr = 'newer_than:13m',
  pdfPasswords: string[] = [],
): Promise<Transaction[]> {
  if (!flags.gmailConfigured) throw new Error('ยังไม่ได้ตั้งค่า Gmail OAuth (ดู .env.example)');
  if (!isConnected()) throw new Error('ยังไม่ได้เชื่อมต่อ Gmail (เรียก /api/auth/google ก่อน)');

  const gmail = google.gmail({ version: 'v1', auth: authedClient() });
  const fromQuery = BANK_SENDERS.map((s) => `from:${s}`).join(' OR ');
  const scope = config.gmail.slipLabel
    ? `((${fromQuery}) OR label:${config.gmail.slipLabel})`
    : `(${fromQuery})`;
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `${scope} ${windowExpr}`,
    maxResults,
  });

  const out: Transaction[] = [];
  for (const msg of list.data.messages ?? []) {
    if (!msg.id) continue;
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
    const payload = full.data.payload;
    const headers = payload?.headers ?? [];
    const sender = headerValue(headers, 'from');
    const subject = headerValue(headers, 'subject');

    // (1)(2) ข้อความ: statement ก่อน ถ้าไม่ใช่ลองอ่านเป็นสลิป
    const text = extractText(payload);
    if (text) {
      const { transactions } = parseStatement(text, { sender, filename: subject });
      if (transactions.length > 0) out.push(...transactions);
      else {
        const slip = parseSlip(text);
        if (slip) out.push(slip);
      }
    }

    // (3) รูปภาพแนบ → OCR → สลิป
    const images = await imageAttachments(gmail, msg.id, payload);
    for (const img of images) {
      const ocr = await ocrSlip(img.data, img.mime);
      if (ocr.text) {
        const slip = parseSlip(ocr.text);
        if (slip) out.push(slip);
      }
    }

    // (4) PDF รายการเดินบัญชี (ใส่รหัส) → ลองรหัสที่ผู้ใช้บันทึกไว้ → แยกทุกรายการ
    const pdfs = await statementPdfs(gmail, msg.id, payload);
    for (const buf of pdfs) {
      const pdfText = await extractPdfWithPasswords(buf, pdfPasswords);
      if (!pdfText) continue;
      // ให้ registry เลือก parser (KBank STM → parseSavingsStatement, TrueMoney STM/อื่นๆ ตามผู้ส่ง/เนื้อหา)
      // ทางเดียวกับการอัปโหลดเอง เพื่อไม่ให้ผลลัพธ์ต่างกันระหว่าง 2 ช่องทาง
      out.push(...parseStatement(pdfText, { sender, filename: subject }).transactions);
    }
  }
  return out;
}
