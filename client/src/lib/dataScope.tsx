import { createContext, useContext, useEffect, useState } from 'react';

export type DataScope = 'all' | 'real' | 'demo';

/** ช่วงเวลาที่เลือกดู (global) — from/to = null แปลว่า "ทั้งหมด" · label ใช้แสดงบนปุ่มสรุป */
export interface Period {
  from: string | null;
  to: string | null;
  label: string;
}

export const ALL_PERIOD: Period = { from: null, to: null, label: 'ทั้งหมด' };

const Ctx = createContext<{
  scope: DataScope;
  setScope: (s: DataScope) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  version: number;
  refresh: () => void;
}>({
  scope: 'all',
  setScope: () => {},
  period: ALL_PERIOD,
  setPeriod: () => {},
  version: 0,
  refresh: () => {},
});

/** เก็บ scope จริง/เดโม + ช่วงเวลา + version สำหรับสั่งให้ทุกหน้า refetch (เช่น หลัง auto-sync) */
export function DataScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<DataScope>(
    () => (localStorage.getItem('finflow-datascope') as DataScope) || 'all',
  );
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const raw = localStorage.getItem('finflow-period');
      return raw ? (JSON.parse(raw) as Period) : ALL_PERIOD;
    } catch {
      return ALL_PERIOD;
    }
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    localStorage.setItem('finflow-datascope', scope);
  }, [scope]);
  useEffect(() => {
    localStorage.setItem('finflow-period', JSON.stringify(period));
  }, [period]);
  const refresh = () => setVersion((v) => v + 1);
  return (
    <Ctx.Provider value={{ scope, setScope, period, setPeriod, version, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDataScope() {
  return useContext(Ctx);
}

/**
 * แนบ query ตามมุมมอง global เข้า path:
 *  - ?data=real|demo ตาม scope (ข้ามถ้า all)
 *  - &from=..&to=.. ตามช่วงเวลา (ข้ามถ้าเป็น null)
 * endpoint ที่ไม่เกี่ยวจะ ignore param เหล่านี้เอง
 */
export function withScope(path: string, scope: DataScope, period?: Period): string {
  let p = path;
  const add = (kv: string) => {
    p += (p.includes('?') ? '&' : '?') + kv;
  };
  if (scope !== 'all') add('data=' + scope);
  if (period?.from) add('from=' + period.from);
  if (period?.to) add('to=' + period.to);
  return p;
}
