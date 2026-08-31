import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// โหมด share: แพ็คทั้งแอป (JS/CSS/ฟอนต์) เป็น index.html ไฟล์เดียว เอาไปวางที่ไหนก็เปิดได้
// ไม่ใส่ service worker เพราะปลายทาง (artifact host) จัดการ cache เองไม่ได้
export default defineConfig(({ mode }) => ({
  /**
   * GitHub Pages วางเว็บไว้ใต้ /ชื่อ-repo/ ไม่ใช่รากโดเมน
   * ถ้าไม่ตั้ง base ไฟล์ JS/CSS/ฟอนต์จะถูกอ้างจากรากแล้วโหลดไม่เจอ = จอขาว
   * (โหมดอื่นไม่ตั้ง เพราะ share build เป็นไฟล์เดียวเอาไปวางที่ไหนก็ได้)
   */
  base: mode === 'pages' ? '/prostho-tracker/' : '/',
  build:
    mode === 'share'
      ? { outDir: 'dist-share', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 8000 }
      : undefined,
  plugins: [
    react(),
    ...(mode === 'share' ? [viteSingleFile()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png', 'icon.svg'],
      manifest: {
        name: 'Prostho Tracker — DTPT502',
        short_name: 'Prostho',
        description: 'ติดตามความคืบหน้าเคสงานทันตกรรมประดิษฐ์ รายวิชา DTPT502',
        lang: 'th',
        theme_color: '#2B5CE6',
        background_color: '#F6F7F9',
        display: 'standalone',
        orientation: 'portrait',
        // ต้องตรงกับ base ไม่งั้นไอคอนบนหน้าจอโฮมเปิดไปที่รากโดเมนแล้วเจอ 404
        start_url: mode === 'pages' ? '/prostho-tracker/' : '/',
        scope: mode === 'pages' ? '/prostho-tracker/' : '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // ฟอนต์ไทยมีขนาดใหญ่ — ต้องแคชไว้ให้ครบเพื่อให้ใช้งานออฟไลน์ได้จริง
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
      disable: mode === 'share',
    }),
  ],
}));
