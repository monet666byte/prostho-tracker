/**
 * กล่อง "สรุปวันนี้" บนหน้าภาพรวมของอาจารย์
 *
 * แทนกล่องตัวเลข 4 ตัวเดิม — เหลือไม่เกิน 3 บรรทัด เรียง "ต้องทำ → ต้องดู → ข่าวดี"
 * ไฟล์นี้นับอย่างเดียว ข้อความ/ปุ่มอยู่ที่หน้าจอ · ไม่ใช้ AI ตัวเลขทุกตัวมาจากกติกาเดียวกับหน้าอื่น
 * (คนเสี่ยงจาก riskRows · งานค้างจาก isStale · กลุ่มจาก summarizeGroups)
 */
import { daysSinceUpdate, isComplete, isStale, isWaitingForPatient, progression } from './rules';
import type { CheckIn, DentureClass, Settings, Student, WaitReason, WorkType, Workpiece } from './types';
import type { RiskLevel } from './analytics';

export interface TodayInput {
  /** นักศึกษาในขอบเขตที่สรุป (กลุ่มตัวเอง หรือทั้งชั้นปี) — งาน/คาบของคนนอกลิสต์ไม่ถูกนับ */
  students: Student[];
  works: Workpiece[];
  checkins: CheckIn[];
  settings: Settings;
  /** ระดับเสี่ยงต่อนักศึกษา (จาก riskRows) — ส่งมาทั้งชุดได้ ตัวนี้กรองตามขอบเขตเอง · reason = ข้อความเหตุผลจาก riskRows */
  risk: Array<{ studentId: string; risk: RiskLevel; reason?: string }>;
  /** กลุ่มในชั้นปี (จาก summarizeGroups) — ใช้เฉพาะสรุปทั้งชั้นปี */
  groups?: Array<{ code: string; year: number; students: Array<{ student: { id: string } }> }>;
  now?: Date;
}

/** คนที่มีคาบรอประเมิน — หนึ่งแถวต่อคน */
export interface PendingPerson {
  studentId: string;
  /** จำนวนคาบที่รอ */
  count: number;
  /** คาบที่รอเก่าสุดผ่านมากี่วัน */
  oldestDays: number;
  /** กิจกรรมของคาบที่รอล่าสุด — ข้อความที่เก็บไว้ตามที่นักศึกษาเลือก (ไม่แปล) */
  activities: string[];
}

/** คนที่ต้องตาม — หนึ่งแถวต่อคน พร้อมงานค้างของคนนั้น (อาจไม่มี ถ้าเสี่ยงเพราะเหตุอื่น) */
export interface FollowUpPerson {
  studentId: string;
  risk: Exclude<RiskLevel, 'ok'>;
  reason: string;
  stale: Array<{ workId: string; type: WorkType; dentureClass?: DentureClass; progression: number; days: number }>;
}

export interface TodaySummary {
  /** นักศึกษาที่มีคาบรอประเมิน (นับคน — หน่วยเดียวกับเลขที่เมนูข้าง) · = pendingList.length เสมอ */
  pendingPeople: number;
  /** รายคนของ pendingPeople เรียงคาบเก่าสุดก่อน */
  pendingList: PendingPerson[];
  /** รายคนของ followUp เรียงเสี่ยงสูงก่อน แล้วงานค้างนานสุดก่อน */
  followUpList: FollowUpPerson[];
  /** คาบรอประเมินที่เก่าที่สุด ผ่านมากี่วัน (ไม่มีคาบรอ = 0) */
  oldestPendingDays: number;
  /** คนที่ต้องตาม = เสี่ยงสูง + จับตา — หน้าจอแสดงสองสี แดง = ต้องตาม */
  followUp: number;
  stale: number;
  /** step ที่งานค้างกองมากสุด + ประเภทที่เจอบ่อยสุดใน step นั้น (ไว้เปิดกราฟให้ตรง) · ไม่มีงานค้าง = null */
  staleTop: { progression: number; type: WorkType } | null;
  /** กลุ่มที่ต้องตามตั้งแต่ ⅓ ของกลุ่ม (isFollowUpGroup) เรียงคนต้องตามมากสุดก่อน · เท่ากันคงลำดับกลุ่มเดิม */
  followUpGroups: Array<{ code: string; year: number; followUp: number; size: number }>;
  /** เคสที่หยุดรอคนไข้อยู่ (ไม่นับเป็นค้าง/ต้องตาม) — นัดใกล้สุดก่อน · ไม่มีนัดไว้ท้าย */
  waitingList: Array<{ studentId: string; workId: string; type: WorkType; dentureClass?: DentureClass; reason: WaitReason; until?: string }>;
  /** ชิ้นงานที่จบใน 7 วันล่าสุด — ไม่นับงานจากชีต (completedAt ของมันคือวันนำเข้า ไม่ใช่วันจบจริง) */
  doneThisWeek: number;
  /** มีเรื่องที่อาจารย์ต้องทำหรือต้องดู — ไม่มี = "วันนี้ไม่มีอะไรน่าห่วง" */
  needsAttention: boolean;
}

/**
 * กลุ่มที่ต้องจับตา = คนต้องตามตั้งแต่ 1 ใน 3 ของกลุ่ม (กลุ่ม 8 คน = 3 คนขึ้นไป)
 * ใช้ตัวเดียวกันทั้งช่องกลุ่มสีแดงอิฐบนหน้าแรกและกล่อง "ต้องดูในชั้นปี"
 * ไม่ใช้ % เฉลี่ยเคสในมือ — ต้นปีทุกกลุ่มต่ำหมด และกลุ่มที่เพิ่งรับเคสใหม่ % ร่วงทั้งที่ไม่ได้ช้า
 */
export function isFollowUpGroup(followUp: number, size: number): boolean {
  return size > 0 && followUp * 3 >= size;
}
const DAY = 86_400_000;

export function todaySummary(input: TodayInput): TodaySummary {
  const { settings, now = new Date() } = input;
  const ids = new Set(input.students.map((s) => s.id));
  const works = input.works.filter((w) => ids.has(w.studentId));

  const pending = input.checkins.filter((c) => c.status === 'pending' && ids.has(c.studentId));
  const ageOf = (c: CheckIn) => {
    const t = Date.parse(c.date);
    return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY) : 0;
  };
  const oldestPendingDays = pending.reduce((mx, c) => Math.max(mx, ageOf(c)), 0);
  const pendingBy = new Map<string, CheckIn[]>();
  pending.forEach((c) => pendingBy.set(c.studentId, [...(pendingBy.get(c.studentId) ?? []), c]));
  const pendingList: PendingPerson[] = [...pendingBy.entries()]
    .map(([studentId, list]) => {
      const latest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
      return { studentId, count: list.length, oldestDays: Math.max(...list.map(ageOf)), activities: latest.activities ?? [] };
    })
    .sort((a, b) => b.oldestDays - a.oldestDays || a.studentId.localeCompare(b.studentId));
  const pendingPeople = pendingList.length;

  const staleWorks = works.filter((w) => isStale(w, settings, now));

  /* คนเดียวมีหลายแถวในรายการเสี่ยงได้ไม่ควรเกิด แต่กันไว้ — นับครั้งเดียว เอาระดับที่สูงกว่า */
  const riskBy = new Map<string, { risk: Exclude<RiskLevel, 'ok'>; reason: string }>();
  input.risk.forEach((r) => {
    if (r.risk === 'ok' || !ids.has(r.studentId)) return;
    const prev = riskBy.get(r.studentId);
    if (!prev || (prev.risk === 'medium' && r.risk === 'high')) riskBy.set(r.studentId, { risk: r.risk, reason: r.reason ?? '' });
  });
  const followUpList: FollowUpPerson[] = [...riskBy.entries()]
    .map(([studentId, r]) => ({
      studentId, risk: r.risk, reason: r.reason,
      stale: staleWorks
        .filter((w) => w.studentId === studentId)
        .map((w) => ({ workId: w.id, type: w.type, dentureClass: w.dentureClass, progression: Math.max(0, progression(w)), days: daysSinceUpdate(w, now) }))
        .sort((a, b) => b.days - a.days),
    }))
    .sort((a, b) => (a.risk === b.risk ? 0 : a.risk === 'high' ? -1 : 1)
      || (b.stale[0]?.days ?? 0) - (a.stale[0]?.days ?? 0)
      || a.studentId.localeCompare(b.studentId));
  const followUp = followUpList.length;
  let staleTop: TodaySummary['staleTop'] = null;
  if (staleWorks.length) {
    const byStep = new Map<number, Workpiece[]>();
    /* ยังไม่เริ่ม (-1) ลงช่อง step 0 — แบบเดียวกับกราฟคงค้าง (bottleneckByStep) กดแล้วไปเจอช่องเดียวกัน */
    staleWorks.forEach((w) => {
      const p = Math.max(0, progression(w));
      byStep.set(p, [...(byStep.get(p) ?? []), w]);
    });
    // เท่ากัน → step ต่ำกว่าก่อน (ผลคงที่ ไม่สลับไปมาตามลำดับข้อมูล)
    const [step, list] = [...byStep.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0];
    const byType = new Map<WorkType, number>();
    list.forEach((w) => byType.set(w.type, (byType.get(w.type) ?? 0) + 1));
    const type = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    staleTop = { progression: step, type };
  }

  const followUpGroups = (input.groups ?? [])
    .map((g) => ({
      code: g.code, year: g.year, size: g.students.length,
      followUp: g.students.filter((s) => riskBy.has(s.student.id)).length,
    }))
    .filter((g) => isFollowUpGroup(g.followUp, g.size))
    .sort((a, b) => b.followUp - a.followUp);

  const waitingList: TodaySummary['waitingList'] = works
    .filter((w) => isWaitingForPatient(w, now))
    .map((w) => ({ studentId: w.studentId, workId: w.id, type: w.type, dentureClass: w.dentureClass, reason: w.waitReason!, until: w.waitUntil }))
    .sort((a, b) => (a.until ?? '9999').localeCompare(b.until ?? '9999') || a.studentId.localeCompare(b.studentId));

  const weekAgo = now.getTime() - 7 * DAY;
  const doneThisWeek = works.filter((w) => {
    if (w.fromSheet || !w.completedAt || !isComplete(w)) return false;
    const t = Date.parse(w.completedAt);
    return t >= weekAgo && t <= now.getTime();
  }).length;

  return {
    pendingPeople, pendingList, followUpList, oldestPendingDays, followUp, stale: staleWorks.length, staleTop, followUpGroups, waitingList, doneThisWeek,
    needsAttention: pendingPeople > 0 || followUp > 0 || staleWorks.length > 0 || followUpGroups.length > 0,
  };
}
