/**
 * Section II — Patient examination and treatment planning assessments (YEAR 5)
 *
 * ถอดจากสมุดจริง "Clinical Performance Portfolio" ฉบับ Edited: 3 May 2024 (5 หน้า)
 *   ① Assessment form for Removable prosthesis case  (2 หน้า · 6 หัวข้อ · เต็ม 70)
 *   ② Assessment form for Fixed prosthesis case      (2 หน้า · 6 หัวข้อ · เต็ม 70)
 *   ③ RPD Design examination form                    (1 หน้า · 17 หัวข้อ · ผ่าน/ไม่ผ่าน)
 *
 * ต่างจาก Section III ตรงที่มี 4 ระดับ ไม่ใช่ 3 และแต่ละช่องมีคำบรรยายยาว
 * กฎคะแนนที่ตรวจแล้วจากทั้งสองใบ:
 *   Outstanding    = เต็ม
 *   Satisfactory   = 80% ของเต็ม
 *   Marginal       = 60% ของเต็ม
 *   Unsatisfactory = 0
 * (ข้อเต็ม 10 → 10/8/6/0 · ข้อเต็ม 20 → 20/16/12/0) และทั้งใบรวมได้ 70 พอดี
 *
 * ⚠️ คำบรรยายคัดตรงจากกระดาษ ห้ามแก้ไวยากรณ์ ต่อให้อ่านแล้วสะดุด
 */

export type S2Grade = 'O' | 'S' | 'M' | 'U';

export const S2_GRADES: ReadonlyArray<{ v: S2Grade; label: string; ratio: number }> = [
  { v: 'O', label: 'Outstanding', ratio: 1 },
  { v: 'S', label: 'Satisfactory', ratio: 0.8 },
  { v: 'M', label: 'Marginal', ratio: 0.6 },
  { v: 'U', label: 'Unsatisfactory', ratio: 0 },
];

export interface S2Criterion {
  key: string;
  /** ชื่อหัวข้อบนแถบเทา */
  title: string;
  /** บรรทัดอธิบายใต้ชื่อหัวข้อ (ถ้ามี) */
  detail?: string;
  max: number;
  /** คำบรรยายของแต่ละระดับ เรียงตาม S2_GRADES */
  rubric: Readonly<Record<S2Grade, string>>;
}

export interface S2Form {
  key: 'removable' | 'fixed';
  title: string;
  /** ธงเดิมในโปรไฟล์ นศ. ที่ใบนี้ควรไปติ๊กให้อัตโนมัติเมื่อประเมินครบ */
  gate: 'sect2Removable' | 'sect2Fixed';
  criteria: readonly S2Criterion[];
}

export const S2_FULL_SCORE = 70;

export function s2Points(c: S2Criterion, g: S2Grade | undefined): number | null {
  if (!g) return null;
  const found = S2_GRADES.find((x) => x.v === g);
  return found ? c.max * found.ratio : null;
}

/* หัวข้อ 1 2 3 5 6 ใช้คำเดียวกันทั้งใบ Removable และ Fixed — ต่างกันแค่หัวข้อ 4
   แยกออกมาเป็นค่าคงที่ จะได้ไม่มีโอกาสพิมพ์สองที่แล้วไม่ตรงกัน */
const SHARED: readonly S2Criterion[] = [
  {
    key: 'exam', max: 10,
    title: 'Patient examination and chart recording',
    detail: 'History taking, Dental and periodontal examination, Existing prostheses examination, Prosthodontic related examination, Other investigations, Dental and tissue diagnoses, etc.',
    rubric: {
      O: 'Independently obtains data accurately. AND Establishes diagnosis based on collected data and interprets findings accurately. AND Records the patient chart thoroughly and correctly.',
      S: 'Independently obtains data. BUT Requires assistance to correctly establish diagnosis and interpret findings. AND Records the patient chart thoroughly and correctly.',
      M: 'Requires assistance to obtain data. AND Requires assistance to correctly interpret findings and establish diagnosis. AND Requires assistance with the patient chart record.',
      U: 'Requires assistance to obtain data. BUT. Is unable to interpret the findings and establish the diagnosis correctly. AND Requires assistance with the patient chart record.',
    },
  },
  {
    key: 'reasoning', max: 10,
    title: 'Information processing from examination and clinical reasoning in treatment planning',
    rubric: {
      O: 'Independently presents treatment plan. AND Treatment plan presentation is complete and includes: 1. A concise but thorough summary of findings and interpretations. 2. Demonstration of an understanding of treatment plan. 3. Recognition of the impact findings may have on dental care. 4. An understanding of the use and impact identified medications have on dental care. 5. An understanding of the impact identified risk factors have on dental care.',
      S: 'Presents treatment plan with faculty prompting. AND One or two errors occur during treatment plan presentation. AND Is able to accurately answer pertinent follow-up questions presented by faculty. AND Critical medical history topics are understood.',
      M: 'Three or more errors occur during treatment plan presentation. OR Requires faculty prompting to answer pertinent follow-up questions. AND Critical medical history topics are understood.',
      U: 'Is unable to summarize gathered information and provide acceptable treatment plan. OR Is unable to answer pertinent follow-up questions. OR Critical medical history topics are not understood.',
    },
  },
  {
    key: 'sequence', max: 10,
    title: 'Sequential comprehensive treatment planning',
    detail: 'Comprehensive treatment plan, Alternative treatment plan, Phase and sequence of treatment, Estimated treatment duration, Estimated treatment fee',
    rubric: {
      O: 'Complete and correct sequential treatment plan.',
      S: '1-2 errors in sequential treatment plan.',
      M: '3-4 errors in sequential treatment plan.',
      U: '5 or more errors in sequential treatment plan.',
    },
  },
];

const DESIGN: S2Criterion = {
  key: 'design', max: 10,
  title: 'Design for prostheses',
  detail: "(as presented before any instructor's suggestion)",
  rubric: {
    O: 'Presents appropriate prostheses design.',
    S: 'Presents appropriate prostheses design with 1-2 errors.',
    M: 'Presents appropriate prostheses design with ≥ 3 errors.',
    U: 'Unable to presents or presents with critical error in prostheses design.',
  },
};

const COMMUNICATION: S2Criterion = {
  key: 'communication', max: 10,
  title: 'Communication skill and discussion',
  rubric: {
    O: 'Persuasively articulate argument displaying clear focus and academic rigour to an instructor. AND Communication with clarity and being a well listener. AND Is able to provides appropriate discussion.',
    S: 'Persuasively articulate argument displaying clear focus and academic rigour to an instructor. AND Communication with clarity and being a well listener. BUT Is unable to provide appropriate discussion.',
    M: 'Is unable to articulate argument displaying clear focus and academic rigour related to the case. AND Limited communication with vagueness and not being a well listener.',
    U: 'Is unable to present findings and treatment plan to an instructor. AND Is unable to provide discussion.',
  },
};

export const SECT2_FORMS: readonly S2Form[] = [
  {
    key: 'removable', gate: 'sect2Removable',
    title: 'Assessment form for Removable prosthesis case examination and treatment planning',
    criteria: [
      ...SHARED,
      {
        key: 'knowledge', max: 20,
        title: 'Knowledge and clinical reasoning for prostheses design',
        detail: 'Please refer to respective work design document. For RPD case, please also refer to the RPD design examination form.',
        rubric: {
          O: 'Demonstrates well knowledge and provides appropriate reasoning for prostheses design.',
          S: 'Demonstrates well knowledge with some inappropriate reasoning for prostheses design.',
          M: 'Demonstrates average knowledge but cannot provide reasoning for prostheses design.',
          U: 'Lacks of knowledge for prostheses design.',
        },
      },
      DESIGN,
      COMMUNICATION,
    ],
  },
  {
    key: 'fixed', gate: 'sect2Fixed',
    title: 'Assessment form for Fixed prosthesis case examination and treatment planning',
    criteria: [
      ...SHARED,
      {
        key: 'knowledge', max: 20,
        title: 'Knowledge and clinical reasoning for prostheses design',
        detail: 'Please refer to respective work design document.',
        rubric: {
          O: 'Demonstrates well knowledge for FPD design principles, materials and biomechanics. AND produces FPD designs that meet all clinical criteria with optimal aesthetics, function, and longevity.',
          S: 'Demonstrates well knowledge for FPD design principles, materials and biomechanics. BUT produces FPD designs that meet most clinical requirements with minor deficiencies.',
          M: 'Demonstrates average knowledge for FPD design principles, materials and biomechanics AND produces FPD designs that meet some clinical requirements.',
          U: 'Lacks of knowledge for prostheses design, FPD design principles, materials and biomechanics OR cannot produce the design that meet basic requirements.',
        },
      },
      DESIGN,
      COMMUNICATION,
    ],
  },
] as const;

/* ── ใบที่ 3 · RPD Design examination form (ผ่าน/ไม่ผ่าน) ─────────────────── */

export interface RpdDesignTopic { key: string; no: string; label: string }
export interface RpdDesignGroup { no: string; title: string; topics: readonly RpdDesignTopic[] }

export const RPD_DESIGN_GROUPS: readonly RpdDesignGroup[] = [
  {
    no: '1', title: 'Analysis/evaluation of abutments and related tissues from clinical and radiographic examination',
    topics: [
      { key: 'rd11', no: '1.1', label: 'Abutment condition (Crown : root ratio, tooth mobility, existing restoration, pocket depth)' },
      { key: 'rd12', no: '1.2', label: 'Occlusion' },
      { key: 'rd13', no: '1.3', label: 'Interarch space' },
      { key: 'rd14', no: '1.4', label: 'Supporting structure' },
      { key: 'rd15', no: '1.5', label: 'Surrounding structure' },
    ],
  },
  {
    no: '2', title: 'Treatment planning for removable partial dentures',
    topics: [
      { key: 'rd21', no: '2.1', label: 'Preparatory phase' },
      { key: 'rd22', no: '2.2', label: 'Corrective phase' },
      { key: 'rd23', no: '2.3', label: 'Maintenance phase' },
    ],
  },
  {
    no: '3', title: 'Surveying of study model',
    topics: [
      { key: 'rd31', no: '3.1', label: 'Path of insertion' },
      { key: 'rd32', no: '3.2', label: 'Survey line' },
      { key: 'rd33', no: '3.3', label: 'Undercut area' },
    ],
  },
  {
    no: '4', title: 'Removable partial denture design',
    topics: [
      { key: 'rd41', no: '4.1', label: 'Outline saddle' },
      { key: 'rd42', no: '4.2', label: "Kennedy's classification" },
      { key: 'rd43', no: '4.3', label: 'Plan the support' },
      { key: 'rd44', no: '4.4', label: 'Plan retention and reciprocation' },
      { key: 'rd45', no: '4.5', label: 'Biomechanics and movement analysis' },
      { key: 'rd46', no: '4.6', label: 'Major and minor connector' },
    ],
  },
];

export const RPD_DESIGN_TOPICS = RPD_DESIGN_GROUPS.flatMap((g) => g.topics);

export const RPD_DESIGN_REMARK =
  'This assessment aligns with the CDA competency assessment. The student needs to pass all topics to be considered as “PASS”.';

/** ผ่านทั้งใบ = ผ่านทุกข้อ (ตามหมายเหตุท้ายใบ) */
export function rpdDesignPassed(marks: Record<string, boolean | undefined>): boolean {
  return RPD_DESIGN_TOPICS.every((t) => marks[t.key] === true);
}

export const sect2Form = (key: string): S2Form | undefined => SECT2_FORMS.find((f) => f.key === key);

export function sect2Total(form: S2Form, grades: Record<string, S2Grade | undefined>): number | null {
  let sum = 0;
  for (const c of form.criteria) {
    const p = s2Points(c, grades[c.key]);
    if (p === null) return null;
    sum += p;
  }
  return sum;
}

/** ยามกันถอดผิด — ทั้งสองใบต้องรวมได้ 70 · คีย์ห้ามซ้ำ · RPD design ต้องมี 17 ข้อ */
export function assertSect2(): string[] {
  const errs: string[] = [];
  for (const f of SECT2_FORMS) {
    const total = f.criteria.reduce((s, c) => s + c.max, 0);
    if (total !== S2_FULL_SCORE) errs.push(`${f.key} รวมได้ ${total} ไม่ใช่ ${S2_FULL_SCORE}`);
    const keys = new Set<string>();
    for (const c of f.criteria) {
      if (keys.has(c.key)) errs.push(`${f.key} คีย์หัวข้อซ้ำ ${c.key}`);
      keys.add(c.key);
      for (const g of S2_GRADES) if (!c.rubric[g.v]?.trim()) errs.push(`${f.key}/${c.key} ขาดคำบรรยายระดับ ${g.v}`);
    }
    if (f.criteria.length !== 6) errs.push(`${f.key} มี ${f.criteria.length} หัวข้อ ไม่ใช่ 6`);
  }
  if (RPD_DESIGN_TOPICS.length !== 17) errs.push(`RPD design มี ${RPD_DESIGN_TOPICS.length} ข้อ ไม่ใช่ 17`);
  const rk = new Set<string>();
  for (const t of RPD_DESIGN_TOPICS) {
    if (rk.has(t.key)) errs.push(`RPD design คีย์ซ้ำ ${t.key}`);
    rk.add(t.key);
  }
  return errs;
}
