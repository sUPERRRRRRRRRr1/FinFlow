import { useEffect, useState } from 'react';
import { useApi, apiSend, apiGet } from '../lib/api';
import type { TaxOverviewResponse, TaxProfile, Deductions, IncomeItem, IncomeType } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb } from '../lib/format';
import TaxPlanner from '../components/TaxPlanner';

const INCOME_TYPES: { value: IncomeType; label: string }[] = [
  { value: '40(1)', label: '40(1) เงินเดือน' },
  { value: '40(2)', label: '40(2) รับจ้าง/ฟรีแลนซ์' },
  { value: '40(3)', label: '40(3) ลิขสิทธิ์' },
  { value: '40(4)', label: '40(4) ดอกเบี้ย/ปันผล' },
  { value: '40(5)', label: '40(5) ค่าเช่า' },
  { value: '40(6)', label: '40(6) วิชาชีพอิสระ' },
  { value: '40(7)', label: '40(7) รับเหมา' },
  { value: '40(8)', label: '40(8) ธุรกิจอื่นๆ' },
];

const DEDUCTION_FIELDS: { key: keyof Deductions; label: string; type: 'number' | 'bool' }[] = [
  { key: 'spouse', label: 'คู่สมรส (ไม่มีเงินได้)', type: 'bool' },
  { key: 'children', label: 'จำนวนบุตร', type: 'number' },
  { key: 'parents', label: 'จำนวนบิดามารดาที่อุปการะ', type: 'number' },
  { key: 'socialSecurity', label: 'ประกันสังคม (บาท)', type: 'number' },
  { key: 'lifeInsurance', label: 'เบี้ยประกันชีวิต (บาท)', type: 'number' },
  { key: 'healthInsurance', label: 'เบี้ยประกันสุขภาพ (บาท)', type: 'number' },
  { key: 'ssf', label: 'SSF (บาท)', type: 'number' },
  { key: 'rmf', label: 'RMF (บาท)', type: 'number' },
  { key: 'thaiEsg', label: 'Thai ESG (บาท)', type: 'number' },
  { key: 'pensionInsurance', label: 'ประกันบำนาญ (บาท)', type: 'number' },
  { key: 'providentFund', label: 'กองทุนสำรองเลี้ยงชีพ (บาท)', type: 'number' },
  { key: 'homeLoanInterest', label: 'ดอกเบี้ยกู้ซื้อบ้าน (บาท)', type: 'number' },
  { key: 'donationGeneral', label: 'เงินบริจาคทั่วไป (บาท)', type: 'number' },
  { key: 'easyEReceipt', label: 'Easy E-Receipt (บาท)', type: 'number' },
];

export default function Tax() {
  const state = useApi<TaxOverviewResponse>('/tax');
  return (
    <>
      <PageHead title="ภาษีเงินได้บุคคลธรรมดา" desc="ประมาณการภาษีตามกฎหมายไทย (ปีภาษี 2567) — ตัวเลขคำนวณด้วยสูตรของเราเอง" />
      <div className="card" style={{ borderColor: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 8%, transparent)' }}>
        ⚠️ <b>ประมาณการ ไม่ใช่คำปรึกษาภาษีตามกฎหมาย</b> — ควรตรวจสอบกับกรมสรรพากรหรือนักบัญชีก่อนยื่นจริง
      </div>
      <Async state={state} height={500}>
        {(o) => <TaxBody o={o} reload={state.refetch} />}
      </Async>
    </>
  );
}

function TaxBody({ o, reload }: { o: TaxOverviewResponse; reload: () => void }) {
  const [profile, setProfile] = useState<TaxProfile>(o.profile);
  const [saving, setSaving] = useState(false);
  useEffect(() => setProfile(o.profile), [o.profile]);

  const save = async () => {
    setSaving(true);
    try {
      await apiSend('/tax', 'PUT', { ...profile, income: profile.income.map((i) => ({ ...i, source: 'user' })) });
      reload();
    } finally {
      setSaving(false);
    }
  };

  const setDed = (key: keyof Deductions, value: number | boolean) =>
    setProfile((p) => ({ ...p, deductions: { ...p.deductions, [key]: value } }));

  const setIncome = (income: IncomeItem[]) => setProfile((p) => ({ ...p, income }));
  const updateIncome = (idx: number, patch: Partial<IncomeItem>) =>
    setIncome(profile.income.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addIncome = () => setIncome([...profile.income, { type: '40(1)', amount: 0, source: 'user' }]);
  const removeIncome = (idx: number) => setIncome(profile.income.filter((_, i) => i !== idx));

  const r = o.result;
  return (
    <div className="grid" style={{ gap: 18 }}>
      {o.annualized && (
        <div className="card sub">📅 ประมาณการทั้งปีจากข้อมูล {o.dataMonths} เดือน (×{(12 / o.dataMonths).toFixed(1)})</div>
      )}

      <div className="grid cols-2">
        {/* ผลลัพธ์ */}
        <div className="card">
          <h3>ผลการคำนวณภาษี</h3>
          <Row label="เงินได้พึงประเมิน" value={thb(r.grossTaxable)} />
          <Row label="หักค่าใช้จ่าย" value={`− ${thb(r.expenseDeduction)}`} />
          <Row label="หักค่าลดหย่อนรวม" value={`− ${thb(r.totalAllowances)}`} />
          <Row label="เงินได้สุทธิ" value={<b>{thb(r.netIncome)}</b>} />
          <hr />
          <Row label="ภาษีตามขั้นบันได" value={thb(r.progressiveTax)} />
          {r.minimumTax > 0 && <Row label="ภาษีวิธีขั้นต่ำ 0.5%" value={thb(r.minimumTax)} />}
          <Row label="ภาษีก่อนหักเครดิต" value={thb(r.taxBeforeCredit)} />
          <Row label="หัก ณ ที่จ่าย (เครดิต)" value={`− ${thb(r.withholdingCredit)}`} />
          <Row
            label={r.taxDue >= 0 ? 'ต้องจ่ายเพิ่ม' : 'ขอคืนได้'}
            value={<b className={r.taxDue >= 0 ? 'up' : 'down'}>{thb(Math.abs(r.taxDue))}</b>}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            อัตราภาษีเฉลี่ย {(r.effectiveRate * 100).toFixed(1)}% · อัตราขั้นสุดท้าย {(r.marginalRate * 100).toFixed(0)}%
          </div>
          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>ดูค่าลดหย่อนที่ใช้ + มาตรา</summary>
            {r.allowanceBreakdown.map((a) => (
              <div key={a.id} className="row between" style={{ fontSize: 12.5, padding: '3px 0' }}>
                <span>{a.label} <span className="muted">({a.ref})</span></span>
                <span>{thb(a.used)}</span>
              </div>
            ))}
          </details>
        </div>

        {/* ยื่นภาษี + VAT */}
        <div className="grid" style={{ gap: 18, alignContent: 'start' }}>
          <div className="card">
            <h3>การยื่นภาษี</h3>
            <Row label="ต้องยื่นแบบ" value={o.filing.mustFile ? `ใช่ (${o.filing.form})` : 'ไม่ถึงเกณฑ์'} />
            <Row label="กำหนดยื่น (กระดาษ)" value={o.filing.deadlinePaper} />
            <Row label="กำหนดยื่น (ออนไลน์)" value={o.filing.deadlineOnline} />
            {o.filing.refundable > 0 && <Row label="ขอคืนได้" value={<b className="down">{thb(o.filing.refundable)}</b>} />}
          </div>
          <div className="card">
            <h3>VAT ที่จ่าย (เชิงข้อมูล)</h3>
            <div className="sub">บุคคลธรรมดาทั่วไปไม่ใช่ผู้เสีย VAT — นี่คือ VAT แฝงในยอดซื้อ (7/107)</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{thb(o.vatPaidEstimate)}</div>
          </div>
        </div>
      </div>

      {/* ฟอร์มเงินได้ */}
      <div className="card">
        <h3>เงินได้ของคุณ (ทั้งปี)</h3>
        <div className="sub">ระบบเดาให้จากธุรกรรมเท่าที่ทำได้ — โปรดตรวจ/แก้ให้ตรงจริง แยกตามประเภทเงินได้ (ม.40)</div>
        {profile.income.length === 0 && (
          <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>ยังไม่มีรายการ — กด "เพิ่มรายได้"</div>
        )}
        {profile.income.map((it, idx) => (
          <div key={idx} className="row wrap" style={{ gap: 8, alignItems: 'center', padding: '6px 0', borderTop: idx ? '1px solid var(--border)' : 'none' }}>
            <select value={it.type} onChange={(e) => updateIncome(idx, { type: e.target.value as IncomeType })}
              style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}>
              {INCOME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="muted" style={{ fontSize: 12 }}>จำนวน
              <input type="number" min={0} value={it.amount || 0} onChange={(e) => updateIncome(idx, { amount: Number(e.target.value) })} style={{ width: 110, marginLeft: 4, textAlign: 'right' }} />
            </label>
            <label className="muted" style={{ fontSize: 12 }}>หัก ณ ที่จ่าย
              <input type="number" min={0} value={it.withholding || 0} onChange={(e) => updateIncome(idx, { withholding: Number(e.target.value) })} style={{ width: 90, marginLeft: 4, textAlign: 'right' }} />
            </label>
            {it.type === '40(4)' && (
              <label className="muted" style={{ fontSize: 12 }}>
                <input type="checkbox" checked={!!it.dividend} onChange={(e) => updateIncome(idx, { dividend: e.target.checked })} /> เงินปันผล
              </label>
            )}
            <button className="btn" onClick={() => removeIncome(idx)} style={{ padding: '4px 10px' }}>ลบ</button>
          </div>
        ))}
        <button className="btn" style={{ marginTop: 10 }} onClick={addIncome}>＋ เพิ่มรายได้</button>
        <div className="row wrap" style={{ gap: 16, marginTop: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={profile.married} onChange={(e) => setProfile((p) => ({ ...p, married: e.target.checked }))} /> สมรส (คู่สมรสไม่มีเงินได้)
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={profile.annualize} onChange={(e) => setProfile((p) => ({ ...p, annualize: e.target.checked }))} /> ประมาณการทั้งปี
          </label>
          <label style={{ fontSize: 13 }}>เงินปันผล:
            <select value={profile.dividendMode} onChange={(e) => setProfile((p) => ({ ...p, dividendMode: e.target.value as 'final' | 'include' }))}
              style={{ marginLeft: 4, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}>
              <option value="final">Final 10% (ไม่รวมคำนวณ)</option>
              <option value="include">นำมารวม + เครดิต</option>
            </select>
          </label>
        </div>
      </div>

      {/* ฟอร์มค่าลดหย่อน */}
      <div className="card">
        <h3>ค่าลดหย่อน</h3>
        <div className="grid cols-2" style={{ gap: 10 }}>
          {DEDUCTION_FIELDS.map((f) => (
            <label key={f.key} className="row between" style={{ fontSize: 14, gap: 10 }}>
              <span>{f.label}</span>
              {f.type === 'bool' ? (
                <input type="checkbox" checked={!!profile.deductions[f.key]} onChange={(e) => setDed(f.key, e.target.checked)} />
              ) : (
                <input
                  type="number" min={0} style={{ width: 130, textAlign: 'right' }}
                  value={Number(profile.deductions[f.key]) || 0}
                  onChange={(e) => setDed(f.key, Number(e.target.value))}
                />
              )}
            </label>
          ))}
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
          {saving ? 'กำลังบันทึก…' : '💾 บันทึก & คำนวณใหม่'}
        </button>
      </div>

      <TaxPlanner profile={o.profile} suggestions={o.suggestions} baseTax={r.taxBeforeCredit} />
      <TaxAdviceCard />
    </div>
  );
}

function TaxAdviceCard() {
  const [advice, setAdvice] = useState<{ text: string; source: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const ask = async () => {
    setLoading(true);
    try {
      setAdvice(await apiGet('/tax/advice'));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="card">
      <div className="row between">
        <h3>คำแนะนำภาษีจาก AI</h3>
        <button className="btn primary" onClick={ask} disabled={loading}>
          {loading ? 'กำลังคิด…' : '✨ ขอคำแนะนำภาษี'}
        </button>
      </div>
      {advice ? (
        <>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, marginTop: 10 }}>{advice.text}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            ที่มา: {advice.source === 'groq' ? 'Groq' : advice.source === 'gemini' ? 'Google Gemini' : 'ระบบ rule-based'}
          </div>
        </>
      ) : (
        <div className="sub" style={{ marginTop: 10 }}>กดเพื่อให้ AI สรุปคำแนะนำการวางแผนและประหยัดภาษีจากตัวเลขของคุณ</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row between" style={{ padding: '5px 0', fontSize: 14 }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
