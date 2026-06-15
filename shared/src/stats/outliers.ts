import { mean, stdev, iqr } from './descriptive.js';

export interface OutlierPoint<T = unknown> {
  index: number;
  value: number;
  /** z-score ของจุดนี้ */
  z: number;
  /** เกินขอบ IQR หรือไม่ */
  beyondIqr: boolean;
  /** เหตุผลที่ถือว่าผิดปกติ */
  reason: 'zscore' | 'iqr' | 'both';
  item?: T;
}

export interface OutlierResult<T = unknown> {
  outliers: OutlierPoint<T>[];
  meanValue: number;
  sd: number;
  lowerFence: number;
  upperFence: number;
}

/**
 * ตรวจจับ outlier ด้วย 2 วิธีพร้อมกัน:
 *  1) z-score:  z = (x - μ) / σ   ถ้า |z| > zThreshold = ผิดปกติ
 *  2) IQR fence: x < Q1-1.5·IQR หรือ x > Q3+1.5·IQR = ผิดปกติ
 * รายการจะถูกตั้งธงเมื่อเข้าเงื่อนไขข้อใดข้อหนึ่ง (เน้น "พุ่งสูง" สำหรับรายจ่าย)
 *
 * @param values อาเรย์ค่าตัวเลข
 * @param opts.zThreshold เกณฑ์ z (ดีฟอลต์ 2)
 * @param opts.items ข้อมูลต้นทางคู่กับแต่ละค่า (optional)
 * @param opts.highOnly สนใจเฉพาะค่าที่สูงผิดปกติ (รายจ่ายพุ่ง) ดีฟอลต์ true
 * @param opts.iqrK ตัวคูณขอบ IQR (ดีฟอลต์ 1.5; ใช้ 3.0 = "far-out" สำหรับข้อมูลเบ้ขวา เช่นรายจ่ายรายวัน)
 */
export function detectOutliers<T = unknown>(
  values: number[],
  opts: { zThreshold?: number; items?: T[]; highOnly?: boolean; iqrK?: number } = {},
): OutlierResult<T> {
  const { zThreshold = 2, items, highOnly = true, iqrK = 1.5 } = opts;
  const m = mean(values);
  const sd = stdev(values, true);
  const { lowerFence, upperFence } = iqr(values, iqrK);

  const outliers: OutlierPoint<T>[] = [];
  values.forEach((value, index) => {
    const z = sd === 0 ? 0 : (value - m) / sd;
    const byZ = highOnly ? z > zThreshold : Math.abs(z) > zThreshold;
    const byIqr = highOnly ? value > upperFence : value > upperFence || value < lowerFence;
    if (byZ || byIqr) {
      outliers.push({
        index,
        value,
        z,
        beyondIqr: byIqr,
        reason: byZ && byIqr ? 'both' : byZ ? 'zscore' : 'iqr',
        item: items?.[index],
      });
    }
  });

  return { outliers, meanValue: m, sd, lowerFence, upperFence };
}
