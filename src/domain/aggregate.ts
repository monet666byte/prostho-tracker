/** สรุปข้อมูลระดับกลุ่ม / ชั้นปี สำหรับ dashboard อาจารย์ */

import { ORDER } from './catalog';
import {
  caseCount, completedInYear, daysSinceUpdate, isComplete, isStale, meetsAllRequirements, overallPercent,
  percentCompleted, type ReqGroup,
} from './rules';
import { academicYear } from '../lib/date';
import type { Settings, Student, WorkType, Workpiece } from './types';

export interface StudentSummary {
  student: Student;
  percent: number;
  pieces: number;
  active: number;
  reqDone: number;
  reqTotal: number;
  /** ครบทั้งเกณฑ์สะสมและเกณฑ์รายปีทุกปี */
  allComplete: boolean;
  /** จบกี่ชิ้นในปีการศึกษาปัจจุบัน (เกณฑ์รายปี) */
  thisYearDone: number;
  stale: number;
}

export function summarizeStudent(student: Student, works: Workpiece[], settings: Settings): StudentSummary {
  const rows = caseCount(works, settings);
  return {
    student,
    percent: overallPercent(works),
    pieces: works.length,
    active: works.filter((w) => !isComplete(w)).length,
    reqDone: rows.reduce((s, r) => s + Math.min(r.done, r.required), 0),
    reqTotal: rows.reduce((s, r) => s + r.required, 0),
    allComplete: meetsAllRequirements(works, settings),
    thisYearDone: completedInYear(works, academicYear(new Date()), settings).length,
    stale: works.filter((w) => isStale(w, settings)).length,
  };
}

export function summarizeAll(students: Student[], works: Workpiece[], settings: Settings): StudentSummary[] {
  const byStudent = new Map<string, Workpiece[]>();
  works.forEach((w) => {
    const arr = byStudent.get(w.studentId) ?? [];
    arr.push(w);
    byStudent.set(w.studentId, arr);
  });
  return students.map((s) => summarizeStudent(s, byStudent.get(s.id) ?? [], settings));
}

export interface GroupSummary {
  code: string;
  percent: number;
  stale: number;
  students: StudentSummary[];
}

export function summarizeGroups(summaries: StudentSummary[]): GroupSummary[] {
  const byGroup = new Map<string, StudentSummary[]>();
  summaries.forEach((s) => {
    const arr = byGroup.get(s.student.group) ?? [];
    arr.push(s);
    byGroup.set(s.student.group, arr);
  });
  return [...byGroup.entries()]
    .map(([code, list]) => ({
      code,
      percent: Math.round(list.reduce((a, s) => a + s.percent, 0) / Math.max(1, list.length)),
      stale: list.reduce((a, s) => a + s.stale, 0),
      students: list.sort((a, b) => a.student.id.localeCompare(b.student.id, undefined, { numeric: true })),
    }))
    .sort((a, b) => parseInt(a.code.replace(/\D/g, ''), 10) - parseInt(b.code.replace(/\D/g, ''), 10));
}

/** จำนวนชิ้นงานต่อประเภททั้ง cohort — กราฟแท่งนอน */
export function countByType(works: Workpiece[]): Array<{ type: WorkType; count: number }> {
  const map = new Map<WorkType, number>();
  works.forEach((w) => map.set(w.type, (map.get(w.type) ?? 0) + 1));
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => ORDER[a.type] - ORDER[b.type]);
}

/** case count เทียบเกณฑ์ทั้ง cohort — แท่ง stacked 3 สี */
export interface CohortReqRow {
  group: ReqGroup;
  label: string;
  required: number;
  complete: number;
  oneShort: number;
  twoPlus: number;
  total: number;
}

export function cohortRequirement(students: Student[], works: Workpiece[], settings: Settings): CohortReqRow[] {
  const byStudent = new Map<string, Workpiece[]>();
  works.forEach((w) => {
    const arr = byStudent.get(w.studentId) ?? [];
    arr.push(w);
    byStudent.set(w.studentId, arr);
  });

  const perStudent = students.map((s) => caseCount(byStudent.get(s.id) ?? [], settings));
  if (!perStudent.length) return [];

  return perStudent[0].map((template, i) => {
    let complete = 0;
    let oneShort = 0;
    let twoPlus = 0;
    perStudent.forEach((rows) => {
      const row = rows[i];
      // กลุ่ม Crown ยังไม่ครบถ้าขาด Post-core แม้จำนวนรวมจะถึงแล้ว
      const gap = Math.max(row.required - row.done, 0) + (row.postCoreComplete === false ? 1 : 0);
      if (row.complete) complete++;
      else if (gap <= 1) oneShort++;
      else twoPlus++;
    });
    return {
      group: template.group,
      label: template.label,
      required: template.required,
      complete,
      oneShort,
      twoPlus,
      total: students.length,
    };
  });
}

/** สัดส่วนนักศึกษาที่ผ่านเกณฑ์รายปีของปีการศึกษาปัจจุบัน */
export function cohortYearly(students: Student[], works: Workpiece[], settings: Settings, now = new Date()) {
  const byStudent = new Map<string, Workpiece[]>();
  works.forEach((w) => {
    const arr = byStudent.get(w.studentId) ?? [];
    arr.push(w);
    byStudent.set(w.studentId, arr);
  });
  const year = academicYear(now);
  const passed = students.filter(
    (s) => completedInYear(byStudent.get(s.id) ?? [], year, settings).length >= settings.req.perYear,
  ).length;
  // ชิ้นงานที่จบสะสมในปีนี้ทั้งชั้น เทียบเป้ารวม — มีความหมายตั้งแต่ต้นปี ต่างจากจำนวนคนที่ผ่านซึ่งเป็น 0 ไปครึ่งปี
  const piecesDone = students.reduce(
    (sum, s) => sum + completedInYear(byStudent.get(s.id) ?? [], year, settings).length,
    0,
  );
  return {
    year, passed, total: students.length, required: settings.req.perYear,
    piecesDone,
    piecesGoal: students.length * settings.req.perYear,
  };
}

export interface StaleRow {
  workpiece: Workpiece;
  student: Student;
  days: number;
}

export function staleRows(students: Student[], works: Workpiece[], settings: Settings): StaleRow[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  return works
    .filter((w) => isStale(w, settings))
    .flatMap((w) => {
      const student = byId.get(w.studentId);
      return student ? [{ workpiece: w, student, days: daysSinceUpdate(w) }] : [];
    })
    .sort((a, b) => b.days - a.days);
}

export function cohortPercent(works: Workpiece[]): number {
  if (!works.length) return 0;
  return Math.round(works.reduce((s, w) => s + percentCompleted(w), 0) / works.length);
}
