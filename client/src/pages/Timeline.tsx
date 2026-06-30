import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { monthKey, reconcileBalances, thaiMonthLabel } from '@finflow/shared';
import type { Transaction } from '@finflow/shared';
import { useApi } from '../lib/api';
import type { TimelineData } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb, compact } from '../lib/format';

type View = 'day' | 'month' | 'year';

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

// ── เส้นเวลายอดคงเหลือ + ประมาณการ ─────────────────────────────────────────
// แกนหลัก = รายการที่ "ยอดคงเหลือเปลี่ยน" (มี balanceAfter) เรียงใหม่→เก่า
// แทรกรายการ "ประมาณการ" (เงินเข้า/ออกที่ไม่มีสลิป) ไว้ระหว่างจุดที่ยอดกระโดด
// + สรุปท้ายเดือนแต่ละเดือน (จริง + ประมาณการ) — ไว้ตรวจสอบเมื่อได้ STM จริง
type Ev =
  | { kind: 'month'; key: string; income: number; expense: number; infIn: number; infOut: number }
  | { kind: 'inferred'; id: string; direction: 'in' | 'out'; amount: number; afterDate: string; beforeDate: string }
  | { kind: 'txn'; t: Transaction };

function ReconcileTimeline() {
  const state = useApi<{ transactions: Transaction[] }>('/transactions');

  const events = useMemo<Ev[]>(() => {
    const txns = state.data?.transactions ?? [];
    if (!txns.length) return [];
    const recon = reconcileBalances(txns);

    // สรุปรายเดือน: รายรับ/รายจ่ายจริง (ไม่นับโอนตัวเอง) + ประมาณการเข้า/ออก
    const monthAgg = new Map<string, { income: number; expense: number; infIn: number; infOut: number }>();
    const m = (k: string) => monthAgg.get(k) ?? monthAgg.set(k, { income: 0, expense: 0, infIn: 0, infOut: 0 }).get(k)!;
    for (const t of txns) {
      if (t.isTransfer) continue;
      const a = m(monthKey(t.date));
      if (t.direction === 'in') a.income += t.amount;
      else if (t.category !== 'savings') a.expense += t.amount;
    }
    for (const f of recon.external) {
      const a = m(monthKey(f.beforeDate));
      if (f.direction === 'in') a.infIn += f.amount;
      else a.infOut += f.amount;
    }

    // ประมาณการ จัดกลุ่มตาม "รายการที่อยู่ก่อนหน้า" (beforeId) เพื่อแทรกไว้ก่อนรายการนั้น
    const infByBefore = new Map<string, typeof recon.external>();
    for (const f of recon.external) {
      (infByBefore.get(f.beforeId) ?? infByBefore.set(f.beforeId, []).get(f.beforeId)!).push(f);
    }

    // แกนหลัก = รายการที่ยอดคงเหลือเปลี่ยน (มี balanceAfter) · ใหม่→เก่า
    const anchors = txns
      .filter((t) => t.balanceAfter != null)
      .sort((x, y) => (y.date.localeCompare(x.date) || (y.time ?? '').localeCompare(x.time ?? '')))
      .slice(0, 120);

    const out: Ev[] = [];
    let curMonth = '';
    for (const t of anchors) {
      const mk = monthKey(t.date);
      if (mk !== curMonth) {
        const a = m(mk);
        out.push({ kind: 'month', key: mk, ...a });
        curMonth = mk;
      }
      out.push({ kind: 'txn', t });
      // แทรกประมาณการที่เกิดก่อนรายการนี้ (ใหม่→เก่า รายการประมาณการอยู่ "ใต้" รายการที่มันเกิดก่อน)
      for (const f of infByBefore.get(t.id) ?? []) {
        out.push({ kind: 'inferred', id: f.id, direction: f.direction, amount: f.amount, afterDate: f.afterDate, beforeDate: f.beforeDate });
      }
    }
    return out;
  }, [state.data]);

  return (
    <Async state={state} height={200}>
      {() =>
        events.length === 0 ? (
          <div className="card center muted" style={{ padding: 24 }}>ยังไม่มีข้อมูลยอดคงเหลือ — ดึง statement/แจ้งเตือนจาก Gmail ก่อน</div>
        ) : (
          <div className="card" style={{ borderLeft: '3px solid var(--brand)' }}>
            <h3>เส้นเวลายอดคงเหลือ + ประมาณการ</h3>
            <div className="sub">
              รายการที่ยอดคงเหลือเปลี่ยน (ใหม่→เก่า) · 💡 = เงินเข้า/ออกที่ไม่มีสลิป (อนุมานจากยอดกระโดด หักโอนตัวเองแล้ว) · จะตรวจสอบ/แก้เมื่อได้ STM จริง
            </div>
            <div style={{ marginTop: 8 }}>
              {events.map((e, i) =>
                e.kind === 'month' ? (
                  <div key={`m${e.key}`} style={{ marginTop: i ? 16 : 4, padding: '6px 10px', borderRadius: 8, background: 'var(--bg)', fontSize: 12.5 }}>
                    <b>{thaiMonthLabel(e.key)}</b>
                    <span className="muted"> · สรุปเดือน: </span>
                    <span className="down">เข้า {thb(e.income)}</span>
                    <span className="muted"> · </span>
                    <span className="up">ออก {thb(e.expense)}</span>
                    {(e.infIn > 0 || e.infOut > 0) && (
                      <span className="muted"> · 💡 ประมาณการ +{thb(e.infIn)} / −{thb(e.infOut)}</span>
                    )}
                  </div>
                ) : e.kind === 'inferred' ? (
                  <div key={e.id} className="row between" style={{ padding: '6px 0 6px 14px', borderTop: '1px dashed var(--border)', fontSize: 12.5 }}>
                    <div>
                      💡 <span className="badge" style={{ fontSize: 10 }}>ประมาณการ</span>{' '}
                      {e.direction === 'in' ? 'เงินเข้า' : 'เงินออก'}ที่ไม่มีสลิป
                      <div className="muted" style={{ fontSize: 11 }}>ระหว่าง {e.afterDate} – {e.beforeDate}</div>
                    </div>
                    <span className={e.direction === 'in' ? 'down' : 'up'} style={{ fontWeight: 600 }}>
                      {e.direction === 'in' ? '+' : '−'}{thb(e.amount)}
                    </span>
                  </div>
                ) : (
                  <div key={e.t.id} className="row between" style={{ padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                    <div>
                      {e.t.counterparty}
                      <div className="muted" style={{ fontSize: 11 }}>{e.t.date}{e.t.time ? ` ${e.t.time}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={e.t.isTransfer ? 'flat' : e.t.direction === 'in' ? 'down' : 'up'}>
                        {e.t.isTransfer ? '↔ ' : e.t.direction === 'in' ? '+' : '−'}{thb(e.t.amount)}
                      </span>
                      <div className="muted" style={{ fontSize: 11 }}>คงเหลือ {thb(e.t.balanceAfter!)}</div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        )
      }
    </Async>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Timeline() {
  const [view, setView] = useState<View>('month');
  const state = useApi<TimelineData>('/analytics/timeline');

  return (
    <>
      <PageHead
        title="ไทม์ไลน์หลายระดับ"
        desc="รายวัน (MA 7 วัน) · รายเดือน · รายปี"
        action={
          <div className="seg">
            {(['day', 'month', 'year'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v === 'day' ? 'รายวัน' : v === 'month' ? 'รายเดือน' : 'รายปี'}
              </button>
            ))}
          </div>
        }
      />

      <Async state={state} height={380}>
          {(t) => (
            <>
              {view === 'day' && (
                <div className="card">
                  <h3>รายจ่ายรายวัน + เส้นค่าเฉลี่ยเคลื่อนที่ 7 วัน</h3>
                  <div className="sub">moving average ช่วยให้เห็นแนวโน้มท่ามกลางความผันผวนรายวัน</div>
                  <ResponsiveContainer width="100%" height={360}>
                    <ComposedChart data={t.daily} margin={{ left: -8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} interval={Math.ceil(t.daily.length / 12)} />
                      <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => thb(v)} contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="expense" name="รายจ่าย" fill="#ef444480" radius={[3, 3, 0, 0]} />
                      <Line dataKey="ma7" name="เฉลี่ย 7 วัน" stroke="#0f766e" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {view === 'month' && (
                <div className="card">
                  <h3>รายรับ–รายจ่าย–ออม รายเดือน</h3>
                  <div className="sub">เทียบแต่ละเดือน พร้อมเส้นเงินออมสุทธิ</div>
                  <ResponsiveContainer width="100%" height={360}>
                    <ComposedChart data={t.monthly} margin={{ left: -8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <Tooltip formatter={(v: number) => thb(v)} contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="income" name="รายรับ" stackId="inc" fill="#22c55e" />
                      <Bar dataKey="inferredIncome" name="ประมาณการรายรับ" stackId="inc" fill="#86efac" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" name="รายจ่าย" stackId="exp" fill="#ef4444" />
                      <Bar dataKey="inferredExpense" name="ประมาณการรายจ่าย" stackId="exp" fill="#fca5a5" radius={[4, 4, 0, 0]} />
                      <Line dataKey="net" name="ออมสุทธิ" stroke="#0ea5e9" strokeWidth={2.5} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {view === 'year' && (
                <div className="grid" style={{ gap: 18 }}>
                  <div className="card">
                    <h3>แนวโน้มเงินออมสุทธิรายเดือน</h3>
                    <div className="sub">พื้นที่ใต้กราฟ = เงินออมสะสมแต่ละเดือน</div>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={t.monthly} margin={{ left: -8, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                        <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                        <Tooltip formatter={(v: number) => thb(v)} contentStyle={tooltipStyle} />
                        <Area dataKey="net" name="ออมสุทธิ" stroke="#0f766e" fill="#0f766e30" strokeWidth={2.5} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card">
                    <h3>พยากรณ์ด้วย Linear Regression</h3>
                    <div className="sub">least-squares บนเงินออมสุทธิรายเดือน เพื่อคาดการณ์ 3 เดือนข้างหน้า</div>
                    <div className="row wrap" style={{ gap: 24 }}>
                      {t.forecast.netSavings.map((v, i) => (
                        <div key={i}>
                          <div className="muted" style={{ fontSize: 12 }}>+{i + 1} เดือน</div>
                          <div style={{ fontSize: 22, fontWeight: 700 }} className={v >= 0 ? 'down' : 'up'}>
                            {thb(v)}
                          </div>
                        </div>
                      ))}
                      <div className="spacer" />
                      <div>
                        <div className="muted" style={{ fontSize: 12 }}>ความชัน (slope)</div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{thb(t.forecast.slope)}/เดือน</div>
                        <div className="muted" style={{ fontSize: 12 }}>R² = {t.forecast.r2}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </Async>

        <div style={{ marginTop: 18 }}>
          <ReconcileTimeline />
        </div>
    </>
  );
}
