/**
 * Local-first storage (IndexedDB ผ่าน Dexie)
 *
 * ชั้นนี้คือ "จุดสลับ" — วันที่ภาควิชามีเซิร์ฟเวอร์กลาง ให้เปลี่ยนเฉพาะ repo.ts
 * ไปเรียก API จริง โดย UI ทั้งหมดไม่ต้องแก้
 */

import Dexie, { type EntityTable } from 'dexie';
import type {
  AuditEntry, ClinicGroup, Patient, Photo, ProgressUpdate, QueueItem,
  CheckIn, ReportIssue, ReportSubmission, Review, Student, Teacher, Workpiece,
} from '../domain/types';

export interface KV {
  key: string;
  value: unknown;
}

export class ProsthoDB extends Dexie {
  teachers!: EntityTable<Teacher, 'id'>;
  students!: EntityTable<Student, 'id'>;
  groups!: EntityTable<ClinicGroup, 'code'>;
  patients!: EntityTable<Patient, 'id'>;
  workpieces!: EntityTable<Workpiece, 'id'>;
  updates!: EntityTable<ProgressUpdate, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  submissions!: EntityTable<ReportSubmission, 'id'>;
  issues!: EntityTable<ReportIssue, 'studentId'>;
  checkins!: EntityTable<CheckIn, 'id'>;
  reviews!: EntityTable<Review, 'id'>;
  queue!: EntityTable<QueueItem, 'id'>;
  audit!: EntityTable<AuditEntry, 'id'>;
  kv!: EntityTable<KV, 'key'>;

  constructor() {
    // โหมดเดโม (npm run dev:demo) แยกลิ้นชักคนละใบ — เล่นยังไงก็ไม่แตะข้อมูลจริงที่ sync มาจากเซิร์ฟเวอร์
    super(import.meta.env?.VITE_DEMO === '1' ? 'prostho-tracker-demo' : 'prostho-tracker');
    this.version(1).stores({
      teachers: 'id',
      students: 'id, group, code',
      groups: 'code',
      patients: 'id, ownerStudentId, hn',
      workpieces: 'id, studentId, patientId, type, pairId, lastUpdatedAt',
      updates: 'id, workpieceId, createdAt',
      photos: 'id, workpieceId, status',
      submissions: 'id, studentId, roundId',
      issues: 'studentId',
      reviews: 'id, workpieceId',
      queue: 'id, workpieceId',
      audit: 'id, at',
      kv: 'key',
    });
    this.version(2).stores({
      checkins: 'id, studentId, date, status',
    });
    /**
     * v3 — "รุ่น" (entryYear) แทนชั้นปีตายตัว เพื่อให้ นศ. เลื่อนชั้นเองทุก 1 มิ.ย.
     * (อาจารย์ขอ 1 ก.ย. 69) · ข้อมูลเดิมมีแค่ year 5/6 จึงเดารุ่นย้อนจากปีการศึกษา
     * ที่ติดตั้งอยู่ตอนอัปเกรด ซึ่งถูกต้องเพราะค่า year นั้นเป็นความจริง ณ ตอนนั้น
     */
    this.version(3).stores({
      students: 'id, group, code, entryYear',
    }).upgrade(async (tx) => {
      /* คำนวณในที่ ไม่เรียกข้ามโมดูล — Dexie รัน upgrade ตอนเปิด DB ซึ่งเร็วกว่าที่
         โมดูลอื่นจะพร้อม เคยทำให้ล้มด้วย "entryYearFromClassYear is not defined" */
      const now = new Date();
      const be = now.getFullYear() + 543;
      const curAcademicYear = now.getMonth() >= 5 ? be : be - 1;
      await tx.table('students').toCollection().modify((s: { year?: number; entryYear?: number }) => {
        if (!s.entryYear) s.entryYear = curAcademicYear - ((s.year ?? 5) - 5);
      });
    });
  }
}

export const db = new ProsthoDB();

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
