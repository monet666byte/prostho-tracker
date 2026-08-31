/**
 * ระบบเช็คอินรายคาบ + อาจารย์ประเมิน
 * ถอดจากสมุดจริง "Clinical Performance Portfolio — Clinical rotation assessment logbook" (Part A + Part B)
 * เด็กเลือกจากรายการแทนการเขียนมือ · อาจารย์ให้คะแนน 0–3 แทนการเซ็นสมุด
 */

/** คอลัมน์คะแนนตาม Part B ของสมุดจริง — ข้อละ 0–3 */
/* short = ป้ายบนกราฟแมงมุม — ใช้อังกฤษทับศัพท์ทั้งสองภาษา (ศัพท์ในสมุดจริงเป็นอังกฤษ ผู้ใช้บอกไม่ต้องแปล) */
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

/** กิจกรรมในคาบ — จากช่อง "Appointed Patient (Name/Work)" ที่เด็กเคยต้องเขียนมือ */
/**
 * ขยายให้ครอบทั้งเส้นทาง 10 ขั้นของงานจริง (ผู้ใช้ทัก 31 ส.ค. — 7 อันเดิม
 * ไม่ครอบ เช่นวันพิมพ์ final วันกรอฟัน วันปรับแก้ วัน recall)
 * ขั้นแล็บช่วงกลาง (Set up · Waxing · Flasking …) รวมอยู่ใน Laboratory work
 * เรียงตามลำดับที่เกิดจริงในคลินิก
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

/**
 * จัดกิจกรรมเป็นหมวดตามช่วงงาน — ผู้ใช้ทักว่าชิป 11 อันกองรวมกันไม่เป็นระเบียบ
 * (11 อันเดิมยังอยู่ใน ACTIVITIES ครบ แค่จัดกลุ่มให้กวาดตาง่าย)
 */
export const ACTIVITY_GROUPS: ReadonlyArray<{ label: string; items: readonly string[] }> = [
  { label: 'ตรวจ · พิมพ์ปาก', items: ['Oral examination', 'Primary impression', 'Final impression', 'Bite registration'] },
  { label: 'งานข้างเก้าอี้', items: ['Tooth preparation', 'Try in / Delivery', 'ปรับแก้หลังใส่งาน', 'Recall'] },
  { label: 'อื่นๆ', items: ['Laboratory work', 'ส่งงาน · ตรวจงานกับอาจารย์', NO_PATIENT_ACTIVITY] },
];

export function totalScore(scores: Record<string, number> | undefined): number | null {
  if (!scores) return null;
  return CRITERIA.reduce((sum, c) => sum + (scores[c.key] ?? 0), 0);
}
