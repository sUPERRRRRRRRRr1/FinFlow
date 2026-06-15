import type { Transaction } from '@finflow/shared';
import { applyMerchantRules } from '@finflow/shared';
import {
  getAllTransactions,
  insertTransactions,
  clearTransactions,
  setMeta,
  getRules,
} from '../db.js';
import { ingestTransactions } from './ingest.js';

/**
 * รับรายการใหม่ → รวมกับของเดิม → ผ่าน pipeline กลาง (จัดหมวด → กันซ้ำ → จับคู่การโอน)
 * → บันทึก baseline (autoCategory) → ใช้กฎร้านค้าทับ → บันทึกทับทั้งหมด
 * ใช้ร่วมกันโดย route: นำเข้า statement / สลิป / Gmail / เพิ่มรายการเอง
 */
export function ingestAndStore(newTxns: Transaction[]) {
  const combined = [...getAllTransactions(), ...newTxns];
  const { transactions, stats } = ingestTransactions(combined);
  // บันทึกหมวดที่ระบบจัดอัตโนมัติเป็น baseline (ถ้ายังไม่มี) ก่อนใช้กฎทับ
  const based = transactions.map((t) => ({ ...t, autoCategory: t.autoCategory ?? t.category }));
  const ruled = applyMerchantRules(based, getRules());
  clearTransactions();
  insertTransactions(ruled);
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
  clearTransactions();
  insertTransactions(ruled);
  return { affected, total: ruled.length };
}
