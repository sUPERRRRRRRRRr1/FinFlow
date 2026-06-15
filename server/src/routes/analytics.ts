import { Router } from 'express';
import type { Granularity } from '@finflow/shared';
import { overview, timeline, categories, anomalies } from '../services/analytics.js';
import { financialAdvice } from '../services/gemini.js';
import { computeHealthScore, generateInsights } from '@finflow/shared';
import { getMeta } from '../db.js';
import { loadTransactions } from './_helpers.js';

export const analyticsRouter = Router();

/** GET /api/analytics/overview — สรุปภาพรวม + คะแนนสุขภาพ + Sankey + insight */
analyticsRouter.get('/overview', (req, res) => {
  const txns = loadTransactions(req);
  const ingestStats = getMeta('ingestStats');
  res.json(overview(txns, ingestStats ? JSON.parse(ingestStats) : null));
});

/** GET /api/analytics/timeline?granularity=day|month|year */
analyticsRouter.get('/timeline', (req, res) => {
  const txns = loadTransactions(req);
  const gran = (req.query.granularity as Granularity) ?? 'day';
  res.json(timeline(txns, gran));
});

/** GET /api/analytics/sankey — กราฟการไหลของเงิน + ผลตรวจ balance */
analyticsRouter.get('/sankey', (req, res) => {
  const txns = loadTransactions(req);
  res.json(overview(txns).sankey);
});

/** GET /api/analytics/categories — แนวโน้มรายหมวด + heatmap */
analyticsRouter.get('/categories', (req, res) => {
  const txns = loadTransactions(req);
  res.json(categories(txns));
});

/** GET /api/analytics/anomalies — วันรายจ่ายผิดปกติ (z-score/IQR) */
analyticsRouter.get('/anomalies', (req, res) => {
  const txns = loadTransactions(req);
  res.json(anomalies(txns));
});

/** GET /api/analytics/health — คะแนนสุขภาพการเงินแบบละเอียด */
analyticsRouter.get('/health', (req, res) => {
  const txns = loadTransactions(req);
  res.json(overview(txns).health);
});

/** GET /api/analytics/advice — คำแนะนำภาษาคน (Gemini ถ้ามี key, ไม่งั้น rule-based) */
analyticsRouter.get('/advice', async (req, res) => {
  const txns = loadTransactions(req);
  const advice = await financialAdvice(computeHealthScore(txns), generateInsights(txns));
  res.json(advice);
});
