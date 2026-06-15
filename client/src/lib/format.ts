/** จัดรูปแบบเงินบาท */
export function thb(n: number, withSign = false): string {
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿`;
}

/** ตัวเลขทั่วไป */
export function num(n: number, digits = 0): string {
  return n.toLocaleString('th-TH', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** เปอร์เซ็นต์ */
export function pct(n: number, digits = 1): string {
  return `${n.toLocaleString('th-TH', { maximumFractionDigits: digits })}%`;
}

/** ย่อจำนวนเงิน เช่น 45,000 → 45K, 1,200,000 → 1.2M */
export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

const SEV_CLASS: Record<string, string> = {
  good: 'good',
  info: 'info',
  warn: 'warn',
  alert: 'alert',
};
export function sevClass(s: string): string {
  return SEV_CLASS[s] ?? 'info';
}
