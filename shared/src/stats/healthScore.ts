import type { Transaction } from '../types.js';
import { clamp, coefficientOfVariation, mean, round } from './descriptive.js';
import { normalizedEntropy } from './entropy.js';
import { detectOutliers } from './outliers.js';
import { linearRegression } from './regression.js';
import {
  aggregate,
  dailyExpenseActive,
  expenseByCategory,
  isConsumption,
  isRealIncome,
  netSavings,
} from './timeseries.js';

export type ComponentId = 'savings' | 'consistency' | 'diversification' | 'anomaly' | 'trend';

export interface ScoreComponent {
  id: ComponentId;
  label: string;
  /** คะแนนย่อย 0..100 */
  score: number;
  /** น้ำหนัก (รวมกัน = 1) */
  weight: number;
  /** ค่าที่ component นี้สมทบเข้าคะแนนรวม = score*weight */
  contribution: number;
  /** สูตรย่อ (แสดงในแผง "วิธีคิดคะแนน") */
  formula: string;
  /** อธิบายค่าที่ใช้คำนวณจริงเป็นภาษาคน */
  detail: string;
  /** ตัวเลขดิบที่ใช้คำนวณ (ให้ UI โชว์ได้) */
  inputs: Record<string, number>;
}

export interface HealthScore {
  /** คะแนนรวม 0..100 */
  total: number;
  /** เกรด/คำอธิบายระดับ */
  grade: string;
  components: ScoreComponent[];
}

/** น้ำหนักของแต่ละองค์ประกอบ (ตามเอกสารโครงการ) */
export const WEIGHTS: Record<ComponentId, number> = {
  savings: 0.3,
  consistency: 0.2,
  diversification: 0.2,
  anomaly: 0.15,
  trend: 0.15,
};

/** เป้าหมายอัตราการออมที่ให้คะแนนเต็ม (30%) */
export const SAVINGS_TARGET = 0.3;

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function gradeOf(total: number): string {
  if (total >= 80) return 'ดีมาก';
  if (total >= 60) return 'ดี';
  if (total >= 40) return 'พอใช้';
  return 'ควรปรับปรุง';
}

/**
 * คำนวณคะแนนสุขภาพการเงิน 0–100 จากธุรกรรม
 *
 * รวมจาก 5 องค์ประกอบถ่วงน้ำหนัก โดยแต่ละองค์ประกอบ normalize เป็น 0..100:
 *  1) อัตราการออม (30%)        s=(รายรับ−รายจ่ายบริโภค)/รายรับ ; score=100·clamp(s/0.30,0,1)
 *  2) ความสม่ำเสมอรายจ่าย (20%) CV=SD/mean ของรายจ่ายรายวัน ; score=100·e^(−0.7·CV)
 *  3) การกระจายหมวด (20%)       Hₙ=H/ln(k) (normalized Shannon entropy) ; score=100·Hₙ
 *  4) การคุมรายจ่ายผิดปกติ (15%) r=วันผิดปกติ/วันมีจ่าย (z>2 หรือเกิน IQR) ; score=100·(1−r)
 *  5) แนวโน้ม (15%)             slope ของเงินออมสุทธิรายเดือน (regression) ; score=100·σ(α·slope/(|mean|+ε))
 */
export function computeHealthScore(txns: Transaction[]): HealthScore {
  // ── ฐานข้อมูลร่วม ───────────────────────────────────────────
  const income = txns.filter(isRealIncome).reduce((a, t) => a + t.amount, 0);
  const consumption = txns.filter(isConsumption).reduce((a, t) => a + t.amount, 0);

  // 1) อัตราการออม
  const savingsRate = income > 0 ? (income - consumption) / income : 0;
  const savingsScore = clamp(savingsRate / SAVINGS_TARGET, 0, 1) * 100;

  // 2) ความสม่ำเสมอ (CV ของรายจ่ายรายวันเฉพาะวันที่มีจ่าย)
  const dailySpend = dailyExpenseActive(txns);
  const cv = coefficientOfVariation(dailySpend);
  const consistencyScore = dailySpend.length < 2 ? 100 : 100 * Math.exp(-0.7 * cv);

  // 3) การกระจายหมวด (normalized entropy)
  const catTotals = Object.values(expenseByCategory(txns));
  const hn = normalizedEntropy(catTotals);
  const diversificationScore = 100 * hn;

  // 4) การคุมรายจ่ายผิดปกติ (สัดส่วนวันที่มี outlier; ใช้ IQR far-out k=3 ลด false positive ของข้อมูลเบ้ขวา)
  const { outliers } = detectOutliers(dailySpend, { zThreshold: 2, highOnly: true, iqrK: 3 });
  const activeDays = Math.max(1, dailySpend.length);
  const outlierRatio = outliers.length / activeDays;
  const anomalyScore = 100 * (1 - clamp(outlierRatio, 0, 1));

  // 5) แนวโน้มเงินออมสุทธิรายเดือน
  const months = aggregate(txns, 'month');
  const netByMonth = months.map(netSavings);
  const xs = netByMonth.map((_, i) => i);
  const fit = linearRegression(xs, netByMonth);
  const scale = Math.abs(mean(netByMonth)) + 1; // +1 กัน /0 และให้สัดส่วนมีความหมายเชิงเงิน
  const trendScore = months.length < 2 ? 50 : 100 * logistic((1.5 * fit.slope) / scale);

  const raw: { id: ComponentId; label: string; score: number; formula: string; detail: string; inputs: Record<string, number> }[] = [
    {
      id: 'savings',
      label: 'อัตราการออม',
      score: savingsScore,
      formula: 's = (รายรับ − รายจ่าย) / รายรับ ;  คะแนน = 100·min(s / 0.30, 1)',
      detail: `ออมได้ ${round(savingsRate * 100, 1)}% ของรายรับ (เป้าหมายให้คะแนนเต็มที่ 30%)`,
      inputs: { income: round(income), consumption: round(consumption), savingsRate: round(savingsRate, 4) },
    },
    {
      id: 'consistency',
      label: 'ความสม่ำเสมอรายจ่าย',
      score: consistencyScore,
      formula: 'CV = SD / mean (รายจ่ายรายวัน) ;  คะแนน = 100·e^(−0.7·CV)',
      detail: `ค่าสัมประสิทธิ์การแปรผัน CV = ${round(cv, 2)} (ยิ่งต่ำยิ่งสม่ำเสมอ)`,
      inputs: { cv: round(cv, 4), activeSpendingDays: dailySpend.length },
    },
    {
      id: 'diversification',
      label: 'การกระจายหมวด',
      score: diversificationScore,
      formula: 'Hₙ = H / ln(k) ;  H = −Σ pᵢ·ln(pᵢ) ;  คะแนน = 100·Hₙ',
      detail: `เอนโทรปีปกติ Hₙ = ${round(hn, 2)} จาก ${catTotals.filter((v) => v > 0).length} หมวด`,
      inputs: { normalizedEntropy: round(hn, 4), categories: catTotals.filter((v) => v > 0).length },
    },
    {
      id: 'anomaly',
      label: 'การคุมรายจ่ายผิดปกติ',
      score: anomalyScore,
      formula: 'r = วันผิดปกติ / วันที่มีจ่าย (z>2 หรือเกิน Q3+3·IQR) ;  คะแนน = 100·(1−r)',
      detail: `พบวันรายจ่ายผิดปกติ ${outliers.length} วัน จาก ${activeDays} วันที่มีการใช้จ่าย`,
      inputs: { outlierDays: outliers.length, activeDays, ratio: round(outlierRatio, 4) },
    },
    {
      id: 'trend',
      label: 'แนวโน้มการออม',
      score: trendScore,
      formula: 'slope ของเงินออมสุทธิรายเดือน (least squares) ;  คะแนน = 100·σ(1.5·slope/(|mean|+1))',
      detail:
        months.length < 2
          ? 'ข้อมูลยังไม่ถึง 2 เดือน ให้คะแนนกลาง 50'
          : `แนวโน้มเงินออม ${fit.slope >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ~${round(Math.abs(fit.slope))} บาท/เดือน`,
      inputs: { slope: round(fit.slope), months: months.length, r2: round(fit.r2, 3) },
    },
  ];

  const components: ScoreComponent[] = raw.map((c) => {
    const weight = WEIGHTS[c.id];
    const score = round(clamp(c.score, 0, 100), 1);
    return { ...c, score, weight, contribution: round(score * weight, 2) };
  });

  const total = round(
    components.reduce((acc, c) => acc + c.contribution, 0),
    1,
  );

  return { total, grade: gradeOf(total), components };
}
