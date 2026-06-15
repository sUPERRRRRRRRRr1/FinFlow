import type {
  HealthScore,
  Insight,
  SankeyGraph,
  CategoryTrend,
  RecurringItem,
  Transaction,
  BudgetStatus,
  Budget,
} from '@finflow/shared';

export type { HealthScore, Insight, SankeyGraph, CategoryTrend, RecurringItem, Transaction, BudgetStatus, Budget };

export interface MonthPoint {
  key: string;
  label: string;
  income: number;
  expense: number;
  savings: number;
  net: number;
}

export interface Overview {
  totals: { income: number; expense: number; savings: number; net: number; savingsRate: number };
  bySource: { source: string; label: string; income: number; expense: number; net: number; count: number }[];
  byCategory: { category: string; label: string; color: string; icon: string; amount: number; pct: number }[];
  monthly: MonthPoint[];
  health: HealthScore;
  insights: Insight[];
  sankey: SankeyGraph;
  recurring: { count: number; monthlyTotal: number; items: RecurringItem[] };
  transferCount: number;
  period: { from: string | null; to: string | null };
  count: number;
  ingestStats: { received: number; added: number; duplicatesRemoved: number; transfersMatched: number } | null;
}

export interface DailyPoint {
  date: string;
  label: string;
  expense: number;
  income: number;
  ma7?: number;
}

export interface TimelineData {
  granularity: string;
  daily: DailyPoint[];
  monthly: MonthPoint[];
  yearly: MonthPoint[];
  forecast: { netSavings: number[]; slope: number; r2: number };
}

export interface CategoriesData {
  trends: CategoryTrend[];
  heatmap: {
    months: { key: string; label: string }[];
    categories: { id: string; label: string; color: string; values: number[] }[];
  };
}

export interface AnomalyDay {
  date: string;
  label: string;
  amount: number;
  z: number;
  reason: string;
  transactions: { counterparty: string; amount: number; category: string; categoryLabel: string }[];
}
export interface AnomaliesData {
  meanDaily: number;
  sd: number;
  upperFence: number;
  outliers: AnomalyDay[];
}

export interface BudgetsData {
  month: string;
  budgets: Budget[];
  status: BudgetStatus[];
}

export interface SystemStatus {
  ok: boolean;
  transactions: number;
  features: { geminiEnabled: boolean; gmailConfigured: boolean; gmailConnected: boolean };
}
