/**
 * ล้างข้อมูลในเครื่องตอน "ออกจากระบบ" — ทำเมื่อของขึ้นเซิร์ฟเวอร์ครบแล้วเท่านั้น
 *
 * ทำไมต้องมี (ASVS 5.0 · V14.3.1): มาตรฐานบอกว่าข้อมูลที่ต้องล็อกอินถึงจะเห็น
 * ต้องไม่ค้างอยู่ในเครื่องหลังจบเซสชัน · เดิม `signOut()` ลบแค่ session
 * ชื่อ HN รูป และ audit ยังอยู่ใน IndexedDB ครบ ใครถือเครื่องต่อเปิด devtools อ่านได้
 *
 * ⚠️ **"ปิดแอป" ไม่ใช่ "ออกจากระบบ"** — ปิดแท็บ/ปิดแอปไม่ล้างอะไรเลย
 * ไม่งั้นความสามารถออฟไลน์หายทั้งหมด (นักศึกษาเปิด-ปิดแอปวันละหลายรอบในคลินิก)
 * ฟังก์ชันนี้ทำงานเมื่อผู้ใช้ **กดปุ่มออกจากระบบเอง** เท่านั้น
 *
 * ⚠️ **ห้ามล้างถ้ายังมีงานค้างส่ง** — งานที่นักศึกษาทำมาทั้งคาบสำคัญกว่าการล้างเครื่อง
 * กติกาเดียวกับปุ่ม sync: ถามผลจริงก่อน แล้วบอกตรง ๆ ว่าเกิดอะไรขึ้น
 * ถ้าล้างไม่ได้ก็ออกจากระบบตามปกติ (ข้อมูลยังอยู่) แล้วบอกผู้ใช้ว่าทำไม
 *
 * เครื่องส่วนตัวจะแทบไม่เจอฟังก์ชันนี้เลย เพราะไม่มีใครกดออกจากระบบทุกวัน —
 * ข้อนี้มีไว้สำหรับเครื่องที่ใช้ร่วมกัน และสำหรับตอนส่งเครื่องต่อ/ขายเครื่อง
 */
import { db } from './db';
import { pendingPushCount } from './cloudSync';
import { cloudEnabled } from '../lib/cloud';

/** ตารางที่ถือข้อมูลของผู้ใช้ — `kv` ไม่อยู่ในนี้ (ถือค่าตั้งของเครื่อง ไม่ใช่ข้อมูลผู้ป่วย) */
const USER_TABLES = [
  'students', 'teachers', 'groups', 'patients', 'workpieces', 'updates',
  'photos', 'blobs', 'checkins', 'reviews', 'submissions', 'issues', 'audit',
  'selfAssessments', 'sect2', 'sect3', 'queue',
] as const;

export type WipeResult =
  /** ล้างแล้ว */
  | { wiped: true }
  /** ยังมีงานค้างส่ง — ไม่ล้าง และบอกจำนวนไป */
  | { wiped: false; reason: 'pending'; pending: number }
  /** โหมดเดโม/ยังไม่ต่อเซิร์ฟเวอร์ — ข้อมูลในเครื่องคือทั้งหมดที่มี ล้างแล้วหายจริง */
  | { wiped: false; reason: 'local-only' };

export async function wipeLocalDataOnSignOut(): Promise<WipeResult> {
  /* โหมด local/เดโม: ไม่มีสำเนาที่ไหนอีก ล้างคือทำลายข้อมูลจริง
     ที่นี่จึงไม่ล้าง — ผู้ใช้มีปุ่ม "รีเซ็ตข้อมูล" แยกอยู่แล้วถ้าต้องการ */
  if (!cloudEnabled) return { wiped: false, reason: 'local-only' };

  const pending = pendingPushCount();
  if (pending > 0) return { wiped: false, reason: 'pending', pending };

  await db.transaction('rw', USER_TABLES.map((t) => db.table(t)), async () => {
    for (const t of USER_TABLES) await db.table(t).clear();
  });
  return { wiped: true };
}
