# ผู้ช่วย AI ถาม–ตอบ v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนผู้ช่วย AI ถาม–ตอบ จาก "เดาเจตนาด้วย regex แล้วคำนวณเฉพาะ pattern" เป็น "คำนวณ fact-sheet ครบทุกด้านเสมอ + จำบทสนทนา" เพื่อให้ตอบคำถามได้กว้างขึ้นและตรงคำถาม

**Architecture:** เพิ่ม `buildSnapshot(txns, opts)` เป็น pure function ที่ประกอบ fact-sheet จากฟังก์ชันสถิติใน `@finflow/shared` ที่มีอยู่แล้ว (ไม่เขียน logic คำนวณใหม่) ส่งให้ LLM ทุกครั้ง ลดบทบาท `buildChatContext` เหลือแค่ "โฟกัส + ตัวอย่างรายการ" และส่งประวัติบทสนทนาไปด้วย

**Tech Stack:** TypeScript (ESM, NodeNext), Express, Zod, Vitest, React (client), npm workspaces (`shared`/`server`/`client`)

## Global Constraints

- ตัวเลขทั้งหมดคำนวณด้วยโค้ด LLM ทำหน้าที่แค่เรียบเรียง — ห้ามให้ LLM แต่งตัวเลข
- import ภายในต้องลงท้าย `.js` (NodeNext ESM) เช่น `from '../db.js'`
- ลำดับ LLM provider คงเดิม: Gemini → Groq → rule-based (ใน `gemini.ts` `generate()`)
- รายการที่ส่งเข้า LLM ต้องผ่าน `toSafeTransaction` / `sanitizeText` (PDPA) — `server/src/sanitize.ts`
- รันเทสต์ทั้ง repo: `npm test` (vitest root, include `shared/**/*.test.ts` + `server/**/*.test.ts`)
- typecheck ทั้ง 3 workspace: `npm run typecheck`
- `buildSnapshot` ต้องไม่พึ่ง `../db.js` (รับ profile ผ่าน opts) เพื่อให้ unit test ไม่สร้างไฟล์ sqlite

---

### Task 1: Fact-sheet builder (`buildSnapshot`)

สร้าง pure function ที่ประกอบ fact-sheet ครบทุกด้านจากฟังก์ชัน `@finflow/shared` ที่มีอยู่ รับ `txns` + โปรไฟล์ (คะแนน/ภาษี) ผ่าน opts เพื่อให้เทสต์ได้โดยไม่แตะ db

**Files:**
- Create: `server/src/services/snapshot.ts`
- Test: `server/src/services/snapshot.test.ts`

**Interfaces:**
- Consumes (จาก `@finflow/shared`): `categoryTrends(txns)`, `generateInsights(txns, profile)`, `detectRecurring(txns)`, `computeHealthScore(txns, profile)`, `expenseByCategory(txns)`, `taxOverview(txns, profile, rules)`, `getRules(year)`, `defaultTaxProfile(year)`, `CATEGORY_META`, `monthKey(date)`, `thaiMonthLabel(key)`, `isConsumption(t)`, `isRealIncome(t)`, `round(n, dp?)`; types `Transaction`, `ScoreProfile`, `TaxProfile`. จาก `../sanitize.js`: `sanitizeText(s)`
- Produces (Task 2 ใช้): `buildSnapshot(txns: Transaction[], opts?: SnapshotOpts): string` โดย `interface SnapshotOpts { scoreProfile?: ScoreProfile; taxProfile?: TaxProfile }`

- [ ] **Step 1: Write the failing test**

สร้าง `server/src/services/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Transaction } from '@finflow/shared';
import { buildSnapshot } from './snapshot.js';

let n = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${n++}`,
    date: '2026-01-15',
    amount: 100,
    direction: 'out',
    counterparty: 'ร้านค้า',
    source: 'kbank',
    category: 'food',
    ...p,
  };
}

describe('buildSnapshot', () => {
  it('เคสไม่มีข้อมูล: คืนข้อความว่ายังไม่มีข้อมูล ไม่ throw', () => {
    expect(buildSnapshot([])).toContain('ยังไม่มีข้อมูล');
  });

  it('ตารางรายเดือน: คำนวณรายรับ/จ่าย/ออมต่อเดือนถูกต้อง', () => {
    const txns: Transaction[] = [
      tx({ date: '2026-01-05', direction: 'in', category: 'income', amount: 30000 }),
      tx({ date: '2026-01-10', amount: 8000, category: 'food' }),
      tx({ date: '2026-02-05', direction: 'in', category: 'income', amount: 30000 }),
      tx({ date: '2026-02-10', amount: 12000, category: 'food' }),
    ];
    const out = buildSnapshot(txns);
    // ม.ค.: รายรับ 30,000 รายจ่าย 8,000 ออม 22,000
    expect(out).toMatch(/รายรับ 30,000/);
    expect(out).toMatch(/ออมสุทธิ 22,000/);
    // ภาพรวม: ออมสุทธิรวม 60,000 - 20,000 = 40,000
    expect(out).toContain('ภาพรวมทั้งช่วง');
  });

  it('ความผิดปกติ: หมวดที่พุ่ง z>2 โผล่ในส่วนข้อสังเกต', () => {
    const txns: Transaction[] = [
      tx({ date: '2026-01-10', amount: 1000, category: 'shopping' }),
      tx({ date: '2026-02-10', amount: 1000, category: 'shopping' }),
      tx({ date: '2026-03-10', amount: 1000, category: 'shopping' }),
      tx({ date: '2026-04-10', amount: 50000, category: 'shopping' }),
    ];
    const out = buildSnapshot(txns);
    expect(out).toContain('ข้อสังเกต');
  });

  it('เคสเดือนเดียว: ไม่ throw และมีภาพรวม', () => {
    const txns: Transaction[] = [
      tx({ date: '2026-01-05', direction: 'in', category: 'income', amount: 20000 }),
      tx({ date: '2026-01-10', amount: 5000, category: 'food' }),
    ];
    expect(() => buildSnapshot(txns)).not.toThrow();
    expect(buildSnapshot(txns)).toContain('ภาพรวมทั้งช่วง');
  });

  it('ไม่รั่วเลขบัญชีดิบของบิลประจำ (ผ่าน sanitize)', () => {
    const txns: Transaction[] = [];
    for (let i = 0; i < 4; i++) {
      txns.push(
        tx({
          date: `2026-0${i + 1}-01`,
          amount: 399,
          category: 'bills',
          counterparty: 'Netflix xxxx123456789',
        }),
      );
    }
    const out = buildSnapshot(txns);
    expect(out).not.toContain('123456789');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/services/snapshot.test.ts`
Expected: FAIL — `Cannot find module './snapshot.js'` (ยังไม่ได้สร้างไฟล์)

- [ ] **Step 3: Write the implementation**

สร้าง `server/src/services/snapshot.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/services/snapshot.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: ผ่าน ไม่มี error

- [ ] **Step 6: Commit**

```bash
git add server/src/services/snapshot.ts server/src/services/snapshot.test.ts
git commit -m "feat(chat): always-on financial fact-sheet builder (buildSnapshot)"
```

---

### Task 2: เชื่อม fact-sheet เข้าระบบตอบ (focus layer + prompt + route)

ลดบทบาท `buildChatContext` เหลือ "โฟกัส + ตัวอย่างรายการ", เปลี่ยน `answerQuestion` ให้รับ snapshot + focus + history พร้อม prompt กันมั่ว, และต่อสายใน route ทั้งหมด (เปลี่ยนพร้อมกันเพราะ type ผูกกัน)

**Files:**
- Modify: `server/src/services/chat.ts` (เขียน `buildChatContext` ใหม่ทั้งฟังก์ชัน + ตัด helper ที่ไม่ใช้)
- Modify: `server/src/services/gemini.ts` (`answerQuestion` signature + prompt + rule-based fallback)
- Modify: `server/src/routes/chat.ts` (schema + wiring)
- Test: `server/src/services/chat.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `buildSnapshot(txns, opts)` (Task 1); `getScoreProfile()`, `getTaxProfile()`, `getAllTransactions()` จาก `../db.js`
- Produces:
  - `buildChatContext(question: string, txns: Transaction[]): { focus: string; sample: SafeTransaction[] }`
  - `answerQuestion(question: string, snapshot: string, focus: string, sample: SafeTransaction[], history?: { role: 'user' | 'bot'; text: string }[]): Promise<{ text: string; source: TextSource }>`

- [ ] **Step 1: Write the failing test for `buildChatContext`**

สร้าง `server/src/services/chat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Transaction } from '@finflow/shared';
import { buildChatContext } from './chat.js';

let n = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${n++}`,
    date: '2026-02-15',
    amount: 100,
    direction: 'out',
    counterparty: 'ร้านอาหาร',
    source: 'kbank',
    category: 'food',
    ...p,
  };
}

describe('buildChatContext', () => {
  const txns: Transaction[] = [
    tx({ date: '2026-02-10', amount: 200, category: 'food' }),
    tx({ date: '2026-02-11', amount: 500, category: 'shopping' }),
  ];

  it('ตรวจจับหมวด+เดือน: ใส่ focus และ sample เฉพาะหมวดที่ถาม', () => {
    const { focus, sample } = buildChatContext('เดือนนี้ค่าอาหารเท่าไหร่', txns);
    expect(focus).toContain('🎯');
    expect(focus).toContain('อาหาร');
    expect(sample.every((s) => s.category === 'food')).toBe(true);
  });

  it('คำถามทั่วไปที่ไม่ระบุหมวด/เดือน: focus ว่าง แต่ยังมี sample', () => {
    const { focus, sample } = buildChatContext('ช่วยดูการเงินหน่อย', txns);
    expect(focus).toBe('');
    expect(sample.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/services/chat.test.ts`
Expected: FAIL — `buildChatContext` ยังคืน `{ facts, sample }` (ไม่มี `focus`) → assertion ล้ม / type ผิด

- [ ] **Step 3: เขียน `buildChatContext` ใหม่ใน `server/src/services/chat.ts`**

แทนที่ทั้งไฟล์ `server/src/services/chat.ts` ด้วย (เก็บ `detectCategory`/`detectMonth`/`monthsOf` ไว้, ตัดส่วนคำนวณ facts + import ที่ไม่ใช้ออก):

```ts
import type { CategoryId, Transaction } from '@finflow/shared';
import {
  ALL_CATEGORIES,
  CATEGORY_META,
  isConsumption,
  monthKey,
  round,
  thaiMonthLabel,
} from '@finflow/shared';
import { toSafeTransaction, type SafeTransaction } from '../sanitize.js';

const THAI_MONTH_NAMES: Record<string, number> = {
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
};

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

/** ดึงรายชื่อเดือนที่มีข้อมูล เรียงเก่า→ใหม่ */
function monthsOf(txns: Transaction[]): string[] {
  return [...new Set(txns.map((t) => monthKey(t.date)))].sort();
}

/** ระบุหมวดที่ผู้ใช้พูดถึง (จากชื่อไทยของหมวด) */
function detectCategory(q: string): CategoryId | null {
  for (const c of ALL_CATEGORIES) {
    const head = CATEGORY_META[c].label.split(/[/]/)[0]!;
    if (q.includes(head)) return c;
  }
  if (/กิน|ข้าว|กาแฟ|อาหาร/.test(q)) return 'food';
  if (/เดินทาง|รถ|น้ำมัน|แท็กซี่|grab/i.test(q)) return 'transport';
  if (/ช้อป|ซื้อของ|เสื้อผ้า/.test(q)) return 'shopping';
  if (/บิล|ค่าไฟ|ค่าน้ำ|ค่าเช่า/.test(q)) return 'bills';
  return null;
}

/** ระบุเดือนที่ผู้ใช้พูดถึง คืน month key หรือ null */
function detectMonth(q: string, txns: Transaction[]): string | null {
  const months = monthsOf(txns);
  if (months.length === 0) return null;
  if (/เดือนนี้|เดือนล่าสุด|ปัจจุบัน/.test(q)) return months[months.length - 1]!;
  if (/เดือนที่แล้ว|เดือนก่อน/.test(q)) return months[months.length - 2] ?? months[months.length - 1]!;
  for (const [name, num] of Object.entries(THAI_MONTH_NAMES)) {
    if (q.includes(name) || q.includes(name.slice(0, 3))) {
      return months.find((m) => Number(m.split('-')[1]) === num) ?? null;
    }
  }
  return null;
}

export interface ChatFocus {
  /** ข้อความโฟกัส 1 บรรทัด (อาจว่าง) ช่วยชี้เป้าให้ LLM */
  focus: string;
  /** ตัวอย่างรายการที่เกี่ยวข้อง (sanitize แล้ว) */
  sample: SafeTransaction[];
}

/**
 * โฟกัสคำถาม: เลือกตัวอย่างรายการให้ตรงคำถาม + สร้างบรรทัดโฟกัส
 * ตัวเลขสรุปทั้งหมดย้ายไปอยู่ใน buildSnapshot แล้ว — ฟังก์ชันนี้ไม่คำนวณ facts อีก
 */
export function buildChatContext(question: string, txns: Transaction[]): ChatFocus {
  const category = detectCategory(question);
  const month = detectMonth(question, txns);
  const parts: string[] = [];

  let scope = txns;
  if (month) {
    scope = scope.filter((t) => monthKey(t.date) === month);
    parts.push(`เดือน ${thaiMonthLabel(month)}`);
  }

  let relevant = scope;
  if (category) {
    relevant = scope.filter((t) => t.category === category && isConsumption(t));
    const total = relevant.reduce((a, t) => a + t.amount, 0);
    parts.push(`หมวด "${CATEGORY_META[category].label}" รวม ${fmt(round(total))} บาท (${relevant.length} รายการ)`);
  }

  const focus = parts.length ? `🎯 โฟกัส: ${parts.join(' · ')}` : '';
  const sample = (category ? relevant : scope)
    .filter((t) => !t.isTransfer)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 40)
    .map(toSafeTransaction);

  return { focus, sample };
}
```

- [ ] **Step 4: Run the `buildChatContext` test (still fails on the `answerQuestion` callers compiling)**

Run: `npx vitest run server/src/services/chat.test.ts`
Expected: PASS (2 tests) — ไฟล์ `chat.ts` คอมไพล์เองได้ ส่วน `gemini.ts`/route จะแก้ในสเต็ปถัดไป

- [ ] **Step 5: แก้ `answerQuestion` ใน `server/src/services/gemini.ts`**

แทนที่ฟังก์ชัน `answerQuestion` เดิม (บรรทัด ~107–138) ด้วยเวอร์ชันใหม่ + เพิ่ม helper `ruleBasedAnswer` ใต้ฟังก์ชัน:

```ts
/**
 * ตอบคำถามแบบ RAG: fact-sheet + ตัวเลขถูกคำนวณด้วยโค้ดแล้ว LLM เลือก+เรียบเรียงเท่านั้น
 * รองรับการถามต่อเนื่องด้วย history (บทสนทนาก่อนหน้า)
 */
export async function answerQuestion(
  question: string,
  snapshot: string,
  focus: string,
  sample: SafeTransaction[],
  history: { role: 'user' | 'bot'; text: string }[] = [],
): Promise<{ text: string; source: TextSource }> {
  const ctx = sample
    .slice(0, 40)
    .map((t) => `${t.date} ${t.direction === 'out' ? '-' : '+'}${fmt(t.amount)} ${t.merchant} [${t.category}]`)
    .join('\n');

  const convo = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'ผู้ใช้' : 'ผู้ช่วย'}: ${m.text}`)
    .join('\n');

  const prompt = `คุณเป็นผู้ช่วยการเงินส่วนตัว พูดภาษาไทย ตอบให้ "ตรงคำถาม" ก่อนเสมอ กระชับ เป็นกันเอง
กฎ:
- ใช้เฉพาะตัวเลขใน "ข้อมูลการเงิน" ด้านล่าง ห้ามแต่งตัวเลขเอง
- ถ้าข้อมูลไม่พอจะตอบ ให้บอกตรงๆ ว่าไม่มีข้อมูลส่วนนั้น อย่าเดา
- ถ้าผู้ใช้ขอคำแนะนำ ให้ยกจุดอ่อน/ความผิดปกติจากข้อมูลมาประกอบ

== ข้อมูลการเงิน (คำนวณด้วยโค้ดแล้ว) ==
${snapshot}

${focus ? focus + '\n\n' : ''}== ตัวอย่างรายการที่เกี่ยวข้อง ==
${ctx || '(ไม่มี)'}
${convo ? `\n== บทสนทนาก่อนหน้า ==\n${convo}\n` : ''}
คำถามล่าสุด: ${question}
ตอบ:`;

  const ai = await generate(prompt);
  if (ai) return { text: ai.text, source: ai.source };
  return { text: ruleBasedAnswer(question, snapshot, focus), source: 'rule-based' };
}

/** fallback ไม่มี LLM: เลือก section ที่เกี่ยวข้องกับคำถามจาก fact-sheet (แทนการเทดิบทั้งก้อน) */
function ruleBasedAnswer(question: string, snapshot: string, focus: string): string {
  const sections = snapshot.split('\n\n');
  const q = question.toLowerCase();
  const pick = (kw: RegExp) => sections.find((s) => kw.test(s));
  let sec: string | undefined;
  if (/ผิดปกติ|แปลก|ปกติ/.test(q)) sec = pick(/ข้อสังเกต|ผิดปกติ/);
  else if (/ภาษี|ลดหย่อน|ยื่น/.test(q)) sec = pick(/^ภาษี/);
  else if (/บิล|ประจำ|สมาชิก|subscription/i.test(q)) sec = pick(/ประจำ/);
  else if (/คะแนน|สุขภาพ|เก็บเงิน|ออม|เหลือ/.test(q)) sec = pick(/สุขภาพการเงิน|ภาพรวม/);
  else if (/หมวด|มากสุด|เยอะ|top/i.test(q)) sec = pick(/เจาะลึก|เทรนด์รายหมวด/);
  const body = sec ?? sections[0] ?? snapshot;
  return [focus, body].filter(Boolean).join('\n');
}
```

- [ ] **Step 6: แก้ route `server/src/routes/chat.ts`**

แทนที่ทั้งไฟล์ด้วย:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { getAllTransactions, getScoreProfile, getTaxProfile } from '../db.js';
import { buildChatContext } from '../services/chat.js';
import { buildSnapshot } from '../services/snapshot.js';
import { answerQuestion } from '../services/gemini.js';

export const chatRouter = Router();

/**
 * POST /api/chat { question, history? }
 * โค้ดสร้าง fact-sheet ครบทุกด้าน (ตัวเลขคำนวณเอง) + โฟกัสคำถาม แล้วให้ LLM เลือก/เรียบเรียง
 * ถ้าไม่มี LLM key จะ fallback เป็น rule-based (เลือก section ที่เกี่ยวข้อง)
 */
chatRouter.post('/', async (req, res) => {
  const schema = z.object({
    question: z.string().min(1).max(500),
    history: z
      .array(z.object({ role: z.enum(['user', 'bot']), text: z.string().max(2000) }))
      .max(12)
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'กรุณาพิมพ์คำถาม' });

  const txns = getAllTransactions();
  const snapshot = buildSnapshot(txns, { scoreProfile: getScoreProfile(), taxProfile: getTaxProfile() });
  const { focus, sample } = buildChatContext(parsed.data.question, txns);
  const { text, source } = await answerQuestion(
    parsed.data.question,
    snapshot,
    focus,
    sample,
    parsed.data.history ?? [],
  );

  res.json({
    answer: text,
    facts: focus ? `${focus}\n\n${snapshot}` : snapshot,
    source,
    contextSize: sample.length,
  });
});
```

- [ ] **Step 7: รันเทสต์ทั้งหมด + typecheck**

Run: `npm test`
Expected: PASS ทุกไฟล์ (รวม snapshot.test.ts + chat.test.ts)

Run: `npm run typecheck`
Expected: ผ่านทั้ง 3 workspace (ยืนยันว่า `answerQuestion` signature ใหม่ตรงกับ caller ใน route)

- [ ] **Step 8: Commit**

```bash
git add server/src/services/chat.ts server/src/services/chat.test.ts server/src/services/gemini.ts server/src/routes/chat.ts
git commit -m "feat(chat): feed full fact-sheet + conversation history to assistant"
```

---

### Task 3: ฝั่ง client ส่งประวัติบทสนทนา

ให้ `Assistant.tsx` แนบ `history` (ข้อความล่าสุด) ไปกับทุก request เพื่อให้ถามต่อเนื่องได้

**Files:**
- Modify: `client/src/pages/Assistant.tsx` (ฟังก์ชัน `send`)

**Interfaces:**
- Consumes: route `POST /api/chat` รับ `{ question, history }` (Task 2); `apiSend<T>(path, method, body)` จาก `../lib/api`

- [ ] **Step 1: แก้ฟังก์ชัน `send` ให้แนบ history**

ใน `client/src/pages/Assistant.tsx` แทนที่บล็อก `try { ... }` ภายใน `send` (บรรทัด ~33–35) ด้วย:

```tsx
    try {
      // แนบบทสนทนาก่อนหน้า (สูงสุด 6 ข้อความ) ให้ถามต่อเนื่องได้ เช่น "แล้วเดือนก่อนล่ะ"
      const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      const res = await apiSend<{ answer: string; facts: string; source: string }>('/chat', 'POST', { question, history });
      setMsgs((m) => [...m, { role: 'bot', text: res.answer, facts: res.facts, source: res.source }]);
    } catch (e) {
```

> หมายเหตุ: `msgs` ใน closure คือสถานะ "ก่อนเพิ่มข้อความผู้ใช้ล่าสุด" (เพราะ setState เป็น async) ซึ่งตรงกับที่ต้องการพอดี — `question` ถือคำถามล่าสุด ส่วน `history` คือเทิร์นก่อนหน้า. ฟิลด์ `role` เป็น `'user' | 'bot'` ตรงกับ enum ใน schema ฝั่ง server แล้ว

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: ผ่าน ไม่มี error (`m.role` เป็น `'user' | 'bot'` ตรงกับ body ที่ route รับ)

- [ ] **Step 3: ตรวจด้วย dev server (manual)**

Run: `npm run dev` แล้วเปิดหน้า "ผู้ช่วย AI ถาม–ตอบ"
ทดสอบ:
1. ถาม "เดือนนี้ใช้ค่าอาหารไปเท่าไหร่" → ได้ตัวเลข + กดดู "ตัวเลขที่ใช้ตอบ" เห็น fact-sheet เต็ม
2. ถามต่อ "แล้วเดือนก่อนล่ะ" → ตอบเดือนก่อนได้ (ยืนยันความจำบทสนทนา)
3. ถาม "มีอะไรผิดปกติในรายจ่ายไหม" → ตอบอ้างอิงส่วนข้อสังเกต ไม่ตอบมั่ว

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Assistant.tsx
git commit -m "feat(chat): send conversation history for follow-up questions"
```

---

## Self-Review

**1. Spec coverage:**
- Fact-sheet ครบทุกด้าน (8 ส่วน) → Task 1 ✓ (overview, monthly, latest-month, trend, insights/anomaly, recurring, health, tax)
- Focus layer (ลดบทบาท detect) → Task 2 Step 3 ✓
- Conversation memory → Task 2 (schema+prompt) + Task 3 (client) ✓
- Prompt + กันมั่ว + rule-based เลือก section → Task 2 Step 5 ✓
- รักษาตัวเลขจากโค้ด + provider order + sanitize → Global Constraints + reuse ฟังก์ชันเดิม ✓
- เทสต์ buildSnapshot (anomaly, monthly, empty, single-month, ไม่รั่วข้อมูล) → Task 1 ✓

**2. Placeholder scan:** ไม่มี TODO/TBD — โค้ดเต็มทุกสเต็ป ✓

**3. Type consistency:**
- `buildSnapshot(txns, opts?) → string` ใช้ตรงกันใน route ✓
- `buildChatContext → { focus, sample }` ใช้ตรงกันใน route + test ✓
- `answerQuestion(question, snapshot, focus, sample, history?)` — caller เดียวคือ route, signature ตรง ✓
- `history` item `{ role: 'user' | 'bot'; text: string }` ตรงกันทั้ง client → schema → prompt ✓
- `SnapshotOpts.{scoreProfile,taxProfile}` ป้อนจาก `getScoreProfile()/getTaxProfile()` (ชนิด `ScoreProfile`/`TaxProfile`) ✓

หมายเหตุ: หลัง Task 2 ฟิลด์ผลลัพธ์ `facts` ใน JSON response ยังชื่อเดิม → หน้า client เดิม (panel "ตัวเลขที่ใช้ตอบ") ใช้งานได้ทันทีโดยไม่ต้องแก้ ✓
