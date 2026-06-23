import { useState } from 'react';
import type { HealthScore, ScorePillar, ScoreProfile } from '../lib/types';
import { apiSend } from '../lib/api';

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

const PROFILE_LABEL: Record<ScoreProfile, string> = {
  student: 'นักเรียน',
  adult: 'ผู้ใหญ่',
};

export default function HealthScoreGauge({
  health,
  onProfileChange,
}: {
  health: HealthScore;
  onProfileChange?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const W = 260;
  const cx = W / 2;
  const cy = 140;
  const r = 100;
  const color = scoreColor(health.total);
  const valueDeg = (health.total / 100) * 180;

  const setProfile = async (p: ScoreProfile) => {
    if (p === health.profile || saving) return;
    setSaving(true);
    try {
      await apiSend('/score-profile', 'PUT', { profile: p });
      onProfileChange?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>คะแนนสุขภาพการเงิน</h3>
          <div className="sub">4 เสาแบบ FinHealth (ใช้จ่าย·ออม·กู้ยืม·วางแผน) คำนวณจากอัตราส่วนการเงินจริงตามเกณฑ์ SET/ธปท.</div>
        </div>
        {/* โปรไฟล์เกณฑ์: นักเรียน / ผู้ใหญ่ */}
        <div className="row" style={{ gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          {(['student', 'adult'] as ScoreProfile[]).map((p) => (
            <button
              key={p}
              onClick={() => setProfile(p)}
              disabled={saving}
              style={{
                padding: '6px 12px',
                fontSize: 12.5,
                fontFamily: 'inherit',
                border: 'none',
                cursor: saving ? 'default' : 'pointer',
                background: health.profile === p ? 'var(--brand)' : 'transparent',
                color: health.profile === p ? '#fff' : 'var(--muted)',
                fontWeight: health.profile === p ? 600 : 400,
              }}
            >
              {PROFILE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

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
        {health.pillars.map((p) => (
          <PillarRow key={p.id} pillar={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
        ))}
      </div>
    </div>
  );
}

function PillarRow({ pillar, open, onToggle }: { pillar: ScorePillar; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <div className="row between" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <div className="row" style={{ gap: 8 }}>
          <span className="dot" style={{ background: scoreColor(pillar.score) }} />
          <span style={{ fontWeight: 500, fontSize: 14 }}>{pillar.label}</span>
          <span className="muted" style={{ fontSize: 12 }}>({Math.round(pillar.weight * 100)}%)</span>
          {pillar.estimated && (
            <span className="badge warn" style={{ fontSize: 10 }} title="เดาจากธุรกรรม — อาจคลาดเคลื่อน">
              ประมาณ
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <b style={{ fontSize: 14 }}>{Math.round(pillar.score)}</b>
          <span className="muted" style={{ fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, marginTop: 6 }}>
        <div style={{ width: `${pillar.score}%`, height: '100%', background: scoreColor(pillar.score), borderRadius: 99 }} />
      </div>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pillar.metrics.map((m) => (
            <div key={m.id} style={{ fontSize: 12.5, paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
              <div className="row between">
                <span style={{ fontWeight: 500 }}>{m.label}</span>
                <b>{Math.round(m.score)}/100</b>
              </div>
              <div className="muted" style={{ marginTop: 2 }}>{m.detail}</div>
              <code
                className="mono"
                style={{
                  display: 'block',
                  marginTop: 6,
                  padding: '8px 10px',
                  background: 'var(--surface-2)',
                  borderRadius: 8,
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.formula}
              </code>
              <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>📚 {m.reference}</div>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11.5 }}>
            สมทบคะแนนรวม = {pillar.score} × {pillar.weight} = <b>{pillar.contribution}</b>
          </div>
        </div>
      )}
    </div>
  );
}
