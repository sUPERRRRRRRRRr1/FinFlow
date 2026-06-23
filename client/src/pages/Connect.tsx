import { useEffect, useState } from 'react';
import { ACCOUNT_KIND_META, accountLast4 } from '@finflow/shared';
import type { AccountKind } from '@finflow/shared';
import { useApi, apiSend } from '../lib/api';
import type { SystemStatus, AccountsResponse } from '../lib/types';
import { PageHead, Async } from '../components/ui';
import { extractPdfText, PdfPasswordError } from '../lib/pdf';
import { getStmPassword, setStmPassword, allStmPasswords } from '../lib/accountStore';

const SOURCE_LABEL: Record<string, string> = {
  kbank: 'KBank',
  make: 'Make by KBank',
  truemoney: 'TrueMoney',
  manual: 'บันทึกเอง',
  slip: 'สลิป',
};
const SOURCE_OPTIONS = ['kbank', 'truemoney', 'make', 'manual'] as const;

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
                  <span>AI คำแนะนำ/แชท</span>
                  <span className={`badge ${s.features.groqEnabled || s.features.geminiEnabled ? 'good' : ''}`}>
                    {s.features.groqEnabled ? 'Groq' : s.features.geminiEnabled ? 'Gemini' : 'โหมด fallback'}
                  </span>
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

            <AccountsCard />

            <div className="grid cols-2">
              <StatementUpload onDone={status.refetch} />
              <SlipUpload onDone={status.refetch} groqEnabled={s.features.groqEnabled} geminiEnabled={s.features.geminiEnabled} />
            </div>

            <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
              <h3>🔒 ความเป็นส่วนตัว (Responsible AI / PDPA)</h3>
              <ul style={{ fontSize: 13.5, color: 'var(--muted)', paddingLeft: 18, marginTop: 8, lineHeight: 1.9 }}>
                <li>เชื่อม Gmail แบบ <b>อ่านอย่างเดียว</b> (gmail.readonly) กรองเฉพาะเมลธนาคาร/กระเป๋าเงิน</li>
                <li><b>ปลดล็อค PDF ในเครื่องคุณ</b> รหัสผ่านไม่ถูกส่งออกนอกเบราว์เซอร์ ส่งเฉพาะข้อความที่สกัดได้</li>
                <li><b>รหัส STM เก็บในเบราว์เซอร์</b> (localStorage) — อัปโหลดเองปลดล็อกในเครื่อง · ดึงจาก Gmail ส่งให้เซิร์ฟเวอร์ในเครื่องคุณใช้ปลดล็อกชั่วคราว (ไม่เก็บถาวร ไม่ออกนอกเครื่อง)</li>
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchGmail = async () => {
    setBusy(true);
    setMsg('⏳ กำลังดึงเมลธนาคาร + OCR สลิป… อาจใช้เวลา 30–60 วิ');
    try {
      const call = () =>
        apiSend<{ added: number; busy?: boolean }>('/ingest/gmail', 'POST', { passwords: allStmPasswords() });
      // เลี่ยงชนกับ auto-sync เบื้องหลัง: ถ้า server กำลังดึงอยู่ (busy) ให้รอแล้วลองใหม่อัตโนมัติ
      let r = await call();
      for (let waited = 0; r.busy && waited < 90_000; waited += 3000) {
        setMsg('⏳ ระบบกำลังซิงค์อัตโนมัติเบื้องหลังอยู่ กำลังรอให้เสร็จ…');
        await new Promise((res) => setTimeout(res, 3000));
        r = await call();
      }
      if (r.busy) {
        setMsg('⏳ ยังซิงค์เบื้องหลังไม่เสร็จ ลองกดใหม่อีกครั้งในอีกสักครู่');
      } else {
        setMsg(`✅ ดึงจาก Gmail แล้ว เพิ่ม ${r.added} รายการ (statement + สลิปที่ OCR ได้)`);
        onChange();
      }
    } catch (e) {
      setMsg('❌ ดึงไม่สำเร็จ: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
          <button className="btn primary" style={{ marginTop: 10, width: '100%' }} disabled={busy} onClick={fetchGmail}>
            {busy ? '⏳ กำลังดึง…' : '📥 ดึงเมลธนาคาร + สลิปล่าสุด'}
          </button>
          {msg && <div style={{ fontSize: 13, marginTop: 8 }}>{msg}</div>}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            ดึง statement/แจ้งเตือน + รูปสลิปแนบมา OCR ให้ (ใช้เวลาสักครู่ ขึ้นกับจำนวนเมล)
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

  const ingestText = async (text: string, file: File) => {
    setMsg('กำลังแยกรายการ…');
    const r = await apiSend<{ added: number; source: string }>('/ingest/statement', 'POST', {
      text,
      filename: file.name,
    });
    setMsg(`✅ นำเข้าจาก ${r.source} เพิ่ม ${r.added} รายการ`);
    setPwFile(null);
    setPw('');
    onDone();
  };

  const process = async (file: File, password?: string) => {
    setBusy(true);
    setMsg('กำลังอ่านไฟล์ในเครื่อง…');
    try {
      const text = await extractPdfText(file, password);
      await ingestText(text, file);
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        // ลองรหัส STM ที่บันทึกไว้ในเครื่องอัตโนมัติก่อน (ผู้ใช้ไม่ต้องพิมพ์ซ้ำ)
        if (password === undefined) {
          for (const pw of allStmPasswords()) {
            try {
              const text = await extractPdfText(file, pw);
              await ingestText(text, file);
              return;
            } catch (e2) {
              if (e2 instanceof PdfPasswordError) continue; // รหัสนี้ไม่ตรง ลองตัวถัดไป
              setMsg('❌ ' + (e2 as Error).message);
              return;
            }
          }
        }
        setPwFile(file);
        setMsg(e.needsPassword ? '🔑 ไฟล์นี้ใส่รหัส กรุณากรอกรหัส (เช่น วันเกิด DDMMYYYY) หรือบันทึกไว้ที่การ์ด "บัญชีของฉัน"' : '❌ รหัสไม่ถูกต้อง ลองใหม่');
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

function SlipUpload({ onDone, groqEnabled, geminiEnabled }: { onDone: () => void; groqEnabled: boolean; geminiEnabled: boolean }) {
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
        OCR: {groqEnabled ? 'Groq Llama 4 vision (แต่งรูปอัตโนมัติ)' : geminiEnabled ? 'Google Gemini' : 'Tesseract (offline)'}
      </div>
      <input type="file" accept="image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {msg && <div style={{ fontSize: 13, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

interface EditRow {
  id: string;
  source: string;
  count: number;
  nickname: string;
  kind: AccountKind;
  note: string;
  pw: string;
}

function guessKind(source: string): AccountKind {
  return source === 'truemoney' || source === 'make' ? 'wallet' : 'daily';
}

/** ชื่อเล่นดีฟอลต์ (เมื่อผู้ใช้ไม่ได้ตั้งเอง) — ใช้แบงก์ + เลข 4 ตัวท้าย ให้แยกหลายบัญชีออกจากกัน */
function defaultNickname(id: string, source: string, kind: AccountKind): string {
  const base = SOURCE_LABEL[source] ?? source;
  const last4 = accountLast4(id);
  return last4 ? `${base} ••${last4}` : `${base} · ${ACCOUNT_KIND_META[kind].label}`;
}

function acctInput(width?: number | string): React.CSSProperties {
  return {
    padding: '8px 11px',
    borderRadius: 9,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    fontSize: 13.5,
    width,
  };
}

/**
 * การ์ด "บัญชีของฉัน" — ตั้งค่าว่าแต่ละบัญชีคือบัญชีอะไร (ชื่อเล่น + ประเภท)
 * และบันทึกรหัสไฟล์ STM ของแต่ละบัญชี (เก็บในเครื่องเท่านั้น) ไว้ปลดล็อกอัตโนมัติ
 */
function AccountsCard() {
  const state = useApi<AccountsResponse>('/accounts');
  const [rows, setRows] = useState<EditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const d = state.data;
    if (!d) return;
    const byId = new Map<string, EditRow>();
    for (const det of d.detected) {
      byId.set(det.id, {
        id: det.id, source: det.source, count: det.count,
        nickname: '', kind: guessKind(det.source), note: '', pw: getStmPassword(det.id),
      });
    }
    for (const a of d.accounts) {
      const cur = byId.get(a.id);
      byId.set(a.id, {
        id: a.id, source: a.source, count: cur?.count ?? 0,
        nickname: a.nickname, kind: a.kind, note: a.note ?? '', pw: getStmPassword(a.id),
      });
    }
    setRows([...byId.values()].sort((x, y) => y.count - x.count));
  }, [state.data]);

  const update = (i: number, patch: Partial<EditRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [...rs, { id: '', source: 'kbank', count: 0, nickname: '', kind: 'daily', note: '', pw: '' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      const accounts = rows
        .filter((r) => r.id.trim())
        .map((r) => ({
          id: r.id.trim(),
          source: r.source,
          // ไม่บังคับให้ตั้งชื่อเล่น — เว้นว่างได้ ระบบเติมชื่อดีฟอลต์ให้ (แบงก์ + เลขท้ายบัญชี)
          nickname: r.nickname.trim() || defaultNickname(r.id.trim(), r.source, r.kind),
          kind: r.kind,
          note: r.note.trim() || undefined,
        }));
      await apiSend('/accounts', 'PUT', { accounts });
      // รหัส STM เก็บในเครื่องเท่านั้น (ไม่ส่งไปกับ PUT ด้านบน)
      for (const r of rows) if (r.id.trim()) setStmPassword(r.id.trim(), r.pw.trim());
      setMsg('✅ บันทึกการตั้งค่าบัญชีแล้ว — Dashboard/Sankey/รายการ จะแยกตามบัญชีให้');
      state.refetch();
    } catch (e) {
      setMsg('❌ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>🏦 บัญชีของฉัน</h3>
          <div className="sub">
            บอกระบบว่าแต่ละบัญชีคือบัญชีอะไร (เช่น KBank ใช้จ่ายหลัก / เงินเก็บ / TrueMoney) — ใช้แยกบัญชีทั่วทั้ง Dashboard, Sankey และรายการ
          </div>
        </div>
        <label className="row" style={{ gap: 6, fontSize: 12.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> แสดงรหัส
        </label>
      </div>

      {!state.data ? (
        <div className="muted" style={{ marginTop: 10 }}>กำลังโหลด…</div>
      ) : (
        <div className="grid" style={{ gap: 12, marginTop: 12 }}>
          {rows.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>
              ยังไม่พบบัญชี — เชื่อม Gmail/อัปโหลด statement ให้ระบบตรวจพบอัตโนมัติ หรือกด “＋ เพิ่มบัญชี” เอง
            </div>
          ) : (
            <div className="badge info" style={{ alignSelf: 'flex-start' }}>
              📋 พบ {rows.length} บัญชี/กระเป๋า — เลือกประเภทของแต่ละอันแล้วกดบันทึก
            </div>
          )}
          {rows.map((r, i) => (
            <div key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)', paddingTop: i === 0 ? 0 : 14 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="badge">{SOURCE_LABEL[r.source] ?? r.source}</span>
                {r.id ? (
                  <span className="mono muted" style={{ fontSize: 12 }}>{r.id}</span>
                ) : (
                  <input
                    placeholder="เลขบัญชี เช่น 160-3-73798-5"
                    value={r.id}
                    onChange={(e) => update(i, { id: e.target.value })}
                    style={acctInput(190)}
                  />
                )}
                {r.count > 0 && <span className="muted" style={{ fontSize: 12 }}>· {r.count} รายการ</span>}
                <div className="spacer" />
                <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => removeRow(i)}>ลบ</button>
              </div>

              {/* กดเลือกได้เลยว่าบัญชีนี้คือบัญชีอะไร */}
              <div className="row wrap" style={{ gap: 6, marginTop: 9 }}>
                <span className="muted" style={{ fontSize: 12.5, marginRight: 2 }}>ตั้งเป็น</span>
                {(Object.keys(ACCOUNT_KIND_META) as AccountKind[]).map((k) => {
                  const on = r.kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      className="badge"
                      onClick={() => update(i, { kind: k })}
                      style={{
                        cursor: 'pointer',
                        padding: '5px 11px',
                        border: '1px solid ' + (on ? 'var(--brand)' : 'var(--border)'),
                        background: on ? 'var(--brand)' : 'var(--surface)',
                        color: on ? '#fff' : 'var(--muted)',
                      }}
                    >
                      {ACCOUNT_KIND_META[k].icon} {ACCOUNT_KIND_META[k].label}
                    </button>
                  );
                })}
              </div>

              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {!r.id && (
                  <select value={r.source} onChange={(e) => update(i, { source: e.target.value })} style={acctInput(130)}>
                    {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                  </select>
                )}
                <input
                  placeholder="ชื่อเล่น (ไม่บังคับ) เช่น ใช้จ่ายหลัก"
                  value={r.nickname}
                  onChange={(e) => update(i, { nickname: e.target.value })}
                  style={acctInput(220)}
                />
                <input
                  type={reveal ? 'text' : 'password'}
                  placeholder="🔑 รหัสไฟล์ STM (ถ้ามี)"
                  value={r.pw}
                  onChange={(e) => update(i, { pw: e.target.value })}
                  autoComplete="off"
                  style={acctInput(190)}
                />
              </div>
            </div>
          ))}

          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={addRow}>＋ เพิ่มบัญชี</button>
            <div className="spacer" />
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
          </div>

          <div className="muted" style={{ fontSize: 11.5 }}>
            🔒 รหัส STM ถูกเก็บในเครื่อง/เบราว์เซอร์นี้เท่านั้น (localStorage) ไม่ถูกส่งขึ้นเซิร์ฟเวอร์ — ใช้ปลดล็อกไฟล์ตอนอัปโหลดอัตโนมัติ
          </div>
          {msg && <div style={{ fontSize: 13 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
