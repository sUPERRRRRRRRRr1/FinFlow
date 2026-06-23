import type { Transaction } from '@finflow/shared';
import { classifyByKeyword, deduplicate, matchTransfers, fingerprint } from '@finflow/shared';

export interface IngestStats {
  received: number;
  added: number;
  duplicatesRemoved: number;
  transfersMatched: number;
}

export interface IngestResult {
  transactions: Transaction[];
  stats: IngestStats;
}

/**
 * Pipeline กลางของ FinFlow:
 *   raw → จัดหมวด (ถ้ายังไม่มี) → กันซ้ำข้ามแหล่ง → จับคู่การโอนข้ามกระเป๋า
 *
 * เป็น pure function (ไม่ยุ่งกับ DB) เพื่อให้เทสต์ได้และนำกลับมาใช้ซ้ำได้
 * การจัดหมวดด้วย AI (Gemini) เป็น optional ทำที่ชั้น route ก่อนเรียกฟังก์ชันนี้
 */
/** รายการที่ "ดูเป็นจริง": ผู้รับไม่ยาวผิดปกติ (ไม่ใช่ก้อนข้อความเงื่อนไข/หัวกระดาษ) และวันที่ถูกรูปแบบ ปี 4 หลักสมเหตุสมผล */
function isPlausibleTxn(t: Transaction): boolean {
  const cp = t.counterparty ?? '';
  const y = Number((t.date ?? '').slice(0, 4));
  return (
    cp.length > 0 &&
    cp.length <= 120 &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? '') &&
    y >= 2000 &&
    y <= 2100
  );
}

export function ingestTransactions(raw: Transaction[]): IngestResult {
  // 0) ทิ้งรายการขยะ (ข้อความเงื่อนไข/หัวกระดาษ STM ที่ parser อ่านพลาด) ก่อนเข้า pipeline
  raw = raw.filter(isPlausibleTxn);
  // 1) จัดหมวดด้วย keyword สำหรับรายการที่ยังไม่ถูกจัดหมวด (offline classifier)
  const classified = raw.map((t) => {
    if (!t.category || t.category === 'other') {
      return { ...t, category: classifyByKeyword(t.counterparty || t.rawDesc || '', t.direction) };
    }
    return t;
  });

  // 2) กันรายการซ้ำข้ามแหล่ง (statement + สลิป)
  const { unique, duplicates } = deduplicate(classified);

  // 3) จับคู่การโอนระหว่างกระเป๋า (ไม่นับเป็นรายรับ/จ่ายซ้ำ)
  const { tagged, matches } = matchTransfers(unique);

  // ใส่ fingerprint ให้ครบ
  const finalized = tagged.map((t) => ({ ...t, fingerprint: t.fingerprint ?? fingerprint(t) }));

  return {
    transactions: finalized,
    stats: {
      received: raw.length,
      added: finalized.length,
      duplicatesRemoved: duplicates.length,
      transfersMatched: matches.length,
    },
  };
}
