/**
 * ยามหน้าประตู (auth) — ใช้เฉพาะโหมด cloud
 *
 * โหมด local/แชร์เดโม: ไม่มีไฟล์นี้เข้ามาเกี่ยว ล็อกอินปลอมแบบเดิม (เลือกบทบาทแล้วเข้าเลย)
 * โหมด cloud: ต้องอีเมล+รหัสผ่านจริง แล้วระบบจะไปดูตาราง app_users ว่าอีเมลนี้คือ นศ./อาจารย์ คนไหน
 */
import { supabase } from './cloud';
import type { Role } from '../domain/types';

export interface AppUser {
  uid: string;
  email: string;
  role: Role;
  studentId: string | null;
  teacherId: string | null;
}

/** ล็อกอินด้วยอีเมล+รหัสผ่าน — คืน error เป็นข้อความไทยให้เอาไปโชว์ได้เลย */
export async function signInWithPassword(email: string, password: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์' };
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return {};
  if (/invalid login credentials/i.test(error.message)) return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
  if (/email not confirmed/i.test(error.message)) return { error: 'ยังไม่ได้ยืนยันอีเมล — เช็คกล่องจดหมายก่อนครับ' };
  return { error: error.message };
}

export async function signOutCloud(): Promise<void> {
  await supabase?.auth.signOut();
}

/**
 * "ฉันคือใครในระบบ" — อ่านจากตาราง app_users ที่ trigger ผูกไว้ตอนสมัคร
 * คืน null = ล็อกอินอยู่แต่ยังไม่ถูกผูกกับนักศึกษา/อาจารย์คนไหน (ไม่ได้อยู่ในรายชื่อที่ภาคเชิญ)
 */
export async function getAppUser(): Promise<AppUser | null> {
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('app_users')
    .select('uid, email, role, student_id, teacher_id')
    .eq('uid', auth.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    uid: data.uid as string,
    email: data.email as string,
    role: data.role as Role,
    studentId: (data.student_id as string | null) ?? null,
    teacherId: (data.teacher_id as string | null) ?? null,
  };
}

/** ล็อกอินค้างอยู่ไหม (เช็คเร็วๆ ตอนเปิดแอป ไม่ยิงเน็ต) */
export async function hasCloudSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}
