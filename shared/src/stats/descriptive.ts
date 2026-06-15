/**
 * สถิติพื้นฐาน (descriptive statistics) — เขียนเองทั้งหมด
 * ใช้เป็นรากฐานของทุกฟีเจอร์วิเคราะห์
 */

/** ผลรวม */
export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** ค่าเฉลี่ยเลขคณิต (arithmetic mean) */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return sum(xs) / xs.length;
}

/**
 * ความแปรปรวน (variance)
 * @param sample true = sample variance (หาร n-1), false = population (หาร n)
 */
export function variance(xs: number[], sample = false): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (sample && n < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return ss / (sample ? n - 1 : n);
}

/** ส่วนเบี่ยงเบนมาตรฐาน (standard deviation) */
export function stdev(xs: number[], sample = false): number {
  return Math.sqrt(variance(xs, sample));
}

/**
 * สัมประสิทธิ์การแปรผัน (coefficient of variation, CV = SD / mean)
 * ใช้วัด "ความสม่ำเสมอ" ของการใช้จ่าย โดยไม่ขึ้นกับขนาดของตัวเลข
 */
export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return stdev(xs, true) / Math.abs(m);
}

/**
 * quantile แบบ linear interpolation (วิธี R type-7 / numpy ดีฟอลต์)
 * @param q ค่าระหว่าง 0..1
 */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base]!;
  const upper = sorted[Math.min(base + 1, sorted.length - 1)]!;
  return lower + rest * (upper - lower);
}

/** มัธยฐาน (median) */
export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

export interface IQRResult {
  q1: number;
  q3: number;
  iqr: number;
  /** ขอบล่าง Q1 - 1.5*IQR */
  lowerFence: number;
  /** ขอบบน Q3 + 1.5*IQR */
  upperFence: number;
}

/**
 * คำนวณ IQR และขอบเขต (fences) สำหรับตรวจจับ outlier
 * @param k ตัวคูณ (มาตรฐาน 1.5)
 */
export function iqr(xs: number[], k = 1.5): IQRResult {
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const spread = q3 - q1;
  return {
    q1,
    q3,
    iqr: spread,
    lowerFence: q1 - k * spread,
    upperFence: q3 + k * spread,
  };
}

/** ค่าต่ำสุด/สูงสุด */
export function min(xs: number[]): number {
  return xs.length ? Math.min(...xs) : 0;
}
export function max(xs: number[]): number {
  return xs.length ? Math.max(...xs) : 0;
}

/** จำกัดค่าให้อยู่ในช่วง [lo, hi] */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** ปัดทศนิยมจำนวนหลักที่กำหนด */
export function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
