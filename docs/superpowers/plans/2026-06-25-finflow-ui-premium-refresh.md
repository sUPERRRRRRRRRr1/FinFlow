# FinFlow Premium UX/UI Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ยกระดับหน้าตา FinFlow ให้ดูพรีเมียมขึ้นทั้งแอป โดยแก้ที่ชั้น design system (tokens + primitives + ไอคอน) เป็นหลัก

**Architecture:** แก้ที่ `global.css` (design tokens + คลาส primitive ที่ทุกหน้า reuse), `ui.tsx` (`Stat` component), `Layout.tsx` (เมนู), เพิ่มโมดูลไอคอน `lib/icons.tsx` ครอบ `lucide-react` และโชว์เคสบน `Dashboard.tsx`. ทุกหน้าได้ลุคใหม่ผ่านคลาส/component ที่ใช้ร่วมกัน โดยไม่แตะ logic/data/API

**Tech Stack:** React 18 + TypeScript, Vite, plain CSS + CSS variables, recharts (เดิม), เพิ่ม `lucide-react`

## Global Constraints

- **Visual-only** — ห้ามแก้ logic, การคำนวณ, endpoint, รูปแบบข้อมูล หรือ data flow ใดๆ
- **Additive API** — ขยาย prop ของ component เดิมแบบ optional เท่านั้น ของเดิมที่เรียกอยู่ต้องเรนเดอร์ได้เหมือนเดิม
- **คงสถาปัตยกรรมเดิม** — plain CSS + CSS variables + inline style; ห้ามเพิ่ม Tailwind/CSS-in-JS/animation library
- **Dark mode + responsive (≤900px)** ต้องทำงานถูกต้องทุกการเปลี่ยนแปลง — ทุก token ต้องมีค่าใช้ได้ทั้งสองโหมด
- **lucide-react ต้อง import แบบ named** (`import { Wallet } from 'lucide-react'`) เพื่อให้ tree-shake; ห้าม `import * as`
- **ห้ามกุตัวเลข** — trend chip ต้องคำนวณจากข้อมูลจริงใน `o.monthly` เท่านั้น; ถ้าคำนวณไม่ได้ให้ไม่แสดง chip
- **เกณฑ์ผ่านอัตโนมัติของทุก task:** `npm run typecheck` และ `npm run build` ต้องผ่าน (ไม่มี type error)

> **หมายเหตุเรื่องการทดสอบ:** งานนี้เป็น CSS/visual ล้วน ไม่มี unit test ที่มีความหมาย (และโปรเจกต์ไม่มี test harness ฝั่ง client) — การ "ทดสอบ" แต่ละ task คือ (1) `npm run typecheck` + `npm run build` ผ่าน และ (2) ยืนยันด้วยตา ผ่าน preview tools (`preview_start` → `preview_screenshot`/`preview_resize`) เทียบก่อน/หลัง การเขียน unit test ปลอมสำหรับ CSS ถือเป็น placeholder ที่ห้ามทำ

## File Structure

| ไฟล์ | สถานะ | ความรับผิดชอบ |
|------|-------|----------------|
| `client/package.json` | modify | เพิ่ม dependency `lucide-react` |
| `client/src/lib/icons.tsx` | **create** | รวมการ map ไอคอน: `NAV_ICONS`, `CATEGORY_ICONS`, component `<CategoryIcon>` |
| `client/src/styles/global.css` | modify | design tokens ใหม่ + ขัด primitive (`.card`/`.nav-link`/`.btn`/`.badge`/`.seg`/ตาราง/`.ic`) |
| `client/src/components/ui.tsx` | modify | `Stat` รองรับ `accent` + `trend` (additive) |
| `client/src/components/Layout.tsx` | modify | เมนูใช้ `NAV_ICONS` แทน emoji |
| `client/src/pages/Dashboard.tsx` | modify | โชว์เคส: `CategoryIcon` ในหมวดรายจ่าย + trend chip บน stat tile (คำนวณจริง) |

---

### Task 1: เพิ่ม lucide-react + โมดูลไอคอน

**Files:**
- Modify: `client/package.json`
- Create: `client/src/lib/icons.tsx`

**Interfaces:**
- Produces:
  - `NAV_ICONS: Record<string, LucideIcon>` — key = route path (`'/'`, `'/transactions'`, …)
  - `CATEGORY_ICONS: Record<string, { Icon: LucideIcon; tint: string }>` — key = `CategoryId`
  - `CategoryIcon({ category, size?, style? }: { category: string; size?: number; style?: CSSProperties }): JSX.Element` — ชิปไอคอนหมวดพร้อม fallback เป็น `other`

- [ ] **Step 1: ติดตั้ง lucide-react ใน workspace client**

Run: `npm install lucide-react -w client`
Expected: ติดตั้งสำเร็จ, `client/package.json` มี `"lucide-react"` ใน `dependencies`

- [ ] **Step 2: สร้างโมดูลไอคอน**

สร้าง `client/src/lib/icons.tsx`:

```tsx
import {
  LayoutDashboard, Receipt, Split, LineChart, Sparkles, AlertTriangle,
  Target, FileText, Bot, Link2,
  Wallet, UtensilsCrossed, ShoppingBag, Bus, ReceiptText, Clapperboard,
  HeartPulse, GraduationCap, ArrowLeftRight, PiggyBank, Package,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

/** ไอคอนเมนู (เดิมเป็น emoji ใน Layout) — key = route path */
export const NAV_ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/transactions': Receipt,
  '/flow': Split,
  '/timeline': LineChart,
  '/forecast': Sparkles,
  '/anomalies': AlertTriangle,
  '/budgets': Target,
  '/tax': FileText,
  '/assistant': Bot,
  '/connect': Link2,
};

/** ไอคอน + สีชิปต่อหมวด (CategoryId) — สี tint = สีเดิมของหมวดใน shared/categories.ts */
export const CATEGORY_ICONS: Record<string, { Icon: LucideIcon; tint: string }> = {
  income: { Icon: Wallet, tint: '#16a34a' },
  food: { Icon: UtensilsCrossed, tint: '#f97316' },
  shopping: { Icon: ShoppingBag, tint: '#ec4899' },
  transport: { Icon: Bus, tint: '#0ea5e9' },
  bills: { Icon: ReceiptText, tint: '#6366f1' },
  entertainment: { Icon: Clapperboard, tint: '#a855f7' },
  health: { Icon: HeartPulse, tint: '#ef4444' },
  education: { Icon: GraduationCap, tint: '#14b8a6' },
  transfer: { Icon: ArrowLeftRight, tint: '#94a3b8' },
  savings: { Icon: PiggyBank, tint: '#22c55e' },
  other: { Icon: Package, tint: '#64748b' },
};

/** ชิปไอคอนหมวด พร้อม fallback เป็น "other" ถ้า key ไม่อยู่ใน map */
export function CategoryIcon({
  category,
  size = 16,
  style,
}: {
  category: string;
  size?: number;
  style?: CSSProperties;
}) {
  const { Icon, tint } = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other;
  const box = Math.round(size * 1.55);
  return (
    <span
      style={{
        width: box,
        height: box,
        borderRadius: Math.round(box * 0.32),
        background: `color-mix(in srgb, ${tint} 15%, transparent)`,
        color: tint,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}
```

- [ ] **Step 3: ตรวจ typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: ผ่านทั้งคู่ ไม่มี type error (ยืนยันว่าชื่อไอคอน lucide ทั้งหมดมีจริง)

- [ ] **Step 4: Commit**

```bash
git add client/package.json client/package-lock.json package-lock.json client/src/lib/icons.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add lucide-react icon module (NAV_ICONS, CategoryIcon)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Design tokens ใหม่ใน global.css

**Files:**
- Modify: `client/src/styles/global.css:1-35` (`:root` + `[data-theme='dark']`)

**Interfaces:**
- Produces: CSS variables ใหม่ — `--shadow-sm/-shadow/-shadow-lg` (layered), `--space-1..6`, `--radius-lg`, `--radius-pill`, `--fs-display/-h1/-h2/-body/-sm/-xs`, `--dur`, `--ease`. ตัวแปรเดิม (`--brand`, `--surface`, `--radius`, …) คงไว้ทั้งหมด

- [ ] **Step 1: แทนที่ `--shadow` เดิมด้วยชุด elevation + เพิ่ม token ใหม่ใน `:root`**

ใน `client/src/styles/global.css` แก้บล็อก `:root` — แทนบรรทัด `--shadow: …;` เดิม (บรรทัด 19) ด้วยชุดด้านล่าง และเพิ่ม token ใหม่ก่อนปิด `:root` (หลังบรรทัด `--mono`):

```css
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 12px 28px -12px rgba(15, 23, 42, 0.14);
  --shadow-lg: 0 2px 4px rgba(15, 23, 42, 0.06), 0 20px 40px -16px rgba(15, 23, 42, 0.22);
  --radius: 16px;
  --radius-sm: 10px;
  --radius-lg: 20px;
  --radius-pill: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --fs-display: 30px;
  --fs-h1: 26px;
  --fs-h2: 20px;
  --fs-body: 15px;
  --fs-sm: 13px;
  --fs-xs: 11.5px;
  --dur: 0.18s;
  --ease: cubic-bezier(0.4, 0, 0.2, 1);
```

(ลบบรรทัด `--radius: 16px;` และ `--radius-sm: 10px;` เดิมที่อยู่ถัดจาก `--shadow` เพื่อกันซ้ำ — ให้คงไว้เฉพาะชุดใหม่ด้านบน)

- [ ] **Step 2: แทนที่ `--shadow` ใน dark mode ด้วยชุด layered**

ในบล็อก `[data-theme='dark']` แทนบรรทัด `--shadow: …;` เดิม (บรรทัด 34) ด้วย:

```css
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 14px 30px -14px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 2px 4px rgba(0, 0, 0, 0.4), 0 24px 44px -18px rgba(0, 0, 0, 0.6);
```

- [ ] **Step 3: ตรวจ build + ดูผลรวม**

Run: `npm run build`
Expected: ผ่าน

ใช้ `preview_start` (ถ้ายังไม่รัน) แล้ว `preview_screenshot` หน้าแรก — ยืนยันว่าการ์ดยังเรนเดอร์ปกติ เงานุ่มขึ้นเล็กน้อย ไม่มีอะไรพัง

- [ ] **Step 4: Commit**

```bash
git add client/src/styles/global.css
git commit -m "$(cat <<'EOF'
feat(ui): layered shadow + spacing/type/motion tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ขัด primitive ใน global.css

**Files:**
- Modify: `client/src/styles/global.css` — `.card` (170-186), `.nav-link` (104-127), `.btn` (222-238), `.seg` (251-270), `table.tbl` (272-289)

**Interfaces:**
- Produces: คลาส CSS เดิมหน้าตาใหม่ + คลาส opt-in `.card.lift` (ยก translateY เฉพาะการ์ดที่กดได้)

- [ ] **Step 1: `.card` — transition + hover ละมุน + opt-in lift**

แทนบล็อก `.card { … }` เดิมด้วย:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  box-shadow: var(--shadow);
  transition: box-shadow var(--dur) var(--ease), border-color var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}
.card:hover {
  box-shadow: var(--shadow-lg);
}
.card.lift:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--brand-2) 35%, var(--border));
}
```

> เหตุผล (taste guardrail): การ์ดส่วนใหญ่ใน FinFlow เป็นพาเนลข้อมูลที่กดไม่ได้ — ยก `translateY` ทุกใบจะดู "เด้ง" ผิดที่ จึงให้ทุกใบแค่เงาเข้มขึ้นนุ่มๆ ตอน hover และเปิด `.lift` เป็น opt-in สำหรับการ์ดที่คลิกได้จริงเท่านั้น

- [ ] **Step 2: `.nav-link` — active แบบ soft + indicator + รองรับ dark**

แทนบล็อก `.nav-link.active { … }` เดิม (บรรทัด 119-122) ด้วย และเพิ่ม `position: relative` ใน `.nav-link`:

```css
.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-weight: 500;
  font-size: 15px;
  position: relative;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.nav-link:hover {
  background: var(--surface-2);
  color: var(--text);
}
.nav-link.active {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}
.nav-link.active::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 9px;
  background: var(--brand);
}
[data-theme='dark'] .nav-link.active {
  color: var(--brand-2);
}
[data-theme='dark'] .nav-link.active::before {
  background: var(--brand-2);
}
```

> เหตุผล: dark mode มี `--brand-soft: #134e4a` (เข้ม) ถ้าใช้ตัวอักษร `--brand` (#0f766e) จะคอนทราสต์ต่ำ — จึงสลับเป็น `--brand-2` (#14b8a6, สว่างกว่า) เฉพาะ dark

- [ ] **Step 3: `.btn` — focus ring + press + transition**

แทนบล็อก `.btn` (และ `:hover`) เดิมด้วย:

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 9px 16px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 14px;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}
.btn:hover { border-color: var(--brand-2); }
.btn:active { transform: scale(0.97); }
.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-2) 35%, transparent);
}
.btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.btn.primary:hover { background: #0d6258; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 4: `.seg button` + แถวตาราง hover**

เพิ่ม transition ให้ `.seg button` (แทนบล็อกเดิม) และเพิ่ม hover ให้แถวตาราง (เพิ่มต่อท้ายบล็อก `.tbl`):

```css
.seg button {
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 6px 16px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 13px;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.seg button.active {
  background: var(--brand);
  color: #fff;
}
.tbl tr:hover td { background: var(--surface-2); }
```

- [ ] **Step 5: ตรวจ build + ดูผล**

Run: `npm run build`
Expected: ผ่าน

ใช้ `preview_screenshot` หน้าแรก + hover เมนู/การ์ด — ยืนยัน active เมนูเป็นพื้นเขียวอ่อน + แถบซ้าย, ปุ่ม focus มี ring

- [ ] **Step 6: Commit**

```bash
git add client/src/styles/global.css
git commit -m "$(cat <<'EOF'
feat(ui): polish card/nav/btn/seg/table primitives

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `Stat` รองรับ accent + trend chip

**Files:**
- Modify: `client/src/components/ui.tsx:42-50` (`Stat`)

**Interfaces:**
- Consumes: `lucide-react` (Task 1 ติดตั้งแล้ว)
- Produces:
  - `type Trend = { dir: 'up' | 'down' | 'flat'; text: string; tone?: 'good' | 'bad' | 'muted' }`
  - `Stat({ label, value, sub, accent?, trend? }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; trend?: Trend }): JSX.Element` — `accent` = สีแถบซ้าย (inset shadow, ไม่ดันเลย์เอาต์), `trend` = ชิป ▲▼ %

- [ ] **Step 1: เพิ่ม import + type + TrendChip + อัปเดต Stat**

ใน `client/src/components/ui.tsx` เพิ่ม import บนสุด (ใต้ `import type { ReactNode }`):

```tsx
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
```

แทนฟังก์ชัน `Stat` เดิมด้วย:

```tsx
export type Trend = { dir: 'up' | 'down' | 'flat'; text: string; tone?: 'good' | 'bad' | 'muted' };

function TrendChip({ dir, text, tone = 'muted' }: Trend) {
  const cls = tone === 'good' ? 'good' : tone === 'bad' ? 'alert' : '';
  const Arrow = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  return (
    <span className={`badge ${cls}`} style={{ marginTop: 8, fontSize: 11.5 }}>
      <Arrow size={13} strokeWidth={2.5} />
      {text}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  trend?: Trend;
}) {
  return (
    <div
      className="card stat"
      style={accent ? { boxShadow: `var(--shadow), inset 3px 0 0 ${accent}` } : undefined}
    >
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {trend && <TrendChip {...trend} />}
      {sub && <div style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
```

> เหตุผล: ใช้ `inset 3px 0 0` (inner shadow) เป็นแถบ accent แทน `border-left` เพื่อไม่ให้ดันความกว้าง/มุมโค้งเพี้ยน และยังเคารพ `border-radius` ของการ์ด

- [ ] **Step 2: ตรวจ typecheck + build (backward-compat)**

Run: `npm run typecheck && npm run build`
Expected: ผ่าน — ทุกหน้าที่เรียก `<Stat label value sub />` เดิมยังคอมไพล์ได้ (prop ใหม่เป็น optional)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ui.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Stat supports accent bar + trend chip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: เปลี่ยนเมนูจาก emoji → lucide

**Files:**
- Modify: `client/src/components/Layout.tsx:14-25` (`NAV`), `:83-94` (render loop)
- Modify: `client/src/styles/global.css:123-127` (`.nav-link .ic`)

**Interfaces:**
- Consumes: `NAV_ICONS` (Task 1)

- [ ] **Step 1: เอา emoji ออกจาก NAV + ใช้ NAV_ICONS ตอน render**

ใน `client/src/components/Layout.tsx` เพิ่ม import:

```tsx
import { NAV_ICONS } from '../lib/icons';
```

แทน array `NAV` (เอา field `icon` ออก):

```tsx
const NAV = [
  { to: '/', label: 'ภาพรวม', end: true },
  { to: '/transactions', label: 'รายการ' },
  { to: '/flow', label: 'เส้นทางเงิน' },
  { to: '/timeline', label: 'ไทม์ไลน์' },
  { to: '/forecast', label: 'คาดการณ์' },
  { to: '/anomalies', label: 'รายจ่ายผิดปกติ' },
  { to: '/budgets', label: 'งบประมาณ' },
  { to: '/tax', label: 'ภาษี' },
  { to: '/assistant', label: 'ผู้ช่วย AI' },
  { to: '/connect', label: 'เชื่อมต่อข้อมูล' },
];
```

แทน `.map` block ของ NAV (บรรทัด 83-94) ด้วย:

```tsx
        {NAV.map((n) => {
          const Icon = NAV_ICONS[n.to];
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className="ic" aria-hidden="true">
                <Icon size={18} strokeWidth={2} />
              </span>
              {n.label}
            </NavLink>
          );
        })}
```

- [ ] **Step 2: ปรับ `.nav-link .ic` ให้รองรับ SVG**

ใน `client/src/styles/global.css` แทนบล็อก `.nav-link .ic { … }` (บรรทัด 123-127) ด้วย:

```css
.nav-link .ic {
  width: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 3: ตรวจ build + ดูเมนู**

Run: `npm run build`
Expected: ผ่าน

ใช้ `preview_screenshot` แถบเมนูซ้าย — ยืนยันเมนูทั้ง 10 เป็นไอคอนเส้น ไม่มี emoji, ตัวที่ active มีแถบซ้าย + พื้นเขียวอ่อน

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Layout.tsx client/src/styles/global.css
git commit -m "$(cat <<'EOF'
feat(ui): replace nav emoji with lucide line icons

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: โชว์เคสบน Dashboard — ไอคอนหมวด + trend chip จริง

**Files:**
- Modify: `client/src/pages/Dashboard.tsx:1-51` (import + แถวสถิติ), `:129-144` (หมวดรายจ่าย)

**Interfaces:**
- Consumes: `CategoryIcon` (Task 1), `Stat` accent/trend (Task 4)

- [ ] **Step 1: import CategoryIcon + helper คำนวณ trend จาก o.monthly**

ใน `client/src/pages/Dashboard.tsx` เพิ่ม import:

```tsx
import { CategoryIcon } from '../lib/icons';
import type { Trend } from '../components/ui';
```

เพิ่มฟังก์ชัน helper (วางท้ายไฟล์ ใต้ `AdviceCard`):

```tsx
/** trend เดือนล่าสุดเทียบเดือนก่อนหน้า จากข้อมูลจริง — คืน undefined ถ้าคำนวณไม่ได้ */
function monthTrend(curr: number | undefined, base: number | undefined, goodWhenUp: boolean): Trend | undefined {
  if (curr == null || base == null || base === 0) return undefined;
  const d = ((curr - base) / base) * 100;
  if (!isFinite(d)) return undefined;
  const dir = d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat';
  const tone = dir === 'flat' ? 'muted' : (dir === 'up') === goodWhenUp ? 'good' : 'bad';
  return { dir, text: `${Math.abs(d).toFixed(1)}%`, tone };
}
```

- [ ] **Step 2: ใส่ accent + trend บนแถวสถิติ (income/expense คำนวณจริง)**

ภายใน `{(o) => ( … )}` ก่อน `<div className="grid cols-5">` เพิ่มการคำนวณเดือนล่าสุด/ก่อนหน้า:

```tsx
            {(() => null)()}
```

ให้เปลี่ยนเป็น: วาง const ก่อน `return` ของ render callback แทน — แก้บรรทัด `{(o) => (` เป็น:

```tsx
        {(o) => {
          const m = o.monthly;
          const last = m[m.length - 1];
          const prev = m[m.length - 2];
          return (
```

และปิดท้าย callback (หลัง `</div>` ก้อนนอกสุด ก่อน `)}`) เพิ่ม `;` ปิด — เปลี่ยน `        )}` ท้าย `<Async>` เป็น:

```tsx
          );
        }}
```

จากนั้นแก้ 5 `<Stat>` ในแถวแรกให้มี `accent` และใส่ `trend` กับ income/expense:

```tsx
              <Stat
                label="รายรับรวม"
                value={thb(o.totals.income)}
                accent="var(--good)"
                trend={monthTrend(last?.income, prev?.income, true)}
                sub={<span className="muted">{o.count} รายการ</span>}
              />
              <Stat
                label="รายจ่ายรวม"
                value={thb(o.totals.expense)}
                accent="#f97316"
                trend={monthTrend(last?.expense, prev?.expense, false)}
                sub={<span className="muted">ไม่รวมการโอนระหว่างกระเป๋า</span>}
              />
              <Stat
                label="กันเข้าออม"
                value={<span className="down">{thb(o.totals.savings)}</span>}
                accent="var(--brand)"
                sub={<span className="muted">เงินที่โอนเข้าบัญชีออม (ไม่นับเป็นรายจ่าย)</span>}
              />
              <Stat
                label="ออมสุทธิ (สะสม)"
                value={<span className={o.totals.net >= 0 ? 'down' : 'up'}>{thb(o.totals.net)}</span>}
                accent="var(--info)"
                sub={<span className="muted">รายรับ−รายจ่ายสะสม · ไม่ใช่ยอดในบัญชี (ดูยอดจริงด้านล่าง)</span>}
              />
              <Stat
                label="อัตราการออม"
                value={pct(o.totals.savingsRate * 100)}
                accent={o.totals.savingsRate >= 0.2 ? 'var(--good)' : 'var(--warn)'}
                sub={
                  <span className={sevClass(o.totals.savingsRate >= 0.2 ? 'good' : 'warn') === 'good' ? 'down' : 'up'}>
                    เป้าหมาย 20%+
                  </span>
                }
              />
```

- [ ] **Step 3: เปลี่ยน emoji หมวด → CategoryIcon ในบล็อก "รายจ่ายตามหมวด"**

แก้บล็อก `o.byCategory.map(...)` (บรรทัด 133-143) — แทน `<span>{c.icon} {c.label}</span>` ด้วยไอคอนเส้น:

```tsx
              {o.byCategory.map((c) => (
                <div key={c.category} style={{ padding: '7px 0' }}>
                  <div className="row between" style={{ fontSize: 14 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <CategoryIcon category={c.category} size={15} />
                      {c.label}
                    </span>
                    <span><b>{thb(c.amount)}</b> <span className="muted">· {pct(c.pct)}</span></span>
                  </div>
                  <div style={{ height: 7, background: 'var(--surface-2)', borderRadius: 99, marginTop: 4 }}>
                    <div style={{ width: `${c.pct}%`, height: '100%', background: c.color, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
```

- [ ] **Step 4: ตรวจ typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: ผ่าน (ระวังวงเล็บปิด callback ที่เปลี่ยนจาก `(o) => (` เป็น `(o) => { … return ( … ); }`)

- [ ] **Step 5: ดูผลหน้า Dashboard**

ใช้ `preview_screenshot` หน้าแรก — ยืนยัน: stat tile มีแถบสีซ้าย + chip ▲/▼ บนรายรับ/รายจ่าย (เมื่อมี ≥2 เดือน), หมวดรายจ่ายเป็นชิปไอคอนเส้นสีแทน emoji

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Dashboard.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Dashboard showcase — category icons + real trend chips

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: ยืนยันข้ามโหมด — dark mode + responsive + build สุดท้าย

**Files:** (ไม่มีไฟล์ใหม่ — ตรวจสอบ/แก้ regression ถ้าพบ)

- [ ] **Step 1: build รวม**

Run: `npm run typecheck && npm run build`
Expected: ผ่านทั้งคู่ ไม่มี warning เรื่อง type

- [ ] **Step 2: ตรวจ dark mode**

ใช้ `preview_eval` สลับธีม: `localStorage.setItem('finflow-theme','dark'); location.reload()` แล้ว `preview_screenshot` หน้า Dashboard
ยืนยัน: ตัวอักษร active เมนูเป็นเทอร์ควอยซ์สว่าง (`--brand-2`) อ่านออก, การ์ด/เงา/ชิปไอคอน คอนทราสต์โอเค, ไม่มีข้อความจมพื้น

- [ ] **Step 3: ตรวจ responsive (มือถือ)**

ใช้ `preview_resize` กว้าง ~390px แล้ว `preview_screenshot` — ยืนยัน sidebar ยุบเป็น topbar + ปุ่ม ☰ เปิดเมนูได้, การ์ดเรียงคอลัมน์เดียวถูกต้อง, ไอคอนเมนูแสดงครบ

- [ ] **Step 4: (ถ้าพบ regression) แก้แล้ว commit; ถ้าไม่พบ ข้ามไป Step 5**

แก้เฉพาะจุดที่พัง (token/คลาสที่เกี่ยวข้อง) แล้ว:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(ui): dark-mode / responsive regressions from refresh

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: ปิดงาน**

ยืนยันเช็คลิสต์เกณฑ์ความสำเร็จจาก spec ครบทั้ง 6 ข้อ แล้วแจ้งผู้ใช้เพื่อตัดสินใจ merge เข้าหลัก (ดู skill `finishing-a-development-branch`)

---

## Self-Review

**1. Spec coverage:**
- เงา layered + spacing/type/radius/motion tokens → Task 2 ✓
- ปรับ dark mode → Task 2 (เงา) + Task 7 (ตรวจ) ✓
- lucide + เลิก emoji เมนู → Task 1 + Task 5 ✓
- client-side category icon map + fallback → Task 1 (`CategoryIcon`) + Task 6 (ใช้งาน) ✓
- `Stat` trend chip + accent → Task 4 + Task 6 ✓
- `.card` hover, `.nav-link` soft active, `.btn`/`.badge`/`.seg`/ตาราง → Task 3 ✓
- micro-interaction (transition) → Task 2 (tokens) + Task 3 (ใช้งาน) ✓
- responsive ≤900px คงเดิม → Task 7 ✓
- เกณฑ์ความสำเร็จ #1-6 → ครอบโดย Task 2-7 + Step ปิดงาน ✓

**2. Placeholder scan:** ไม่มี TBD/TODO; ทุก step ที่แก้โค้ดมีโค้ดจริงครบ; ไม่มี "handle edge cases" ลอยๆ

**3. Type consistency:** `Trend` นิยามใน Task 4 (ui.tsx) ถูก import ใช้ใน Task 6; `NAV_ICONS`/`CATEGORY_ICONS`/`CategoryIcon` นิยามใน Task 1 ใช้ใน Task 5/6; `LucideIcon` มาจาก lucide-react; `monthTrend` คืน `Trend | undefined` ตรงกับ prop `trend?` ของ `Stat`

**4. ความเสี่ยงที่จับตา:** การแปลง render callback ของ Dashboard จาก `(o) => ( … )` เป็น `(o) => { const …; return ( … ); }` ต้องปิดวงเล็บ/`;` ให้ถูก (เน้นใน Task 6 Step 4)
