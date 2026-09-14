/**
 * ยามหน้าประตู (auth) — ใช้เฉพาะโหมด cloud
 *
 * โหมด local/แชร์เดโม: ไม่มีไฟล์นี้เข้ามาเกี่ยว ล็อกอินปลอมแบบเดิม (เลือกบทบาทแล้วเข้าเลย)
 * โหมด cloud: ต้องอีเมล+รหัสผ่านจริง แล้วระบบจะไปดูตาราง app_users ว่าอีเมลนี้คือ นศ./อาจารย์ คนไหน
 */
import { supabase } from './cloud';
import { t } from './i18n';
import type { Role } from '../domain/types';

export interface AppUser {
  uid: string;
  email: string;
  role: Role;
  studentId: string | null;
  teacherId: string | null;
  /** หัวหน้าภาค — เห็น audit ทั้งระบบ และจัดการรายชื่อผู้มีสิทธิ์เข้าระบบได้ */
  isAdmin: boolean;
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

/**
 * เข้าสู่ระบบด้วย Google — พาออกไปหน้า Google แล้วกลับมาที่หน้าเดิมพร้อม `?code=`
 * supabase-js แลก code เป็น session เองตอนแอปเปิด (init → getAppUser รอให้เสร็จก่อน)
 *
 * ใครจะเข้าได้ยังตัดสินที่ฐานข้อมูลเหมือนเดิม: trigger handle_new_user (0009) ไม่ยอมสร้างบัญชี
 * ให้อีเมลที่ไม่อยู่ในรายชื่อเชิญ → Google พากลับมาพร้อม error (อ่านใน takeOAuthReturnError)
 * คืนค่าเฉพาะตอนพาออกไปไม่ได้ · ถ้าสำเร็จหน้านี้จะถูกเปลี่ยนไปแล้ว
 */
export async function signInWithGoogle(): Promise<{ error?: string }> {
  if (!supabase) return { error: 'ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // กลับมาที่ราก (ไม่มี #/login) — HashRouter พาไปหน้าตามบทบาทเอง
      redirectTo: window.location.origin + window.location.pathname,
      // มีหลายบัญชี Google ในเครื่อง (ส่วนตัว + มหาลัย) ต้องได้เลือกทุกครั้ง ไม่ใช่เข้าบัญชีล่าสุดเงียบๆ
      queryParams: { prompt: 'select_account' },
    },
  });
  if (!error) return {};
  if (/provider is not enabled|unsupported provider/i.test(error.message)) {
    return { error: t('ยังไม่ได้เปิดการเข้าด้วย Google บนเซิร์ฟเวอร์') };
  }
  return { error: error.message };
}

/** แปลข้อความที่ Google/Supabase ส่งกลับมาใน URL เป็นภาษาคน */
export function explainOAuthError(raw: string): string {
  // trigger ไม่ยอมสร้างบัญชี = อีเมลไม่อยู่ในรายชื่อเชิญ · Supabase ห่อ error ของ trigger เป็นข้อความนี้เสมอ
  if (/database error saving new user/i.test(raw)) {
    return t('อีเมลนี้ยังไม่อยู่ในรายชื่อที่ภาควิชาเชิญ — ตรวจว่าเลือกบัญชี Google ถูกอัน หรือติดต่อภาควิชาเพื่อเพิ่มรายชื่อ');
  }
  if (/access_denied|cancel/i.test(raw)) return t('ยกเลิกการเข้าด้วย Google');
  return `${t('เข้าด้วย Google ไม่สำเร็จ')} (${raw})`;
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
    .select('uid, email, role, student_id, teacher_id, is_admin')
    .eq('uid', auth.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    uid: data.uid as string,
    email: data.email as string,
    role: data.role as Role,
    studentId: (data.student_id as string | null) ?? null,
    teacherId: (data.teacher_id as string | null) ?? null,
    isAdmin: !!data.is_admin,
  };
}

/** ล็อกอินค้างอยู่ไหม (เช็คเร็วๆ ตอนเปิดแอป ไม่ยิงเน็ต) */
export async function hasCloudSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}
