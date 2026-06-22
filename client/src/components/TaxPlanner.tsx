import { useMemo, useState } from 'react';
import { computeTax, getRules } from '@finflow/shared';
import type { TaxProfile, SavingSuggestion } from '../lib/types';
import { thb } from '../lib/format';

/**
 * วางแผนประหยัดภาษีสด: เลือกช่องลดหย่อน + เลื่อนจำนวน → ภาษีใหม่คำนวณทันทีในเครื่อง
 * ใช้ engine ตัวเดียวกับเซิร์ฟเวอร์ (shared) — ตัวเลขจึงตรงกันเสมอ
 */
export default function TaxPlanner({
  profile,
  suggestions,
  baseTax,
}: {
  profile: TaxProfile;
  suggestions: SavingSuggestion[];
  baseTax: number;
}) {
  const [pick, setPick] = useState(suggestions[0]?.id ?? '');
  const current = suggestions.find((s) => s.id === pick);
  const [amount, setAmount] = useState(current?.room ?? 0);

  const newTax = useMemo(() => {
    if (!current) return baseTax;
    const key = current.id as keyof TaxProfile['deductions'];
    const modified: TaxProfile = {
      ...profile,
      deductions: { ...profile.deductions, [key]: (Number(profile.deductions[key]) || 0) + amount },
    };
    return computeTax(modified, getRules(profile.taxYear)).taxBeforeCredit;
  }, [current, amount, profile, baseTax]);

  const saved = Math.max(0, baseTax - newTax);

  if (suggestions.length === 0)
    return (
      <div className="card">
        <h3>🎯 วางแผนประหยัดภาษี</h3>
        <div className="sub">เงินได้สุทธิยังไม่ถึงเกณฑ์เสียภาษี (อัตราขั้นสุดท้าย 0%) — ยังไม่มีคำแนะนำประหยัดภาษี</div>
      </div>
    );

  return (
    <div className="card">
      <h3>🎯 วางแผนประหยัดภาษี</h3>
      <div className="sub">เลือกช่องลดหย่อนแล้วเลื่อนจำนวน ดูภาษีที่ประหยัดได้ทันที (คำนวณในเครื่องด้วย engine ของเรา)</div>

      <div className="row wrap" style={{ gap: 14, alignItems: 'center', marginTop: 8 }}>
        <select
          value={pick}
          onChange={(e) => {
            setPick(e.target.value);
            setAmount(suggestions.find((s) => s.id === e.target.value)?.room ?? 0);
          }}
          style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
        >
          {suggestions.map((s) => (
            <option key={s.id} value={s.id}>{s.label} (เหลือ {thb(s.room)})</option>
          ))}
        </select>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="row between" style={{ fontSize: 12 }}>
            <span className="muted">จำนวนเงิน</span>
            <b>{thb(amount)}</b>
          </div>
          <input type="range" min={0} max={current?.room ?? 0} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
      </div>

      <div className="row wrap between" style={{ marginTop: 14, gap: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>ภาษีใหม่</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{thb(newTax)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 12 }}>ประหยัดได้</div>
          <div className="down" style={{ fontSize: 24, fontWeight: 700 }}>{thb(saved)}</div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {suggestions.map((s) => (
          <div key={s.id} className="row between" style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
            <span>{s.label} <span className="muted">· {s.ref}</span></span>
            <span>ซื้อเพิ่มได้ {thb(s.room)} → ประหยัด ~<b className="down">{thb(s.estimatedSaving)}</b></span>
          </div>
        ))}
      </div>
    </div>
  );
}
