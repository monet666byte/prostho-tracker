/**
 * ลงรายชื่อที่อ่านแล้วเข้าระบบ + ให้สิทธิ์เข้าระบบด้วยอีเมล — ทางเดียวที่ใช้ร่วมกันสามทาง (15 ก.ย. 69)
 *   ① เลือกไฟล์ Excel  ② วางข้อความ  ③ ฟอร์มเพิ่มทีละคน
 * เดิมตรรกะนี้อยู่ในหน้า Roster ผูกกับช่องวางข้อความ — ทางใหม่ต้องได้ผลเหมือนกันทุกบรรทัด จึงแยกออกมา
 *
 * กติกาที่ห้ามเปลี่ยน (เหตุผลเต็มอยู่ใน CLAUDE.md หัวข้อชื่อสองภาษา):
 *   · อีเมลที่อยู่ในรายชื่อเชิญแล้วห้ามทับ (ignoreDuplicates) — ทับแล้วบัญชีไปผูกกับอีกคน/สิทธิ์หัวหน้ารายวิชาหลุด
 *   · id อาจารย์ใหม่มาจากอีเมล (teacherIdFromEmail = add-teacher.sql) · อีเมลที่เชิญไว้แล้วใช้ id เดิม ไม่สร้างซ้ำ
 */
import { supabase } from '../lib/cloud';
import { teacherIdFromEmail } from '../lib/rosterParse';
import type { RosterRow, TeacherRosterRow } from '../lib/rosterParse';
import { importRoster, importTeachers } from './repo';

export interface InviteOutcome {
  /** อีเมลที่เพิ่มเข้ารายชื่อเชิญรอบนี้ */
  added: number;
  /** อีเมลที่มีอยู่แล้ว (ไม่แตะสิทธิ์เดิม) */
  skipped: number;
  error: string | null;
}

export interface StudentApplyResult {
  added: number;
  updated: number;
  /** ปีการศึกษาที่รุ่นล่าสุดในชุดนี้ขึ้นคลินิก */
  latestCohort: number;
  /** null = ไม่มีอีเมลในชุดนี้ หรือไม่ได้ต่อเซิร์ฟเวอร์ */
  invites: InviteOutcome | null;
}

export interface TeacherApplyResult {
  added: number;
  updated: number;
  invites: InviteOutcome | null;
}

type InviteRow = { email: string; role: 'student' | 'teacher'; student_id: string | null; teacher_id: string | null; is_admin?: boolean };

async function upsertInvites(rows: InviteRow[]): Promise<InviteOutcome | null> {
  if (!supabase || !rows.length) return null;
  const { data, error } = await supabase
    .from('invites')
    .upsert(rows, { onConflict: 'email', ignoreDuplicates: true, defaultToNull: false })
    .select('email');
  if (error) return { added: 0, skipped: 0, error: error.message };
  const added = data?.length ?? 0;
  return { added, skipped: rows.length - added, error: null };
}

/** แถวที่ไม่ได้ระบุรุ่นมาเอง — ต้องให้ผู้ใช้กรอกเลขรุ่นก่อนนำเข้า */
export const needsDtmu = (rows: ReadonlyArray<RosterRow>) => rows.some((r) => !r.dtmu);

/**
 * ลงนักศึกษา — แยกตามรุ่นในแต่ละแถว (ไฟล์เดียวอาจมีหลายรุ่น) · แถวที่ไม่มีรุ่นใช้ fallbackDtmu
 * @throws เมื่อมีแถวไม่มีรุ่นและไม่ได้ให้ fallbackDtmu — หน้าจอต้องเช็ค needsDtmu ก่อน
 */
export async function applyStudents(rows: RosterRow[], fallbackDtmu: number | null, by: string): Promise<StudentApplyResult> {
  const byDtmu = new Map<number, RosterRow[]>();
  for (const r of rows) {
    const d = r.dtmu ?? fallbackDtmu;
    if (!d) throw new Error('บางแถวไม่มีเลขรุ่น — กรอกเลขรุ่นก่อน');
    byDtmu.set(d, [...(byDtmu.get(d) ?? []), r]);
  }
  let added = 0;
  let updated = 0;
  let latestCohort = 0;
  const idByCode: Record<string, string> = {};
  for (const [dtmu, group] of [...byDtmu].sort((a, b) => a[0] - b[0])) {
    const res = await importRoster(group, dtmu, by);
    added += res.added;
    updated += res.updated;
    latestCohort = Math.max(latestCohort, res.cohort);
    Object.assign(idByCode, res.idByCode);
  }
  const invites = await upsertInvites(rows.flatMap((r) => (r.email && idByCode[r.code]
    ? [{ email: r.email.toLowerCase(), role: 'student' as const, student_id: idByCode[r.code], teacher_id: null }]
    : [])));
  return { added, updated, latestCohort, invites };
}

/**
 * ลงอาจารย์ — ① แถว teachers (ชื่อไทย/อังกฤษ) ② อีเมลลงรายชื่อเชิญ
 * @param invitedTeacherId อีเมล → teacher_id ที่เชิญไว้แล้ว (จากตาราง invites) · ต่อเซิร์ฟเวอร์อยู่ต้องโหลดเสร็จก่อนเรียก
 */
export async function applyTeachers(
  rows: TeacherRosterRow[], invitedTeacherId: ReadonlyMap<string, string>, by: string,
): Promise<TeacherApplyResult> {
  const withId = await Promise.all(rows.map(async (r) => ({
    ...r, id: invitedTeacherId.get(r.email) ?? await teacherIdFromEmail(r.email),
  })));
  const res = await importTeachers(withId, by);
  const invites = await upsertInvites(withId.map((r) => ({
    email: r.email, role: 'teacher' as const, student_id: null, teacher_id: r.id, is_admin: r.isAdmin,
  })));
  return { ...res, invites };
}
