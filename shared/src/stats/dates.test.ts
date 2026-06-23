import { describe, it, expect } from 'vitest';
import { startOfMonth, endOfMonth, addMonths } from './dates.js';

describe('month range helpers (สำหรับตัวเลือกช่วงเวลา global)', () => {
  it('startOfMonth คืนวันแรกของเดือน', () => {
    expect(startOfMonth('2026-06-22')).toBe('2026-06-01');
    expect(startOfMonth('2025-01-01')).toBe('2025-01-01');
  });

  it('endOfMonth คืนวันสุดท้าย (รองรับอธิกสุรทิน)', () => {
    expect(endOfMonth('2026-06-22')).toBe('2026-06-30');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28'); // ไม่ใช่ปีอธิกสุรทิน
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29'); // ปีอธิกสุรทิน
    expect(endOfMonth('2025-12-31')).toBe('2025-12-31');
  });

  it('addMonths บวก/ลบเดือน ข้ามปีได้', () => {
    expect(addMonths('2026-06-15', -2)).toBe('2026-04-15'); // 3 เดือนล่าสุด: ต้น
    expect(addMonths('2026-06-15', -11)).toBe('2025-07-15'); // 12 เดือนล่าสุด: ต้น
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15'); // ข้ามปีลง
    expect(addMonths('2025-12-15', 1)).toBe('2026-01-15'); // ข้ามปีขึ้น
  });

  it('addMonths clamp วันที่เมื่อเดือนปลายทางสั้นกว่า', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); // ม.ค.31 → ก.พ. ไม่มี 31
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('ประกอบเป็นช่วงเดือนเดียวได้ (start..end)', () => {
    const d = '2025-11-09';
    expect(startOfMonth(d)).toBe('2025-11-01');
    expect(endOfMonth(d)).toBe('2025-11-30');
  });
});
