import type { Parser } from './common.js';
import { scanStatement } from './statementScanner.js';

/** Parser สำหรับ statement ของ Make by KBank */
export const makeParser: Parser = {
  source: 'make',
  label: 'Make by KBank',
  matches(text, ctx) {
    const hay = `${ctx.sender ?? ''} ${ctx.filename ?? ''} ${text.slice(0, 400)}`.toLowerCase();
    return hay.includes('make by kbank') || hay.includes('makebykbank') || hay.includes('make ');
  },
  parse(text) {
    return scanStatement(text, 'make');
  },
};
