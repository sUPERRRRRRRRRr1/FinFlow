import { useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApi } from '../lib/api';
import type { ForecastData } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb, compact } from '../lib/format';

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

function ForecastChart({ data }: { data: ForecastData }) {
  // หมวดที่มียอด > 0 ในเดือนจริงหรือคาดการณ์ (กรอง 0 ออกเพื่อ legend ที่สะอาด)
  const cats = data.categories.filter(
    (c) => c.history.some((h) => h.total > 0) || c.months.some((m) => m.total > 0),
  );

  const histLabels = cats[0]?.history.map((h) => h.label) ?? [];
  const lastActual = histLabels[histLabels.length - 1];

  // row ต่อเดือน: เดือนจริง (history) ต่อด้วยเดือนคาดการณ์ (months)
  const rows = [
    ...histLabels.map((label, hi) => {
      const row: Record<string, number | string> = { month: label };
      for (const c of cats) row[c.category] = c.history[hi]?.total ?? 0;
      return row;
    }),
    ...data.total.map((t, ki) => {
      const row: Record<string, number | string> = { month: t.label };
      for (const c of cats) row[c.category] = c.months[ki]?.total ?? 0;
      return row;
    }),
  ];

  const firstForecast = data.total[0]?.label;
  const lastForecast = data.total[data.total.length - 1]?.label;

  return (
    <div className="card">
      <h3>กราฟคาดการณ์รายจ่ายรายหมวด</h3>
      <div className="sub">
        เส้นทึบ = ยอดจริงย้อนหลัง · พื้นที่แรเงา = ช่วงคาดการณ์ 3 เดือน · เห็นทิศทางแต่ละหมวดชัดเจน
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={rows} margin={{ left: -8, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <YAxis tickFormatter={compact} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <Tooltip
            formatter={(v: number, name) => [thb(v), name]}
            contentStyle={tooltipStyle}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {/* แรเงาช่วงคาดการณ์ */}
          {firstForecast && lastForecast && (
            <ReferenceArea
              x1={firstForecast}
              x2={lastForecast}
              fill="var(--muted)"
              fillOpacity={0.07}
            />
          )}
          {/* เส้นแบ่ง "ปัจจุบัน → คาดการณ์" */}
          {lastActual && (
            <ReferenceLine
              x={lastActual}
              stroke="var(--muted)"
              strokeDasharray="4 4"
              label={{ value: 'คาดการณ์ →', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }}
            />
          )}
          {cats.map((c) => (
            <Line
              key={c.category}
              type="monotone"
              dataKey={c.category}
              name={c.label}
              stroke={c.color}
              strokeWidth={2.5}
              dot={{ r: 3, fill: c.color }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** กราฟเส้นเล็ก (sparkline) แสดงทิศทางหมวดนั้น: จริงย้อนหลัง → คาดการณ์ */
function Sparkline({ cat }: { cat: import('../lib/types').CategoryForecast }) {
  const points = [
    ...cat.history.map((h) => h.total),
    ...cat.months.map((m) => m.total),
  ].map((v, i) => ({ i, v }));
  const splitAt = cat.history.length - 1; // index จุดจริงสุดท้าย

  return (
    <ResponsiveContainer width="100%" height={44}>
      <LineChart data={points} margin={{ top: 4, bottom: 2, left: 0, right: 0 }}>
        {splitAt >= 0 && (
          <ReferenceArea x1={splitAt} x2={points.length - 1} fill={cat.color} fillOpacity={0.08} />
        )}
        <Line
          type="monotone"
          dataKey="v"
          stroke={cat.color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function FlagBadge({ prob }: { prob: number }) {
  const pct = Math.round(prob * 100);
  const color = prob >= 0.7 ? 'var(--red, #ef4444)' : 'var(--orange, #f97316)';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color,
      background: `${color}18`, borderRadius: 6,
      padding: '2px 6px', marginLeft: 6,
    }}>
      {pct}% เกินงบ
    </span>
  );
}

function CategoryCard({
  cat,
  horizonIdx,
}: {
  cat: import('../lib/types').CategoryForecast;
  horizonIdx: number;
}) {
  const m = cat.months[horizonIdx]!;
  const barPct = cat.budget ? Math.min(100, (m.total / cat.budget) * 100) : null;
  const recurringPct = m.total > 0 ? (m.recurring / m.total) * 100 : 0;

  return (
    <div style={{
      padding: '12px 16px',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.label}</span>
        {m.exceedProb != null && m.exceedProb >= 0.4 && (
          <FlagBadge prob={m.exceedProb} />
        )}
      </div>

      {/* Sparkline: จริงย้อนหลัง → คาดการณ์ */}
      <Sparkline cat={cat} />

      {/* Stacked bar: recurring (solid) + variable (lighter) */}
      <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', display: 'flex' }}>
          <div style={{
            width: `${recurringPct}%`,
            background: cat.color,
            borderRadius: '4px 0 0 4px',
            transition: 'width 0.3s',
          }} />
          <div style={{
            width: `${100 - recurringPct}%`,
            background: `${cat.color}55`,
            borderRadius: '0 4px 4px 0',
          }} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{thb(m.total)}</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
            {thb(m.low)} – {thb(m.high)}
          </span>
        </div>
        {cat.budget && (
          <span className="muted" style={{ fontSize: 11 }}>งบ {thb(cat.budget)}</span>
        )}
      </div>

      {barPct != null && (
        <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${barPct}%`,
            background: barPct >= 100 ? '#ef4444' : barPct >= 80 ? '#f97316' : '#16a34a',
            transition: 'width 0.3s',
          }} />
        </div>
      )}

      <div className="muted" style={{ fontSize: 11 }}>
        ประจำ {thb(m.recurring)} · ผันแปร {thb(m.variable)}
      </div>
    </div>
  );
}

function ForecastContent({ data }: { data: ForecastData }) {
  const [hi, setHi] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Card 0: กราฟแท่งซ้อนภาพรวม */}
      <ForecastChart data={data} />

      {/* Card 1: รายหมวด */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0 }}>คาดการณ์รายจ่ายรายหมวด</h3>
            <div className="sub">
              Decomposition: บิลประจำ + Damped trend (φ=0.8)
              {data.seasonalActive && ' + seasonal index'}
              {' · '}<span style={{ fontStyle: 'italic' }}>80% PI</span>
            </div>
          </div>
          <div className="spacer" />
          <div className="seg">
            {data.categories[0]?.months.map((m, i) => (
              <button key={i} className={hi === i ? 'active' : ''} onClick={() => setHi(i)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}>
          {data.categories.map((cat) => (
            <CategoryCard key={cat.category} cat={cat} horizonIdx={hi} />
          ))}
        </div>
      </div>

      {/* Card 2: ยอดรวม 3 เดือน */}
      <div className="card">
        <h3>ยอดรวมทุกหมวด — 3 เดือนข้างหน้า</h3>
        <div className="sub">
          σ_total = √(Σ σ_c²) สมมติหมวดอิสระต่อกัน · ช่วงความเชื่อมั่น 80%
        </div>
        <div className="row wrap" style={{ gap: 24, marginTop: 12 }}>
          {data.total.map((t, i) => (
            <div key={i} style={{
              flex: 1, minWidth: 160,
              padding: '16px',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}>
              <div className="muted" style={{ fontSize: 12 }}>{t.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, margin: '4px 0' }}>{thb(t.mid)}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                ต่ำสุด {thb(t.low)} · สูงสุด {thb(t.high)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Card 3: Backtest */}
      <div className="card">
        <h3>ความแม่นของโมเดล (Backtest)</h3>
        <div className="sub">
          Rolling-origin {data.backtest.folds} fold — เปรียบเทียบกับ baseline (เฉลี่ย 3 เดือนล่าสุด)
        </div>
        <div className="row wrap" style={{ gap: 24, marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>MAPE โมเดล</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {data.backtest.folds > 0 ? `${(data.backtest.mape * 100).toFixed(1)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>MAPE baseline</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {data.backtest.folds > 0 ? `${(data.backtest.baselineMape * 100).toFixed(1)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Skill Score</div>
            <div style={{
              fontSize: 22, fontWeight: 700,
              color: data.backtest.skillScore > 0 ? 'var(--green, #16a34a)' : 'var(--red, #ef4444)',
            }}>
              {data.backtest.folds > 0 ? `${(data.backtest.skillScore * 100).toFixed(1)}%` : '—'}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {data.backtest.skillScore > 0 ? 'แม่นกว่า naive' : 'ไม่ดีกว่า naive'}
            </div>
          </div>
        </div>

        <details style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            วิธีคิดสูตร (สำหรับกรรมการ)
          </summary>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['Decomposition', 'F_c[+k] = R_c + S_c[m] · V̂_c[+k]'],
              ['บิลประจำ', 'R_c = Σ avgAmt_i × 30.44 / interval_i  (active items)'],
              ['Damped trend', 'V̂_c[+k] = level + slope × φ(1−φᵏ)/(1−φ),  φ=0.8'],
              ['Level (EWMA)', 'level = 0.5·v[n−1] + ⅓·v[n−2] + ⅙·v[n−3]'],
              ['Prediction Interval', 'F_c ± 1.28·σ_c·√(1+1/n+(x₀−x̄)²/Sxx)  [80% CI]'],
              ['รวมทุกหมวด', 'σ_total = √(Σ σ_c²)  [สมมติ independent]'],
              ['โอกาสเกินงบ', 'P = 1 − Φ((L_c − F_c) / σ_c)'],
              ['Skill Score', 'S = 1 − MAPE_model / MAPE_baseline'],
            ].map(([name, formula]) => (
              <div key={name} style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, minWidth: 130, display: 'inline-block' }}>{name}:</span>
                <code style={{
                  background: 'var(--surface-2, var(--border))',
                  padding: '1px 6px', borderRadius: 4, fontSize: 11,
                }}>{formula}</code>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

export default function Forecast() {
  const state = useApi<ForecastData>('/analytics/forecast');

  return (
    <>
      <PageHead
        title="คาดการณ์ค่าใช้จ่าย"
        desc="Decomposition + Damped Trend (φ=0.8) · แยกบิลประจำ + ส่วนผันแปร · 80% Prediction Interval · Backtest MAPE"
      />
      <Async state={state} height={400}>
        {(data) => <ForecastContent data={data} />}
      </Async>
    </>
  );
}
