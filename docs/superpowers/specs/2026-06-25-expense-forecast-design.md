# Expense Forecast by Category — Design Spec
**Date:** 2026-06-25
**Feature:** คาดการณ์ค่าใช้จ่ายรายหมวดล่วงหน้า 3 เดือน (ต่อยอดในหน้า Timeline)

---

## 1. เป้าหมาย

เพิ่มแท็บ **"คาดการณ์"** ในหน้า Timeline ที่พยากรณ์ยอดค่าใช้จ่ายแต่ละหมวดสำหรับ 3 เดือนถัดไป โดย:
- แยกบิลประจำ (recurring) กับส่วนผันแปร (variable) ออกจากกัน
- คำนวณช่วงความเชื่อมั่น (prediction interval) อย่างเป็นทางการ
- วัดความแม่นโมเดลด้วย MAPE + backtest เทียบ baseline
- บอกโอกาสเกินงบรายหมวด (ถ้ามีงบตั้งไว้)
- ทำงานได้กับข้อมูล ≥ 3 เดือน (รวมเดโม 6 เดือน); ส่วน seasonal เปิดอัตโนมัติเมื่อ ≥ 12 เดือน

---

## 2. สูตรคณิตศาสตร์ (Math Model)

### 2.1 Decomposition

ยอดคาดการณ์หมวด `c` ที่ขั้น `k` เดือนข้างหน้า:

```
F_c[+k] = R_c + S_c[m] · V̂_c[+k]
```

- **R_c** — บิลประจำ (recurring component)
- **S_c[m]** — seasonal index เดือน m (= 1.0 ถ้าข้อมูล < 12 เดือน)
- **V̂_c[+k]** — ส่วนผันแปร คาดการณ์ด้วย damped trend

### 2.2 บิลประจำ R_c

ดึงจาก `detectRecurring()` เดิม กรองเฉพาะ:
- หมวด = c
- `lastDate` ไม่เก่าเกิน `1.5 × avgIntervalDays` วัน (ยังถือว่า active)

แปลงเป็นยอด/เดือน:
```
R_c = Σ (averageAmount_i × 30.44 / avgIntervalDays_i)
```

### 2.3 ส่วนผันแปร V̂_c (Damped Trend)

**ข้อมูลฝึก:** `V_c[m] = max(0, ยอดจริงหมวด c เดือน m − บิลประจำจริงเดือนนั้น)`

**fit least-squares** (ใช้ `linearRegression()` เดิม):
```
slope b, intercept a, R²
```

**ระดับล่าสุด** = ค่าเฉลี่ย EWMA แบบ trailing ของ 3 เดือนล่าสุด (น้ำหนัก 1/2, 1/3, 1/6 จากล่าสุด)

**Damped trend** (damping factor φ = 0.8):
```
V̂_c[+k] = level_c + (φ¹ + φ² + … + φᵏ) × b
         = level_c + b × φ(1 − φᵏ)/(1 − φ)
```
clamp ≥ 0; ถ้า n < 3 หรือ |b| < 0.01×level (แทบคงที่) → ใช้ `level_c` โดยตรง (naive fallback)

### 2.4 Seasonal Index S_c (เปิดเมื่อ ≥ 12 เดือน)

Ratio-to-moving-average:
```
S_c[m] = mean(V_c ทุกปีในเดือน m) / grand_mean(V_c)
```
normalize ให้ผลรวม 12 ดัชนี = 12.0

ถ้าข้อมูล < 12 เดือน → S_c[m] = 1.0 เสมอ (ไม่ประมาณฤดูกาลจากข้อมูลน้อยเกินไป)

### 2.5 Prediction Interval (PI)

residual `ε_c[m] = V_c[m] − V̂_c[m]` (in-sample)
```
σ_c = std(ε_c)
x₀ = n + k  (ตำแหน่ง horizon)

PI_c = F_c[+k] ± z · σ_c · √(1 + 1/n + (x₀ − x̄)²/Sxx)
```
default z = 1.28 (~80% CI); สามารถเปลี่ยนเป็น 1.645 (90%) ได้

**ยอดรวมทุกหมวด:**
```
σ_total = √(Σ σ_c²)   [สมมติหมวดอิสระต่อกัน]
```

### 2.6 โอกาสเกินงบ

```
P(เกินงบ) = 1 − Φ((L_c − F_c) / σ_c)
```
Φ = CDF ของการแจกแจงปกติมาตรฐาน (ใช้ rational approximation เขียนเอง)

### 2.7 Backtest (rolling-origin)

กัน fold ทีละ 1 เดือน ย้อนหลัง min(n−3, 3) fold:
- ฝึกบนข้อมูลก่อน fold → พยากรณ์ 1 เดือน → เทียบของจริง

```
MAPE = mean(|actual − forecast| / actual)  [กรองเดือนที่ actual = 0 ออก]
baseline MAPE = เดาจาก mean 3 เดือนก่อน fold
skill score = 1 − MAPE_model / MAPE_baseline
```
skill > 0 = โมเดลแม่นกว่า naive

---

## 3. สถาปัตยกรรมโค้ด

### ไฟล์ใหม่

| ไฟล์ | หน้าที่ |
|------|---------|
| `shared/src/stats/forecast.ts` | engine หลัก — pure functions ทุกสูตร |
| `shared/src/stats/forecast.test.ts` | vitest unit tests |

### ไฟล์แก้ไข

| ไฟล์ | สิ่งที่เพิ่ม |
|------|-------------|
| `shared/src/stats/index.ts` | re-export จาก `forecast.ts` |
| `server/src/services/analytics.ts` | function `forecastExpense(txns, budgets)` + route handler |
| `server/src/index.ts` | route `GET /analytics/forecast` |
| `client/src/lib/types.ts` | interface `ForecastData`, `CategoryForecast` |
| `client/src/pages/Timeline.tsx` | แท็บ "คาดการณ์" + 3 การ์ด |

### Interface หลัก

```ts
// shared/src/stats/forecast.ts

export interface CategoryForecast {
  category: CategoryId;
  label: string;
  color: string;
  // รายเดือน [+1, +2, +3]
  months: Array<{
    label: string;          // เช่น "ก.ค. 68"
    recurring: number;      // R_c
    variable: number;       // V̂_c[+k]
    total: number;          // F_c[+k]
    low: number;            // PI ล่าง
    high: number;           // PI บน
    exceedProb: number | null;  // null ถ้าไม่มีงบ
  }>;
  budget: number | null;
  hasSeasonal: boolean;     // true ถ้าเปิด seasonal
}

export interface ForecastData {
  categories: CategoryForecast[];
  total: Array<{ label: string; low: number; mid: number; high: number }>;
  backtest: {
    mape: number;
    baselineMape: number;
    skillScore: number;
    folds: number;
  };
  horizon: number;          // 3
  seasonalActive: boolean;  // ข้อมูล ≥ 12 เดือน
}
```

---

## 4. UI — แท็บ "คาดการณ์" ใน Timeline

แท็บใหม่ต่อจาก day/month/year เดิม fetch `/analytics/forecast` แยก

### การ์ด 1: ยอดคาดการณ์รายหมวด (month selector: +1/+2/+3)

- Bar chart แนวนอน หรือ stacked cards รายหมวด
- แต่ละหมวดแสดง: ชื่อ + ไอคอน, ยอด mid, error bar (low–high), % โอกาสเกินงบ (สีธง)
- แยกสี recurring (ทึบ) vs variable (จาง) ใน stacked bar

### การ์ด 2: ยอดรวมทั้งหมด 3 เดือน

- 3 คอลัมน์ (+1/+2/+3): แสดง low/mid/high
- เทียบกับรายรับเดือนล่าสุด → แถบสีบอก "เงินจะพอ"

### การ์ด 3: ความแม่นของโมเดล (Backtest)

- MAPE โมเดล vs baseline
- skill score พร้อมคำอธิบายสั้น
- จำนวน folds ที่ทดสอบ
- Accordion "วิธีคิดสูตร" — แสดงสูตรทุกข้อสำหรับกรรมการถาม

---

## 5. การทดสอบ

### Unit tests (`forecast.test.ts`)

1. `forecastByCategory` กับ synthetic 6 เดือน → mid > 0, low ≤ mid ≤ high ทุก horizon
2. บิลประจำสม่ำเสมอ → R_c ≈ yอด/เดือน ±5%
3. damping φ=0 → V̂_c[+1] = V̂_c[+2] = V̂_c[+3] (flat)
4. `exceedanceProbability(budget=F_c, sigma)` → ≈ 0.5 ±0.01
5. `backtestForecast` → mape ∈ [0,∞), skillScore ∈ (-∞,1], folds ≥ 1
6. ข้อมูลน้อย (2 เดือน) → fallback ทำงาน ไม่ crash, low ≤ mid ≤ high

### Manual smoke test

- เดโม 6 เดือน: แท็บ "คาดการณ์" โหลดได้, ทุกการ์ดแสดงผล, seasonalActive = false
- ตรวจ PI: low < mid < high เสมอ, ไม่ติดลบ

---

## 6. สมมติฐานที่ระบุชัด (สำหรับกรรมการ)

1. **หมวดอิสระต่อกัน** ในการรวม σ_total — จริงๆ อาจ correlated (เช่น อาหาร–เครื่องดื่ม) แต่ข้อมูลน้อยเกินไปจะประมาณ covariance ได้ไม่เชื่อถือ
2. **residual กระจายแบบ Normal** สำหรับ PI — ใช้ได้ในเชิง approximation เมื่อ n ≥ 5
3. **seasonal index คงที่ข้ามปี** — สมเหตุสมผลเมื่อ ≥ 12 เดือน แต่อาจ drift ได้
4. **บิลประจำคงที่** ในช่วงพยากรณ์ — ไม่รู้ล่วงหน้าว่าผู้ใช้จะยกเลิก subscription
