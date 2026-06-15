import { useApi } from '../lib/api';
import type { AnomaliesData } from '../lib/types';
import { PageHead, Async, Empty, Stat } from '../components/ui';
import { thb } from '../lib/format';

export default function Anomalies() {
  const state = useApi<AnomaliesData>('/analytics/anomalies');
  return (
    <>
      <PageHead
        title="ตรวจจับรายจ่ายผิดปกติ"
        desc="แจ้งเตือนวันที่ใช้จ่ายสูงผิดปกติด้วย z-score (z>2) และขอบ IQR แบบ far-out"
      />
      <Async state={state} height={300}>
        {(d) => (
          <>
            <div className="grid cols-3" style={{ marginBottom: 18 }}>
              <Stat label="ค่าเฉลี่ยรายจ่าย/วัน" value={thb(d.meanDaily)} />
              <Stat label="ส่วนเบี่ยงเบนมาตรฐาน (SD)" value={thb(d.sd)} />
              <Stat label="เกณฑ์เตือน (Q3+3·IQR)" value={thb(d.upperFence)} />
            </div>

            {d.outliers.length === 0 ? (
              <Empty text="ไม่พบวันที่ใช้จ่ายผิดปกติ — เยี่ยมมาก!" />
            ) : (
              <div className="grid" style={{ gap: 14 }}>
                {d.outliers.map((o) => (
                  <div key={o.date} className="card">
                    <div className="row between wrap">
                      <div className="row" style={{ gap: 12 }}>
                        <div style={{ fontSize: 26 }}>🚨</div>
                        <div>
                          <b style={{ fontSize: 16 }}>{o.label}</b>
                          <div className="muted" style={{ fontSize: 12 }}>{o.date}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="up" style={{ fontSize: 20, fontWeight: 700 }}>{thb(o.amount)}</div>
                        <span className="badge alert">z = {o.z}</span>
                      </div>
                    </div>
                    <table className="tbl" style={{ marginTop: 10 }}>
                      <tbody>
                        {o.transactions.slice(0, 5).map((t, i) => (
                          <tr key={i}>
                            <td>{t.counterparty}</td>
                            <td className="muted" style={{ width: 130 }}>{t.categoryLabel}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{thb(t.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}
