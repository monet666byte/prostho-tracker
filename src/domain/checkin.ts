/**
 * ระบบเช็คอินรายคาบ + อาจารย์ประเมิน
 * ถอดจากสมุดจริง "Clinical Performance Portfolio — Clinical rotation assessment logbook" (Part A + Part B)
 * เด็กเลือกจากรายการแทนการเขียนมือ · อาจารย์ให้คะแนน 0–3 แทนการเซ็นสมุด
 */

import type { CheckIn } from './types';
import { t } from '../lib/i18n';

/** คอลัมน์คะแนนตาม Part B ของสมุดจริง — ข้อละ 0–3
 *  label/short เป็นอังกฤษทั้งสองภาษา ตามศัพท์ในสมุดจริง (ภาคไม่ต้องการคำแปล) · th ใช้เป็น tooltip */
export const CRITERIA = [
  { key: 'knowledge', label: 'Overall Knowledge', th: 'ความรู้โดยรวม', short: 'Knowledge' },
  { key: 'skill', label: 'Overall Skill', th: 'ทักษะโดยรวม', short: 'Skill' },
  { key: 'precaution', label: 'Universal Precaution', th: 'การป้องกันการติดเชื้อ', short: 'Precaution' },
  { key: 'instrument', label: 'Instrument Preparation', th: 'การเตรียมเครื่องมือ', short: 'Instrument' },
  { key: 'time', label: 'Time Management in Clinic', th: 'การบริหารเวลาในคลินิก', short: 'Time' },
  { key: 'chart', label: 'Chart Recording', th: 'การบันทึกชาร์ต', short: 'Chart' },
  { key: 'communication', label: 'Interpersonal Communication', th: 'การสื่อสาร', short: 'Comm.' },
  { key: 'conduct', label: 'General Conduct', th: 'ความประพฤติทั่วไป', short: 'Conduct' },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]['key'];

/** สเกลคะแนนตามสมุดจริง — มีแค่ 3 / 1 / 0 ไม่มี 2 */
export const SCORE_OPTIONS = [0, 1, 3] as const;
export const MAX_SCORE = 3;
export const MAX_TOTAL = CRITERIA.length * MAX_SCORE; // 24

/**
 * เกณฑ์ตรงเวลา — คาบเช้าเริ่ม 09:00 · คาบบ่าย 13:00 · เผื่อได้ 15 นาที
 * ⚠️ เป็นสมมติฐานจากเดโม ยังไม่ผูกกับตารางคาบจริงของภาค · หน้าอาจารย์อธิบายเกณฑ์นี้เป็นข้อความ
 * (i18n 'เกณฑ์ที่ใช้: คาบเช้าเกิน 09:15 …') — เปลี่ยนตรงนี้ต้องแก้ข้อความนั้นด้วย
 */
export const PUNCTUAL_CUTOFF = { morning: '09:15', afternoon: '13:15' } as const;

/**
 * ตราเวลาเช็คอิน — เวลาเป็นของระบบตอนกด แก้เองไม่ได้ และตัดสินตรงเวลา/สายจากเวลานี้
 * ทุกทางที่เช็คอิน (หน้าแรก · หน้าคาบ) ต้องเรียกตัวนี้ตัวเดียว ไม่คำนวณเองในหน้าจอ
 */
export function checkInStamp(now = new Date()): { checkinAt: string; punctual: boolean } {
  const checkinAt = now.toTimeString().slice(0, 5);
  const cutoff = now.getHours() < 12 ? PUNCTUAL_CUTOFF.morning : PUNCTUAL_CUTOFF.afternoon;
  return { checkinAt, punctual: checkinAt <= cutoff };
}

/** กิจกรรมในคาบ — จากช่อง "Appointed Patient (Name/Work)" ที่เด็กเคยต้องเขียนมือ */
/**
 * ครอบทั้งเส้นทางของงานจริง (พิมพ์ final · กรอฟัน · ปรับแก้ · recall) ไม่ใช่แค่ขั้นหลัก
 * ขั้นแล็บช่วงกลาง (Set up · Waxing · Flasking …) รวมอยู่ใน Laboratory work
 * เรียงตามลำดับที่เกิดจริงในคลินิก · ค่าเหล่านี้ถูกเก็บลงแถว checkins ตรงๆ — เปลี่ยนข้อความ = แถวเก่าไม่ตรง
 */
export const ACTIVITIES = [
  'Oral examination',
  'Primary impression',
  'Final impression',
  'Bite registration',
  'Tooth preparation',
  'Laboratory work',
  'Try in / Delivery',
  'ปรับแก้หลังใส่งาน',
  'Recall',
  'ส่งงาน · ตรวจงานกับอาจารย์',
  'ไม่มีผู้ป่วย (no patient)',
] as const;

export const NO_PATIENT_ACTIVITY = 'ไม่มีผู้ป่วย (no patient)';

/** จัดกิจกรรมเป็นหมวดตามช่วงงาน ให้กวาดตาง่ายกว่าชิป 11 อันกองรวมกัน — รายการยังมาจาก ACTIVITIES ครบ */
export const ACTIVITY_GROUPS: ReadonlyArray<{ label: string; items: readonly string[] }> = [
  { label: 'ตรวจ · พิมพ์ปาก', items: ['Oral examination', 'Primary impression', 'Final impression', 'Bite registration'] },
  { label: 'งานข้างเก้าอี้', items: ['Tooth preparation', 'Try in / Delivery', 'ปรับแก้หลังใส่งาน', 'Recall'] },
  { label: 'อื่นๆ', items: ['Laboratory work', 'ส่งงาน · ตรวจงานกับอาจารย์', NO_PATIENT_ACTIVITY] },
];

export function totalScore(scores: Record<string, number> | undefined): number | null {
  if (!scores) return null;
  return CRITERIA.reduce((sum, c) => sum + (scores[c.key] ?? 0), 0);
}

/* ── คะแนนที่ถูกทับ ────────────────────────────────────────────────────────────
   อาจารย์สองท่านลงคะแนนคาบเดียวกันคนละเครื่องเกิดขึ้นได้จริง: evaluateCheckIn กัน
   ด้วย status === 'evaluated' แต่กันจาก "สำเนาในเครื่อง" — ทั้งสองเครื่องเห็น pending
   พร้อมกันก็ผ่านด่านทั้งคู่ แล้วคนที่ sync ทีหลังชนะ
   ตั้งแต่ migration 0017 ฐานข้อมูลเก็บชุดที่ถูกทับไว้ใน scoreHistory เสมอ
   สองตัวนี้แปลงมันเป็นข้อความที่อาจารย์อ่านรู้เรื่อง — เพื่อไม่ให้ "หายเงียบ" อีก */

/** ชื่ออาจารย์ที่คะแนนชุดปัจจุบันทับไป (คนล่าสุดที่ถูกแทนที่) — undefined = ไม่มีใครถูกทับ */
export function supersededBy(c: Pick<CheckIn, 'scoreHistory'>): string | undefined {
  const last = c.scoreHistory?.[c.scoreHistory.length - 1];
  return last?.by || undefined;
}

/** บรรทัดเต็มสำหรับ tooltip / กล่องแก้คะแนน */
export function supersededTitle(c: Pick<CheckIn, 'scoreHistory'>): string {
  const h = c.scoreHistory ?? [];
  if (!h.length) return '';
  const lines = h.map((e) => {
    const total = totalScore(e.scores);
    const who = e.by ? t(e.by) : t('ไม่ทราบผู้ประเมิน');
    return `${who} ${t('เคยให้')} ${total ?? 0}/${MAX_TOTAL}`;
  });
  return `${t('คะแนนชุดก่อนหน้ายังเก็บไว้ครบ')} — ${lines.join(' · ')}`;
}
