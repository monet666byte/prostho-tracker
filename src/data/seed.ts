/**
 * Fixture ข้อมูลสมมติทั้งหมด — ผู้ป่วย A–D, HN DEMO-xxxx, นศ. ก–ซ, อ. ก./อ. ข.
 * ห้ามนำ pattern ของข้อมูลจริงจากชีตต้นทางมาใส่ที่นี่
 *
 * ชุดของ "นศ. ก" คัดลอกจาก state.works ของไฟล์ดีไซน์ ส่วนนักศึกษาที่เหลือ
 * generate ด้วย seeded RNG เพื่อให้ตัวเลขบน dashboard นิ่งทุกครั้งที่เปิด
 */

import { CATALOG_VERSION, DENTURE_CLASSES_FOR, TYPES, dentureLabel } from '../domain/catalog';
import { procList } from '../domain/rules';
import { MATRIX_ROUNDS } from '../domain/rounds';
import type {
  CheckIn, ClinicGroup, DentureClass, Patient, ProgressUpdate, ReportSubmission, Settings, Student,
  SubmissionStatus, Teacher, WorkType, Workpiece,
} from '../domain/types';
import { db, kvGet, kvSet } from './db';

export const DEFAULT_SETTINGS: Settings = {
  // เกณฑ์สะสม 2 ปี — CD 1 · RPD 2 · Crown/Bridge 2 (ในนั้นต้องเป็น Post-core อย่างน้อย 1)
  // และทุกปีต้องจบอย่างน้อย 3 ชิ้นงาน
  req: { cd: 1, rpd: 2, crown: 2, postCoreMin: 1, perYear: 3, years: 2 },
  // ค่าเริ่มต้นนับรายแถวตามชีตจริง (tab "Case CD" คอลัมน์ Count CDA ให้ 1–2 ต่อผู้ป่วย) — รอภาควิชายืนยัน
  pairCountsAsOne: false,
  perYearCountsAllTypes: false,
  stale: 14,
  photoRequired: false,
  remindDays: 3,
};

const TH_LETTERS = ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ', 'ช', 'ซ', 'ฌ', 'ญ', 'ฎ', 'ฏ'];
const GROUPS = Array.from({ length: 12 }, (_, i) => `TH-PT${i + 1}`);
const DEMO_STUDENT_ID = 'st-TH-PT7-1';
const DEMO_TEACHER_ID = 'tc-TH-PT7-1';
/** ชื่อของสองบัญชีที่ทีมใช้ล็อกอินทดสอบ/สาธิต — คนอื่นในระบบยังเป็น ก ข ค ตามเดิม */
export const DEMO_STUDENT_NAME = 'นศ. Liv';
export const DEMO_TEACHER_NAME = 'อ. Liv';

export const DEMO = { studentId: DEMO_STUDENT_ID, teacherId: DEMO_TEACHER_ID, group: 'TH-PT7' };

/** FNV-1a — กระจาย seed ให้ต่างกันชัดเจนแม้ id จะคล้ายกัน */
function hashString(v: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — RNG แบบ deterministic */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);

/** index ของ procedure สุดท้ายที่มี progression = p (ใช้ตั้งจุดเริ่มต้นของ fixture) */
function indexAtProgression(w: Pick<Workpiece, 'type' | 'variant'>, p: number): number {
  const list = procList(w);
  let last = -1;
  list.forEach((proc, i) => {
    if (proc[0] <= p) last = i;
  });
  return last;
}

// ─────────────────────────────────────────────────────────────
// นศ. ก — ชุดข้อมูลจากไฟล์ดีไซน์
// ─────────────────────────────────────────────────────────────

interface DemoWork {
  id: string; patient: string; type: WorkType; arch?: 'upper' | 'lower'; pair?: string;
  tooth?: string; variant?: 'cast' | 'prefab'; detail: string; accDaysAgo: number;
  procIndex: number; days: number; min: boolean; kennedy?: Workpiece['kennedy'];
  dentureClass?: DentureClass; pending?: boolean;
}

const DEMO_PATIENTS: Array<Omit<Patient, 'ownerStudentId'>> = [
  { id: 'pt-a', name: 'ผู้ป่วย A', hn: 'DEMO-0142', sexAge: 'ญ 68 ปี' },
  { id: 'pt-c', name: 'ผู้ป่วย C', hn: 'DEMO-0307', sexAge: 'ญ 45 ปี' },
  { id: 'pt-e', name: 'ผู้ป่วย E', hn: 'DEMO-0091', sexAge: 'ญ 72 ปี' },
  { id: 'pt-f', name: 'ผู้ป่วย F', hn: 'DEMO-0118', sexAge: 'ช 66 ปี' },
];


/**
 * ชุดของ นศ. ก — 3 ชิ้นงาน (เพดานเดียวกับ fixture ทุกคน จะได้นับด้วยตาไม่งง)
 * สถานะตั้งต้น: CD 0/1 (กำลังทำ) · RPD 1/2 · Crown 0/2 (Post-core 0/1) · รายปี 1/3
 * เคส Crown ซี่ 46 อยู่ที่ 9/10 — กดจบเคสตอนสาธิตแล้วจะเห็นกฎ "Crown ต้องมี Post-core" ทำงาน
 */
const DEMO_WORKS: DemoWork[] = [
  // กำลังทำ 2 ชิ้น
  { id: 'w1', patient: 'pt-a', type: 'CD', arch: 'upper', dentureClass: 'CD', detail: 'CD/- (Upper ไม่เหลือฟันแม้แต่ซี่เดียว)', accDaysAgo: 99, procIndex: 13, days: 1, min: true },
  { id: 'w5', patient: 'pt-c', type: 'CB', tooth: '46', detail: '46 Crown (PFM)', accDaysAgo: 75, procIndex: 16, days: 2, min: true },
  // จบเคสแล้ว 1 ชิ้น
  { id: 'w9', patient: 'pt-f', type: 'RPD', arch: 'lower', dentureClass: 'complicated-RPD', detail: '-/Complicated RPD (Lower เหลือไม่เกิน 4 ซี่) Kennedy class II', accDaysAgo: 152, procIndex: -2, days: 29, min: true, kennedy: 'Kennedy class II' },
];


function buildDemoWorkpieces(): Workpiece[] {
  return DEMO_WORKS.map((d) => {
    const shape = { type: d.type, variant: d.variant };
    // procIndex -2 = ชิ้นงานที่จบเคสแล้ว (procedure สุดท้ายของลิสต์)
    const procIndex = d.procIndex === -2 ? procList(shape).length - 1 : d.procIndex;
    return {
      id: d.id,
      patientId: d.patient,
      studentId: DEMO_STUDENT_ID,
      type: d.type,
      variant: d.variant,
      arch: d.arch,
      pairId: d.pair,
      tooth: d.tooth,
      kennedy: d.kennedy,
      dentureClass: d.dentureClass,
      detail: d.detail,
      acceptedDate: dateAgo(d.accDaysAgo),
      minimumRequirement: d.min,
      pendingQualification: false,
      payment: d.min ? 'ชำระแล้ว' : 'ยังไม่ชำระ',
      sect2Removable: d.type === 'CD' || d.type === 'RPD' || d.type === 'APD' || d.type === 'RRM',
      sect2Fixed: d.type === 'PC' || d.type === 'CB' || d.type === 'RFX',
      designRpd: d.kennedy ? 'ออกแบบแล้ว' : undefined,
      procIndex,
      lastUpdatedAt: daysAgo(d.days),
      completedAt: d.procIndex === -2 ? daysAgo(d.days) : undefined,
      catalogVersion: CATALOG_VERSION,
    } satisfies Workpiece;
  });
}

// ─────────────────────────────────────────────────────────────
// นักศึกษาที่เหลือ — generate
// ─────────────────────────────────────────────────────────────

const TOOTH_POOL = ['11', '13', '15', '16', '21', '24', '25', '26', '34', '35', '36', '37', '44', '45', '46', '47'];
const BRIDGE_POOL = ['14–16', '34–36', '24–26', '44–46'];

function generateFor(student: Student, seed: number) {
  const rand = rng(seed);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  // pace = จังหวะการทำงานของนักศึกษาคนนี้ ใช้ร่วมกันทุกประเภทงาน
  // เพื่อให้คนที่เดินหน้าเร็วครบเกณฑ์หลายประเภทพร้อมกัน (เหมือนของจริง)
  const pace = rand();

  const patients: Patient[] = [];
  const works: Workpiece[] = [];
  const nPatients = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < nPatients; i++) {
    patients.push({
      id: `${student.id}-p${i}`,
      name: `ผู้ป่วย ${TH_LETTERS[i % TH_LETTERS.length]}`,
      hn: `DEMO-${String(1000 + Math.floor(rand() * 8999))}`,
      sexAge: `${rand() > 0.5 ? 'ญ' : 'ช'} ${40 + Math.floor(rand() * 40)} ปี`,
      ownerStudentId: student.id,
    });
  }

  let n = 0;
  let actives = 0; // ชิ้นที่ยังไม่จบ — ของจริงถือพร้อมกันไม่เกิน 3
  const MAX_ACTIVE = 3;
  // เพดานรวมทั้งจบแล้ว: ข้อมูลตัวอย่างให้คนละไม่เกิน 3 ชิ้น จะได้นับด้วยตาไม่งง
  const MAX_TOTAL_PIECES = 3;

  /**
   * เคสจะจบได้ก็ต่อเมื่อ "รับมานานพอ" เทียบกับเวลาที่งานประเภทนั้นใช้จริง
   * ปีการศึกษาเพิ่งเริ่มได้ ~3 เดือน (รับเคสตั้งแต่กลางพฤษภา) งาน Crown 8 สัปดาห์จึงจบไปบ้างแล้ว
   * ส่วน RPD 17 สัปดาห์แทบยังไม่มีใครจบ — ให้ข้อมูลมันสอดคล้องกันเองแทนที่จะสุ่มมั่ว
   */
  const push = (type: WorkType, wantComplete: boolean) => {
    if (n >= MAX_TOTAL_PIECES) return;
    const patient = pick(patients);
    const removable = type === 'CD' || type === 'RPD';
    const variant = type === 'PC' ? (rand() < 0.55 ? 'cast' : 'prefab') : undefined;
    const shape = { type, variant } as Pick<Workpiece, 'type' | 'variant'>;
    const max = procList(shape).length - 1;

    const typicalWeeks = type === 'RPD' ? 17 : type === 'CD' ? 14 : type === 'PC' ? 11 : 8;
    const durationDays = Math.round((typicalWeeks + (rand() - 0.5) * 9) * 7);
    // รับเคสได้ตั้งแต่กลางพฤษภา (ตรงกับ Accepted date ในชีตจริง) จนถึงวันนี้
    // ชิ้นที่ตั้งใจให้จบแล้ว = เคสที่รับช่วงต้นปี ถึงจะมีเวลาพอทำจบจริง
    const acceptedDaysAgo = wantComplete ? 55 + Math.floor(rand() * 45) : 4 + Math.floor(rand() * 96);
    const elapsed = acceptedDaysAgo;

    const canFinish = elapsed - durationDays >= 3;
    const complete = wantComplete && canFinish;
    // ชิ้นที่จะกลายเป็นงานค้างในมือ ต้องไม่เกินเพดาน — เกินแล้วไม่รับเคสนั้นตั้งแต่แรก
    if (!complete) {
      if (actives >= MAX_ACTIVE) return;
      actives++;
    }
    const completedDaysAgo = complete ? Math.max(1, elapsed - durationDays) : 0;

    // ชิ้นที่ยังไม่จบ — เดินหน้าไปตามสัดส่วนเวลาที่ถือเคสมา
    const ratio = Math.min(0.95, elapsed / durationDays);
    const procIndex = complete
      ? max
      : indexAtProgression(shape, Math.max(0, Math.min(9, Math.round(ratio * 10))));

    const stale = !complete && rand() < 0.07;
    const arch = removable ? (n % 2 === 0 ? 'upper' : 'lower') : undefined;
    const dentureClass = removable ? pick(DENTURE_CLASSES_FOR[type] ?? []) : undefined;
    const tooth = removable ? undefined : type === 'CB' && rand() < 0.25 ? pick(BRIDGE_POOL) : pick(TOOTH_POOL);
    const label = TYPES[type].short;
    const touched = daysAgo(
      complete ? completedDaysAgo : stale ? 15 + Math.floor(rand() * 24) : Math.floor(rand() * 13),
    );

    works.push({
      id: `${student.id}-w${n++}`,
      patientId: patient.id,
      studentId: student.id,
      type,
      variant,
      arch,
      tooth,
      kennedy: type === 'RPD' ? pick(['Kennedy class I', 'Kennedy class II', 'Kennedy class III', 'Kennedy class IV'] as const) : undefined,
      dentureClass,
      detail:
        removable && dentureClass && arch
          ? dentureLabel(dentureClass, arch)
          : removable
            ? arch === 'upper' ? `${label}/- (Upper)` : `-/${label} (Lower)`
            : `${tooth} ${type === 'PC' ? `Post-core crown (${variant} post)` : (tooth ?? '').includes('–') ? 'Bridge' : 'Crown (PFM)'}`,
      acceptedDate: dateAgo(acceptedDaysAgo),
      minimumRequirement: true,
      pendingQualification: false,
      payment: rand() < 0.6 ? 'ชำระแล้ว' : rand() < 0.9 ? 'ยังไม่ชำระ' : 'ยกเว้น',
      sect2Removable: removable,
      sect2Fixed: !removable,
      procIndex,
      lastUpdatedAt: touched,
      completedAt: complete ? touched : undefined,
      catalogVersion: CATALOG_VERSION,
    });
  };

  // ~3.5 เดือนแรกของปี: ส่วนใหญ่จบไปแล้ว 1 ชิ้น (งานสั้นอย่าง Crown/Post-core) บางคน 2 บางคนยัง
  // RPD 17 สัปดาห์ยังไม่มีใครจบ — ให้ตัวเลขทั้งชั้นปีออกมาสมเหตุผลเอง
  const local = (bias = 0) => pace + bias + (rand() - 0.5) * 0.44;
  const finishTarget = (() => { const l = local(); return l > 0.86 ? 2 : l > 0.32 ? 1 : 0; })();
  const finishTypes: WorkType[] = ['CB', 'CB', 'PC', 'CD'];
  for (let i = 0; i < finishTarget; i++) push(pick(finishTypes), true);

  // เติมชิ้นที่กำลังทำจนถึงจำนวนที่คนนั้นถืออยู่จริง (1–3 · ส่วนใหญ่ 2)
  const holding = 1 + (rand() < 0.75 ? 1 : 0) + (rand() < 0.3 ? 1 : 0);
  const activeTypes: WorkType[] = ['CD', 'RPD', 'CB', 'PC'];
  let guard = 0;
  while (actives < holding && n < MAX_TOTAL_PIECES && guard++ < 12) push(pick(activeTypes), false);

  return { patients, works };
}

// ─────────────────────────────────────────────────────────────

const SUBMISSION_PATTERN: SubmissionStatus[][] = [
  ['approved', 'approved', 'sent', 'none', 'none'],
  ['approved', 'approved', 'approved', 'none', 'none'],
  ['approved', 'late', 'sent', 'none', 'none'],
  ['approved', 'approved', 'none', 'none', 'none'],
  ['approved', 'approved', 'sent', 'none', 'none'],
  ['late', 'approved', 'sent', 'none', 'none'],
  ['approved', 'approved', 'approved', 'none', 'none'],
  ['approved', 'approved', 'none', 'none', 'none'],
];

/** bump เมื่อแก้ fixture — ผู้ใช้เดิมจะได้ข้อมูลชุดใหม่โดยไม่ต้องล้างเบราว์เซอร์เอง */
export const SEED_VERSION = 27;

/** คาบคลินิกย้อนหลังของ นศ. ก + คิวรอประเมินของกลุ่ม PT7 — เลียนแบบหน้าสมุดจริง */
function buildCheckIns(): CheckIn[] {
  const rows: CheckIn[] = [];
  const mk = (over: Partial<CheckIn> & { studentId: string; date: string }): CheckIn => ({
    id: `ci-${over.studentId}-${over.date}`,
    punctual: true,
    checkinAt: '08:56',
    noPatient: false,
    activities: [],
    status: 'pending',
    createdAt: `${over.date}T09:10:00.000Z`,
    ...over,
  });
  // สเกลจริงมีแค่ 3 / 1 / 0
  const score = (k: number, s2: number, rest = 3) => ({
    knowledge: k, skill: s2, precaution: rest, instrument: rest, time: rest, chart: rest,
    communication: 3, conduct: 3,
  });

  // ประวัติของ นศ. ก — คาบละสัปดาห์ ประเมินแล้ว (เหมือนแถวที่อาจารย์เซ็นแล้วในสมุด)
  const demo: Array<[string, string[], boolean, Record<string, number> | null, string?]> = [
    ['2026-06-24', ['Oral examination'], false, score(1, 1)],
    ['2026-07-01', ['Primary impression'], false, score(1, 1)],
    ['2026-07-08', ['ไม่มีผู้ป่วย (no patient)', 'Laboratory work'], true, score(1, 3)],
    ['2026-07-15', ['Bite registration'], false, score(3, 1)],
    ['2026-07-22', ['Laboratory work'], true, score(3, 3)],
    ['2026-07-29', ['Try in / Delivery'], false, score(3, 3)],
    ['2026-08-05', ['Oral examination', 'ส่งงาน · ตรวจงานกับอาจารย์'], false, score(3, 3, 3)],
    ['2026-08-19', ['Primary impression'], false, null], // คาบล่าสุด — ยังรออาจารย์ประเมิน
  ];
  demo.forEach(([date, activities, noPatient, scores]) => {
    rows.push(
      mk({
        studentId: DEMO_STUDENT_ID,
        date,
        activities,
        noPatient,
        patientId: noPatient ? undefined : 'pt-a',
        ...(scores
          ? { status: 'evaluated', scores, evaluatedBy: DEMO_TEACHER_NAME, evaluatedAt: `${date}T12:00:00.000Z` }
          : {}),
      }),
    );
  });

  // เพื่อนร่วมกลุ่ม PT7 — เช็คอินวันนี้ รอประเมิน (ให้ฝั่งอาจารย์มีคิวให้ลองกด)
  const today = new Date().toISOString().slice(0, 10);
  const acts = [['Oral examination'], ['Primary impression'], ['Laboratory work'], ['Try in / Delivery']];
  for (let i = 2; i <= 5; i++) {
    rows.push(
      mk({
        studentId: `st-TH-PT7-${i}`,
        date: today,
        activities: acts[(i - 2) % acts.length],
        punctual: i !== 4,
      }),
    );
  }
  // ตัวอย่าง "มาคลินิกแต่ step ไม่ขยับหลายคาบติด" — st-TH-PT7-4 เช็คอินย้อนหลัง 2 สัปดาห์ (ประเมินแล้ว) โดยไม่มี step ผ่านเลย
  for (const daysBack of [7, 14]) {
    const d = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
    rows.push(
      mk({
        studentId: 'st-TH-PT7-4',
        date: d,
        activities: ['Try in / Delivery'],
        status: 'evaluated',
        scores: { knowledge: 1, skill: 1, precaution: 3, instrument: 3, time: 1, chart: 3, communication: 3, conduct: 3 },
        evaluatedBy: DEMO_TEACHER_NAME,
        evaluatedAt: `${d}T12:00:00.000Z`,
      }),
    );
  }
  // กลุ่มอื่นทั้ง 11 กลุ่ม: ประวัติประเมินแล้ว + คิววันนี้ ให้หน้าประเมินมีตัวอย่างทุกกลุ่ม
  const score31 = (i: number) => ({
    knowledge: i % 3 === 0 ? 1 : 3, skill: i % 4 === 0 ? 1 : 3, precaution: 3, instrument: 3,
    time: i % 5 === 0 ? 1 : 3, chart: 3, communication: 3, conduct: 3,
  });
  for (let g = 1; g <= 12; g++) {
    for (let sIdx = 1; sIdx <= 8; sIdx++) {
      const sid = `st-TH-PT${g}-${sIdx}`;
      // PT7: นศ. ก มีชุดทำมือละเอียดแล้ว · คนที่ 4 เป็นตัวอย่าง "ติด step" อย่าทับ
      if (g === 7 && (sIdx === 1 || sIdx === 4)) continue;
      // ประวัติ ~6 คาบย้อนหลัง (ประเมินแล้ว) — ให้กราฟเส้นคะแนนมีหลายจุด
      for (const back of [7, 14, 21, 28, 35, 42]) {
        const d = new Date(Date.now() - (back + ((g + sIdx) % 3)) * 86_400_000).toISOString().slice(0, 10);
        rows.push(
          mk({
            studentId: sid, date: d,
            activities: acts[(g + sIdx + back) % acts.length],
            punctual: (g + sIdx + back) % 7 !== 0,
            status: 'evaluated', scores: score31(g + sIdx + back),
            evaluatedBy: `อ. ${TH_LETTERS[(g - 1) % TH_LETTERS.length]}.`,
            evaluatedAt: `${d}T12:00:00.000Z`,
          }),
        );
      }
      // คิววันนี้ ~3 คนต่อกลุ่ม
      if (sIdx <= 3) {
        rows.push(mk({
          studentId: sid, date: today, activities: acts[(g + sIdx) % acts.length],
          punctual: sIdx !== 2, checkinAt: sIdx !== 2 ? '08:52' : '09:31',
          photoCount: sIdx === 1 ? 2 : sIdx === 3 ? 1 : undefined,
        }));
      }
    }
  }
  return rows;
}

/**
 * ประวัติผ่าน step ของ นศ. ก ให้คู่กับวันเช็คอิน — คาบไหนงานเดินจะได้ไม่โดนนับเป็น "มาแต่ไม่ขยับ"
 * (คาบ 8 ก.ค. เป็นวัน lab กับคาบล่าสุด 19 ส.ค. ตั้งใจให้ไม่มี step — เป็นตัวอย่างจริงของคาบที่งานไม่ขยับ)
 */
function buildDemoUpdates(checkins: CheckIn[]): ProgressUpdate[] {
  const rows: ProgressUpdate[] = [];
  const dates = ['2026-06-24', '2026-07-01', '2026-07-15', '2026-07-22', '2026-07-29', '2026-08-05'];
  dates.forEach((date, i) => {
    rows.push({
      id: `du-${date}`, workpieceId: 'w1', procIndex: 5 + i, progression: 2 + i,
      performedAt: date, selfPerformed: false, photoIds: [],
      createdBy: DEMO_STUDENT_NAME, createdAt: `${date}T10:30:00.000Z`, syncedAt: `${date}T10:30:00.000Z`,
    });
  });

  // เช็คอินที่ประเมินแล้วของนักศึกษาคนอื่น = คาบที่งานเดินจริง ให้มี step ผ่านคู่กันด้วย
  // ยกเว้นกลุ่มละหนึ่งคน (รหัสลงท้าย -4) จงใจไม่ใส่ → เป็นตัวอย่าง "ติด step เดิม" กระจายทุกกลุ่ม
  checkins.forEach((c) => {
    if (c.status !== 'evaluated') return;
    if (c.studentId === DEMO_STUDENT_ID) return;
    if (c.studentId.endsWith('-4')) return;
    rows.push({
      id: `gu-${c.studentId}-${c.date}`,
      workpieceId: `${c.studentId}-w0`,
      procIndex: 3, progression: 2,
      performedAt: c.date, selfPerformed: false, photoIds: [],
      createdBy: c.studentId, createdAt: `${c.date}T10:30:00.000Z`, syncedAt: `${c.date}T10:30:00.000Z`,
    });
  });
  return rows;
}

export async function seedIfEmpty(): Promise<void> {
  const { setSyncPaused } = await import('./cloudSync');
  setSyncPaused(true);
  try {
    await seedIfEmptyInner();
  } finally {
    setSyncPaused(false);
  }
}

async function seedIfEmptyInner(): Promise<void> {
  const version = await kvGet<number>('seedVersion', 0);
  if (version === SEED_VERSION && (await db.students.count()) > 0) return;

  // เก็บ session ไว้ก่อนล้างฐาน — ผู้ใช้ไม่ควรหลุด login เพราะ fixture เปลี่ยนเวอร์ชัน
  const keptSession = await kvGet<unknown>('session', null);
  if (version !== SEED_VERSION) {
    await db.delete();
    await db.open();
  }

  const teachers: Teacher[] = [];
  const students: Student[] = [];
  const groups: ClinicGroup[] = [];
  const patients: Patient[] = [];
  const workpieces: Workpiece[] = [];
  const submissions: ReportSubmission[] = [];

  GROUPS.forEach((code, gi) => {
    const advisorIds: [string, string] = [`tc-${code}-1`, `tc-${code}-2`];
    teachers.push(
      {
        id: advisorIds[0],
        name: advisorIds[0] === DEMO_TEACHER_ID ? DEMO_TEACHER_NAME : `อ. ${TH_LETTERS[gi % TH_LETTERS.length]}.`,
        title: 'อาจารย์ที่ปรึกษากลุ่ม',
      },
      { id: advisorIds[1], name: `อ. ${TH_LETTERS[(gi + 6) % TH_LETTERS.length]}.`, title: 'อาจารย์ที่ปรึกษากลุ่ม' },
    );

    const studentIds: string[] = [];
    for (let si = 0; si < 8; si++) {
      const id = `st-${code}-${si + 1}`;
      studentIds.push(id);
      students.push({
        id,
        code: String(6504001 + gi * 8 + si),
        name: id === DEMO_STUDENT_ID ? DEMO_STUDENT_NAME : `นศ. ${TH_LETTERS[si]}`,
        group: code,
        year: 5,
        advisorIds,
      });
    }
    groups.push({ code, advisorIds, studentIds });
  });

  for (const student of students) {
    if (student.id === DEMO_STUDENT_ID) {
      patients.push(...DEMO_PATIENTS.map((p) => ({ ...p, ownerStudentId: DEMO_STUDENT_ID })));
      workpieces.push(...buildDemoWorkpieces());
    } else {
      const seed = hashString(student.id);
      const gen = generateFor(student, seed);
      patients.push(...gen.patients);
      workpieces.push(...gen.works);
    }

    const gi = GROUPS.indexOf(student.group);
    const si = parseInt(student.id.split('-').pop() ?? '1', 10) - 1;
    // นศ. ก คือคนที่ใช้เดโม — ให้รอบที่กำลังจะถึงยังไม่ส่ง เพื่อให้เห็นการ์ดเตือนทำงานจริง
    const pattern: SubmissionStatus[] =
      student.id === DEMO_STUDENT_ID
        ? ['approved', 'approved', 'none', 'none', 'none']
        : SUBMISSION_PATTERN[(gi + si) % SUBMISSION_PATTERN.length];
    MATRIX_ROUNDS.forEach((round, ri) => {
      submissions.push({
        id: `${student.id}-${round.id}`,
        studentId: student.id,
        roundId: round.id,
        status: pattern[ri],
      });
    });
  }

  await db.transaction('rw', [db.teachers, db.students, db.groups, db.patients, db.workpieces, db.submissions, db.checkins, db.updates, db.kv], async () => {
    await db.teachers.bulkPut(teachers);
    await db.students.bulkPut(students);
    await db.groups.bulkPut(groups);
    await db.patients.bulkPut(patients);
    await db.workpieces.bulkPut(workpieces);
    await db.submissions.bulkPut(submissions);
    const checkinRows = buildCheckIns();
    await db.checkins.bulkPut(checkinRows);
    await db.updates.bulkPut(buildDemoUpdates(checkinRows));
    await kvSet('settings', DEFAULT_SETTINGS);
    await kvSet('seedVersion', SEED_VERSION);
    if (keptSession) await kvSet('session', keptSession);
  });
}

/** ล้างและ seed ใหม่ — ใช้ปุ่ม "รีเซ็ตข้อมูลเดโม" ก่อนเริ่มนำเสนอรอบใหม่ */
export async function resetDemoData(): Promise<void> {
  await db.delete();
  await db.open();
  await kvSet('seedVersion', 0);
  await seedIfEmpty();
}
