import type { Transaction } from '../types.js';
import { round } from './descriptive.js';
import { computeHealthScore } from './healthScore.js';
import { categoryTrends } from './trends.js';
import { detectRecurring } from './recurring.js';
import { isConsumption, isRealIncome, expenseByCategory } from './timeseries.js';
import { CATEGORY_META } from '../categories.js';

export interface Insight {
  id: string;
  severity: 'good' | 'info' | 'warn' | 'alert';
  icon: string;
  title: string;
  text: string;
}

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

/**
 * สร้าง insight เป็นภาษาคนจากผลสถิติ (rule-based)
 * ใช้เป็น fallback เมื่อไม่มี Gemini และเป็น "ความจริงเชิงตัวเลข" ที่ AI จะนำไปเรียบเรียงต่อ
 */
export function generateInsights(txns: Transaction[]): Insight[] {
  const out: Insight[] = [];
  if (txns.length === 0) return out;

  const income = txns.filter(isRealIncome).reduce((a, t) => a + t.amount, 0);
  const expense = txns.filter(isConsumption).reduce((a, t) => a + t.amount, 0);
  const health = computeHealthScore(txns);

  // 1) สรุปคะแนนสุขภาพ
  out.push({
    id: 'health',
    severity: health.total >= 60 ? 'good' : health.total >= 40 ? 'info' : 'warn',
    icon: '💯',
    title: `คะแนนสุขภาพการเงิน ${health.total} (${health.grade})`,
    text: `จากรายรับรวม ${fmt(income)} บาท และรายจ่าย ${fmt(expense)} บาท`,
  });

  // 2) อัตราการออม
  const savingsRate = income > 0 ? (income - expense) / income : 0;
  out.push({
    id: 'savings',
    severity: savingsRate >= 0.2 ? 'good' : savingsRate >= 0 ? 'info' : 'alert',
    icon: '🐖',
    title: `อัตราการออม ${round(savingsRate * 100, 1)}%`,
    text:
      savingsRate >= 0.2
        ? 'อยู่ในเกณฑ์ดี รักษาระดับนี้ไว้'
        : savingsRate >= 0
          ? 'พอมีเหลือเก็บ ลองตั้งเป้าออมให้ถึง 20%'
          : 'เดือนนี้ใช้จ่ายเกินรายรับ ควรทบทวนรายจ่าย',
  });

  // 3) หมวดที่ใช้มากที่สุด
  const cat = expenseByCategory(txns);
  const top = Object.entries(cat).sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const meta = CATEGORY_META[top[0] as keyof typeof CATEGORY_META];
    out.push({
      id: 'top-category',
      severity: 'info',
      icon: meta?.icon ?? '📊',
      title: `ใช้จ่ายมากสุด: ${meta?.label ?? top[0]}`,
      text: `${fmt(top[1])} บาท (${round((top[1] / Math.max(expense, 1)) * 100, 1)}% ของรายจ่าย)`,
    });
  }

  // 4) หมวดที่พุ่งผิดปกติ (baseline z-score > 2)
  for (const tr of categoryTrends(txns)) {
    if (tr.baselineZ > 2 && tr.current > 0) {
      out.push({
        id: `spike-${tr.category}`,
        severity: 'alert',
        icon: '⚠️',
        title: `${tr.label} พุ่งผิดปกติ`,
        text: `เดือนนี้ ${fmt(tr.current)} บาท เพิ่มขึ้น ${tr.pctChange}% จากเดือนก่อน (z=${tr.baselineZ})`,
      });
    }
  }

  // 5) ค่าใช้จ่ายประจำ/subscription
  const recurring = detectRecurring(txns);
  if (recurring.length > 0) {
    const monthly = recurring
      .filter((r) => r.avgIntervalDays >= 25 && r.avgIntervalDays <= 35)
      .reduce((a, r) => a + r.averageAmount, 0);
    if (monthly > 0) {
      out.push({
        id: 'recurring',
        severity: 'info',
        icon: '🔁',
        title: `ค่าใช้จ่ายประจำ ~${fmt(monthly)} บาท/เดือน`,
        text: `พบรายการที่จ่ายเป็นรอบ ${recurring.length} รายการ เช่น ${recurring
          .slice(0, 3)
          .map((r) => r.merchant)
          .join(', ')}`,
      });
    }
  }

  return out;
}
