import type { Transaction, CategoryId, OwnAccountCode } from '@finflow/shared';
import { applyMerchantRules, ALL_CATEGORIES, tagOwnTransfers, accountLast4 } from '@finflow/shared';
import {
  getAllTransactions,
  replaceAllTransactions,
  setMeta,
  getRules,
  getAccounts,
} from '../db.js';
import { ingestTransactions } from './ingest.js';
import { categorizeWithAI } from './gemini.js';

/**
 * รับรายการใหม่ → รวมกับของเดิม → ผ่าน pipeline กลาง (จัดหมวด → กันซ้ำ → จับคู่การโอน)
 * → บันทึก baseline (autoCategory) → ใช้กฎร้านค้าทับ → บันทึกทับทั้งหมด
 * ใช้ร่วมกันโดย route: นำเข้า statement / สลิป / Gmail / เพิ่มรายการเอง
 */
/**
 * เติมหมวดด้วย AI (Groq) ให้รายการที่ keyword จัดไม่ได้ (ยังเป็น 'other')
 * ส่งชื่อร้าน/ผู้รับที่ไม่ซ้ำไป LLM ทีเดียว แล้ว map กลับ — ถ้า AI ปิด/พลาด คืนของเดิม (ไม่พัง)
 */
/**
 * #1 ทำความสะอาดชื่อร้าน/ผู้รับ ก่อนส่งให้ AI จัดหมวด
 * ตัด noise ที่ทำให้เดาพลาด: (ชื่อบัญชี/นิติบุคคล), ชั้น/โซนห้าง, เลขบัญชี
 * เช่น "ชาตักวุ้น แฟชั่น ชั้น B (ชื่อบัญชี: บจก. ...)" → "ชาตักวุ้น"
 */
export function cleanMerchantName(name: string): string {
  const s = (name || '')
    .replace(/\([^)]*(?:ชื่อบัญชี|บจก\.|บมจ\.|หจก\.|co\.,?\s*ltd|company)[^)]*\)/gi, ' ')
    .replace(/ชั้น\s*[A-Za-z0-9]+/g, ' ')
    .replace(/(?:^|\s)(?:แฟชั่น|พลาซ่า|พลาซา|โซน|ฟลอร์|floor|zone|plaza)(?=\s|$)/gi, ' ')
    .replace(/[xX]{2,}[-\dxX]{2,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s || (name || '').trim();
}

async function aiEnrichCategories(txns: Transaction[]): Promise<Transaction[]> {
  const valid = new Set<string>(ALL_CATEGORIES);
  const others = txns.filter((t) => t.category === 'other' && !t.isTransfer && t.counterparty);
  const uniqueCleaned = [...new Set(others.map((t) => cleanMerchantName(t.counterparty)))];
  if (uniqueCleaned.length === 0) return txns;
  // #3 ใส่กฎที่ผู้ใช้ตั้งเองเป็น few-shot (เฉพาะกฎแบบชื่อ) → AI เลียนแบบสไตล์ผู้ใช้
  const examples = getRules()
    .filter((r) => r.matchType === 'name')
    .map((r) => ({ name: cleanMerchantName(r.matchValue), category: r.category }));
  const map = await categorizeWithAI(uniqueCleaned, examples);
  if (!map) return txns;
  return txns.map((t) => {
    if (t.category === 'other' && !t.isTransfer) {
      const cat = map[cleanMerchantName(t.counterparty)];
      if (cat && cat !== 'other' && valid.has(cat)) {
        return { ...t, category: cat as CategoryId, autoCategory: cat as CategoryId };
      }
    }
    return t;
  });
}

/** เลข 4 ตัวท้าย + ชนิด ของบัญชีที่ผู้ใช้ตั้งค่าไว้ — ใช้ตรวจจับการโอนระหว่างบัญชีตัวเอง */
function ownAccountCodes(): OwnAccountCode[] {
  return getAccounts()
    .map((a) => ({ code: accountLast4(a.id) ?? '', kind: a.kind, account: a.id }))
    .filter((a) => a.code);
}

export async function ingestAndStore(newTxns: Transaction[]) {
  const combined = [...getAllTransactions(), ...newTxns];
  const { transactions, stats } = ingestTransactions(combined);
  // ตั้งธงการโอนเข้าบัญชีตัวเอง (เช่น โอนเข้าบัญชีออม) จากเลข 4 ตัวท้าย — ไม่ให้ถูกนับเป็นรายจ่าย
  const owned = tagOwnTransfers(transactions, ownAccountCodes());
  // เติมหมวดด้วย AI ให้รายการที่ยังเป็น 'other' (เปิดเมื่อมี Groq/Gemini key)
  const enriched = await aiEnrichCategories(owned);
  // บันทึกหมวดที่ระบบจัดอัตโนมัติเป็น baseline (ถ้ายังไม่มี) ก่อนใช้กฎทับ
  const based = enriched.map((t) => ({ ...t, autoCategory: t.autoCategory ?? t.category }));
  const ruled = applyMerchantRules(based, getRules());
  replaceAllTransactions(ruled); // atomic: ลบ+ใส่ใหม่ในทรานแซกชันเดียว (insert พัง = rollback ข้อมูลเดิมอยู่ครบ)
  setMeta('ingestStats', JSON.stringify(stats));
  return { added: newTxns.length, total: ruled.length, stats };
}

/**
 * ใช้กฎร้านค้าใหม่กับธุรกรรมที่มีอยู่ทั้งหมด (เรียกเมื่อเพิ่ม/แก้/ลบกฎ)
 * คืนค่ากลับไปที่ baseline (autoCategory) ก่อน แล้วค่อยใช้กฎปัจจุบัน — ทำให้ลบกฎแล้ว revert ได้จริง
 * เปลี่ยนข้อมูลจริง → Sankey/แนวโน้มหมวด/คะแนนสุขภาพ/งบ อัปเดตตามทันที
 */
export function reapplyRules(): { affected: number; total: number } {
  const current = getAllTransactions();
  // รีเซ็ตกลับ baseline + ล้าง alias (alias มาจากกฎเท่านั้น)
  const base = current.map((t) => ({ ...t, category: t.autoCategory ?? t.category, alias: undefined }));
  const ruled = applyMerchantRules(base, getRules());
  let affected = 0;
  for (let i = 0; i < current.length; i++) {
    if (current[i]!.category !== ruled[i]!.category || current[i]!.alias !== ruled[i]!.alias) affected++;
  }
  replaceAllTransactions(ruled); // atomic
  return { affected, total: ruled.length };
}
