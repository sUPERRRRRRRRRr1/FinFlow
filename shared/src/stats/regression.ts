import { mean } from './descriptive.js';

export interface LinearFit {
  /** ความชัน (slope) */
  slope: number;
  /** จุดตัดแกน y (intercept) */
  intercept: number;
  /** สัมประสิทธิ์การตัดสินใจ R² (0..1) */
  r2: number;
  /** จำนวนจุดข้อมูล */
  n: number;
}

/**
 * Linear regression ด้วยวิธี least squares (กำลังสองน้อยที่สุด) — เขียนเอง
 *
 *   slope b = Σ(xᵢ-x̄)(yᵢ-ȳ) / Σ(xᵢ-x̄)²
 *   intercept a = ȳ - b·x̄
 *   R² = 1 - SS_res / SS_tot
 *
 * @param xs ตัวแปรอิสระ (เช่น ลำดับเดือน 0,1,2,...)
 * @param ys ตัวแปรตาม (เช่น ยอดรายจ่ายแต่ละเดือน)
 */
export function linearRegression(xs: number[], ys: number[]): LinearFit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) {
    return { slope: 0, intercept: ys.length ? ys[0]! : 0, r2: 0, n };
  }
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? (sxx === 0 ? 1 : 0) : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

/**
 * พยากรณ์ค่า y ที่ตำแหน่ง x จากเส้น regression
 */
export function forecast(fit: LinearFit, x: number): number {
  return fit.slope * x + fit.intercept;
}

/**
 * พยากรณ์ค่าถัดไป k จุด (ใช้ดัชนีต่อเนื่องจากชุดข้อมูลที่ fit มา)
 * @param fit ผลการ fit จาก ys ที่มีดัชนี 0..n-1
 * @param steps จำนวนจุดที่ต้องการพยากรณ์ไปข้างหน้า
 */
export function forecastNext(fit: LinearFit, steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    out.push(forecast(fit, fit.n + i));
  }
  return out;
}
