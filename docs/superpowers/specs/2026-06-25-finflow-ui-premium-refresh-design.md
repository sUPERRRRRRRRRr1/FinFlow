# FinFlow — ยกเครื่อง UX/UI ให้พรีเมียมขึ้น (Design Spec)

วันที่: 2026-06-25
ผู้ออกแบบ: ผู้ใช้ + Claude
สถานะ: รออนุมัติ spec

## เป้าหมาย

ทำให้หน้าตา FinFlow **ดูพรีเมียมขึ้น** และ **ใช้ง่ายขึ้น** ทั้งแอป โดยแก้ที่
**ชั้น design system เป็นหลัก** (`global.css` + `ui.tsx` + `Layout.tsx`) เพื่อให้ทุกหน้า
ได้ผลพร้อมกัน ไม่ต้องรื้อทีละหน้า

ขอบเขตคือ **งาน visual ล้วน** — ไม่แตะ logic, การคำนวณ, API, หรือ data flow
ฟังก์ชันทุกอย่างต้องทำงานเหมือนเดิม

## หลักการ / ข้อจำกัด

- **ไม่แตะ logic/ข้อมูล** — แก้เฉพาะ markup/style และ component primitive
- **เปลี่ยนน้อย ได้ผลมาก** — ทำที่ token + primitive ที่หน้าอื่น reuse อยู่แล้ว
- **Additive API** — ขยาย prop ของ component เดิมแบบ optional ไม่ทำของเดิมพัง
- **คงโครงสถาปัตยกรรมเดิม** — plain CSS + CSS variables + inline style (ไม่เอา Tailwind/CSS-in-JS)
- **รองรับ dark mode** ทุกการเปลี่ยนแปลง (token ต้องมีทั้งสองโหมด)
- **รองรับ responsive** เดิม (breakpoint 900px) ต้องไม่พัง

## แนวทางที่เลือก

ยกระดับ **Design Tokens + Primitives ในชั้นเดียว** (เทียบกับทางเลือกที่ตกไป:
ล้าง inline style ทั้งแอป = งานเยอะเสี่ยงพัง / ยก Tailwind เข้ามา = รื้อใหญ่ไม่คุ้มเวลา)

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | บทบาทปัจจุบัน | จะแก้อะไร |
|------|----------------|-----------|
| `client/src/styles/global.css` | token + คลาส primitive ทั้งหมด | token ใหม่ + ขัด primitive ทุกตัว |
| `client/src/components/ui.tsx` | `Stat`, `Card`-helpers, `Async`, `PageHead` | `Stat` รองรับ trend + accent; เพิ่ม `<Icon>` |
| `client/src/components/Layout.tsx` | sidebar nav + topbar (emoji 10 ตัว) | เปลี่ยน emoji เมนู → lucide; ขัด nav active |
| `client/package.json` | deps | เพิ่ม `lucide-react` |

หน้าอื่น (`Dashboard.tsx`, `Transactions.tsx`, …) **ไม่ต้องแก้** ก็ได้รูปลักษณ์ใหม่
ผ่านคลาส/`Stat` ที่ใช้ร่วมกัน — ยกเว้นจุดที่อยาก opt-in trend chip ค่อยแก้เพิ่มทีหลัง

## องค์ประกอบที่จะเปลี่ยน

### 1. Design tokens (`global.css` `:root` + `[data-theme='dark']`)

- **เงาแบบ layered** — แทน `--shadow` เดิม ด้วยชุด elevation นุ่มขึ้น:
  - `--shadow-sm` (ขอบการ์ดนิ่ง), `--shadow` (การ์ดปกติ), `--shadow-lg` (hover/ลอย)
  - ใช้เงา 2 ชั้น (ใกล้คม + ไกลฟุ้ง) ให้ดูมีมิติ
- **Spacing scale** — `--space-1..6` (4/8/12/16/24/32px) ไว้แทน magic number
- **Type scale** — `--fs-display / -h1 / -h2 / -body / -sm / -xs` + คุม `letter-spacing` หัวข้อ
- **Radius** — คง 16/10 และเพิ่ม `--radius-lg` (20px) สำหรับการ์ดเด่น, `--radius-pill`
- **ปรับ dark mode** — ลด contrast พื้น/ขอบให้นวลขึ้น, เงาเข้มลงเล็กน้อย

### 2. ระบบไอคอน — เลิก emoji

- เพิ่ม dependency `lucide-react`
- เพิ่ม helper `<Icon name=... size=... />` ใน `ui.tsx` (หรือ import ตรง) ครอบ lucide
- **เมนู 10 ตัวใน `Layout.tsx`**: map emoji → lucide
  (เช่น 📊→`LayoutDashboard`, 📒→`Receipt`, 🌊→`Split`/`Waves`, 📈→`LineChart`,
  🔮→`Sparkles`, 🚨→`AlertTriangle`, 🎯→`Target`, 🧾→`FileText`, 🤖→`Bot`, 🔗→`Link`)
- **ไอคอนหมวดหมู่** (🍔🚗 จาก backend `byCategory[].icon`): ทำ **client-side map**
  `categoryKey → lucide icon + สีชิป` แสดงเป็นชิปไอคอนสี (ไม่แตะ server);
  ถ้าไม่มีใน map ให้ fallback เป็นไอคอนกลาง — ของเดิมยังส่ง emoji มาได้ ไม่พัง
- scope รอบนี้โฟกัส **เมนู + หมวดหมู่บน Dashboard**; emoji ใน badge/insight อื่น
  ที่มาจาก data ปล่อยไว้ก่อน (เป็น follow-up ถ้าต้องการ)

### 3. Primitive ใน `global.css` + `ui.tsx`

- **`Stat` tile** (component ใน `ui.tsx`):
  - prop ใหม่ (optional): `accent?: string` (แถบสีซ้าย), `trend?: { dir: 'up'|'down'|'flat'; text: string; tone: 'good'|'bad'|'muted' }`
  - เรนเดอร์: แถบ accent ซ้าย + label + value + **trend chip** (▲▼ + %)
  - ของเดิมที่ส่งแค่ `label/value/sub` ต้องเรนเดอร์ได้เหมือนเดิม
- **`.card`** — ขอบ/รัศมีเนียนขึ้น, เพิ่ม `transition` + hover-lift เบาๆ (`translateY(-2px)` + `--shadow-lg`); หัวการ์ด (`h3`+`.sub`) จัดระยะใหม่
- **`.nav-link.active`** — เปลี่ยนจากพื้นทึบ `--brand` → **soft**: พื้น `--brand-soft` + ตัวอักษร `--brand` + แถบ indicator ซ้าย 3px; hover นุ่มขึ้น
- **`.btn`** — เพิ่ม `:focus-visible` ring, `:active` press (`scale .98`), transition; ปรับ `.primary` ให้ดูแน่นขึ้น
- **`.badge` / `.seg`** — ขัดระยะ/สี/น้ำหนักให้คม
- **`table.tbl`** — หัวตาราง + zebra/hover row นุ่มๆ
- **`.skeleton`** — shimmer ลื่นขึ้น (คงของเดิมที่มีอยู่ ปรับ timing)

### 4. Micro-interaction

- transition มาตรฐาน `--ease` + `--dur` บน hover/active ของ card/btn/nav
- คุมให้เบา (ไม่เด้งแรง) เพื่อความรู้สึกพรีเมียม ไม่รบกวน

## สิ่งที่ "ไม่ทำ" (กัน scope creep)

- ไม่ล้าง inline style ทั้งแอป (ทำเฉพาะที่จำเป็นต่อ primitive)
- ไม่เปลี่ยน layout/IA ของแต่ละหน้า, ไม่ย้ายเมนู
- ไม่แตะ backend, ไม่เปลี่ยนรูปแบบข้อมูล
- ไม่เพิ่ม animation library
- ไม่ทำ accessibility audit เต็มรูปแบบ (แต่ใส่ focus ring + aria-label ไอคอนเมนูเป็นพื้นฐาน)

## เกณฑ์ความสำเร็จ

1. ทุกหน้าได้ลุคใหม่โดยฟังก์ชันทำงานเหมือนเดิม (เทียบก่อน/หลังด้วย preview)
2. เมนูทั้ง 10 ใช้ไอคอนเส้น lucide ครบ ไม่มี emoji หลงเหลือในเมนู
3. Dashboard stat tile แสดง trend chip + แถบ accent ได้
4. หมวดรายจ่ายบน Dashboard ใช้ไอคอนเส้น + ชิปสี
5. dark mode + responsive (≤900px) ยังถูกต้อง
6. `npm run build` ของ client ผ่าน (ไม่มี type error)

## ความเสี่ยง / ข้อควรระวัง

- **lucide bundle size** — import แบบ named ให้ tree-shake; อย่า import ทั้งก้อน
- **หมวดหมู่ที่ไม่มีใน map** — ต้องมี fallback ชัดเจน
- **dark mode regression** — ตรวจทุก token ใหม่ทั้งสองโหมด
- **inline style ที่ hardcode สีเดิม** ในหน้าอื่นอาจไม่กลืนกับ token ใหม่ — รอบนี้ยอมรับได้ ค่อยตามเก็บ
