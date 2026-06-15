import { useMemo, useState } from 'react';
import { computeHealthScore, CATEGORY_META, EXPENSE_CATEGORIES } from '@finflow/shared';
import type { Transaction, HealthScore } from '@finflow/shared';
import { useApi } from '../lib/api';
import { thb } from '../lib/format';

/**
 * จำลอง "ถ้าลดรายจ่ายหมวด X ลง Y%" แล้วคะแนนสุขภาพการเงินเปลี่ยนเท่าไร
 * คำนวณใหม่ทั้งหมดในเบราว์เซอร์ด้วย stats engine ตัวเดียวกับเซิร์ฟเวอร์ (shared)
 */
export default function WhatIfSimulator({ baseHealth }: { baseHealth: HealthScore }) {
  const { data } = useApi<{ transactions: Transaction[] }>('/transactions');
  const [category, setCategory] = useState('food');
  const [cut, setCut] = useState(20);

  const sim = useMemo(() => {
    if (!data) return null;
    const factor = 1 - cut / 100;
    const modified = data.transactions.map((t) =>
      t.category === category && t.direction === 'out' && !t.isTransfer
        ? { ...t, amount: t.amount * factor }
        : t,
    );
    const newHealth = computeHealthScore(modified);
    const saved = data.transactions
      .filter((t) => t.category === category && t.direction === 'out' && !t.isTransfer)
      .reduce((a, t) => a + t.amount, 0) * (cut / 100);
    return { newHealth, saved };
  }, [data, category, cut]);

  const delta = sim ? Math.round((sim.newHealth.total - baseHealth.total) * 10) / 10 : 0;

  return (
    <div className="card">
      <h3>🔮 จำลองการออม (What-if)</h3>
      <div className="sub">ลองปรับลดหมวดหนึ่ง แล้วดูคะแนนสุขภาพการเงินใหม่ทันที (คำนวณในเครื่องด้วย stats engine ของเรา)</div>

      <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>ลดหมวด</div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              fontSize: 14,
            }}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="row between" style={{ fontSize: 12, marginBottom: 4 }}>
            <span className="muted">ลดลง</span>
            <b>{cut}%</b>
          </div>
          <input type="range" min={0} max={100} step={5} value={cut} onChange={(e) => setCut(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
      </div>

      {sim && (
        <div className="row wrap between" style={{ marginTop: 16, gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>คะแนนใหม่</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>
              {Math.round(sim.newHealth.total)}{' '}
              <span style={{ fontSize: 16 }} className={delta >= 0 ? 'down' : 'up'}>
                ({delta >= 0 ? '+' : ''}{delta})
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{sim.newHealth.grade}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 12 }}>ประหยัดได้รวม</div>
            <div className="down" style={{ fontSize: 24, fontWeight: 700 }}>{thb(sim.saved)}</div>
            <div className="muted" style={{ fontSize: 12 }}>ตลอดช่วงข้อมูล</div>
          </div>
        </div>
      )}
    </div>
  );
}
