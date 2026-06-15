import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Budget, MerchantRule } from '@finflow/shared';
import type { Transaction, CategoryId, Direction, Source } from '@finflow/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'finflow.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,
    date          TEXT NOT NULL,
    time          TEXT,
    amount        REAL NOT NULL,
    direction     TEXT NOT NULL,
    counterparty  TEXT NOT NULL,
    source        TEXT NOT NULL,
    category      TEXT NOT NULL,
    raw_desc      TEXT,
    balance_after REAL,
    fingerprint   TEXT,
    is_transfer   INTEGER DEFAULT 0,
    transfer_group TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);

  CREATE TABLE IF NOT EXISTS budgets (
    category TEXT PRIMARY KEY,
    limit_amount REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS merchant_rules (
    id          TEXT PRIMARY KEY,
    match_type  TEXT NOT NULL,
    match_value TEXT NOT NULL,
    alias       TEXT,
    category    TEXT NOT NULL
  );
`);

// migration: เพิ่มคอลัมน์ใหม่กับฐานข้อมูลเดิม (ไม่มี = เพิ่ม, มีแล้ว = ข้าม)
for (const col of ['account_ref TEXT', 'alias TEXT', 'auto_category TEXT']) {
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN ${col}`);
  } catch {
    /* คอลัมน์มีอยู่แล้ว */
  }
}

interface Row {
  id: string;
  date: string;
  time: string | null;
  amount: number;
  direction: string;
  counterparty: string;
  source: string;
  category: string;
  raw_desc: string | null;
  balance_after: number | null;
  fingerprint: string | null;
  is_transfer: number;
  transfer_group: string | null;
  account_ref: string | null;
  alias: string | null;
  auto_category: string | null;
}

function rowToTxn(r: Row): Transaction {
  return {
    id: r.id,
    date: r.date,
    time: r.time ?? undefined,
    amount: r.amount,
    direction: r.direction as Direction,
    counterparty: r.counterparty,
    source: r.source as Source,
    category: r.category as CategoryId,
    rawDesc: r.raw_desc ?? undefined,
    balanceAfter: r.balance_after ?? undefined,
    fingerprint: r.fingerprint ?? undefined,
    isTransfer: !!r.is_transfer,
    transferGroup: r.transfer_group ?? undefined,
    accountRef: r.account_ref ?? undefined,
    alias: r.alias ?? undefined,
    autoCategory: (r.auto_category as CategoryId) ?? undefined,
  };
}

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO transactions
    (id, date, time, amount, direction, counterparty, source, category,
     raw_desc, balance_after, fingerprint, is_transfer, transfer_group, account_ref, alias, auto_category)
  VALUES
    (@id, @date, @time, @amount, @direction, @counterparty, @source, @category,
     @raw_desc, @balance_after, @fingerprint, @is_transfer, @transfer_group, @account_ref, @alias, @auto_category)
`);

export function insertTransactions(txns: Transaction[]): number {
  const tx = db.transaction((items: Transaction[]) => {
    for (const t of items) {
      insertStmt.run({
        id: t.id,
        date: t.date,
        time: t.time ?? null,
        amount: t.amount,
        direction: t.direction,
        counterparty: t.counterparty,
        source: t.source,
        category: t.category,
        raw_desc: t.rawDesc ?? null,
        balance_after: t.balanceAfter ?? null,
        fingerprint: t.fingerprint ?? null,
        is_transfer: t.isTransfer ? 1 : 0,
        transfer_group: t.transferGroup ?? null,
        account_ref: t.accountRef ?? null,
        alias: t.alias ?? null,
        auto_category: t.autoCategory ?? t.category,
      });
    }
    return items.length;
  });
  return tx(txns);
}

export function getAllTransactions(): Transaction[] {
  const rows = db.prepare('SELECT * FROM transactions ORDER BY date ASC, time ASC').all() as Row[];
  return rows.map(rowToTxn);
}

export function countTransactions(): number {
  const r = db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number };
  return r.c;
}

export function clearTransactions(): void {
  db.exec('DELETE FROM transactions');
}

export function updateCategory(id: string, category: CategoryId): void {
  // แก้หมวดเองถือเป็น baseline ใหม่ (ตั้ง auto_category ด้วย เพื่อให้ลบกฒแล้วกลับมาที่ค่านี้)
  db.prepare('UPDATE transactions SET category = ?, auto_category = ? WHERE id = ?').run(category, category, id);
}

export function getBudgets(): Budget[] {
  const rows = db.prepare('SELECT category, limit_amount FROM budgets').all() as {
    category: string;
    limit_amount: number;
  }[];
  return rows.map((r) => ({ category: r.category as CategoryId, limit: r.limit_amount }));
}

export function setBudget(category: CategoryId, limit: number): void {
  if (limit <= 0) {
    db.prepare('DELETE FROM budgets WHERE category = ?').run(category);
  } else {
    db.prepare(
      'INSERT OR REPLACE INTO budgets (category, limit_amount) VALUES (?, ?)',
    ).run(category, limit);
  }
}

export function getRules(): MerchantRule[] {
  const rows = db.prepare('SELECT * FROM merchant_rules').all() as {
    id: string;
    match_type: string;
    match_value: string;
    alias: string | null;
    category: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    matchType: r.match_type as 'account' | 'name',
    matchValue: r.match_value,
    alias: r.alias ?? undefined,
    category: r.category as CategoryId,
  }));
}

export function upsertRule(rule: MerchantRule): void {
  db.prepare(
    `INSERT OR REPLACE INTO merchant_rules (id, match_type, match_value, alias, category)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(rule.id, rule.matchType, rule.matchValue, rule.alias ?? null, rule.category);
}

export function deleteRule(id: string): void {
  db.prepare('DELETE FROM merchant_rules WHERE id = ?').run(id);
}

export function getMeta(key: string): string | undefined {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return r?.value;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}
