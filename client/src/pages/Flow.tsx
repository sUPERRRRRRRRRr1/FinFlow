import { useState } from 'react';
import { useApi } from '../lib/api';
import type { SankeyGraph } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import SankeyChart from '../components/SankeyChart';
import { thb } from '../lib/format';

const ctrl: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 13,
};

export default function Flow() {
  const [month, setMonth] = useState(''); // '' = ทุกเดือน (จริง/เดโม คุมจาก toggle กลาง)

  const path = `/analytics/sankey${month ? `?month=${month}` : ''}`;
  const state = useApi<SankeyGraph>(path);

  return (
    <>
      <PageHead title="เส้นทางการไหลของเงิน" desc="รายรับ → เงินรวม → หมวดรายจ่าย/ออม ข้ามทุกกระเป๋า (Sankey)" />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 10, alignItems: 'center' }}>
          <div className="sub" style={{ marginBottom: 0 }}>
            {month ? `กำลังดูเฉพาะ ${month}` : 'ดูรวมทุกเดือน'} · เลือกเดือนเพื่อดูการไหลของเงินทีละเดือน
          </div>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={ctrl} />
            {month && (
              <button className="btn" style={{ padding: '6px 12px' }} onClick={() => setMonth('')}>
                ทุกเดือน
              </button>
            )}
          </div>
        </div>
      </div>

      <Async state={state} height={420}>
        {(g) => (
          <>
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="row between wrap">
                <div>
                  <h3>ตรวจสมดุลการไหล (Flow Conservation)</h3>
                  <div className="sub" style={{ marginBottom: 0 }}>
                    ทุกโนดกลางต้องมีเงินเข้า = เงินออก เพื่อยืนยันความถูกต้องของข้อมูล
                  </div>
                </div>
                <span className={`badge ${g.balance.balanced ? 'good' : 'alert'}`}>
                  {g.balance.balanced ? '✅ สมดุล' : '⚠️ ไม่สมดุล'} · คลาดเคลื่อนสูงสุด {thb(g.balance.maxImbalance)}
                </span>
              </div>
            </div>
            {g.links.length === 0 ? (
              <div className="card muted" style={{ textAlign: 'center', padding: 40 }}>
                ไม่มีข้อมูลในช่วงที่เลือก — ลองเปลี่ยนเดือนหรือเลือก "ทุกเดือน"
              </div>
            ) : (
              <div className="card">
                <SankeyChart graph={g} />
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}
