import { useState } from 'react';
import { useDataScope, type Period } from '../lib/dataScope';
import { startOfMonth, endOfMonth, addMonths, thaiMonthLabel, thaiDayLabel } from '@finflow/shared';

const todayISO = () => new Date().toISOString().slice(0, 10);

/** preset ช่วงเวลา คำนวณเทียบกับวันนี้จริง */
function buildPresets(): { key: string; label: string; period: Period }[] {
  const t = todayISO();
  const y = Number(t.slice(0, 4));
  const monthsAgo = (n: number) => startOfMonth(addMonths(t, -n));
  return [
    { key: 'this', label: 'เดือนนี้', period: { from: startOfMonth(t), to: endOfMonth(t), label: thaiMonthLabel(t.slice(0, 7)) } },
    { key: '3', label: '3 เดือน', period: { from: monthsAgo(2), to: endOfMonth(t), label: '3 เดือนล่าสุด' } },
    { key: '6', label: '6 เดือน', period: { from: monthsAgo(5), to: endOfMonth(t), label: '6 เดือนล่าสุด' } },
    { key: '12', label: '12 เดือน', period: { from: monthsAgo(11), to: endOfMonth(t), label: '12 เดือนล่าสุด' } },
    { key: 'year', label: 'ปีนี้', period: { from: `${y}-01-01`, to: `${y}-12-31`, label: `ปี ${y + 543}` } },
    { key: 'all', label: 'ทั้งหมด', period: { from: null, to: null, label: 'ทั้งหมด' } },
  ];
}

const dateInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '5px 7px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 11.5,
};

/**
 * ตัวเลือกช่วงเวลา global — วางใน sidebar (มีผลทุกหน้าผ่าน useApi/withScope)
 * 3 วิธี: preset · เดินทีละเดือน (◀ ▶) · กำหนดช่วงเอง (from–to)
 */
export default function PeriodPicker() {
  const { period, setPeriod } = useDataScope();
  const [open, setOpen] = useState(false);
  const [cf, setCf] = useState(period.from ?? '');
  const [ct, setCt] = useState(period.to ?? '');

  const presets = buildPresets();
  const matches = (p: Period) => p.from === period.from && p.to === period.to;

  // เดินทีละเดือน: อิงเดือนของ "ปลายช่วง" ปัจจุบัน (ถ้าเป็นทั้งหมดใช้เดือนนี้)
  const stepBase = (period.to ?? todayISO()).slice(0, 7) + '-01';
  const setMonth = (firstDay: string) =>
    setPeriod({ from: startOfMonth(firstDay), to: endOfMonth(firstDay), label: thaiMonthLabel(firstDay.slice(0, 7)) });

  const applyCustom = () =>
    setPeriod({
      from: cf || null,
      to: ct || null,
      label: cf && ct ? `${thaiDayLabel(cf)} – ${thaiDayLabel(ct)}` : cf ? `ตั้งแต่ ${thaiDayLabel(cf)}` : `ถึง ${thaiDayLabel(ct)}`,
    });

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 5 }}>ช่วงเวลา</div>
      <button
        className="btn"
        style={{ width: '100%', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen((o) => !o)}
        title="เลือกช่วงเวลาที่จะดู — มีผลทุกหน้า"
      >
        <span>📅 {period.label}</span>
        <span style={{ opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <div className="row wrap" style={{ gap: 5 }}>
            {presets.map((p) => (
              <button
                key={p.key}
                className={`btn ${matches(p.period) ? 'primary' : ''}`}
                style={{ padding: '5px 8px', fontSize: 11.5 }}
                onClick={() => setPeriod(p.period)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="row between" style={{ marginTop: 10, gap: 6, alignItems: 'center' }}>
            <button className="btn" style={{ padding: '5px 11px' }} onClick={() => setMonth(addMonths(stepBase, -1))} title="เดือนก่อนหน้า">◀</button>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{thaiMonthLabel(stepBase.slice(0, 7))}</span>
            <button className="btn" style={{ padding: '5px 11px' }} onClick={() => setMonth(addMonths(stepBase, 1))} title="เดือนถัดไป">▶</button>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }}>กำหนดช่วงเอง</div>
            <div className="row" style={{ gap: 5 }}>
              <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} style={dateInput} aria-label="วันเริ่ม" />
              <input type="date" value={ct} onChange={(e) => setCt(e.target.value)} style={dateInput} aria-label="วันจบ" />
            </div>
            <button
              className="btn primary"
              style={{ width: '100%', marginTop: 6, padding: '5px', fontSize: 11.5 }}
              disabled={!cf && !ct}
              onClick={applyCustom}
            >
              ใช้ช่วงนี้
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
