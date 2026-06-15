import { GoogleGenerativeAI } from '@google/generative-ai';
import type { HealthScore, Insight } from '@finflow/shared';
import { config, flags } from '../config.js';
import type { SafeTransaction } from '../sanitize.js';

let client: GoogleGenerativeAI | null = null;
function model() {
  if (!flags.geminiEnabled) return null;
  client ??= new GoogleGenerativeAI(config.gemini.apiKey);
  return client.getGenerativeModel({ model: config.gemini.model });
}

async function generate(prompt: string): Promise<string | null> {
  const m = model();
  if (!m) return null;
  try {
    const res = await m.generateContent(prompt);
    return res.response.text().trim();
  } catch (err) {
    console.error('[gemini] error:', (err as Error).message);
    return null;
  }
}

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

/**
 * เขียนคำแนะนำสุขภาพการเงินเป็นภาษาคน
 * ตัวเลขทั้งหมดคำนวณด้วยโค้ดเราเอง — LLM แค่เรียบเรียง (ถ้าไม่มี key ใช้ template)
 */
export async function financialAdvice(health: HealthScore, insights: Insight[]): Promise<{
  text: string;
  source: 'gemini' | 'rule-based';
}> {
  const facts = [
    `คะแนนสุขภาพการเงิน: ${health.total}/100 (${health.grade})`,
    ...health.components.map((c) => `- ${c.label}: ${c.score}/100 — ${c.detail}`),
    ...insights.map((i) => `- ${i.title}: ${i.text}`),
  ].join('\n');

  const prompt = `คุณเป็นที่ปรึกษาการเงินส่วนบุคคลที่เป็นมิตรและกระชับ พูดภาษาไทย
ด้านล่างคือผลวิเคราะห์การเงิน (ตัวเลขคำนวณมาแล้ว ห้ามแก้ตัวเลข):
${facts}

เขียนคำแนะนำ 3-4 ข้อแบบ bullet สั้นๆ เป็นกันเอง ให้กำลังใจ และชี้จุดที่ควรปรับปรุงที่สำคัญที่สุด อย่าใช้ศัพท์เทคนิคเกินจำเป็น`;

  const ai = await generate(prompt);
  if (ai) return { text: ai, source: 'gemini' };

  // Fallback: เรียบเรียงจาก insight แบบ rule-based
  const weakest = [...health.components].sort((a, b) => a.score - b.score)[0];
  const lines = [
    `คะแนนสุขภาพการเงินของคุณอยู่ที่ ${health.total}/100 (${health.grade})`,
    weakest ? `จุดที่ควรปรับปรุงที่สุดคือ "${weakest.label}" — ${weakest.detail}` : '',
    ...insights.filter((i) => i.severity === 'alert' || i.severity === 'warn').map((i) => `• ${i.title}: ${i.text}`),
    '• ลองตั้งงบรายหมวดและออมอัตโนมัติทุกเดือนเพื่อรักษาวินัยการเงิน',
  ].filter(Boolean);
  return { text: lines.join('\n'), source: 'rule-based' };
}

/**
 * ตอบคำถามแบบ RAG: ข้อเท็จจริง+ตัวเลขถูกคำนวณด้วยโค้ดเราแล้ว ส่งให้ LLM เรียบเรียงเท่านั้น
 */
export async function answerQuestion(
  question: string,
  facts: string,
  sample: SafeTransaction[],
): Promise<{ text: string; source: 'gemini' | 'rule-based' }> {
  const ctx = sample
    .slice(0, 40)
    .map((t) => `${t.date} ${t.direction === 'out' ? '-' : '+'}${fmt(t.amount)} ${t.merchant} [${t.category}]`)
    .join('\n');

  const prompt = `คุณเป็นผู้ช่วยการเงินส่วนตัว พูดภาษาไทย ตอบกระชับและอ้างอิงเฉพาะข้อมูลด้านล่าง
ห้ามแต่งตัวเลขเอง ใช้ตัวเลขสรุปที่ให้มาเท่านั้น

== ตัวเลขสรุป (คำนวณแล้ว) ==
${facts}

== ตัวอย่างรายการที่เกี่ยวข้อง ==
${ctx || '(ไม่มี)'}

คำถาม: ${question}
ตอบ:`;

  const ai = await generate(prompt);
  if (ai) return { text: ai, source: 'gemini' };
  return {
    text: `จากข้อมูลของคุณ:\n${facts}`,
    source: 'rule-based',
  };
}

/**
 * จัดหมวดด้วย AI (optional) — รับรายชื่อร้าน คืน map ร้าน→หมวด
 * ถ้าไม่มี key คืน null ให้ผู้เรียกใช้ keyword classifier แทน
 */
export async function categorizeWithAI(merchants: string[]): Promise<Record<string, string> | null> {
  if (!flags.geminiEnabled || merchants.length === 0) return null;
  const cats = 'income,food,shopping,transport,bills,entertainment,health,education,transfer,savings,other';
  const prompt = `จัดหมวดร้านค้า/รายการต่อไปนี้ ตอบเป็น JSON object {"ชื่อ":"หมวด"} เท่านั้น
หมวดที่ใช้ได้: ${cats}
รายการ:
${merchants.map((m) => `- ${m}`).join('\n')}`;
  const ai = await generate(prompt);
  if (!ai) return null;
  try {
    const json = ai.slice(ai.indexOf('{'), ai.lastIndexOf('}') + 1);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
