import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useDataScope, type DataScope } from '../lib/dataScope';
import { apiGet, apiSend } from '../lib/api';
import { allStmPasswords } from '../lib/accountStore';
import PeriodPicker from './PeriodPicker';

const SCOPES: { id: DataScope; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'real', label: '🟢 จริง' },
  { id: 'demo', label: '🧪 เดโม' },
];

const NAV = [
  { to: '/', icon: '📊', label: 'ภาพรวม', end: true },
  { to: '/transactions', icon: '📒', label: 'รายการ' },
  { to: '/flow', icon: '🌊', label: 'เส้นทางเงิน' },
  { to: '/timeline', icon: '📈', label: 'ไทม์ไลน์' },
  { to: '/forecast', icon: '🔮', label: 'คาดการณ์' },
  { to: '/anomalies', icon: '🚨', label: 'รายจ่ายผิดปกติ' },
  { to: '/budgets', icon: '🎯', label: 'งบประมาณ' },
  { to: '/tax', icon: '🧾', label: 'ภาษี' },
  { to: '/assistant', icon: '🤖', label: 'ผู้ช่วย AI' },
  { to: '/connect', icon: '🔗', label: 'เชื่อมต่อข้อมูล' },
];

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('finflow-theme') as 'light' | 'dark') ?? 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('finflow-theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const { scope, setScope, refresh } = useDataScope();
  const [open, setOpen] = useState(false);
  const [sync, setSync] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [syncMsg, setSyncMsg] = useState('');

  // เข้าเว็บแล้วดึงสลิปล่าสุดอัตโนมัติ (เบื้องหลัง) — เฉพาะถ้าเชื่อม Gmail + ไม่ได้ sync ใน 3 นาทีล่าสุด
  useEffect(() => {
    const KEY = 'finflow-lastsync';
    if (Date.now() - Number(localStorage.getItem(KEY) || 0) < 3 * 60 * 1000) return;
    let alive = true;
    (async () => {
      try {
        const s = await apiGet<{ features: { gmailConnected: boolean } }>('/status');
        if (!alive || !s.features.gmailConnected) return;
        localStorage.setItem(KEY, String(Date.now())); // กันยิงซ้ำตอน refresh รัวๆ
        setSync('syncing');
        const r = await apiSend<{ added: number }>('/ingest/gmail?recent=1', 'POST', { passwords: allStmPasswords() });
        if (!alive) return;
        setSyncMsg(r.added > 0 ? `อัปเดตสลิป +${r.added}` : 'ข้อมูลล่าสุดแล้ว');
        setSync('done');
        if (r.added > 0) refresh();
        setTimeout(() => alive && setSync('idle'), 4000);
      } catch {
        if (alive) setSync('idle');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <img src="/icon.svg" alt="FinFlow" />
          <div>
            <b>FinFlow</b>
            <span>เส้นทางการเงินส่วนบุคคล</span>
          </div>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            <span className="ic">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          {sync !== 'idle' && (
            <div className="badge" style={{ width: '100%', marginBottom: 10, fontSize: 11.5 }}>
              {sync === 'syncing' ? '🔄 กำลังดึงสลิปล่าสุด…' : `✅ ${syncMsg}`}
            </div>
          )}
          <PeriodPicker />
          <div className="muted" style={{ fontSize: 11, marginBottom: 5 }}>แสดงข้อมูล</div>
          <div className="row" style={{ gap: 5, marginBottom: 10 }}>
            {SCOPES.map((s) => (
              <button
                key={s.id}
                className={`btn ${scope === s.id ? 'primary' : ''}`}
                style={{ flex: 1, padding: '6px 2px', fontSize: 11.5 }}
                onClick={() => setScope(s.id)}
                title="แยกข้อมูลจริง (Gmail/อัปโหลด) กับข้อมูลตัวอย่าง — มีผลทุกหน้า"
              >
                {s.label}
              </button>
            ))}
          </div>
          <button className="btn" style={{ width: '100%', marginBottom: 10 }} onClick={toggle}>
            {theme === 'light' ? '🌙 โหมดมืด' : '☀️ โหมดสว่าง'}
          </button>
          <div>การแข่งขัน AI &amp; คณิตศาสตร์ ครั้งที่ 11</div>
        </div>
      </aside>

      <div>
        <div className="topbar">
          <button className="btn" onClick={() => setOpen((o) => !o)}>
            ☰
          </button>
          <b>FinFlow</b>
          {sync !== 'idle' && (
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {sync === 'syncing' ? '🔄 ดึงสลิป…' : `✅ ${syncMsg}`}
            </span>
          )}
        </div>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
