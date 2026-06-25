import { useState } from 'react';
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
                      <Bar dataKey="expense" name="รายจ่าย" fill="#f9731680" radius={[3, 3, 0, 0]} />
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
                      <Bar dataKey="income" name="รายรับ" fill="#16a34a" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" name="รายจ่าย" fill="#f97316" radius={[4, 4, 0, 0]} />
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
    </>
  );
}
