import type { Transaction } from '../types.js';
import { walletKey } from '../types.js';
import { CATEGORY_META } from '../categories.js';
import { round } from './descriptive.js';
import { isRealIncome } from './timeseries.js';

export type SankeyNodeType = 'income' | 'wallet' | 'expense' | 'savings' | 'leftover' | 'carryover';

export interface SankeyNode {
  id: string;
  label: string;
  type: SankeyNodeType;
  color: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** ผลตรวจสมดุลการไหล (flow conservation) */
  balance: BalanceCheck;
}

export interface BalanceCheck {
  balanced: boolean;
  /** ความไม่สมดุลสูงสุดที่พบในโนดใดๆ (บาท) */
  maxImbalance: number;
  perNode: { id: string; inflow: number; outflow: number; diff: number }[];
}

const SOURCE_LABEL: Record<string, string> = {
  kbank: 'KBank',
  make: 'Make by KBank',
  truemoney: 'TrueMoney',
  manual: 'บันทึกเอง',
  slip: 'สลิป',
};
const WALLET_COLOR = '#0f766e';
const SEP = '|||';

/** ตัดวงจร (cycle) ของการโอนข้ามกระเป๋า เพื่อให้กราฟเป็น DAG ที่ d3-sankey วาดได้ — เก็บ flow ใหญ่ก่อน */
function removeCycles(edges: { from: string; to: string; value: number }[]) {
  const adj = new Map<string, Set<string>>();
  const reaches = (a: string, b: string, seen = new Set<string>()): boolean => {
    if (a === b) return true;
    if (seen.has(a)) return false;
    seen.add(a);
    for (const n of adj.get(a) ?? []) if (reaches(n, b, seen)) return true;
    return false;
  };
  const kept: typeof edges = [];
  for (const e of [...edges].sort((x, y) => y.value - x.value)) {
    if (reaches(e.to, e.from)) continue; // ใส่แล้วจะเกิดวงจร → ข้าม
    kept.push(e);
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)!.add(e.to);
  }
  return kept;
}

/**
 * สร้างกราฟ Sankey ข้ามกระเป๋า (multi-stage):
 *   รายรับ → กระเป๋า → (โอนข้ามกระเป๋า) → หมวดรายจ่าย / ออม / คงเหลือ
 * เช่น เงินเดือน → KBank → TrueMoney → อาหาร (7-Eleven)
 *
 * ใช้หลัก flow conservation: ทุกกระเป๋าต้องมีเงินเข้า = เงินออก
 * (เติม "คงเหลือ" เมื่อเงินเข้ามากกว่าออก, เติม "ยอดยกมา" เมื่อจ่ายเกินที่เข้า)
 */
export function buildSankey(txns: Transaction[], walletLabels: Record<string, string> = {}): SankeyGraph {
  const nodes: SankeyNode[] = [];
  const seen = new Set<string>();
  const addNode = (n: SankeyNode) => {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  };
  // ป้ายกระเป๋า: ใช้ชื่อเล่นที่ผู้ใช้ตั้ง (walletLabels) ก่อน ไม่งั้น fallback ตามชนิดกระเป๋า/คีย์
  const addWallet = (w: string) =>
    addNode({ id: `wallet:${w}`, label: walletLabels[w] ?? SOURCE_LABEL[w] ?? w, type: 'wallet', color: WALLET_COLOR });
  const links: SankeyLink[] = [];
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  // 1) รายรับ แยกตามผู้จ่าย+กระเป๋าที่รับ
  const incomeRaw = new Map<string, number>();
  for (const t of txns) {
    if (isRealIncome(t)) add(incomeRaw, `${t.counterparty}${SEP}${walletKey(t)}`, t.amount);
  }
  // ยุบผู้โอนเข้ารายย่อย (< 4% ของรายรับรวม) เป็น "รับโอนอื่นๆ" ต่อกระเป๋า
  // เพื่อไม่ให้ฝั่งซ้ายมีโนดผู้โอนหลายสิบคน (เช่น statement ย้อนหลังทั้งปี) จนรก
  const incomeGrand = [...incomeRaw.values()].reduce((a, b) => a + b, 0);
  const incomeByNameWallet = new Map<string, number>();
  for (const [key, amt] of incomeRaw) {
    const [, wallet] = key.split(SEP);
    const k = amt < incomeGrand * 0.04 ? `รับโอนอื่นๆ${SEP}${wallet}` : key;
    add(incomeByNameWallet, k, amt);
  }

  // 2) การโอนข้ามกระเป๋า: รวมเป็น from→to แล้ว net + ตัดวงจร
  const groups = new Map<string, { from?: string; to?: string; amount: number }>();
  for (const t of txns) {
    if (!t.isTransfer || !t.transferGroup) continue;
    const g = groups.get(t.transferGroup) ?? { amount: 0 };
    if (t.direction === 'out') {
      g.from = walletKey(t);
      g.amount = t.amount;
    } else {
      g.to = walletKey(t);
    }
    groups.set(t.transferGroup, g);
  }
  const pairFlow = new Map<string, number>();
  for (const g of groups.values()) {
    if (!g.from || !g.to || g.from === g.to) continue;
    add(pairFlow, `${g.from}${SEP}${g.to}`, g.amount);
  }
  // โอนเข้าบัญชีตัวเองที่ตรวจจากเลขบัญชี (รู้ปลายทางแต่ยังไม่มีคู่ — statement มาฝั่งเดียว)
  // วาดเป็นกระเป๋า→กระเป๋าด้วย เพื่อไม่ให้ยอดออกหายจากกราฟ (กระเป๋าต้นทางสมดุล)
  for (const t of txns) {
    if (!t.isTransfer || t.transferGroup || !t.transferTo) continue;
    const self = walletKey(t);
    if (self === t.transferTo) continue;
    if (t.direction === 'out') add(pairFlow, `${self}${SEP}${t.transferTo}`, t.amount);
    else add(pairFlow, `${t.transferTo}${SEP}${self}`, t.amount);
  }
  const handled = new Set<string>();
  const netEdges: { from: string; to: string; value: number }[] = [];
  for (const [k, v] of pairFlow) {
    const [a, b] = k.split(SEP);
    const rk = `${b}${SEP}${a}`;
    if (handled.has(k) || handled.has(rk)) continue;
    handled.add(k);
    handled.add(rk);
    const net = v - (pairFlow.get(rk) ?? 0);
    if (net > 0) netEdges.push({ from: a!, to: b!, value: net });
    else if (net < 0) netEdges.push({ from: b!, to: a!, value: -net });
  }
  const transferEdges = removeCycles(netEdges);

  // 3) รายจ่ายต่อ (กระเป๋า, หมวด) และเงินออมต่อกระเป๋า
  let expWalletCat = new Map<string, number>();
  const savingsByWallet = new Map<string, number>();
  for (const t of txns) {
    if (t.direction !== 'out' || t.isTransfer) continue;
    if (t.category === 'savings') add(savingsByWallet, walletKey(t), t.amount);
    else add(expWalletCat, `${walletKey(t)}${SEP}${t.category}`, t.amount);
  }

  // ยุบหมวดเล็ก (< 4% ของรายจ่ายรวม) รวมเป็น 'other' เพื่อลดเส้นบางๆ ที่ทำให้ Sankey รก
  const catTotal = new Map<string, number>();
  for (const [key, amt] of expWalletCat) add(catTotal, key.split(SEP)[1]!, amt);
  const grand = [...catTotal.values()].reduce((a, b) => a + b, 0);
  const small = new Set(
    [...catTotal].filter(([c, v]) => c !== 'other' && v < grand * 0.04).map(([c]) => c),
  );
  if (small.size > 0) {
    const merged = new Map<string, number>();
    for (const [key, amt] of expWalletCat) {
      const [w, cat] = key.split(SEP);
      add(merged, `${w}${SEP}${small.has(cat!) ? 'other' : cat}`, amt);
    }
    expWalletCat = merged;
  }

  // ── สร้าง node/link ──
  for (const [key, amount] of incomeByNameWallet) {
    if (amount <= 0) continue;
    const [name, wallet] = key.split(SEP);
    addNode({ id: `income:${name}`, label: name!, type: 'income', color: '#22c55e' });
    addWallet(wallet!);
    links.push({ source: `income:${name}`, target: `wallet:${wallet}`, value: round(amount) });
  }
  for (const e of transferEdges) {
    addWallet(e.from);
    addWallet(e.to);
    links.push({ source: `wallet:${e.from}`, target: `wallet:${e.to}`, value: round(e.value) });
  }
  for (const [key, amount] of expWalletCat) {
    if (amount <= 0) continue;
    const [wallet, cat] = key.split(SEP);
    addWallet(wallet!);
    const meta = CATEGORY_META[cat as keyof typeof CATEGORY_META];
    addNode({ id: `cat:${cat}`, label: meta?.label ?? cat!, type: 'expense', color: meta?.color ?? '#64748b' });
    links.push({ source: `wallet:${wallet}`, target: `cat:${cat}`, value: round(amount) });
  }
  let savingsTotal = 0;
  for (const [wallet, amount] of savingsByWallet) {
    if (amount <= 0) continue;
    savingsTotal += amount;
    addWallet(wallet);
    links.push({ source: `wallet:${wallet}`, target: 'savings:ออม', value: round(amount) });
  }
  if (savingsTotal > 0)
    addNode({ id: 'savings:ออม', label: 'ออม/ลงทุน', type: 'savings', color: CATEGORY_META.savings.color });

  // ── ปรับสมดุลแต่ละกระเป๋า: เพิ่ม คงเหลือ / ยอดยกมา ──
  const win = new Map<string, number>();
  const wout = new Map<string, number>();
  for (const l of links) {
    if (l.target.startsWith('wallet:')) add(win, l.target.slice(7), l.value);
    if (l.source.startsWith('wallet:')) add(wout, l.source.slice(7), l.value);
  }
  const wallets = new Set<string>([...win.keys(), ...wout.keys()]);
  for (const w of wallets) {
    const diff = round((win.get(w) ?? 0) - (wout.get(w) ?? 0));
    if (diff > 0.5) {
      addNode({ id: 'leftover:คงเหลือ', label: 'เงินคงเหลือ', type: 'leftover', color: '#0891b2' });
      links.push({ source: `wallet:${w}`, target: 'leftover:คงเหลือ', value: diff });
    } else if (diff < -0.5) {
      addNode({ id: 'carryover:ยอดยกมา', label: 'เงินเก็บ/ยอดยกมา', type: 'carryover', color: '#a16207' });
      links.push({ source: 'carryover:ยอดยกมา', target: `wallet:${w}`, value: -diff });
    }
  }

  return { nodes, links, balance: checkBalance(nodes, links) };
}

/**
 * ตรวจสมดุลการไหลของทุก "กระเป๋า" (โนดกลาง) — เงินเข้า = เงินออก
 * (โนดต้นทาง income/carryover และปลายทาง expense/savings/leftover ไม่ต้องสมดุล)
 */
export function checkBalance(nodes: SankeyNode[], links: SankeyLink[], tolerance = 0.5): BalanceCheck {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of links) {
    outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
    inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
  }
  const perNode = nodes
    .filter((n) => n.type === 'wallet')
    .map((n) => {
      const i = inflow.get(n.id) ?? 0;
      const o = outflow.get(n.id) ?? 0;
      return { id: n.id, inflow: round(i), outflow: round(o), diff: round(i - o) };
    });
  const maxImbalance = perNode.reduce((m, p) => Math.max(m, Math.abs(p.diff)), 0);
  return { balanced: maxImbalance <= tolerance, maxImbalance, perNode };
}
