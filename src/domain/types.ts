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

export interface Student {
  id: string;
  code: string; // เช่น 6504008
  name: string;
  group: string; // TH-PT1 … TH-PT12
  year: number;
  advisorIds: [string, string];
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
  photoRequired: boolean;
  remindDays: number; // เตือนล่วงหน้ากี่วัน
}

/** Workpiece + ข้อมูลผู้ป่วยที่ join แล้ว — รูปแบบที่ UI ใช้ */
export interface WorkpieceView extends Workpiece {
  patient: Patient;
}
