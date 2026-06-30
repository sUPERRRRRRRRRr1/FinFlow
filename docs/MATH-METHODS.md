# FinFlow — เอกสารวิธีการทำงานและสูตรคณิตศาสตร์ (ฉบับละเอียด)

> เอกสารเชิงเทคนิคสำหรับอธิบาย "เบื้องหลังคณิตศาสตร์/สถิติ" ของ FinFlow ทั้งหมด
> เรียบเรียงจากซอร์สโค้ดจริง (`shared/src/stats/**`, `shared/src/tax/**`, `server/src/services/analytics.ts`)
> อัปเดต: 2026-06-30 · โปรเจกต์: การแข่งขันนวัตกรรม AI & คณิตศาสตร์วิชาการ ครั้งที่ 11

---

## หลักการออกแบบ (Design Philosophy)

1. **เขียนเองทุกสูตร ไม่พึ่งไลบรารีสถิติสำเร็จรูป** — ตั้งแต่ค่าเฉลี่ย, regression, entropy, CDF ของ normal, ไปจนถึง Levenshtein distance ล้วนอิมพลีเมนต์เองด้วย TypeScript บริสุทธิ์ เพื่อให้ "อธิบายที่มาได้ทุกบรรทัด" ต่อกรรมการ
2. **คำนวณสดได้ทั้งสองฝั่ง (isomorphic)** — เอนจินสถิติอยู่ใน `@finflow/shared` ใช้ร่วมกันระหว่างเบราว์เซอร์ (React) และเซิร์ฟเวอร์ (Express) จึงคำนวณ What-if / วางแผนภาษีได้สดในเครื่องผู้ใช้
3. **ทุกตัวเลขกดดู "วิธีคิด + สูตร + แหล่งอ้างอิง" ได้** — โดยเฉพาะ Financial Health Score ที่แนบสูตรย่อ (`formula`) และแหล่งอ้างอิง (`reference`) ไปกับผลลัพธ์ทุกตัวชี้วัด
4. **ความสมดุลตรวจสอบได้ (auditable)** — กราฟ Sankey มาพร้อม flow-conservation check, การพยากรณ์มาพร้อม backtest (MAPE + skill score)

### สารบัญ

| § | หัวข้อ | ไฟล์ต้นทาง |
|---|--------|-----------|
| 1 | สถิติพื้นฐาน (Descriptive statistics) | `descriptive.ts` |
| 2 | การถดถอยเชิงเส้น (Linear regression) | `regression.ts` |
| 3 | เอนจินพยากรณ์รายจ่าย (Forecast engine) | `forecast.ts` |
| 4 | การตรวจจับค่าผิดปกติ (Outlier detection) | `outliers.ts` |
| 5 | การติดตามแนวโน้มรายหมวด (Trends) | `trends.ts` |
| 6 | เอนโทรปีของการกระจายรายจ่าย (Entropy) | `entropy.ts` |
| 7 | การตรวจจับรายจ่ายประจำ (Recurring detection) | `recurring.ts` |
| 8 | การกันรายการซ้ำ (Fuzzy deduplication) | `dedup.ts` |
| 9 | การจับคู่/ตั้งธงการโอนข้ามกระเป๋า (Transfers) | `transfers.ts` |
| 10 | การกระทบยอดจากยอดคงเหลือ (Reconciliation) | `reconcile.ts` |
| 11 | กราฟการไหลของเงิน (Sankey + flow conservation) | `sankey.ts` |
| 12 | คะแนนสุขภาพการเงิน (Financial Health Score) | `healthScore.ts` |
| 13 | เอนจินภาษีเงินได้บุคคลธรรมดา (Tax engine) | `tax/engine.ts` |
| 14 | อนุกรมเวลา & ค่าเฉลี่ยเคลื่อนที่ (Time series) | `timeseries.ts` |

> **สัญกรณ์ที่ใช้ตลอดเอกสาร:** $n$ = จำนวนจุดข้อมูล · $\mu$ = ค่าเฉลี่ย · $\sigma$ = ส่วนเบี่ยงเบนมาตรฐาน · $\bar{x}$ = ค่าเฉลี่ยของ $x$ · $\Phi$ = CDF ของ normal มาตรฐาน · ⌊·⌋ = floor

---

## 1) สถิติพื้นฐาน (Descriptive Statistics)

ไฟล์: [`shared/src/stats/descriptive.ts`](../shared/src/stats/descriptive.ts) — เป็นรากฐานของทุกฟีเจอร์

### 1.1 ค่ากลางและการกระจาย

**ค่าเฉลี่ยเลขคณิต (arithmetic mean):**

$$\mu = \bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i$$

**ความแปรปรวน (variance)** — รองรับทั้งแบบประชากร (หาร $n$) และตัวอย่าง (หาร $n-1$, Bessel's correction):

$$\sigma^2_{\text{pop}} = \frac{1}{n}\sum_{i=1}^{n}(x_i-\mu)^2 \qquad s^2_{\text{sample}} = \frac{1}{n-1}\sum_{i=1}^{n}(x_i-\mu)^2$$

**ส่วนเบี่ยงเบนมาตรฐาน:** $\sigma = \sqrt{\sigma^2}$

**สัมประสิทธิ์การแปรผัน (Coefficient of Variation, CV)** — วัด "ความสม่ำเสมอ" โดยไม่ขึ้นกับขนาดตัวเลข (ใช้ sample SD):

$$\mathrm{CV} = \frac{s}{|\mu|}$$

> CV เป็นหัวใจของหลายฟีเจอร์: ใช้วัดความสม่ำเสมอของรายรับ/รายจ่าย (เสาวางแผนของ Health Score), ความสม่ำเสมอของรอบบิล (Recurring), และความเสถียรของช่วงเวลาโอน

### 1.2 ควอนไทล์และ IQR

**Quantile** ใช้ **linear interpolation แบบ R type-7 / NumPy default** ที่ตำแหน่ง $q\in[0,1]$:

$$h = (n-1)\,q, \qquad Q(q) = x_{(\lfloor h\rfloor)} + (h-\lfloor h\rfloor)\,\big(x_{(\lfloor h\rfloor+1)} - x_{(\lfloor h\rfloor)}\big)$$

โดย $x_{(k)}$ คือค่าลำดับที่ $k$ จากการเรียงน้อยไปมาก · **มัธยฐาน** = $Q(0.5)$

**IQR และรั้ว (fences)** สำหรับตรวจ outlier — ตัวคูณมาตรฐาน $k=1.5$ (ปรับเป็น 3.0 = "far-out" สำหรับข้อมูลเบ้ขวาได้):

$$\mathrm{IQR} = Q_3 - Q_1, \qquad \text{lower} = Q_1 - k\cdot\mathrm{IQR}, \qquad \text{upper} = Q_3 + k\cdot\mathrm{IQR}$$

### 1.3 ฟังก์ชันช่วย

- `clamp(x, lo, hi) = max(lo, min(hi, x))` — จำกัดค่าในช่วง (ใช้ normalize คะแนนเป็น 0–100)
- `round(x, d) = round(x · 10^d) / 10^d` — ปัดทศนิยม (ดีฟอลต์ 2 ตำแหน่ง)

---

## 2) การถดถอยเชิงเส้น (Linear Regression)

ไฟล์: [`shared/src/stats/regression.ts`](../shared/src/stats/regression.ts) — วิธีกำลังสองน้อยที่สุด (Ordinary Least Squares)

ให้ชุดข้อมูล $(x_i, y_i)$ (โดยทั่วไป $x_i = 0,1,2,\dots$ คือลำดับเดือน) — หาเส้น $\hat{y} = a + bx$ ที่ทำให้ $\sum (y_i-\hat{y}_i)^2$ ต่ำสุด:

$$b = \frac{\sum_{i}(x_i-\bar{x})(y_i-\bar{y})}{\sum_{i}(x_i-\bar{x})^2} = \frac{S_{xy}}{S_{xx}}, \qquad a = \bar{y} - b\,\bar{x}$$

**สัมประสิทธิ์การตัดสินใจ** $R^2$ คำนวณจากรูปแบบ $\frac{S_{xy}^2}{S_{xx}S_{yy}}$ (เทียบเท่า $1 - SS_{\text{res}}/SS_{\text{tot}}$ ในเคสเชิงเส้น):

$$R^2 = \frac{S_{xy}^2}{S_{xx}\,S_{yy}}, \qquad S_{yy} = \sum_i (y_i-\bar{y})^2$$

**กรณีขอบ:** ถ้า $n<2$ คืน slope = 0; ถ้า $S_{xx}=0$ (x ทุกตัวเท่ากัน) คืน slope = 0

**การใช้งาน:** พยากรณ์เงินออมสุทธิ 3 เดือนข้างหน้าในหน้าไทม์ไลน์ ([`analytics.ts:233-239`](../server/src/services/analytics.ts)) และเป็นองค์ประกอบ trend ในเอนจินพยากรณ์ (§3)

---

## 3) เอนจินพยากรณ์รายจ่าย (Forecast Engine)

ไฟล์: [`shared/src/stats/forecast.ts`](../shared/src/stats/forecast.ts) — โมเดลหลักของหน้า "คาดการณ์"

นี่คือส่วนที่คณิตศาสตร์เข้มข้นที่สุด เป็น **โมเดลผสม (hybrid)** ที่รวม: การแยกองค์ประกอบรายจ่ายประจำ + EWMA + damped trend + ดัชนีฤดูกาล + ช่วงความเชื่อมั่นแบบ regression PI ทำต่อหมวดแล้วรวมยอด

### 3.1 การแยกองค์ประกอบ: รายจ่ายประจำ (recurring) vs ผันแปร (variable)

แนวคิด: รายจ่ายของแต่ละเดือนแยกเป็น "ส่วนประจำ" $R_c$ (subscription/ค่างวด ที่คาดเดาได้) + "ส่วนผันแปร" $V_c$ (ต้องพยากรณ์)

**ยอดรายจ่ายประจำต่อเดือนของหมวด $c$** — แปลงทุกรายการประจำให้เป็นอัตรา "ต่อเดือน" ด้วยจำนวนวันเฉลี่ยต่อเดือน 30.44 (= 365.25/12):

$$R_c = \sum_{i \in \text{recurring}(c)} \text{averageAmount}_i \times \frac{30.44}{\text{avgIntervalDays}_i}$$

นับเฉพาะรายการที่ยัง active (ครั้งล่าสุดไม่เก่าเกิน $1.5\times$ รอบของมัน)

จากนั้นแยกส่วนผันแปรของเดือน $m$ (ตรึงไม่ให้ติดลบ):

$$V_c(m) = \max\big(0,\; \text{spend}_c(m) - R_c\big)$$

> **เทคนิคสำคัญ:** ตัด "เดือนปัจจุบันที่ยังไม่จบ" ออกจากชุดเทรน เพราะข้อมูลไม่เต็มเดือนจะดึง EWMA ให้ต่ำผิด ([`forecast.ts:154-156`](../shared/src/stats/forecast.ts))

### 3.2 ระดับฐาน (Level): EWMA ถ่วงน้ำหนัก 3 จุดล่าสุด

ใช้ Exponentially-Weighted Moving Average บน 3 จุดล่าสุด ให้น้ำหนักเรียงจากใหม่→เก่าเป็น $\tfrac{1}{2}, \tfrac{1}{3}, \tfrac{1}{6}$ (รวม = 1):

$$\text{level} = \tfrac{1}{2}V_{t} + \tfrac{1}{3}V_{t-1} + \tfrac{1}{6}V_{t-2}$$

(เมื่อมี 1–2 จุด จะลดรูปเป็นค่าจุดเดียว / เฉลี่ยเท่ากันสองจุด)

### 3.3 แนวโน้มแบบหน่วง (Damped Trend)

ปัญหาของการ extrapolate เส้นตรงไกล ๆ คือมัน "วิ่งหลุด" — แก้ด้วยการหน่วง slope ด้วยตัวประกอบ $\varphi = 0.8$ ($0<\varphi<1$) ผลสะสม $k$ ก้าวคือ:

$$\text{damped}(k) = \sum_{i=1}^{k}\varphi^i \cdot \text{slope} = \text{slope}\cdot\frac{\varphi\,(1-\varphi^{k})}{1-\varphi}$$

(อนุกรมเรขาคณิต) — เมื่อ $\varphi\to1$ จะกลายเป็น $\text{slope}\times k$ (เส้นตรงปกติ), เมื่อ $\varphi\to0$ จะเป็น 0 (แบนราบ)

ตัวพยากรณ์ดิบของหมวดที่ horizon $k$ (เลือกใช้ flat เมื่อข้อมูลน้อยหรือ slope แทบเป็น 0):

$$\text{rawForecast}(k) = \begin{cases} \text{level} & \text{ถ้า } n_c<3 \text{ หรือ } |\text{slope}| < 0.01\cdot\max(\text{level},1) \\ \max(0,\; \text{level} + \text{damped}(k)) & \text{อื่น ๆ} \end{cases}$$

### 3.4 ดัชนีฤดูกาล (Seasonal Indices) — เปิดเมื่อมีข้อมูล ≥ 12 เดือน

ใช้วิธี **ratio-to-grand-mean**: หาค่าเฉลี่ยของแต่ละเดือนปฏิทิน (ม.ค.–ธ.ค.) แล้วหารด้วยค่าเฉลี่ยรวม จากนั้น normalize ให้ผลรวมดัชนี = 12

$$S_j^{\text{raw}} = \frac{\text{mean}(\{V \text{ ของเดือนปฏิทิน } j\})}{\text{mean}(V_{\text{ทั้งหมด}})}, \qquad S_j = \frac{S_j^{\text{raw}} \times 12}{\sum_{j=1}^{12} S_j^{\text{raw}}}$$

### 3.5 ค่าพยากรณ์รวมต่อหมวด

รวม recurring + (ฤดูกาล × ส่วนผันแปร):

$$F_c(k) = R_c + S_{\text{month}(k)} \cdot \text{rawForecast}(k)$$

### 3.6 ช่วงความเชื่อมั่น (Prediction Interval)

ใช้สูตร PI ของการถดถอยเชิงเส้น ที่ความกว้างขยายตามระยะห่างจากศูนย์กลางข้อมูล $\bar{x}$ — ครึ่งความกว้าง:

$$\text{halfWidth}(k) = Z \cdot \sigma_c \sqrt{1 + \frac{1}{n_c} + \frac{(x_0 - \bar{x})^2}{S_{xx}}}$$

โดย $Z = 1.28$ (ช่วงประมาณ 80%), $x_0 = n_c + k - 1$ คือตำแหน่งที่พยากรณ์, และ $\sigma_c$ = SD ของ residual ในชุดเทรน:

$$\sigma_c = \mathrm{stdev}\big(\{V_i - \hat{V}_i\}\big), \qquad \hat{V}_i = \max(0, a + b\,x_i)$$

ขอบเขต: $\text{low} = \max(0, F_c - \text{halfWidth})$, $\text{high} = F_c + \text{halfWidth}$

### 3.7 ความน่าจะเป็นที่จะเกินงบ (Exceedance Probability)

ถ้าหมวดนั้นตั้งงบ $L$ ไว้ คำนวณ $P(X > L)$ โดยสมมติรายจ่ายแจกแจงแบบ normal $\mathcal{N}(F_c, \sigma_c^2)$:

$$P(X > L) = 1 - \Phi\!\left(\frac{L - F_c}{\sigma_c}\right)$$

**CDF ของ normal มาตรฐาน** อิมพลีเมนต์เองด้วย rational approximation ของ Abramowitz & Stegun สูตร 26.2.17 (ความแม่น $|\varepsilon| < 7.5\times10^{-8}$):

$$\Phi(z) \approx 1 - \phi(z)\,(b_1 t + b_2 t^2 + b_3 t^3 + b_4 t^4 + b_5 t^5), \quad t = \frac{1}{1+0.2316419\,|z|}$$

โดย $\phi(z) = \tfrac{1}{\sqrt{2\pi}}e^{-z^2/2}$ และสัมประสิทธิ์ $b_1..b_5 = 0.31938153,\, -0.356563782,\, 1.781477937,\, -1.821255978,\, 1.330274429$ (สมมาตรรอบ 0 สำหรับ $z<0$)

### 3.8 การรวมยอดทุกหมวด (Aggregation)

สมมติแต่ละหมวด **อิสระต่อกัน** ความแปรปรวนรวมจึงเป็นผลบวกของความแปรปรวน (variance ของผลบวกตัวแปรสุ่มอิสระ):

$$\sigma_{\text{total}} = \sqrt{\sum_c \sigma_c^2}, \qquad \text{mid}(k) = \sum_c F_c(k), \qquad \text{halfWidth} = Z\,\sigma_{\text{total}}\sqrt{1 + \tfrac{1}{n}}$$

### 3.9 การทวนสอบย้อนหลัง (Backtesting) — Rolling-origin

วัดความแม่นจริงด้วย **rolling-origin evaluation** (จำนวน fold = $\min(n-3, 3)$) บนยอดรายจ่ายรวมรายเดือน แต่ละ fold เทรนด้วยข้อมูลถึงเดือน $t-1$ แล้วพยากรณ์เดือน $t$ เทียบกับจริง

**MAPE (Mean Absolute Percentage Error):**

$$\text{MAPE} = \frac{1}{F}\sum_{f}\frac{|\text{actual}_f - \text{predicted}_f|}{\text{actual}_f}$$

เทียบกับ **baseline** (ค่าเฉลี่ย 3 เดือนล่าสุด) แล้วคำนวณ **Skill Score** (ยิ่งเข้าใกล้ 1 ยิ่งเก่งกว่า baseline):

$$\text{SkillScore} = 1 - \frac{\text{MAPE}_{\text{model}}}{\text{MAPE}_{\text{baseline}}}$$

> SkillScore > 0 = โมเดลแม่นกว่าการเดาด้วยค่าเฉลี่ยเฉย ๆ — เป็นหลักฐานเชิงปริมาณว่าโมเดลมีคุณค่า

---

## 4) การตรวจจับค่าผิดปกติ (Outlier Detection)

ไฟล์: [`shared/src/stats/outliers.ts`](../shared/src/stats/outliers.ts) — ใช้ในหน้า "รายจ่ายผิดปกติ"

ตรวจด้วย **2 วิธีพร้อมกัน** จุดจะถูกตั้งธงเมื่อเข้าเงื่อนไขข้อใดข้อหนึ่ง:

**1) Z-score:**

$$z_i = \frac{x_i - \mu}{\sigma}, \qquad \text{ผิดปกติเมื่อ } z_i > z_{\text{thresh}} \;(\text{ดีฟอลต์ } 2)$$

**2) IQR fence:** $x_i > Q_3 + k\cdot\mathrm{IQR}$ (สำหรับรายจ่าย เน้นเฉพาะ "พุ่งสูง", `highOnly=true`)

**การปรับใช้จริง** ([`analytics.ts:289-300`](../server/src/services/analytics.ts)): รายจ่ายรายวันมีการแจกแจง **เบ้ขวา (right-skewed)** ตามธรรมชาติ จึงใช้ $k=3.0$ ("far-out") สำหรับ IQR และแสดงเฉพาะวันที่มีนัยสำคัญทางสถิติจริง ($z>2$) เพื่อไม่ให้หน้าจอรก — เก็บเหตุผล (`zscore`/`iqr`/`both`) ติดไปกับแต่ละจุด

---

## 5) การติดตามแนวโน้มรายหมวด (Category Trends)

ไฟล์: [`shared/src/stats/trends.ts`](../shared/src/stats/trends.ts)

สำหรับแต่ละหมวด คำนวณ 3 มุมมอง:

**1) เปอร์เซ็นต์การเปลี่ยนแปลงเทียบเดือนก่อน:**

$$\Delta\% = \frac{\text{current} - \text{previous}}{\text{previous}} \times 100$$

**2) Baseline Z-score** — เทียบเดือนล่าสุดกับ "การกระจายของเดือนก่อน ๆ ของหมวดตัวเอง" (ตัดเดือนล่าสุดออกจาก baseline) เพื่อแยก "พุ่งจริง" ออกจาก "ความผันผวนปกติ":

$$z = \frac{\text{current} - \mu_{\text{baseline}}}{\sigma_{\text{baseline}}}$$

$z > 2$ ⇒ ถือว่าหมวดนั้นพุ่งผิดปกติจริง (ป้อนเข้าระบบ Insight แบบ rule-based)

**3) Slope** จาก linear regression ของยอดรายเดือน → ทิศทาง up/down/flat (เกณฑ์ flat คือ $|\Delta\%| < 5$)

---

## 6) เอนโทรปีของการกระจายรายจ่าย (Shannon Entropy)

ไฟล์: [`shared/src/stats/entropy.ts`](../shared/src/stats/entropy.ts)

วัด "ความกระจายตัว" ของสัดส่วนรายจ่ายในแต่ละหมวด — แปลงยอดต่อหมวดเป็นสัดส่วน $p_i$ แล้วคำนวณ:

$$H = -\sum_{i} p_i \ln p_i \quad (\text{หน่วย nat เพราะใช้ } \ln), \qquad p_i = \frac{v_i}{\sum_j v_j}$$

**Normalized entropy** หารด้วย $\ln k$ (โดย $k$ = จำนวนหมวดที่มีค่า > 0) เพื่อให้อยู่ในช่วง $[0,1]$ และเทียบข้ามจำนวนหมวดได้:

$$H_n = \frac{H}{\ln k}$$

- $H_n \to 1$ : เงินกระจายหลายหมวดสม่ำเสมอ (เสี่ยงกระจุกตัวต่ำ)
- $H_n \to 0$ : เงินกระจุกในไม่กี่หมวด (เช่น หมดไปกับช้อปปิ้งอย่างเดียว)

---

## 7) การตรวจจับรายจ่ายประจำ (Recurring Detection)

ไฟล์: [`shared/src/stats/recurring.ts`](../shared/src/stats/recurring.ts) — วิเคราะห์ความเป็นคาบ (periodicity)

ขั้นตอน:
1. จับกลุ่มรายการที่ผู้รับเดียวกัน (normalize ชื่อ) **และ** จำนวนเงินใกล้กัน (อยู่ในช่วง $\bar{a} \pm 15\%$)
2. คำนวณระยะห่างระหว่างครั้งติดกัน (intervals เป็นวัน) แล้วหาความสม่ำเสมอจาก CV ของ intervals:

$$\text{regularity} = 1 - \min(\mathrm{CV}_{\text{interval}},\, 1), \qquad \mathrm{CV}_{\text{interval}} = \frac{s_{\text{interval}}}{\overline{\text{interval}}}$$

3. ถือเป็น recurring เมื่อพบ $\geq 3$ ครั้ง **และ** $\text{regularity} \geq 0.5$

regularity ใกล้ 1 = รอบสม่ำเสมอมาก (เช่นค่าสมาชิกรายเดือน) · เรียงผลลัพธ์ตาม "ผลกระทบ" = averageAmount × occurrences

> ผลลัพธ์นี้ป้อนกลับเข้าเอนจินพยากรณ์ (§3.1) เพื่อแยกส่วน $R_c$ ออกจากส่วนผันแปร

---

## 8) การกันรายการซ้ำ (Fuzzy Deduplication)

ไฟล์: [`shared/src/stats/dedup.ts`](../shared/src/stats/dedup.ts) — กันรายการเดียวกันที่มาจากหลายแหล่ง (statement + สลิป + บันทึกเอง)

### 8.1 Levenshtein distance (edit distance)

จำนวนการแก้ไขขั้นต่ำ (เพิ่ม/ลบ/แทนที่อักขระ) เพื่อเปลี่ยนสตริง $a \to b$ คำนวณด้วย **dynamic programming** ตามความสัมพันธ์เวียนเกิด:

$$D_{i,j} = \min\begin{cases} D_{i-1,j} + 1 & (\text{ลบ}) \\ D_{i,j-1} + 1 & (\text{เพิ่ม}) \\ D_{i-1,j-1} + \mathbb{1}[a_i \neq b_j] & (\text{แทนที่}) \end{cases}$$

อิมพลีเมนต์แบบ 2 แถว (rolling array) ใช้หน่วยความจำ $O(\min(m,n))$ แทน $O(mn)$

### 8.2 ความคล้ายของสตริง (Normalized similarity)

$$\text{sim}(a,b) = 1 - \frac{D(a,b)}{\max(|a|,|b|)} \in [0,1]$$

บวกกฎพิเศษ: ถ้าสตริงสั้น (≥8 ตัว) เป็น **prefix** ของสตริงยาว → ยกเป็นอย่างน้อย 0.88 (รองรับชื่อที่ถูกตัดทอนใน KBank STM เทียบกับชื่อเต็มใน OCR สลิป) — ก่อนเทียบจะ normalize ตัดชื่อธนาคาร/คำนำหน้าชื่อ (นาย/นางสาว/Mr) และเลขบัญชีปิดบังออก

### 8.3 ตรรกะการกันซ้ำ

สองรายการถือว่าซ้ำเมื่อ: ทิศทางเดียวกัน + จำนวนเงินต่างกัน ≤ 1 บาท + (วันตรงกันถ้าแหล่งเดียวกัน / ต่างได้ ≤1 วันถ้าข้ามแหล่ง) + $\text{sim} \geq 0.8$ เมื่อพบคู่ซ้ำ จะเก็บตัวที่ "ข้อมูลครบกว่า" ตามลำดับความน่าเชื่อถือ:

$$\text{statement (kbank/make/truemoney)} = 3 > \text{manual} = 2 > \text{slip} = 1$$

เมื่อ rank เท่ากัน ตัวที่ "มีเลขบัญชี" ชนะตัวที่ไม่มี และตัวที่ "มียอดคงเหลือ" ชนะ (เพื่อรักษาข้อมูลที่แยกบัญชีและกระทบยอดได้)

---

## 9) การจับคู่/ตั้งธงการโอนข้ามกระเป๋า (Transfers)

ไฟล์: [`shared/src/stats/transfers.ts`](../shared/src/stats/transfers.ts) — กันการนับเงินโอนตัวเองเป็นรายรับ/รายจ่ายซ้ำ

### 9.1 การจับคู่ (matchTransfers) — Greedy nearest-in-time

มองหารายการ "ออก" จากกระเป๋า A ที่มีรายการ "เข้า" กระเป๋า B โดย:

- คนละกระเป๋า: $\text{walletKey}(in) \neq \text{walletKey}(out)$
- จำนวนเงินใกล้กัน: $|a_{in} - a_{out}| \leq \text{amountTol}\ (1\text{ บาท})$
- ในกรอบเวลา: $|\text{diffDays}| \leq \text{dayWindow}\ (1\text{ วัน})$

เมื่อมีผู้เข้าชิงหลายราย เลือกคู่ที่ **ช่องว่างเวลาน้อยที่สุด** ($\arg\min |\text{gap}|$) แบบ greedy และทำเครื่องหมายขาเข้าที่ใช้แล้วไม่ให้จับซ้ำ คู่ที่จับได้ตั้ง `isTransfer=true`, `category='own_transfer'` และผูก `transferGroup` เดียวกัน

### 9.2 การตั้งธงจากเลข/ชื่อ (tagOwnTransfers)

แก้กรณี statement มาฝั่งเดียว (จับคู่ไม่ได้) — จับ "บัญชีตัวเอง" 2 ทาง:
1. **เลขบัญชี 4 ตัวท้าย** ในรูปแบบ `X####` ที่อ้างถึงในข้อความ ตรงกับบัญชีที่ตั้งค่าไว้
2. **ชื่อเจ้าของบัญชี** (selfNames) ตรงกับชื่อผู้รับ/ผู้โอน ด้วย `stringSimilarity ≥ 0.9` (เกณฑ์เข้มกันชนกับคนอื่น)

> **เหตุผลเชิงโดเมน:** การโอนเข้าบัญชีออมของตัวเองนับเป็น "ย้ายกระเป๋า" (เป็นกลาง) ไม่ใช่ "รายจ่าย" และไม่ใช่ "เงินออม" เพราะเงินออม = ยอดคงเหลือบัญชีออม ไม่ใช่ผลรวมยอดโอน (ดู `finflow-money-model`)

---

## 10) การกระทบยอดจากยอดคงเหลือ (Reconciliation)

ไฟล์: [`shared/src/stats/reconcile.ts`](../shared/src/stats/reconcile.ts) — อนุมานเงินเข้า/ออกที่ "ไม่มีสลิป" จากยอดคงเหลือที่กระโดด

### 10.1 หลักการ: ส่วนต่างของยอดคงเหลือ

ระหว่างจุดที่รู้ยอดคงเหลือ 2 จุดติดกัน (anchor) ของบัญชีเดียวกัน ยอดที่ "ควรจะเป็น" = ยอดก่อนหน้า + ผลรวมรายการที่บันทึกไว้ระหว่างนั้น ส่วนต่างจากยอดจริงคือเงินที่เคลื่อนไหวจริงแต่ไม่มีหลักฐาน:

$$\text{expected} = \text{balance}_{\text{prev}} + \sum_{j}\text{signed}_j, \qquad \text{gap} = \text{balance}_{\text{actual}} - \text{expected}$$

โดย $\text{signed}_j = +a_j$ ถ้าเงินเข้า, $-a_j$ ถ้าเงินออก · ถ้า $|\text{gap}| > \text{tol}\ (1\text{ บาท})$ ⇒ สร้าง "InferredFlow": $\text{gap}>0$ = เงินเข้า, $\text{gap}<0$ = เงินออก

ช่องว่างเหล่านี้คำนวณสดทุกครั้ง (ไม่บันทึกถาวร) เมื่อ statement จริงมาเติม ช่องว่างจะหด/หายเอง

### 10.2 การกรองการโอนตัวเองออก

จับคู่ขาออก↔ขาเข้าที่จำนวนใกล้กัน ($|\Delta| \leq \max(\text{tol},\, 0.1\,a)$ = ผ่อนปรน 10%) และเวลาใกล้กัน (≤2 วัน) ทำเครื่องหมาย `likelyTransfer` แล้วเหลือเฉพาะ `external` = เงินเข้า/ออกจากภายนอกจริง

### 10.3 ยอดคงเหลือเรียลไทม์ (Projected Balance)

ต่อยอดจาก anchor ล่าสุดด้วยการโอนข้ามบัญชีที่ยังไม่สะท้อนในฝั่งนั้น:

$$\text{projected} = \text{anchorBalance} + \underbrace{\sum (\pm\,\text{amount})}_{\text{pendingNet}}$$

ทิศทาง: ต้นทาง "จ่ายออก" → เงินเข้าปลายทาง $(+)$ · ต้นทาง "รับเข้า" → เงินออกจากปลายทาง $(-)$ — นับเฉพาะที่เกิด **หลัง** anchor และยังไม่จับคู่ (statement ปลายทางยังไม่มา)

---

## 11) กราฟการไหลของเงิน (Sankey + Flow Conservation)

ไฟล์: [`shared/src/stats/sankey.ts`](../shared/src/stats/sankey.ts) — multi-stage flow graph

โครงสร้าง: **รายรับ → กระเป๋า → (โอนข้ามกระเป๋า) → หมวดรายจ่าย / ออม / คงเหลือ**

### 11.1 หลักการอนุรักษ์การไหล (Flow Conservation)

ทุก "กระเป๋า" (โนดกลาง) ต้องมีเงินเข้า = เงินออก — ถ้าไม่สมดุล เติมโนดชดเชย:

$$\text{diff}(w) = \text{inflow}(w) - \text{outflow}(w) = \begin{cases} > 0.5 & \Rightarrow \text{เติม "เงินคงเหลือ" } \text{diff} \\ < -0.5 & \Rightarrow \text{เติม "ยอดยกมา" } |\text{diff}| \end{cases}$$

ผลตรวจ (`BalanceCheck`) คืน `maxImbalance` = ความไม่สมดุลสูงสุดในโนดใด ๆ — เป็น invariant ที่ตรวจสอบความถูกต้องของกราฟทั้งหมด

### 11.2 การ net ทิศทางและตัดวงจร (DAG)

การโอนสองทิศ A↔B ยุบเป็นทิศเดียวด้วยผลต่างสุทธิ (net flow):

$$\text{net}(A\to B) = \text{flow}(A\to B) - \text{flow}(B\to A)$$

จากนั้น **ตัดวงจร (cycle removal)** ให้กราฟเป็น **DAG** ที่ d3-sankey วาดได้ ด้วย greedy: เรียงเส้นตามขนาด (มาก→น้อย) แล้วใส่ทีละเส้น ข้ามเส้นที่จะสร้างวงจร (ตรวจด้วย DFS reachability) — เก็บ flow ใหญ่ก่อน

### 11.3 การลดความรก (Noise reduction)

ยุบผู้โอน/หมวดที่เล็กกว่า **4% ของยอดรวม** เป็น "รับโอนอื่นๆ" / "อื่น ๆ" เพื่อไม่ให้กราฟมีเส้นบางหลายสิบเส้น

---

## 12) คะแนนสุขภาพการเงิน (Financial Health Score)

ไฟล์: [`shared/src/stats/healthScore.ts`](../shared/src/stats/healthScore.ts) — ฟีเจอร์เรือธงด้านคณิตศาสตร์

โครงสร้าง **4 เสา** อิงกรอบ FinHealth Score (Financial Health Network) + CFPB Financial Well-Being แต่ **คำนวณแต่ละเสาจากอัตราส่วนการเงินจริง** ตามเกณฑ์ตลาดหลักทรัพย์ฯ (SET Happy Money) และธนาคารแห่งประเทศไทย ทุกตัวเลขได้จากธุรกรรมจริง

### 12.1 การ normalize เป็น 0–100

ตัวชี้วัดทุกตัว map เป็นคะแนน 0–100 ด้วย **linear scaling** (รองรับทั้งทิศขึ้นและลง):

$$\text{linearScore}(x; \text{zero}, \text{full}) = 100 \cdot \text{clamp}\!\left(\frac{x - \text{zero}}{\text{full} - \text{zero}},\, 0,\, 1\right)$$

### 12.2 สี่เสาและตัวชี้วัด

**เสา 1 — ใช้จ่าย (Spend):**

- *อัตราส่วนความอยู่รอด* (SET): $\text{survival} = \dfrac{\text{income}}{\text{expense}}$ → $\text{linearScore}(0.8, 1.2)$
- *วินัย 50/30/20* (Warren, 2005): needs ≤ 50%, wants ≤ 30% ของรายรับ

$$\text{needsScore} = 100\Big(1 - \text{clamp}\big(\tfrac{\text{needsShare}-0.5}{0.5}, 0, 1\big)\Big), \quad \text{ruleScore} = \tfrac{1}{2}\text{needsScore} + \tfrac{1}{2}\text{wantsScore}$$

**เสา 2 — ออม (Save):**

- *อัตราการออม*: $s = \dfrac{\text{income} - \text{expense}}{\text{income}}$ → $100\cdot\text{clamp}(s / s_{\text{full}}, 0, 1)$ ($s_{\text{full}}$ = 20% ผู้ใหญ่ / 10% นักเรียน)
- *เงินสำรองฉุกเฉิน*: $\text{months} = \dfrac{\text{ยอดคงเหลือ (หรือเงินเหลือสะสม)}}{\text{รายจ่ายเฉลี่ยต่อเดือน}}$ → เต็มที่ 6 เดือน (ผู้ใหญ่) / 3 เดือน (นักเรียน)

**เสา 3 — กู้ยืม (Borrow):** ภาระหนี้ต่อรายได้ (DTI) ประมาณจาก keyword (ผ่อน/สินเชื่อ/บัตร) ใช้ฟังก์ชัน **piecewise linear**:

$$\text{DTI} = \frac{\text{debtService}}{\text{income}}, \qquad \text{score}(\text{DTI}) = \begin{cases} 100 & \text{DTI} \leq 0.20 \\ 100 - \frac{\text{DTI}-0.20}{0.15}\cdot 25 & 0.20 < \text{DTI} \leq 0.35 \\ 75 - \frac{\text{DTI}-0.35}{0.15}\cdot 75 & 0.35 < \text{DTI} \leq 0.50 \\ 0 & \text{DTI} > 0.50 \end{cases}$$

**เสา 4 — วางแผน/พฤติกรรม (Plan):** ใช้ความสม่ำเสมอ (CV ต่ำ = มีวินัย) เป็น proxy ผ่าน **exponential decay**:

$$\text{stability} = 100 \cdot e^{-1.1\,\mathrm{CV}}$$

ใช้กับทั้งรายรับและรายจ่ายรายเดือน (CV ต่ำ → คะแนนเข้าใกล้ 100)

### 12.3 การรวมคะแนน (Weighted aggregation)

แต่ละเสา = ค่าเฉลี่ยถ่วงน้ำหนักของตัวชี้วัดย่อย (น้ำหนักรวม = 1), คะแนนรวม = ผลรวมถ่วงน้ำหนักข้ามเสา:

$$\text{pillar} = \sum_{m}\text{score}_m \cdot w_m, \qquad \text{total} = \sum_{p}\text{pillar}_p \cdot w_p$$

น้ำหนักเสาตามโปรไฟล์:

| โปรไฟล์ | spend | save | borrow | plan |
|---------|-------|------|--------|------|
| ผู้ใหญ่/วัยทำงาน | 0.35 | 0.35 | 0.20 | 0.10 |
| นักเรียน/วัยเริ่มทำงาน | 0.35 | 0.40 | 0.10 | 0.15 |

**ระดับผลลัพธ์** (FinHealth 3 ระดับ): total ≥ 80 = สุขภาพดี · ≥ 40 = ประคองตัว · < 40 = เปราะบาง

> ทุกตัวชี้วัดแนบ `formula` + `reference` + `inputs` (ตัวเลขดิบ) ไปกับผลลัพธ์ เพื่อตอบรอบ Q&A ของกรรมการได้ทันที

---

## 13) เอนจินภาษีเงินได้บุคคลธรรมดา (Tax Engine)

ไฟล์: [`shared/src/tax/engine.ts`](../shared/src/tax/engine.ts) · กฎ: [`tax/rules2567.ts`](../shared/src/tax/rules2567.ts) (ปีภาษี 2567)

### 13.1 ภาษีแบบขั้นบันได (Progressive Tax)

เก็บภาษีเฉพาะส่วนของเงินได้สุทธิที่ตกในแต่ละขั้น:

$$\text{tax} = \sum_{b}\,\big(\min(\text{net}, \text{to}_b) - \text{from}_b\big)^{+}\cdot \text{rate}_b$$

ขั้นบันได 2567: 0% (≤150k), 5% (150k–300k), 10% (300k–500k), 15% (500k–750k), 20% (750k–1M), 25% (1M–2M), 30% (2M–5M), 35% (>5M)

**อัตราภาษีขั้นสุดท้าย (marginal rate)** = rate ของขั้นสูงสุดที่เงินได้สุทธิไปถึง — ใช้คำนวณ "เงินประหยัดภาษีต่อการลดหย่อน 1 บาท"

### 13.2 ลำดับการคำนวณเงินได้สุทธิ

$$\text{เงินได้สุทธิ} = \underbrace{\text{เงินได้พึงประเมิน} - \text{ค่าใช้จ่าย}}_{\text{incomeAfterExpense}} - \text{ค่าลดหย่อนรวม}$$

**ค่าใช้จ่าย:** เงินเดือน 40(1)+40(2) หักเหมา 50% รวมกันไม่เกิน 100,000 · ประเภทอื่นใช้ rate/cap ของตัวเอง (เช่น 40(8) = 60%)

**ค่าลดหย่อน:** แต่ละช่องมีเพดาน (cap) ของตัวเอง โดยมีกฎซ้อน เช่น
- กลุ่มเกษียณ (PVD/RMF/SSF/ประกันบำนาญ/กอช.): cap แต่ละตัวก่อน แล้วรวมไม่เกิน 500,000
- เงินบริจาค: ไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่าย+ลดหย่อนอื่น (บริจาคเพื่อการศึกษาคูณ 2)

### 13.3 ภาษีขั้นต่ำ 0.5% (Minimum Tax)

ถ้าเงินได้ประเภท 40(2)–(8) รวม ≥ 120,000 ต้องเทียบกับภาษีวิธี 0.5%:

$$\text{taxBeforeCredit} = \max\big(\text{progressiveTax},\; \text{otherIncome}\times 0.005\big)$$

(ยกเว้นถ้าผลคูณ ≤ 5,000) แล้วหักภาษี ณ ที่จ่าย (withholding) เป็นเครดิต → ได้ภาษีที่ต้องชำระ/ขอคืน

### 13.4 ตัวชี้วัดและคำแนะนำ

$$\text{effectiveRate} = \frac{\text{taxBeforeCredit}}{\text{grossTaxable}}, \qquad \text{VAT โดยประมาณ} = \text{consumption}\times\frac{7}{107}$$

**คำแนะนำประหยัดภาษี:** สำหรับช่องลดหย่อนที่ยังเหลือเพดาน คำนวณเงินประหยัดที่คาดได้ = ห้องที่เหลือ × marginal rate แล้วเรียงจากมากไปน้อย:

$$\text{estimatedSaving} = \text{room} \times \text{marginalRate}$$

---

## 14) อนุกรมเวลา & ค่าเฉลี่ยเคลื่อนที่ (Time Series)

ไฟล์: [`shared/src/stats/timeseries.ts`](../shared/src/stats/timeseries.ts)

**การรวมยอดตามช่วงเวลา (aggregate):** จัดกลุ่มธุรกรรมเป็น day/month/year โดย**ตัดการโอนระหว่างกระเป๋าออก**จากรายรับ/รายจ่ายเสมอ (กันนับซ้ำ) แยกเป็น income / expense / savings

**ค่าเฉลี่ยเคลื่อนที่ (trailing moving average)** ขนาดหน้าต่าง $W$ (เช่น MA7 ในกราฟไทม์ไลน์) — จุดต้น ๆ ใช้หน้าต่างสั้นกว่า:

$$\text{MA}_t = \frac{1}{\min(t+1, W)}\sum_{i=\max(0,\,t-W+1)}^{t} x_i$$

อิมพลีเมนต์แบบ **sliding window** (บวกตัวใหม่ ลบตัวที่หลุดหน้าต่าง) เป็น $O(n)$ ไม่ใช่ $O(nW)$

**นิยามที่ใช้ร่วมกันทั้งระบบ:**
- `isConsumption` = ออก ∧ ไม่ใช่โอน ∧ ไม่ใช่ออม (รายจ่ายเพื่อการบริโภค)
- `isRealIncome` = เข้า ∧ ไม่ใช่โอน (รายรับจริง)

---

## ภาคผนวก: ตารางค่าคงที่สำคัญ

| ค่าคงที่ | สัญลักษณ์ | ค่า | ใช้ที่ | เหตุผล |
|---------|----------|-----|--------|--------|
| Damping factor | $\varphi$ | 0.8 | Forecast trend | กันเส้นแนวโน้มวิ่งหลุดเมื่อ extrapolate ไกล |
| Z สำหรับ PI | $Z$ | 1.28 | Forecast PI | ช่วงความเชื่อมั่น ~80% |
| วันต่อเดือนเฉลี่ย | — | 30.44 | Recurring → monthly | = 365.25 / 12 |
| Seasonal trigger | — | 12 เดือน | Forecast | ต้องครบ 1 ปีจึงประเมินฤดูกาลได้ |
| IQR fence (ปกติ / far-out) | $k$ | 1.5 / 3.0 | Outlier | 3.0 สำหรับข้อมูลเบ้ขวา (รายจ่ายรายวัน) |
| Z-threshold | — | 2 | Outlier / Trend spike | นัยสำคัญทางสถิติ |
| เกณฑ์ similarity (dedup / self-name) | — | 0.8 / 0.9 | Dedup / Transfers | 0.9 เข้มกว่าเพื่อกันชนคนอื่น |
| เกณฑ์ยุบโนด Sankey | — | 4% | Sankey | ลดเส้นบางที่ทำให้กราฟรก |
| Stability decay | — | 1.1 | Health Score | $e^{-1.1\,\text{CV}}$ ปรับความชันคะแนนความสม่ำเสมอ |
| Tolerance สมดุล | — | 0.5–1 บาท | Sankey / Reconcile | กันสะสมปัดเศษ |

## ภาคผนวก: รายชื่อไฟล์ทดสอบ (พิสูจน์ความถูกต้อง)

ทุกโมดูลคณิตศาสตร์มี unit test คู่กัน — รันด้วย `npm test`:

`descriptive.test.ts` · `regression.test.ts` · `forecast.test.ts` · `transfers.test.ts` · `reconcile.test.ts` · `dates.test.ts` · `merchantRules.test.ts` · `engine.test.ts` (stats) · `tax/engine.test.ts` · `tax/detect.test.ts` · `parsers/*.test.ts`

---

*เอกสารนี้สร้างจากซอร์สโค้ดจริง ณ 2026-06-30 — หากแก้สูตรในโค้ด ควรอัปเดตเอกสารให้ตรงกัน*
