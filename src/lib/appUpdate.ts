/**
 * "มีแอปรุ่นใหม่" — รู้ได้จาก service worker ตัวใหม่เข้ามาคุมหน้าแทนตัวเดิม
 *
 * แอปใช้ vite-plugin-pwa แบบ autoUpdate: ตัวใหม่ skipWaiting + clientsClaim เองทันทีที่โหลดเสร็จ
 * แต่ **หน้าที่เปิดค้างอยู่ยังรันโค้ดรุ่นเก่า** จนกว่าจะโหลดใหม่ · คนที่ติดตั้งแอปแล้วไม่เคยปิดจึงค้างรุ่นเก่าได้เป็นสัปดาห์
 * รุ่นเก่าที่ส่งช่องซึ่งเซิร์ฟเวอร์ไม่มีแล้ว = งานถูกกักพร้อมข้อความอังกฤษของฐานข้อมูล โดยไม่มีใครบอกว่าแค่ต้องอัปเดต
 *
 * ไม่บังคับโหลดใหม่เอง — ผู้ใช้อาจกำลังพิมพ์โน้ตค้างอยู่ ให้เจ้าตัวกดเมื่อพร้อม
 * โหมด dev ไม่มี service worker → ไม่เกิดอะไรเลย
 */
let ready = false;
const listeners = new Set<() => void>();

export const updateReady = (): boolean => ready;
export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function watchAppUpdate(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  /* ครั้งแรกที่ติดตั้ง ตัวแรกก็ "เข้ามาคุม" เหมือนกัน (clientsClaim) — นั่นไม่ใช่รุ่นใหม่
     นับเฉพาะการเปลี่ยนมือหลังจากหน้านี้มีคนคุมอยู่แล้ว */
  let controlled = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (controlled && !ready) {
      ready = true;
      listeners.forEach((fn) => fn());
    }
    controlled = true;
  });
  // แอปที่เปิดค้างทั้งวัน: เบราว์เซอร์ไม่เช็กรุ่นใหม่ให้เองจนกว่าจะมีการนำทาง — ถามเองทุกชั่วโมง และตอนกลับมาที่แอป
  const check = () => { void sw.getRegistration().then((r) => r?.update()).catch(() => { /* ออฟไลน์ — รอบหน้า */ }); };
  setInterval(check, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
