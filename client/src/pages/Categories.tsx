import { useApi } from '../lib/api';
import type { CategoriesData } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb, pct } from '../lib/format';

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 96;
  const h = 30;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function heatColor(v: number, max: number): string {
  if (max <= 0 || v <= 0) return 'var(--surface-2)';
  const t = Math.min(1, v / max);
  return `color-mix(in srgb, var(--brand) ${Math.round(t * 100)}%, var(--surface-2))`;
}

export default function Categories() {
  const state = useApi<CategoriesData>('/analytics/categories');
  return (
    <>
      <PageHead
        title="แนวโน้มรายหมวด"
        desc="% เปลี่ยนแปลง · z-score เทียบ baseline ตัวเอง · ความชันเทรนด์ระยะยาว"
      />
      <Async state={state} height={360}>
        {(d) => (
          <div className="grid" style={{ gap: 18 }}>
            <div className="grid cols-3">
              {d.trends.map((t) => {
                const dirClass = t.direction === 'up' ? 'up' : t.direction === 'down' ? 'down' : 'flat';
                const arrow = t.direction === 'up' ? '▲' : t.direction === 'down' ? '▼' : '—';
                return (
                  <div key={t.category} className="card">
                    <div className="row between">
                      <b style={{ color: t.color }}>{t.label}</b>
                      {t.baselineZ > 2 && <span className="badge alert">พุ่งผิดปกติ z={t.baselineZ}</span>}
                    </div>
                    <div className="row between" style={{ alignItems: 'flex-end', marginTop: 6 }}>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>{thb(t.current)}</div>
                        <div className={dirClass} style={{ fontSize: 13, fontWeight: 600 }}>
                          {arrow} {pct(Math.abs(t.pctChange))} <span className="muted">vs เดือนก่อน</span>
                        </div>
                      </div>
                      <Sparkline data={t.series} color={t.color} />
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                      เทรนด์ระยะยาว (slope): <b className={t.slope > 0 ? 'up' : t.slope < 0 ? 'down' : 'flat'}>{thb(t.slope)}/เดือน</b>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card" style={{ overflowX: 'auto' }}>
              <h3>Heatmap หมวด × เดือน</h3>
              <div className="sub">เข้มขึ้น = ใช้จ่ายมากขึ้น (เทียบในหมวดเดียวกัน)</div>
              <table className="tbl" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>หมวด</th>
                    {d.heatmap.months.map((m) => (
                      <th key={m.key} style={{ textAlign: 'center' }}>{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.heatmap.categories.map((c) => {
                    const max = Math.max(...c.values, 1);
                    return (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className="dot" style={{ background: c.color, marginRight: 6 }} />
                          {c.label}
                        </td>
                        {c.values.map((v, i) => (
                          <td
                            key={i}
                            title={thb(v)}
                            style={{ textAlign: 'center', background: heatColor(v, max), fontSize: 11, borderRadius: 4 }}
                          >
                            {v > 0 ? Math.round(v / 1000) + 'k' : '·'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
