import type { Parser } from './common.js';
import { scanStatement } from './statementScanner.js';

/** Parser สำหรับ statement ของ KBank (K PLUS) */
export const kbankParser: Parser = {
  source: 'kbank',
  label: 'KBank (K PLUS)',
  matches(text, ctx) {
    const hay = `${ctx.sender ?? ''} ${ctx.filename ?? ''} ${text.slice(0, 400)}`.toLowerCase();
    return (
      hay.includes('kasikornbank') ||
      hay.includes('kasikorn') ||
      hay.includes('kbank') ||
      hay.includes('k plus') ||
      hay.includes('ธนาคารกสิกรไทย')
    );
  },
  parse(text) {
    return scanStatement(text, 'kbank');
  },
};
