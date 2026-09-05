import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/anuphan/400.css';
import '@fontsource/anuphan/600.css';
import '@fontsource/anuphan/700.css';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';

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
