/**
 * สำรองข้อมูลทั้งระบบเป็นไฟล์เดียว — ทางออกที่กดได้จากในแอป ไม่ต้องเปิด terminal
 *
 * ทำไมต้องมี (11 ก.ย. 69): ตัวสำรองข้อมูลที่มีอยู่คือ `npm run backup` ซึ่งต้องมี
 * terminal + `.env.local` + บัญชีหัวหน้าภาค — ไม่มีใครในภาครันได้ · สำเนาชุดล่าสุด
 * ตอนตรวจคือ 29 ส.ค. ครั้งเดียว ไม่มีตั้งเวลา · และ Supabase แผนฟรีไม่มี backup อัตโนมัติ
 * ระบบที่เป็น "ทะเบียนงานจริงของ 96 คน" ต้องมีทางออกที่คนดูแลกดได้เองเสมอ
 *
 * ⚠️ **ไฟล์นี้มีชื่อและ HN ผู้ป่วยครบทุกแถว** จึงต้องผ่านด่านเดียวกับการส่งออก CSV:
 *    เป็นหัวหน้าภาค + ภาควิชาเปิดสิทธิ์ส่งออกแบบมีชื่อให้บทบาทนั้น + จด audit ก่อนสร้างไฟล์
 *    (กติกาเดียวกับ `lib/export.ts` — ประตูออกของข้อมูลต้องด่านเท่ากันทุกบาน)
 *
 * ⚠️ **ไม่รวมไบต์รูป** — รูปอยู่ใน Supabase Storage คนละที่กับตาราง
 *    ผู้ใช้ต้องรู้ข้อจำกัดนี้ ไม่ใช่เข้าใจว่า "กดปุ่มนี้แล้วมีสำเนาครบ" แล้ววันที่ต้องกู้จึงรู้ว่าไม่ครบ
 *    รูปสำรองได้ด้วย `npm run backup` (ดึงจากบักเก็ตมาด้วย)
 */
import { db } from './db';
import { logAudit } from './repo';
import { exportPermission } from '../lib/export';
import { currentPdpaRole } from '../store/app';

/** ตารางที่ใส่ลงไฟล์ — ชื่อเดียวกับตาราง Dexie (ดู db.ts) */
const TABLES = [
  'teachers', 'students', 'groups', 'patients', 'workpieces', 'updates',
  'photos', 'checkins', 'reviews', 'submissions', 'issues', 'audit',
  'selfAssessments', 'sect2', 'sect3',
] as const;

export interface FullBackupResult {
  ok: boolean;
  /** เหตุผลเป็นภาษาคน เอาไปโชว์ toast ได้เลย */
  reason?: string;
  filename?: string;
  rows?: number;
  /** จำนวนรูปที่ "มีอยู่ในระบบแต่ไม่ได้อยู่ในไฟล์นี้" — ต้องบอกผู้ใช้ ไม่ใช่เงียบ */
  photosNotIncluded?: number;
}

/**
 * สร้างไฟล์สำรองข้อมูลแล้วให้เบราว์เซอร์ดาวน์โหลด
 *
 * เนื้อในคือ "ทุกอย่างที่เครื่องนี้มี" — ซึ่งสำหรับอาจารย์/หัวหน้าภาคคือทั้งชั้นปี
 * เพราะ RLS (`0004_row_policies.sql`) ให้บทบาทอาจารย์เห็นทุกแถวอยู่แล้ว และ local-first
 * ดึงทั้งตู้ลงเครื่องตอนเปิดแอป · ถ้ายังไม่ได้ sync ครบ ไฟล์ก็ไม่ครบ — จึงเขียนเวลาที่ทำ
 * และจำนวนแถวต่อตารางกำกับไว้ในไฟล์ ให้คนที่เปิดดูรู้ว่าได้อะไรไปจริง
 */
export async function downloadFullBackup(actor: string): Promise<FullBackupResult> {
  const role = currentPdpaRole();
  if (role !== 'admin') {
    return { ok: false, reason: 'สำรองข้อมูลทั้งระบบได้เฉพาะหัวหน้าภาค' };
  }
  const perm = exportPermission(role);
  if (!perm.allowed || !perm.identified) {
    /* ไฟล์นี้ปิดบังชื่อไม่ได้ (จุดประสงค์คือกู้ข้อมูลกลับ ต้องเป็นของจริงทุกช่อง)
       ถ้าภาคยังไม่เปิดสิทธิ์แบบมีชื่อ ก็ต้องปฏิเสธ ไม่ใช่ลดรูปให้ */
    return { ok: false, reason: 'ภาควิชายังไม่ได้เปิดสิทธิ์ส่งออกแบบมีชื่อและ HN ให้หัวหน้าภาค' };
  }

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  let rows = 0;
  for (const name of TABLES) {
    const all = await db.table(name).toArray();
    tables[name] = all;
    counts[name] = all.length;
    rows += all.length;
  }
  const photosNotIncluded = counts.photos ?? 0;

  /* จด audit ก่อนสร้างไฟล์เสมอ — ไฟล์ที่ออกไปแล้วเรียกคืนไม่ได้
     และแถว audit ที่ยังไม่ได้จด เติมย้อนหลังไม่ได้เหมือนกัน (เหตุผลเดียวกับ exportCsv)
     ห้ามใส่ชื่อ/HN ลงข้อความ audit — แถว audit ลบไม่ได้ตามการออกแบบ */
  await logAudit(`สำรองข้อมูลทั้งระบบเป็นไฟล์ · ${rows} แถว จาก ${TABLES.length} ตาราง`, actor);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `prostho-backup-${stamp}.json`;
  const payload = {
    _meta: {
      takenAt: new Date().toISOString(),
      takenBy: actor,
      source: 'ฐานข้อมูลในเครื่องของผู้ใช้ (local-first — ถ้ายังไม่ได้ sync ครบ ไฟล์นี้ก็ไม่ครบ)',
      tables: counts,
      total: rows,
      photosNotIncluded,
      note: 'ไม่รวมไบต์รูปงาน — รูปอยู่ใน Supabase Storage บักเก็ต case-photos สำรองด้วย npm run backup',
    },
    tables,
  };

  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  return { ok: true, filename, rows, photosNotIncluded };
}
