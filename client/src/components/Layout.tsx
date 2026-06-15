import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/', icon: '📊', label: 'ภาพรวม', end: true },
  { to: '/transactions', icon: '📒', label: 'รายการ' },
  { to: '/flow', icon: '🌊', label: 'เส้นทางเงิน' },
  { to: '/timeline', icon: '📈', label: 'ไทม์ไลน์' },
  { to: '/categories', icon: '🗂️', label: 'แนวโน้มหมวด' },
  { to: '/anomalies', icon: '🚨', label: 'รายจ่ายผิดปกติ' },
  { to: '/budgets', icon: '🎯', label: 'งบประมาณ' },
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
  const [open, setOpen] = useState(false);

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
        </div>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
