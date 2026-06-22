import { useEffect, useState } from 'react';
import { useApi, apiSend, apiGet } from '../lib/api';
import type { TaxOverviewResponse, TaxProfile, Deductions } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { thb } from '../lib/format';
import TaxPlanner from '../components/TaxPlanner';

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
      await apiSend('/tax', 'PUT', profile);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const setDed = (key: keyof Deductions, value: number | boolean) =>
    setProfile((p) => ({ ...p, deductions: { ...p.deductions, [key]: value } }));

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
