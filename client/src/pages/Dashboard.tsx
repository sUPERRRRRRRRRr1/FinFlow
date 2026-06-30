import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApi, apiGet } from '../lib/api';
import type { Overview } from '../lib/types';
import { thb, pct, compact, sevClass } from '../lib/format';
import { PageHead, Async, Stat } from '../components/ui';
import type { Trend } from '../components/ui';
import { CategoryIcon } from '../lib/icons';
import HealthScoreGauge from '../components/HealthScoreGauge';
import WhatIfSimulator from '../components/WhatIfSimulator';

export default function Dashboard() {
  const state = useApi<Overview>('/analytics/overview');

  return (
    <>
      <PageHead title="ภาพรวมการเงิน" desc="รวมทุกกระเป๋าไว้ที่เดียว วิเคราะห์อัตโนมัติด้วย AI + สถิติ" />
      <Async state={state} height={500}>
        {(o) => {
          const m = o.monthly;
          // เทียบเทรนด์จากสองเดือนที่ "ครบเดือน" ล่าสุด — ตัดเดือนปัจจุบันที่ยังเดินไม่จบออก (กัน −99% หลอกตา)
          const curKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
          const mc = m.length && m[m.length - 1].key === curKey ? m.slice(0, -1) : m;
          const last = mc[mc.length - 1];
          const prev = mc[mc.length - 2];
          return (
          <div className="grid" style={{ gap: 18 }}>
            {/* แถวสถิติหลัก */}
            <div className="grid cols-6">
              <Stat
                label="รายรับรวม"
                value={thb(o.totals.income)}
                accent="#22c55e"
                trend={monthTrend(last?.income, prev?.income, true)}
                sub={<span className="muted">{o.count} รายการ</span>}
              />
              <Stat
                label="รายจ่ายรวม"
                value={thb(o.totals.expense)}
                accent="var(--alert)"
                trend={monthTrend(last?.expense, prev?.expense, false)}
                sub={<span className="muted">ไม่รวมการโอนระหว่างกระเป๋า</span>}
              />
              <Stat
                label="เงินใช้จ่าย"
                value={<span>{thb(o.totals.dailyBalance)}</span>}
                accent="#0ea5e9"
                sub={
                  <span className="muted">
                    บัญชีใช้จ่ายประจำวัน
                    {o.totals.dailyBalanceDate && (
                      <> · <b>ณ {o.totals.dailyBalanceDate.split('-').reverse().join('/')}{o.totals.dailyBalanceTime ? ` ${o.totals.dailyBalanceTime}` : ''}</b></>
                    )}
                    {o.totals.dailyPending !== 0 && (
                      <>
                        {' '}(<b className={o.totals.dailyPending >= 0 ? 'down' : 'up'}>
                          {o.totals.dailyPending >= 0 ? '+' : '−'}{thb(Math.abs(o.totals.dailyPending))}
                        </b> ยังไม่ขึ้น statement)
                      </>
                    )}
                  </span>
                }
              />
              <Stat
                label="เงินเก็บ"
                value={<span className="down">{thb(o.totals.savingsBalanceProjected)}</span>}
                accent="var(--brand)"
                sub={
                  <span className="muted">
                    {o.totals.savingsPending !== 0 ? (
                      <>
                        ยอดเรียลไทม์ (รวมโอนข้ามบัญชี{' '}
                        <b className={o.totals.savingsPending >= 0 ? 'down' : 'up'}>
                          {o.totals.savingsPending >= 0 ? '+' : '−'}{thb(Math.abs(o.totals.savingsPending))}
                        </b>{' '}
                        ที่ยังไม่ขึ้น statement) · จาก statement {thb(o.totals.savingsBalance)}
                      </>
                    ) : (
                      <>
                        ยอดในบัญชีออม · เก็บเพิ่ม{' '}
                        <b className={o.totals.savingsNetFlowPerMonth >= 0 ? 'down' : 'up'}>
                          {o.totals.savingsNetFlowPerMonth >= 0 ? '+' : ''}{thb(o.totals.savingsNetFlowPerMonth)}/เดือน
                        </b>{' '}
                        (รวม {o.totals.savingsNetFlow >= 0 ? '+' : ''}{thb(o.totals.savingsNetFlow)})
                      </>
                    )}
                  </span>
                }
              />
              <Stat
                label="รายรับ−รายจ่าย"
                value={<span className={o.totals.net >= 0 ? 'down' : 'up'}>{thb(o.totals.net)}</span>}
                accent="var(--info)"
                sub={<span className="muted">กระแสเงินสุทธิช่วงนี้ (รับ−จ่าย) · ไม่ใช่ยอดเงินในบัญชี</span>}
              />
              <Stat
                label="อัตราการออม"
                value={pct(o.totals.savingsRate * 100)}
                accent={o.totals.savingsRate >= 0.2 ? 'var(--good)' : 'var(--warn)'}
                sub={
                  <span className={sevClass(o.totals.savingsRate >= 0.2 ? 'good' : 'warn') === 'good' ? 'down' : 'up'}>
                    เป้าหมาย 20%+
                  </span>
                }
              />
            </div>

            {/* คะแนนสุขภาพ + insight */}
            <div className="grid cols-2">
              <HealthScoreGauge health={o.health} onProfileChange={state.refetch} />
              <div className="grid" style={{ gap: 18, alignContent: 'start' }}>
                <InsightFeed insights={o.insights} />
                <AdviceCard />
              </div>
            </div>

            {/* pipeline stats */}
            {o.ingestStats && (
              <div className="card">
                <h3>ระบบรวม + กันซ้ำอัตโนมัติ</h3>
                <div className="sub">ผลของ pipeline กลาง: รวมหลายแหล่ง → กันซ้ำข้ามแหล่ง → จับคู่การโอนข้ามกระเป๋า</div>
                <div className="row wrap" style={{ gap: 10 }}>
                  <span className="badge info">📥 รับเข้า {o.ingestStats.received} รายการ</span>
                  <span className="badge good">✅ คงเหลือ {o.ingestStats.added}</span>
                  <span className="badge warn">🔁 กันซ้ำ {o.ingestStats.duplicatesRemoved}</span>
                  <span className="badge">↔️ จับคู่โอน {o.transferCount}</span>
                </div>
              </div>
            )}

            {/* รายเดือน + แยกกระเป๋า */}
            <div className="grid cols-2">
              <div className="card">
                <h3>รายรับ–รายจ่าย รายเดือน</h3>
                <div className="sub">เปรียบเทียบแต่ละเดือน</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={o.monthly} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <Tooltip
                      formatter={(v: number) => thb(v)}
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}
                    />
                    <Legend />
                    <Bar dataKey="income" name="รายรับ" stackId="inc" fill="#22c55e" />
                    <Bar dataKey="inferredIncome" name="ประมาณการรายรับ" stackId="inc" fill="#86efac" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="รายจ่าย" stackId="exp" fill="#ef4444" />
                    <Bar dataKey="inferredExpense" name="ประมาณการรายจ่าย" stackId="exp" fill="#fca5a5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3>แยกตามบัญชี</h3>
                <div className="sub">ยอดเงินคงเหลือจริง + เงินเข้า/ออก แต่ละบัญชี (รวมศูนย์ KBank · TrueMoney)</div>
                {o.totals.totalBalance > 0 && (
                  <div className="row between" style={{ padding: '10px 0', borderBottom: '2px solid var(--border)' }}>
                    <b>💰 ยอดเงินรวมทุกบัญชี</b>
                    <b style={{ fontSize: 17 }}>{thb(o.bySource.reduce((a, s) => a + (s.projected ?? 0), 0))}</b>
                  </div>
                )}
                {o.bySource.map((s) => (
                  <div key={s.source} className="row between" style={{ padding: '9px 0', borderTop: '1px solid var(--border)' }}>
                    <div>
                      <b>{s.label}</b>
                      <div className="muted" style={{ fontSize: 12 }}>{s.count} รายการ</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {s.balance != null ? (
                        <div style={{ fontWeight: 700, fontSize: 15 }}>
                          {thb(s.projected ?? s.balance)}
                          {s.pending !== 0 && (
                            <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
                              {' '}({s.pending > 0 ? '+' : '−'}{thb(Math.abs(s.pending))} โอนเข้า/ออกยังไม่ขึ้น statement)
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="muted" style={{ fontSize: 12 }}>ยอดคงเหลือ — n/a</div>
                      )}
                      <div style={{ fontSize: 11.5, marginTop: 2 }}>
                        <span className="down">เข้า {thb(s.income)}</span>
                        <span className="muted"> · </span>
                        <span className="up">ออก {thb(s.expense)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {(o.totals.inferredIncome > 0 || o.totals.inferredExpense > 0) && (
                  <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'color-mix(in srgb, var(--brand) 8%, transparent)', fontSize: 12.5 }}>
                    <b>💡 ประมาณการจากยอดคงเหลือ</b>
                    <div className="muted" style={{ marginTop: 4, lineHeight: 1.7 }}>
                      ตรวจพบเงินเคลื่อนไหวที่ไม่มีสลิป (จากยอดคงเหลือกระโดด) —{' '}
                      <span className="down">เข้า ~{thb(o.totals.inferredIncome)}</span>
                      <span className="muted"> · </span>
                      <span className="up">ออก ~{thb(o.totals.inferredExpense)}</span>
                      {' '}({o.totals.inferredCount} จุด) · หักโอนระหว่างบัญชีตัวเองแล้ว · จะตรวจสอบ/แก้ให้ตรงเมื่อได้ statement จริง
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* หมวดรายจ่าย */}
            <div className="card">
              <h3>รายจ่ายตามหมวด</h3>
              <div className="sub">สัดส่วนการใช้จ่ายแต่ละหมวด</div>
              {o.byCategory.map((c) => (
                <div key={c.category} style={{ padding: '7px 0' }}>
                  <div className="row between" style={{ fontSize: 14 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <CategoryIcon category={c.category} size={15} />
                      {c.label}
                    </span>
                    <span><b>{thb(c.amount)}</b> <span className="muted">· {pct(c.pct)}</span></span>
                  </div>
                  <div style={{ height: 7, background: 'var(--surface-2)', borderRadius: 99, marginTop: 4 }}>
                    <div style={{ width: `${c.pct}%`, height: '100%', background: c.color, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>

            {/* what-if */}
            <WhatIfSimulator baseHealth={o.health} />
          </div>
          );
        }}
      </Async>
    </>
  );
}

/** trend เดือนล่าสุดเทียบเดือนก่อนหน้า จากข้อมูลจริง — คืน undefined ถ้าคำนวณไม่ได้ */
function monthTrend(curr: number | undefined, base: number | undefined, goodWhenUp: boolean): Trend | undefined {
  if (curr == null || base == null || base === 0) return undefined;
  const d = ((curr - base) / base) * 100;
  if (!isFinite(d)) return undefined;
  const dir = d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat';
  const tone = dir === 'flat' ? 'muted' : (dir === 'up') === goodWhenUp ? 'good' : 'bad';
  return { dir, text: `${Math.abs(d).toFixed(1)}%`, tone };
}

function InsightFeed({ insights }: { insights: Overview['insights'] }) {
  return (
    <div className="card">
      <h3>ข้อสังเกตอัตโนมัติ</h3>
      <div className="sub">สรุปจากตัวเลขที่ระบบคำนวณ</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {insights.map((i) => (
          <div key={i.id} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20 }}>{i.icon}</span>
            <div>
              <div className="row" style={{ gap: 6 }}>
                <b style={{ fontSize: 14 }}>{i.title}</b>
                <span className={`badge ${sevClass(i.severity)}`} style={{ fontSize: 10 }}>
                  {i.severity === 'alert' ? 'เตือน' : i.severity === 'warn' ? 'ระวัง' : i.severity === 'good' ? 'ดี' : 'ข้อมูล'}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>{i.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdviceCard() {
  const [advice, setAdvice] = useState<{ text: string; source: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    setLoading(true);
    try {
      setAdvice(await apiGet('/analytics/advice'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="row between">
        <h3>คำแนะนำจาก AI</h3>
        <button className="btn primary" onClick={ask} disabled={loading}>
          {loading ? 'กำลังคิด…' : '✨ ขอคำแนะนำ'}
        </button>
      </div>
      {advice ? (
        <>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, marginTop: 10 }}>{advice.text}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            ที่มา: {advice.source === 'groq' ? 'Groq' : advice.source === 'gemini' ? 'Google Gemini' : 'ระบบ rule-based (ใส่ GROQ_API_KEY หรือ GEMINI_API_KEY เพื่อใช้ AI จริง)'}
          </div>
        </>
      ) : (
        <div className="sub" style={{ marginTop: 10 }}>กดเพื่อให้ AI เรียบเรียงคำแนะนำจากคะแนนและข้อสังเกตของคุณ</div>
      )}
    </div>
  );
}
