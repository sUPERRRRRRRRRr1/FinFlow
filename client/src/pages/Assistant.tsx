import { useRef, useState } from 'react';
import { apiSend } from '../lib/api';
import { useDataScope, withScope } from '../lib/dataScope';
import { PageHead } from '../components/ui';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  facts?: string;
  source?: string;
}

const SUGGESTIONS = [
  'เดือนนี้ใช้ค่าอาหารไปเท่าไหร่',
  'หมวดไหนใช้จ่ายมากที่สุด',
  'อัตราการออมของฉันเป็นยังไง',
  'คะแนนสุขภาพการเงินของฉันเท่าไหร่',
];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'bot', text: 'สวัสดีครับ 👋 ถามอะไรเกี่ยวกับการเงินของคุณได้เลย เช่น "เดือนนี้ใช้ค่าอาหารไปเท่าไหร่"' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { scope, period } = useDataScope();

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || loading) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      // แนบบทสนทนาก่อนหน้า (สูงสุด 6 ข้อความ) ให้ถามต่อเนื่องได้ เช่น "แล้วเดือนก่อนล่ะ"
      const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      // แนบ scope จริง/เดโม + ช่วงเวลา (เหมือนทุกหน้า) ให้ AI ตอบเฉพาะข้อมูลที่กำลังดูอยู่ ไม่ปนเดโมกับของจริง
      const res = await apiSend<{ answer: string; facts: string; source: string }>(
        withScope('/chat', scope, period),
        'POST',
        { question, history },
      );
      setMsgs((m) => [...m, { role: 'bot', text: res.answer, facts: res.facts, source: res.source }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: 'ขออภัย เกิดข้อผิดพลาด: ' + (e as Error).message }]);
    } finally {
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  return (
    <>
      <PageHead
        title="ผู้ช่วย AI ถาม–ตอบ"
        desc="โค้ดของเราดึงรายการที่เกี่ยวข้อง + คำนวณตัวเลขเอง แล้วให้ LLM เรียบเรียงคำตอบ (ตัวเลขไม่ได้มาจากการเดาของ AI)"
      />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: 420 }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 6 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: m.role === 'user' ? 'var(--brand)' : 'var(--surface-2)',
                  color: m.role === 'user' ? '#fff' : 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 14.5,
                }}
              >
                {m.text}
              </div>
              {m.facts && (
                <details style={{ marginTop: 4 }}>
                  <summary className="muted" style={{ fontSize: 11.5, cursor: 'pointer' }}>
                    🔢 ตัวเลขที่ใช้ตอบ (คำนวณด้วยโค้ด) · ที่มา: {m.source === 'groq' ? 'Groq' : m.source === 'gemini' ? 'Gemini' : 'rule-based'}
                  </summary>
                  <pre className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 8, marginTop: 4 }}>
                    {m.facts}
                  </pre>
                </details>
              )}
            </div>
          ))}
          {loading && <div className="muted" style={{ fontSize: 13 }}>กำลังคิด…</div>}
          <div ref={endRef} />
        </div>

        <div className="row wrap" style={{ gap: 6, margin: '12px 0' }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="badge" style={{ cursor: 'pointer', border: '1px solid var(--border)' }} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>

        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="พิมพ์คำถามภาษาไทย…"
            style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 15 }}
          />
          <button className="btn primary" type="submit" disabled={loading}>
            ส่ง
          </button>
        </form>
      </div>
    </>
  );
}
