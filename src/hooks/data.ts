import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import {
  listAllCheckIns, listAudit, listCheckIns, listPhotos, listQueue, listReportIssues, listReviews,
  listWorkpieces, pendingIds, stepsOnDate,
} from '../data/repo';
import { sortWorkpieces } from '../domain/rules';
import type { Review, WorkpieceView } from '../domain/types';

export function useWorkpieces(studentId: string | undefined): WorkpieceView[] {
  return (
    useLiveQuery(async () => (studentId ? sortWorkpieces(await listWorkpieces(studentId)) : []), [studentId], []) ?? []
  );
}

export function useWorkpiece(id: string | undefined) {
  return useLiveQuery(
    async () => {
      if (!id) return null;
      const w = await db.workpieces.get(id);
      if (!w) return null;
      const patient = await db.patients.get(w.patientId);
      return patient ? ({ ...w, patient } as WorkpieceView) : null;
    },
    [id],
    undefined,
  );
}

export function usePending() {
  return useLiveQuery(() => pendingIds(), [], new Set<string>()) ?? new Set<string>();
}

export function useQueue() {
  return useLiveQuery(() => listQueue(), [], []) ?? [];
}

export function usePhotos(studentId: string | undefined) {
  return useLiveQuery(async () => (studentId ? listPhotos(studentId) : []), [studentId], []) ?? [];
}

/** รูปของชิ้นงานชิ้นเดียว — ใช้โชว์ในหน้ารายละเอียด */
export function useWorkpiecePhotos(workpieceId: string | undefined) {
  return useLiveQuery(
    async () => (workpieceId ? db.photos.where('workpieceId').equals(workpieceId).toArray() : []),
    [workpieceId],
    [],
  ) ?? [];
}

export function useAudit(limit = 12) {
  return useLiveQuery(() => listAudit(limit), [limit], []) ?? [];
}

export function useReviews(): Map<string, Review> {
  return useLiveQuery(() => listReviews(), [], new Map<string, Review>()) ?? new Map<string, Review>();
}

export function useStudent(id: string | undefined) {
  return useLiveQuery(async () => (id ? db.students.get(id) : undefined), [id], undefined);
}

export function useTeacher(id: string | undefined) {
  return useLiveQuery(async () => (id ? db.teachers.get(id) : undefined), [id], undefined);
}

export function useAllStudents() {
  return useLiveQuery(() => db.students.toArray(), [], []) ?? [];
}

export function useAllWorkpieces() {
  return useLiveQuery(() => db.workpieces.toArray(), [], []) ?? [];
}

export function useSubmissions() {
  return useLiveQuery(() => db.submissions.toArray(), [], []) ?? [];
}

export function useCheckIns(studentId: string | undefined) {
  return useLiveQuery(async () => (studentId ? listCheckIns(studentId) : []), [studentId], []) ?? [];
}

/** step ที่ผ่านจริงในวันหนึ่ง — คืน Map เมื่อส่งหลายคู่ (ใช้ในหน้าประเมินของอาจารย์) */
export function useStepsOnDates(pairs: Array<{ studentId: string; date: string }>) {
  const key = pairs.map((p) => `${p.studentId}|${p.date}`).join(',');
  return (
    useLiveQuery(
      async () => {
        const out = new Map<string, string[]>();
        await Promise.all(
          pairs.map(async (p) => {
            out.set(`${p.studentId}|${p.date}`, await stepsOnDate(p.studentId, p.date));
          }),
        );
        return out;
      },
      [key],
      new Map<string, string[]>(),
    ) ?? new Map<string, string[]>()
  );
}

export function useAllProgressUpdates() {
  return useLiveQuery(() => db.updates.toArray(), [], []) ?? [];
}

export function useAllCheckIns() {
  return useLiveQuery(() => listAllCheckIns(), [], []) ?? [];
}

export function useReportIssues(): Map<string, string> {
  return useLiveQuery(() => listReportIssues(), [], new Map<string, string>()) ?? new Map<string, string>();
}

export function useAllPatients() {
  return useLiveQuery(() => db.patients.toArray(), [], []) ?? [];
}

export function useGroups() {
  return useLiveQuery(() => db.groups.toArray(), [], []) ?? [];
}
