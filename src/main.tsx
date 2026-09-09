import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* ฟอนต์: เรียกทีละซับเซ็ต ไม่เรียก 400.css ที่รวมทุกซับเซ็ตมาให้
   เพราะไฟล์รวมลาก cyrillic/vietnamese ติดมาด้วย (154 KB) ซึ่งแอปนี้ไม่มีทางแสดงถึง
   เบราว์เซอร์ไม่โหลดมันอยู่แล้วเพราะติด unicode-range แต่ service worker
   แคชล่วงหน้าตาม glob — ไฟล์ที่ไม่มีใครใช้เลยกินเน็ตของการเปิดครั้งแรกจริง ๆ
   และโหมด share ฝังทุกไฟล์เป็น base64 ลง index.html ยิ่งกินหนัก */
import '@fontsource/anuphan/latin-400.css';
import '@fontsource/anuphan/latin-ext-400.css';
import '@fontsource/anuphan/thai-400.css';
import '@fontsource/anuphan/latin-600.css';
import '@fontsource/anuphan/latin-ext-600.css';
import '@fontsource/anuphan/thai-600.css';
import '@fontsource/anuphan/latin-700.css';
import '@fontsource/anuphan/latin-ext-700.css';
import '@fontsource/anuphan/thai-700.css';
import '@fontsource/noto-sans-thai/latin-400.css';
import '@fontsource/noto-sans-thai/latin-ext-400.css';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/latin-500.css';
import '@fontsource/noto-sans-thai/latin-ext-500.css';
import '@fontsource/noto-sans-thai/thai-500.css';
import '@fontsource/noto-sans-thai/latin-600.css';
import '@fontsource/noto-sans-thai/latin-ext-600.css';
import '@fontsource/noto-sans-thai/thai-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-ext-600.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/student.css';
import './styles/teacher.css';
import App from './App';
import { initTextSize } from './components/TextSize';
import { initTheme } from './lib/theme';
import { initInstall } from './lib/install';

initTextSize();
initTheme();
// ต้องดักก่อน React เริ่มวาด — เบราว์เซอร์ยิง beforeinstallprompt เร็วมาก ช้าไปคือหลุด
initInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
