import { useState } from 'react';
import { CATEGORY_META, EXPENSE_CATEGORIES } from '@finflow/shared';
import { useApi, apiSend } from '../lib/api';
import type { BudgetsData } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb, pct } from '../lib/format';

const statusColor: Record<string, string> = { ok: 'var(--good)', warn: 'var(--warn)', over: 'var(--alert)' };
const statusLabel: Record<string, string> = { ok: 'อยู่ในงบ', warn: 'ใกล้เต็มงบ', over: 'เกินงบ' };

export default function Budgets() {
  const state = useApi<BudgetsData>('/budgets');
  const [addCat, setAddCat] = useState('');
  const [addLimit, setAddLimit] = useState('');

  const save = async (category: string, limit: number) => {
    await apiSend(`/budgets/${category}`, 'PUT', { limit });
    state.refetch();
  };

  return (
    <>
      <PageHead title="งบประมาณรายหมวด" desc="ตั้งวงเงินต่อเดือน ระบบเตือนเมื่อใกล้/เกินงบ" />
      <Async state={state} height={300}>
        {(d) => {
          const budgetedCats = new Set(d.status.map((s) => s.category));
          const available = EXPENSE_CATEGORIES.filter((c) => !budgetedCats.has(c));
          return (
            <div className="grid" style={{ gap: 18 }}>
              <div className="muted" style={{ fontSize: 13 }}>
                เดือน {d.month} · จำนวนงบที่ตั้งไว้ {d.status.length} หมวด
              </div>

              <div className="grid cols-2">
                {d.status.map((s) => (
                  <div key={s.category} className="card">
                    <div className="row between">
                      <b>{CATEGORY_META[s.category]?.icon} {s.label}</b>
                      <span className="badge" style={{ color: statusColor[s.status], background: `color-mix(in srgb, ${statusColor[s.status]} 14%, transparent)` }}>
                        {statusLabel[s.status]}
                      </span>
                    </div>
                    <div className="row between" style={{ fontSize: 13, marginTop: 8 }}>
                      <span>ใช้ไป <b>{thb(s.spent)}</b></span>
                      <span className="muted">งบ {thb(s.limit)}</span>
                    </div>
                    <div style={{ height: 9, background: 'var(--surface-2)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, s.ratio * 100)}%`, height: '100%', background: statusColor[s.status] }} />
                    </div>
                    <div className="row between" style={{ marginTop: 8 }}>
                      <span className={s.remaining >= 0 ? 'down' : 'up'} style={{ fontSize: 13 }}>
                        {s.remaining >= 0 ? `เหลือ ${thb(s.remaining)}` : `เกิน ${thb(-s.remaining)}`} · {pct(s.ratio * 100)}
                      </span>
                      <BudgetEdit current={s.limit} onSave={(v) => save(s.category, v)} />
                    </div>
                  </div>
                ))}
              </div>

              {available.length > 0 && (
                <div className="card">
                  <h3>เพิ่มงบหมวดใหม่</h3>
                  <div className="row wrap" style={{ gap: 10, marginTop: 6 }}>
                    <select
                      value={addCat}
                      onChange={(e) => setAddCat(e.target.value)}
                      style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
                    >
                      <option value="">เลือกหมวด…</option>
                      {available.map((c) => (
                        <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="วงเงิน/เดือน (บาท)"
                      value={addLimit}
                      onChange={(e) => setAddLimit(e.target.value)}
                      style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', width: 180 }}
                    />
                    <button
                      className="btn primary"
                      disabled={!addCat || !addLimit}
                      onClick={async () => {
                        await save(addCat, Number(addLimit));
                        setAddCat('');
                        setAddLimit('');
                      }}
                    >
                      เพิ่มงบ
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }}
      </Async>
    </>
  );
}

function BudgetEdit({ current, onSave }: { current: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(current));
  if (!editing)
    return (
      <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setEditing(true)}>
        แก้ไข
      </button>
    );
  return (
    <span className="row" style={{ gap: 4 }}>
      <input
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        style={{ width: 90, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
      />
      <button
        className="btn primary"
        style={{ padding: '4px 10px', fontSize: 12 }}
        onClick={() => {
          onSave(Number(val));
          setEditing(false);
        }}
      >
        ✓
      </button>
    </span>
  );
}
