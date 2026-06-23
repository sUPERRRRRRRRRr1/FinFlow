/**
 * เก็บ "รหัสผ่านไฟล์ STM" ของแต่ละบัญชีไว้ในเครื่อง (localStorage) เท่านั้น
 * — ไม่ส่งขึ้นเซิร์ฟเวอร์ เพื่อรักษาหลักความเป็นส่วนตัวเดียวกับการปลดล็อก PDF ฝั่ง client
 * คีย์ = เลขบัญชี/คีย์กระเป๋า (id ใน AccountConfig)
 */
const PW_PREFIX = 'finflow.stmpw.';

export function getStmPassword(accountId: string): string {
  try {
    return localStorage.getItem(PW_PREFIX + accountId) ?? '';
  } catch {
    return '';
  }
}

export function setStmPassword(accountId: string, pw: string): void {
  try {
    if (pw) localStorage.setItem(PW_PREFIX + accountId, pw);
    else localStorage.removeItem(PW_PREFIX + accountId);
  } catch {
    /* localStorage ใช้ไม่ได้ (private mode) — ข้าม */
  }
}

/** รหัสที่บันทึกไว้ทั้งหมด (ไม่ซ้ำ) — ใช้ลองปลดล็อก STM อัตโนมัติตอนอัปโหลด */
export function allStmPasswords(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PW_PREFIX)) {
        const v = localStorage.getItem(k);
        if (v) out.push(v);
      }
    }
    return [...new Set(out)];
  } catch {
    return [];
  }
}
