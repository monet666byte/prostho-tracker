/** ธีมสีทั้งแอป — override design tokens ที่ :root (ใช้ร่วมกันทั้งฝั่งนักศึกษาและอาจารย์) */

export const THEME_KEY = 'pt-theme';

export const THEMES: Array<{ cls: string; label: string }> = [
  { cls: '', label: 'น้ำเงิน' },
  { cls: 'theme-plum', label: 'ม่วง' },
  { cls: 'theme-ink', label: 'เทา' },
];

const ALL = THEMES.map((t) => t.cls).filter(Boolean);

export function applyTheme(cls: string) {
  const el = document.documentElement;
  ALL.forEach((c) => el.classList.remove(c));
  if (cls) el.classList.add(cls);
  try {
    localStorage.setItem(THEME_KEY, cls);
  } catch {
    /* private mode */
  }
}

export function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY) ?? '';
    // ธีมที่เคยมีแล้วถูกตัดออก (teal/navy/ocean) — ถ้าค้างใน localStorage ให้กลับมาเป็นน้ำเงิน
    applyTheme(THEMES.some((t) => t.cls === saved) ? saved : '');
  } catch {
    /* private mode */
  }
}

export function currentTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) ?? '';
  } catch {
    return '';
  }
}
