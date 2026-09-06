/**
 * แบบประเมินตนเอง (Self-assessment report) — ปีละครั้ง ตอนจบเทอม 1
 *
 * ถอดจากฟอร์มจริงของภาค "Self-assessment (SA) report: MIDS Prosthodontic Clinic"
 * (ไฟล์ Word ฉบับ Revision Oct 2025) — เดิมนักศึกษาพิมพ์ลง Word แล้วส่งอาจารย์ที่ปรึกษา
 *
 * ทำไมต้องเก็บทีละช่อง (ไม่ใช่ก้อนข้อความเดียว):
 *   ① เอาคำตอบไปชนกับข้อมูลจริงในแอปได้ (คะแนนรายคาบ · จำนวนเคส · ความก้าวหน้า) → saFeedback.ts
 *   ② วันหน้าถ้าจะให้ AI ช่วยเขียนสรุป ก็ส่งไปแบบมีโครงสร้างได้ทันที ไม่ต้องแกะข้อความ
 *
 * ฟอร์มภาคปรับได้ทุกปี — คำตอบทุกชุดจึงติด formVersion ไว้ ของเก่าอ่านได้เสมอ
 */

import { lang } from '../lib/i18n';

/** ขยับเลขนี้เมื่อ "ความหมายของคำถาม" เปลี่ยน (เพิ่ม/ลบ/แก้ข้อ) — ของเก่ายังอ่านได้ตามเวอร์ชันเดิม */
export const SA_FORM_VERSION = '2569.2';

/**
 * รหัสวิชาบนหัวฟอร์ม SA ต้นฉบับ — ⚠️ คนละตัวกับ DTPT502 ที่แอปใช้ทั้งระบบ
 * ยังไม่ได้ยืนยันกับอาจารย์ว่าอันไหนถูก จึงยึดตามที่ฟอร์มเขียนไว้ (เจอตอนเทียบ 6 ก.ย. 69)
 */
export const SA_COURSE_CODE = 'DTIS543';

/** ที่มาของฟอร์ม — โชว์ท้ายหน้าให้รู้ว่าอ้างอิงฉบับไหน */
export const SA_SOURCE = 'MIDS Prosthodontic Clinic · Revision Oct 2025';

export type SAKind =
  | 'text' // ข้อความยาว
  | 'scale' // 0–4 ตาม rubric ของฟอร์ม
  | 'level' // Appropriate / Need improvement
  | 'yesno' // Yes / No
  | 'multi'; // เลือกได้หลายข้อ

/** ค่าที่เก็บได้ในหนึ่งช่อง — scale/level/yesno เก็บเป็นตัวเลข, multi เก็บเป็น array */
export type SAValue = string | number | string[] | null;

export interface SAQuestion {
  key: string;
  kind: SAKind;
  /** ข้อความตามฟอร์มจริง (อังกฤษ) — ใช้เป็นป้ายในโหมด EN และเป็นคำที่อาจารย์คุ้น */
  label: string;
  /** คำแปลไทย — นักศึกษาอ่านง่ายขึ้น ไม่ต้องพึ่งพจนานุกรม i18n */
  th: string;
  hint?: string;
  hintTh?: string;
  options?: readonly string[];
  optionsTh?: readonly string[];
  /** เปิดช่อง "อื่นๆ" ให้พิมพ์เอง (เก็บที่คีย์ `${key}Other`) */
  other?: boolean;
  /** ข้อนี้โชว์เฉพาะชั้นปีนี้ (ฟอร์มระบุ "Only for 5th-year students") */
  yearOnly?: number;
  /** ไม่บังคับกรอก — ข้อที่เหลือถือว่าต้องตอบก่อนส่ง */
  optional?: boolean;
  /** ตอบ N/A ได้ (ฟอร์มจริงมีช่อง N/A ในตาราง K/S) — เก็บเป็น -1 */
  allowNA?: boolean;
  /**
   * ตอนพิมพ์ ให้เอาคำตอบข้อนี้ไปต่อท้ายแถวก่อนหน้า แทนที่จะขึ้นแถวใหม่
   *
   * ฟอร์มต้นฉบับบางข้อเป็นข้อความยาวช่องเดียว (เช่น "Adequacy of Instructor Support:
   * Yes. They are approachable…") แต่ในแอปเราแยกเป็น Yes/No + ช่องเหตุผล เพื่อให้
   * ระบบเอาไปคำนวณได้ · กระดาษที่อาจารย์เซ็นจึงต้องรวมกลับเป็นแถวเดียวให้เหมือนเดิม
   */
  printMerge?: boolean;
  /** หัวย่อยที่ต้องขึ้นก่อนข้อนี้ ตามที่ฟอร์มต้นฉบับมี (เช่น "Prosthesis design;") */
  sub?: string;
  subTh?: string;
  /** ข้อที่อยู่แถวเดียวกันในตาราง K/S — UI จับมารวมเป็นบรรทัดเดียว */
  row?: string;
  col?: 'K' | 'S';
}

export interface SASection {
  key: string;
  title: string;
  th: string;
  /**
   * ตอนพิมพ์ ไม่ต้องขึ้นหัวหมวดใหม่ — ต่อจากหมวดก่อนหน้าเลย
   * ฟอร์มต้นฉบับมีหัวเดียว ("Patient Examination and Treatment Planning, K and S…")
   * คร่อมทั้งตาราง Prosthesis design และ Prosthodontic procedures
   * แต่ในแอปเราแยกเป็น 2 หมวดเพื่อไม่ให้หน้าจอมือถือยาวเกินไป
   */
  printContinues?: boolean;
  note?: string;
  noteTh?: string;
  questions: readonly SAQuestion[];
}

/** rubric ของฟอร์ม — ใช้เป็นป้ายใต้ปุ่ม 0–4 */
export const SA_SCALE = [
  { v: 0, label: 'Very low', th: 'น้อยมาก' },
  { v: 1, label: 'Low', th: 'น้อย' },
  { v: 2, label: 'Moderate', th: 'ปานกลาง' },
  { v: 3, label: 'High', th: 'มาก' },
  { v: 4, label: 'Very high', th: 'มากที่สุด' },
] as const;

export const SA_MAX_SCALE = 4;

/** Appropriate = 1 · Need improvement = 0 (เก็บเป็นตัวเลขเพื่อเอาไปเฉลี่ย/เทียบได้) */
export const SA_APPROPRIATE = 1;
export const SA_NEEDS_WORK = 0;

/** หัวข้อ OSCE ที่ให้เลือก — อิงหัวข้อในฟอร์มจริง + ขั้นตอนหลักในคลินิกประดิษฐ์ */
const OSCE_TOPICS = [
  'Selective grinding', 'Study cast fabrication', 'Post and core procedure',
  'Impression technique', 'Jaw relation record', 'Tooth preparation',
  'RPD design', 'Shade selection', 'Try-in', 'Denture insertion & adjustment',
] as const;
const OSCE_TOPICS_TH = [
  'Selective grinding', 'การทำ study cast', 'Post and core',
  'เทคนิคการพิมพ์ปาก', 'การจดความสัมพันธ์ขากรรไกร', 'การกรอแต่งฟัน',
  'การออกแบบ RPD', 'การเลือกสีฟัน', 'การลองงาน (try-in)', 'การใส่และปรับแก้ฟันเทียม',
] as const;

const LAB_SKILLS = [
  'Impression skills', 'Tooth and canal preparation skills', 'Cast pouring and trimming',
  'Wax-up', 'Temporary crown fabrication', 'Polishing and finishing',
] as const;
const LAB_SKILLS_TH = [
  'การพิมพ์ปาก', 'การกรอฟันและคลองราก', 'การเทและแต่งโมเดล',
  'การแต่งขี้ผึ้ง', 'การทำครอบฟันชั่วคราว', 'การขัดแต่งงาน',
] as const;

/** 4 ประเภทงานหลักตามที่ฟอร์มระบุ ("Type of cases accepted") */
export const SA_TYPES = [
  { key: 'CD', label: 'Complete dentures (CD)', th: 'ฟันเทียมทั้งปาก (CD)' },
  { key: 'RPD', label: 'Removable partial dentures (RPD/APD)', th: 'ฟันเทียมบางส่วนถอดได้ (RPD/APD)' },
  { key: 'CB', label: 'Crown or Bridges', th: 'ครอบฟัน / สะพานฟัน' },
  { key: 'PC', label: 'Post and core', th: 'เดือยฟัน (Post & core)' },
] as const;

export type SAType = (typeof SA_TYPES)[number]['key'];

const designQ = (t: (typeof SA_TYPES)[number], first = false): SAQuestion => ({
  key: `design${t.key}`, kind: 'scale', label: t.label, th: t.th,
  ...(first ? { sub: 'Prosthesis design;', subTh: 'การออกแบบชิ้นงาน' } : {}),
});

const procQ = (t: (typeof SA_TYPES)[number], col: 'K' | 'S'): SAQuestion => ({
  key: `proc${t.key}${col}`, kind: 'scale', label: t.label, th: t.th,
  row: `proc${t.key}`, col, allowNA: true,
});

export const SA_SECTIONS: readonly SASection[] = [
  {
    key: 'expectations',
    title: 'Student Expectations & Goals',
    th: 'ความคาดหวังและเป้าหมาย',
    questions: [
      { key: 'goals', kind: 'text', label: 'Goals', th: 'เป้าหมายของฉันในคลินิกนี้',
        hint: 'What do you want to achieve in this rotation?', hintTh: 'อยากได้อะไรกลับไปจากการขึ้นคลินิกรอบนี้' },
      { key: 'strength', kind: 'text', label: 'Strength', th: 'จุดแข็งของฉัน' },
      /* บอกตรงๆ ว่าใครเห็น — ผู้ใช้ยืนยัน 4 ก.ย. 69 ว่าอาจารย์ทุกคนในภาคเห็นได้
         (ที่ปรึกษาแลกกลุ่มกันระหว่างปี) ข้อความจึงต้องไม่สัญญาว่า "เฉพาะที่ปรึกษา" */
      { key: 'limitations', kind: 'text', label: 'Limitations', th: 'ข้อจำกัดของฉัน',
        hint: 'Instructors in the department can read this — not your classmates',
        hintTh: 'อาจารย์ในภาควิชาอ่านได้ · เพื่อนร่วมรุ่นไม่เห็น' },
    ],
  },
  {
    key: 'osce',
    title: 'Part 1: Feedback on OSCE',
    th: 'ความเห็นต่อ OSCE',
    note: 'Only for 5th-year students',
    noteTh: 'เฉพาะนักศึกษาชั้นปีที่ 5',
    questions: [
      { key: 'osceTopics', kind: 'multi', label: 'Challenging Topics', th: 'หัวข้อที่รู้สึกยาก',
        options: OSCE_TOPICS, optionsTh: OSCE_TOPICS_TH, other: true, yearOnly: 5 },
      { key: 'osceHelp', kind: 'text', label: 'How the OSCE Helps', th: 'OSCE ช่วยอะไรเราบ้าง', yearOnly: 5 },
      { key: 'osceComment', kind: 'text', label: 'Additional Comments/Suggestions',
        th: 'ข้อเสนอแนะเพิ่มเติม', yearOnly: 5, optional: true },
    ],
  },
  {
    key: 'prep',
    title: 'Part 2: Preparedness for clinical rotation & patient treatment',
    th: 'ความพร้อมก่อนขึ้นคลินิก',
    questions: [
      { key: 'prepSkills', kind: 'scale', label: 'Improvement in Clinical Skills', th: 'พัฒนาการของทักษะคลินิก' },
      { key: 'prepDocs', kind: 'scale', label: 'Readiness for Patient Assessments and Documentation',
        th: 'ความพร้อมเรื่องการตรวจและการบันทึกเอกสาร' },
      { key: 'prepEthics', kind: 'scale', label: 'Concern for Ethical and Professional Practices',
        th: 'ความใส่ใจเรื่องจริยธรรมและวิชาชีพ' },
      { key: 'prepCommunication', kind: 'scale', label: 'Confidence in Communication', th: 'ความมั่นใจในการสื่อสาร' },
      { key: 'prepPreclinical', kind: 'scale', label: 'Confidence in Applying Preclinical Knowledge',
        th: 'ความมั่นใจในการใช้ความรู้จากปรีคลินิก' },
      { key: 'prepOrientation', kind: 'scale', label: 'Informative Value of Orientation and Clinical Handbook',
        th: 'ประโยชน์ของการปฐมนิเทศและคู่มือคลินิก' },
      { key: 'prepResources', kind: 'scale', label: 'Usefulness of Learning Resources and Supporting Materials',
        th: 'ประโยชน์ของสื่อและแหล่งเรียนรู้' },
      { key: 'prepNeeds', kind: 'text', label: 'Additional Preparation or Resources Before Clinical Rotation',
        th: 'อยากได้การเตรียมตัวหรือแหล่งข้อมูลอะไรเพิ่ม', optional: true },
      { key: 'prepApproaches', kind: 'text', label: 'Instructional Approaches for Overcoming Obstacles',
        th: 'วิธีสอนแบบไหนช่วยให้ผ่านอุปสรรคได้', optional: true },
    ],
  },
  {
    key: 'lab',
    title: 'Part 3: Preparedness for lab works & work authorization',
    th: 'ความพร้อมด้านงานแล็บ',
    questions: [
      { key: 'labSafety', kind: 'scale', label: 'Understanding of Lab Safety Protocols', th: 'ความเข้าใจเรื่องความปลอดภัยในแล็บ' },
      { key: 'labProcedures', kind: 'scale', label: 'Understanding of Lab Procedures', th: 'ความเข้าใจขั้นตอนงานแล็บ' },
      { key: 'labAuth', kind: 'scale', label: 'Understanding of Documentation and Procedures for Lab Authorization',
        th: 'ความเข้าใจเรื่องเอกสารสั่งงานแล็บ (work authorization)' },
      { key: 'labSkills', kind: 'multi', label: 'Competence in Basic Lab Techniques and Procedures',
        th: 'ทักษะแล็บที่คิดว่าทำได้ดี', options: LAB_SKILLS, optionsTh: LAB_SKILLS_TH, other: true },
      { key: 'labIssues', kind: 'text', label: 'Issues with Work Authorization of Lab Work',
        th: 'ปัญหาเรื่องใบสั่งงานแล็บ', optional: true },
    ],
  },
  {
    key: 'course',
    title: 'Part 4: Course objectives/requirement progression',
    th: 'วัตถุประสงค์และเกณฑ์ของรายวิชา',
    questions: [
      { key: 'courseObjectives', kind: 'scale', label: 'Understanding of Course Objectives and Work Requirements',
        th: 'ความเข้าใจวัตถุประสงค์และเกณฑ์งาน' },
      { key: 'courseGrading', kind: 'scale', label: 'Understanding of Grading and Evaluation Criteria',
        th: 'ความเข้าใจเกณฑ์การให้คะแนน' },
      { key: 'courseConfidence', kind: 'scale', label: 'Confidence in Completing Course Requirements',
        th: 'ความมั่นใจว่าจะทำครบเกณฑ์ทันเวลา' },
      { key: 'courseConfidenceNote', kind: 'text', label: 'Why do you feel that way?', th: 'เพราะอะไรถึงรู้สึกแบบนั้น', printMerge: true },
      { key: 'courseAlignment', kind: 'text', label: 'Alignment of Course Requirements with Career Goals',
        th: 'เกณฑ์ของวิชาตรงกับเป้าหมายอาชีพเราไหม', optional: true },
      { key: 'courseSupport', kind: 'yesno', label: 'Adequacy of Instructor Support', th: 'อาจารย์ให้คำแนะนำเพียงพอไหม' },
      /* ต้นฉบับตอบเป็นข้อความ ("Yes. They are approachable, give clear guidance…") — Yes/No อย่างเดียวเก็บเหตุผลไม่ได้ */
      { key: 'courseSupportNote', kind: 'text', label: 'Please explain', th: 'ขยายความ', optional: true, printMerge: true },
      { key: 'courseExtra', kind: 'yesno', label: 'Interest in Adding Extra Course Requirements',
        th: 'สนใจทำงานเกินเกณฑ์เพิ่มไหม' },
    ],
  },
  {
    key: 'design',
    title: 'Patient Examination and Treatment Planning, Knowledge (K) and Skills (S) Assessment on Prosthodontics Topics',
    th: 'การตรวจ วางแผน และออกแบบชิ้นงาน',
    questions: [
      /* ข้อนี้อยู่ใต้หัวหมวดในฟอร์มต้นฉบับ ("Type of cases accepted: CD, RPD/APD, Crown or Bridges, Post and core")
         เคยตกหล่นตอนถอดฟอร์ม — เจอตอนเทียบทีละบรรทัด 6 ก.ย. 69 */
      { key: 'typesAccepted', kind: 'multi', label: 'Type of cases accepted', th: 'ประเภทเคสที่รับไว้',
        options: SA_TYPES.map((t) => t.key), optionsTh: SA_TYPES.map((t) => t.th), other: true },
      { key: 'infoGathering', kind: 'scale', label: 'Information gathering', th: 'การเก็บข้อมูลผู้ป่วย' },
      { key: 'reasoning', kind: 'scale', label: 'Clinical reasoning and treatment planning',
        th: 'การให้เหตุผลทางคลินิกและวางแผนการรักษา' },
      ...SA_TYPES.map((t, i) => designQ(t, i === 0)),
    ],
  },
  {
    key: 'procedures',
    printContinues: true,
    title: 'Prosthodontic procedures — Knowledge (K) and Skills (S)',
    th: 'หัตถการ — ความรู้ (K) และทักษะ (S)',
    note: 'Rate what you know (K) and what you can do (S) for each type',
    noteTh: 'ให้คะแนนแยกว่า "รู้" แค่ไหน กับ "ทำได้" แค่ไหน · ยังไม่เคยทำเลือก N/A ได้',
    questions: [
      ...SA_TYPES.flatMap((t) => [procQ(t, 'K'), procQ(t, 'S')]),
      /* ต้นฉบับให้พิมพ์อิสระ (ตัวอย่างตอบ "RPD" / "Post and core") — คงตัวเลือกไว้ให้กดเร็ว
         แต่ต้องมีช่องพิมพ์เองด้วย ไม่งั้นตอบเรื่องที่ไม่ใช่ประเภทงาน เช่น "impression technique" ไม่ได้ */
      { key: 'confidentTypes', kind: 'multi', label: 'Confident topics', th: 'หัวข้อที่มั่นใจ',
        options: SA_TYPES.map((t) => t.key), optionsTh: SA_TYPES.map((t) => t.th), other: true, optional: true },
      { key: 'improveTypes', kind: 'multi', label: 'Need improvement topics', th: 'หัวข้อที่อยากพัฒนา',
        options: SA_TYPES.map((t) => t.key), optionsTh: SA_TYPES.map((t) => t.th), other: true, optional: true },
    ],
  },
  {
    key: 'professionalism',
    title: 'Patient Treatment, Attitudes, and Professionalism Assessment',
    th: 'การดูแลผู้ป่วย ทัศนคติ และความเป็นวิชาชีพ',
    questions: [
      { key: 'profPrecaution', kind: 'level', label: 'Universal precautions', th: 'การป้องกันการติดเชื้อ' },
      { key: 'profInstrument', kind: 'level', label: 'Instrument preparation', th: 'การเตรียมเครื่องมือ' },
      { key: 'profTime', kind: 'level', label: 'Time management', th: 'การบริหารเวลา' },
      { key: 'profPatient', kind: 'level', label: 'Patient management', th: 'การจัดการผู้ป่วย' },
      { key: 'profCommunication', kind: 'level', label: 'Interpersonal communication', th: 'การสื่อสารกับผู้อื่น' },
      { key: 'profAppearance', kind: 'level', label: 'Professional appearances', th: 'บุคลิกภาพเชิงวิชาชีพ' },
      { key: 'profDocuments', kind: 'level', label: 'Documents management', th: 'การจัดการเอกสาร' },
      { key: 'profConcern', kind: 'text', label: 'Concerns in providing dental care',
        th: 'มีเรื่องกังวลในการดูแลผู้ป่วยไหม', optional: true },
    ],
  },
  {
    key: 'problems',
    title: 'Problems in Clinical Practice',
    th: 'ปัญหาที่เจอในคลินิก',
    questions: [
      { key: 'probPreprosth', kind: 'yesno', label: 'Pre-prosthetic procedures', th: 'ขั้นเตรียมก่อนใส่ฟันเทียม' },
      { key: 'probRedone', kind: 'yesno', label: 'Repeated steps / Redone work', th: 'ต้องทำซ้ำ / รื้อทำใหม่' },
      { key: 'probComplex', kind: 'yesno', label: 'Complex cases', th: 'เคสยาก' },
      { key: 'probPlanning', kind: 'yesno', label: 'Treatment planning', th: 'การวางแผนการรักษา' },
      { key: 'probDelay', kind: 'text', label: 'Factors have caused delays in the treatment planning phase',
        th: 'อะไรทำให้การวางแผนล่าช้า', optional: true },
    ],
  },
  {
    key: 'final',
    title: 'Final Thoughts',
    th: 'ส่งท้าย',
    questions: [
      { key: 'finalInterest', kind: 'text', label: 'Interesting topics',
        th: 'เรื่องที่อยากพัฒนาต่อ' },
      { key: 'finalOnTrack', kind: 'yesno', label: 'Goal approaching', th: 'รู้สึกว่าเข้าใกล้เป้าหมายไหม' },
      { key: 'finalGoalNote', kind: 'text', label: 'Why?', th: 'เพราะอะไร', optional: true, printMerge: true },
      { key: 'finalStrategies', kind: 'text', label: 'Strategies/Approaches',
        th: 'แผนของเทอมหน้า' },
    ],
  },
] as const;

/* ── ตัวช่วยอ่านฟอร์ม ────────────────────────────────────────────────────── */

/** ป้ายตามภาษาที่เลือก — ฟอร์มต้นฉบับเป็นอังกฤษ ไทยไว้ให้ นศ. อ่านง่าย */
export function saLabel(q: Pick<SAQuestion, 'label' | 'th'>): string {
  return lang === 'en' ? q.label : q.th;
}

export function saSectionLabel(s: Pick<SASection, 'title' | 'th'>): string {
  return lang === 'en' ? s.title : s.th;
}

export function saHint(q: SAQuestion): string | undefined {
  return lang === 'en' ? q.hint : (q.hintTh ?? q.hint);
}

export function saNote(s: SASection): string | undefined {
  return lang === 'en' ? s.note : (s.noteTh ?? s.note);
}

/**
 * ป้ายคอลัมน์ K/S — คงตัวย่อไว้ตามฟอร์มจริงของภาค (หัวตารางในไฟล์ Word คือ "K" กับ "S")
 * นักศึกษาเห็นตัวย่อเดียวกับที่จะเจอในกระดาษ จึงไม่ต้องแปลงในหัวตอนสลับสองที่
 */
export function saColLabel(col: 'K' | 'S'): string {
  if (lang === 'en') return col === 'K' ? 'Knowledge (K)' : 'Skill (S)';
  return col === 'K' ? 'ความรู้ (K)' : 'ทักษะ (S)';
}

/**
 * ข้อความในช่อง "อื่นๆ" ที่นักศึกษาพิมพ์เอง
 *
 * เก็บไว้ที่คีย์ `${key}Other` ซึ่งไม่มีคำถามรองรับในโครงฟอร์ม — ถ้าไม่ดึงออกมาตรงนี้
 * ข้อความจะถูกบันทึกลงฐานข้อมูลแล้วไม่มีใครเห็นเลยสักที่ (เจอตอนไล่บั๊ก 6 ก.ย. 69)
 */
export function saOtherText(q: SAQuestion, answers: Record<string, SAValue>): string {
  if (!q.other) return '';
  const v = answers[`${q.key}Other`];
  return typeof v === 'string' ? v.trim() : '';
}

/** หัวย่อยของข้อนี้ (ถ้ามี) — ตามที่ฟอร์มต้นฉบับจัดกลุ่มไว้ */
export function saSub(q: SAQuestion): string | undefined {
  return lang === 'en' ? q.sub : (q.subTh ?? q.sub);
}

export function saOption(q: SAQuestion, i: number): string {
  const en = q.options?.[i] ?? '';
  return lang === 'en' ? en : (q.optionsTh?.[i] ?? en);
}

/** ข้อที่นักศึกษาชั้นปีนี้ต้องเห็น (ฟอร์มมีบล็อกเฉพาะปี 5) */
export function saQuestionsFor(section: SASection, year: number): SAQuestion[] {
  return section.questions.filter((q) => !q.yearOnly || q.yearOnly === year);
}

export function saSectionsFor(year: number): SASection[] {
  return SA_SECTIONS.map((s) => ({ ...s, questions: saQuestionsFor(s, year) })).filter((s) => s.questions.length > 0);
}

function isBlank(v: SAValue | undefined): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** ข้อบังคับที่ยังไม่ได้ตอบ — ใช้ทั้งแถบความคืบหน้าและปุ่มส่ง */
export function saMissing(answers: Record<string, SAValue>, year: number): SAQuestion[] {
  return saSectionsFor(year)
    .flatMap((s) => s.questions)
    .filter((q) => !q.optional && isBlank(answers[q.key]));
}

export function saProgress(answers: Record<string, SAValue>, year: number): { done: number; total: number } {
  const required = saSectionsFor(year).flatMap((s) => s.questions).filter((q) => !q.optional);
  return { done: required.length - saMissing(answers, year).length, total: required.length };
}

/** ข้อที่ยังไม่ตอบ ในหมวดนี้ — ใช้ติดจุดแดงข้างชื่อหมวด */
export function saSectionMissing(section: SASection, answers: Record<string, SAValue>, year: number): number {
  return saQuestionsFor(section, year).filter((q) => !q.optional && isBlank(answers[q.key])).length;
}

export const num = (v: SAValue | undefined): number | null =>
  typeof v === 'number' && v >= 0 ? v : null;

export const list = (v: SAValue | undefined): string[] => (Array.isArray(v) ? v : []);

export const text = (v: SAValue | undefined): string => (typeof v === 'string' ? v : '');
