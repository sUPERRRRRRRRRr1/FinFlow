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
          const last = m[m.length - 1];
          const prev = m[m.length - 2];
          return (
          <div className="grid" style={{ gap: 18 }}>
            {/* แถวสถิติหลัก */}
            <div className="grid cols-5">
              <Stat
                label="รายรับรวม"
                value={thb(o.totals.income)}
                accent="var(--good)"
                trend={monthTrend(last?.income, prev?.income, true)}
                sub={<span className="muted">{o.count} รายการ</span>}
              />
              <Stat
                label="รายจ่ายรวม"
                value={thb(o.totals.expense)}
                accent="#f97316"
                trend={monthTrend(last?.expense, prev?.expense, false)}
                sub={<span className="muted">ไม่รวมการโอนระหว่างกระเป๋า</span>}
              />
              <Stat
                label="กันเข้าออม"
                value={<span className="down">{thb(o.totals.savings)}</span>}
                accent="var(--brand)"
                sub={<span className="muted">เงินที่โอนเข้าบัญชีออม (ไม่นับเป็นรายจ่าย)</span>}
              />
              <Stat
                label="ออมสุทธิ (สะสม)"
                value={<span className={o.totals.net >= 0 ? 'down' : 'up'}>{thb(o.totals.net)}</span>}
                accent="var(--info)"
                sub={<span className="muted">รายรับ−รายจ่ายสะสม · ไม่ใช่ยอดในบัญชี (ดูยอดจริงด้านล่าง)</span>}
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
                    <Bar dataKey="income" name="รายรับ" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="รายจ่าย" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3>แยกตามบัญชี</h3>
                <div className="sub">ยอดเงินคงเหลือจริง + เงินเข้า/ออก แต่ละบัญชี (รวมศูนย์ KBank · TrueMoney)</div>
                {o.totals.totalBalance > 0 && (
                  <div className="row between" style={{ padding: '10px 0', borderBottom: '2px solid var(--border)' }}>
                    <b>💰 ยอดเงินรวมทุกบัญชี</b>
                    <b style={{ fontSize: 17 }}>{thb(o.totals.totalBalance)}</b>
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
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{thb(s.balance)}</div>
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
