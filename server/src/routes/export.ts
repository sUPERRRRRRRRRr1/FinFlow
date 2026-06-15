import { Router } from 'express';
import { CATEGORY_META } from '@finflow/shared';
import { loadTransactions } from './_helpers.js';

export const exportRouter = Router();

/** GET /api/export/csv — ส่งออกรายการเป็น CSV (UTF-8 BOM เปิดใน Excel ภาษาไทยได้) */
exportRouter.get('/csv', (req, res) => {
  const txns = loadTransactions(req);
  const header = ['วันที่', 'เวลา', 'ทิศทาง', 'จำนวนเงิน', 'ผู้รับ/ร้าน', 'ชื่อที่ตั้งเอง', 'เลขบัญชี', 'หมวด', 'แหล่ง', 'โอนระหว่างกระเป๋า'];
  const rows = txns.map((t) => [
    t.date,
    t.time ?? '',
    t.direction === 'in' ? 'เข้า' : 'ออก',
    t.amount.toFixed(2),
    `"${(t.counterparty ?? '').replace(/"/g, '""')}"`,
    `"${(t.alias ?? '').replace(/"/g, '""')}"`,
    t.accountRef ?? '',
    CATEGORY_META[t.category]?.label ?? t.category,
    t.source,
    t.isTransfer ? 'ใช่' : '',
  ]);
  const csv = '﻿' + [header, ...rows].map((r) => r.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="finflow-transactions.csv"');
  res.send(csv);
});
