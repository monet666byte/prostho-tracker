/**
 * ระบบเช็คอินรายคาบ + อาจารย์ประเมิน
 * ถอดจากสมุดจริง "Clinical Performance Portfolio — Clinical rotation assessment logbook" (Part A + Part B)
 * เด็กเลือกจากรายการแทนการเขียนมือ · อาจารย์ให้คะแนน 0–3 แทนการเซ็นสมุด
 */

/** คอลัมน์คะแนนตาม Part B ของสมุดจริง — ข้อละ 0–3 */
export const CRITERIA = [
  { key: 'knowledge', label: 'Overall Knowledge', th: 'ความรู้โดยรวม', short: 'ความรู้' },
  { key: 'skill', label: 'Overall Skill', th: 'ทักษะโดยรวม', short: 'ทักษะ' },
  { key: 'precaution', label: 'Universal Precaution', th: 'การป้องกันการติดเชื้อ', short: 'ปลอดเชื้อ' },
  { key: 'instrument', label: 'Instrument Preparation', th: 'การเตรียมเครื่องมือ', short: 'เครื่องมือ' },
  { key: 'time', label: 'Time Management in Clinic', th: 'การบริหารเวลาในคลินิก', short: 'เวลา' },
  { key: 'chart', label: 'Chart Recording', th: 'การบันทึกชาร์ต', short: 'ชาร์ต' },
  { key: 'communication', label: 'Interpersonal Communication', th: 'การสื่อสาร', short: 'สื่อสาร' },
  { key: 'conduct', label: 'General Conduct', th: 'ความประพฤติทั่วไป', short: 'ประพฤติ' },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]['key'];

/** สเกลคะแนนตามสมุดจริง — มีแค่ 3 / 1 / 0 ไม่มี 2 */
export const SCORE_OPTIONS = [0, 1, 3] as const;
export const MAX_SCORE = 3;
export const MAX_TOTAL = CRITERIA.length * MAX_SCORE; // 24

/** กิจกรรมในคาบ — จากช่อง "Appointed Patient (Name/Work)" ที่เด็กเคยต้องเขียนมือ */
export const ACTIVITIES = [
  'Oral examination',
  'Primary impression',
  'Bite registration',
  'Try in / Delivery',
  'ส่งงาน · ตรวจงานกับอาจารย์',
  'Laboratory work',
  'ไม่มีผู้ป่วย (no patient)',
] as const;

export const NO_PATIENT_ACTIVITY = 'ไม่มีผู้ป่วย (no patient)';

export function totalScore(scores: Record<string, number> | undefined): number | null {
  if (!scores) return null;
  return CRITERIA.reduce((sum, c) => sum + (scores[c.key] ?? 0), 0);
}
