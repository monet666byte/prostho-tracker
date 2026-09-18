import { useSyncExternalStore } from 'react';
import { onOutboxChange, pendingPushCount } from '../data/cloudSync';
import { onPdpaPolicy, patientNamesOn, pdpaPolicy } from '../data/pdpaSync';
import { identityLevelFor, type IdentityLevel, type IdentitySurface } from '../lib/privacy';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { resolvePhotoSrc } from '../data/photoStore';
import {
  getSelfAssessment, listAllCheckIns, listAudit, listCheckIns, listPhotos, listQueue, listReviewConflicts, listReviews,
  listSect2, listSect3, listSelfAssessments, listWorkpieces, pendingIds, stepsOnDate,
} from '../data/repo';
import { sortWorkpieces } from '../domain/rules';
import type { Photo, Review, Teacher, WorkpieceView } from '../domain/types';
import { useApp } from '../store/app';

/**
 * ภาพล่าสุดของทั้งตาราง — เปิดหน้าใหม่ได้ข้อมูลเดิมทันที แทนที่จะวาดหน้า "ว่าง" หนึ่งจังหวะก่อน
 *
 * useLiveQuery คืนค่าเริ่มต้น ([]) ในเรนเดอร์แรกของทุกหน้า แล้วค่อยได้ข้อมูลจริงเฟรมถัดไป
 * ผลคือกดเมนู "ภาพรวม"/"วิเคราะห์รวม" แล้วเห็นหน้าเลข 0 · "ไม่มีอะไรน่าห่วง" · กราฟว่าง แวบหนึ่ง
 * — และเลข 0 คือป้ายหลอกด้วย
 *
 * ภาพเก็บผูกกับ "ใครล็อกอิน + revision" — สลับบัญชี / รีเซ็ตข้อมูล = ทิ้งทั้งหมด ไม่เอาของคนก่อนมาโชว์
 * ข้อมูลสดยังมาจาก useLiveQuery เหมือนเดิม ภาพนี้แค่ใช้แทนเฟรมแรกระหว่างรอ
 */
const snapshots = new Map<string, unknown[]>();
let snapshotScope = '';
const EMPTY_ROWS: never[] = [];
function useTableSnapshot<T>(name: string, query: () => Promise<T[]>): T[] {
  const scope = useApp((st) => `${st.session?.role ?? ''}|${st.session?.teacherId ?? ''}|${st.session?.studentId ?? ''}|${st.revision}`);
  if (scope !== snapshotScope) { snapshots.clear(); snapshotScope = scope; }
  const live = useLiveQuery(async () => {
    const rows = await query();
    if (scope === snapshotScope) snapshots.set(name, rows);
    return rows;
  }, [scope]);
  return live ?? (snapshots.get(name) as T[] | undefined) ?? EMPTY_ROWS;
}

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

/**
 * วันที่ทำจริงของขั้นล่าสุดที่ผ่าน — อ่านจากประวัติ (performedAt ที่นักศึกษาเลือก)
 * ห้ามใช้ lastUpdatedAt: มันขยับทุกครั้งที่แตะชิ้นงาน (คืนเคส · เลิกทำ) และเป็น "ตอนที่กดบันทึก"
 * ไม่ใช่ "วันที่ทำ" — กรอกย้อนหลังของสัปดาห์ก่อนแล้วเส้นทางเคสขึ้นเป็นวันนี้
 * ไม่มีประวัติเลย (งานนำเข้าจากชีต · ข้อมูลตัวอย่าง) = ไม่มีอะไรดีกว่า lastUpdatedAt ซึ่งสำหรับงานนำเข้าคือวันที่ในชีต
 */
export function useLastStepDate(
  w: { id: string; procIndex: number; lastUpdatedAt: string } | null | undefined,
): string | null {
  const id = w?.id;
  const procIndex = w?.procIndex ?? -1;
  const fallback = w?.lastUpdatedAt ?? null;
  return useLiveQuery(
    async () => {
      if (!id || procIndex < 0) return null;
      const rows = (await db.updates.where('workpieceId').equals(id).toArray())
        .filter((u) => !u.reversal)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (!rows.length) return fallback;
      // บันทึกของขั้นปัจจุบันก่อน · ไม่มี (ประวัติไม่ครบ) ก็ใช้บันทึกล่าสุดที่มี
      return (rows.find((u) => u.procIndex === procIndex) ?? rows[0]).performedAt;
    },
    [id, procIndex, fallback],
    null,
  ) ?? null;
}

export function usePending() {
  return useLiveQuery(() => pendingIds(), [], new Set<string>()) ?? new Set<string>();
}

export function useQueue() {
  return useLiveQuery(() => listQueue(), [], []) ?? [];
}

/** จำนวนแถวที่ยังไม่ถึงเซิร์ฟเวอร์จริง ณ ตอนนี้ (คิวของ cloudSync) — โหมดไม่ต่อ cloud ได้ 0 เสมอ */
export function usePendingPushCount(): number {
  return useSyncExternalStore(onOutboxChange, pendingPushCount);
}

export function usePhotos(studentId: string | undefined) {
  return useLiveQuery(async () => (studentId ? listPhotos(studentId) : []), [studentId], []) ?? [];
}

/**
 * src ของรูปหลายใบพร้อมกัน — คืน Map photoId → URL
 *
 * ต้องเป็น hook แยกเพราะบักเก็ตเป็น private: รูปที่ขึ้นคลาวด์แล้วต้องขอ "ลิงก์ที่เซ็นแล้ว"
 * ซึ่งเป็นงาน async ต่างจากเดิมที่ data URL อยู่ในแถวแล้วเสียบเข้า <img> ได้เลย
 * (สำเนาในเครื่องยังมาก่อนเสมอ — เร็วกว่า ไม่กินเน็ต และใช้ได้ตอนออฟไลน์)
 */
export function usePhotoSrc(photos: Photo[]): Map<string, string> {
  const [srcs, setSrcs] = useState<Map<string, string>>(new Map());
  /* คีย์ต้องมี storagePath ด้วย ไม่ใช่แค่ id — รูปที่เพิ่งอัปเสร็จจะเปลี่ยนจาก
     "ไม่มีลิงก์" เป็น "มี" โดยที่ id เท่าเดิม ถ้าดูแค่ id หน้าจอจะค้างเป็นช่องว่าง */
  const key = photos.map((p) => `${p.id}:${p.storagePath ?? ''}:${p.dataUrl ? '1' : ''}`).join(',');
  useEffect(() => {
    let alive = true;
    void resolvePhotoSrc(photos).then((m) => { if (alive) setSrcs(m); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return srcs;
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

/** ใบตัดสินที่ถูกทับ (ของอาจารย์ท่านอื่น) — ทำป้ายเตือน ไม่ให้คำตัดสินหายเงียบ */
export function useReviewConflicts(): Map<string, Review[]> {
  return useLiveQuery(() => listReviewConflicts(), [], new Map<string, Review[]>()) ?? new Map<string, Review[]>();
}

export function useStudent(id: string | undefined) {
  return useLiveQuery(async () => (id ? db.students.get(id) : undefined), [id], undefined);
}

/* ชื่ออาจารย์ที่เคยอ่านแล้ว — คำทักทายบนสรุปวันนี้ไม่ต้องขึ้นว่างแล้วค่อยเด้งชื่อตามมาทุกครั้งที่เปลี่ยนหน้า */
const teacherSeen = new Map<string, Teacher | undefined>();
export function useTeacher(id: string | undefined): Teacher | undefined {
  const live = useLiveQuery(async (): Promise<Teacher | undefined> => {
    const tc = id ? await db.teachers.get(id) : undefined;
    if (id) teacherSeen.set(id, tc);
    return tc;
  }, [id]);
  return live ?? (id ? teacherSeen.get(id) : undefined);
}

export function useAllStudents() {
  return useTableSnapshot('students', () => db.students.toArray());
}

export function useAllWorkpieces() {
  return useTableSnapshot('workpieces', () => db.workpieces.toArray());
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
  return useTableSnapshot('updates', () => db.updates.toArray());
}

export function useAllCheckIns() {
  return useTableSnapshot('checkins', () => listAllCheckIns());
}


export function useAllPatients() {
  return useTableSnapshot('patients', () => db.patients.toArray());
}

export function useGroups() {
  return useTableSnapshot('groups', () => db.groups.toArray());
}

/** แบบประเมินตนเองของ นศ. คนหนึ่ง ในปีการศึกษาหนึ่ง */
export function useSelfAssessment(studentId: string | undefined, academicYear: number) {
  return useLiveQuery(
    async () => (studentId ? ((await getSelfAssessment(studentId, academicYear)) ?? null) : null),
    [studentId, academicYear],
    undefined,
  );
}

/** ทุกชุดของปีการศึกษาหนึ่ง — ฝั่งอาจารย์ใช้ดูว่าใครส่งแล้ว */
export function useSelfAssessments(academicYear?: number) {
  return useLiveQuery(() => listSelfAssessments(academicYear), [academicYear], []) ?? [];
}

/**
 * ผลประเมิน Section III ของ นศ. คนหนึ่ง
 *
 * ไม่ส่ง studentId = ยังไม่ได้เลือกใคร → คืนว่าง ไม่ใช่ "ดึงทุกแถว"
 * เพราะหน้าอาจารย์เรียก hook นี้ตั้งแต่ก่อนเลือกคน ถ้าไปกวาดทั้งตาราง
 * พอข้อมูลจริงโตขึ้น (วัดที่ 14,400 แถว) จะกวาดทิ้งทุกครั้งที่ re-render โดยไม่ได้ใช้เลย
 */
export function useSect3(studentId?: string, academicYear?: number) {
  return useLiveQuery(
    () => (studentId ? listSect3(studentId, academicYear) : Promise.resolve([])),
    [studentId, academicYear],
    [],
  ) ?? [];
}

/** ผลประเมิน Section II ของ นศ. คนหนึ่ง — เหตุผลเดียวกับ useSect3 */
export function useSect2(studentId?: string, academicYear?: number) {
  return useLiveQuery(
    () => (studentId ? listSect2(studentId, academicYear) : Promise.resolve([])),
    [studentId, academicYear],
    [],
  ) ?? [];
}

/**
 * ระดับที่หน้านี้ได้เห็นตัวตนผู้ป่วย — เปลี่ยนตามนโยบายของภาคแบบสด ๆ
 *
 * หัวหน้าภาคสลับสวิตช์ `maskByDefault` แล้วทุกเครื่องต้องเปลี่ยนตามภายในรอบ sync
 * ไม่ใช่ต้องปิดแอปเปิดใหม่ — หน้าจอที่ยังเปิดค้างอยู่คือหน้าจอที่กำลังมีคนดูข้อมูลอยู่
 * ตารางว่าหน้าไหนได้ระดับไหน อยู่ที่ `lib/privacy.ts → identityLevelFor()` ที่เดียว
 */
export function useIdentityLevel(surface: IdentitySurface): IdentityLevel {
  const pol = useSyncExternalStore(onPdpaPolicy, pdpaPolicy, pdpaPolicy);
  return identityLevelFor(surface, pol.maskByDefault);
}

/** สวิตช์ "ใช้ชื่อผู้ป่วย" ของภาค (0026) แบบสด — ใช้คู่กับ patientTitle() / patientWithHn() ใน lib/privacy.ts */
export function usePatientNamesOn(): boolean {
  return useSyncExternalStore(onPdpaPolicy, patientNamesOn, patientNamesOn);
}
