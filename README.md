# FinFlow — ระบบรวมศูนย์และวิเคราะห์เส้นทางการเงินส่วนบุคคลด้วย AI

> สำหรับการแข่งขันนวัตกรรมปัญญาประดิษฐ์และคณิตศาสตร์วิชาการ ครั้งที่ 11 ระดับชาติ
> รวมสลิป/statement จากหลายธนาคาร–กระเป๋าเงินมาที่เดียว วิเคราะห์ด้วยสถิติที่ออกแบบเอง และผู้ช่วย AI

FinFlow แก้ปัญหาที่คนไทยเจอจริง: ใช้หลายแอปการเงินพร้อมกัน (KBank, Make by KBank, TrueMoney …)
ทำให้ภาพการเงินกระจัดกระจาย FinFlow ดึงข้อมูลมารวม จัดหมวดอัตโนมัติ แล้ววิเคราะห์เป็น
**คะแนนสุขภาพการเงิน, แผนภาพการไหลของเงิน (Sankey), ไทม์ไลน์+พยากรณ์, ตรวจจับรายจ่ายผิดปกติ,
แนวโน้มรายหมวด** และตอบคำถามภาษาไทยได้

---

## ✨ รันได้ทันที (โหมดเดโม ไม่ต้องตั้งค่าอะไรเลย)

```bash
npm install        # ติดตั้ง dependency ทั้งหมด (workspaces)
npm run dev        # รัน server (4000) + client (5173) พร้อมกัน
```

เปิด **http://localhost:5173** ระบบจะ seed ข้อมูลตัวอย่างเสมือนจริง 6 เดือน (หลายกระเป๋า) ให้อัตโนมัติ
ทุกฟีเจอร์ทำงานครบโดยไม่ต้องใช้ Gmail หรือ Gemini key

> ต้องการ AI/Gmail จริง? คัดลอก `.env.example` → `.env` แล้วเติม key (ดูหัวข้อ [การเชื่อมต่อจริง](#-การเชื่อมต่อจริง-optional))

---

## 🎯 ฟีเจอร์ (9 หลัก + 5 ส่วนเสริม)

| # | ฟีเจอร์ | เราทำเอง | AI ช่วย |
|---|---------|----------|---------|
| 1 | บันทึกรายรับ–รายจ่ายอัตโนมัติ (หน้า *รายการ* + *เชื่อมต่อข้อมูล*) | parser หลายแหล่ง, กันซ้ำ, กรองข้อมูลอ่อนไหว, สมุดบัญชีแก้หมวด/เพิ่มเองได้ | OCR/จัดหมวด |
| 2 | **คะแนนสุขภาพการเงิน 0–100** (เรือธง) | สูตร 5 องค์ประกอบ, SD, entropy, regression | เขียนคำแนะนำ |
| 3 | เส้นทางเงิน Sankey + ตรวจ balance | node/link graph, flow conservation | — |
| 4 | ไทม์ไลน์ราย วัน/เดือน/ปี + พยากรณ์ | aggregation, moving average, regression | — |
| 5 | ตรวจจับรายจ่ายผิดปกติ | z-score + IQR (far-out) | — |
| 6 | ผู้ช่วย AI ถาม–ตอบ (RAG) | ดึงข้อมูล + คำนวณตัวเลขเอง | เรียบเรียงคำตอบ |
| 7 | แนวโน้มรายหมวด | period-over-period %, z-score, slope, heatmap | — |
| 8 | กันรายการซ้ำข้ามแหล่ง | fingerprint + Levenshtein fuzzy match | — |
| 9 | รวมศูนย์ข้ามกระเป๋า | จับคู่การโอนระหว่างกระเป๋า, ยอดรวม | — |

**ส่วนเสริม:** สมุดรายการ (ledger) แสดงเลขบัญชี · **กฎร้านค้า** (ระบุว่า "บัญชี/ชื่อนี้ = ร้านอะไร หมวดไหน"
แก้จุดอ่อนที่ AI จัดหมวดบัญชีชื่อคนไม่ได้ และอัปเดต Sankey/หมวด/คะแนนทันที แบบ revert ได้) ·
งบประมาณ+แจ้งเตือน · จำลองการออม (What-if) · ตรวจจับรายจ่ายประจำ (subscription) · ส่งออก CSV · ข้อสังเกตอัตโนมัติ

---

## 🧮 แก่นคณิต/สถิติ (ออกแบบเองทั้งหมด)

โค้ดทั้งหมดอยู่ใน [`shared/src/stats/`](shared/src/stats) เป็น **pure function** มี unit test กำกับทุกตัว
(`npm test` — 34 เทสต์) เปิดดูสูตรได้ในแอปที่แผง “วิธีคิดคะแนน”

### คะแนนสุขภาพการเงิน = Σ (น้ำหนักᵢ × คะแนนย่อยᵢ)

| องค์ประกอบ | น้ำหนัก | สูตร → 0–100 |
|-----------|--------|-------------|
| อัตราการออม | 30% | `s = (รายรับ−รายจ่าย)/รายรับ` → `100·min(s/0.30, 1)` |
| ความสม่ำเสมอรายจ่าย | 20% | `CV = SD/mean` (รายจ่ายรายวัน) → `100·e^(−0.7·CV)` |
| การกระจายหมวด | 20% | `Hₙ = H/ln(k)`, `H = −Σ pᵢ·ln pᵢ` (Shannon) → `100·Hₙ` |
| คุมรายจ่ายผิดปกติ | 15% | `r = วันผิดปกติ/วันมีจ่าย` (z>2 หรือ Q3+3·IQR) → `100·(1−r)` |
| แนวโน้มการออม | 15% | `slope` เงินออมรายเดือน (least squares) → `100·σ(1.5·slope/(|mean|+1))` |

### เทคนิคสถิติอื่น
- **Linear regression (least squares):** slope/intercept/R² + พยากรณ์ — [`regression.ts`](shared/src/stats/regression.ts)
- **Outlier detection:** z-score และ Tukey IQR fence — [`outliers.ts`](shared/src/stats/outliers.ts)
- **Shannon entropy** (normalized) — [`entropy.ts`](shared/src/stats/entropy.ts)
- **Flow conservation** (Sankey balance check) — [`sankey.ts`](shared/src/stats/sankey.ts)
- **Levenshtein distance + fuzzy dedup** — [`dedup.ts`](shared/src/stats/dedup.ts)
- **Inter-wallet transfer matching** — [`transfers.ts`](shared/src/stats/transfers.ts)
- **Period-over-period % + baseline z-score + slope** — [`trends.ts`](shared/src/stats/trends.ts)
- **Periodicity (subscription) detection** — [`recurring.ts`](shared/src/stats/recurring.ts)

---

## 🏗️ สถาปัตยกรรม

```
Gmail / PDF / สลิป ─► parser (kbank·make·truemoney) ─┐
                                                      ├─► รูปแบบกลาง (Transaction)
                       OCR / Gemini (สลิป) ───────────┘        │
                                                               ▼
                          จัดหมวด → กันซ้ำ → จับคู่การโอน  (pipeline กลาง)
                                                               │
                                                               ▼
                              SQLite ─► stats engine (shared) ─► REST API ─► React PWA
```

- **ปลั๊กแหล่งใหม่ = เขียน parser ไฟล์เดียว** แล้วลงทะเบียนใน [`registry.ts`](server/src/parsers/registry.ts)
- stats engine อยู่ใน `shared/` ใช้ร่วมกันทั้งฝั่ง server (วิเคราะห์) และ client (What-if simulator)

### Tech stack
| ส่วน | เทคโนโลยี |
|------|-----------|
| Frontend | React + Vite (PWA, ติดตั้งบนมือถือได้) · D3-sankey · Recharts · TypeScript |
| Backend | Node.js + Express · better-sqlite3 · TypeScript |
| Email | Gmail API (OAuth, scope `gmail.readonly`) |
| PDF | ปลดล็อค+สกัดข้อความฝั่ง client ด้วย pdf.js |
| OCR/LLM | Google Gemini (free tier) + Tesseract.js (fallback) |
| สถิติ | เขียนเอง 100% (ไม่พึ่ง library คำนวณ) |

---

## 📁 โครงสร้างโปรเจค

```
FinFlow/
├── shared/   # ★ stats engine + types (pure TS, มี test)
├── server/   # Express API, parsers, db, demo seed, services (gemini/gmail/ocr)
└── client/   # React PWA (หน้า Dashboard, รายการ, Flow, Timeline, Categories, Anomalies, Budgets, Assistant, Connect)
```

---

## 🔐 การเชื่อมต่อจริง (optional)

แก้ไฟล์ `.env` (คัดลอกจาก `.env.example`):

- **Gemini** — ใส่ `GEMINI_API_KEY` → AI จัดหมวด/คำแนะนำ/แชท/OCR ทำงานจริง (ไม่ใส่ = ใช้ fallback)
- **Gmail** — ใส่ `GMAIL_CLIENT_ID/SECRET` (OAuth Web app จาก Google Cloud Console)
  แล้วกด “เชื่อมต่อ Gmail” ในหน้า *เชื่อมต่อข้อมูล* → ดึงเมลธนาคารย้อนหลัง 6 เดือน (อ่านอย่างเดียว)

---

## 🛡️ ความเป็นส่วนตัว (Responsible AI / PDPA)

- เชื่อม Gmail **อ่านอย่างเดียว** + allow-list เฉพาะผู้ส่งธนาคาร/กระเป๋าเงิน
- **ปลดล็อค PDF ในเครื่องผู้ใช้** รหัสผ่านไม่ออกนอกเบราว์เซอร์ ([`client/src/lib/pdf.ts`](client/src/lib/pdf.ts))
- **กรองเลขบัญชี/เลขบัตร** ออกก่อนส่งให้ AI ([`server/src/sanitize.ts`](server/src/sanitize.ts))
- เก็บเฉพาะข้อมูลธุรกรรมที่จำเป็น ไม่เก็บอีเมล/ไฟล์ถาวร

---

## 🧪 การทดสอบ & คำสั่ง

```bash
npm test        # รัน unit test ของ stats engine + parser (vitest)
npm run dev     # dev: server + client
npm run build   # build client เป็น production (สร้าง PWA service worker)
npm start       # รัน server โหมด production (เสิร์ฟ client ที่ build แล้วด้วย)
```

---

## 🎤 สคริปต์เดโม (สำหรับ Pitching)

1. **ภาพรวม** — ชี้คะแนนสุขภาพการเงิน กดขยายแต่ละองค์ประกอบเพื่อโชว์สูตร → ตอบเกณฑ์ Technical Depth
2. **เส้นทางเงิน** — Sankey + ป้าย “✅ สมดุล คลาดเคลื่อน 0 ฿” (พิสูจน์ flow conservation)
3. **รายจ่ายผิดปกติ** — โชว์การซื้อ iPhone z=10.9 ที่ระบบจับได้
4. **What-if** — เลื่อนลดค่าอาหาร 20% ดูคะแนนขยับสด (คำนวณในเบราว์เซอร์)
5. **ผู้ช่วย AI** — ถาม “เดือนนี้ใช้ค่าอาหารไปเท่าไหร่” แล้วกาง “ตัวเลขที่ใช้ตอบ” (โค้ดคำนวณ ไม่ใช่ AI เดา)
6. **เชื่อมต่อข้อมูล** — โชว์ flow ปลดล็อค PDF ในเครื่อง + การกันข้อมูลอ่อนไหว (Responsible AI)

---

## 🗺️ Roadmap
PWA (ฟรี) → Capacitor แจก `.apk` (ฟรี) → ขึ้น store ($25 ครั้งเดียว) · ผ่าน Google verification เพื่อขยายเชิงพาณิชย์
