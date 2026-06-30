import type { CategoryId } from './types.js';

export interface CategoryMeta {
  id: CategoryId;
  /** ชื่อไทยสำหรับแสดงผล */
  label: string;
  /** อีโมจิ/ไอคอนสั้น */
  icon: string;
  /** สีหลัก (ใช้ใน chart/Sankey) */
  color: string;
  /** หมวดนี้เป็นรายรับหรือไม่ (ใช้แยกฝั่งซ้ายของ Sankey) */
  isIncome?: boolean;
}

/** ข้อมูลแสดงผลของแต่ละหมวด */
export const CATEGORY_META: Record<CategoryId, CategoryMeta> = {
  income: { id: 'income', label: 'รายรับ/เงินเดือน', icon: '💰', color: '#22c55e', isIncome: true },
  food: { id: 'food', label: 'อาหาร/เครื่องดื่ม', icon: '🍜', color: '#f97316' },
  shopping: { id: 'shopping', label: 'ช้อปปิ้ง', icon: '🛍️', color: '#ec4899' },
  transport: { id: 'transport', label: 'เดินทาง/ขนส่ง', icon: '🚌', color: '#0ea5e9' },
  bills: { id: 'bills', label: 'บิล/สาธารณูปโภค', icon: '🧾', color: '#6366f1' },
  entertainment: { id: 'entertainment', label: 'ความบันเทิง', icon: '🎬', color: '#a855f7' },
  health: { id: 'health', label: 'สุขภาพ', icon: '🏥', color: '#ef4444' },
  education: { id: 'education', label: 'การศึกษา', icon: '📚', color: '#14b8a6' },
  transfer: { id: 'transfer', label: 'โอน/ถอนเงินสด', icon: '🔁', color: '#94a3b8' },
  own_transfer: { id: 'own_transfer', label: 'โอนเข้าบัญชีตัวเอง', icon: '🔄', color: '#06b6d4' },
  savings: { id: 'savings', label: 'ออม/ลงทุน', icon: '🏦', color: '#22c55e' },
  other: { id: 'other', label: 'อื่นๆ', icon: '📦', color: '#64748b' },
};

export const ALL_CATEGORIES: CategoryId[] = Object.keys(CATEGORY_META) as CategoryId[];

/** หมวดที่นับเป็น "รายจ่าย" (ไม่รวมรายรับ/ออม/โอน) สำหรับการวิเคราะห์พฤติกรรมการใช้จ่าย */
export const EXPENSE_CATEGORIES: CategoryId[] = [
  'food',
  'shopping',
  'transport',
  'bills',
  'entertainment',
  'health',
  'education',
  'other',
];

/**
 * การจัดกลุ่มรายจ่ายตามกรอบ 50/30/20 (Warren, 2005) — ใช้ในคะแนนสุขภาพการเงิน เสา "ใช้จ่าย"
 *  - NEEDS (จำเป็น, เป้า ≤50%): กิน เดินทาง บิล/สาธารณูปโภค สุขภาพ การศึกษา
 *  - WANTS (ตามใจ, เป้า ≤30%): ช้อปปิ้ง บันเทิง อื่นๆ
 *  (ส่วน 20% ที่เหลือ = ออม/ใช้หนี้ ดูจากเสา "ออม"/"กู้ยืม")
 */
export const NEEDS_CATEGORIES: CategoryId[] = ['food', 'transport', 'bills', 'health', 'education'];
export const WANTS_CATEGORIES: CategoryId[] = ['shopping', 'entertainment', 'other'];

/**
 * คำสำคัญที่บ่งชี้ "การผ่อน/ชำระหนี้" (สินเชื่อ บัตรเครดิต ผ่อนสินค้า) — ใช้ "เดา" ภาระหนี้จากธุรกรรม
 * เพราะระบบยังไม่มีหมวดหนี้แยกต่างหาก รายการพวกนี้มักถูกจัดเป็น bills/other
 * เป็นการประมาณ (heuristic) — ครอบคลุมแบรนด์สินเชื่อ/บัตรในไทยที่พบบ่อย
 */
const DEBT_KEYWORDS = [
  'ผ่อน', 'ผ่อนชำระ', 'สินเชื่อ', 'เงินกู้', 'ชำระหนี้', 'ชำระบัตร', 'งวด',
  'บัตรเครดิต', 'credit card', 'installment', 'loan', 'leasing', 'ลีสซิ่ง',
  'กยศ', 'กรอ', 'student loan', 'ktc', 'aeon', 'อิออน', 'first choice', 'krungsri',
  'umay', 'ยูเมะ', 'easy buy', 'home credit', 'เงินติดล้อ', 'ngern tid lor', 'the 1 card',
];

/** เดาว่ารายการนี้เป็นการผ่อน/ชำระหนี้หรือไม่ (จากชื่อผู้รับ/รายละเอียด) — heuristic */
export function looksLikeDebt(text: string): boolean {
  const t = (text || '').toLowerCase();
  return DEBT_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

/**
 * กฎจัดหมวดแบบ keyword (offline) — ใช้เมื่อไม่มี Gemini key
 * เรียงตามลำดับความเฉพาะเจาะจง ตัวแรกที่ match ชนะ
 */
const KEYWORD_RULES: { category: CategoryId; keywords: string[] }[] = [
  {
    category: 'income',
    keywords: ['เงินเดือน', 'payroll', 'salary', 'ดอกเบี้ย', 'interest', 'เงินปันผล', 'รับโอน', 'received', 'คืนเงิน', 'refund'],
  },
  {
    category: 'food',
    keywords: [
      'ร้านอาหาร', 'อาหาร', 'กาแฟ', 'coffee', 'cafe', 'starbucks', 'amazon coffee', 'food', 'grab food', 'lineman',
      'foodpanda', 'mcdonald', 'kfc', 'ชาบู', 'หมูกระทะ', 'ก๋วยเตี๋ยว', 'ข้าว', 'เครื่องดื่ม', 'ชานม', 'เซเว่น', '7-eleven', 'cp all',
    ],
  },
  {
    category: 'transport',
    keywords: ['grab', 'bolt', 'taxi', 'แท็กซี่', 'bts', 'mrt', 'รถไฟฟ้า', 'ปตท', 'ptt', 'bangchak', 'shell', 'น้ำมัน', 'เติมน้ำมัน', 'วินมอเตอร์ไซค์', 'ค่าโดยสาร', 'easy pass', 'ทางด่วน'],
  },
  {
    category: 'shopping',
    keywords: ['shopee', 'lazada', 'central', 'robinson', 'uniqlo', 'h&m', 'tops', 'big c', 'lotus', 'makro', 'ห้าง', 'เสื้อผ้า', 'ช้อป', 'tiktok shop', 'ikea'],
  },
  {
    category: 'bills',
    keywords: ['ค่าไฟ', 'การไฟฟ้า', 'mea', 'pea', 'ค่าน้ำ', 'การประปา', 'ค่าโทรศัพท์', 'ais', 'true', 'dtac', 'อินเทอร์เน็ต', 'internet', 'ค่าเช่า', 'rent', 'ค่าส่วนกลาง', 'ประกัน', 'insurance', 'บัตรเครดิต', 'credit card'],
  },
  {
    category: 'entertainment',
    keywords: ['netflix', 'spotify', 'youtube', 'disney', 'hbo', 'viu', 'iqiyi', 'โรงหนัง', 'major', 'sf cinema', 'เกม', 'steam', 'garena', 'คาราโอเกะ', 'บันเทิง'],
  },
  {
    category: 'health',
    keywords: ['โรงพยาบาล', 'hospital', 'คลินิก', 'clinic', 'ยา', 'pharmacy', 'watsons', 'boots', 'ฟิตเนส', 'fitness', 'gym', 'หมอ', 'ทันตกรรม'],
  },
  {
    category: 'education',
    keywords: ['ค่าเทอม', 'มหาวิทยาลัย', 'โรงเรียน', 'คอร์ส', 'course', 'udemy', 'coursera', 'หนังสือ', 'book', 'se-ed', 'kinokuniya', 'ติว'],
  },
  {
    category: 'savings',
    keywords: ['ออม', 'savings', 'กองทุน', 'fund', 'หุ้น', 'stock', 'set', 'ลงทุน', 'invest', 'ประกันชีวิต', 'สลากออมสิน', 'bitcoin', 'crypto', 'binance'],
  },
  {
    category: 'transfer',
    keywords: ['โอนเงิน', 'transfer', 'ถอนเงิน', 'withdraw', 'atm', 'พร้อมเพย์', 'promptpay', 'เติมเงิน', 'top up', 'topup'],
  },
];

/**
 * จัดหมวดจากข้อความ (rule-based, offline)
 * @param text ข้อความผู้รับ/รายละเอียดรายการ
 * @param direction ทิศทาง (รายการเข้าโน้มเอียงไปทาง income)
 */
export function classifyByKeyword(text: string, direction: 'in' | 'out'): CategoryId {
  const t = (text || '').toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((k) => t.includes(k.toLowerCase()))) {
      // รายการ "เข้า" ที่ไม่ใช่ income/transfer/savings ให้ถือเป็น income ตามบริบท
      if (direction === 'in' && !['income', 'transfer', 'savings'].includes(rule.category)) {
        return 'income';
      }
      return rule.category;
    }
  }
  return direction === 'in' ? 'income' : 'other';
}
