import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// เปิด PWA Service Worker เฉพาะตอนตั้งใจ build เป็น PWA จริง (VITE_ENABLE_PWA=true)
// ค่าเริ่มต้น = ปิด แล้วปล่อย SW แบบ "ฆ่าตัวเอง" (selfDestroying) เพื่อยกเลิก + ล้าง cache
// ของ SW เก่าที่เคยติดตั้งไว้ในเบราว์เซอร์ออกให้หมด — แก้อาการ preview เปิดมาเป็นเวอร์ชันเก่า
const enablePWA = process.env.VITE_ENABLE_PWA === 'true';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      selfDestroying: !enablePWA,
      includeAssets: ['icon.svg'],
      workbox: {
        cleanupOutdatedCaches: true,
        // อย่าให้ SW เสิร์ฟ app shell แทน /api/* (ไม่งั้น OAuth/CSV/callback โดนกลืน → หน้าว่าง)
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'FinFlow — เส้นทางการเงินส่วนบุคคล',
        short_name: 'FinFlow',
        description: 'รวมศูนย์และวิเคราะห์การเงินส่วนบุคคลด้วย AI',
        theme_color: '#0f766e',
        background_color: '#0b1120',
        display: 'standalone',
        lang: 'th',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@finflow/shared': path.resolve(root, '..', 'shared', 'src', 'index.ts'),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
