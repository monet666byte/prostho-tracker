/**
 * นโยบาย PDPA ของภาควิชา — อ่านจากตาราง pdpa_policy (migration 0016)
 *
 * ทำไมแยกจาก settingsSync: app_settings อาจารย์ทุกคนแก้ได้ แต่ตารางนี้แก้ได้เฉพาะหัวหน้าภาค
 * ("ใครส่งออกข้อมูลผู้ป่วยได้บ้าง" ไม่ควรเป็นสวิตช์ที่อาจารย์คนไหนก็เปิดให้ตัวเองได้)
 * ฝั่งแอปจึงต้องปฏิบัติกับมันคนละแบบด้วย: ดึงลงมาอย่างเดียวเป็นปกติ
 * มีแต่หน้าตั้งค่าของหัวหน้าภาคที่เขียนกลับ และถ้าเขียนไม่ผ่านต้องบอกให้เห็น ไม่เก็บเงียบ
 *
 * ค่าตั้งต้นเมื่อ "ยังไม่รู้" = ปิดทุกอย่าง (LOCKED_POLICY)
 * เชื่อมเซิร์ฟเวอร์ไม่ได้/ยังไม่ได้รัน 0016 → แอปจะส่งออกไม่ได้ ซึ่งเป็นฝั่งที่ถูกต้องที่จะพลาด
 */
import { kvGet, kvSet } from './db';
import { cloudEnabled, supabase } from '../lib/cloud';
import type { Role } from '../domain/types';

/** บทบาทตามที่ฐานข้อมูลรู้จัก — 'admin' คือหัวหน้าภาค (is_admin ใน 0005) */
export type PdpaRole = Role | 'admin';

export interface PdpaPolicy {
  /** ปิดไว้ = ฟังก์ชันลบตามกำหนดเก็บปฏิเสธทุกครั้ง แม้หัวหน้าภาคสั่งเอง */
  retentionEnabled: boolean;
  /** เก็บย้อนหลังกี่รุ่น */
  retentionCohorts: number;
  /** ใครกดส่งออกได้บ้าง — ว่าง = ไม่มีใครได้ */
  exportRoles: PdpaRole[];
  /** ใครส่งออกไฟล์ที่มีชื่อ+HN จริงได้ — ว่าง = ทุกคนได้ไฟล์ที่ปิดบังเสมอ */
  exportIdentifiedRoles: PdpaRole[];
  /** หน้าที่ไม่ได้ทำงานกับเคสตรงๆ ให้แสดงแค่รหัสเคส */
  maskByDefault: boolean;
}

/**
 * ค่าที่ใช้เมื่อยังไม่รู้นโยบายจริง — ล็อกไว้หมด
 * นี่คือ "ค่าเริ่มต้นที่ปลอดภัยไว้ก่อน" ตามที่ตกลงไว้: ยังไม่มีมติภาค = ยังส่งออกไม่ได้
 */
export const LOCKED_POLICY: PdpaPolicy = {
  retentionEnabled: false,
  retentionCohorts: 5,
  exportRoles: [],
  exportIdentifiedRoles: [],
  maskByDefault: true,
};

/**
 * โหมด local / เดโม (ไม่มีเซิร์ฟเวอร์) — ข้อมูลในเครื่องเป็นข้อมูลสมมติล้วน
 * ไม่มีผู้ป่วยจริงให้ต้องปกป้อง จึงเปิดส่งออกได้เต็มเพื่อให้เดโมและงานพัฒนายังทำงานเหมือนเดิม
 * ⚠️ ห้ามเอาชุดนี้ไปใช้เป็น fallback ของโหมด cloud เด็ดขาด — ตรงนั้นต้องเป็น LOCKED_POLICY
 */
export const DEMO_POLICY: PdpaPolicy = {
  retentionEnabled: true,
  retentionCohorts: 5,
  exportRoles: ['student', 'teacher', 'admin'],
  exportIdentifiedRoles: ['student', 'teacher', 'admin'],
  maskByDefault: true,
};

const KEY = 'pdpaPolicy';

let cached: PdpaPolicy = cloudEnabled ? LOCKED_POLICY : DEMO_POLICY;
const listeners = new Set<() => void>();

/** ค่าที่ใช้อยู่ตอนนี้ (อ่านทันที ไม่ยิงเน็ต) */
export const pdpaPolicy = (): PdpaPolicy => cached;

export function onPdpaPolicy(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setPolicy(next: PdpaPolicy) {
  cached = next;
  listeners.forEach((fn) => fn());
}

type Row = {
  retention_enabled?: boolean;
  retention_cohorts?: number;
  export_roles?: string[];
  export_identified_roles?: string[];
  mask_by_default?: boolean;
};

const asRoles = (v: unknown): PdpaRole[] =>
  (Array.isArray(v) ? v : []).filter((r): r is PdpaRole =>
    r === 'student' || r === 'teacher' || r === 'admin');

function fromRow(row: Row): PdpaPolicy {
  return {
    retentionEnabled: !!row.retention_enabled,
    // ค่าเพี้ยน/หาย → ใช้ค่าที่ล็อกไว้ ไม่เดาให้กว้างกว่าเดิม
    retentionCohorts: Number.isFinite(row.retention_cohorts) ? Number(row.retention_cohorts) : LOCKED_POLICY.retentionCohorts,
    exportRoles: asRoles(row.export_roles),
    exportIdentifiedRoles: asRoles(row.export_identified_roles),
    // ไม่มีค่า = ปิดบังไว้ก่อน
    maskByDefault: row.mask_by_default !== false,
  };
}

/**
 * อ่านค่าที่เคยดึงไว้จากเครื่อง — ใช้ตอนเปิดแอปก่อนเน็ตจะตอบ
 * เก็บลง kv (ไม่ sync ขึ้นตู้กลาง) เพราะเป็นแค่สำเนาไว้ให้หน้าจอวาดปุ่มถูกตั้งแต่วินาทีแรก
 */
export async function loadCachedPolicy(): Promise<void> {
  if (!cloudEnabled) { setPolicy(DEMO_POLICY); return; }
  const saved = await kvGet<PdpaPolicy | null>(KEY, null);
  if (saved) setPolicy({ ...LOCKED_POLICY, ...saved });
}

/** ดึงนโยบายล่าสุดจากเซิร์ฟเวอร์ — cloudSync เรียกตอนเปิดแอปและทุกรอบ sync */
export async function pullPdpaPolicy(): Promise<void> {
  if (!cloudEnabled || !supabase) return;
  const { data, error } = await supabase
    .from('pdpa_policy')
    .select('retention_enabled, retention_cohorts, export_roles, export_identified_roles, mask_by_default')
    .eq('id', 'app')
    .maybeSingle();
  // ยังไม่ได้รัน 0016 (ตารางไม่มี) → คงค่าที่ล็อกไว้ ไม่ใช่เปิดให้ผ่าน
  if (error || !data) return;
  const next = fromRow(data as Row);
  setPolicy(next);
  await kvSet(KEY, next);
}

/**
 * หัวหน้าภาคแก้นโยบาย — คืนข้อความ error ถ้าเซิร์ฟเวอร์ปฏิเสธ
 * ไม่มีคิวลองใหม่แบบ settingsSync โดยตั้งใจ: การเปลี่ยนสิทธิ์ต้องรู้ผลทันทีว่าสำเร็จหรือไม่
 * ถ้าเก็บใส่คิวเงียบๆ หัวหน้าภาคจะเชื่อว่าปิดสิทธิ์ไปแล้วทั้งที่ยังเปิดอยู่บนเซิร์ฟเวอร์
 */
export async function savePdpaPolicy(patch: Partial<PdpaPolicy>, by: string): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) {
    setPolicy({ ...cached, ...patch });
    return {};
  }
  const next = { ...cached, ...patch };
  const { error } = await supabase.from('pdpa_policy').update({
    retention_enabled: next.retentionEnabled,
    retention_cohorts: next.retentionCohorts,
    export_roles: next.exportRoles,
    export_identified_roles: next.exportIdentifiedRoles,
    mask_by_default: next.maskByDefault,
    updated_by: by,
  }).eq('id', 'app');
  if (error) return { error: error.message };
  await pullPdpaPolicy();
  return {};
}
