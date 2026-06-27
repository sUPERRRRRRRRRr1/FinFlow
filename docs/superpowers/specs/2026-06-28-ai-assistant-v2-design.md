# ผู้ช่วย AI ถาม–ตอบ v2 — Design Spec

วันที่: 2026-06-28
สถานะ: อนุมัติดีไซน์แล้ว รอเขียน implementation plan

## ปัญหา (Problem)

ระบบผู้ช่วย AI ถาม–ตอบ ปัจจุบัน (`server/src/services/chat.ts` → `buildChatContext`) ตอบได้แค่
ไม่กี่ pattern และมักตอบไม่ตรงคำถาม สาเหตุ:

1. **เดาเจตนาด้วย regex/keyword ตายตัว** — `detectCategory`, `detectMonth` แล้วคำนวณ
   "ข้อเท็จจริง" เฉพาะ pattern ที่ `if` ครอบไว้ (ออม / หมวดไหนเยอะ / คะแนนสุขภาพ / ภาษี)
2. **คำถามนอก pattern → เทสรุปรวมทั้งหมดให้ LLM** แล้ว LLM พูดอ้อม ตอบไม่ตรง
   (เช่น "มีอะไรผิดปกติไหม" ตอบมั่วเพราะไม่มี fact เรื่อง anomaly เลย)
3. **ไม่มีความจำบทสนทนา** — ถามต่อเนื่อง "แล้วเดือนก่อนล่ะ" ไม่ได้
4. **คำถามปลายเปิด** ("ทำยังไงให้เก็บเงินมากขึ้น") ไม่มีข้อมูลรองรับ เลยตอบกว้างๆ

## เป้าหมาย (Goals)

- ตอบคำถามได้กว้างขึ้นมาก โดยไม่ต้องไล่เพิ่ม regex ทีละ pattern
- ตอบ "ตรงคำถาม" ไม่พูดอ้อม และไม่มั่วเมื่อข้อมูลไม่พอ
- รองรับการถามต่อเนื่อง (จำบทสนทนา)
- **รักษาจุดขายเดิม: ตัวเลขทั้งหมดคำนวณด้วยโค้ด 100% ไม่ได้มาจากการเดาของ AI**

## Non-Goals

- ไม่ทำ tool-calling / function-calling agent (ช้ากว่า ซับซ้อนกว่า ยังไม่จำเป็น)
- ไม่เปลี่ยน LLM provider หรือลำดับ fallback (ยังคง Gemini → Groq → rule-based)
- ไม่แตะระบบ OCR / ingest / จัดหมวด

## หลักการออกแบบ (Core Principle)

เปลี่ยนจาก *"เดาเจตนาด้วย regex → คำนวณเฉพาะ pattern"*
เป็น *"คำนวณ fact-sheet ครบทุกด้านเสมอ → LLM เลือกตอบเฉพาะที่ถาม"*

ทุกคำถามจะมี fact-sheet เต็มรองรับเสมอ → ปัญหา "ตอบงงเพราะไม่มี fact" หายไป
ตัวเลขยังคำนวณด้วยโค้ดทั้งหมด LLM ทำหน้าที่แค่เลือก + เรียบเรียง

## สถาปัตยกรรม (Architecture)

### Data flow (ใหม่)

```
POST /api/chat { question, history }
  └─ buildSnapshot(txns)            → fact-sheet ครบทุกด้าน (เสมอ)         [snapshot.ts]
  └─ buildChatContext(question, txns) → focus line + sample รายการที่ตรงคำถาม  [chat.ts]
  └─ answerQuestion(question, snapshot, focus, sample, history) → LLM       [gemini.ts]
```

### 1. Fact-sheet builder — ไฟล์ใหม่ `server/src/services/snapshot.ts`

`buildSnapshot(txns: Transaction[]): string` คืน text block กระชับ ประกอบจากฟังก์ชัน
`@finflow/shared` ที่มีอยู่แล้ว (ไม่เขียน logic คำนวณใหม่):

| ส่วนใน fact-sheet | ที่มา (reuse) | รองรับคำถามแบบ |
|---|---|---|
| ภาพรวมทั้งช่วง: รายรับ/จ่าย/ออมสุทธิ/อัตราออม/ช่วงข้อมูล/จำนวนรายการ | `isRealIncome`, `isConsumption`, `monthKey`, `round` | "สรุปภาพรวม", "ออมได้เท่าไหร่" |
| ตารางรายเดือน (ย้อนหลังสูงสุด 12 เดือน): เดือน \| รายรับ \| รายจ่าย \| ออมสุทธิ \| อัตราออม | `monthKey` + reduce | เทียบเดือน, "เดือนนี้/เดือนก่อน" |
| เจาะลึกเดือนล่าสุด: top หมวด + % เทียบเดือนก่อน | `expenseByCategory`, `CATEGORY_META` | "เดือนนี้ค่าอาหารเท่าไหร่" |
| หมวดทั้งหมด: เฉลี่ย/เดือน + ล่าสุด + ทิศทางเทรนด์ | `categoryTrends` | "หมวดไหนเยอะ", "ค่า X ขึ้นไหม" |
| ความผิดปกติ + ข้อสังเกต | `generateInsights` | **"มีอะไรผิดปกติไหม"** |
| บิล/รายจ่ายประจำ | `detectRecurring` | "บิลรายเดือนเท่าไหร่" |
| คะแนนสุขภาพ + จุดอ่อนรายเสา | `computeHealthScore` (+ `getScoreProfile`) | **"ทำยังไงให้เก็บเงินมากขึ้น"** |
| ภาษีสรุป + คำแนะนำประหยัด + กำหนดยื่น | `taxOverview` (+ `getTaxProfile`, `getRules`) | "ต้องเสียภาษีเท่าไหร่" |

หมายเหตุการคุมขนาด prompt:
- ตารางรายเดือนจำกัด 12 เดือนล่าสุด
- ใช้รูปแบบตารางข้อความกระชับ (คั่นด้วย `|`) ไม่ใส่ตัวเลขทศนิยม
- ส่วนภาษีใส่เฉพาะบรรทัดสรุป + คำแนะนำอันดับ 1–2

### 2. Question focus layer — แก้ `server/src/services/chat.ts`

`detectCategory` / `detectMonth` เดิม **คงไว้** แต่ลดบทบาทเหลือแค่:
- เลือก "ตัวอย่างรายการ" (sample) ให้ตรงคำถาม — เช่น ถามค่าอาหารเดือนนี้ → ส่งรายการ
  หมวด food ของเดือนล่าสุด
- เติมข้อความ `🎯 โฟกัส: ...` 1 บรรทัดเพื่อช่วยชี้เป้าให้ LLM

`buildChatContext` คืน `{ focus: string; sample: SafeTransaction[] }`
(ย้ายหน้าที่ "คำนวณ fact" ทั้งหมดออกไปที่ `buildSnapshot` แล้ว)
ต่อให้ detect พลาด ก็ยังมี fact-sheet เต็มรองรับ ระบบจึงไม่ตอบมั่วเหมือนเดิม

### 3. ความจำบทสนทนา (Conversation memory)

- `client/src/pages/Assistant.tsx`: ส่ง `history` = ข้อความ 6 รายการล่าสุด
  (รูปแบบ `{ role: 'user' | 'bot'; text: string }[]`) ไปกับ request
- `server/src/routes/chat.ts`: zod schema เพิ่ม
  `history: z.array(z.object({ role: z.enum(['user','bot']), text: z.string() })).max(12).optional()`
- `answerQuestion` แทรกประวัติบทสนทนาก่อนคำถามล่าสุดใน prompt → ถามต่อ
  "แล้วเดือนก่อนล่ะ" ได้

### 4. Prompt + กันมั่ว — แก้ `answerQuestion` ใน `server/src/services/gemini.ts`

เปลี่ยน signature เป็น
`answerQuestion(question, snapshot, focus, sample, history)` และเขียน prompt ใหม่:

- Persona: ผู้ช่วยการเงินส่วนตัว พูดไทย กระชับ เป็นกันเอง
- กฎ:
  - ตอบ "ตรงคำถาม" ก่อนเสมอ แล้วค่อยเสริมสั้นๆ ถ้าจำเป็น
  - ใช้เฉพาะตัวเลขใน fact-sheet ห้ามแต่งตัวเลขเอง
  - **ถ้าข้อมูลใน fact-sheet ไม่พอจะตอบ ให้บอกตรงๆ ว่าไม่มีข้อมูล ห้ามเดา**
  - สำหรับคำถามขอคำแนะนำ ให้อ้างอิงจุดอ่อนรายเสา / ความผิดปกติ ที่อยู่ใน fact-sheet
- โครงสร้าง prompt: fact-sheet → focus → ตัวอย่างรายการ → ประวัติบทสนทนา → คำถามล่าสุด

rule-based fallback (เมื่อไม่มี LLM key): ปรับให้เลือกหยิบ section ที่เกี่ยวข้องกับคำถาม
แทนการเทข้อมูลดิบทั้งก้อน

## โครงสร้างไฟล์ (Files)

- **ใหม่:** `server/src/services/snapshot.ts` — `buildSnapshot(txns)`
- **ใหม่:** `server/src/services/snapshot.test.ts` — unit test
- **แก้:** `server/src/services/chat.ts` — เหลือ focus layer (`buildChatContext` คืน `{ focus, sample }`)
- **แก้:** `server/src/services/gemini.ts` — `answerQuestion` รับ snapshot + focus + history, prompt ใหม่
- **แก้:** `server/src/routes/chat.ts` — schema เพิ่ม `history`, เรียก `buildSnapshot` + `buildChatContext`
- **แก้:** `client/src/pages/Assistant.tsx` — ส่ง `history` ไปกับ request

## Error handling

- ไม่มีรายการเลย / มีเดือนเดียว: `buildSnapshot` ต้องไม่ throw — แสดงเฉพาะ section ที่มีข้อมูล
  และส่วนเทียบเดือนต้องข้ามได้อย่างปลอดภัย
- LLM ทุก provider ล่ม → rule-based fallback (มีอยู่แล้ว ปรับให้เลือก section)
- `history` ที่ผิดรูปแบบ → zod ปัดทิ้ง (optional) ไม่ทำให้ request พัง

## Testing

`buildSnapshot` เป็น pure function ทดสอบด้วย vitest (รูปแบบเดียวกับเทสใน server เดิม):
- ตารางรายเดือนคำนวณถูก (รายรับ/จ่าย/ออมต่อเดือน)
- ส่วนความผิดปกติปรากฏเมื่อมี insight
- เคส 0 รายการ และเคส 1 เดือน ไม่ throw และไม่มีบรรทัดเทียบเดือนค้าง
- ไม่รั่วข้อมูลดิบที่ไม่ได้ผ่าน sanitize ออกไปนอกเหนือจากตัวเลขสรุป

## สิ่งที่ไม่เปลี่ยน (Preserved)

- ตัวเลขทั้งหมดคำนวณด้วยโค้ด LLM แค่เรียบเรียง (จุดขายบนหน้าจอคงเดิม)
- ลำดับ provider Gemini → Groq → rule-based
- การ sanitize รายการ (`toSafeTransaction`) ก่อนส่งออก
