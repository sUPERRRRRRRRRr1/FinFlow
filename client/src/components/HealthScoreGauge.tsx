import { useState } from 'react';
import type { HealthScore } from '../lib/types';

function scoreColor(s: number): string {
  if (s >= 80) return '#16a34a';
  if (s >= 60) return '#0f766e';
  if (s >= 40) return '#f59e0b';
  return '#ef4444';
}

/** จุดบนวงกลมจากมุม (องศา) */
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

export default function HealthScoreGauge({ health }: { health: HealthScore }) {
  const [open, setOpen] = useState<string | null>(null);
  const W = 260;
  const cx = W / 2;
  const cy = 140;
  const r = 100;
  const color = scoreColor(health.total);
  const valueDeg = (health.total / 100) * 180;

  return (
    <div className="card">
      <h3>คะแนนสุขภาพการเงิน</h3>
      <div className="sub">ดัชนีรวม 5 องค์ประกอบถ่วงน้ำหนัก (0–100) — คำนวณด้วยสถิติที่เราออกแบบเอง</div>

      <div className="center">
        <svg viewBox={`0 0 ${W} 160`} style={{ width: '100%', maxWidth: 300 }}>
          <path d={arcPath(cx, cy, r, 0, 180)} fill="none" stroke="var(--border)" strokeWidth="18" strokeLinecap="round" />
          <path
            d={arcPath(cx, cy, r, 0, Math.max(0.1, valueDeg))}
            fill="none"
            stroke={color}
            strokeWidth="18"
            strokeLinecap="round"
          />
          <text x={cx} y={cy - 16} textAnchor="middle" style={{ fontSize: 46, fontWeight: 700, fill: 'var(--text)' }}>
            {Math.round(health.total)}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" style={{ fontSize: 15, fill: color, fontWeight: 600 }}>
            {health.grade}
          </text>
        </svg>
      </div>

      <div style={{ marginTop: 6 }}>
        {health.components.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
            <div className="row between" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === c.id ? null : c.id)}>
              <div className="row" style={{ gap: 8 }}>
                <span className="dot" style={{ background: scoreColor(c.score) }} />
                <span style={{ fontWeight: 500, fontSize: 14 }}>{c.label}</span>
                <span className="muted" style={{ fontSize: 12 }}>({Math.round(c.weight * 100)}%)</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <b style={{ fontSize: 14 }}>{Math.round(c.score)}</b>
                <span className="muted" style={{ fontSize: 11 }}>{open === c.id ? '▲' : '▼'}</span>
              </div>
            </div>
            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, marginTop: 6 }}>
              <div style={{ width: `${c.score}%`, height: '100%', background: scoreColor(c.score), borderRadius: 99 }} />
            </div>
            {open === c.id && (
              <div style={{ marginTop: 8, fontSize: 12.5 }}>
                <div className="muted">{c.detail}</div>
                <code
                  className="mono"
                  style={{
                    display: 'block',
                    marginTop: 6,
                    padding: '8px 10px',
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    fontSize: 11.5,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {c.formula}
                </code>
                <div className="muted" style={{ marginTop: 4 }}>
                  สมทบคะแนนรวม = {c.score} × {c.weight} = <b>{c.contribution}</b>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
