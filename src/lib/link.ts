/**
 * นักศึกษาผูกบัญชีเองด้วยรหัสนักศึกษา แล้วอาจารย์ที่ปรึกษากดยืนยัน (0023_link_requests.sql)
 *
 * ทุกอย่างวิ่งผ่านฟังก์ชันบนเซิร์ฟเวอร์ — ไม่ sync ลงลิ้นชัก ใช้ได้เฉพาะตอนออนไลน์
 * (เป็นงานครั้งเดียวต่อคน · และบัญชีที่ยังไม่ผูกไม่มีสิทธิ์อ่านตารางไหนอยู่แล้ว)
 * ข้อความ error มาจาก raise exception ในไฟล์ SQL เป็นภาษาไทยที่อ่านแล้วรู้ว่าต้องทำอะไร
 */
import { supabase } from './cloud';
import { t } from './i18n';

export interface MyLinkRequest {
  status: 'pending' | 'approved' | 'rejected';
  studentName: string;
  studentCode: string;
  groupCode: string;
}

export interface PendingLink {
  id: string;
  email: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  groupCode: string;
  createdAt: string;
  /** มีกี่บัญชีขอผูกนักศึกษาคนเดียวกัน — มากกว่า 1 = มีคนหนึ่งใส่รหัสคนอื่น */
  sameStudent: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const offline = () => ({ ok: false as const, error: t('ต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่เมื่อมีเน็ต') });
/** error ที่ไม่มีข้อความจากฐานข้อมูล (เน็ตหลุด) ต้องไม่โชว์ข้อความอังกฤษดิบ */
const messageOf = (e: { message?: string; code?: string } | null) =>
  e?.code ? (e.message ?? '') : t('ต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่เมื่อมีเน็ต');

/** สถานะคำขอของฉัน · null = ยังไม่เคยส่ง */
export async function myLinkRequest(): Promise<Result<MyLinkRequest | null>> {
  if (!supabase) return offline();
  const { data, error } = await supabase.rpc('my_link_request');
  if (error) return { ok: false, error: messageOf(error) };
  if (!data) return { ok: true, value: null };
  const d = data as Record<string, string>;
  return {
    ok: true,
    value: { status: d.status as MyLinkRequest['status'], studentName: d.student_name, studentCode: d.student_code, groupCode: d.group_code },
  };
}

export async function requestLink(studentCode: string): Promise<Result<MyLinkRequest>> {
  if (!supabase) return offline();
  const { data, error } = await supabase.rpc('request_link', { p_student_code: studentCode.trim() });
  if (error) return { ok: false, error: messageOf(error) };
  const d = data as Record<string, string>;
  return { ok: true, value: { status: 'pending', studentName: d.student_name, studentCode: d.student_code, groupCode: d.group_code } };
}

export async function cancelLinkRequest(): Promise<Result<null>> {
  if (!supabase) return offline();
  const { error } = await supabase.rpc('cancel_link_request');
  return error ? { ok: false, error: messageOf(error) } : { ok: true, value: null };
}

/** คำขอที่ฉันมีสิทธิ์ตัดสิน (อาจารย์ที่ปรึกษาของกลุ่ม · หัวหน้าภาคเห็นทั้งหมด) */
export async function pendingLinkRequests(): Promise<Result<PendingLink[]>> {
  if (!supabase) return offline();
  const { data, error } = await supabase.rpc('pending_link_requests');
  if (error) return { ok: false, error: messageOf(error) };
  return {
    ok: true,
    value: ((data ?? []) as Record<string, string | number>[]).map((r) => ({
      id: String(r.id), email: String(r.email), studentId: String(r.student_id), studentCode: String(r.student_code),
      studentName: String(r.student_name), groupCode: String(r.group_code), createdAt: String(r.created_at),
      sameStudent: Number(r.same_student),
    })),
  };
}

export async function decideLink(requestId: string, approve: boolean): Promise<Result<null>> {
  if (!supabase) return offline();
  const { error } = await supabase.rpc('decide_link', { p_request: requestId, p_approve: approve });
  return error ? { ok: false, error: messageOf(error) } : { ok: true, value: null };
}

/** อีเมลแบบนี้ผูกบัญชีเองได้ — ต้องตรงกับ self_link_email_ok() ใน 0023 (ฝั่งแอปใช้แค่เลือกว่าจะโชว์อะไร) */
export function canSelfLink(email: string | null | undefined): boolean {
  return /@student\.mahidol\.edu$/i.test(email ?? '');
}
