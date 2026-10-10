/**
 * รายงานประจำเดือน (หน้าพิมพ์ /teacher/report) — ทั้งชั้นปี หรือกลุ่มเดียว
 *
 * ไฟล์นี้นับอย่างเดียว · ใช้กติกาตัวเดียวกับหน้าแรกทุกตัว ตัวเลขบนกระดาษจึงตรงกับในแอป
 *   ต้องตาม / รอประเมิน / งานค้าง / กลุ่มที่ต้องตามเยอะ → todaySummary
 *   จบเคสรายเดือน → throughputByMonth (ไม่นับงานจากชีต)
 *   คงค้างตาม step → bottleneckByStep
 * ไม่มีชื่อหรือ HN ผู้ป่วยในผลลัพธ์ — รายงานนี้พิมพ์ไปวางในห้องประชุมได้
 */
import { hasRealCompletionDate, throughputByMonth, bottleneckByStep, type MonthPoint, type RiskLevel, type StepBucket } from './analytics';
import { daysSinceUpdate, isActiveWork, isStale, progression } from './rules';
import { todaySummary, type TodayInput, type TodaySummary } from './today';
import type { CheckIn, Settings, Student, WorkType, Workpiece } from './types';

export interface MonthlyReportInput {
  /** นักศึกษาในขอบเขต (ทั้งชั้นปี หรือสมาชิกกลุ่มเดียว) */
  students: Student[];
  works: Workpiece[];
  checkins: CheckIn[];
  settings: Settings;
  risk: Array<{ studentId: string; risk: RiskLevel; reason?: string }>;
  /** กลุ่มในชั้นปี — ใส่เฉพาะรายงานทั้งชั้นปี (เหมือน todaySummary) */
  groups?: TodayInput['groups'];
  /** เดือนที่รายงาน (ค.ศ. · 0–11) */
  year: number;
  month: number;
  now?: Date;
}

export interface MonthlyReport {
  /** ชิ้นงานที่จบในเดือนที่เลือก (ไม่นับงานจากชีต) */
  completedInMonth: number;
  /** ชิ้นงานที่กำลังทำ ณ วันที่สร้างรายงาน */
  active: number;
  /** สรุปแบบเดียวกับหน้าแรก ณ วันที่สร้างรายงาน */
  today: TodaySummary;
  /** ประเภทที่ใช้วาดกราฟคงค้าง — ประเภทที่งานค้างกองมากสุด ไม่มีงานค้าง = ประเภทที่กำลังทำมากสุด */
  bottleneckType: WorkType | null;
  bottleneck: StepBucket[];
  /** จบเคสรายเดือนตลอดปีการศึกษาของเดือนที่เลือก (มิ.ย. → มี.ค.) */
  months: MonthPoint[];
  /** key ของเดือนที่เลือกใน months (ไว้ระบายแท่ง) */
  monthKey: string;
  /** งานค้างนานสุด 5 ชิ้น — ไม่มีข้อมูลผู้ป่วย */
  longest: Array<{ studentId: string; type: WorkType; progression: number; days: number }>;
}

export function monthlyReport(input: MonthlyReportInput): MonthlyReport {
  const { settings, year, month, now = new Date() } = input;
  const ids = new Set(input.students.map((s) => s.id));
  const works = input.works.filter((w) => ids.has(w.studentId));

  const completedInMonth = works.filter((w) => {
    if (!hasRealCompletionDate(w)) return false;
    const d = new Date(w.completedAt!);
    return d.getFullYear() === year && d.getMonth() === month;
  }).length;

  const active = works.filter(isActiveWork);
  const today = todaySummary({
    students: input.students, works, checkins: input.checkins, settings, risk: input.risk, groups: input.groups, now,
  });

  let bottleneckType: WorkType | null = today.staleTop?.type ?? null;
  if (!bottleneckType && active.length) {
    const byType = new Map<WorkType, number>();
    active.forEach((w) => byType.set(w.type, (byType.get(w.type) ?? 0) + 1));
    bottleneckType = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const bottleneck = bottleneckType ? bottleneckByStep(works, settings, bottleneckType) : [];

  /* แกนเดือนอิงปีการศึกษาของเดือนที่เลือก — เลือกเดือนในปีก่อนก็ได้แกนของปีนั้น
     วันอ้างอิงไม่เกินวันนี้ เดือนหลังจากนี้จึงยังเป็นช่องว่าง (future) */
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
  const asOf = endOfMonth < now ? endOfMonth : now;
  const months = throughputByMonth(works, asOf);

  const longest = works
    .filter((w) => isStale(w, settings, now))
    .map((w) => ({ studentId: w.studentId, type: w.type, progression: Math.max(0, progression(w)), days: daysSinceUpdate(w, now) }))
    .sort((a, b) => b.days - a.days || a.studentId.localeCompare(b.studentId))
    .slice(0, 5);

  return {
    completedInMonth, active: active.length, today, bottleneckType, bottleneck,
    months, monthKey: `${year}-${month}`, longest,
  };
}

/** เดือนที่เลือกพิมพ์ได้ — เดือนนี้ย้อนหลัง n เดือน (ใหม่สุดก่อน) */
export function reportMonths(now = new Date(), n = 12): Array<{ year: number; month: number }> {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
}
