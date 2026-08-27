/**
 * ปฏิทินปีการศึกษา 2569 — เดิมคือรอบส่งรายงาน แต่ระบบรายงานถูกถอดออกแล้ว (สิงหา 2026)
 * เหลือไว้เพราะ analytics ใช้วันคาบสุดท้ายคำนวณ "เวลาที่เหลือของปี" เท่านั้น
 */

import type { ReportRound } from './types';

export const ROUNDS: ReportRound[] = [
  { id: 'r1', name: 'Progress รอบ 1', dueDate: '2026-08-04', kind: 'progress' },
  { id: 'r2', name: 'Check case CD', dueDate: '2026-08-17', kind: 'check-case-cd' },
  { id: 'r3', name: 'Progress รอบ 2', dueDate: '2026-08-28', kind: 'progress' },
  { id: 'r4', name: 'Progress รอบ 3', dueDate: '2026-10-30', kind: 'progress' },
  { id: 'r5', name: 'Progress รอบ 4', dueDate: '2026-12-25', kind: 'progress' },
  { id: 'r6', name: 'Progress รอบ 5', dueDate: '2027-02-26', kind: 'progress' },
  { id: 'r7', name: 'Progress final', dueDate: '2027-03-26', kind: 'final' },
];

/** matrix ตารางส่งรายงานของอาจารย์ — ครบทั้ง 7 รอบเหมือน tab "Progress checked" ในชีต */
export const MATRIX_ROUNDS = ROUNDS;

/** รอบถัดไปที่ยังไม่ถึงกำหนด */
export function nextRound(now = new Date()): ReportRound | null {
  const today = now.getTime();
  return ROUNDS.find((r) => new Date(r.dueDate).getTime() >= today) ?? null;
}
