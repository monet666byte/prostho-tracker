/**
 * ตัวเชื่อม Supabase — "ครัวกลาง + ตู้แฟ้มกลาง" ของ phase 2
 *
 * เปิดใช้เมื่อมีกุญแจใน .env.local เท่านั้น (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 * - ไม่มีกุญแจ → แอปทำงานแบบ local ล้วนเหมือนเดิมทุกประการ
 * - โหมด share (ไฟล์เดียวที่แจกเป็นลิงก์เดโม) → ปิดตายเสมอ กันกุญแจติดไปกับไฟล์แจก
 * - โหมดเดโมในเครื่อง (npm run dev:demo) → ปิดชั่วคราว ไม่ต้องล็อกอิน สลับ นศ./อาจารย์ ได้อิสระ
 *   ใช้ตอนพรีเซนต์หรือลองฟีเจอร์ โดยไม่แตะข้อมูลจริงบนเซิร์ฟเวอร์เลย (คนละลิ้นชักกัน — ดู db.ts)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
/**
 * โหมดที่ห้ามต่อเซิร์ฟเวอร์เด็ดขาด
 * - share: ไฟล์เดียวที่แจกเป็นลิงก์เดโม
 * - pages: เว็บสาธารณะบน GitHub Pages ให้คนลองกดเล่น
 * ทั้งคู่ต้องปิดตาย ไม่ใช่แค่ "หวังว่าจะไม่มี .env.local ตอน build"
 * (ทดสอบแล้วว่า build ในเครื่องที่มี .env.local จะฝังกุญแจลงไฟล์จริง)
 */
const isPublicBuild = import.meta.env.MODE === 'share' || import.meta.env.MODE === 'pages';
/** npm run dev:demo — ปิดเซิร์ฟเวอร์ชั่วคราวเพื่อใช้แบบไม่ต้องล็อกอิน */
export const isDemoRun = import.meta.env.VITE_DEMO === '1';

export const cloudEnabled = !!url && !!anonKey && !isPublicBuild && !isDemoRun;

/**
 * ข้อผิดพลาดที่ติดมากับ URL ตอนกลับจากหน้า Google (เช่น อีเมลไม่อยู่ในรายชื่อเชิญ)
 *
 * ต้องอ่านแล้วลบออกจาก URL **ก่อน** createClient และก่อน HashRouter เห็น
 * ไม่งั้น `#error=...` ถูกอ่านเป็นเส้นทางของแอป และ supabase-js กลืน error ไปเงียบๆ
 * ห้ามลบ `code` — supabase-js ต้องใช้แลกเป็น session (ลบให้เองหลังแลกเสร็จ)
 */
let oauthReturnError: string | null = null;
if (cloudEnabled && typeof window !== 'undefined') {
  const u = new URL(window.location.href);
  const fromHash = u.hash.startsWith('#/') ? new URLSearchParams() : new URLSearchParams(u.hash.slice(1));
  const pick = (k: string) => u.searchParams.get(k) ?? fromHash.get(k);
  if (pick('error') || pick('error_description')) {
    oauthReturnError = pick('error_description') || pick('error') || 'unknown';
    for (const k of ['error', 'error_code', 'error_description']) u.searchParams.delete(k);
    if (!u.hash.startsWith('#/')) u.hash = '';
    window.history.replaceState(window.history.state, '', u.toString());
  }
}
/** อ่านครั้งเดียวแล้วหาย — หน้า login เอาไปแสดง */
export function takeOAuthReturnError(): string | null {
  const e = oauthReturnError;
  oauthReturnError = null;
  return e;
}

export const supabase: SupabaseClient | null = cloudEnabled
  // persistSession: จำการล็อกอินไว้ในเครื่อง — เปิดแอปวันรุ่งขึ้นไม่ต้องล็อกอินใหม่
  /* flowType 'pkce': กลับจาก Google มาเป็น `?code=` ไม่ใช่ `#access_token=`
     แอปใช้ HashRouter — แบบเดิม (implicit) token ใน # จะชนกับเส้นทางของแอป (14 ก.ย. 69)
     ไม่กระทบการล็อกอินด้วยรหัสผ่าน */
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce' } })
  : null;
