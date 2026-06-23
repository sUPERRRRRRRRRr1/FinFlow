import type { Transaction } from '../types.js';
import { walletKey } from '../types.js';
import { NEEDS_CATEGORIES, WANTS_CATEGORIES, looksLikeDebt } from '../categories.js';
import { clamp, coefficientOfVariation, round, sum } from './descriptive.js';
import { aggregate, isConsumption, isRealIncome } from './timeseries.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  คะแนนสุขภาพการเงิน (Financial Health Score) — โครงสร้าง 4 เสาแบบ FinHealth
 * ─────────────────────────────────────────────────────────────────────────────
 *  ออกแบบตามงานวิจัยประกอบโครงการ: ยืม "โครงสร้าง 4 เสา + ผลลัพธ์ 0–100 + 3 ระดับ"
 *  ของ FinHealth Score (Financial Health Network) และ CFPB Financial Well-Being
 *  แต่ "คำนวณแต่ละเสาจากอัตราส่วนการเงินจริง" ตามเกณฑ์ของ ตลาดหลักทรัพย์ฯ (SET
 *  Happy Money) และธนาคารแห่งประเทศไทย (ธปท.) — ทุกตัวเลขได้จากธุรกรรมจริง
 *
 *  4 เสา:  ใช้จ่าย (Spend) · ออม (Save) · กู้ยืม (Borrow) · วางแผน/พฤติกรรม (Plan)
 *  แต่ละเสา = ค่าเฉลี่ยถ่วงน้ำหนักของตัวชี้วัดย่อย (แต่ละตัว normalize เป็น 0–100)
 *  คะแนนรวม = ผลรวมถ่วงน้ำหนักข้ามเสา ; ระดับตาม FinHealth: เปราะบาง/ประคองตัว/สุขภาพดี
 *
 *  โปรไฟล์เกณฑ์ (profile) ปรับ "เป้าให้คะแนนเต็ม" + น้ำหนักเสา ตามกลุ่มเป้าหมาย:
 *    - adult   : ผู้ใหญ่/วัยทำงาน  (ออม 20%, สำรองฉุกเฉิน 6 ด., เน้นเสากู้ยืม)
 *    - student : นักเรียน/วัยเริ่มทำงาน (ออม 10%, สำรองฉุกเฉิน 3 ด., ลดน้ำหนักหนี้)
 */

export type ScoreProfile = 'adult' | 'student';
export type PillarId = 'spend' | 'save' | 'borrow' | 'plan';
export type ScoreLevel = 'vulnerable' | 'coping' | 'healthy';

export interface ScoreMetric {
  id: string;
  label: string;
  /** คะแนนย่อย 0..100 */
  score: number;
  /** น้ำหนักภายในเสา (รวมกัน = 1) */
  weight: number;
  /** สูตรย่อ (แสดงในแผง "วิธีคิดคะแนน") */
  formula: string;
  /** อธิบายค่าที่ใช้คำนวณจริงเป็นภาษาคน */
  detail: string;
  /** แหล่งอ้างอิงเกณฑ์ (สำหรับรอบ Q&A ของกรรมการ) */
  reference: string;
  /** ตัวเลขดิบที่ใช้คำนวณ */
  inputs: Record<string, number>;
}

export interface ScorePillar {
  id: PillarId;
  label: string;
  /** คะแนนเสา 0..100 = ค่าเฉลี่ยถ่วงน้ำหนักของ metrics */
  score: number;
  /** น้ำหนักของเสาในคะแนนรวม (รวมกัน = 1) */
  weight: number;
  /** ค่าที่เสานี้สมทบเข้าคะแนนรวม = score*weight */
  contribution: number;
  metrics: ScoreMetric[];
  /** true = เสานี้ใช้การ "ประมาณ" จากธุรกรรม (เช่น เดาภาระหนี้จาก keyword) ไม่ใช่ข้อมูลตรง */
  estimated?: boolean;
}

export interface HealthScore {
  /** คะแนนรวม 0..100 */
  total: number;
  /** ระดับ (FinHealth): vulnerable | coping | healthy */
  level: ScoreLevel;
  /** ป้ายระดับภาษาไทย */
  grade: string;
  /** โปรไฟล์เกณฑ์ที่ใช้คำนวณ */
  profile: ScoreProfile;
  pillars: ScorePillar[];
}

interface ProfileConfig {
  label: string;
  /** น้ำหนักเสา (รวม = 1) */
  weights: Record<PillarId, number>;
  /** อัตราการออมที่ให้คะแนนเต็ม */
  savingsFull: number;
  /** จำนวนเดือนเงินสำรองฉุกเฉินที่ให้คะแนนเต็ม */
  emergencyTarget: number;
}

/** เกณฑ์ตามกลุ่มเป้าหมาย — อ้างอิง SET Happy Money / ธปท. และข้อเสนอปรับสำหรับวัยเรียน */
export const PROFILES: Record<ScoreProfile, ProfileConfig> = {
  adult: {
    label: 'ผู้ใหญ่/วัยทำงาน',
    weights: { spend: 0.35, save: 0.35, borrow: 0.2, plan: 0.1 },
    savingsFull: 0.2,
    emergencyTarget: 6,
  },
  student: {
    label: 'นักเรียน/วัยเริ่มทำงาน',
    weights: { spend: 0.35, save: 0.4, borrow: 0.1, plan: 0.15 },
    savingsFull: 0.1,
    emergencyTarget: 3,
  },
};

/** normalize เชิงเส้น: ค่า x → 0..100 โดย zero=ได้ 0 คะแนน, full=ได้เต็ม (รองรับทั้งขึ้น/ลง) */
function linearScore(x: number, zero: number, full: number): number {
  if (full === zero) return 0;
  return 100 * clamp((x - zero) / (full - zero), 0, 1);
}

function levelOf(total: number): { level: ScoreLevel; grade: string } {
  if (total >= 80) return { level: 'healthy', grade: 'สุขภาพดี' };
  if (total >= 40) return { level: 'coping', grade: 'ประคองตัว' };
  return { level: 'vulnerable', grade: 'เปราะบาง' };
}

/**
 * คำนวณคะแนนสุขภาพการเงิน 0–100 จากธุรกรรม (โครงสร้าง 4 เสาแบบ FinHealth)
 * @param txns  ธุรกรรมในช่วงที่ต้องการประเมิน
 * @param profile  โปรไฟล์เกณฑ์ (adult = ค่าเริ่มต้น)
 */
export function computeHealthScore(txns: Transaction[], profile: ScoreProfile = 'adult'): HealthScore {
  const cfg = PROFILES[profile];

  // ── ฐานข้อมูลร่วม (ตัดการโอนระหว่างกระเป๋าออกแล้ว) ─────────────────────────
  const months = aggregate(txns, 'month');
  const monthlyIncome = months.map((m) => m.income);
  const monthlyExpense = months.map((m) => m.expense);
  const income = sum(monthlyIncome);
  const consumption = sum(monthlyExpense);
  const numMonths = Math.max(1, months.length);
  const avgMonthlyExpense = consumption / numMonths;
  const hasIncome = income > 0;

  // เงินสำรองฉุกเฉิน: ใช้ "ยอดคงเหลือจริงล่าสุดรวมทุกกระเป๋า" ถ้าเห็น (balanceAfter)
  // ไม่งั้น fallback เป็น "เงินเหลือสะสม" (รายรับ−รายจ่าย) ตามคำแนะนำเมื่อมองไม่เห็นยอดออม
  const latestBalance = new Map<string, number>();
  for (const t of txns) if (t.balanceAfter != null) latestBalance.set(walletKey(t), t.balanceAfter);
  const liquidBalance = [...latestBalance.values()].reduce((a, b) => a + b, 0);
  const surplus = Math.max(0, income - consumption);
  const usingRealBalance = liquidBalance > 0;
  const emergencyBasis = usingRealBalance ? liquidBalance : surplus;
  const emergencyMonths = avgMonthlyExpense > 0 ? emergencyBasis / avgMonthlyExpense : 0;

  // ═══ เสา 1: ใช้จ่าย (Spend) ═══════════════════════════════════════════════
  // 1a) อัตราส่วนความอยู่รอด (SET): รายรับ/รายจ่าย ≥ 1
  const survival = consumption > 0 ? income / consumption : hasIncome ? 2 : 0;
  const survivalScore = hasIncome ? linearScore(survival, 0.8, 1.2) : 0;

  // 1b) วินัย 50/30/20: รายจ่ายจำเป็น ≤50% และตามใจ ≤30% ของรายรับ
  const needs = sum(txns.filter((t) => isConsumption(t) && NEEDS_CATEGORIES.includes(t.category)).map((t) => t.amount));
  const wants = sum(txns.filter((t) => isConsumption(t) && WANTS_CATEGORIES.includes(t.category)).map((t) => t.amount));
  const needsShare = hasIncome ? needs / income : 1;
  const wantsShare = hasIncome ? wants / income : 1;
  const needsScore = 100 * (1 - clamp((needsShare - 0.5) / 0.5, 0, 1));
  const wantsScore = 100 * (1 - clamp((wantsShare - 0.3) / 0.3, 0, 1));
  const ruleScore = hasIncome ? 0.5 * needsScore + 0.5 * wantsScore : 0;

  // ═══ เสา 2: ออม (Save) ════════════════════════════════════════════════════
  // 2a) อัตราการออม: s = (รายรับ−รายจ่าย)/รายรับ ; เต็มที่ profile.savingsFull
  const savingsRate = hasIncome ? (income - consumption) / income : 0;
  const savingsScore = savingsRate <= 0 ? 0 : 100 * clamp(savingsRate / cfg.savingsFull, 0, 1);
  // 2b) เดือนเงินสำรองฉุกเฉิน: เต็มที่ profile.emergencyTarget เดือน
  const emergencyScore = linearScore(emergencyMonths, 0, cfg.emergencyTarget);

  // ═══ เสา 3: กู้ยืม (Borrow) — ประมาณจากธุรกรรม ════════════════════════════
  // ภาระผ่อนหนี้ที่ "เดา" ได้จาก keyword (ผ่อน/สินเชื่อ/บัตร) ÷ รายรับ = DTI
  const debtService = sum(
    txns
      .filter((t) => t.direction === 'out' && !t.isTransfer && looksLikeDebt(`${t.counterparty} ${t.rawDesc ?? ''} ${t.alias ?? ''}`))
      .map((t) => t.amount),
  );
  const dti = hasIncome ? debtService / income : 0;
  const dtiScore = !hasIncome ? 50 : dtiToScore(dti);

  // ═══ เสา 4: วางแผน/พฤติกรรม (Plan) ════════════════════════════════════════
  // ความสม่ำเสมอของรายรับ + รายจ่ายรายเดือน (CV ต่ำ = วางแผน/มีวินัย) เป็น proxy
  const incomeCV = coefficientOfVariation(monthlyIncome);
  const expenseCV = coefficientOfVariation(monthlyExpense);
  const incomeStability = months.length < 2 ? 60 : 100 * Math.exp(-1.1 * incomeCV);
  const expenseStability = months.length < 2 ? 60 : 100 * Math.exp(-1.1 * expenseCV);

  // ── ประกอบเสา ─────────────────────────────────────────────────────────────
  const spend: ScorePillar = buildPillar('spend', 'ใช้จ่าย', cfg.weights.spend, [
    {
      id: 'survival',
      label: 'อัตราส่วนความอยู่รอด',
      score: survivalScore,
      weight: 0.5,
      formula: 'อัตราส่วน = รายรับ / รายจ่าย ;  คะแนน = 100·clamp((อัตราส่วน−0.8)/0.4, 0, 1)',
      detail: hasIncome
        ? `รายรับเป็น ${round(survival, 2)} เท่าของรายจ่าย (≥1 = หาได้มากกว่าใช้)`
        : 'ไม่มีรายรับในช่วงนี้',
      reference: 'SET Happy Money: อัตราส่วนความอยู่รอด ≥ 1 · FHN ตัวชี้วัดที่ 1 (จ่าย<รายรับ)',
      inputs: { income: round(income), consumption: round(consumption), survival: round(survival, 3) },
    },
    {
      id: 'rule503020',
      label: 'วินัย 50/30/20',
      score: ruleScore,
      weight: 0.5,
      formula: 'จำเป็น ≤50% และ ตามใจ ≤30% ของรายรับ ;  คะแนน = เฉลี่ยคะแนนทั้งสองส่วน',
      detail: hasIncome
        ? `จำเป็น ${round(needsShare * 100, 1)}% (เป้า ≤50%) · ตามใจ ${round(wantsShare * 100, 1)}% (เป้า ≤30%)`
        : 'ไม่มีรายรับในช่วงนี้',
      reference: 'กฎ 50/30/20 (Warren, 2005)',
      inputs: { needsShare: round(needsShare, 3), wantsShare: round(wantsShare, 3) },
    },
  ]);

  const save: ScorePillar = buildPillar('save', 'ออม', cfg.weights.save, [
    {
      id: 'savingsRate',
      label: 'อัตราการออม',
      score: savingsScore,
      weight: 0.7,
      formula: `s = (รายรับ−รายจ่าย)/รายรับ ;  คะแนน = 100·clamp(s / ${cfg.savingsFull}, 0, 1)`,
      detail: `ออมได้ ${round(savingsRate * 100, 1)}% ของรายรับ (ให้คะแนนเต็มที่ ${round(cfg.savingsFull * 100)}%)`,
      reference: `SET/ธปท.: ออม >10% (เป้า 20%) · เกณฑ์เต็มของโปรไฟล์ "${cfg.label}" = ${round(cfg.savingsFull * 100)}%`,
      inputs: { savingsRate: round(savingsRate, 4), target: cfg.savingsFull },
    },
    {
      id: 'emergency',
      label: 'เงินสำรองฉุกเฉิน',
      score: emergencyScore,
      weight: 0.3,
      formula: `เดือนสำรอง = ${usingRealBalance ? 'ยอดคงเหลือ' : 'เงินเหลือสะสม'} / รายจ่ายเฉลี่ยต่อเดือน ;  คะแนน = 100·clamp(เดือน / ${cfg.emergencyTarget}, 0, 1)`,
      detail: `${usingRealBalance ? 'ยอดคงเหลือจริง' : 'เงินเหลือสะสม (ประมาณ เพราะยังไม่ทราบยอดเงินออม)'} ครอบคลุมรายจ่าย ~${round(emergencyMonths, 1)} เดือน (เป้า ${cfg.emergencyTarget})`,
      reference: 'SET/ธปท./FINRA: เงินสำรองฉุกเฉิน 3–6 เดือน',
      inputs: { emergencyMonths: round(emergencyMonths, 2), basis: round(emergencyBasis), avgMonthlyExpense: round(avgMonthlyExpense) },
    },
  ]);

  const borrow: ScorePillar = buildPillar(
    'borrow',
    'กู้ยืม',
    cfg.weights.borrow,
    [
      {
        id: 'dti',
        label: 'ภาระผ่อนหนี้ (DTI)',
        score: dtiScore,
        weight: 1,
        formula: 'DTI = ยอดผ่อน/ชำระหนี้ (เดาจาก keyword) / รายรับ ;  ดี ≤35% (≤20% เต็ม, ≥50% = 0)',
        detail:
          debtService > 0
            ? `พบรายการผ่อน/ชำระหนี้ ~${round(debtService)} บาท = ${round(dti * 100, 1)}% ของรายรับ`
            : 'ตรวจไม่พบรายการผ่อน/ชำระหนี้ (ประมาณจาก keyword) — หากมีหนี้ที่ระบบมองไม่เห็น คะแนนนี้อาจสูงเกินจริง',
        reference: 'SET: ภาระหนี้ <35–45% · FHN/DTI ≤36% (เสานี้ประมาณจากธุรกรรม)',
        inputs: { debtService: round(debtService), dti: round(dti, 4) },
      },
    ],
    true,
  );

  const plan: ScorePillar = buildPillar('plan', 'วางแผน/พฤติกรรม', cfg.weights.plan, [
    {
      id: 'incomeStability',
      label: 'ความสม่ำเสมอของรายรับ',
      score: incomeStability,
      weight: 0.5,
      formula: 'CV = SD/mean ของรายรับรายเดือน ;  คะแนน = 100·e^(−1.1·CV)',
      detail: months.length < 2 ? 'ข้อมูลยังไม่ถึง 2 เดือน ให้คะแนนกลาง 60' : `รายรับแกว่ง CV = ${round(incomeCV, 2)} (ยิ่งต่ำยิ่งมั่นคง)`,
      reference: 'FHN เสาวางแผน: ความมั่นคงของกระแสเงินสด',
      inputs: { incomeCV: round(incomeCV, 4), months: months.length },
    },
    {
      id: 'expenseStability',
      label: 'ความสม่ำเสมอของรายจ่าย',
      score: expenseStability,
      weight: 0.5,
      formula: 'CV = SD/mean ของรายจ่ายรายเดือน ;  คะแนน = 100·e^(−1.1·CV)',
      detail: months.length < 2 ? 'ข้อมูลยังไม่ถึง 2 เดือน ให้คะแนนกลาง 60' : `รายจ่ายแกว่ง CV = ${round(expenseCV, 2)} (ยิ่งต่ำยิ่งมีวินัย)`,
      reference: 'FHN ตัวชี้วัดที่ 2: จ่ายบิล/ใช้จ่ายสม่ำเสมอ (ใช้ CV เป็น proxy ของวินัยการจ่าย)',
      inputs: { expenseCV: round(expenseCV, 4), months: months.length },
    },
  ]);

  const pillars = [spend, save, borrow, plan];
  const total = round(
    pillars.reduce((acc, p) => acc + p.contribution, 0),
    1,
  );
  const { level, grade } = levelOf(total);

  return { total, level, grade, profile, pillars };
}

/** map DTI → คะแนน (piecewise): ดีมากเมื่อต่ำ, ≤35% ยังถือว่า "ดี" (~75) */
function dtiToScore(dti: number): number {
  if (dti <= 0.2) return 100;
  if (dti <= 0.35) return 100 - ((dti - 0.2) / 0.15) * 25; // 100 → 75
  if (dti <= 0.5) return 75 - ((dti - 0.35) / 0.15) * 75; // 75 → 0
  return 0;
}

function buildPillar(
  id: PillarId,
  label: string,
  weight: number,
  rawMetrics: ScoreMetric[],
  estimated = false,
): ScorePillar {
  const metrics = rawMetrics.map((m) => ({ ...m, score: round(clamp(m.score, 0, 100), 1) }));
  const score = round(
    metrics.reduce((acc, m) => acc + m.score * m.weight, 0),
    1,
  );
  return { id, label, score, weight, contribution: round(score * weight, 2), metrics, estimated };
}
