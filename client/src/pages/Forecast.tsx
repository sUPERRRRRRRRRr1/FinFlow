import { useState } from 'react';
import { useApi } from '../lib/api';
import type { ForecastData } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb } from '../lib/format';

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
