/**
 * กติกาทั้งหมดของชิ้นงาน — ขั้นตอน · เปอร์เซ็นต์ · เกณฑ์สะสม/รายปี · เคสค้าง · gate
 * หน้าจอต้องเรียกจากที่นี่เท่านั้น (ห้ามคำนวณเองใน routes/) ไม่งั้นแต่ละหน้าจะได้ตัวเลขคนละแบบ
 */

import { CUM_REQ_TYPES, DENTURE_CLASSES, PROCS, RECALL, REQ_TYPES, TYPES, orderOf, type Proc, typeMeta } from './catalog';
import { academicYear, toISODate } from '../lib/date';
import type { Settings, WorkType, Workpiece, StudentGates, GateKey, WaitReason } from './types';

/** ลิสต์ว่างสำหรับประเภทที่ catalog รุ่นนี้ไม่รู้จัก — คนละ object ทุกครั้งไม่ได้ ต้องคงที่ */
const NO_PROCS: Proc[] = [];

/** ลิสต์ procedure ของชิ้นงาน — Recall ใช้ลิสต์สั้น, APD ใช้ลิสต์เดียวกับ CD, PC แยกตาม variant */
export function procList(w: Pick<Workpiece, 'type' | 'variant'>): Proc[] {
  if (w.type === 'RRM' || w.type === 'RFX') return RECALL;
  if (w.type === 'APD') return PROCS.CD;
  if (w.type === 'PC') return w.variant === 'prefab' ? PROCS.PC_PREFAB : PROCS.PC;
  /**
   * ประเภทที่ catalog รุ่นนี้ไม่รู้จัก → ลิสต์ว่าง ห้ามคืน undefined
   *
   * เกิดได้จริงสามทาง: แถวที่ sync ลงมาจากแอปรุ่นใหม่กว่า (เครื่องหนึ่งอัปเดตก่อนอีกเครื่อง) ·
   * แถวที่ถูกแก้มือในตู้กลาง · วันที่ภาคเปลี่ยน catalog แล้วชิ้นงานเก่าอ้างประเภทที่หายไป
   *
   * เดิมคืน undefined แล้ว procList(w)[i] ระเบิดทันที — และเพราะไม่มี ErrorBoundary
   * ทั้งหน้าจอขาวสนิท ไม่มีข้อความ ไม่มีทางออก **และรีโหลดก็ไม่หาย** เพราะแถวยังอยู่ในเครื่อง
   * (ใส่ชิ้นงาน type ที่ไม่รู้จักหนึ่งแถว แล้วเปิดหน้าคนไข้ → #root ว่างเปล่า)
   * ลิสต์ว่างทำให้ทุกฟังก์ชันปลายทางได้คำตอบที่ปลอดภัย: procAt = null · progression = -1
   * · isComplete = false · percentCompleted = 0 — ชิ้นงานโผล่ในรายการแต่ไม่มีความคืบหน้า
   */
  return PROCS[w.type] ?? NO_PROCS;
}

export function maxProgression(w: Pick<Workpiece, 'type' | 'variant'>): number {
  const list = procList(w);
  return list.length ? list[list.length - 1][0] : 0;
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
/**
 * เคสนี้มี "หลักฐานของอาจารย์" ผูกอยู่ไหม — มีแล้วลบไม่ได้ (ให้คืนเคสแทน)
 *
 * หลักฐาน = ใบประเมิน Section II/III ที่อ้างเคสนี้ หรือผลตรวจงานที่มีชื่อผู้ตรวจ
 * ⚠️ ต้องตรงกับ `workpiece_has_teacher_evidence()` ใน `supabase/migrations/0030` — เซิร์ฟเวอร์เป็นคนบังคับจริง
 * ฝั่งแอปเช็คก่อนเพื่อ **ไม่เริ่มลบเลย**: deleteWorkpiece ลบเคส + ประวัติ + รูป + ผู้ป่วยในคราวเดียว
 * ถ้าปล่อยให้เซิร์ฟเวอร์ปฏิเสธทีหลัง รูปงานที่ลบไปแล้วเอากลับมาไม่ได้
 */
export function hasTeacherEvidence(
  workpieceId: string,
  records: { sect2: Array<{ workpieceId?: string }>; sect3: Array<{ workpieceId?: string }>; reviews: Array<{ workpieceId: string; by?: string }> },
): boolean {
  return records.sect2.some((r) => r.workpieceId === workpieceId)
    || records.sect3.some((r) => r.workpieceId === workpieceId)
    || records.reviews.some((r) => r.workpieceId === workpieceId && !!r.by?.trim());
}

export function isActiveWork(w: Workpiece): boolean {
  return !isComplete(w) && !isReturned(w);
}

export function isComplete(w: Workpiece): boolean {
  return progression(w) >= maxProgression(w);
}

/** label ตามรูปแบบ droplist ในชีต: `<prefix>-<progression> <procedure>` เช่น "CD-2 Custom trays" */
export function procLabel(type: WorkType, p: ProcAt): string {
  return `${typeMeta(type).prefix}-${p.progression} ${p.name}`;
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

/** กลุ่ม step ที่กำลังทำ + จำนวนขั้นย่อยที่เสร็จในกลุ่มนั้น (วงแหวนขั้นย่อยบนหน้าแรก) — null เมื่อจบเคสแล้ว */
export function activeStepGroup(w: Workpiece): (StepGroup & { done: number }) | null {
  const g = stepGroups(w).find((x) => x.state === 'active');
  return g ? { ...g, done: g.procs.filter((p) => p.index <= w.procIndex).length } : null;
}

/** จำนวนวันตั้งแต่อัปเดตล่าสุด */
export function daysSinceUpdate(w: Workpiece, now = new Date()): number {
  const then = new Date(w.lastUpdatedAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/**
 * เคสค้าง: ไม่มีการอัปเดตเกิน N วัน และยังเป็นงานที่ทำอยู่จริง
 *
 * ต้องใช้ isActiveWork ไม่ใช่ !isComplete — เคสที่คืนไปแล้วจะไม่มีใครอัปเดตอีกตลอดกาล
 * ถ้าดูแค่ "ยังไม่จบ" มันจะค้างถาวรและไปพองอยู่ในตัวเลข "เคสค้าง" ของหน้าอาจารย์
 * ทุกหน้า (ภาพรวม/ตรวจงาน/วิเคราะห์) โดยไม่มีวันลดลง
 */
export function isStale(w: Workpiece, settings: Settings, now = new Date()): boolean {
  return isActiveWork(w) && !isWaitingForPatient(w, now) && daysSinceUpdate(w, now) >= settings.stale;
}

/* ── รอคนไข้ ─────────────────────────────────────────────────────────────────
   เคสที่หยุดเพราะคนไข้ (ไม่ว่าง · รอ pre-prosth · refer) ไม่ใช่นักศึกษาช้า
   ระหว่างรอ: ไม่นับเป็นค้าง และไม่ทำให้นักศึกษาขึ้น "ต้องตาม" เพราะเงียบ
   หมดเวลารอ (เลยวันนัด หรือไม่มีวันนัดแล้วเกิน WAIT_MAX_DAYS) = กลับมานับตามปกติ
   กันเคสที่ตั้ง "รอ" ทิ้งไว้แล้วลืม */
export const WAIT_REASONS: readonly WaitReason[] = ['busy', 'preprosth', 'refer', 'other'];
/** ไม่ใส่วันนัด รอได้นานสุดกี่วัน */
export const WAIT_MAX_DAYS = 30;
/** เคสเงียบกี่วันแล้วหน้าแรกนักศึกษาถามว่า "คนไข้ไม่ว่างไหม" — ก่อนถึงเกณฑ์ค้างของภาค (ค่าเริ่มต้น 14) */
export const WAIT_NUDGE_DAYS = 10;

export function isWaitingForPatient(w: Workpiece, now = new Date()): boolean {
  if (!w.waitReason || !isActiveWork(w)) return false;
  const today = toISODate(now);
  if (w.waitUntil) return today <= w.waitUntil;
  if (!w.waitSince) return false;
  const since = new Date(`${w.waitSince}T00:00:00`).getTime();
  const todayAt = new Date(`${today}T00:00:00`).getTime();
  return Math.round((todayAt - since) / 86_400_000) < WAIT_MAX_DAYS;
}

/** เคสที่ควรถามนักศึกษาว่าคนไข้ไม่ว่างหรือเปล่า — ยังทำอยู่ · ไม่ได้ตั้งรอ · เงียบมานานพอ */
export function needsWaitNudge(w: Workpiece, now = new Date()): boolean {
  return isActiveWork(w) && !isWaitingForPatient(w, now) && daysSinceUpdate(w, now) >= WAIT_NUDGE_DAYS;
}

/**
 * ลำดับการแสดงรายการ (จาก INTRO ของชีต):
 * minimum requirement ขึ้นก่อน → CD/APD → RPD → APD → Post-core → Crown/Bridge → Recall Rem. → Recall Fixed
 * ผู้ป่วยคนเดียวกันที่มีหลายชิ้นในหมวดเดียวกันให้อยู่ติดกัน
 */
export function sortWorkpieces<T extends Workpiece>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.minimumRequirement !== b.minimumRequirement) return a.minimumRequirement ? -1 : 1;
    if (orderOf(a.type) !== orderOf(b.type)) return orderOf(a.type) - orderOf(b.type);
    if (a.patientId !== b.patientId) return a.patientId.localeCompare(b.patientId);
    if (a.pairId && b.pairId && a.pairId === b.pairId) {
      return a.arch === 'upper' ? -1 : 1;
    }
    return a.acceptedDate.localeCompare(b.acceptedDate);
  });
}

/**
 * ชิ้นงานนับเข้าเกณฑ์เมื่อจบเคส (ถึงขั้นสุดท้ายของประเภทนั้น — Recall จบที่ 3) ตั้งค่าให้นับเกณฑ์
 * และอาจารย์ตรวจรับแล้วว่าเข้าเกณฑ์ (ไม่ติดสถานะ "ยังไม่เข้าเกณฑ์ รอตรวจ")
 */
export function countsTowardRequirement(w: Workpiece): boolean {
  return mayCountTowardRequirement(w) && isComplete(w);
}

/**
 * ถ้าจบเคส ชิ้นนี้จะนับเข้าเกณฑ์สะสมไหม — countsTowardRequirement ลบเงื่อนไข "จบแล้ว" ออก
 * ใช้เลือกว่าเคสที่กำลังทำเคสไหนเติมช่องเกณฑ์ได้ และใช้ทำรายการ "ไม่นับอะไร" ในลิ้นชักหน้าอาจารย์
 */
export function mayCountTowardRequirement(w: Pick<Workpiece, 'type' | 'minimumRequirement' | 'pendingQualification'>): boolean {
  if (w.pendingQualification) return false;
  /* ใช้ CUM_REQ_TYPES (เกณฑ์สะสม) ไม่ใช่ REQ_TYPES (เกณฑ์รายปี) — สองชุดนี้ต่างกันตั้งแต่
     Recall เข้าเกณฑ์สะสมแต่ไม่เข้าเกณฑ์รายปี · เกณฑ์รายปีอ่าน REQ_TYPES ผ่าน countsForYearlyReq */
  return w.minimumRequirement && (CUM_REQ_TYPES as readonly string[]).includes(w.type);
}

/** เหตุที่ชิ้นงานไม่เข้าเกณฑ์สะสมแม้จบแล้ว — 'type' ประเภทที่ไม่อยู่ในเกณฑ์ · 'pending' รอตรวจรับ · 'off' ปิดสวิตช์นับเกณฑ์ */
export type NotCountedReason = 'type' | 'pending' | 'off';

/** ชิ้นงานที่ไม่มีวันนับเข้าเกณฑ์สะสม (ตราบที่ยังตั้งไว้แบบนี้) พร้อมเหตุผล — ตรงข้ามกับ mayCountTowardRequirement พอดี */
export function notCountedPieces(works: Workpiece[]): Array<{ workpiece: Workpiece; reason: NotCountedReason }> {
  return works.flatMap((w) => {
    if (mayCountTowardRequirement(w)) return [];
    const reason: NotCountedReason = requirementFlag(w) === 'never' ? 'type' : w.pendingQualification ? 'pending' : 'off';
    return [{ workpiece: w, reason }];
  });
}

/** % ความคืบหน้าของนักศึกษาหนึ่งคน แยกรายชิ้น — ค่าเฉลี่ยคือ overallPercent ตัวเดียวกับตาราง (ลิ้นชักหน้าอาจารย์) */
export function percentParts(works: Workpiece[]): { rows: Array<{ workpiece: Workpiece; percent: number }>; average: number } {
  return {
    rows: works.map((w) => ({ workpiece: w, percent: percentCompleted(w) })),
    average: overallPercent(works),
  };
}

/**
 * ป้าย "นับเข้าเกณฑ์" บนหน้าเคส — บอกว่าเคสนี้ตั้งให้นับไหม ไม่ได้บอกว่านับแล้ว (ต้องจบเคสก่อน)
 *   'on'    ติ๊กนับ
 *   'off'   ติ๊กไม่นับ — จบแล้วก็ไม่ขึ้นในช่องเกณฑ์สะสม
 *   'never' ประเภทนี้ไม่เข้าเกณฑ์สะสมอยู่แล้ว ติ๊กหรือไม่ก็ไม่นับ
 *           (ทุกประเภทใน catalog นับเกณฑ์แล้ว — เหลือไว้ให้ประเภทที่ catalog รุ่นนี้ไม่รู้จัก)
 * อ่านชุดเดียวกับ countsTowardRequirement — ป้ายกับตัวเลขในช่องเกณฑ์จึงไม่ขัดกัน
 */
export function requirementFlag(w: Pick<Workpiece, 'type' | 'minimumRequirement'>): 'on' | 'off' | 'never' {
  if (!(CUM_REQ_TYPES as readonly string[]).includes(w.type)) return 'never';
  return w.minimumRequirement ? 'on' : 'off';
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
function countRemovable(list: Workpiece[], pick: (w: Workpiece) => boolean, settings: Settings): number {
  const mine = list.filter((w) => pick(w) && w.minimumRequirement);
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

/* ชื่อกลุ่มของ Recall ตั้งให้ตรงกับ WorkType ('RRM' / 'RFX') ตั้งใจ —
   หน้าจอหลายที่หาแถวด้วย `rows.find((r) => r.group === w.type)` อยู่แล้ว (ดู ConfirmSheet) */
export type ReqGroup = 'CD' | 'RPD' | 'CROWN' | 'RRM' | 'RFX';

export interface ReqRow {
  group: ReqGroup;
  label: string;
  /** ป้ายสั้นสำหรับบรรทัดสรุปที่ใส่ชื่อเต็มไม่พอ — อาจารย์อ่านบรรทัดนี้ ห้ามโชว์รหัสกลุ่มดิบ
   *  (เคยขึ้นเป็น "RRM 0/1 · RFX 0/1" ในหน้าตรวจงาน ซึ่งไม่มีใครนอกโค้ดเข้าใจ) */
  short: string;
  color: string;
  done: number;
  required: number;
  complete: boolean;
  /** เฉพาะกลุ่ม CROWN — Post-core ที่นับอยู่ในโควตานี้ */
  postCoreDone?: number;
  postCoreRequired?: number;
  postCoreComplete?: boolean;
  /** เงื่อนไขซ้อนในโควตา — Crown/Bridge ต้องมี Post-core · RPD ต้องมี Co-Cr
   *  แถวครบได้ต่อเมื่อจำนวนรวมถึงและเงื่อนไขนี้ครบด้วย */
  must?: { label: string; done: number; required: number; complete: boolean };
  /** ชนิดงานในแถวนี้ แยกทีละชนิด — บอกว่าชิ้นที่จบ/กำลังทำเป็นชนิดไหน (แถบยังนับรวมกัน) */
  parts?: ReqPart[];
}

export interface ReqPart {
  key: string;
  label: string;
  /** คำขยายสั้นๆ เช่น "เหลือ ≤4 ซี่" */
  hint?: string;
  /** จบแล้วและนับเข้าเกณฑ์ */
  done: number;
  /** กำลังทำอยู่ และถ้าจบจะนับเข้าเกณฑ์ */
  doing: number;
  /** มีเฉพาะชนิดที่บังคับ (Post-core · Co-Cr) */
  required?: number;
}

const isComplicatedApd = (w: Workpiece) => w.type === 'CD' && w.dentureClass === 'complicated-APD';

/**
 * เกณฑ์สะสมตลอดหลักสูตร
 *   CD          = CD หรือ Complicated APD (นับรวมกัน)
 *   RPD         = Co-Cr RPD หรือ Simple APD (นับรวมกัน) โดยต้องมี Co-Cr อย่างน้อย N
 *   Crown/Bridge = Crown/Bridge หรือ Post-core (นับรวมกัน) โดยต้องมี Post-core อย่างน้อย N
 *   Recall สองแถว
 * Co-Cr RPD คือ WorkType 'RPD' ทั้ง Simple และ Complicated RPD · Simple APD คือ WorkType 'APD'
 */
export function caseCount(list: Workpiece[], settings: Settings): ReqRow[] {
  const { req } = settings;
  const recallDone = (type: WorkType) => list.filter((w) => w.type === type && countsTowardRequirement(w)).length;
  const crownDone = list.filter((w) => (w.type === 'CB' || w.type === 'PC') && countsTowardRequirement(w)).length;
  const postCoreDone = list.filter((w) => w.type === 'PC' && countsTowardRequirement(w)).length;
  const cdDone = countRemovable(list, (w) => w.type === 'CD', settings);
  const rpdDone = countRemovable(list, (w) => w.type === 'RPD' || w.type === 'APD', settings);
  const coCrDone = countRemovable(list, (w) => w.type === 'RPD', settings);

  /* ชิ้นที่กำลังทำ = ยังเปิดอยู่และถ้าจบจะนับเกณฑ์ (ชุดเดียวกับ requirementShare) */
  const doing = (pick: (w: Workpiece) => boolean) =>
    list.filter((w) => pick(w) && isActiveWork(w) && mayCountTowardRequirement(w)).length;
  const removablePart = (key: string, label: string, pick: (w: Workpiece) => boolean, extra?: Partial<ReqPart>): ReqPart =>
    ({ key, label, done: countRemovable(list, pick, settings), doing: doing(pick), ...extra });
  const piecePart = (key: string, label: string, pick: (w: Workpiece) => boolean, extra?: Partial<ReqPart>): ReqPart =>
    ({ key, label, done: list.filter((w) => pick(w) && countsTowardRequirement(w)).length, doing: doing(pick), ...extra });

  return [
    {
      group: 'CD',
      label: TYPES.CD.full,
      short: 'CD',
      color: TYPES.CD.color,
      done: cdDone,
      required: req.cd,
      complete: cdDone >= req.cd,
      parts: [
        removablePart('CD', 'CD', (w) => w.type === 'CD' && !isComplicatedApd(w)),
        removablePart('complicated-APD', 'Complicated APD', isComplicatedApd, { hint: DENTURE_CLASSES['complicated-APD'].teeth }),
      ],
    },
    {
      group: 'RPD',
      label: TYPES.RPD.full,
      short: 'RPD',
      color: TYPES.RPD.color,
      done: rpdDone,
      required: req.rpd,
      complete: rpdDone >= req.rpd && coCrDone >= req.coCrMin,
      must: { label: 'Co-Cr RPD', done: coCrDone, required: req.coCrMin, complete: coCrDone >= req.coCrMin },
      parts: [
        removablePart('RPD', 'Co-Cr RPD', (w) => w.type === 'RPD', { required: req.coCrMin }),
        removablePart('APD', 'Simple APD', (w) => w.type === 'APD'),
      ],
    },
    {
      group: 'CROWN',
      label: 'Crown / Bridge (รวม Post-core)',
      short: 'Crown',
      color: TYPES.CB.color,
      done: crownDone,
      required: req.crown,
      complete: crownDone >= req.crown && postCoreDone >= req.postCoreMin,
      postCoreDone,
      postCoreRequired: req.postCoreMin,
      postCoreComplete: postCoreDone >= req.postCoreMin,
      must: { label: 'Post-core', done: postCoreDone, required: req.postCoreMin, complete: postCoreDone >= req.postCoreMin },
      parts: [
        piecePart('PC', 'Post-core', (w) => w.type === 'PC', { required: req.postCoreMin }),
        piecePart('CB', 'Crown / Bridge', (w) => w.type === 'CB'),
      ],
    },
    /* Recall สองแถว — นับรายชิ้นตรง ๆ ไม่ยุบคู่ upper/lower
       เพราะ recall คือการนัดตรวจชิ้นงานที่ใส่ไปแล้ว ไม่ใช่การรับเคสมาเป็นคู่ */
    {
      group: 'RRM',
      label: 'Recall Removable (CD/RPD)',
      short: TYPES.RRM.short,
      color: TYPES.RRM.color,
      done: recallDone('RRM'),
      required: req.recallRemovable,
      complete: recallDone('RRM') >= req.recallRemovable,
    },
    {
      group: 'RFX',
      label: 'Recall Fixed (FDP)',
      short: TYPES.RFX.short,
      color: TYPES.RFX.color,
      done: recallDone('RFX'),
      required: req.recallFixed,
      complete: recallDone('RFX') >= req.recallFixed,
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

/** เคสประเภทนี้นับเข้าแถวเกณฑ์สะสมแถวไหน (null = ไม่นับ) — หน้าจอหาแถวของเคสด้วยตัวนี้ ห้ามเทียบ type เอง */
export function reqGroupOf(type: string): ReqGroup | null {
  return (Object.keys(REQ_GROUP_TYPES) as ReqGroup[]).find((g) => (REQ_GROUP_TYPES[g] as string[]).includes(type)) ?? null;
}

const REQ_GROUP_TYPES: Record<ReqGroup, WorkType[]> = {
  CD: ['CD'], RPD: ['RPD', 'APD'], CROWN: ['CB', 'PC'], RRM: ['RRM'], RFX: ['RFX'],
};

/**
 * เกณฑ์สะสมไปได้แค่ไหน 0–1 โดยนับเคสที่กำลังทำเป็นเศษตามขั้นที่ผ่าน (CD ถึง 6/10 = 0.6 ช่อง)
 * ใช้วางตำแหน่งนักศึกษาในกราฟทั้งชั้นปี — นับแค่ชิ้นที่จบแล้วได้ค่าแค่ 0–8 ทั้งรุ่นกองเป็นเสา
 * done = ตัวเดียวกับ reqDone ของ summarizeStudent · เคสที่กำลังทำเติมเฉพาะช่องที่ยังว่าง
 * เลือกเคสที่ไปไกลสุดก่อน และรับเฉพาะเคสที่จบแล้วจะนับจริง (ชุดเดียวกับช่อง "กำลังทำ" ของ RequirementSlots)
 */
export function requirementShare(list: Workpiece[], settings: Settings): { done: number; partial: number; total: number; share: number } {
  let done = 0;
  let partial = 0;
  let total = 0;
  for (const r of caseCount(list, settings)) {
    const filled = Math.min(r.done, r.required);
    const open = r.required - filled;
    const types = REQ_GROUP_TYPES[r.group];
    partial += list
      .filter((w) => types.includes(w.type) && isActiveWork(w) && mayCountTowardRequirement(w))
      .map(stepFraction)
      .sort((a, b) => b - a)
      .slice(0, open)
      .reduce((s, f) => s + f, 0);
    done += filled;
    total += r.required;
  }
  return { done, partial, total, share: total ? (done + partial) / total : 0 };
}

/**
 * ชิ้นงานนี้ "มีสิทธิ์นับเข้าเกณฑ์รายปี" ไหม — Recall ไม่นับ เว้นแต่ภาคเปิด perYearCountsAllTypes
 * เคสที่ปิดสวิตช์ "นับเข้าเกณฑ์" หรือรอตรวจรับ ไม่นับรายปีเหมือนเกณฑ์สะสม (ภาคยืนยัน)
 * เป็นกติกาเดียวที่ completedInYear · กราฟ burn-up · ตัวประเมินความเสี่ยงใช้ร่วมกัน (ห้ามเขียนซ้ำที่อื่น)
 */
export const countsForYearlyReq = (
  w: Pick<Workpiece, 'type' | 'minimumRequirement' | 'pendingQualification'>,
  settings: Settings,
): boolean =>
  w.minimumRequirement && !w.pendingQualification
  && (settings.perYearCountsAllTypes || (REQ_TYPES as readonly string[]).includes(w.type));

/** ชิ้นงานที่จบเคสในปีการศึกษาที่กำหนด (เกณฑ์รายปี — นับรายชิ้นงาน ไม่ยุบคู่) */
export function completedInYear(list: Workpiece[], year: number, settings: Settings): Workpiece[] {
  return list.filter((w) => {
    if (!isComplete(w) || !w.completedAt) return false;
    if (!countsForYearlyReq(w, settings)) return false;
    /* ชีตระบุปีที่ชิ้นงานนับเข้าไว้เอง (คอลัมน์ for PT502/PT602) — เชื่อชีตก่อน
       เพราะงานที่นำเข้ามีวันจบ = วันนำเข้า ถ้าดูจากวันจบอย่างเดียว งานของปี 5
       จะไหลมากองรวมในปีปัจจุบันหมด */
    if (w.countsForYear) return w.countsForYear === year;
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
    .map((year) => {
      const done = completedInYear(list, year, settings).length;
      return { year, done, required: settings.req.perYear, complete: done >= settings.req.perYear };
    });
}

/**
 * เคสหนึ่งเพิ่งจบ → เกณฑ์ขยับเท่าไหร่ (แผ่นฉลองตอนปิดเคสฝั่งนักศึกษา)
 * before = รายการก่อนจบ · after = รายการเดียวกันที่เคสนั้นจบแล้ว — ใช้ caseCount / caseCountTotals / yearlyRows
 * ตัวเดียวกับหน้าเกณฑ์ ตัวเลขบนแผ่นจะตรงกับหน้าเกณฑ์เสมอ · row = null เมื่อเคสนี้ไม่นับเข้าเกณฑ์สะสม
 */
export function completionImpact(before: Workpiece[], after: Workpiece[], w: Workpiece, settings: Settings, now = new Date()) {
  const group = reqGroupOf(w.type);
  const rowOf = (list: Workpiece[]) => (group ? caseCount(list, settings).find((r) => r.group === group) ?? null : null);
  const rowBefore = rowOf(before);
  const rowAfter = rowOf(after);
  const counted = !!rowAfter && !!rowBefore && rowAfter.done > rowBefore.done;
  const yBefore = yearlyRows(before, settings, now);
  const yAfter = yearlyRows(after, settings, now);
  const days = Math.max(0, Math.round((now.getTime() - new Date(w.acceptedDate).getTime()) / 86_400_000));
  return {
    row: counted ? rowAfter : null,
    rowBefore: rowBefore?.done ?? 0,
    totalsBefore: caseCountTotals(before, settings).done,
    totalsAfter: caseCountTotals(after, settings),
    year: yAfter[yAfter.length - 1],
    yearBefore: yBefore[yBefore.length - 1]?.done ?? 0,
    days,
  };
}

/** gate ทั้งสี่ในสมุด portfolio — เรียงตามลำดับในเล่ม (OSCE ก่อน Design RPD) */
export const GATE_KEYS: GateKey[] = ['sect2Removable', 'sect2Fixed', 'osce', 'designRpd'];
/** ชื่อตามหัวคอลัมน์ในชีต — คงเป็นอังกฤษทั้งสองภาษาเหมือนหัวข้อ radar */
export const GATE_LABELS: Record<GateKey, string> = {
  sect2Removable: 'Sect II Tx. plan · Removable',
  sect2Fixed: 'Sect II Tx. plan · Fixed',
  designRpd: 'Design RPD',
  osce: 'OSCE',
};

/** ข้อที่อาจารย์ติ๊กเองในหน้า "การสอบ" — ที่เหลือระบบติ๊กให้จากใบประเมิน Section II
 *  เรียง OSCE ก่อนให้ตรงลำดับในเล่ม (GATE_KEYS เรียงแบบเดียวกัน หน้าเกณฑ์ฝั่งนักศึกษาจึงตรงกัน) */
export const EXAM_GATE_KEYS: GateKey[] = ['osce', 'designRpd'];

export interface GateRow {
  key: GateKey;
  label: string;
  /** true = ผ่าน · false = ยังไม่ผ่าน · undefined = ยังไม่มีข้อมูล */
  value: boolean | undefined;
}

export function gateRows(gates?: StudentGates): GateRow[] {
  return GATE_KEYS.map((key) => ({ key, label: GATE_LABELS[key], value: gates?.[key] }));
}

export function gatesDone(gates?: StudentGates): number {
  return GATE_KEYS.filter((k) => gates?.[k] === true).length;
}

/** ครบเกณฑ์จบ = ชิ้นงานสะสม + รายปีทุกปี + ข้อกำหนด Sect II / Design RPD (ถ้ามีข้อมูล)
 *  ไม่มีข้อมูล gate เลย (เช่น นศ. เดโม) ถือว่าไม่ติดเงื่อนไขนี้ — ไม่งั้นจะไม่มีใครครบได้เลย */
export function meetsAllRequirements(list: Workpiece[], settings: Settings, now = new Date(), gates?: StudentGates): boolean {
  const gateOk = !gates || Object.keys(gates).length === 0 || gatesDone(gates) === GATE_KEYS.length;
  return caseCountTotals(list, settings).allComplete && yearlyRows(list, settings, now).every((r) => r.complete) && gateOk;
}

/** ความคืบหน้ารวมของนักศึกษาหนึ่งคน (เฉลี่ย % ของทุกชิ้นงาน) */
export function overallPercent(list: Workpiece[]): number {
  if (!list.length) return 0;
  return Math.round(list.reduce((s, w) => s + percentCompleted(w), 0) / list.length);
}

/**
 * สัดส่วนขั้นที่ผ่านแล้ว 0–1 สำหรับ "หลอด/วง" ที่วางคู่กับป้าย "n/m" — ต้องเต็มพอดีที่ขั้นสุดท้าย
 * คนละอย่างกับ percentCompleted() (สูตรของชีต (n+1)/(m+1) ใช้ในใบรายงาน) — ห้ามคำนวณเองในหน้าจอ
 */
export function stepFraction(w: Workpiece): number {
  return Math.max(0, progression(w)) / Math.max(1, maxProgression(w));
}

/** จำนวนขั้นที่ผ่านมาแล้ว (progression 0 = ผ่านขั้นแรกแล้ว 1 ขั้น) — นับตามเลขที่ผู้ใช้เห็น ไม่ใช่ procIndex */
export function stepsPassed(w: Workpiece): number {
  return progression(w) + 1;
}
