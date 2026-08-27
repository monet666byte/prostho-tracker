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
    super('prostho-tracker');
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
