import type { Transaction } from '../types.js';
import { walletKey } from '../types.js';
import { round } from './descriptive.js';
import { diffDays } from './dates.js';

/**
 * เงินเข้า/ออกที่ "อนุมานจากยอดคงเหลือ" — ไม่มีสลิป/รายการบันทึกไว้ แต่ยอดคงเหลือ (balanceAfter)
 * กระโดดมากกว่าที่รายการอธิบายได้ → ส่วนต่างนั้นคือเงินที่เคลื่อนไหวจริงแต่เราไม่เห็นหลักฐาน
 */
export interface InferredFlow {
  /** id สังเคราะห์ (inf-<หลัง>-<ก่อน>) — ไม่ถูกบันทึกลง DB คำนวณสดทุกครั้ง */
  id: string;
  source: string;
  account?: string;
  direction: 'in' | 'out';
  amount: number;
  /** ขอบเวลาล่าง: เกิดหลังรายการนี้ (จุดที่รู้ยอดคงเหลือก่อนหน้า) */
  afterId: string;
  afterDate: string;
  afterTime?: string;
  /** ขอบเวลาบน: เกิดไม่เกินรายการนี้ (จุดที่รู้ยอดคงเหลือถัดมา) */
  beforeId: string;
  beforeDate: string;
  beforeTime?: string;
  /** เดาว่าน่าจะเป็นการย้ายเงินระหว่างบัญชีตัวเอง (จับคู่ขาเข้า-ออกใกล้กันได้) ไม่ใช่เงินจริงจากภายนอก */
  likelyTransfer: boolean;
}

export interface ReconcileResult {
  /** ช่องว่างทั้งหมดที่ตรวจพบ (รวมที่เดาว่าเป็นการโอนตัวเอง) */
  flows: InferredFlow[];
  /** เฉพาะที่ไม่ใช่การโอนตัวเอง = เงินเข้า/ออกจากภายนอกจริงที่ไม่มีสลิป */
  external: InferredFlow[];
  /** ผลรวมเงินเข้าภายนอกที่อนุมานได้ (บาท) */
  inferredIncome: number;
  /** ผลรวมเงินออกภายนอกที่อนุมานได้ (บาท) */
  inferredExpense: number;
}

function byTime(a: Transaction, b: Transaction): number {
  return (
    (a.date || '').localeCompare(b.date || '') ||
    (a.time || '').localeCompare(b.time || '') ||
    a.id.localeCompare(b.id)
  );
}

/** ยอดคงเหลือ "เรียลไทม์" ของบัญชี = ยอดจริงล่าสุด (anchor) + การโอนข้ามบัญชีที่ยังไม่สะท้อน */
export interface ProjectedBalance {
  walletKey: string;
  /** ยอดคงเหลือจริงล่าสุดที่รู้ (จาก statement/แจ้งเตือน) */
  anchorBalance: number;
  /** วันเวลาของ anchor (date+time) */
  anchorKey: string;
  /** วันที่ของ anchor (YYYY-MM-DD) — "ยอดนี้ ณ วันที่นี้" */
  anchorDate: string;
  /** เวลาของ anchor (HH:MM) ถ้ามี */
  anchorTime?: string;
  /** สุทธิการโอนข้ามบัญชีที่เกิด "หลัง" anchor และยังไม่ขึ้น statement ฝั่งนี้ (+เข้า/−ออก) */
  pendingNet: number;
  /** ยอดประมาณการเรียลไทม์ = anchorBalance + pendingNet */
  projected: number;
}

/**
 * ต่อยอด "ยอดคงเหลือเรียลไทม์" จากการโอนข้ามบัญชีตัวเอง
 *
 * ปัญหา: บัญชีออมมัก statement มาช้า/ไม่ครบ แต่เรารู้การโอนเข้า-ออกจาก "อีกบัญชี" อยู่แล้ว
 *   (เช่น บัญชีหลักมีรายการ "โอนไป X1800" = เงินเข้าบัญชีออม) ใช้พวกนี้ต่อยอดยอดออมทันที
 *
 * วิธี: หา anchor (ยอดจริงล่าสุด) ของแต่ละบัญชี แล้วบวก/ลบการโอนข้ามบัญชี (transferTo) ที่
 *   - ปลายทางคือบัญชีนั้น และเกิด "หลัง" anchor (ก่อน anchor = สะท้อนในยอดแล้ว ไม่นับซ้ำ)
 *   - ยังไม่จับคู่ (ไม่มี transferGroup) = รู้ฝั่งเดียว ฝั่งปลายทางยังไม่มี statement
 *   ทิศทาง: ต้นทาง "จ่ายออก" → เงินเข้าปลายทาง (+) · ต้นทาง "รับเข้า" → เงินออกจากปลายทาง (−)
 */
export function projectBalances(txns: Transaction[]): Map<string, ProjectedBalance> {
  const sorted = [...txns].sort(byTime);
  const anchorBal = new Map<string, number>();
  const anchorKey = new Map<string, string>();
  const anchorDate = new Map<string, string>();
  const anchorTime = new Map<string, string | undefined>();
  for (const t of sorted) {
    if (t.balanceAfter == null) continue;
    const k = walletKey(t);
    anchorBal.set(k, t.balanceAfter); // txns เรียงเวลา → ตัวหลังทับ = ยอดล่าสุด
    anchorKey.set(k, t.date + (t.time ?? ''));
    anchorDate.set(k, t.date);
    anchorTime.set(k, t.time);
  }
  const pending = new Map<string, number>();
  for (const t of sorted) {
    if (!t.transferTo || t.transferGroup) continue;
    const ak = anchorKey.get(t.transferTo);
    if (ak == null || t.date + (t.time ?? '') <= ak) continue;
    const sign = t.direction === 'out' ? 1 : -1;
    pending.set(t.transferTo, round((pending.get(t.transferTo) ?? 0) + sign * t.amount));
  }
  const out = new Map<string, ProjectedBalance>();
  for (const [k, bal] of anchorBal) {
    const p = pending.get(k) ?? 0;
    out.set(k, {
      walletKey: k,
      anchorBalance: bal,
      anchorKey: anchorKey.get(k)!,
      anchorDate: anchorDate.get(k)!,
      anchorTime: anchorTime.get(k),
      pendingNet: p,
      projected: round(bal + p),
    });
  }
  return out;
}

/**
 * กระทบยอดจาก balanceAfter: เดินไล่แต่ละบัญชีตามเวลา หาช่วงที่ยอดคงเหลือเปลี่ยนเกินกว่ารายการอธิบายได้
 *
 * หลักการ: ระหว่าง "จุดที่รู้ยอดคงเหลือ" (anchor) สองจุดติดกัน
 *   ยอดที่ควรจะเป็น = ยอดก่อนหน้า + ผลรวมเงินเข้า/ออกของรายการที่บันทึกไว้ระหว่างนั้น
 *   ถ้ายอดจริง ≠ ที่ควรจะเป็น → ส่วนต่าง = เงินเข้า(+)/ออก(−) ที่ไม่มีหลักฐาน เกิดในช่วงเวลานั้น
 *
 * คำนวณสดทุกครั้ง (ไม่บันทึกถาวร) — เมื่อ statement จริงมาเติมรายการที่ขาด ช่องว่างจะหด/หายเอง
 *
 * @param tol ค่าความคลาดเคลื่อนที่ยอมรับ (บาท) — กันสะสมปัดเศษ
 * @param transferWindowDays กรอบวันจับคู่ขาเข้า-ออกที่น่าจะเป็นการโอนตัวเอง
 */
export function reconcileBalances(
  txns: Transaction[],
  opts: { tol?: number; transferWindowDays?: number } = {},
): ReconcileResult {
  const { tol = 1, transferWindowDays = 2 } = opts;

  const byWallet = new Map<string, Transaction[]>();
  for (const t of txns) {
    const k = walletKey(t);
    (byWallet.get(k) ?? byWallet.set(k, []).get(k)!).push(t);
  }

  const flows: InferredFlow[] = [];
  for (const list of byWallet.values()) {
    const sorted = [...list].sort(byTime);
    let prev: Transaction | null = null; // anchor ก่อนหน้า (มี balanceAfter)
    let sumSince = 0; // ผลรวมเงินเคลื่อนไหวที่บันทึกไว้หลัง anchor ก่อนหน้า
    for (const t of sorted) {
      const signed = t.direction === 'in' ? t.amount : -t.amount;
      if (t.balanceAfter == null) {
        if (prev) sumSince += signed; // รายการที่ไม่รู้ยอด (เช่น สลิป) ก็นับรวมไว้
        continue;
      }
      if (prev && prev.balanceAfter != null) {
        sumSince += signed; // รวมผลของรายการ anchor ตัวนี้เองด้วย (ยอดเป็น "หลัง" รายการ)
        const expected = prev.balanceAfter + sumSince;
        const gap = round(t.balanceAfter - expected);
        if (Math.abs(gap) > tol) {
          flows.push({
            id: `inf-${prev.id}-${t.id}`,
            source: t.source,
            account: t.account,
            direction: gap > 0 ? 'in' : 'out',
            amount: Math.abs(gap),
            afterId: prev.id,
            afterDate: prev.date,
            afterTime: prev.time,
            beforeId: t.id,
            beforeDate: t.date,
            beforeTime: t.time,
            likelyTransfer: false,
          });
        }
      }
      prev = t;
      sumSince = 0;
    }
  }

  // เดา "การโอนระหว่างบัญชีตัวเอง" แบบ best-effort: จับคู่ขาออก↔ขาเข้า จำนวนใกล้กัน เวลาใกล้กัน
  // (ย้ายเงินไปอีกบัญชีแล้วกลับ / ไปอีกกระเป๋า) — ทำเครื่องหมายไว้ ไม่นับเป็นเงินภายนอกจริง
  const outs = flows.filter((f) => f.direction === 'out');
  const ins = flows.filter((f) => f.direction === 'in');
  for (const o of outs) {
    if (o.likelyTransfer) continue;
    const match = ins.find(
      (i) =>
        !i.likelyTransfer &&
        Math.abs(i.amount - o.amount) <= Math.max(tol, o.amount * 0.1) &&
        Math.abs(diffDays(o.beforeDate, i.beforeDate)) <= transferWindowDays,
    );
    if (match) {
      o.likelyTransfer = true;
      match.likelyTransfer = true;
    }
  }

  const external = flows.filter((f) => !f.likelyTransfer);
  const inferredIncome = round(
    external.filter((f) => f.direction === 'in').reduce((a, f) => a + f.amount, 0),
  );
  const inferredExpense = round(
    external.filter((f) => f.direction === 'out').reduce((a, f) => a + f.amount, 0),
  );

  return { flows, external, inferredIncome, inferredExpense };
}
