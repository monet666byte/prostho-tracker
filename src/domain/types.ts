/**
 * Domain model — สะท้อนชีตจริง DTPT502-2026: Prosthodontic Clinic Progress
 * (tabs: INTRO, Work step, PT1–PT12, Progress checked, Case CD)
 */

export type WorkType = 'CD' | 'RPD' | 'APD' | 'PC' | 'CB' | 'RRM' | 'RFX';
export type PostVariant = 'cast' | 'prefab';
export type Arch = 'upper' | 'lower';
export type KennedyClass =
  | 'Kennedy class I'
  | 'Kennedy class II'
  | 'Kennedy class III'
  | 'Kennedy class IV';
export type Payment = 'ยังไม่ชำระ' | 'ชำระแล้ว' | 'ยกเว้น';

/**
 * ชนิดชิ้นงานถอดได้ตามชีตจริง (tab "Case CD" ช่อง ชนิดชิ้นงาน UPPER/LOWER denture)
 * แกนคือ (CD | APD | RPD) × (Simple | Complicated) โดย Simple/Complicated ดูจากจำนวนฟันที่เหลือ
 */
export type DentureClass = 'CD' | 'complicated-APD' | 'complicated-RPD' | 'simple-APD' | 'simple-RPD';
export type Role = 'student' | 'teacher';

export interface Teacher {
  id: string;
  name: string;
  title?: string;
}

/**
 * ข้อกำหนดก่อนจบที่ "ไม่ใช่ชิ้นงาน" — ชีตเก็บเป็นคอลัมน์รายคน (Sect II. Pt. exam & tx. plan
 * Removable/Fixed และ Design RPD) กรอกแล้ว 86/88 คนในชีตรุ่น 54 แต่แอปไม่เคยอ่าน (3 ก.ย.)
 * undefined = ยังไม่มีข้อมูล · อาจารย์ที่ปรึกษาติ๊กในแอปได้ · นักศึกษาเห็นอย่างเดียว
 */
export interface StudentGates {
  sect2Removable?: boolean;
  sect2Fixed?: boolean;
  designRpd?: boolean;
}
export type GateKey = keyof StudentGates;

export interface Student {
  id: string;
  code: string; // เช่น 6504008
  name: string;
  group: string; // TH-PT1 … TH-PT12 — ที่สังกัด "ปัจจุบัน" ย้ายได้อิสระเวลาขึ้นปี
  /**
   * ⚠️ ชั้นปีที่บันทึกไว้ตอนสร้าง — อย่าอ่านตรงๆ ใช้ studentYear() แทน
   * ค่านี้ไม่เลื่อนตามเวลา จึงผิดทันทีที่ข้ามปีการศึกษา (คงไว้เพื่อความเข้ากันได้กับข้อมูลเก่า)
   */
  year: number;
  /**
   * ปีการศึกษา (พ.ศ.) ที่ขึ้นคลินิกปีแรก = "รุ่น" — แหล่งความจริงของชั้นปี
   * ชั้นปีคำนวณจากค่านี้เทียบปีการศึกษาปัจจุบัน จึงเลื่อนเองทุก 1 มิ.ย. โดยไม่ต้องแก้ข้อมูล
   * (อาจารย์ขอ 1 ก.ย. 69: ปี 5/2569 → ปี 6/2570 พร้อมรับรุ่นใหม่เข้ามาปี 5 ในปีเดียวกัน)
   * ผูกกับตัวนักศึกษา ไม่ผูกกับกลุ่ม — ภาคจะย้ายกลุ่มตอนขึ้นปีหรือไม่ก็ได้
   */
  entryYear?: number;
  advisorIds: [string, string];
  /** ดู StudentGates — เกณฑ์จบข้อที่ไม่ใช่จำนวนชิ้นงาน */
  gates?: StudentGates;
}

export interface ClinicGroup {
  code: string; // TH-PT7
  advisorIds: [string, string];
  studentIds: string[];
}

export interface Patient {
  id: string;
  name: string;
  hn: string;
  sexAge: string;
  note?: string; // สถานะผู้ป่วย เช่น "รอ pre-prosth", "Refer PG ENDO"
  ownerStudentId: string;
}

export interface Workpiece {
  id: string;
  patientId: string;
  studentId: string;
  type: WorkType;
  variant?: PostVariant; // เฉพาะ type PC
  arch?: Arch; // เฉพาะงานถอดได้
  pairId?: string; // upper/lower ที่รับเคสพร้อมกัน — progress แยกกัน
  tooth?: string; // เฉพาะ PC / CB / RFX
  kennedy?: KennedyClass; // เฉพาะ RPD
  dentureClass?: DentureClass; // เฉพาะงานถอดได้ — ใช้ทำป้ายและนับ Count CDA
  detail: string; // ป้ายที่แสดง เช่น "CD/- (Upper ไม่เหลือฟันแม้แต่ซี่เดียว)"
  acceptedDate: string; // ISO date
  minimumRequirement: boolean;
  /** อาจารย์ยังไม่ได้ตรวจรับว่าเข้าเกณฑ์ (ในชีตเขียนว่า "ยังไม่เข้าเกณฑ์ CD รอตรวจ") — ยังไม่นับเข้าเกณฑ์ */
  pendingQualification?: boolean;
  payment: Payment;
  // Sect II · Pt. exam & tx. plan — ชีตแยกเป็น 2 คอลัมน์ Yes/No
  sect2Removable: boolean;
  sect2Fixed: boolean;
  designRpd?: string;
  procIndex: number; // index ของ procedure ล่าสุดที่ผ่าน (-1 = ยังไม่เริ่ม)
  lastUpdatedAt: string; // ISO datetime
  completedAt?: string; // ISO datetime ที่ผ่าน Completion of case — ใช้นับเกณฑ์รายปี
  /** ปีการศึกษา (พ.ศ.) ที่ชิ้นนี้นับเข้าเกณฑ์ — ชีตระบุด้วยคอลัมน์ "for PT502 / for PT602"
   *  (PT502 = ปี 5 · PT602 = ปี 6) ถ้าไม่ระบุ ใช้ปีที่จบเคสตามปกติ */
  countsForYear?: number;
  /** มาจากการนำเข้าชีต — ไม่รู้วันที่จบจริง (ชีตไม่มีคอลัมน์นั้น) จึงนับเป็น "ยอดยกมา" ในกราฟสะสม */
  fromSheet?: boolean;
  /** คืนเคส/ยกเลิกไปแล้ว (อ่านจากคอลัมน์หมายเหตุของชีต) — เก็บแถวไว้ให้เห็น แต่ไม่นับเป็นงานที่ทำอยู่ */
  returned?: boolean;
  /** ข้อความคืนเคสตามที่เขียนในชีต เช่น "คืนเคสเพราะคนไข้ไม่สะดวกทำ preprosth" */
  returnNote?: string;
  catalogVersion: string; // ชีตแก้รายปี — เก็บว่าอ้างอิง catalog เวอร์ชันไหน
}

export interface ProgressUpdate {
  id: string;
  workpieceId: string;
  procIndex: number;
  progression: number;
  performedAt: string; // นักศึกษาเลือกวันที่ได้
  selfPerformed: boolean;
  photoIds: string[];
  note?: string;
  reversal?: boolean; // "เลิกทำ" = บันทึก reversal ไม่ลบประวัติ
  createdBy: string;
  createdAt: string;
  syncedAt: string | null;
}

export type PhotoStatus = 'ok' | 'queue' | 'fail';

export interface Photo {
  id: string;
  workpieceId: string;
  progression: number;
  stepLabel: string;
  dataUrl?: string;
  sizeLabel: string;
  status: PhotoStatus;
  createdAt: string;
}

export type RoundKind = 'progress' | 'check-case-cd' | 'final';

export interface ReportRound {
  id: string;
  name: string;
  dueDate: string; // ISO
  kind: RoundKind;
}

export type SubmissionStatus = 'none' | 'sent' | 'approved' | 'late' | 'issue';

export interface ReportSubmission {
  id: string;
  studentId: string;
  roundId: string;
  status: SubmissionStatus;
  approvedBy?: string;
  comment?: string;
}

export type CheckInStatus = 'pending' | 'evaluated';

/** หนึ่งคาบคลินิก — แทนหนึ่งแถวในสมุด Clinical rotation logbook */
export interface CheckIn {
  id: string;
  studentId: string;
  date: string; // ISO date ของคาบ
  punctual: boolean;
  /** เวลาที่กดเช็คอินจริง (HH:mm) — ระบบจับเอง แก้ไม่ได้ ไว้คำนวณตรงเวลา/สาย */
  checkinAt?: string;
  /** จำนวนรูปงานที่แนบมากับคาบ (เดโม — ยังไม่เก็บไฟล์จริง) */
  photoCount?: number;
  noPatient: boolean;
  patientId?: string;
  activities: string[];
  note?: string;
  status: CheckInStatus;
  /** คะแนน 0–3 ต่อหัวข้อ (คีย์ตาม CRITERIA) — มีเมื่ออาจารย์ประเมินแล้ว */
  scores?: Record<string, number>;
  evaluatedBy?: string;
  evaluatedAt?: string;
  /** ครั้งล่าสุดที่นักศึกษาแก้กิจกรรม/คนไข้/โน้ตหลังเช็คอิน (ISO) — โชว์ป้ายให้อาจารย์เห็นว่าคาบนี้มีการแก้ */
  editedAt?: string;
  createdAt: string;
}

/** คอลัมน์ "Report issues" ของ tab Progress checked — ต่อนักศึกษา 1 ช่อง */
export interface ReportIssue {
  studentId: string;
  text: string;
}

export type ReviewStatus = 'pending' | 'approved' | 'returned';

export interface Review {
  id: string;
  workpieceId: string;
  status: ReviewStatus;
  comment?: string;
  by?: string;
  at?: string;
}

export interface QueueItem {
  id: string;
  workpieceId: string;
  label: string;
  createdAt: string;
  hasPhoto: boolean;
  kind: 'progress' | 'reversal' | 'create';
}

export interface AuditEntry {
  id: string;
  text: string;
  who: string;
  at: string; // ISO datetime
  /** เรื่องนี้เกี่ยวกับนักศึกษาคนไหน — ใช้จำกัดว่าอาจารย์กลุ่มไหนเห็นได้ */
  studentId?: string;
  /** หรือเกี่ยวกับกลุ่มไหน (กรณีไม่ผูกกับ นศ. คนใดคนหนึ่ง เช่น การเปิดดูข้อมูลกลุ่ม) */
  groupCode?: string;
  /** ฐานข้อมูลเติมให้จากคนที่ล็อกอิน — ฝั่งแอปไม่ต้องส่ง */
  actorUid?: string;
}

/**
 * เกณฑ์ขั้นต่ำ — สะสมตลอดหลักสูตร (ปกติ 2 ปี) ไม่ใช่ต่อปี
 * Post-core นับรวมอยู่ในโควตา crown ไม่ได้แยกออกมาต่างหาก
 */
export interface Requirement {
  cd: number;
  rpd: number;
  crown: number; // Crown/Bridge + Post-core รวมกัน
  postCoreMin: number; // ในจำนวน crown ต้องเป็น Post-core อย่างน้อยกี่ชิ้น
  perYear: number; // ทุกปีต้องจบอย่างน้อยกี่ชิ้นงาน
  years: number; // เกณฑ์สะสมกี่ปี
}

export interface Settings {
  req: Requirement;
  /** งานถอดได้ (CD/RPD): คู่ upper+lower นับเป็น 1 เคส หรือแยกนับรายแถว — รอภาควิชายืนยัน */
  pairCountsAsOne: boolean;
  /** เกณฑ์รายปีนับทุกประเภท หรือเฉพาะ 4 ประเภทหลัก — รอภาควิชายืนยัน */
  perYearCountsAllTypes: boolean;
  stale: number; // วัน
  /** คาบคลินิกต่อสัปดาห์ (ใช้คำนวณสีเสี่ยง "ทันเกณฑ์ไหม") — ตารางจริงภาคเป็นคนรู้ ให้ปรับเองได้ */
  periodsPerWeek: number;
  photoRequired: boolean;
  remindDays: number; // เตือนล่วงหน้ากี่วัน
  /** เปิดให้นักศึกษากรอกแบบประเมินตนเองได้ (ภาคเปิดปีละครั้ง ตอนจบเทอม 1) */
  saOpen: boolean;
  /** กำหนดส่งแบบประเมินตนเอง (ISO date) — ว่างได้ ถ้าภาคยังไม่กำหนด */
  saDue?: string;
}

/** Workpiece + ข้อมูลผู้ป่วยที่ join แล้ว — รูปแบบที่ UI ใช้ */
export interface WorkpieceView extends Workpiece {
  patient: Patient;
}

/* ── แบบประเมินตนเอง (Self-assessment) — ปีละครั้ง ตอนจบเทอม 1 ─────────────── */

export type SelfAssessmentStatus = 'draft' | 'submitted';

/**
 * คำตอบหนึ่งชุด = นักศึกษาหนึ่งคน ต่อหนึ่งปีการศึกษา
 * โครงคำถามอยู่ที่ domain/selfAssessment.ts — ที่นี่เก็บแค่คำตอบ + สถานะ
 */
export interface SelfAssessment {
  id: string; // `${studentId}-${academicYear}` — คนละปีคนละชุด เขียนซ้ำไม่ทับกัน
  studentId: string;
  academicYear: number; // พ.ศ.
  /** ชั้นปีตอนกรอก — ฟอร์มมีบล็อกเฉพาะปี 5 จึงต้องรู้ว่าตอนนั้นอยู่ปีไหน */
  classYear: number;
  /** ฟอร์มฉบับไหน (SA_FORM_VERSION) — ภาคปรับฟอร์มได้ทุกปี ของเก่าต้องยังอ่านออก */
  formVersion: string;
  /** คีย์ตามคำถาม → คำตอบ (ตัวเลข / ข้อความ / รายการที่เลือก) */
  answers: Record<string, string | number | string[] | null>;
  status: SelfAssessmentStatus;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}
