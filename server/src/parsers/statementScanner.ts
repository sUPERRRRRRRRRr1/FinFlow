import type { Source, Transaction } from '@finflow/shared';
import { makeTxn, parseThaiDate, parseTime, guessDirection, extractAccountNo } from './common.js';

const MONEY_RE = /([+-]?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g;

/**
 * ตัวสแกน statement แบบ line-based ที่ใช้ร่วมกันหลายธนาคาร
 * รับข้อความที่สกัดจาก PDF (เช่นด้วย pdfjs ฝั่ง client) แล้วแปลงเป็นรายการ
 *
 * heuristic ต่อบรรทัด:
 *  - หา "วันที่" — บรรทัดไม่มีวันที่ = ข้าม (header/footer)
 *  - หา "เวลา" (ถ้ามี)
 *  - หาเลขจำนวนเงิน (ต้องมีทศนิยม 2 ตำแหน่ง) — ตัวแรก = จำนวนเงิน, ตัวสุดท้าย = ยอดคงเหลือ (ถ้ามี ≥2 ตัว)
 *  - ทิศทาง: เครื่องหมาย +/- ก่อน, ถ้าไม่มีใช้คำใบ้ในรายละเอียด
 */
export function scanStatement(text: string, source: Source): Transaction[] {
  const out: Transaction[] = [];
  const lines = text.split(/\r?\n/);
  // เลขบัญชีจากหัว statement (ถ้ามี) — แยกหลายบัญชีในแบงก์เดียวกัน
  const account = extractAccountNo(text);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 8) continue;

    const date = parseThaiDate(trimmed);
    if (!date) continue;

    const time = parseTime(trimmed);

    const tokens: { sign: string; value: number; raw: string }[] = [];
    for (const m of trimmed.matchAll(MONEY_RE)) {
      const value = Number(m[2]!.replace(/,/g, ''));
      if (Number.isFinite(value)) tokens.push({ sign: m[1] ?? '', value, raw: m[0]! });
    }
    if (tokens.length === 0) continue;

    const amountTok = tokens[0]!;
    const balanceTok = tokens.length >= 2 ? tokens[tokens.length - 1] : undefined;

    // รายละเอียด = บรรทัดที่ตัดวันที่/เวลา/เลขเงินออก
    let desc = trimmed;
    desc = desc.replace(/(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s*[฀-๿.]+\s*\d{2,4})/, '');
    if (time) desc = desc.replace(time, '').replace(/\d{1,2}:\d{2}/, '');
    for (const t of tokens) desc = desc.replace(t.raw, '');
    desc = desc.replace(/\s{2,}/g, ' ').trim();

    // กันข้อความที่ไม่ใช่รายการ (เงื่อนไข/หัวกระดาษ/ข้อกำหนด) ที่บังเอิญมีวันที่+ตัวเลข
    // ชื่อร้าน/ผู้รับจริงสั้น (สูงสุดที่พบจริง ~100) — เผื่อขั้นต่ำ 120 ให้ตรงกับ ingest filter กันตัดของจริง
    if (desc.length > 120) continue;

    const direction =
      amountTok.sign === '-'
        ? 'out'
        : amountTok.sign === '+'
          ? 'in'
          : guessDirection(desc, 'out');

    out.push(
      makeTxn({
        date,
        time,
        amount: amountTok.value,
        direction,
        counterparty: desc,
        source,
        account,
        balanceAfter: balanceTok?.value,
        rawDesc: trimmed,
      }),
    );
  }

  return out;
}
