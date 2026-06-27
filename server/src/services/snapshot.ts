import type { ScoreProfile, TaxProfile, Transaction } from '@finflow/shared';
import {
  CATEGORY_META,
  categoryTrends,
  computeHealthScore,
  defaultTaxProfile,
  detectRecurring,
  expenseByCategory,
  generateInsights,
  getRules,
  isConsumption,
  isRealIncome,
  monthKey,
  round,
  taxOverview,
  thaiMonthLabel,
} from '@finflow/shared';
import { sanitizeText } from '../sanitize.js';

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

export interface SnapshotOpts {
  scoreProfile?: ScoreProfile;
  taxProfile?: TaxProfile;
}

/** รายชื่อเดือนที่มีข้อมูล เรียงเก่า→ใหม่ */
function monthsOf(txns: Transaction[]): string[] {
  return [...new Set(txns.map((t) => monthKey(t.date)))].sort();
}

/** ภาพรวมทั้งช่วง: รายรับ/จ่าย/ออม/อัตราออม */
function overviewSection(txns: Transaction[], months: string[]): string {
  const income = txns.filter(isRealIncome).reduce((a, t) => a + t.amount, 0);
  const expense = txns.filter(isConsumption).reduce((a, t) => a + t.amount, 0);
  const net = income - expense;
  const rate = income > 0 ? round((net / income) * 100, 1) : 0;
  return (
    `ภาพรวมทั้งช่วง (${thaiMonthLabel(months[0]!)}–${thaiMonthLabel(months[months.length - 1]!)}, ${txns.length} รายการ):\n` +
    `รายรับรวม ${fmt(round(income))} บาท · รายจ่ายรวม ${fmt(round(expense))} บาท · ออมสุทธิ ${fmt(round(net))} บาท · อัตราออม ${rate}%`
  );
}

/** ตารางรายเดือน (สูงสุด 12 เดือนล่าสุด) */
function monthlySection(txns: Transaction[], months: string[]): string {
  const recent = months.slice(-12);
  const rows = recent.map((mk) => {
    const inMonth = txns.filter((t) => monthKey(t.date) === mk);
    const income = inMonth.filter(isRealIncome).reduce((a, t) => a + t.amount, 0);
    const expense = inMonth.filter(isConsumption).reduce((a, t) => a + t.amount, 0);
    const net = income - expense;
    const rate = income > 0 ? round((net / income) * 100) : 0;
    return `  ${thaiMonthLabel(mk)} | รายรับ ${fmt(round(income))} | รายจ่าย ${fmt(round(expense))} | ออมสุทธิ ${fmt(round(net))} | อัตราออม ${rate}%`;
  });
  return `รายเดือน (ล่าสุด ${recent.length} เดือน):\n${rows.join('\n')}`;
}

/** เจาะลึกเดือนล่าสุด: top หมวด + % เทียบเดือนก่อน */
function latestMonthSection(txns: Transaction[], months: string[]): string {
  const latest = months[months.length - 1]!;
  const prev = months[months.length - 2];
  const cat = expenseByCategory(txns.filter((t) => monthKey(t.date) === latest));
  const prevCat = prev ? expenseByCategory(txns.filter((t) => monthKey(t.date) === prev)) : {};
  const top = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const lines = top.map(([id, amt]) => {
    const label = CATEGORY_META[id as keyof typeof CATEGORY_META]?.label ?? id;
    const pv = prevCat[id] ?? 0;
    const diff = pv > 0 ? round(((amt - pv) / pv) * 100, 1) : amt > 0 ? 100 : 0;
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';
    return `  ${label}: ${fmt(round(amt))} บาท (${arrow}${Math.abs(diff)}% เทียบเดือนก่อน)`;
  });
  return `เจาะลึกเดือนล่าสุด (${thaiMonthLabel(latest)}) — หมวดที่ใช้มากสุด:\n${lines.join('\n')}`;
}

/** เทรนด์รายหมวด (สูงสุด 8 หมวด) */
function trendSection(txns: Transaction[]): string | null {
  const trends = categoryTrends(txns);
  if (trends.length === 0) return null;
  const lines = trends.slice(0, 8).map((tr) => {
    const dir = tr.direction === 'up' ? 'ขาขึ้น' : tr.direction === 'down' ? 'ขาลง' : 'ทรงตัว';
    const sign = tr.pctChange >= 0 ? '+' : '';
    return `  ${tr.label}: ล่าสุด ${fmt(tr.current)} บาท, เทรนด์${dir} (${sign}${tr.pctChange}% เทียบเดือนก่อน)`;
  });
  return `เทรนด์รายหมวด:\n${lines.join('\n')}`;
}

/** ข้อสังเกต/ความผิดปกติ (จาก generateInsights เฉพาะ warn/alert) */
function insightSection(txns: Transaction[], profile: ScoreProfile): string {
  const notable = generateInsights(txns, profile).filter(
    (i) => i.severity === 'alert' || i.severity === 'warn',
  );
  if (notable.length === 0) return 'ข้อสังเกต/ความผิดปกติ: ไม่พบรายการผิดปกติเด่นชัด';
  return `ข้อสังเกต/ความผิดปกติ:\n${notable.map((i) => `  • ${i.title} — ${i.text}`).join('\n')}`;
}

/** บิล/รายจ่ายประจำรายเดือน */
function recurringSection(txns: Transaction[]): string | null {
  const monthly = detectRecurring(txns).filter(
    (r) => r.avgIntervalDays >= 25 && r.avgIntervalDays <= 35,
  );
  if (monthly.length === 0) return null;
  const sum = monthly.reduce((a, r) => a + r.averageAmount, 0);
  const lines = monthly
    .slice(0, 6)
    .map((r) => `  • ${sanitizeText(r.merchant)}: ${fmt(r.averageAmount)} บาท/รอบ (ทุก ~${r.avgIntervalDays} วัน)`);
  return `บิล/รายจ่ายประจำ (~${fmt(round(sum))} บาท/เดือน):\n${lines.join('\n')}`;
}

/** สุขภาพการเงิน + จุดอ่อนรายเสา */
function healthSection(txns: Transaction[], profile: ScoreProfile): string {
  const health = computeHealthScore(txns, profile);
  const weak = [...health.pillars].sort((a, b) => a.score - b.score)[0];
  const weakMetric = weak ? [...weak.metrics].sort((a, b) => a.score - b.score)[0] : undefined;
  const weakLine = weak && weakMetric ? `\n  จุดอ่อนสุด: เสา "${weak.label}" — ${weakMetric.detail}` : '';
  return `สุขภาพการเงิน: ${health.total}/100 (${health.grade})${weakLine}`;
}

/** ภาษีสรุป + คำแนะนำประหยัด + กำหนดยื่น */
function taxSection(txns: Transaction[], profile: TaxProfile): string | null {
  try {
    const o = taxOverview(txns, profile, getRules(profile.taxYear));
    const r = o.result;
    const lines = [
      `ภาษี: เงินได้สุทธิ ${fmt(round(r.netIncome))} บาท, ${r.taxDue >= 0 ? `ต้องจ่ายเพิ่ม ${fmt(round(r.taxDue))}` : `ขอคืนได้ ${fmt(round(-r.taxDue))}`} บาท (อัตราขั้นสุดท้าย ${(r.marginalRate * 100).toFixed(0)}%)`,
    ];
    if (o.suggestions[0]) {
      lines.push(`  แนะนำ: ${o.suggestions[0].label} อีก ${fmt(o.suggestions[0].room)} → ประหยัด ~${fmt(o.suggestions[0].estimatedSaving)} บาท`);
    }
    lines.push(o.filing.mustFile ? `  ต้องยื่น ${o.filing.form} ภายใน ${o.filing.deadlineOnline}` : '  รายได้ยังไม่ถึงเกณฑ์ต้องยื่น');
    return lines.join('\n');
  } catch {
    return null; // คำนวณภาษีไม่ได้ → ข้ามส่วนนี้
  }
}

/**
 * fact-sheet ครบทุกด้าน (ตัวเลขคำนวณด้วยโค้ดทั้งหมด) ส่งให้ LLM เลือกตอบ
 * แต่ละ section คั่นด้วยบรรทัดว่าง เพื่อให้ rule-based fallback หยิบเฉพาะ section ได้
 */
export function buildSnapshot(txns: Transaction[], opts: SnapshotOpts = {}): string {
  if (txns.length === 0) return 'ยังไม่มีข้อมูลธุรกรรมในระบบ';
  const scoreProfile = opts.scoreProfile ?? 'adult';
  const taxProfile = opts.taxProfile ?? defaultTaxProfile(2567);
  const months = monthsOf(txns);

  const sections: (string | null)[] = [
    overviewSection(txns, months),
    monthlySection(txns, months),
    latestMonthSection(txns, months),
    trendSection(txns),
    insightSection(txns, scoreProfile),
    recurringSection(txns),
    healthSection(txns, scoreProfile),
    taxSection(txns, taxProfile),
  ];
  return sections.filter((s): s is string => Boolean(s)).join('\n\n');
}
