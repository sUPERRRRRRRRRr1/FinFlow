import type { CategoryId, Source, Transaction } from '@finflow/shared';
import { enumerateDays, weekdayOf } from '@finflow/shared';

/** PRNG แบบ deterministic (mulberry32) เพื่อให้ข้อมูลเดโมคงที่ทุกครั้ง */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20690811);
const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
const chance = (p: number) => rng() < p;
const baht = (lo: number, hi: number, step = 1) => Math.round(rand(lo, hi) / step) * step;

/** เลขบัญชี/พร้อมเพย์ปิดบัง แบบ deterministic ต่อชื่อผู้รับ (ร้านเดียวกัน = บัญชีเดียวกัน) */
function acct(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;
  return `xxx-x-x${String(h % 10000).padStart(4, '0')}-${String(h % 10)}`;
}

let counter = 0;
function mk(p: {
  date: string;
  amount: number;
  direction: 'in' | 'out';
  counterparty: string;
  source: Source;
  category: CategoryId;
  time?: string;
  balanceAfter?: number;
}): Transaction {
  return {
    id: `seed-${(counter++).toString().padStart(5, '0')}`,
    rawDesc: p.counterparty,
    time: p.time ?? `${String(Math.floor(rand(7, 22))).padStart(2, '0')}:${String(Math.floor(rand(0, 60))).padStart(2, '0')}`,
    ...p,
  };
}

const FOOD = ['ร้านข้าวมันไก่', 'Café Amazon', 'Starbucks', 'ก๋วยเตี๋ยวเรือ', 'ชาบูชิ', 'KFC', 'McDonald’s', 'ชานมไข่มุก', '7-Eleven', 'ส้มตำแซ่บ', 'Grab Food', 'LINE MAN', 'ร้านกาแฟหน้าปากซอย'];
const TRANSPORT = ['Grab', 'Bolt', 'BTS', 'MRT', 'วินมอเตอร์ไซค์', 'ปตท. เติมน้ำมัน', 'Bangchak', 'Easy Pass'];
const SHOP = ['Shopee', 'Lazada', 'Tops Market', 'Big C', 'Lotus’s', 'Uniqlo', 'Watsons', 'TikTok Shop', 'IKEA'];
const FUN = ['โรงหนัง Major', 'Steam', 'Garena', 'คาราโอเกะ', 'สวนสนุก'];
const HEALTH = ['ร้านขายยา', 'คลินิกหมอฟัน', 'โรงพยาบาลกรุงเทพ', 'Boots'];

/**
 * สร้างชุดข้อมูลตัวอย่างเสมือนจริง 6 เดือน (ธ.ค. 2568 – พ.ค. 2569) แบบหลายกระเป๋า
 * ออกแบบให้มีครบทุกปรากฏการณ์เพื่อโชว์ทุกฟีเจอร์:
 *  - เงินเดือนเข้า KBank, ค่าใช้จ่ายประจำวันหลายหมวด
 *  - รายจ่ายประจำ/subscription (Netflix, Spotify, ฟิตเนส, เน็ต, มือถือ)
 *  - การโอนข้ามกระเป๋า (KBank → TrueMoney / Make) เพื่อโชว์ transfer matching
 *  - รายการซ้ำ (statement + สลิป) เพื่อโชว์ deduplication
 *  - รายจ่ายผิดปกติ (ซื้อมือถือใหม่ มี.ค.) เพื่อโชว์ outlier + category spike
 */
export function generateDemoTransactions(): Transaction[] {
  const txns: Transaction[] = [];
  const months = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

  for (const m of months) {
    const [y, mm] = m.split('-').map(Number);
    const first = `${m}-01`;
    const lastDay = new Date(Date.UTC(y!, mm!, 0)).getUTCDate();
    const last = `${m}-${String(lastDay).padStart(2, '0')}`;
    const days = enumerateDays(first, last);

    // ── รายรับ: เงินเดือนเข้า KBank วันที่ 25 ──
    txns.push(
      mk({ date: `${m}-25`, amount: 45000, direction: 'in', counterparty: 'บริษัท ฟินเทค จำกัด (เงินเดือน)', source: 'kbank', category: 'income', time: '00:05' }),
    );
    // รายได้เสริมบางเดือน
    if (chance(0.4)) {
      txns.push(mk({ date: `${m}-${String(Math.floor(rand(8, 20))).padStart(2, '0')}`, amount: baht(1500, 6000, 100), direction: 'in', counterparty: 'งานฟรีแลนซ์', source: 'kbank', category: 'income' }));
    }

    // ── บิล/สาธารณูปโภค + subscription (ประจำทุกเดือน) ──
    txns.push(mk({ date: `${m}-01`, amount: 8000, direction: 'out', counterparty: 'ค่าเช่าคอนโด', source: 'kbank', category: 'bills' }));
    txns.push(mk({ date: `${m}-05`, amount: baht(700, 1600, 10), direction: 'out', counterparty: 'การไฟฟ้านครหลวง (MEA)', source: 'kbank', category: 'bills' }));
    txns.push(mk({ date: `${m}-05`, amount: baht(150, 320, 5), direction: 'out', counterparty: 'การประปานครหลวง', source: 'kbank', category: 'bills' }));
    txns.push(mk({ date: `${m}-06`, amount: 599, direction: 'out', counterparty: 'AIS Fibre อินเทอร์เน็ต', source: 'kbank', category: 'bills' }));
    txns.push(mk({ date: `${m}-06`, amount: baht(400, 700, 10), direction: 'out', counterparty: 'AIS ค่าโทรศัพท์', source: 'kbank', category: 'bills' }));
    txns.push(mk({ date: `${m}-05`, amount: 419, direction: 'out', counterparty: 'Netflix', source: 'kbank', category: 'entertainment' }));
    txns.push(mk({ date: `${m}-10`, amount: 149, direction: 'out', counterparty: 'Spotify Premium', source: 'kbank', category: 'entertainment' }));
    txns.push(mk({ date: `${m}-01`, amount: 1200, direction: 'out', counterparty: 'Fitness First', source: 'kbank', category: 'health' }));

    // ── ออม/ลงทุน ประจำเดือน ──
    txns.push(mk({ date: `${m}-26`, amount: 3000, direction: 'out', counterparty: 'กองทุนรวม SSF', source: 'kbank', category: 'savings' }));

    // ── โอนข้ามกระเป๋า: เติม TrueMoney 2-3 ครั้ง/เดือน (โชว์ transfer matching) ──
    const topups = Math.floor(rand(2, 4));
    for (let i = 0; i < topups; i++) {
      const d = `${m}-${String(Math.floor(rand(2, 27))).padStart(2, '0')}`;
      const amt = baht(500, 1500, 100);
      txns.push(mk({ date: d, amount: amt, direction: 'out', counterparty: 'เติมเงิน TrueMoney Wallet', source: 'kbank', category: 'transfer' }));
      txns.push(mk({ date: d, amount: amt, direction: 'in', counterparty: 'รับโอนจาก KBank', source: 'truemoney', category: 'income' }));
    }
    // โอนเข้า Make เพื่อแยกเงินใช้จ่าย
    if (chance(0.7)) {
      const d = `${m}-${String(Math.floor(rand(2, 10))).padStart(2, '0')}`;
      const amt = baht(2000, 4000, 500);
      txns.push(mk({ date: d, amount: amt, direction: 'out', counterparty: 'โอนเข้า Make by KBank', source: 'kbank', category: 'transfer' }));
      txns.push(mk({ date: d, amount: amt, direction: 'in', counterparty: 'รับโอนจาก KBank', source: 'make', category: 'income' }));
    }

    // ── รายจ่ายประจำวัน ──
    for (const day of days) {
      const wd = weekdayOf(day);
      // อาหาร (กระเป๋าเล็กๆ TrueMoney/Make สลับ KBank)
      if (chance(0.85)) {
        const src: Source = pick(['truemoney', 'kbank', 'make', 'truemoney']);
        txns.push(mk({ date: day, amount: baht(45, 220, 5), direction: 'out', counterparty: pick(FOOD), source: src, category: 'food' }));
      }
      if (chance(0.3)) {
        txns.push(mk({ date: day, amount: baht(30, 160, 5), direction: 'out', counterparty: pick(FOOD), source: pick(['truemoney', 'make']), category: 'food' }));
      }
      // เดินทาง
      if (chance(0.5)) {
        txns.push(mk({ date: day, amount: baht(25, 190, 1), direction: 'out', counterparty: pick(TRANSPORT), source: pick(['truemoney', 'kbank']), category: 'transport' }));
      }
      // ช้อปปิ้ง (วันหยุดบ่อยขึ้น)
      if (chance(wd === 0 || wd === 6 ? 0.22 : 0.1)) {
        txns.push(mk({ date: day, amount: baht(150, 1800, 10), direction: 'out', counterparty: pick(SHOP), source: 'kbank', category: 'shopping' }));
      }
      // บันเทิง
      if (chance(0.06)) {
        txns.push(mk({ date: day, amount: baht(60, 600, 10), direction: 'out', counterparty: pick(FUN), source: pick(['kbank', 'truemoney']), category: 'entertainment' }));
      }
      // สุขภาพ
      if (chance(0.025)) {
        txns.push(mk({ date: day, amount: baht(120, 900, 10), direction: 'out', counterparty: pick(HEALTH), source: 'kbank', category: 'health' }));
      }
    }

    // ── ร้านที่ "ชื่อบัญชีเป็นชื่อคน" (keyword/AI จัดหมวดไม่ได้ → โชว์ฟีเจอร์ตั้งกฎร้านค้า) ──
    const visits = Math.floor(rand(2, 4));
    for (let i = 0; i < visits; i++) {
      txns.push(
        mk({ date: `${m}-${String(Math.floor(rand(2, 27))).padStart(2, '0')}`, amount: baht(45, 95, 5), direction: 'out', counterparty: 'นาย วิรัช ขายดี', source: pick(['truemoney', 'kbank']), category: 'other' }),
      );
    }

    // ── การศึกษา: คอร์สออนไลน์บางเดือน ──
    if (chance(0.4)) {
      txns.push(mk({ date: `${m}-${String(Math.floor(rand(8, 24))).padStart(2, '0')}`, amount: baht(590, 1990, 10), direction: 'out', counterparty: 'คอร์สออนไลน์ Udemy', source: 'kbank', category: 'education' }));
    }
  }

  // ── รายจ่ายผิดปกติ: ซื้อมือถือใหม่ มี.ค. 2569 (outlier + shopping spike) ──
  txns.push(mk({ date: '2026-03-15', amount: 32900, direction: 'out', counterparty: 'Power Buy (iPhone)', source: 'kbank', category: 'shopping', time: '14:22' }));

  // ── รายการซ้ำ: สลิปที่ตรงกับ statement (โชว์ deduplication) ──
  const foodSamples = txns.filter((t) => t.category === 'food' && t.source === 'kbank').slice(0, 3);
  for (const f of foodSamples) {
    txns.push(
      mk({ date: f.date, amount: f.amount, direction: 'out', counterparty: f.counterparty, source: 'slip', category: 'food', time: f.time }),
    );
  }

  // แนบเลขบัญชีให้ทุกรายการ (ร้านเดียวกัน = บัญชีเดียวกัน) สำหรับคอลัมน์ผู้รับ + การตั้งกฎด้วยบัญชี
  for (const t of txns) {
    if (!t.accountRef) t.accountRef = acct(t.counterparty);
  }

  return txns;
}
