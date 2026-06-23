import { useEffect, useMemo, useState } from 'react';
import { ALL_CATEGORIES, CATEGORY_META, displayName, monthKey, thaiMonthLabel, walletKey } from '@finflow/shared';
import type { CategoryId, MerchantRule, Transaction } from '@finflow/shared';
import { useApi, apiSend } from '../lib/api';
import type { AccountsResponse } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb } from '../lib/format';

const SOURCE_LABEL: Record<string, string> = {
  kbank: 'KBank',
  make: 'Make',
  truemoney: 'TrueMoney',
  manual: 'บันทึกเอง',
  slip: 'สลิป',
};

export default function Transactions() {
  const state = useApi<{ transactions: Transaction[] }>('/transactions');
  const rulesState = useApi<{ rules: MerchantRule[] }>('/rules');
  const accountsState = useApi<AccountsResponse>('/accounts');
  const [rows, setRows] = useState<Transaction[]>([]);
  const [month, setMonth] = useState('all');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState('all');
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [ruleFor, setRuleFor] = useState<Transaction | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => setRows(state.data?.transactions ?? []), [state.data]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const refetchAll = () => {
    state.refetch();
    rulesState.refetch();
  };

  // ป้ายกระเป๋า/บัญชี: ใช้ชื่อเล่นที่ผู้ใช้ตั้งไว้ (แยกหลายบัญชีในแบงก์เดียวกัน)
  const walletLabel = useMemo(() => {
    const byId = new Map((accountsState.data?.accounts ?? []).map((a) => [a.id, a]));
    return (t: Transaction) => {
      const key = walletKey(t);
      const base = SOURCE_LABEL[t.source] ?? t.source;
      const nn = byId.get(key)?.nickname;
      return nn ? `${base} · ${nn}` : key === t.source ? base : `${base} · ${key}`;
    };
  }, [accountsState.data]);

  const months = useMemo(() => [...new Set(rows.map((t) => monthKey(t.date)))].sort().reverse(), [rows]);
  const wallets = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of rows) m.set(walletKey(t), walletLabel(t));
    return [...m.entries()];
  }, [rows, walletLabel]);

  const filtered = useMemo(() => {
    return rows
      .filter((t) => (month === 'all' ? true : monthKey(t.date) === month))
      .filter((t) => (source === 'all' ? true : walletKey(t) === source))
      .filter((t) => (category === 'all' ? true : t.category === category))
      .filter((t) =>
        q ? (displayName(t) + t.counterparty + (t.accountRef ?? '')).toLowerCase().includes(q.toLowerCase()) : true,
      )
      .sort((a, b) => (a.date === b.date ? (a.time ?? '').localeCompare(b.time ?? '') : a.date.localeCompare(b.date)))
      .reverse();
  }, [rows, month, source, category, q]);

  const sums = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      if (t.isTransfer) continue;
      if (t.direction === 'in') income += t.amount;
      else if (t.category !== 'savings') expense += t.amount;
    }
    return { income, expense };
  }, [filtered]);

  const changeCategory = async (id: string, cat: CategoryId) => {
    setRows((rs) => rs.map((t) => (t.id === id ? { ...t, category: cat } : t)));
    await apiSend(`/transactions/${id}/category`, 'PATCH', { category: cat });
  };

  const deleteRule = async (id: string) => {
    const r = await apiSend<{ affected: number }>(`/rules/${id}`, 'DELETE');
    setToast(`ลบกฎแล้ว · คำนวณใหม่ ${r.affected} รายการ`);
    refetchAll();
  };

  const rules = rulesState.data?.rules ?? [];

  return (
    <>
      <PageHead
        title="รายการรายรับ–รายจ่าย"
        desc="สมุดบัญชีรวมทุกกระเป๋า ที่ระบบบันทึก/จัดหมวดให้อัตโนมัติ — แก้หมวด เพิ่มรายการ หรือตั้งกฎร้านค้าได้"
        action={
          <div className="row" style={{ gap: 8 }}>
            <a className="btn" href="/api/export/csv">⬇️ CSV</a>
            <button className="btn" onClick={() => setShowRules((s) => !s)}>⚙️ กฎร้านค้า ({rules.length})</button>
            <button className="btn primary" onClick={() => setShowAdd((s) => !s)}>＋ เพิ่มรายการ</button>
          </div>
        }
      />

      {toast && (
        <div className="card" style={{ borderLeft: '4px solid var(--good)', marginBottom: 14, padding: '12px 16px' }}>
          ✅ {toast} — <span className="muted">Sankey / แนวโน้มหมวด / คะแนนสุขภาพ อัปเดตตามแล้ว</span>
        </div>
      )}

      <Async state={state} height={400}>
        {() => (
          <div className="grid" style={{ gap: 16 }}>
            {showAdd && <AddForm onAdded={() => { setShowAdd(false); refetchAll(); }} />}

            {showRules && (
              <div className="card">
                <h3>กฎร้านค้าที่ตั้งไว้</h3>
                <div className="sub">บอกระบบว่า "บัญชี/ผู้รับนี้คือร้านอะไร หมวดไหน" — ใช้กับทุกรายการที่ตรงกัน</div>
                {rules.length === 0 ? (
                  <div className="muted">ยังไม่มีกฎ — กด "ตั้งกฎ" ที่รายการใดก็ได้เพื่อเริ่ม</div>
                ) : (
                  rules.map((r) => (
                    <div key={r.id} className="row between" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 13.5 }}>
                        <span className="badge" style={{ marginRight: 8 }}>{r.matchType === 'account' ? '🏦 บัญชี' : '🔤 ชื่อ'}</span>
                        <span className="mono" style={{ fontSize: 12 }}>{r.matchValue}</span>
                        {' → '}
                        <b>{r.alias || CATEGORY_META[r.category].label}</b>
                        <span className="muted"> · {CATEGORY_META[r.category].icon} {CATEGORY_META[r.category].label}</span>
                      </div>
                      <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteRule(r.id)}>ลบ</button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ตัวกรอง */}
            <div className="card">
              <div className="row wrap" style={{ gap: 10 }}>
                <input placeholder="🔍 ค้นหาร้าน/บัญชี…" value={q} onChange={(e) => setQ(e.target.value)} style={inputStyle(200)} />
                <select value={month} onChange={(e) => setMonth(e.target.value)} style={inputStyle()}>
                  <option value="all">ทุกเดือน</option>
                  {months.map((m) => <option key={m} value={m}>{thaiMonthLabel(m)}</option>)}
                </select>
                <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle()}>
                  <option value="all">ทุกกระเป๋า</option>
                  {wallets.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle()}>
                  <option value="all">ทุกหมวด</option>
                  {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
                </select>
                <div className="spacer" />
                <div className="row" style={{ gap: 14, fontSize: 13 }}>
                  <span className="muted">{filtered.length} รายการ</span>
                  <span className="down">เข้า {thb(sums.income)}</span>
                  <span className="up">ออก {thb(sums.expense)}</span>
                </div>
              </div>
            </div>

            {/* ตาราง */}
            <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
              <table className="tbl" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 18 }}>วันที่</th>
                    <th>ผู้รับ/ร้าน · เลขบัญชี</th>
                    <th>หมวด</th>
                    <th>กระเป๋า</th>
                    <th style={{ textAlign: 'right' }}>จำนวนเงิน</th>
                    <th style={{ paddingRight: 18 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map((t) => (
                    <tr key={t.id}>
                      <td style={{ paddingLeft: 18, whiteSpace: 'nowrap' }}>
                        {t.date}
                        {t.time && <div className="muted" style={{ fontSize: 11 }}>{t.time}</div>}
                      </td>
                      <td>
                        <div>
                          {displayName(t)}
                          {t.isTransfer && <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>โอนระหว่างกระเป๋า</span>}
                        </div>
                        <div className="muted mono" style={{ fontSize: 11 }}>
                          {t.alias && t.alias !== t.counterparty ? `${t.counterparty} · ` : ''}
                          {t.accountRef ?? '—'}
                        </div>
                      </td>
                      <td>
                        <select
                          value={t.category}
                          onChange={(e) => changeCategory(t.id, e.target.value as CategoryId)}
                          style={{ ...inputStyle(), padding: '5px 8px', fontSize: 12.5 }}
                        >
                          {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>)}
                        </select>
                      </td>
                      <td className="muted">{walletLabel(t)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <span className={t.direction === 'in' ? 'down' : 'up'}>
                          {t.direction === 'in' ? '+' : '−'}{thb(t.amount)}
                        </span>
                      </td>
                      <td style={{ paddingRight: 18 }}>
                        {!t.isTransfer && (
                          <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setRuleFor(t)}>ตั้งกฎ</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="center muted" style={{ padding: 30 }}>ไม่พบรายการตามเงื่อนไข</div>}
              {filtered.length > 500 && <div className="center muted" style={{ padding: 12, fontSize: 12 }}>แสดง 500 รายการแรก — ใช้ตัวกรองเพื่อดูเฉพาะเจาะจง</div>}
            </div>
          </div>
        )}
      </Async>

      {ruleFor && (
        <RuleModal
          txn={ruleFor}
          onClose={() => setRuleFor(null)}
          onSaved={(affected) => {
            setRuleFor(null);
            setToast(`ตั้งกฎแล้ว · ปรับ ${affected} รายการของร้านนี้`);
            refetchAll();
          }}
        />
      )}
    </>
  );
}

function inputStyle(width?: number): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    fontSize: 13.5,
    width,
  };
}

function RuleModal({ txn, onClose, onSaved }: { txn: Transaction; onClose: () => void; onSaved: (affected: number) => void }) {
  const [alias, setAlias] = useState(txn.alias ?? txn.counterparty);
  const [category, setCategory] = useState<CategoryId>(txn.category);
  const [matchType, setMatchType] = useState<'account' | 'name'>(txn.accountRef ? 'account' : 'name');
  const [busy, setBusy] = useState(false);
  const matchValue = matchType === 'account' ? txn.accountRef! : txn.counterparty;

  const save = async () => {
    setBusy(true);
    try {
      const r = await apiSend<{ affected: number }>('/rules', 'POST', { matchType, matchValue, alias, category });
      onSaved(r.affected);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: '100%' }}>
        <h3>ตั้งกฎร้านค้า</h3>
        <div className="sub">บอกระบบว่าผู้รับนี้คือร้านอะไร หมวดไหน — ใช้กับทุกรายการที่ตรงกัน และอัปเดต Sankey/หมวด/คะแนนทันที</div>

        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <div className="muted">ผู้รับเดิม</div>
          <b>{txn.counterparty}</b>
          {txn.accountRef && <div className="mono muted" style={{ fontSize: 12 }}>{txn.accountRef}</div>}
        </div>

        <label style={{ fontSize: 13, fontWeight: 600 }}>จับคู่ด้วย</label>
        <div className="seg" style={{ display: 'flex', margin: '6px 0 14px' }}>
          <button className={matchType === 'account' ? 'active' : ''} disabled={!txn.accountRef} onClick={() => setMatchType('account')}>
            🏦 เลขบัญชี {!txn.accountRef && '(ไม่มี)'}
          </button>
          <button className={matchType === 'name' ? 'active' : ''} onClick={() => setMatchType('name')}>🔤 ชื่อผู้รับ</button>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600 }}>ตั้งชื่อร้าน (แสดงแทนชื่อบัญชี)</label>
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="เช่น ร้านก๋วยเตี๋ยวเจ๊หมวย" style={{ ...inputStyle(), width: '100%', margin: '6px 0 14px' }} />

        <label style={{ fontSize: 13, fontWeight: 600 }}>หมวดหมู่</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as CategoryId)} style={{ ...inputStyle(), width: '100%', margin: '6px 0 18px' }}>
          {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>)}
        </select>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึกกฎ'}</button>
        </div>
      </div>
    </div>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ date: today, amount: '', direction: 'out', counterparty: '', category: 'food', source: 'manual' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!f.counterparty || !f.amount) return setErr('กรอกผู้รับและจำนวนเงิน');
    setBusy(true);
    try {
      await apiSend('/transactions', 'POST', {
        date: f.date,
        amount: Number(f.amount),
        direction: f.direction,
        counterparty: f.counterparty,
        category: f.category,
        source: f.source,
      });
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>เพิ่มรายการเอง</h3>
      <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={inputStyle()} />
        <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} style={inputStyle()}>
          <option value="out">รายจ่าย</option>
          <option value="in">รายรับ</option>
        </select>
        <input placeholder="ผู้รับ/ร้าน" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} style={inputStyle(200)} />
        <input type="number" placeholder="จำนวนเงิน" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={inputStyle(130)} />
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={inputStyle()}>
          {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>)}
        </select>
        <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} style={inputStyle()}>
          {['manual', 'kbank', 'make', 'truemoney'].map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
      </div>
      {err && <div className="up" style={{ fontSize: 13, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
