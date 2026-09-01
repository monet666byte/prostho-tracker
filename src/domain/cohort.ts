/**
 * ชั้นปีของนักศึกษา คำนวณจาก "รุ่น" (ปีการศึกษาที่ขึ้นคลินิกปีแรก) ไม่ใช่ค่าคงที่
 *
 * ที่มา: อาจารย์ขอ 1 ก.ย. 69 — ปี 5 ปีการศึกษา 2569 พอถึง 2570 ต้องกลายเป็นปี 6 เอง
 * และมีรุ่นใหม่เข้ามาเป็นปี 5 ในปีเดียวกัน โดยเก็บข้อมูลย้อนหลังราว 5 ปี
 *
 * กติกา: ปีการศึกษาไทยเริ่ม 1 มิ.ย. (ดู academicYear ใน lib/date.ts)
 * ชั้นปีจึงเลื่อนเองทุกวันที่ 1 มิ.ย. โดยไม่ต้องแก้ข้อมูลนักศึกษาแม้แต่แถวเดียว
 */
import type { Student } from './types';
import { academicYear } from '../lib/date';

/** ชั้นปีคลินิก: 5 = ปี 5 · 6 = ปี 6 · >6 = จบไปแล้ว (ดู isAlumni) */
export const CLINIC_START_YEAR = 5;
export const CLINIC_LAST_YEAR = 6;
/** เก็บข้อมูลย้อนหลังกี่รุ่น (อาจารย์ขอ ~5 ปี) */
export const KEEP_COHORTS = 5;

/**
 * รุ่นของนักศึกษา — ถ้ายังไม่มี entryYear (ข้อมูลเก่าก่อนเพิ่มฟิลด์นี้)
 * เดาย้อนจากชั้นปีที่บันทึกไว้ โดยถือว่าค่านั้นถูก ณ ปีการศึกษาที่ระบุ
 */
export function cohortOf(s: Pick<Student, 'year' | 'entryYear'>, asOf: Date = new Date()): number {
  if (s.entryYear) return s.entryYear;
  return academicYear(asOf) - (s.year - CLINIC_START_YEAR);
}

/** ชั้นปี ณ เวลาที่กำหนด — เลื่อนเองตามปีการศึกษา */
export function studentYear(s: Pick<Student, 'year' | 'entryYear'>, asOf: Date = new Date()): number {
  return CLINIC_START_YEAR + (academicYear(asOf) - cohortOf(s, asOf));
}

/** จบหลักสูตรคลินิกไปแล้ว — ข้อมูลยังอยู่ แต่ไม่นับรวมกับรุ่นที่กำลังเรียน */
export function isAlumni(s: Pick<Student, 'year' | 'entryYear'>, asOf: Date = new Date()): boolean {
  return studentYear(s, asOf) > CLINIC_LAST_YEAR;
}

/** ยังเรียนอยู่ในคลินิก (ปี 5 หรือ 6) */
export function isActiveStudent(s: Pick<Student, 'year' | 'entryYear'>, asOf: Date = new Date()): boolean {
  const y = studentYear(s, asOf);
  return y >= CLINIC_START_YEAR && y <= CLINIC_LAST_YEAR;
}

/** รุ่นที่ยังต้องเก็บไว้ในระบบ ณ ปีการศึกษาหนึ่ง (เก่ากว่านี้คือหมดอายุเก็บ) */
export function isWithinRetention(cohort: number, asOf: Date = new Date()): boolean {
  return academicYear(asOf) - cohort < KEEP_COHORTS;
}

/**
 * เลขรุ่น DTMU — ภาษาที่ภาควิชาใช้เรียกกันจริง (ผู้ใช้ยืนยัน 1 ก.ย. 69:
 * "ตอนนี้ DTMU55 อยู่ปี 5, DTMU54 อยู่ปี 6")
 *
 * ยึดสองหมุดนั้น: รุ่น 55 ขึ้นคลินิกปีการศึกษา 2569 · รุ่น 54 ขึ้นปี 2568
 * ตรงกับรหัสนักศึกษาที่ใช้อยู่ (65xxxxx = รุ่น 55 · 64xxxxx = รุ่น 54)
 */
const DTMU_OFFSET = 2514;

/** entryYear → เลขรุ่น เช่น 2569 → 55 */
export function dtmuOf(entryYear: number): number {
  return entryYear - DTMU_OFFSET;
}

/** เลขรุ่น → entryYear เช่น 55 → 2569 (ใช้ตอนรับรุ่นใหม่เข้าระบบ) */
export function entryYearFromDtmu(dtmu: number): number {
  return dtmu + DTMU_OFFSET;
}

/** ป้ายรุ่นสำหรับ UI — "DTMU55" ตามที่ภาคเรียกกัน */
export function cohortLabel(entryYear: number): string {
  return `DTMU${dtmuOf(entryYear)}`;
}

/** ป้ายรุ่นของนักศึกษาโดยตรง */
export function studentCohortLabel(s: Pick<Student, 'year' | 'entryYear'>, asOf: Date = new Date()): string {
  return cohortLabel(cohortOf(s, asOf));
}

/** แปลงชั้นปีที่บันทึกไว้เป็นรุ่น — ใช้ตอน migrate ข้อมูลเดิมหรือรับ roster ที่ให้มาแค่ชั้นปี */
export function entryYearFromClassYear(classYear: number, asOf: Date = new Date()): number {
  return academicYear(asOf) - (classYear - CLINIC_START_YEAR);
}
