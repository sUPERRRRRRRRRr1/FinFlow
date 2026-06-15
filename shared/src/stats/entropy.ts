/**
 * Shannon entropy — ใช้วัด "การกระจายตัว" ของสัดส่วนรายจ่ายในแต่ละหมวด
 * ยิ่ง entropy สูง = เงินกระจายหลายหมวดสม่ำเสมอ (เสี่ยงกระจุกตัวต่ำ)
 * ยิ่งต่ำ = เงินกระจุกในไม่กี่หมวด (เช่น หมดไปกับช้อปปิ้งอย่างเดียว)
 */

/**
 * Shannon entropy H = -Σ pᵢ·ln(pᵢ)  (หน่วย nat เพราะใช้ ln)
 * @param values ค่าของแต่ละกลุ่ม (เช่น ยอดรวมต่อหมวด) — จะถูก normalize เป็นสัดส่วนให้เอง
 */
export function shannonEntropy(values: number[]): number {
  const positive = values.filter((v) => v > 0);
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const v of positive) {
    const p = v / total;
    h -= p * Math.log(p);
  }
  return h;
}

/**
 * Normalized entropy Hₙ = H / ln(k)  อยู่ในช่วง 0..1
 * โดย k = จำนวนกลุ่มที่มีค่า > 0
 * ทำให้เทียบข้ามจำนวนหมวดได้
 */
export function normalizedEntropy(values: number[]): number {
  const k = values.filter((v) => v > 0).length;
  if (k <= 1) return 0;
  return shannonEntropy(values) / Math.log(k);
}
