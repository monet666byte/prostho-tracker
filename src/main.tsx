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

initTextSize();
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
