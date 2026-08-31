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

export const supabase: SupabaseClient | null = cloudEnabled
  // persistSession: จำการล็อกอินไว้ในเครื่อง — เปิดแอปวันรุ่งขึ้นไม่ต้องล็อกอินใหม่
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
