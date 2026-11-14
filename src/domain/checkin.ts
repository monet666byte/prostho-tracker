/**
 * ระบบเช็คอินรายคาบ + อาจารย์ประเมิน
 * ถอดจากสมุดจริง "Clinical Performance Portfolio — Clinical rotation assessment logbook" (Part A + Part B)
 * เด็กเลือกจากรายการแทนการเขียนมือ · อาจารย์ให้คะแนน 0–3 แทนการเซ็นสมุด
 */

import type { CheckIn, ProgressUpdate, ReturnReason, WorkType, Workpiece } from './types';
import { orderOf } from './catalog';
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

/** คาบล่าสุดก่อนวันที่ที่กำหนดซึ่งกรอกกิจกรรมแล้ว — ไม่นับคาบที่กำลังแก้อยู่ (ปุ่ม "เหมือนคาบก่อน") */
export function lastFilledCheckIn(checkins: CheckIn[], beforeDate: string, excludeId?: string): CheckIn | undefined {
  return checkins
    .filter((c) => c.id !== excludeId && c.activities.length > 0 && c.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

/* ── อาจารย์ขอให้แก้คาบ (0034) ───────────────────────────────────────────────
   ไม่มีสถานะใหม่ — คาบยัง pending ให้ตัวนับรอประเมินทุกตัวทำงานเหมือนเดิม
   "ค้าง" = ยังไม่ประเมิน และนักศึกษายังไม่ได้แก้หลังเวลาที่ขอ */

export const RETURN_REASONS: ReadonlyArray<{ key: ReturnReason; label: string }> = [
  { key: 'patient', label: 'ผู้ป่วยไม่ตรง' },
  { key: 'activity', label: 'กิจกรรมไม่ตรง' },
  { key: 'time', label: 'วัน/เวลาไม่ถูก' },
  { key: 'step', label: 'ยังไม่บันทึก step' },
  { key: 'other', label: 'อื่นๆ' },
];

/** ข้อความเหตุผลสำหรับหน้าจอ (ผ่าน t()) — เหตุผลที่ไม่รู้จักข้ามไป ไม่ทำจอพัง */
export function returnReasonText(reasons: readonly string[] | undefined): string {
  return (reasons ?? [])
    .map((k) => RETURN_REASONS.find((r) => r.key === k)?.label)
    .filter((x): x is string => !!x)
    .map((x) => t(x))
    .join(' · ');
}

/** อาจารย์ขอให้แก้ และนักศึกษายังไม่ได้แก้หลังจากนั้น */
export function returnOpen(c: Pick<CheckIn, 'status' | 'returnedAt' | 'editedAt'>): boolean {
  if (c.status !== 'pending' || !c.returnedAt) return false;
  // เทียบเป็นเวลา ไม่เทียบสตริง — ตู้ส่ง timestamptz กลับมาเป็น "+00:00" และตัดเลขศูนย์ท้ายมิลลิวินาที
  const edited = c.editedAt ? Date.parse(c.editedAt) : NaN;
  const returned = Date.parse(c.returnedAt);
  return !(Number.isFinite(edited) && Number.isFinite(returned) && edited > returned);
}

/** นักศึกษาแก้ตามที่ขอแล้ว (ยังรอประเมิน) — ป้ายให้อาจารย์รู้ว่ากลับมาดูได้ */
export function returnFixed(c: Pick<CheckIn, 'status' | 'returnedAt' | 'editedAt'>): boolean {
  return c.status === 'pending' && !!c.returnedAt && !returnOpen(c);
}

/** คาบของเดือนหนึ่ง (month 0–11) — ปฏิทินคาบฝั่งนักศึกษา · เทียบจากสตริงวันที่ ไม่ผ่าน Date กันเขตเวลาเลื่อนวัน */
export function checkinsInMonth<T extends { date: string }>(list: T[], year: number, month: number): T[] {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  return list.filter((c) => c.date.startsWith(prefix));
}

/* ── ประวัติคาบรายคน แยกตามประเภทงาน ─────────────────────────────────────────
   คาบไม่ได้เก็บว่าเป็นงานชิ้นไหน — เก็บแค่คนไข้ จึงต้องไล่ คาบ → คนไข้ → เคสของนักศึกษาคนนั้น
   คนไข้คนเดียวมีหลายงานได้ (เช่น CD บน + RPD ล่าง) ถ้าเดาเข้ากลุ่มใดกลุ่มหนึ่ง เลขในกลุ่มจะคลาดเงียบๆ
   จึงตัดสินตามลำดับนี้ และไม่เดาเกินหลักฐาน:
     1. เคสของคนไข้นั้นมีประเภทเดียว → ประเภทนั้น
     2. หลายประเภท → ดู step ที่บันทึกว่าทำวันเดียวกับคาบ ถ้าชี้ประเภทเดียว → ประเภทนั้น
     3. ยังเหลือหลายประเภท → กลุ่ม "หลายงาน" (บอกประเภทที่เป็นไปได้)
     4. ไม่มีคนไข้ / คนไข้ไม่มีเคสของนักศึกษาคนนี้ → กลุ่ม "ไม่ผูกกับเคส" */

export type SessionWork =
  | { kind: 'type'; type: WorkType }
  | { kind: 'multi'; types: WorkType[] }
  | { kind: 'none' };

const sortTypes = (types: Iterable<WorkType>): WorkType[] =>
  [...new Set(types)].sort((a, b) => orderOf(a) - orderOf(b));

export function sessionWork(
  c: Pick<CheckIn, 'studentId' | 'patientId' | 'noPatient' | 'date'>,
  works: Pick<Workpiece, 'id' | 'studentId' | 'patientId' | 'type'>[],
  updates: Pick<ProgressUpdate, 'workpieceId' | 'performedAt' | 'reversal'>[],
): SessionWork {
  if (c.noPatient || !c.patientId) return { kind: 'none' };
  const mine = works.filter((w) => w.studentId === c.studentId && w.patientId === c.patientId);
  const types = sortTypes(mine.map((w) => w.type));
  if (types.length === 0) return { kind: 'none' };
  if (types.length === 1) return { kind: 'type', type: types[0] };
  const typeById = new Map(mine.map((w) => [w.id, w.type]));
  const sameDay = sortTypes(
    updates
      .filter((u) => !u.reversal && u.performedAt === c.date && typeById.has(u.workpieceId))
      .map((u) => typeById.get(u.workpieceId)!),
  );
  if (sameDay.length === 1) return { kind: 'type', type: sameDay[0] };
  return { kind: 'multi', types: sameDay.length ? sameDay : types };
}

export interface WorkHistoryGroup {
  /** ประเภทงาน หรือ 'multi' / 'none' */
  key: WorkType | 'multi' | 'none';
  /** ประเภทที่เป็นไปได้ของกลุ่ม 'multi' (รวมทุกคาบในกลุ่ม) */
  types: WorkType[];
  /** เก่า → ใหม่ */
  sessions: CheckIn[];
  evaluated: number;
  pending: number;
  /** หัวข้อที่ได้ต่ำกว่า 3 บ่อยที่สุด — มีเฉพาะเมื่อต่ำตั้งแต่ 2 คาบ (ครั้งเดียวยังไม่นับว่า "ซ้ำ") */
  repeatLow?: { key: string; count: number };
}

/** จัดคาบของนักศึกษาหนึ่งคนเป็นกลุ่มตามประเภทงาน · ลำดับกลุ่มตาม catalog แล้วตามด้วย "หลายงาน" / "ไม่ผูกกับเคส" */
export function groupSessionsByWork(
  sessions: CheckIn[],
  works: Pick<Workpiece, 'id' | 'studentId' | 'patientId' | 'type'>[],
  updates: Pick<ProgressUpdate, 'workpieceId' | 'performedAt' | 'reversal'>[],
): WorkHistoryGroup[] {
  const byKey = new Map<WorkHistoryGroup['key'], { types: Set<WorkType>; sessions: CheckIn[] }>();
  for (const c of sessions) {
    const sw = sessionWork(c, works, updates);
    const key = sw.kind === 'type' ? sw.type : sw.kind;
    const g = byKey.get(key) ?? { types: new Set<WorkType>(), sessions: [] };
    if (sw.kind === 'multi') sw.types.forEach((x) => g.types.add(x));
    g.sessions.push(c);
    byKey.set(key, g);
  }
  const rank = (k: WorkHistoryGroup['key']) => (k === 'multi' ? 1000 : k === 'none' ? 1001 : orderOf(k));
  return [...byKey.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, g]) => {
      const list = [...g.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
      const done = list.filter((c) => c.status === 'evaluated' && c.scores);
      let repeatLow: WorkHistoryGroup['repeatLow'];
      for (const cr of CRITERIA) {
        const count = done.filter((c) => (c.scores?.[cr.key] ?? 3) < 3).length;
        if (count >= 2 && count > (repeatLow?.count ?? 0)) repeatLow = { key: cr.key, count };
      }
      return {
        key,
        types: sortTypes(g.types),
        sessions: list,
        evaluated: done.length,
        pending: list.filter((c) => c.status !== 'evaluated').length,
        repeatLow,
      };
    });
}

/** คะแนนต่ำสุดของคาบ — ใช้ให้สีชิปในประวัติ (ข้อที่แย่ที่สุดของคาบนั้น) · ยังไม่ประเมิน = undefined */
export function lowestScore(c: Pick<CheckIn, 'scores'>): number | undefined {
  if (!c.scores) return undefined;
  const vals = CRITERIA.map((cr) => c.scores![cr.key]).filter((v): v is number => typeof v === 'number');
  return vals.length ? Math.min(...vals) : undefined;
}
