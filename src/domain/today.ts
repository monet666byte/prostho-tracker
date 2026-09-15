/**
 * กล่อง "สรุปวันนี้" บนหน้าภาพรวมของอาจารย์ (ผู้ใช้เลือก mock 15 ก.ย. 69)
 *
 * แทนกล่องตัวเลข 4 ตัวเดิม — เหลือไม่เกิน 3 บรรทัด เรียง "ต้องทำ → ต้องดู → ข่าวดี"
 * ไฟล์นี้นับอย่างเดียว ข้อความ/ปุ่มอยู่ที่หน้าจอ · ไม่ใช้ AI ตัวเลขทุกตัวมาจากกติกาเดียวกับหน้าอื่น
 * (คนเสี่ยงจาก riskRows · งานค้างจาก isStale · % กลุ่มจาก summarizeGroups)
 */
import { isComplete, isStale, progression } from './rules';
import type { CheckIn, Settings, Student, WorkType, Workpiece } from './types';
import type { RiskLevel } from './analytics';

export interface TodayInput {
  /** นักศึกษาในขอบเขตที่สรุป (กลุ่มตัวเอง หรือทั้งชั้นปี) — งาน/คาบของคนนอกลิสต์ไม่ถูกนับ */
  students: Student[];
  works: Workpiece[];
  checkins: CheckIn[];
  settings: Settings;
  /** ระดับเสี่ยงต่อนักศึกษา (จาก riskRows) — ส่งมาทั้งชุดได้ ตัวนี้กรองตามขอบเขตเอง */
  risk: Array<{ studentId: string; risk: RiskLevel }>;
  /** % ต่อกลุ่ม (จาก summarizeGroups) — ใช้เฉพาะสรุปทั้งชั้นปี */
  groups?: Array<{ code: string; percent: number; year: number }>;
  now?: Date;
}

export interface TodaySummary {
  /** นักศึกษาที่มีคาบรอประเมิน (นับคน — หน่วยเดียวกับเลขที่เมนูข้าง) */
  pendingPeople: number;
  /** คาบรอประเมินที่เก่าที่สุด ผ่านมากี่วัน (ไม่มีคาบรอ = 0) */
  oldestPendingDays: number;
  highRisk: number;
  stale: number;
  /** step ที่งานค้างกองมากสุด + ประเภทที่เจอบ่อยสุดใน step นั้น (ไว้เปิดกราฟให้ตรง) · ไม่มีงานค้าง = null */
  staleTop: { progression: number; type: WorkType } | null;
  /** กลุ่มที่ต่ำกว่าเกณฑ์ 55% เรียงจากต่ำสุด */
  lowGroups: Array<{ code: string; percent: number; year: number }>;
  /** ชิ้นงานที่จบใน 7 วันล่าสุด — ไม่นับงานจากชีต (completedAt ของมันคือวันนำเข้า ไม่ใช่วันจบจริง) */
  doneThisWeek: number;
  /** มีเรื่องที่อาจารย์ต้องทำหรือต้องดู — ไม่มี = "วันนี้ไม่มีอะไรน่าห่วง" */
  needsAttention: boolean;
}

export const LOW_GROUP_PERCENT = 55;
const DAY = 86_400_000;

export function todaySummary(input: TodayInput): TodaySummary {
  const { settings, now = new Date() } = input;
  const ids = new Set(input.students.map((s) => s.id));
  const works = input.works.filter((w) => ids.has(w.studentId));

  const pending = input.checkins.filter((c) => c.status === 'pending' && ids.has(c.studentId));
  const pendingPeople = new Set(pending.map((c) => c.studentId)).size;
  const oldestPendingDays = pending.reduce((mx, c) => {
    const t = Date.parse(c.date);
    return Number.isFinite(t) ? Math.max(mx, Math.floor((now.getTime() - t) / DAY)) : mx;
  }, 0);

  const highRisk = new Set(input.risk.filter((r) => r.risk === 'high' && ids.has(r.studentId)).map((r) => r.studentId)).size;

  const staleWorks = works.filter((w) => isStale(w, settings, now));
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

  const lowGroups = (input.groups ?? [])
    .filter((g) => g.percent < LOW_GROUP_PERCENT)
    .sort((a, b) => a.percent - b.percent);

  const weekAgo = now.getTime() - 7 * DAY;
  const doneThisWeek = works.filter((w) => {
    if (w.fromSheet || !w.completedAt || !isComplete(w)) return false;
    const t = Date.parse(w.completedAt);
    return t >= weekAgo && t <= now.getTime();
  }).length;

  return {
    pendingPeople, oldestPendingDays, highRisk, stale: staleWorks.length, staleTop, lowGroups, doneThisWeek,
    needsAttention: pendingPeople > 0 || highRisk > 0 || staleWorks.length > 0 || lowGroups.length > 0,
  };
}
