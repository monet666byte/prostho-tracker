/**
 * Section III — Knowledge and skill assessments in specific prosthodontic procedures
 *
 * ถอดจากสมุดจริง "Clinical Performance Portfolio" ฉบับ Edited: 3 May 2024 (16 หน้า)
 *   Part A  ประเมินหัวข้อเฉพาะของ CD / RPD / FDP อย่างละ K1 K2 S1 S2 = 12 ใบ  (YEAR 5 & 6)
 *   Part B  ประเมินเคส recall  CD / RPD / FDP อย่างละ 1 ใบ = 3 ใบ            (YEAR 6)
 *
 * กฎให้คะแนนเหมือนกันทุกใบทุกข้อ — ตรวจแล้วจากทั้ง 15 ใบ:
 *   O (Outstanding)   = คะแนนเต็มของข้อนั้น (ตัวเลขในวงเล็บท้ายข้อความ)
 *   S (Satisfactory)  = ครึ่งหนึ่งของ O
 *   U (Unsatisfactory)= 0
 * และทุกใบรวมได้ 10 พอดี — assertTotals() ท้ายไฟล์กันถอดผิด
 *
 * ⚠️ ข้อความหัวข้อคัดมาตรงจากกระดาษ ห้ามแก้ไวยากรณ์หรือจัดถ้อยคำใหม่
 *    (บทเรียนตอนทำ SA report: ผมเผลอ "จัดให้สวย" แล้วต้องคืนทั้งหมด)
 */

/** ระดับที่อาจารย์กาในฟอร์ม */
export type S3Grade = 'O' | 'S' | 'U';

export interface S3Topic {
  key: string;
  /** ข้อความตามกระดาษเป๊ะ (ไม่รวมตัวเลขในวงเล็บ ซึ่งเก็บไว้ที่ max) */
  label: string;
  /** คะแนนเต็มของข้อ = ค่าของ O */
  max: number;
  /** หัวย่อยที่คร่อมข้อนี้เป็นข้อแรก เช่น "Final impression" */
  sub?: string;
}

export interface S3Form {
  key: string;
  /** รหัสมุมขวาบนของใบ เช่น CD-K1 */
  code: string;
  group: 'CD' | 'RPD' | 'FDP';
  part: 'A' | 'B';
  /** K = Knowledge assessment · S = Skill assessment · KS = ใบ recall ที่มีทั้งสองส่วน */
  kind: 'K' | 'S' | 'KS';
  /** ชื่อใบตามหัวกระดาษ */
  title: string;
  /** ใช้เฉพาะชั้นปีนี้ — Part B เขียน YEAR 6 ไว้ทั้ง 3 ใบ */
  yearOnly?: number;
  /** ข้อความ Assessment instruction / Remark ท้ายใบ */
  note?: string;
  topics: readonly S3Topic[];
}

/** คะแนนของแต่ละระดับ — O เต็ม · S ครึ่ง · U ศูนย์ */
export function s3Points(topic: S3Topic, grade: S3Grade | undefined): number | null {
  if (!grade) return null;
  return grade === 'O' ? topic.max : grade === 'S' ? topic.max / 2 : 0;
}

const KNOW = 'Knowledge assessment';
const SKILL = 'Skill assessment';

export const SECT3_FORMS: readonly S3Form[] = [
  /* ── Complete dentures (CD) ─────────────────────────────────────────── */
  {
    key: 'cdK1', code: 'CD-K1', group: 'CD', part: 'A', kind: 'K',
    title: 'Complete denture – Custom trays',
    topics: [
      { key: 'cdK1_1', max: 1.5, label: 'Types and selection of custom trays.' },
      { key: 'cdK1_2', max: 1, label: 'Rationale for master cast relieving and area to be relieved.' },
      { key: 'cdK1_3', max: 1, label: 'Maxillary anatomical landmarks related to custom trays fabrication.' },
      { key: 'cdK1_4', max: 1, label: 'Mandibular anatomical landmarks related to custom trays fabrication.' },
      { key: 'cdK1_5', max: 1.5, label: 'Border extension (outline) of maxillary/mandibular custom trays.' },
      { key: 'cdK1_6', max: 1, label: 'Locations to place custom tray stops, correct size and shape.' },
      { key: 'cdK1_7', max: 1, label: 'Characteristic of maxillary/mandibular custom tray handles.' },
      { key: 'cdK1_8', max: 1, label: 'Advantages of having finger stops on custom trays.' },
      { key: 'cdK1_9', max: 1, label: 'Inspection of custom trays prior to tray try-in.' },
    ],
  },
  {
    key: 'cdK2', code: 'CD-K2', group: 'CD', part: 'A', kind: 'K',
    title: 'Complete denture – Try-in record block, Determination of OVD and CR',
    topics: [
      { key: 'cdK2_1', max: 1, label: 'Try-in record block inspection and adjustment method.' },
      { key: 'cdK2_2', max: 1, label: 'Facial landmarks facilitating try-in record block.' },
      { key: 'cdK2_3', max: 1, label: 'Principles for occlusal plane determination.' },
      { key: 'cdK2_4', max: 1, label: 'Determination and role of the canine lines.' },
      { key: 'cdK2_5', max: 1, label: 'Determination of vertical jaw relation.' },
      { key: 'cdK2_6', max: 2, label: "Patient's position during contour try-in, determination of OVD and bite registration." },
      { key: 'cdK2_7', max: 1, label: 'Role of the phonetic analysis of “S sound” and “F sound”.' },
      { key: 'cdK2_8', max: 1, label: 'Methods of centric relation record with record blocks.' },
      { key: 'cdK2_9', max: 1, label: 'Types of articulators for complete dentures.' },
    ],
  },
  {
    key: 'cdS1', code: 'CD-S1', group: 'CD', part: 'A', kind: 'S',
    title: 'Complete denture – Border molding',
    topics: [
      { key: 'cdS1_1', max: 1, sub: 'Try-in custom tray', label: 'Stability of the custom tray.' },
      { key: 'cdS1_2', max: 1, label: 'Boundary (outline) at vestibular area of the custom tray.' },
      { key: 'cdS1_3', max: 1, label: 'Extension of the posterior border of the custom tray.' },
      { key: 'cdS1_4', max: 1, sub: 'Border molding', label: 'Oral tissue is not traumatized during border molding.' },
      { key: 'cdS1_5', max: 2, label: 'Proper border molding extension and shape at vestibular areas.' },
      { key: 'cdS1_6', max: 2, label: 'Extension and shape of compound at the posterior border.' },
      { key: 'cdS1_7', max: 1, label: 'The borders should be smooth and rounded.' },
      { key: 'cdS1_8', max: 1, label: 'Junction between compound and custom tray is thoroughly smooth.' },
    ],
  },
  {
    key: 'cdS2', code: 'CD-S2', group: 'CD', part: 'A', kind: 'S',
    title: 'Complete denture – Denture adjustment (Follow up)',
    note: 'This procedure needs to be assessed on the first follow-up visit.',
    topics: [
      { key: 'cdS2_1', max: 1, label: 'Examination of oral cavity.' },
      { key: 'cdS2_2', max: 1, label: 'Examination of prostheses.' },
      { key: 'cdS2_3', max: 2, label: 'Identifying chief complaints and problem synopsis.' },
      { key: 'cdS2_4', max: 2, label: 'Methods of correcting chief complaints.' },
      { key: 'cdS2_5', max: 2, label: 'Materials and instruments manipulations for correcting chief complaints.' },
      { key: 'cdS2_6', max: 1, label: "Additional instruction relating to the patient's complaints." },
      { key: 'cdS2_7', max: 1, label: "Evaluation of patient's denture hygiene, home care instructions." },
    ],
  },

  /* ── Removable partial dentures (RPD) ───────────────────────────────── */
  {
    key: 'rpdK1', code: 'RPD-K1', group: 'RPD', part: 'A', kind: 'K',
    title: 'Removable partial denture – RPD framework fabrication',
    topics: [
      { key: 'rpdK1_1', max: 1, sub: 'Laboratory technique for framework fabrication', label: 'Properties of gypsum selected for RPD master cast fabrication.' },
      { key: 'rpdK1_2', max: 1, label: 'Characteristics of master cast.' },
      { key: 'rpdK1_3', max: 2, label: 'Block out and relief on master cast: rationale, locations, materials, methods.' },
      { key: 'rpdK1_4', max: 1, label: 'Refractory cast fabrication.' },
      { key: 'rpdK1_5', max: 2, label: 'RPD wax pattern fabrication.' },
      { key: 'rpdK1_6', max: 3, sub: 'Inspection of finished wax pattern from the lab', label: 'Finished wax pattern characteristics.' },
    ],
  },
  {
    key: 'rpdK2', code: 'RPD-K2', group: 'RPD', part: 'A', kind: 'K',
    title: 'Removable partial denture – Altered cast impression technique',
    topics: [
      { key: 'rpdK2_1', max: 2, label: 'Rationale to perform an altered cast impression technique.' },
      { key: 'rpdK2_2', max: 3, label: 'Clinical steps and techniques to make an altered cast impression.' },
      { key: 'rpdK2_3', max: 2, label: 'Characteristics of custom tray for altered cast impression.' },
      { key: 'rpdK2_4', max: 1, label: 'Selection of impression materials.' },
      { key: 'rpdK2_5', max: 1, label: 'Examination of the impression.' },
      { key: 'rpdK2_6', max: 1, label: 'Examination of the intraoral adaptation of RPD framework with the impression.' },
    ],
  },
  {
    key: 'rpdS1', code: 'RPD-S1', group: 'RPD', part: 'A', kind: 'S',
    title: 'Removable partial denture – Surveying and drawing RPD design on study model',
    topics: [
      { key: 'rpdS1_1', max: 1, label: 'Methods of path of insertion determining and recording.' },
      { key: 'rpdS1_2', max: 1, label: 'Abutment undercut determination.' },
      { key: 'rpdS1_3', max: 2, label: 'Definite survey lines and providing all information for RPD designing.' },
      { key: 'rpdS1_4', max: 2, label: 'Planned direct retainers and/or indirect retainers on the study cast reveal correct character, shape, and location.' },
      { key: 'rpdS1_5', max: 2, label: 'Planned minor and major connectors on the study cast reveal correct character, shape, and location.' },
      { key: 'rpdS1_6', max: 1, label: 'All the components are joined correctly.' },
      { key: 'rpdS1_7', max: 1, label: 'Surveyed study cast is clean.' },
    ],
  },
  {
    key: 'rpdS2', code: 'RPD-S2', group: 'RPD', part: 'A', kind: 'S',
    title: 'Removable partial denture – Denture delivery',
    topics: [
      { key: 'rpdS2_1', max: 1, label: 'Inspection of denture prior to delivery.' },
      { key: 'rpdS2_2', max: 2, label: 'Clinical procedures and sequences of RPD delivery.' },
      { key: 'rpdS2_3', max: 1, label: 'Method of RPD insertion and removal.' },
      { key: 'rpdS2_4', max: 1, label: 'Materials and instruments manipulations for RPD delivery.' },
      { key: 'rpdS2_5', max: 1, label: 'Inspection of tissue support, adaptation of denture; materials used; and adjustment.' },
      { key: 'rpdS2_6', max: 1, label: 'Inspection of denture retention and stability.' },
      { key: 'rpdS2_7', max: 1, label: 'Methods for examining of occlusal scheme, occlusal interferences and adjustment.' },
      { key: 'rpdS2_8', max: 1, label: 'Esthetic evaluation.' },
      { key: 'rpdS2_9', max: 1, label: 'Post-insertion instructions and home care instructions.' },
    ],
  },

  /* ── Fixed prosthesis (FDP) ─────────────────────────────────────────── */
  {
    key: 'fdpK1', code: 'FDP-K1', group: 'FDP', part: 'A', kind: 'K',
    title: 'Fixed prosthesis – Final impression and working model fabrication',
    topics: [
      { key: 'fdpK1_1', max: 2, sub: 'Final impression', label: 'Impression techniques and rationale.' },
      { key: 'fdpK1_2', max: 2, label: 'Material selection, rationale, and manipulation.' },
      { key: 'fdpK1_3', max: 2, label: 'Clinical procedures for final impression.' },
      { key: 'fdpK1_4', max: 1, label: 'Optimal characteristics of impression.' },
      { key: 'fdpK1_5', max: 1, label: 'Sterilization methods.' },
      { key: 'fdpK1_6', max: 1, sub: 'Working model fabrication', label: 'Boxing impression procedure and rationale.' },
      { key: 'fdpK1_7', max: 1, label: 'Working model dimension and characteristics.' },
    ],
  },
  {
    key: 'fdpK2', code: 'FDP-K2', group: 'FDP', part: 'A', kind: 'K',
    title: 'Fixed prosthesis – Permanent cementation',
    topics: [
      { key: 'fdpK2_1', max: 2, label: 'Types of cement and selection rationale.' },
      { key: 'fdpK2_2', max: 1, label: 'Abutment preparation prior to cementation.' },
      { key: 'fdpK2_3', max: 2, label: 'Preparation of the restoration prior to cementation.' },
      { key: 'fdpK2_4', max: 2, label: 'Cementation procedure.' },
      { key: 'fdpK2_5', max: 1, label: 'Removal of excess cement after cementation.' },
      { key: 'fdpK2_6', max: 1, label: 'Post-insertion instructions and prosthesis care.' },
      { key: 'fdpK2_7', max: 1, label: 'Follow-up appointment period after cementation.' },
    ],
  },
  {
    key: 'fdpS1', code: 'FDP-S1', group: 'FDP', part: 'A', kind: 'S',
    title: 'Fixed prosthesis – Provisional restoration',
    topics: [
      { key: 'fdpS1_1', max: 3, label: 'Proper shape and characteristics of provisional restoration (margin, proximal contact, contour).' },
      { key: 'fdpS1_2', max: 2, label: 'Provisional restoration has proper occlusion in both centric and eccentric relations.' },
      { key: 'fdpS1_3', max: 1, label: 'Finishing and polishing burs for provisional restoration.' },
      { key: 'fdpS1_4', max: 1, label: 'Selection of temporary cement.' },
      { key: 'fdpS1_5', max: 2, label: 'Marginal adaptation and occlusion after cementation.' },
      { key: 'fdpS1_6', max: 1, label: 'Proper removal of excess cement, no remaining excess.' },
    ],
  },
  {
    key: 'fdpS2', code: 'FDP-S2', group: 'FDP', part: 'A', kind: 'S',
    title: 'Fixed prosthesis – Crown/bridge try-in',
    topics: [
      { key: 'fdpS2_1', max: 1, label: 'Provisional restoration and cement removal methods.' },
      { key: 'fdpS2_2', max: 1, label: 'Proximal contact characteristics and adjustment.' },
      { key: 'fdpS2_3', max: 1, label: 'Evaluation of marginal adaptation.' },
      { key: 'fdpS2_4', max: 1, label: 'Examining prosthesis retention and stability.' },
      { key: 'fdpS2_5', max: 1, label: 'Occlusion adjustment.' },
      { key: 'fdpS2_6', max: 1, label: 'Proper prosthesis contour, colors, and esthetic.' },
      { key: 'fdpS2_7', max: 1, label: 'Adequate prosthesis thickness.' },
      { key: 'fdpS2_8', max: 1, label: 'Materials and instruments manipulations for crown and bridge try-in.' },
      { key: 'fdpS2_9', max: 2, label: 'Finishing and polishing of crown and bridge.' },
    ],
  },

  /* ── Part B · Recall case examination (YEAR 6) ──────────────────────── */
  {
    key: 'recallCd', code: 'Recall-CD', group: 'CD', part: 'B', kind: 'KS', yearOnly: 6,
    title: 'Recall Case Examination Assessment Form: Complete denture case',
    note: 'Recall case requirements are one removable prosthesis case (CD or RPD) and one fixed prosthesis case. Those removable and fixed works must not be in the same patient.',
    topics: [
      { key: 'recallCd_1', max: 4, sub: KNOW, label: 'Procedures and instrumentation to evaluate retention and stability, vertical dimension, occlusion, esthetics, and phonetics.' },
      { key: 'recallCd_2', max: 1, label: 'Procedures and instrumentation to evaluate oral mucosa and soft tissues.' },
      { key: 'recallCd_3', max: 0.5, sub: SKILL, label: 'Information gathering of chief complaints, History and present conditions of chief complaints.' },
      { key: 'recallCd_4', max: 0.5, label: 'Information gathering of history and present conditions of prosthesis and oral tissues.' },
      { key: 'recallCd_5', max: 2, label: 'Patient examination and investigation performances.' },
      { key: 'recallCd_6', max: 1, label: 'Provided adequate clinical treatments for chief complaints and/or as for recall visit.' },
      { key: 'recallCd_7', max: 1, label: 'Completeness of chart recording, and/or referral.' },
    ],
  },
  {
    key: 'recallRpd', code: 'Recall-RPD', group: 'RPD', part: 'B', kind: 'KS', yearOnly: 6,
    title: 'Recall Case Examination Assessment Form: Removable partial denture case',
    note: 'Recall case requirements are one removable prosthesis case (CD or RPD) and one fixed prosthesis case. Those removable and fixed works must not be in the same patient.',
    topics: [
      { key: 'recallRpd_1', max: 3, sub: KNOW, label: 'Procedures and instrumentation to evaluate retention and stability, framework/denture base, occlusion, and/or esthetics.' },
      { key: 'recallRpd_2', max: 1, label: 'Procedures and instrumentation to evaluate abutment conditions.' },
      { key: 'recallRpd_3', max: 1, label: 'Procedures and instrumentation to evaluate oral mucosa and soft tissues.' },
      { key: 'recallRpd_4', max: 0.5, sub: SKILL, label: 'Information gathering of chief complaints, History and present conditions of chief complaints.' },
      { key: 'recallRpd_5', max: 0.5, label: 'Information gathering of history and present conditions of prosthesis and oral tissues.' },
      { key: 'recallRpd_6', max: 2, label: 'Patient examination and investigation performances.' },
      { key: 'recallRpd_7', max: 1, label: 'Provided adequate clinical treatments for chief complaints and/or as for recall visit.' },
      { key: 'recallRpd_8', max: 1, label: 'Completeness of chart recording, and/or referral.' },
    ],
  },
  {
    key: 'recallFdp', code: 'Recall-FDP', group: 'FDP', part: 'B', kind: 'KS', yearOnly: 6,
    title: 'Recall Case Examination Assessment Form: Fixed prosthesis case',
    note: 'Recall case requirements are one removable prosthesis case (CD or RPD) and one fixed prosthesis case. Those removable and fixed works must not be in the same patient.',
    topics: [
      { key: 'recallFdp_1', max: 3, sub: KNOW, label: 'Procedures and instrumentation to evaluate contacts, occlusion, contours, and esthetics.' },
      { key: 'recallFdp_2', max: 1, label: 'Procedures and instrumentation to evaluate abutment periodontal tissues.' },
      { key: 'recallFdp_3', max: 1, sub: SKILL, label: 'Information gathering of chief complaints, History and present conditions of chief complaints.' },
      { key: 'recallFdp_4', max: 1, label: 'Information gathering of history and present conditions of prosthesis and oral tissues.' },
      { key: 'recallFdp_5', max: 2, label: 'Patient examination and investigation performances.' },
      { key: 'recallFdp_6', max: 1, label: 'Provided adequate clinical treatments for chief complaints and/or as for recall visit.' },
      { key: 'recallFdp_7', max: 1, label: 'Completeness of chart recording, and/or referral.' },
    ],
  },
] as const;

/** คะแนนเต็มของทุกใบในเล่ม = 10 */
export const S3_FULL_SCORE = 10;

export const sect3Form = (key: string): S3Form | undefined => SECT3_FORMS.find((f) => f.key === key);

/** ใบที่ชั้นปีนี้ต้องทำ — Part B เป็นของปี 6 เท่านั้น */
export const sect3FormsFor = (classYear: number): S3Form[] =>
  SECT3_FORMS.filter((f) => !f.yearOnly || f.yearOnly === classYear);

/** รวมคะแนนของใบหนึ่ง จากระดับที่กาไว้ · null = ยังให้คะแนนไม่ครบ */
export function sect3Total(form: S3Form, grades: Record<string, S3Grade | undefined>): number | null {
  let sum = 0;
  for (const t of form.topics) {
    const p = s3Points(t, grades[t.key]);
    if (p === null) return null;
    sum += p;
  }
  return sum;
}

/**
 * ยามกันถอดฟอร์มผิด — ทุกใบต้องรวมได้ 10 พอดี และคีย์ห้ามซ้ำ
 * เรียกตอนเปิดแอปในโหมด dev ถ้าพังคือผมพิมพ์ตัวเลขผิด ไม่ใช่ผู้ใช้ทำอะไรผิด
 */
export function assertSect3(): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const f of SECT3_FORMS) {
    const total = f.topics.reduce((s, t) => s + t.max, 0);
    if (Math.abs(total - S3_FULL_SCORE) > 1e-9) errs.push(`${f.code} รวมได้ ${total} ไม่ใช่ ${S3_FULL_SCORE}`);
    if (seen.has(f.key)) errs.push(`ใบซ้ำ ${f.key}`);
    seen.add(f.key);
    for (const t of f.topics) {
      if (seen.has(t.key)) errs.push(`คีย์ข้อซ้ำ ${t.key}`);
      seen.add(t.key);
      if (t.max <= 0) errs.push(`${t.key} คะแนนเต็มต้องมากกว่า 0`);
    }
  }
  return errs;
}
