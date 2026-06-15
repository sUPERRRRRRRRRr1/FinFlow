import type { Parser } from './common.js';
import { scanStatement } from './statementScanner.js';

/** Parser สำหรับ statement ของ TrueMoney Wallet */
export const truemoneyParser: Parser = {
  source: 'truemoney',
  label: 'TrueMoney Wallet',
  matches(text, ctx) {
    const hay = `${ctx.sender ?? ''} ${ctx.filename ?? ''} ${text.slice(0, 400)}`.toLowerCase();
    return (
      hay.includes('truemoney') ||
      hay.includes('true money') ||
      hay.includes('ascend') ||
      hay.includes('ทรูมันนี่')
    );
  },
  parse(text) {
    return scanStatement(text, 'truemoney');
  },
};
