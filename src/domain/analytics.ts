/**
 * การวิเคราะห์ระดับ cohort — คำนวณจากข้อมูลจริงในระบบทั้งหมด
 * ไม่มีค่าคงที่ที่ hard-code ไว้ ถ้า import ข้อมูลจริงเข้ามา ตัวเลขจะเปลี่ยนตามทันที
 */

import { lang } from '../lib/i18n';
import { ORDER, REQ_TYPES, TYPES } from './catalog';
import { ROUNDS } from './rounds';
import {
  caseCount, completedInYear, isComplete, isStale, maxProgression, procAt, procList, progression,
} from './rules';
import type { CheckIn, ProgressUpdate, Settings, Student, WorkType, Workpiece } from './types';
import { academicYear } from '../lib/date';

const DAY = 86_400_000;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function byStudent(works: Workpiece[]): Map<string, Workpiece[]> {
  const map = new Map<string, Workpiece[]>();
  works.forEach((w) => map.set(w.studentId, [...(map.get(w.studentId) ?? []), w]));
  return map;
}

// ── 1. ใครเสี่ยงไม่ทันเกณฑ์ ─────────────────────────────────

export type RiskLevel = 'high' | 'medium' | 'ok';

/**
 * สมมติฐานจังหวะงาน (แก้ได้เมื่อภาควิชามีตัวเลขจริง):
 * - คลินิกราว 2 คาบ/สัปดาห์ (สมุด logbook จริงมีหลายรายการต่อสัปดาห์)
 * - หนึ่ง step ไม่ได้ผ่านในคาบเดียวเสมอ — เผื่อเฉลี่ย ~1.5 คาบ/step
 */
const PERIODS_PER_WEEK = 2;
const PERIODS_PER_STEP = 1.5;

export interface RiskRow {
  student: Student;
  completedThisYear: number;
  /** ชิ้นงานทั้งหมดในมือ กับที่จบแล้ว — โชว์คู่กับ +N งานให้เลขตรงกัน */
  piecesTotal: number;
  piecesDone: number;
  yearGap: number;
  /** step ที่ต้องผ่านอีกถึงจะครบเกณฑ์รายปี (นับจากเคสที่ใกล้จบสุดก่อน) */
  stepsRemaining: number;
  piecesCounted: number;
  /** คาบที่คาดว่าต้องใช้ (เผื่อ step ละ ~1.5 คาบ) เทียบกับคาบที่เหลือ */
  periodsNeeded: number;
  periodsLeft: number;
  /** วันที่เงียบสนิท — ไม่ทั้งเช็คอินและไม่ผ่าน step */
  silentDays: number;
  /** มาคลินิกแต่ step ไม่ขยับ ติดต่อกันกี่คาบล่าสุด */
  stuckPeriods: number;
  /** step ที่กำลังติดอยู่ เช่น "CD-6" — จากเคสที่แตะล่าสุด */
  stuckStep: string;
  /** ชื่อเต็มของ step ที่กำลังทำ เช่น "RPD-6 · Mounting on articulator" */
  currentStepLabel: string;
  /** งานที่ยังไม่จบทุกชิ้น เรียงตามที่แตะล่าสุด — ให้อาจารย์กดกางดู/เลือกได้เมื่อมีหลายงาน */
  pieces: Array<{ id: string; type: WorkType; code: string; name: string; progression: number; days: number }>;
  /** งานที่จบแล้ว — โชว์ตอนกาง ให้เลขรวม (piecesDone/piecesTotal) นับด้วยตาได้ครบ */
  donePieces: Array<{ id: string; type: WorkType; days: number }>;
  /** เคสที่ยังขาด (ต้องรับเพิ่ม) ถึงจะครบเกณฑ์รายปี */
  piecesShort: number;
  monthsLeft: number;
  risk: RiskLevel;
  reason: string;
}

/** เดือนที่เหลือก่อนคาบสุดท้ายของปีการศึกษา */
function monthsRemaining(now: Date): number {
  const final = new Date(ROUNDS[ROUNDS.length - 1].dueDate);
  return Math.max(0, (final.getTime() - now.getTime()) / (DAY * 30.4));
}

export function riskRows(
  students: Student[],
  works: Workpiece[],
  settings: Settings,
  checkins: CheckIn[] = [],
  updates: ProgressUpdate[] = [],
  now = new Date(),
): RiskRow[] {
  const map = byStudent(works);
  const year = academicYear(now);
  const left = monthsRemaining(now);
  const periodsLeft = Math.round(left * 4.33 * PERIODS_PER_WEEK);

  const checkinsByStudent = new Map<string, CheckIn[]>();
  checkins.forEach((c) => checkinsByStudent.set(c.studentId, [...(checkinsByStudent.get(c.studentId) ?? []), c]));

  // วันที่มี step ผ่านจริง ต่อนักศึกษา (จากประวัติการกดผ่าน ไม่นับเลิกทำ)
  const workOwner = new Map(works.map((w) => [w.id, w.studentId]));
  const stepDates = new Map<string, Set<string>>();
  updates.forEach((u) => {
    if (u.reversal) return;
    const sid = workOwner.get(u.workpieceId);
    if (!sid) return;
    if (!stepDates.has(sid)) stepDates.set(sid, new Set());
    stepDates.get(sid)!.add(u.performedAt);
  });

  return students
    .map((student) => {
      const mine = map.get(student.id) ?? [];
      const completedThisYear = completedInYear(mine, year, settings).length;
      const yearGap = Math.max(0, settings.req.perYear - completedThisYear);

      const active = mine.filter((w) => !isComplete(w)).sort((a, b) => progression(b) - progression(a));
      const counted = active.slice(0, yearGap);
      const shortPieces = yearGap - counted.length;
      // เคสที่ยังไม่ได้รับ นับเป็นงานอนาคต ~10 step/เคส — รวมในตัวเลขเดียว ไม่แยกป้ายเตือน
      // (เคสไม่ใช่ของที่สั่งรับได้ทันที และต้นปีถือเคสน้อยกว่าเกณฑ์เป็นเรื่องปกติ)
      const stepsRemaining =
        counted.reduce((sum, w) => sum + Math.max(0, 10 - progression(w)), 0) + shortPieces * 10;
      const periodsNeeded = Math.ceil(stepsRemaining * PERIODS_PER_STEP);

      // มาแต่ step ไม่ขยับ: ไล่เช็คอินล่าสุดถอยหลัง จนเจอคาบที่มี step ผ่าน
      const myCheckins = (checkinsByStudent.get(student.id) ?? []).sort((a, b) => b.date.localeCompare(a.date));
      // step ที่กำลังพยายามผ่าน = step ถัดไปของเคสที่แตะล่าสุด
      const current = [...active].sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0];
      const stuckStep = current ? `${TYPES[current.type].prefix}-${Math.min(10, progression(current) + 1)}` : '';
      const nextProcOfCurrent = current ? procAt(current, current.procIndex + 1) : null;
      const pieces = [...active]
        .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
        .map((w) => {
          const next = procAt(w, w.procIndex + 1);
          return {
            id: w.id,
            type: w.type,
            code: `${TYPES[w.type].prefix}-${Math.min(10, progression(w) + 1)}`,
            name: next ? next.name : (lang === 'en' ? 'awaiting case closure' : 'รอปิดเคส'),
            progression: Math.max(0, progression(w)),
            days: Math.max(0, Math.floor((now.getTime() - new Date(w.lastUpdatedAt).getTime()) / DAY)),
          };
        });
      const currentStepLabel = current
        ? nextProcOfCurrent
          ? `${stuckStep} · ${nextProcOfCurrent.name}`
          : `${TYPES[current.type].prefix} ${lang === 'en' ? 'awaiting closure' : 'รอปิดเคส'}`
        : lang === 'en' ? 'no active case' : 'ไม่มีเคสในมือ';
      const passed = stepDates.get(student.id) ?? new Set<string>();
      let stuckPeriods = 0;
      for (const c of myCheckins) {
        if (passed.has(c.date)) break;
        stuckPeriods++;
      }

      const lastStepDays = active.length
        ? Math.min(...active.map((w) => Math.floor((now.getTime() - new Date(w.lastUpdatedAt).getTime()) / DAY)))
        : 999;
      const lastCheckinDays = myCheckins.length
        ? Math.floor((now.getTime() - new Date(myCheckins[0].date).getTime()) / DAY)
        : 999;
      const silentDays = Math.min(lastStepDays, lastCheckinDays);

      let risk: RiskLevel = 'ok';
      const EN = lang === 'en';
      let reason = EN ? 'Yearly requirement met' : 'ผ่านเกณฑ์รายปีแล้ว';

      if (yearGap > 0) {
        const futureNote = shortPieces > 0 ? (EN ? ` (incl. ${shortPieces} not-yet-accepted case(s))` : ` (รวมเคสที่ยังไม่ได้รับ ${shortPieces} เคส)`) : '';
        if (active.length === 0) {
          risk = 'high';
          reason = EN ? 'No active case at all' : 'ยังไม่มีเคสในมือเลย';
        } else if (periodsNeeded > periodsLeft) {
          risk = 'high';
          reason = EN ? `~${stepsRemaining} steps left${futureNote} ≈ ${periodsNeeded} periods, but only ~${periodsLeft} remain` : `เหลือ ~${stepsRemaining} step${futureNote} ≈ ${periodsNeeded} คาบ แต่คาบที่เหลือมีราว ${periodsLeft}`;
        } else if (periodsNeeded > periodsLeft * 0.7) {
          risk = 'medium';
          reason = EN ? `~${stepsRemaining} steps left${futureNote} ≈ ${periodsNeeded} of ~${periodsLeft} periods — feasible but no slack` : `เหลือ ~${stepsRemaining} step${futureNote} ≈ ${periodsNeeded} คาบ จาก ~${periodsLeft} — พอไหวแต่ห้ามหยุด`;
        } else if (silentDays >= settings.stale) {
          risk = 'medium';
          reason = EN ? `~${stepsRemaining} steps left${futureNote} · silent for ${silentDays} days` : `เหลือ ~${stepsRemaining} step${futureNote} · เงียบมา ${silentDays} วัน`;
        } else {
          reason = EN ? `~${stepsRemaining} steps left${futureNote} ≈ ${periodsNeeded} periods` : `เหลือ ~${stepsRemaining} step${futureNote} ≈ ${periodsNeeded} คาบ`;
        }

        // มาเรียนแต่งานไม่ขยับหลายคาบติด = ติดเทคนิค — สัญญาณคนละแบบกับหายตัว
        if (stuckPeriods >= 3 && risk !== 'high') {
          risk = 'high';
          reason = EN ? `Stuck at ${stuckStep} for ${stuckPeriods} periods — likely a technique issue, worth checking chairside` : `ติด ${stuckStep} มา ${stuckPeriods} คาบแล้ว — น่าจะติดเทคนิค ควรเข้าไปดูหน้างาน`;
        } else if (stuckPeriods === 2 && risk === 'ok') {
          risk = 'medium';
          reason = EN ? `Stuck at ${stuckStep} for 2 periods — keep an eye on it` : `ติด ${stuckStep} มา 2 คาบ — จับตาว่าติดอะไร`;
        }
      }

      return {
        student, completedThisYear, yearGap, stepsRemaining,
        piecesTotal: mine.length, piecesDone: mine.filter((w) => isComplete(w)).length,
        donePieces: mine.filter((w) => isComplete(w)).map((w) => ({
          id: w.id, type: w.type,
          days: Math.max(0, Math.floor((now.getTime() - new Date(w.lastUpdatedAt).getTime()) / DAY)),
        })),
        piecesCounted: counted.length, periodsNeeded, periodsLeft,
        silentDays: Math.min(silentDays, 99), stuckPeriods, stuckStep, currentStepLabel, pieces,
        piecesShort: shortPieces,
        monthsLeft: Math.round(left * 10) / 10,
        risk, reason,
      };
    })
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, ok: 2 };
      if (rank[a.risk] !== rank[b.risk]) return rank[a.risk] - rank[b.risk];
      if (b.stuckPeriods !== a.stuckPeriods) return b.stuckPeriods - a.stuckPeriods;
      return b.stepsRemaining - a.stepsRemaining;
    });
}

// ── 2. จบเคสกี่ชิ้นต่อเดือน ────────────────────────────────

export interface MonthPoint {
  key: string; // YYYY-M
  label: string; // "ส.ค."
  count: number;
  future: boolean; // เดือนที่ยังมาไม่ถึงในปีการศึกษานี้
}

const TH_MONTHS = lang === 'en'
  ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  : ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** จบเคสกี่ชิ้นในแต่ละเดือนของปีการศึกษา (มิ.ย. → คาบสุดท้ายเดือน มี.ค.) */
export function throughputByMonth(works: Workpiece[], now = new Date()): MonthPoint[] {
  const startYear = academicYear(now) - 543; // ค.ศ. ของเดือนมิถุนายนที่เปิดปีการศึกษา
  const buckets: MonthPoint[] = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(startYear, 5 + i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: TH_MONTHS[d.getMonth()],
      count: 0,
      future: d.getTime() > new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  works.forEach((w) => {
    if (!w.completedAt) return;
    const d = new Date(w.completedAt);
    const i = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i !== undefined) buckets[i].count++;
  });
  return buckets;
}

// ── 3. รับเคสแล้วใช้เวลากี่สัปดาห์กว่าจะจบ ──────────────────

export interface DurationRow {
  type: WorkType;
  medianWeeks: number;
  minWeeks: number;
  maxWeeks: number;
  samples: number;
}

export function durationByType(works: Workpiece[]): DurationRow[] {
  return REQ_TYPES.map((type) => {
    const weeks = works
      .filter((w) => w.type === type && w.completedAt)
      .map((w) => (new Date(w.completedAt!).getTime() - new Date(w.acceptedDate).getTime()) / (DAY * 7))
      .filter((n) => n > 0)
      .map((n) => Math.round(n));
    return {
      type,
      medianWeeks: median(weeks),
      minWeeks: weeks.length ? Math.min(...weeks) : 0,
      maxWeeks: weeks.length ? Math.max(...weeks) : 0,
      samples: weeks.length,
    };
  }).sort((a, b) => b.medianWeeks - a.medianWeeks);
}

// ── 4. ชิ้นงานไปค้างอยู่ที่ step ไหน (คอขวดจริง) ──────────────

export interface StepBucket {
  progression: number;
  count: number;
  stale: number;
  label: string;
}

export function bottleneckByStep(works: Workpiece[], settings: Settings, type?: WorkType): StepBucket[] {
  const scope = works.filter((w) => !isComplete(w) && (!type || w.type === type));
  const buckets: StepBucket[] = Array.from({ length: 11 }, (_, i) => ({
    progression: i,
    count: 0,
    stale: 0,
    label: '',
  }));

  scope.forEach((w) => {
    const p = Math.max(0, progression(w));
    if (p > 10) return;
    buckets[p].count++;
    if (isStale(w, settings)) buckets[p].stale++;
  });

  // ชื่อ step แรกของ progression นั้น เอาไว้บอกว่าคอขวดคือขั้นตอนอะไร
  const sample = type ?? 'CD';
  const list = procList({ type: sample, variant: 'cast' });
  buckets.forEach((b) => {
    b.label = list.find((p) => p[0] === b.progression)?.[1] ?? '';
  });
  return buckets;
}

// ── 5. funnel ต่อประเภทงาน ─────────────────────────────────

export interface FunnelRow {
  type: WorkType;
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  stale: number;
  completionRate: number;
}

export function funnelByType(works: Workpiece[], settings: Settings): FunnelRow[] {
  const types = [...new Set(works.map((w) => w.type))].sort((a, b) => ORDER[a] - ORDER[b]);
  return types.map((type) => {
    const mine = works.filter((w) => w.type === type);
    const completed = mine.filter(isComplete).length;
    return {
      type,
      total: mine.length,
      notStarted: mine.filter((w) => w.procIndex < 0).length,
      inProgress: mine.filter((w) => w.procIndex >= 0 && !isComplete(w)).length,
      completed,
      stale: mine.filter((w) => isStale(w, settings)).length,
      completionRate: mine.length ? Math.round((completed / mine.length) * 100) : 0,
    };
  });
}

// ── 6. lab step ที่นักศึกษาต้องทำเอง ───────────────────────

export interface SelfPerformedRow {
  student: Student;
  done: number;
  available: number;
}

/** นับ procedure ที่ติดดาว (*) ซึ่งนักศึกษาผ่านไปแล้ว เทียบกับที่มีในเคสของตัวเอง */
export function selfPerformedRows(students: Student[], works: Workpiece[]): SelfPerformedRow[] {
  const map = byStudent(works);
  return students
    .map((student) => {
      let done = 0;
      let available = 0;
      (map.get(student.id) ?? []).forEach((w) => {
        procList(w).forEach((p, index) => {
          if (!p[2]) return;
          available++;
          if (index <= w.procIndex) done++;
        });
      });
      return { student, done, available };
    })
    .sort((a, b) => b.done - a.done);
}

// ── 7. สรุปบรรทัดเดียวสำหรับหัวหน้าหน้า ────────────────────

export function headline(
  students: Student[],
  works: Workpiece[],
  settings: Settings,
  checkins: CheckIn[] = [],
  updates: ProgressUpdate[] = [],
  now = new Date(),
) {
  const rows = riskRows(students, works, settings, checkins, updates, now);
  const durations = durationByType(works);
  const slowest = durations[0];
  const buckets = bottleneckByStep(works, settings);
  const worst = [...buckets].sort((a, b) => b.count - a.count)[0];

  return {
    atRisk: rows.filter((r) => r.risk === 'high').length,
    watch: rows.filter((r) => r.risk === 'medium').length,
    monthsLeft: rows[0]?.monthsLeft ?? 0,
    slowestType: slowest?.type,
    slowestWeeks: slowest?.medianWeeks ?? 0,
    busiestStep: worst?.progression ?? 0,
    busiestCount: worst?.count ?? 0,
    busiestLabel: worst?.label ?? '',
    typeLabel: slowest ? TYPES[slowest.type].short : '',
  };
}

// ── 8. โปรไฟล์ความสามารถ 6 ด้าน (ใช้กับกราฟแมงมุม) ─────────

export interface ProfileAxis {
  key: string;
  label: string;
  /** 0–100 สำหรับวาดรูป (ตัดที่ 100) */
  value: number;
  /** ตัวเลขจริงเอาไว้แสดง เช่น "2/2" */
  detail: string;
  /** ความคืบหน้า (0–1) ของงานที่กำลังทำอยู่ซึ่งจะนับเข้าด้านนี้เมื่อจบ — เรียงมาก→น้อย ใช้เติมช่องในตารางนับชิ้น */
  partials?: number[];
  /** จำนวนคาบที่ได้คะแนน [3, 1, 0] — มีเมื่อแกนนี้คือหัวข้อประเมิน (ตาราง Radar จะแยกเป็น 3 คอลัมน์) */
  counts?: [number, number, number];
}

const pct = (done: number, need: number) => (need <= 0 ? 100 : Math.min(100, Math.round((done / need) * 100)));

/** ทุกแกนเป็น "% ของเป้าหมายที่ทำได้แล้ว" หน่วยเดียวกันทั้งหมด จึงเทียบกันบนรูปเดียวได้ */
export function profile(works: Workpiece[], settings: Settings, now = new Date()): ProfileAxis[] {
  const rows = caseCount(works, settings);
  const cd = rows.find((r) => r.group === 'CD')!;
  const rpd = rows.find((r) => r.group === 'RPD')!;
  const crown = rows.find((r) => r.group === 'CROWN')!;
  const thisYear = completedInYear(works, academicYear(now), settings).length;

  let selfDone = 0;
  let selfAvailable = 0;
  works.forEach((w) => {
    procList(w).forEach((p, index) => {
      if (!p[2]) return;
      selfAvailable++;
      if (index <= w.procIndex) selfDone++;
    });
  });

  // งานที่ยังไม่จบซึ่งจะนับเข้าด้านนั้นเมื่อเสร็จ — เก็บสัดส่วน step ไว้เติมช่องแบบไม่เต็ม
  const partialsFor = (pred: (w: Workpiece) => boolean, capacity: number) =>
    works
      .filter((w) => !isComplete(w) && pred(w))
      .map((w) => Math.max(0, progression(w)) / (maxProgression(w) || 10))
      .filter((f) => f > 0)
      .sort((a, b) => b - a)
      .slice(0, Math.max(0, capacity));

  return [
    {
      key: 'cd', label: 'CD', value: pct(cd.done, cd.required), detail: `${cd.done}/${cd.required}`,
      partials: partialsFor((w) => w.type === 'CD', cd.required - cd.done),
    },
    {
      key: 'rpd', label: 'RPD', value: pct(rpd.done, rpd.required), detail: `${rpd.done}/${rpd.required}`,
      partials: partialsFor((w) => w.type === 'RPD', rpd.required - rpd.done),
    },
    {
      key: 'crown', label: 'Crown/Bridge', value: pct(crown.done, crown.required), detail: `${crown.done}/${crown.required}`,
      partials: partialsFor((w) => w.type === 'CB' || w.type === 'PC', crown.required - crown.done),
    },
    {
      key: 'postcore',
      label: 'Post-core',
      value: pct(crown.postCoreDone ?? 0, crown.postCoreRequired ?? 0),
      detail: `${crown.postCoreDone ?? 0}/${crown.postCoreRequired ?? 0}`,
      partials: partialsFor((w) => w.type === 'PC', (crown.postCoreRequired ?? 0) - (crown.postCoreDone ?? 0)),
    },
    {
      key: 'year', label: lang === 'en' ? 'Yearly req.' : 'เกณฑ์รายปี', value: pct(thisYear, settings.req.perYear), detail: `${thisYear}/${settings.req.perYear}`,
      partials: partialsFor(() => true, settings.req.perYear - thisYear),
    },
    { key: 'self', label: lang === 'en' ? 'Self-perf. lab' : 'lab ทำเอง', value: pct(selfDone, selfAvailable), detail: `${selfDone}/${selfAvailable}` },
  ];
}

/** ค่าเฉลี่ยของโปรไฟล์ในกลุ่มนักศึกษาชุดหนึ่ง */
export function averageProfile(students: Student[], works: Workpiece[], settings: Settings, now = new Date()): ProfileAxis[] {
  const map = byStudent(works);
  const profiles = students.map((s) => profile(map.get(s.id) ?? [], settings, now));
  if (!profiles.length) return profile([], settings, now);
  return profiles[0].map((axis, i) => ({
    ...axis,
    value: Math.round(profiles.reduce((sum, p) => sum + p[i].value, 0) / profiles.length),
    detail: `${lang === 'en' ? 'avg' : 'เฉลี่ย'} ${Math.round(profiles.reduce((sum, p) => sum + p[i].value, 0) / profiles.length)}%`,
  }));
}

// ── 9. heatmap นักศึกษา × เป้าหมาย ─────────────────────────

export interface HeatRow {
  student: Student;
  cells: ProfileAxis[];
}

export function heatmapRows(students: Student[], works: Workpiece[], settings: Settings, now = new Date()): HeatRow[] {
  const map = byStudent(works);
  return students.map((student) => ({ student, cells: profile(map.get(student.id) ?? [], settings, now) }));
}

// ── 11. แผนที่เคส: หนึ่งจุด = หนึ่งชิ้นงานจริง ──────────────

export interface CaseDot {
  id: string;
  progression: number;
  type: WorkType;
  stale: boolean;
  label: string;
}

/**
 * ทุกจุดคือชิ้นงานจริงหนึ่งชิ้น ไม่มีการเฉลี่ยหรือปัดเศษ
 * ที่ n ระดับนี้ (เกณฑ์หลักหน่วย) การแสดงเป็นหน่วยจริงตรงกว่าการแปลงเป็น %
 */
export function caseDots(
  works: Workpiece[],
  students: Student[],
  settings: Settings,
  type?: WorkType,
): CaseDot[] {
  const nameById = new Map(students.map((s) => [s.id, s]));
  return works
    .filter((w) => !isComplete(w) && (!type || w.type === type))
    .map((w) => {
      const student = nameById.get(w.studentId);
      const p = Math.max(0, progression(w));
      return {
        id: w.id,
        progression: p,
        type: w.type,
        stale: isStale(w, settings),
        label: `${student?.name ?? ''} (${student?.group.replace('TH-', '') ?? ''}) · ${w.detail} · step ${p}`,
      };
    })
    .sort((a, b) => a.progression - b.progression);
}

// ── 12. เส้นสะสม (burn-up): จบไปแล้วเท่าไหร่ เทียบเส้นที่ควรจะเป็น ──

export interface BurnupPoint {
  label: string; // "ส.ค."
  /** ชิ้นงานที่จบสะสมถึงสิ้นเดือนนั้น (null = เดือนยังมาไม่ถึง) */
  actual: number | null;
  /** เส้นเป้า: ถ้าจะให้ทั้งชั้นปีผ่านเกณฑ์รายปี ควรจบสะสมเท่าไหร่ ณ เดือนนั้น */
  target: number;
}

/**
 * แกนเดียว หน่วยเดียวกันทั้งสองเส้น (จำนวนชิ้นงานสะสม) — เทียบกันได้ตรงๆ
 * เส้นเป้าลากตรงจาก 0 ถึง (จำนวนนักศึกษา × เกณฑ์รายปี) ที่เดือนสุดท้ายของปีการศึกษา
 */
export function burnup(students: Student[], works: Workpiece[], settings: Settings, now = new Date()): BurnupPoint[] {
  const startYear = academicYear(now) - 543;
  const goal = students.length * settings.req.perYear;
  const months = 10; // มิ.ย. → มี.ค.
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const completions = works
    .filter((w) => w.completedAt && (settings.perYearCountsAllTypes || (REQ_TYPES as readonly string[]).includes(w.type)))
    .map((w) => new Date(w.completedAt!).getTime());

  return Array.from({ length: months }, (_, i) => {
    const monthStart = new Date(startYear, 5 + i, 1);
    const monthEnd = new Date(startYear, 6 + i, 1).getTime();
    const past = monthStart.getTime() <= thisMonth;
    return {
      label: TH_MONTHS[monthStart.getMonth()],
      actual: past ? completions.filter((t) => t < monthEnd).length : null,
      target: Math.round((goal * (i + 1)) / months),
    };
  });
}
