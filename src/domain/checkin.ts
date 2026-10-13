/**
 * ระบบเช็คอินรายคาบ + อาจารย์ประเมิน
 * ถอดจากสมุดจริง "Clinical Performance Portfolio — Clinical rotation assessment logbook" (Part A + Part B)
 * เด็กเลือกจากรายการแทนการเขียนมือ · อาจารย์ให้คะแนน 0–3 แทนการเซ็นสมุด
 */

import type { CheckIn } from './types';
import { t } from '../lib/i18n';

/** คอลัมน์คะแนนตาม Part B ของสมุดจริง
 *  label/short เป็นอังกฤษทั้งสองภาษา ตามศัพท์ในสมุดจริง (ภาคไม่ต้องการคำแปล) · th ใช้เป็น tooltip
 *  rubric = คำอธิบายแต่ละระดับ ถอดจาก "Scoring rubrics for Section I" (สมุดฉบับ Edited 29 Apr 2025)
 *  สามข้อแรกมี 4 ระดับ 3/2/1/0 · อีกห้าข้อมีแค่ 3/1/0 — ระดับที่ให้ได้อ่านจาก key ของ rubric (ดู scoreLevels)
 *  เชิงอรรถท้ายหน้าเกณฑ์ของ Universal Precaution เป็นกติกาตัดเกรด จึงไม่ใส่ในแอป (ระบบนี้ไม่ตัดเกรด) */
export const CRITERIA = [
  {
    key: 'knowledge', label: 'Overall Knowledge', th: 'ความรู้โดยรวม', short: 'Knowledge',
    rubric: {
      3: 'Demonstrates an excellent understanding of the topics associated with the clinical procedures; well prepared for questions and problems encountered during clinical practice.',
      2: 'Demonstrates solid understanding of the topics associated with the clinical procedures; highlights the important points where he/she encounters during clinical practice.',
      1: 'Demonstrates a lack of knowledge in critical components of the clinical procedures.',
      0: 'Demonstrates poor knowledge of the clinical procedures.',
    },
  },
  {
    key: 'skill', label: 'Overall Skill', th: 'ทักษะโดยรวม', short: 'Skill',
    rubric: {
      3: 'Optimal competent to perform the task without error or instructor intervention (except an instructor’s demonstration).',
      2: 'Optimal competent to perform the task with minor error BUT do not need instructor intervention.',
      1: 'Deficient competent to perform task AND instructor intervention should be provided.',
      0: 'Unable to perform the task and need full instructor intervention; OR conduct critical mistake.',
    },
  },
  {
    key: 'precaution', label: 'Universal Precaution', th: 'การป้องกันการติดเชื้อ', short: 'Precaution',
    rubric: {
      3: 'Performs all clinical procedures with standard infection control.',
      2: 'Partially performs standard infection control, can recognize mistake AND self-correction.',
      1: 'Partially performs standard infection control BUT cannot recognize mistake.',
      0: 'Cannot demonstrate standard infection control techniques.',
    },
  },
  {
    key: 'instrument', label: 'Instrument Preparation', th: 'การเตรียมเครื่องมือ', short: 'Instrument',
    rubric: {
      3: 'Prepares all instruments adequate to perform tasks AND uses material efficiently.',
      1: 'Some instruments are not prepared OR use material inefficiently.',
      0: 'Unprepared instruments OR waste of material.',
    },
  },
  {
    key: 'time', label: 'Time Management in Clinic', th: 'การบริหารเวลาในคลินิก', short: 'Time',
    rubric: {
      3: 'Efficient management of time and procedures provided AND finishes treatment 30 minutes before the period ends or as instructor permission.',
      1: 'Efficient management of time and procedures provided BUT finishes treatment late.',
      0: 'Inefficient management of time and procedures provided AND finishes treatment late.',
    },
  },
  {
    key: 'chart', label: 'Chart Recording', th: 'การบันทึกชาร์ต', short: 'Chart',
    rubric: {
      3: 'Complete and accurate chart record AND signs within the clinical period.',
      1: 'Mostly accurate chart record AND signs within the clinical period.',
      0: 'Incomplete or inaccurate chart record AND/OR signs after the clinical period.',
    },
  },
  {
    key: 'communication', label: 'Interpersonal Communication', th: 'การสื่อสาร', short: 'Comm.',
    rubric: {
      3: 'Able to provide appropriate and professional communication with patient, instructor, or other personnels AND applies psychosocial and behavioral principles in patient-centered health care AND communicates effectively with individuals from diverse population.',
      1: 'Appropriate and professional communication with patient, instructor, or other personnels BUT unable to apply psychosocial and behavioral principles in patient-centered health care OR communicates effectively with individuals from diverse population.',
      0: 'Not demonstrates appropriate and professional communication with patient, instructor, or others.',
    },
  },
  {
    key: 'conduct', label: 'General Conduct', th: 'ความประพฤติทั่วไป', short: 'Conduct',
    rubric: {
      3: 'Performs treatment with patient safety or tasks as assigned AND demonstrates integrity, professional dress code, comply with relevant rules and regulations.',
      1: 'Performs treatment with patient safety or tasks as assigned BUT partially demonstrates integrity, professional dress code comply with relevant rules and regulations.',
      0: 'Performs treatment with patient trauma or incomplete assigned tasks OR not comply with relevant rules and regulations.',
    },
  },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]['key'];

/** ช่องคะแนนทั้งหมดที่เป็นไปได้ เรียงน้อย→มาก — หน้าจอวางปุ่มตามช่องนี้ ข้อที่ไม่มีระดับนั้นเว้นช่องว่างไว้ให้คอลัมน์ตรงกัน */
export const SCORE_SLOTS = [0, 1, 2, 3] as const;

/** ระดับที่ให้ได้ในหัวข้อนี้ (น้อย→มาก) — Knowledge/Skill/Precaution = 0 1 2 3 · ที่เหลือ = 0 1 3 */
export function scoreLevels(key: string): number[] {
  const cr = CRITERIA.find((c) => c.key === key);
  return cr ? Object.keys(cr.rubric).map(Number).sort((a, b) => a - b) : [];
}

export function isValidScore(key: string, n: number | undefined): boolean {
  return n !== undefined && scoreLevels(key).includes(n);
}

/** คำอธิบายระดับนั้นจากสมุด (ไม่มี = หัวข้อนี้ไม่มีระดับนั้น) */
export function rubricText(key: string, n: number): string | undefined {
  const cr = CRITERIA.find((c) => c.key === key);
  return cr ? (cr.rubric as Record<number, string>)[n] : undefined;
}

/** หัวข้อที่ยังไม่ได้เลือกคะแนน (หรือค่าไม่อยู่ในระดับของหัวข้อนั้น) — หน้าประเมินเริ่มแบบยังไม่เลือก ต้องครบก่อนลงนาม */
export function missingCriteria(scores: Record<string, number> | undefined): CriterionKey[] {
  return CRITERIA.filter((c) => !isValidScore(c.key, scores?.[c.key])).map((c) => c.key);
}

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

/** คาบของเดือนหนึ่ง (month 0–11) — ปฏิทินคาบฝั่งนักศึกษา · เทียบจากสตริงวันที่ ไม่ผ่าน Date กันเขตเวลาเลื่อนวัน */
export function checkinsInMonth<T extends { date: string }>(list: T[], year: number, month: number): T[] {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  return list.filter((c) => c.date.startsWith(prefix));
}
