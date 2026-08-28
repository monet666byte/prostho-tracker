/** ธีมสีทั้งแอป — override design tokens ที่ :root (ใช้ร่วมกันทั้งฝั่งนักศึกษาและอาจารย์) */

export const THEME_KEY = 'pt-theme';

export const THEMES: Array<{ cls: string; label: string }> = [
  { cls: '', label: 'น้ำเงิน (เดิม)' },
  { cls: 'theme-teal', label: 'เขียวคลินิก' },
  { cls: 'theme-navy', label: 'กรมท่าอบอุ่น' },
  { cls: 'theme-plum', label: 'ม่วงพลัม' },
  { cls: 'theme-ink', label: 'เทาหมึก มินิมอล' },
  { cls: 'theme-ocean', label: 'ฟ้าทะเลลึก' },
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
    applyTheme(localStorage.getItem(THEME_KEY) ?? '');
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
