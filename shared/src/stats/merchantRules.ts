import type { MerchantRule, Transaction } from '../types.js';

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, '').trim();
}

/**
 * ใช้กฎร้านค้าที่ผู้ใช้กำหนดกับชุดธุรกรรม (pure function)
 *  - จับคู่ด้วยเลขบัญชี (accountRef) ก่อน ถ้าไม่ตรงค่อยจับด้วยชื่อผู้รับ
 *  - กฎจะ override "หมวด" และตั้ง "ชื่อร้าน (alias)" ให้
 *  - ข้ามรายการที่เป็นการโอนระหว่างกระเป๋า (คงหมวด transfer)
 *
 * เพราะหมวดถูกเปลี่ยนในข้อมูลจริง ทุกการวิเคราะห์ที่อ่านจากธุรกรรม
 * (Sankey, แนวโน้มหมวด, คะแนนสุขภาพ, งบประมาณ) จะอัปเดตตามโดยอัตโนมัติ
 */
export function applyMerchantRules(txns: Transaction[], rules: MerchantRule[]): Transaction[] {
  if (rules.length === 0) return txns;
  const byAccount = new Map<string, MerchantRule>();
  const byName = new Map<string, MerchantRule>();
  for (const r of rules) {
    if (r.matchType === 'account') byAccount.set(r.matchValue, r);
    else byName.set(norm(r.matchValue), r);
  }

  return txns.map((t) => {
    if (t.isTransfer) return t;
    const rule = (t.accountRef ? byAccount.get(t.accountRef) : undefined) ?? byName.get(norm(t.counterparty));
    if (!rule) return t;
    return { ...t, category: rule.category, alias: rule.alias || t.alias };
  });
}

/** ชื่อที่ควรแสดง: ใช้ alias ที่ผู้ใช้ตั้งก่อน ถ้าไม่มีใช้ชื่อเดิม */
export function displayName(t: Transaction): string {
  return t.alias || t.counterparty;
}
