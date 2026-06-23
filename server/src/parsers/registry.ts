import type { Transaction } from '@finflow/shared';
import type { Parser, ParserContext } from './common.js';
import { scanStatement } from './statementScanner.js';
import { parseTrueMoneyStatement, isTrueMoneyStatement } from './truemoneyStatement.js';
import { kbankParser } from './kbank.js';
import { makeParser } from './make.js';
import { truemoneyParser } from './truemoney.js';

/** ทะเบียน parser ทั้งหมด — เพิ่มแหล่งใหม่ = เพิ่มไฟล์ + ใส่ในอาเรย์นี้ */
export const PARSERS: Parser[] = [kbankParser, makeParser, truemoneyParser];

/** เลือก parser ที่ตรงกับผู้ส่งอีเมล/ไฟล์/เนื้อหา */
export function pickParser(text: string, ctx: ParserContext = {}): Parser | null {
  return PARSERS.find((p) => p.matches(text, ctx)) ?? null;
}

/**
 * แปลงข้อความ statement → รายการ โดยเลือก parser อัตโนมัติ
 * ถ้าไม่ตรง parser ใดเลย ใช้ตัวสแกนทั่วไป (source = manual)
 */
export function parseStatement(text: string, ctx: ParserContext = {}): {
  source: string;
  transactions: Transaction[];
} {
  // TrueMoney STM ตรวจก่อน: เนื้อหามีคำว่า "kbank..." (ช่องทางเติมเงิน) ทำให้ kbankParser แย่ง match ผิด
  if (isTrueMoneyStatement(text)) return { source: 'truemoney', transactions: parseTrueMoneyStatement(text) };
  const parser = pickParser(text, ctx);
  if (parser) return { source: parser.source, transactions: parser.parse(text, ctx) };
  return { source: 'manual', transactions: scanStatement(text, 'manual') };
}
