import { useState } from 'react';
import { useApi, apiSend } from '../lib/api';
import type { SystemStatus } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { extractPdfText, PdfPasswordError } from '../lib/pdf';

export default function Connect() {
  const status = useApi<SystemStatus>('/status');

  return (
    <>
      <PageHead title="เชื่อมต่อข้อมูล" desc="ดึงจาก Gmail · อัปโหลด statement/สลิป · จัดการข้อมูล" />
      <Async state={status} height={200}>
        {(s) => (
          <div className="grid" style={{ gap: 18 }}>
            <div className="grid cols-3">
              <div className="card">
                <h3>สถานะระบบ</h3>
                <div className="row between" style={{ fontSize: 14, marginTop: 8 }}>
                  <span>ข้อมูลในระบบ</span><b>{s.transactions} รายการ</b>
                </div>
                <div className="row between" style={{ fontSize: 14, marginTop: 6 }}>
                  <span>Gemini AI</span>
                  <span className={`badge ${s.features.geminiEnabled ? 'good' : ''}`}>{s.features.geminiEnabled ? 'เปิด' : 'โหมด fallback'}</span>
                </div>
                <div className="row between" style={{ fontSize: 14, marginTop: 6 }}>
                  <span>Gmail</span>
                  <span className={`badge ${s.features.gmailConnected ? 'good' : s.features.gmailConfigured ? 'info' : ''}`}>
                    {s.features.gmailConnected ? 'เชื่อมแล้ว' : s.features.gmailConfigured ? 'ตั้งค่าแล้ว' : 'โหมดเดโม'}
                  </span>
                </div>
              </div>

              <GmailCard configured={s.features.gmailConfigured} connected={s.features.gmailConnected} onChange={status.refetch} />

              <div className="card">
                <h3>จัดการข้อมูล</h3>
                <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={async () => {
                      await apiSend('/ingest/demo', 'POST');
                      status.refetch();
                      alert('รีเซ็ตข้อมูลตัวอย่างแล้ว');
                    }}
                  >
                    🔄 รีเซ็ตข้อมูลตัวอย่าง
                  </button>
                  <a className="btn" href="/api/export/csv">⬇️ ส่งออก CSV</a>
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!confirm('ลบข้อมูลทั้งหมด?')) return;
                      await apiSend('/transactions', 'DELETE');
                      status.refetch();
                    }}
                  >
                    🗑️ ล้างข้อมูลทั้งหมด
                  </button>
                </div>
              </div>
            </div>

            <div className="grid cols-2">
              <StatementUpload onDone={status.refetch} />
              <SlipUpload onDone={status.refetch} geminiEnabled={s.features.geminiEnabled} />
            </div>

            <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
              <h3>🔒 ความเป็นส่วนตัว (Responsible AI / PDPA)</h3>
              <ul style={{ fontSize: 13.5, color: 'var(--muted)', paddingLeft: 18, marginTop: 8, lineHeight: 1.9 }}>
                <li>เชื่อม Gmail แบบ <b>อ่านอย่างเดียว</b> (gmail.readonly) กรองเฉพาะเมลธนาคาร/กระเป๋าเงิน</li>
                <li><b>ปลดล็อค PDF ในเครื่องคุณ</b> รหัสผ่านไม่ถูกส่งออกนอกเบราว์เซอร์ ส่งเฉพาะข้อความที่สกัดได้</li>
                <li><b>กรองข้อมูลอ่อนไหว</b> (เลขบัญชี/เลขบัตร) ออกก่อนส่งให้ AI</li>
                <li>ไม่เก็บอีเมล/ไฟล์ถาวร เก็บเฉพาะข้อมูลธุรกรรมที่จำเป็น</li>
              </ul>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}

function GmailCard({ configured, connected, onChange }: { configured: boolean; connected: boolean; onChange: () => void }) {
  return (
    <div className="card">
      <h3>เชื่อมต่อ Gmail</h3>
      {!configured ? (
        <div className="sub" style={{ marginTop: 8 }}>
          โหมดเดโม — ยังไม่ได้ตั้งค่า OAuth ใส่ <code className="mono">GMAIL_CLIENT_ID/SECRET</code> ใน <code className="mono">.env</code> เพื่อดึงเมลจริง
        </div>
      ) : connected ? (
        <>
          <div className="badge good" style={{ marginTop: 8 }}>✅ เชื่อมต่อแล้ว</div>
          <button
            className="btn primary"
            style={{ marginTop: 10, width: '100%' }}
            onClick={async () => {
              const r = await apiSend<{ added: number }>('/ingest/gmail', 'POST');
              alert(`ดึงจาก Gmail แล้ว เพิ่ม ${r.added} รายการ (statement + สลิปรูปที่ OCR ได้)`);
              onChange();
            }}
          >
            📥 ดึงเมลธนาคาร + สลิปล่าสุด
          </button>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            ดึง statement/แจ้งเตือน + รูปสลิปแนบมา OCR ให้ (สลิปรูปต้องมี Gemini key)
          </div>
        </>
      ) : (
        <a className="btn primary" style={{ marginTop: 10, width: '100%' }} href="/api/auth/google">
          🔗 เชื่อมต่อ Gmail (อ่านอย่างเดียว)
        </a>
      )}
    </div>
  );
}

function StatementUpload({ onDone }: { onDone: () => void }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwFile, setPwFile] = useState<File | null>(null);
  const [pw, setPw] = useState('');

  const process = async (file: File, password?: string) => {
    setBusy(true);
    setMsg('กำลังอ่านไฟล์ในเครื่อง…');
    try {
      const text = await extractPdfText(file, password);
      setMsg('กำลังแยกรายการ…');
      const r = await apiSend<{ added: number; source: string }>('/ingest/statement', 'POST', {
        text,
        filename: file.name,
      });
      setMsg(`✅ นำเข้าจาก ${r.source} เพิ่ม ${r.added} รายการ`);
      setPwFile(null);
      setPw('');
      onDone();
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setPwFile(file);
        setMsg(e.needsPassword ? '🔑 ไฟล์นี้ใส่รหัส กรุณากรอกรหัส (เช่น วันเกิด DDMMYYYY)' : '❌ รหัสไม่ถูกต้อง ลองใหม่');
      } else {
        setMsg('❌ ' + (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>อัปโหลด Statement (PDF)</h3>
      <div className="sub">ปลดล็อค + อ่านในเครื่องคุณ (KBank / Make / TrueMoney) แล้วส่งเฉพาะข้อความ</div>
      <input
        type="file"
        accept="application/pdf"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) process(f);
        }}
      />
      {pwFile && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            type="password"
            placeholder="รหัสผ่าน PDF"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <button className="btn primary" disabled={busy || !pw} onClick={() => process(pwFile, pw)}>
            ปลดล็อค
          </button>
        </div>
      )}
      {msg && <div style={{ fontSize: 13, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

function SlipUpload({ onDone, geminiEnabled }: { onDone: () => void; geminiEnabled: boolean }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    setMsg('กำลังอ่านสลิป…');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await apiSend<{ added: number; parsed: { amount: number; counterparty: string } }>('/ingest/slip', 'POST', {
        imageBase64: base64,
        mimeType: file.type,
      });
      setMsg(`✅ อ่านสลิปได้: ${r.parsed.counterparty} ${r.parsed.amount} บาท`);
      onDone();
    } catch (e) {
      setMsg('❌ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>อัปโหลดสลิป (รูปภาพ)</h3>
      <div className="sub">
        OCR ด้วย Gemini {geminiEnabled ? '(เปิดใช้งาน)' : '— ต้องใส่ GEMINI_API_KEY ก่อน'}
      </div>
      <input type="file" accept="image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {msg && <div style={{ fontSize: 13, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
