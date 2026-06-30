import type { Transaction, CategoryId, OwnAccountCode } from '@finflow/shared';
import { applyMerchantRules, ALL_CATEGORIES, matchTransfers, tagOwnTransfers, accountLast4 } from '@finflow/shared';
import {
  getAllTransactions,
  replaceAllTransactions,
  setMeta,
  getRules,
  getAccounts,
  getSelfNames,
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

/**
 * อีเมลแจ้งเตือน K PLUS ให้ "ยอดถอนได้" (= ยอดคงเหลือหลังรายการ) + บัญชีต้นทางแบบปิดบัง
 * parseSlip เก็บ "เลขที่เปิดเผย" ไว้ใน account (เลขล้วนสั้น เช่น '3798') — จับคู่กับบัญชีจริงที่ตั้งค่าไว้
 * แล้วผูก source/account ให้ถูกเล่ม เพื่อให้ balanceAfter ล่าสุดอัปเดต "เงินคงเหลือ" สดกว่า statement รายเดือน
 */
function resolveNotificationAccounts(txns: Transaction[]): Transaction[] {
  const accts = getAccounts();
  return txns.map((t) => {
    // hint = เลขล้วนสั้น (จากแจ้งเตือน) — เลขบัญชีเต็มมีขีดคั่น/ตัวอักษร จึงข้าม
    if (!t.account || /\D/.test(t.account) || t.account.length >= 9) return t;
    const matches = accts.filter((a) => a.id.replace(/\D/g, '').includes(t.account!));
    if (matches.length === 1) return { ...t, source: matches[0]!.source, account: matches[0]!.id };
    return { ...t, account: undefined }; // จับคู่ไม่ได้/กำกวม → กันไม่ให้กลายเป็นกระเป๋าขยะ
  });
}

export async function ingestAndStore(newTxns: Transaction[]) {
  const combined = [...getAllTransactions(), ...resolveNotificationAccounts(newTxns)];
  const { transactions, stats } = ingestTransactions(combined);
  // ตั้งธงการโอนเข้าบัญชีตัวเอง (เลข 4 ตัวท้าย หรือชื่อเจ้าของบัญชี) — ไม่ให้ถูกนับเป็นรายจ่าย
  const owned = tagOwnTransfers(transactions, ownAccountCodes(), getSelfNames());
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

/**
 * คำนวณ "การโอนระหว่างบัญชีตัวเอง" ใหม่ทั้งชุด — เรียกเมื่อผู้ใช้แก้ตั้งค่าบัญชี/ชื่อเจ้าของบัญชี
 * คืนหมวด+ธง transfer กลับ baseline ก่อน → matchTransfers → tagOwnTransfers (เลขบัญชี+ชื่อ) → ใช้กฎร้านค้าทับ
 * ไม่ทำ dedup/AI ซ้ำ (ข้อมูล dedup ไว้แล้ว) — เบา และกลับค่าได้สองทาง (เพิ่ม/ลบชื่อแล้ว un-tag ได้)
 */
export function retagTransfers(): { total: number } {
  const current = getAllTransactions();
  const base = current.map((t) => ({
    ...t,
    isTransfer: false,
    transferGroup: undefined,
    category: t.autoCategory ?? t.category,
  }));
  const { tagged } = matchTransfers(base);
  const owned = tagOwnTransfers(tagged, ownAccountCodes(), getSelfNames());
  const ruled = applyMerchantRules(owned, getRules());
  replaceAllTransactions(ruled); // atomic
  return { total: ruled.length };
}
