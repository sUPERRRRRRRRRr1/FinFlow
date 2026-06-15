import { useApi } from '../lib/api';
import type { SankeyGraph } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import SankeyChart from '../components/SankeyChart';
import { thb } from '../lib/format';

export default function Flow() {
  const state = useApi<SankeyGraph>('/analytics/sankey');
  return (
    <>
      <PageHead title="เส้นทางการไหลของเงิน" desc="รายรับ → เงินรวม → หมวดรายจ่าย/ออม ข้ามทุกกระเป๋า (Sankey)" />
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
            <div className="card">
              <SankeyChart graph={g} />
            </div>
          </>
        )}
      </Async>
    </>
  );
}
