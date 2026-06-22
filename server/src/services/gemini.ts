import { GoogleGenerativeAI } from '@google/generative-ai';
import type { HealthScore, Insight, TaxOverview } from '@finflow/shared';
import { config, flags } from '../config.js';
import { groqGenerate } from './groq.js';
import type { SafeTransaction } from '../sanitize.js';

/** ที่มาของข้อความที่ LLM เรียบเรียง (OCR ใช้ Gemini/Tesseract แยกใน ocr.ts) */
export type TextSource = 'groq' | 'gemini' | 'rule-based';

let client: GoogleGenerativeAI | null = null;
function geminiModel() {
  if (!flags.geminiEnabled) return null;
  client ??= new GoogleGenerativeAI(config.gemini.apiKey);
  return client.getGenerativeModel({ model: config.gemini.model });
}

async function geminiGenerate(prompt: string): Promise<string | null> {
  const m = geminiModel();
  if (!m) return null;
  try {
    const res = await m.generateContent(prompt);
    return res.response.text().trim();
  } catch (err) {
    console.error('[gemini] error:', (err as Error).message);
    return null;
  }
}

/**
 * เรียบเรียงข้อความด้วย LLM: ลอง Groq ก่อน (ถ้าตั้ง GROQ_API_KEY) แล้วค่อย Gemini
 * คืน null ถ้าไม่มี provider ไหนตอบ ให้ผู้เรียกใช้ fallback แบบ rule-based
 */
async function generate(prompt: string): Promise<{ text: string; source: Exclude<TextSource, 'rule-based'> } | null> {
  const viaGroq = await groqGenerate(prompt);
  if (viaGroq) return { text: viaGroq, source: 'groq' };
  const viaGemini = await geminiGenerate(prompt);
  if (viaGemini) return { text: viaGemini, source: 'gemini' };
  return null;
}

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

/**
 * เขียนคำแนะนำสุขภาพการเงินเป็นภาษาคน
 * ตัวเลขทั้งหมดคำนวณด้วยโค้ดเราเอง — LLM แค่เรียบเรียง (ถ้าไม่มี key ใช้ template)
 */
export async function financialAdvice(health: HealthScore, insights: Insight[]): Promise<{
  text: string;
  source: TextSource;
}> {
  const facts = [
    `คะแนนสุขภาพการเงิน: ${health.total}/100 (${health.grade})`,
    ...health.pillars.map(
      (p) => `- เสา${p.label} ${p.score}/100${p.estimated ? ' (ประมาณ)' : ''}: ${p.metrics.map((m) => `${m.label} ${m.score}`).join(', ')}`,
    ),
    ...insights.map((i) => `- ${i.title}: ${i.text}`),
  ].join('\n');

  const prompt = `คุณเป็นที่ปรึกษาการเงินส่วนบุคคลที่เป็นมิตรและกระชับ พูดภาษาไทย
ด้านล่างคือผลวิเคราะห์การเงิน (ตัวเลขคำนวณมาแล้ว ห้ามแก้ตัวเลข):
${facts}

เขียนคำแนะนำ 3-4 ข้อแบบ bullet สั้นๆ เป็นกันเอง ให้กำลังใจ และชี้จุดที่ควรปรับปรุงที่สำคัญที่สุด อย่าใช้ศัพท์เทคนิคเกินจำเป็น`;

  const ai = await generate(prompt);
  if (ai) return { text: ai.text, source: ai.source };

  // Fallback: เรียบเรียงจาก insight แบบ rule-based
  const weakest = [...health.pillars].sort((a, b) => a.score - b.score)[0];
  const weakestMetric = weakest ? [...weakest.metrics].sort((a, b) => a.score - b.score)[0] : undefined;
  const lines = [
    `คะแนนสุขภาพการเงินของคุณอยู่ที่ ${health.total}/100 (${health.grade})`,
    weakest && weakestMetric ? `จุดที่ควรปรับปรุงที่สุดคือเสา "${weakest.label}" — ${weakestMetric.detail}` : '',
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
): Promise<{ text: string; source: TextSource }> {
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
  if (ai) return { text: ai.text, source: ai.source };
  return {
    text: `จากข้อมูลของคุณ:\n${facts}`,
    source: 'rule-based',
  };
}

/** เรียบเรียงคำแนะนำภาษีเป็นภาษาคน (ตัวเลขคำนวณมาแล้ว ห้ามแก้) */
export async function taxAdvice(o: TaxOverview): Promise<{ text: string; source: TextSource }> {
  const r = o.result;
  const facts = [
    `เงินได้สุทธิ ${fmt(r.netIncome)} บาท, ภาษีก่อนเครดิต ${fmt(r.taxBeforeCredit)} บาท`,
    r.taxDue >= 0 ? `ต้องจ่ายเพิ่ม ${fmt(r.taxDue)} บาท` : `ขอคืนได้ ${fmt(-r.taxDue)} บาท`,
    `อัตราภาษีขั้นสุดท้าย ${(r.marginalRate * 100).toFixed(0)}%`,
    ...o.suggestions.slice(0, 4).map((s) => `- ${s.label}: ซื้อเพิ่มได้ ${fmt(s.room)} ประหยัด ~${fmt(s.estimatedSaving)}`),
    o.filing.mustFile ? `ต้องยื่น ${o.filing.form} ภายใน ${o.filing.deadlineOnline} (ออนไลน์)` : 'รายได้ยังไม่ถึงเกณฑ์ต้องยื่น',
  ].join('\n');

  const prompt = `คุณเป็นที่ปรึกษาภาษีไทยที่กระชับและเป็นกันเอง พูดภาษาไทย
ด้านล่างคือผลคำนวณภาษี (ตัวเลขถูกต้องแล้ว ห้ามแก้ตัวเลข):
${facts}

เขียนคำแนะนำ 3-4 ข้อแบบ bullet เน้นวิธีประหยัดภาษีที่คุ้มที่สุดและการยื่นให้ทันกำหนด ปิดท้ายว่าเป็นการประมาณการ ควรตรวจกับสรรพากร/นักบัญชี`;

  const ai = await generate(prompt);
  if (ai) return { text: ai.text, source: ai.source };

  const lines = [
    r.taxDue >= 0 ? `คุณมีภาษีต้องจ่ายประมาณ ${fmt(r.taxDue)} บาท` : `คุณน่าจะขอคืนภาษีได้ประมาณ ${fmt(-r.taxDue)} บาท`,
    ...o.suggestions.slice(0, 3).map((s) => `• ${s.label} อีก ${fmt(s.room)} บาท จะช่วยประหยัดภาษีได้ราว ${fmt(s.estimatedSaving)} บาท`),
    o.filing.mustFile ? `• อย่าลืมยื่น ${o.filing.form} ภายใน ${o.filing.deadlineOnline}` : '',
    '• ตัวเลขเป็นการประมาณการ ควรตรวจสอบกับกรมสรรพากรหรือนักบัญชีก่อนยื่นจริง',
  ].filter(Boolean);
  return { text: lines.join('\n'), source: 'rule-based' };
}

/**
 * จัดหมวดด้วย AI (optional) — รับรายชื่อร้าน คืน map ร้าน→หมวด
 * ถ้าไม่มี key คืน null ให้ผู้เรียกใช้ keyword classifier แทน
 */
export async function categorizeWithAI(
  merchants: string[],
  examples: { name: string; category: string }[] = [],
): Promise<Record<string, string> | null> {
  if (!flags.textAiEnabled || merchants.length === 0) return null;
  const cats = 'income,food,shopping,transport,bills,entertainment,health,education,transfer,savings,other';
  // #3 few-shot จากกฎที่ผู้ใช้ตั้งเอง → AI เลียนแบบสไตล์การจัดหมวดของผู้ใช้
  const exampleBlock = examples.length
    ? `\nตัวอย่างที่ผู้ใช้เคยจัดเอง (ยึดตามนี้ถ้าตรงกัน):\n${examples
        .slice(0, 25)
        .map((e) => `- ${e.name} → ${e.category}`)
        .join('\n')}`
    : '';
  const prompt = `จัดหมวดร้านค้า/ผู้รับเงินต่อไปนี้ ตอบเป็น JSON object {"ชื่อ":"หมวด"} เท่านั้น
หมวดที่ใช้ได้: ${cats}
แนวทาง:
- โฟกัส "ชื่อร้านจริง" — ถ้ามีชื่อโซน/ชั้นห้าง (ชั้น, แฟชั่น, พลาซ่า, โซน) หรือชื่อนิติบุคคล (บจก./บมจ./หจก.) ปนมา ให้มองข้าม
- จัดตามประเภทกิจการ: ชา/กาแฟ/วุ้น/ขนม/ข้าว/ก๋วยเตี๋ยว/หมูกระทะ→food · จักรยาน/BIKE/ปะยาง/อู่/น้ำมัน→transport · เสื้อผ้า/รองเท้า/เครื่องสำอาง→shopping · คลินิก/ยา/รพ.→health · ค่าน้ำ/ค่าไฟ/เน็ต→bills
- ชื่อบุคคล (นาย/นาง/นางสาว/น.ส./ด.ช./ด.ญ.) = โอนส่วนตัว ใช้ "transfer"${exampleBlock}
รายการ:
${merchants.map((m) => `- ${m}`).join('\n')}`;
  // จัดหมวด: ใช้ Gemini ก่อน (เก่งเรื่องแบรนด์/ร้านเฉพาะ) ถ้าไม่ได้ค่อยถอยไป Groq
  const text = (await geminiGenerate(prompt)) ?? (await groqGenerate(prompt));
  if (!text) return null;
  try {
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
