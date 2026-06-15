/**
 * รูปแบบกลาง (intermediate format) ของ FinFlow
 * ทุก parser / OCR / การ import แปลงข้อมูลของแต่ละแหล่งมาเป็นรูปแบบนี้
 * เพิ่มแหล่งใหม่ = เขียน parser ที่คืนค่า Transaction[] เท่านั้น
 */

/** ทิศทางของเงิน: เข้า (in) หรือ ออก (out) */
export type Direction = 'in' | 'out';

/** แหล่งที่มาของรายการ (ธนาคาร / กระเป๋าเงิน) */
export type Source = 'kbank' | 'make' | 'truemoney' | 'manual' | 'slip';

/** รหัสหมวดหมู่ (ภายในเป็นภาษาอังกฤษ, แสดงผลเป็นไทยผ่าน CATEGORY_META) */
export type CategoryId =
  | 'income' // รายรับ/เงินเดือน
  | 'food' // อาหาร/เครื่องดื่ม
  | 'shopping' // ช้อปปิ้ง
  | 'transport' // เดินทาง/ขนส่ง
  | 'bills' // บิล/สาธารณูปโภค
  | 'entertainment' // ความบันเทิง
  | 'health' // สุขภาพ
  | 'education' // การศึกษา
  | 'transfer' // โอน/ถอนเงินสด ระหว่างกระเป๋า
  | 'savings' // ออม/ลงทุน
  | 'other'; // อื่นๆ

/** ธุรกรรมหนึ่งรายการในรูปแบบกลาง */
export interface Transaction {
  /** รหัสไม่ซ้ำ */
  id: string;
  /** วันที่รูปแบบ ISO 'YYYY-MM-DD' */
  date: string;
  /** เวลา 'HH:mm' (ถ้ามี) */
  time?: string;
  /** จำนวนเงิน (เป็นบวกเสมอ ทิศทางอยู่ที่ field `direction`) */
  amount: number;
  /** เข้า/ออก */
  direction: Direction;
  /** ผู้รับ/ร้าน/ผู้ส่ง */
  counterparty: string;
  /** กระเป๋า/ธนาคารต้นทาง */
  source: Source;
  /** หมวดหมู่ (ผลสุดท้าย หลังใช้กฎร้านค้าของผู้ใช้แล้ว) */
  category: CategoryId;
  /** หมวดที่ระบบจัดอัตโนมัติ (keyword/AI) — เป็น baseline เวลาลบกฎจะกลับมาที่ค่านี้ */
  autoCategory?: CategoryId;
  /** ข้อความต้นฉบับจาก statement/สลิป (เก็บไว้ debug + แสดงผล) */
  rawDesc?: string;
  /** ยอดคงเหลือหลังรายการ (จาก statement ใช้ตรวจ balance ของ Sankey) */
  balanceAfter?: number;
  /** เลขบัญชี/พร้อมเพย์ของผู้รับ (ปิดบังบางส่วน) — ใช้ระบุร้านที่ชื่อบัญชีเป็นชื่อคน */
  accountRef?: string;
  /** ชื่อที่ผู้ใช้ตั้งเอง (alias) เช่น 'ร้านก๋วยเตี๋ยวเจ๊หมวย' แทนชื่อบัญชีที่เป็นชื่อคน */
  alias?: string;
  /** ลายนิ้วมือสำหรับกันซ้ำ */
  fingerprint?: string;
  /** เป็นการโอนระหว่างกระเป๋าตัวเองหรือไม่ (ไม่นับเป็นรายรับ/จ่ายจริง) */
  isTransfer?: boolean;
  /** กลุ่มของการโอนที่จับคู่กันได้ (out↔in) */
  transferGroup?: string;
}

/** ช่วงเวลาในการ aggregate */
export type Granularity = 'day' | 'month' | 'year';

/**
 * กฎร้านค้า: ให้ผู้ใช้กำหนดเองว่า "บัญชี/ผู้รับนี้" คือร้านอะไร อยู่หมวดไหน
 * แก้ปัญหาที่บางบัญชีตั้งชื่อเป็นชื่อคน ทำให้ AI/keyword จัดหมวดไม่ได้
 */
export interface MerchantRule {
  id: string;
  /** จับคู่ด้วยเลขบัญชี (แม่นกว่า) หรือชื่อผู้รับ */
  matchType: 'account' | 'name';
  /** ค่าที่ใช้จับคู่ (เลขบัญชี หรือ ชื่อผู้รับ) */
  matchValue: string;
  /** ชื่อร้านที่ผู้ใช้ตั้ง (แสดงแทนชื่อบัญชี) */
  alias?: string;
  /** หมวดที่กำหนดให้ */
  category: CategoryId;
}
