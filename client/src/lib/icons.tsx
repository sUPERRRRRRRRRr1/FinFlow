import {
  LayoutDashboard, Receipt, Split, LineChart, Sparkles, AlertTriangle,
  Target, FileText, Bot, Link2,
  Wallet, UtensilsCrossed, ShoppingBag, Bus, ReceiptText, Clapperboard,
  HeartPulse, GraduationCap, ArrowLeftRight, PiggyBank, Package,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

/** ไอคอนเมนู (เดิมเป็น emoji ใน Layout) — key = route path */
export const NAV_ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/transactions': Receipt,
  '/flow': Split,
  '/timeline': LineChart,
  '/forecast': Sparkles,
  '/anomalies': AlertTriangle,
  '/budgets': Target,
  '/tax': FileText,
  '/assistant': Bot,
  '/connect': Link2,
};

/** ไอคอน + สีชิปต่อหมวด (CategoryId) — สี tint = สีเดิมของหมวดใน shared/categories.ts */
export const CATEGORY_ICONS: Record<string, { Icon: LucideIcon; tint: string }> = {
  income: { Icon: Wallet, tint: '#22c55e' },
  food: { Icon: UtensilsCrossed, tint: '#f97316' },
  shopping: { Icon: ShoppingBag, tint: '#ec4899' },
  transport: { Icon: Bus, tint: '#0ea5e9' },
  bills: { Icon: ReceiptText, tint: '#6366f1' },
  entertainment: { Icon: Clapperboard, tint: '#a855f7' },
  health: { Icon: HeartPulse, tint: '#ef4444' },
  education: { Icon: GraduationCap, tint: '#14b8a6' },
  transfer: { Icon: ArrowLeftRight, tint: '#94a3b8' },
  savings: { Icon: PiggyBank, tint: '#22c55e' },
  other: { Icon: Package, tint: '#64748b' },
};

/** ชิปไอคอนหมวด พร้อม fallback เป็น "other" ถ้า key ไม่อยู่ใน map */
export function CategoryIcon({
  category,
  size = 16,
  style,
}: {
  category: string;
  size?: number;
  style?: CSSProperties;
}) {
  const { Icon, tint } = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other;
  const box = Math.round(size * 1.55);
  return (
    <span
      style={{
        width: box,
        height: box,
        borderRadius: Math.round(box * 0.32),
        background: `color-mix(in srgb, ${tint} 15%, transparent)`,
        color: tint,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}
