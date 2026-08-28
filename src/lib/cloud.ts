/**
 * ตัวเชื่อม Supabase — "ครัวกลาง + ตู้แฟ้มกลาง" ของ phase 2
 *
 * เปิดใช้เมื่อมีกุญแจใน .env.local เท่านั้น (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 * - ไม่มีกุญแจ → แอปทำงานแบบ local ล้วนเหมือนเดิมทุกประการ
 * - โหมด share (ไฟล์เดียวที่แจกเป็นลิงก์เดโม) → ปิดตายเสมอ กันกุญแจติดไปกับไฟล์แจก
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const isShareBuild = import.meta.env.MODE === 'share';

export const cloudEnabled = !!url && !!anonKey && !isShareBuild;

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : null;
