import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export function PageHead({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="page-head row between wrap" style={{ gap: 12 }}>
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function Loading({ height = 120 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card center" style={{ color: 'var(--alert)' }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
      <div>เกิดข้อผิดพลาด: {message}</div>
      {onRetry && (
        <button className="btn" style={{ marginTop: 12 }} onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="card center muted" style={{ padding: 40 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
      {text}
    </div>
  );
}

export type Trend = { dir: 'up' | 'down' | 'flat'; text: string; tone?: 'good' | 'bad' | 'muted' };

function TrendChip({ dir, text, tone = 'muted' }: Trend) {
  const cls = tone === 'good' ? 'good' : tone === 'bad' ? 'alert' : '';
  const Arrow = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  return (
    <span className={`badge ${cls}`} style={{ marginTop: 8, fontSize: 11.5 }}>
      <Arrow size={13} strokeWidth={2.5} />
      {text}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  trend?: Trend;
}) {
  return (
    <div
      className="card stat"
      style={accent ? { boxShadow: `var(--shadow), inset 3px 0 0 ${accent}` } : undefined}
    >
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {trend && <TrendChip {...trend} />}
      {sub && <div style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/** วนสถานะ async มาตรฐาน */
export function Async<T>({
  state,
  children,
  height,
}: {
  state: { data: T | null; loading: boolean; error: string | null; refetch: () => void };
  children: (data: T) => ReactNode;
  height?: number;
}) {
  if (state.loading && !state.data) return <Loading height={height} />;
  if (state.error) return <ErrorBox message={state.error} onRetry={state.refetch} />;
  if (!state.data) return null;
  return <>{children(state.data)}</>;
}
