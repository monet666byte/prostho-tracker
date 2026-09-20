/**
 * เรื่องการส่งข้อมูลเรื่องไหนควรขึ้นเป็นแถบบนหน้าแรกของนักศึกษา — ครั้งละเรื่องเดียว
 *
 * ขึ้นเฉพาะเรื่องที่ระบบแก้เองไม่ได้ ต้องให้เจ้าตัวลงมือ เรียงตามความเร่ง:
 *   'auth'   หมดเวลาเข้าสู่ระบบ — งานส่งต่อไม่ได้จนกว่าจะล็อกอินใหม่
 *   'stuck'  มีงานค้างส่งนานเกิน STUCK_AFTER_MS และยังต่อเซิร์ฟเวอร์ไม่ได้
 *   'update' มีแอปรุ่นใหม่
 *
 * ⚠️ "ต่อเซิร์ฟเวอร์ไม่ได้" เฉยๆ ห้ามขึ้น — ไวไฟห้องคลินิกหลุดวันละหลายรอบ และระบบส่งให้เองเมื่อกลับมา
 *    แถบที่ขึ้นบ่อยคือแถบที่ไม่มีใครอ่าน แล้วแถบแดงที่สำคัญจริงจะถูกมองข้ามไปด้วย
 */
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

export type HomeSyncNotice = 'auth' | 'stuck' | 'update' | null;

export function homeSyncNotice(input: {
  cloud: boolean;
  link: 'ok' | 'down' | 'auth';
  unsent: number;
  pendingSince: number | null;
  hasUpdate: boolean;
  now: number;
}): HomeSyncNotice {
  const { cloud, link, unsent, pendingSince, hasUpdate, now } = input;
  if (cloud && link === 'auth') return 'auth';
  if (cloud && link === 'down' && unsent > 0 && pendingSince !== null && now - pendingSince >= STUCK_AFTER_MS) return 'stuck';
  return hasUpdate ? 'update' : null;
}
