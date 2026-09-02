/** กฎธุรกิจทั้งหมด — อ้างอิงหัวข้อ "กฎธุรกิจ" ใน handoff */

import { DENTURE_CLASSES, ORDER, PROCS, RECALL, REQ_TYPES, TYPES, type Proc } from './catalog';
import { academicYear } from '../lib/date';
import type { Settings, WorkType, Workpiece } from './types';

/** ลิสต์ procedure ของชิ้นงาน — Recall ใช้ลิสต์สั้น, APD ใช้ลิสต์เดียวกับ CD, PC แยกตาม variant */
export function procList(w: Pick<Workpiece, 'type' | 'variant'>): Proc[] {
  if (w.type === 'RRM' || w.type === 'RFX') return RECALL;
  if (w.type === 'APD') return PROCS.CD;
  if (w.type === 'PC') return w.variant === 'prefab' ? PROCS.PC_PREFAB : PROCS.PC;
  return PROCS[w.type];
}

export function maxProgression(w: Pick<Workpiece, 'type' | 'variant'>): number {
  const list = procList(w);
  return list[list.length - 1][0];
}

export interface ProcAt {
  index: number;
  name: string;
  progression: number;
  selfPerformed: boolean;
}

/** procedure ที่ index ใดๆ (null ถ้าเกินลิสต์) */
export function procAt(w: Pick<Workpiece, 'type' | 'variant'>, index: number): ProcAt | null {
  const p = procList(w)[index];
  if (!p) return null;
  return { index, name: p[1], progression: p[0], selfPerformed: !!p[2] };
}

/** procedure ล่าสุดที่ผ่านแล้ว — null ถ้ายังไม่เริ่ม */
export function currentProc(w: Workpiece): ProcAt | null {
  return w.procIndex < 0 ? null : procAt(w, w.procIndex);
}

/** procedure ถัดไปที่ต้องทำ — null ถ้าจบเคสแล้ว */
export function nextProc(w: Workpiece): ProcAt | null {
  return procAt(w, w.procIndex + 1);
}

/** progression ปัจจุบัน (-1 = ยังไม่เริ่ม) */
export function progression(w: Workpiece): number {
  const c = currentProc(w);
  return c ? c.progression : -1;
}

/** % completed = (progression + 1) / (maxProgression + 1) — ตรงกับคอลัมน์ % Completed ในชีต */
export function percentCompleted(w: Workpiece): number {
  const prog = progression(w);
  if (prog < 0) return 0;
  return Math.round(((prog + 1) / (maxProgression(w) + 1)) * 100);
}

/** คืนเคสแล้ว — ไม่ใช่งานที่ทำอยู่ และไม่นับเข้าเกณฑ์ แต่ยังแสดงในรายการ (ขีดฆ่า) */
export function isReturned(w: Pick<Workpiece, 'returned'>): boolean {
  return !!w.returned;
}

/** งานที่ "กำลังทำอยู่จริง" — ยังไม่จบ และไม่ได้คืนเคส (ใช้แทน !isComplete ทุกที่ที่นับภาระงาน) */
export function isActiveWork(w: Workpiece): boolean {
  return !isComplete(w) && !isReturned(w);
}

export function isComplete(w: Workpiece): boolean {
  return progression(w) >= maxProgression(w);
}

/** label ตามรูปแบบ droplist ในชีต: `<prefix>-<progression> <procedure>` เช่น "CD-2 Custom trays" */
export function procLabel(type: WorkType, p: ProcAt): string {
  return `${TYPES[type].prefix}-${p.progression} ${p.name}`;
}

export interface StepGroup {
  progression: number;
  procs: ProcAt[];
  hasSelf: boolean;
  /** สถานะเทียบกับ procIndex ปัจจุบัน */
  state: 'done' | 'active' | 'todo';
}

/** จัดกลุ่ม procedure ตาม progression 0–10 สำหรับ timeline ใน S3 */
export function stepGroups(w: Workpiece): StepGroup[] {
  const list = procList(w);
  const byProg = new Map<number, ProcAt[]>();
  list.forEach((p, index) => {
    const arr = byProg.get(p[0]) ?? [];
    arr.push({ index, name: p[1], progression: p[0], selfPerformed: !!p[2] });
    byProg.set(p[0], arr);
  });
  const next = w.procIndex + 1; // index ของ procedure ถัดไปที่ต้องทำ
  return [...byProg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([prog, procs]) => {
      const first = procs[0].index;
      const last = procs[procs.length - 1].index;
      // กลุ่มที่ผ่านครบแล้ว / กลุ่มที่ procedure ถัดไปอยู่ / กลุ่มที่ยังไม่ถึง
      const state: StepGroup['state'] = last < next ? 'done' : first <= next ? 'active' : 'todo';
      return { progression: prog, procs, hasSelf: procs.some((p) => p.selfPerformed), state };
    });
}

/** จำนวนวันตั้งแต่อัปเดตล่าสุด */
export function daysSinceUpdate(w: Workpiece, now = new Date()): number {
  const then = new Date(w.lastUpdatedAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/** เคสค้าง: ไม่มีการอัปเดตเกิน N วัน และยังไม่จบเคส */
export function isStale(w: Workpiece, settings: Settings, now = new Date()): boolean {
  return !isComplete(w) && daysSinceUpdate(w, now) >= settings.stale;
}

/**
 * ลำดับการแสดงรายการ (จาก INTRO ของชีต):
 * minimum requirement ขึ้นก่อน → CD/APD → RPD → APD → Post-core → Crown/Bridge → Recall Rem. → Recall Fixed
 * ผู้ป่วยคนเดียวกันที่มีหลายชิ้นในหมวดเดียวกันให้อยู่ติดกัน
 */
export function sortWorkpieces<T extends Workpiece>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.minimumRequirement !== b.minimumRequirement) return a.minimumRequirement ? -1 : 1;
    if (ORDER[a.type] !== ORDER[b.type]) return ORDER[a.type] - ORDER[b.type];
    if (a.patientId !== b.patientId) return a.patientId.localeCompare(b.patientId);
    if (a.pairId && b.pairId && a.pairId === b.pairId) {
      return a.arch === 'upper' ? -1 : 1;
    }
    return a.acceptedDate.localeCompare(b.acceptedDate);
  });
}

/**
 * ชิ้นงานนับเข้าเกณฑ์เมื่อจบเคส (progression 10) ตั้งค่าให้นับเกณฑ์
 * และอาจารย์ตรวจรับแล้วว่าเข้าเกณฑ์ (ไม่ติดสถานะ "ยังไม่เข้าเกณฑ์ รอตรวจ")
 */
export function countsTowardRequirement(w: Workpiece): boolean {
  if (w.pendingQualification) return false;
  return w.minimumRequirement && isComplete(w) && (REQ_TYPES as readonly string[]).includes(w.type);
}

/**
 * Count CDA — ตามคอลัมน์ในชีต tab "Case CD"
 * นับจำนวน arch ของผู้ป่วยรายนั้นที่เป็น CD หรืองาน Complicated (APD/RPD)
 */
export function countCDA(pieces: Workpiece[]): number {
  return pieces.filter((w) => w.dentureClass && DENTURE_CLASSES[w.dentureClass].countsCDA).length;
}

/**
 * นับ "เคส" ของงานถอดได้ — คู่ upper/lower ที่มี pairId เดียวกันนับเป็น 1 เคส
 * และจะนับก็ต่อเมื่อจบครบทั้งคู่ (ถ้า settings.pairCountsAsOne = true)
 *
 * ข้อนี้ยังรอภาควิชายืนยัน — ชีตจริง tab "Case CD" คอลัมน์ Count CDA ให้ค่า 1–2 ต่อผู้ป่วย
 * ซึ่งเอียงไปทางนับรายแถว จึงทำเป็น setting ให้สลับได้
 */
function countRemovable(list: Workpiece[], type: WorkType, settings: Settings): number {
  const mine = list.filter((w) => w.type === type && w.minimumRequirement);
  if (!settings.pairCountsAsOne) return mine.filter(countsTowardRequirement).length;

  const singles = mine.filter((w) => !w.pairId);
  const pairs = new Map<string, Workpiece[]>();
  mine.forEach((w) => {
    if (!w.pairId) return;
    pairs.set(w.pairId, [...(pairs.get(w.pairId) ?? []), w]);
  });

  const donePairs = [...pairs.values()].filter((g) => g.every((x) => isComplete(x) && !x.pendingQualification)).length;
  return donePairs + singles.filter(countsTowardRequirement).length;
}

export type ReqGroup = 'CD' | 'RPD' | 'CROWN';

export interface ReqRow {
  group: ReqGroup;
  label: string;
  color: string;
  done: number;
  required: number;
  complete: boolean;
  /** เฉพาะกลุ่ม CROWN — Post-core ที่นับอยู่ในโควตานี้ */
  postCoreDone?: number;
  postCoreRequired?: number;
  postCoreComplete?: boolean;
}

/** เกณฑ์สะสมตลอดหลักสูตร — CD · RPD · Crown/Bridge (โดยต้องมี Post-core อย่างน้อย N) */
export function caseCount(list: Workpiece[], settings: Settings): ReqRow[] {
  const { req } = settings;
  const crownDone = list.filter((w) => (w.type === 'CB' || w.type === 'PC') && countsTowardRequirement(w)).length;
  const postCoreDone = list.filter((w) => w.type === 'PC' && countsTowardRequirement(w)).length;

  return [
    {
      group: 'CD',
      label: TYPES.CD.full,
      color: TYPES.CD.color,
      done: countRemovable(list, 'CD', settings),
      required: req.cd,
      complete: countRemovable(list, 'CD', settings) >= req.cd,
    },
    {
      group: 'RPD',
      label: TYPES.RPD.full,
      color: TYPES.RPD.color,
      done: countRemovable(list, 'RPD', settings),
      required: req.rpd,
      complete: countRemovable(list, 'RPD', settings) >= req.rpd,
    },
    {
      group: 'CROWN',
      label: 'Crown / Bridge (รวม Post-core)',
      color: TYPES.CB.color,
      done: crownDone,
      required: req.crown,
      complete: crownDone >= req.crown && postCoreDone >= req.postCoreMin,
      postCoreDone,
      postCoreRequired: req.postCoreMin,
      postCoreComplete: postCoreDone >= req.postCoreMin,
    },
  ];
}

export function caseCountTotals(list: Workpiece[], settings: Settings) {
  const rows = caseCount(list, settings);
  return {
    rows,
    done: rows.reduce((s, r) => s + Math.min(r.done, r.required), 0),
    required: rows.reduce((s, r) => s + r.required, 0),
    allComplete: rows.every((r) => r.complete),
  };
}

/** ชิ้นงานที่จบเคสในปีการศึกษาที่กำหนด (เกณฑ์รายปี — นับรายชิ้นงาน ไม่ยุบคู่) */
export function completedInYear(list: Workpiece[], year: number, settings: Settings): Workpiece[] {
  return list.filter((w) => {
    if (!isComplete(w) || !w.completedAt) return false;
    if (!settings.perYearCountsAllTypes && !(REQ_TYPES as readonly string[]).includes(w.type)) return false;
    return academicYear(w.completedAt) === year;
  });
}

export interface YearlyRow {
  year: number;
  done: number;
  required: number;
  complete: boolean;
}

/** สรุปเกณฑ์รายปีของทุกปีการศึกษาที่มีข้อมูล (อย่างน้อยปีปัจจุบัน) */
export function yearlyRows(list: Workpiece[], settings: Settings, now = new Date()): YearlyRow[] {
  const current = academicYear(now);
  /**
   * ต้องไล่ "ทุกปีตั้งแต่ปีแรกที่เริ่มมีงาน จนถึงปีปัจจุบัน" ไม่ใช่เฉพาะปีที่มีงานจบ
   *
   * บั๊กเดิม: รายชื่อปีสร้างจากปีที่มี completedAt เท่านั้น ปีที่จบ 0 ชิ้นจึงหายไปจากการตรวจ
   * → นักศึกษาที่ปี 2568 จบ 0 ชิ้น แล้วไปเร่งจบ 6 ชิ้นในปี 2569 ระบบสรุปว่า "ครบเกณฑ์"
   *   ทั้งที่เกณฑ์คือทุกปีต้องจบอย่างน้อย perYear ชิ้น — ปีที่ว่างคือเคสที่กฎนี้มีไว้จับพอดี
   */
  const marks: number[] = [current];
  list.forEach((w) => {
    if (w.completedAt) marks.push(academicYear(w.completedAt));
    if (w.acceptedDate) marks.push(academicYear(w.acceptedDate));
  });
  const first = Math.min(...marks);
  const years: number[] = [];
  for (let y = first; y <= current; y++) years.push(y);
  return years
    .sort((a, b) => a - b)
    .map((year) => {
      const done = completedInYear(list, year, settings).length;
      return { year, done, required: settings.req.perYear, complete: done >= settings.req.perYear };
    });
}

/** ครบเกณฑ์จริงต้องผ่านทั้งเกณฑ์สะสมและเกณฑ์รายปีทุกปี */
export function meetsAllRequirements(list: Workpiece[], settings: Settings, now = new Date()): boolean {
  return caseCountTotals(list, settings).allComplete && yearlyRows(list, settings, now).every((r) => r.complete);
}

/** ความคืบหน้ารวมของนักศึกษาหนึ่งคน (เฉลี่ย % ของทุกชิ้นงาน) */
export function overallPercent(list: Workpiece[]): number {
  if (!list.length) return 0;
  return Math.round(list.reduce((s, w) => s + percentCompleted(w), 0) / list.length);
}
