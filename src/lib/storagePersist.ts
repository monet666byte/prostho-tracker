/**
 * ขอให้เบราว์เซอร์ "ไม่ลบ" ข้อมูลในเครื่องของแอปนี้ — และบอกผู้ใช้ตรงๆ ว่าได้หรือไม่ได้
 *
 * ทำไมต้องมี: ข้อมูลทั้งหมดของนักศึกษาอยู่ใน IndexedDB ก่อนจะได้ขึ้นตู้กลาง
 * และเบราว์เซอร์มีสิทธิ์ลบที่เก็บของเว็บทิ้งได้เอง:
 *   · Chrome/Edge/Firefox — ลบตอนดิสก์ใกล้เต็ม (best-effort) เว้นแต่ได้สถานะ persistent
 *   · Safari/iOS — **ลบที่เก็บของเว็บที่ไม่ได้เปิดภายใน 7 วัน** ยกเว้นเว็บที่ถูกเพิ่มลงหน้าจอโฮม
 * นักศึกษาที่ยังไม่ได้ต่อตู้กลาง แล้วปิดเทอมไปสองอาทิตย์ = ข้อมูลหายทั้งเครื่องโดยไม่มีอะไรบอก
 *
 * `navigator.storage.persist()` ช่วยได้จริงบน Chromium/Firefox (ขอแล้วมักได้ถ้าเว็บถูกติดตั้ง
 * หรือผู้ใช้ใช้งานบ่อย) · บน Safari ไม่มีผล — ทางเดียวคือ "เพิ่มลงหน้าจอโฮม"
 *
 * ⚠️ ห้ามเขียนบนหน้าจอว่า "ข้อมูลปลอดภัยแล้ว" จากผลของฟังก์ชันนี้เพียงอย่างเดียว
 *    ของที่ปลอดภัยจริงคือของที่ขึ้นตู้กลางแล้ว · ฟังก์ชันนี้แค่ลดโอกาสหายระหว่างรอ
 */

export type PersistState =
  /** ได้สถานะถาวรแล้ว — เบราว์เซอร์จะไม่ลบทิ้งเอง */
  | 'persisted'
  /** ขอแล้วไม่ได้ (ยังไม่ได้ติดตั้ง / ใช้งานยังไม่มากพอ) — เบราว์เซอร์ลบได้ถ้าดิสก์ใกล้เต็ม */
  | 'best-effort'
  /** เบราว์เซอร์ไม่รองรับการขอ (Safari เป็นหลัก) — ต้องพึ่ง "เพิ่มลงหน้าจอโฮม" */
  | 'unsupported'
  /** ยังไม่ได้ถาม */
  | 'unknown';

let state: PersistState = 'unknown';
const listeners = new Set<() => void>();

export const persistState = (): PersistState => state;

export function onPersistState(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: PersistState) {
  if (state === next) return;
  state = next;
  listeners.forEach((fn) => fn());
}

/**
 * ถามเบราว์เซอร์ครั้งเดียวตอนเปิดแอป — เรียกซ้ำได้ ไม่มีผลข้างเคียง
 *
 * เรียกได้ทั้งโหมด local และ cloud: ข้อมูลที่รอส่งอยู่ในเครื่องมีค่าเท่ากันทั้งสองโหมด
 * (โหมด local คือทั้งหมดที่มี · โหมด cloud คือของที่ยังไม่ได้ขึ้น)
 */
export async function requestPersistentStorage(): Promise<PersistState> {
  try {
    const s = navigator.storage;
    if (!s || typeof s.persist !== 'function' || typeof s.persisted !== 'function') {
      set('unsupported');
      return state;
    }
    // ถ้าได้อยู่แล้วก็ไม่ต้องขอซ้ำ — การขอซ้ำบางเบราว์เซอร์เด้ง prompt ให้ผู้ใช้
    if (await s.persisted()) {
      set('persisted');
      return state;
    }
    set((await s.persist()) ? 'persisted' : 'best-effort');
  } catch {
    // หน้าต่างส่วนตัว/นโยบายองค์กรห้ามถาม — ถือว่าไม่รองรับ ดีกว่าอ้างว่าปลอดภัย
    set('unsupported');
  }
  return state;
}
