/**
 * ติดตั้งลงหน้าจอโฮม (PWA) — ของจริง ไม่ใช่กล่องที่กดแล้วปิดเฉยๆ
 *
 * เดิมปุ่ม "เพิ่มเลย" เรียก dismissInstall() ซึ่งแค่ปิดกล่อง — นักศึกษากดแล้วไม่มีอะไรเกิดขึ้น
 * (ผู้ใช้ทัก 5 ก.ย. 69) ตอนนี้ต่อกับกลไกจริงของเบราว์เซอร์แล้ว
 *
 * กติกาของแต่ละเบราว์เซอร์ไม่เหมือนกัน:
 *   Chrome / Edge / Samsung → ยิง event `beforeinstallprompt` ให้เราเก็บไว้ แล้วเรียก prompt() ตอนผู้ใช้กด
 *                             (เรียกได้ครั้งเดียวต่อ event · ต้องมาจากการกดของผู้ใช้จริง)
 *   Safari (iOS/iPad)       → ไม่มี event นี้เลย ติดตั้งได้ทางเมนูแชร์เท่านั้น จึงต้องบอกวิธีเป็นข้อความ
 *   ติดตั้งไปแล้ว           → display-mode: standalone · ไม่ต้องเสนออีก
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** เรียกครั้งเดียวตอนแอปเริ่ม — ต้องดักก่อน React โหลดเสร็จ ไม่งั้น event หลุด */
export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // กันเบราว์เซอร์เด้งแถบของตัวเอง — เรามีกล่องเชิญของเราเองที่อธิบายเป็นภาษาคน
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** ติดตั้งได้ด้วยปุ่มเดียวไหม (Chrome/Edge/Android) */
export function canInstall(): boolean {
  return deferred !== null;
}

/** ติดตั้งไปแล้ว — เปิดอยู่ในโหมดแอป ไม่ใช่แท็บเบราว์เซอร์ */
export function isInstalled(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** Safari บนเครื่อง Apple — ต้องบอกวิธีทำมือ เพราะไม่มีปุ่มติดตั้งให้เรียก */
export function isAppleSafari(): boolean {
  const ua = navigator.userAgent;
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  return apple && safari;
}

/**
 * ขอให้เบราว์เซอร์ติดตั้งจริง — คืนผลว่าผู้ใช้กดยอมหรือไม่
 * 'unavailable' = เบราว์เซอร์นี้ไม่มีปุ่มให้เรียก (ต้องทำมือ)
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null; // event หนึ่งใบใช้ได้ครั้งเดียว ถ้าเก็บไว้เรียกซ้ำจะ error
  listeners.forEach((fn) => fn());
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome;
  } catch {
    return 'dismissed';
  }
}
