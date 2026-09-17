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
import { t } from '../lib/i18n';
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

  /* ไฟล์รูปไม่ได้อยู่ในคิวส่งแถว — แถว photos ขึ้นตู้แล้วแต่ไบต์ยังรออัป Storage ก็มี
     ใบไหนยังไม่มี storagePath = สำเนาในเครื่องนี้คือใบเดียวในโลก ล้างแล้วรูปคนไข้หายถาวร */
  const unsentPhotos = await db.photos.filter((p) => !p.storagePath).count();
  const pending = pendingPushCount() + unsentPhotos;
  if (pending > 0) return { wiped: false, reason: 'pending', pending };

  await db.transaction('rw', USER_TABLES.map((t) => db.table(t)), async () => {
    for (const t of USER_TABLES) await db.table(t).clear();
  });
  return { wiped: true };
}

/* ══════════════════════════════════════════════════════════════════════════════
   ผลของการออกจากระบบต้องไปโผล่ที่ "หน้าเข้าระบบ" ไม่ใช่ toast

   บั๊กที่เคยเกิดจริง (เจอจากการกดจริง):
   ตัวจัดการปุ่มออกจากระบบทั้งสองฝั่งเขียนว่า `showToast(...)` แล้ว `navigate('/login')`
   แต่ `ToastView` ถูกเรนเดอร์อยู่ **ข้างใน** `student/Shell.tsx` กับ `teacher/TeacherShell.tsx`
   เท่านั้น · หน้า `/login` ไม่ได้อยู่ในเชลล์ไหนเลย (ตรวจแล้ว: ไม่มี toast host บนหน้านั้น)
   → เชลล์ถูกถอด toast ตายไปพร้อมกัน **ข้อความจึงไม่มีทางถึงตาผู้ใช้เลยแม้แต่ครั้งเดียว**
   (คลาสเดียวกับบั๊กเก่าสองตัวที่จดไว้แล้ว: ToastView อยู่แค่ฝั่งนักศึกษา · ป้ายหลอก)

   และข้อความนี้ **ไม่ควรเป็น toast อยู่แล้ว** — "ข้อมูลยังอยู่ในเครื่องนี้" คือเรื่องที่
   คนยืมไอแพดต้องอ่านให้ทัน แล้วตัดสินใจ ไม่ใช่แถบที่หายไปเองใน 3 วินาที

   เก็บใน `sessionStorage` โดยเจตนา: อยู่รอดข้ามการเปลี่ยนหน้า แต่ตายไปพร้อมแท็บ
   ตรงกับขอบเขตของเรื่อง ("คุณเพิ่งออกจากระบบบนเครื่องนี้") · อ่านแล้วลบทิ้งทันที
   จะได้ไม่ค้างไปโผล่รอบหน้า
   ══════════════════════════════════════════════════════════════════════════════ */
const NOTICE_KEY = 'pt-signout-notice';

export interface SignOutNotice {
  tone: 'ok' | 'warn';
  message: string;
}

/** จดผลไว้ให้หน้าเข้าระบบอ่าน — เรียกก่อน navigate ได้เลย ไม่ต้องรอ */
export function noteSignOutOutcome(res: WipeResult): void {
  /* โหมด local ไม่มีอะไรต้องบอก: ข้อมูลไม่มีที่อื่นอยู่ ล้างไม่ได้อยู่แล้ว
     พูดถึงมันจะกลายเป็นคำเตือนที่ผู้ใช้ทำอะไรไม่ได้ */
  if (!res.wiped && res.reason === 'local-only') return;
  const notice: SignOutNotice = res.wiped
    ? { tone: 'ok', message: t('ออกจากระบบแล้ว · ล้างข้อมูลออกจากเครื่องนี้ด้วย') }
    : {
        tone: 'warn',
        message: t('ออกจากระบบแล้ว แต่ข้อมูลยังอยู่ในเครื่องนี้ — เหลืองานค้างส่ง {n} รายการ ต่อเน็ตแล้วเข้าระบบอีกครั้งเพื่อส่งขึ้นให้ครบ', { n: res.pending }),
      };
  try {
    sessionStorage.setItem(NOTICE_KEY, JSON.stringify(notice));
  } catch {
    /* หน้าต่างส่วนตัว/ที่เก็บถูกปิด — ไม่มีข้อความก็ยังออกจากระบบได้ปกติ */
  }
}

/** อ่านแล้วลบ — หน้าเข้าระบบเรียกครั้งเดียวตอน mount */
export function takeSignOutNotice(): SignOutNotice | null {
  try {
    const raw = sessionStorage.getItem(NOTICE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(NOTICE_KEY);
    const n = JSON.parse(raw) as SignOutNotice;
    return n && typeof n.message === 'string' ? n : null;
  } catch {
    return null;
  }
}
