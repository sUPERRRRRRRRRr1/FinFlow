import type { Granularity, Transaction } from '@finflow/shared';
import { walletKey } from '@finflow/shared';
import { getAccounts, getScoreProfile, getBudgets } from '../db.js';
import {
  CATEGORY_META,
  aggregate,
  buildSankey,
  categoryMonthMatrix,
  categoryTrends,
  computeHealthScore,
  dailyExpenseActive,
  dailySeriesFilled,
  detectOutliers,
  detectRecurring,
  expenseByCategory,
  forecastByCategory,
  forecastNext,
  generateInsights,
  isConsumption,
  isRealIncome,
  linearRegression,
  netSavings,
  round,
  thaiDayLabel,
  thaiMonthLabel,
} from '@finflow/shared';

const SOURCE_LABEL: Record<string, string> = {
  kbank: 'KBank',
  make: 'Make by KBank',
  truemoney: 'TrueMoney',
  manual: 'บันทึกเอง',
  slip: 'สลิป',
};

/**
 * แผนที่ "คีย์กระเป๋า → ป้ายแสดงผล" จากการตั้งค่าบัญชีของผู้ใช้
 * บัญชีที่ตั้งชื่อเล่นไว้ → 'KBank · ใช้จ่ายหลัก' / บัญชีที่ยังไม่ตั้ง → ป้ายตามชนิดกระเป๋า (+ เลขบัญชีถ้ามี)
 */
function walletLabelMap(txns: Transaction[]): Record<string, string> {
  const cfgById = new Map(getAccounts().map((c) => [c.id, c]));
  const keyToSource = new Map<string, string>();
  for (const t of txns) keyToSource.set(walletKey(t), t.source);
  const map: Record<string, string> = {};
  for (const [key, src] of keyToSource) {
    const base = SOURCE_LABEL[src] ?? src;
    const nickname = cfgById.get(key)?.nickname;
    map[key] = nickname ? `${base} · ${nickname}` : key === src ? base : `${base} · ${key}`;
  }
  return map;
}

export function overview(txns: Transaction[], ingestStats?: unknown) {
  const income = txns.filter(isRealIncome).reduce((a, t) => a + t.amount, 0);
  const consumption = txns.filter(isConsumption).reduce((a, t) => a + t.amount, 0);
  const savings = txns
    .filter((t) => t.direction === 'out' && !t.isTransfer && t.category === 'savings')
    .reduce((a, t) => a + t.amount, 0);

  // แยกตามกระเป๋า/บัญชี (แยกหลายบัญชีในแบงก์เดียวกันด้วยคีย์บัญชี)
  const walletLabels = walletLabelMap(txns);
  const sourceMap = new Map<string, { income: number; expense: number; count: number }>();
  // ยอดคงเหลือจริงล่าสุดต่อบัญชี = balanceAfter ของรายการล่าสุด (txns เรียงเวลาเก่า→ใหม่ ตัวหลังทับตัวหน้า)
  const balanceMap = new Map<string, number>();
  for (const t of txns) {
    const key = walletKey(t);
    const s = sourceMap.get(key) ?? { income: 0, expense: 0, count: 0 };
    s.count++;
    if (isRealIncome(t)) s.income += t.amount;
    else if (isConsumption(t)) s.expense += t.amount;
    sourceMap.set(key, s);
    if (t.balanceAfter != null) balanceMap.set(key, t.balanceAfter);
  }
  const bySource = [...sourceMap.entries()].map(([source, v]) => ({
    source,
    label: walletLabels[source] ?? SOURCE_LABEL[source] ?? source,
    income: round(v.income),
    expense: round(v.expense),
    net: round(v.income - v.expense),
    count: v.count,
    balance: balanceMap.has(source) ? round(balanceMap.get(source)!) : null,
  }));
  // ยอดเงินรวมทุกบัญชีที่รู้ยอดคงเหลือ (เงินจริงที่มีอยู่ตอนนี้)
  const totalBalance = round([...balanceMap.values()].reduce((a, b) => a + b, 0));

  // แยกตามหมวด
  const cat = expenseByCategory(txns);
  const byCategory = Object.entries(cat)
    .map(([id, amount]) => {
      const meta = CATEGORY_META[id as keyof typeof CATEGORY_META];
      return {
        category: id,
        label: meta?.label ?? id,
        color: meta?.color ?? '#64748b',
        icon: meta?.icon ?? '📦',
        amount: round(amount),
        pct: round((amount / Math.max(consumption, 1)) * 100, 1),
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // รายเดือน
  const monthly = aggregate(txns, 'month').map((b) => ({
    key: b.key,
    label: thaiMonthLabel(b.key),
    income: round(b.income),
    expense: round(b.expense),
    savings: round(b.savings),
    net: round(netSavings(b)),
  }));

  const recurring = detectRecurring(txns);
  const recurringMonthly = recurring
    .filter((r) => r.avgIntervalDays >= 25 && r.avgIntervalDays <= 35)
    .reduce((a, r) => a + r.averageAmount, 0);

  const dates = txns.map((t) => t.date).sort();

  return {
    totals: {
      income: round(income),
      expense: round(consumption),
      savings: round(savings),
      net: round(income - consumption),
      savingsRate: round(income > 0 ? (income - consumption) / income : 0, 4),
      totalBalance,
    },
    bySource,
    byCategory,
    monthly,
    health: computeHealthScore(txns, getScoreProfile()),
    insights: generateInsights(txns, getScoreProfile()),
    sankey: buildSankey(txns, walletLabels),
    recurring: { count: recurring.length, monthlyTotal: round(recurringMonthly), items: recurring },
    transferCount: txns.filter((t) => t.isTransfer && t.direction === 'out').length,
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    count: txns.length,
    ingestStats: ingestStats ?? null,
  };
}

export function timeline(txns: Transaction[], granularity: Granularity = 'day') {
  const daily = dailySeriesFilled(txns).map((p) => ({ ...p, label: thaiDayLabel(p.date) }));
  const months = aggregate(txns, 'month');
  const monthly = months.map((b) => ({
    key: b.key,
    label: thaiMonthLabel(b.key),
    income: round(b.income),
    expense: round(b.expense),
    savings: round(b.savings),
    net: round(netSavings(b)),
  }));

  // พยากรณ์เงินออมสุทธิ 3 เดือนข้างหน้าด้วย regression
  const netSeries = months.map(netSavings);
  const fit = linearRegression(
    netSeries.map((_, i) => i),
    netSeries,
  );
  const forecastVals = forecastNext(fit, 3).map((v) => round(v));

  const yearly = aggregate(txns, 'year').map((b) => ({
    key: b.key,
    label: `${Number(b.key) + 543}`,
    income: round(b.income),
    expense: round(b.expense),
    savings: round(b.savings),
    net: round(netSavings(b)),
  }));

  return {
    granularity,
    daily,
    monthly,
    yearly,
    forecast: { netSavings: forecastVals, slope: round(fit.slope), r2: round(fit.r2, 3) },
  };
}

export function categories(txns: Transaction[]) {
  const trends = categoryTrends(txns);
  const heat = categoryMonthMatrix(txns);
  return {
    trends,
    heatmap: {
      months: heat.months.map((m) => ({ key: m, label: thaiMonthLabel(m) })),
      categories: heat.categories.map((c) => ({
        id: c,
        label: CATEGORY_META[c]?.label ?? c,
        color: CATEGORY_META[c]?.color ?? '#64748b',
        values: heat.months.map((m) => round(heat.matrix[c]?.[m] ?? 0)),
      })),
    },
  };
}

export function anomalies(txns: Transaction[]) {
  // รวมรายจ่ายต่อวัน เฉพาะวันที่มีจ่าย
  const byDay = new Map<string, { expense: number; txns: Transaction[] }>();
  for (const t of txns) {
    if (!isConsumption(t)) continue;
    const d = byDay.get(t.date) ?? { expense: 0, txns: [] };
    d.expense += t.amount;
    d.txns.push(t);
    byDay.set(t.date, d);
  }
  const entries = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const values = entries.map((e) => e[1].expense);
  const dates = entries.map((e) => e[0]);
  const { outliers, meanValue, sd, upperFence } = detectOutliers(values, {
    zThreshold: 2,
    items: dates,
    highOnly: true,
    iqrK: 3,
  });

  // หน้านี้แสดงเฉพาะวันที่ "มีนัยสำคัญเชิงสถิติ" (z>2) เรียงจากมากไปน้อย
  // เพื่อไม่ให้รก (รายจ่ายรายวันมีการกระจายเบ้ขวาตามธรรมชาติ)
  const significant = outliers
    .filter((o) => o.reason !== 'iqr')
    .sort((a, b) => b.value - a.value);

  return {
    meanDaily: round(meanValue),
    sd: round(sd),
    upperFence: round(upperFence),
    outliers: significant.map((o) => ({
      date: o.item as string,
      label: thaiDayLabel(o.item as string),
      amount: round(o.value),
      z: round(o.z, 2),
      reason: o.reason,
      transactions: (byDay.get(o.item as string)?.txns ?? [])
        .sort((a, b) => b.amount - a.amount)
        .map((t) => ({
          counterparty: t.counterparty,
          amount: round(t.amount),
          category: t.category,
          categoryLabel: CATEGORY_META[t.category]?.label ?? t.category,
        })),
    })),
  };
}

/** ชุดข้อมูลรายวัน (สำหรับคำนวณซ้ำที่อื่น) */
export function dailyExpense(txns: Transaction[]): number[] {
  return dailyExpenseActive(txns);
}

/** พยากรณ์ค่าใช้จ่ายรายหมวด 3 เดือนข้างหน้า */
export function forecastExpense(txns: Transaction[]) {
  const budgets = getBudgets();
  return forecastByCategory(txns, budgets);
}
