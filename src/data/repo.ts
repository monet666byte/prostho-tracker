/**
 * Repository — API เดียวที่ UI เรียกใช้ในการอ่าน/เขียนข้อมูล
 *
 * ทุกอย่างเขียนลง IndexedDB (Dexie) ก่อนเสมอ (local-first) · middleware ใน cloudSync.ts
 * ดักการเขียนแล้วส่งขึ้น Supabase ให้เอง ไฟล์นี้จึงไม่ต้องรู้เรื่องเน็ต
 * ยกเว้นงานที่ต้องให้เซิร์ฟเวอร์ตัดสิน (เช่น purgeExpiredCohorts → RPC) ซึ่งเรียก supabase ตรงในนี้
 */

import { CATALOG_VERSION, dentureLabel, isArchWork, typeMeta } from '../domain/catalog';
import { CRITERIA, totalScore } from '../domain/checkin';
import { cohortOf, entryYearFromDtmu, isAlumni, isWithinRetention } from '../domain/cohort';
import { groupCodeFor, studentIdFor } from '../domain/group';
import { patientNamesOn, pdpaPolicy } from './pdpaSync';
import { caseCode } from '../lib/privacy';
import { cloudEnabled, supabase } from '../lib/cloud';
import { flushNow, pendingPushCount } from './cloudSync';
import { clampPerformedAt, toISODate } from '../lib/date';
import { isComplete, procAt, procLabel, GATE_LABELS } from '../domain/rules';
import type {
  Arch, AuditEntry, ClinicGroup, KennedyClass, Payment, Photo, ProgressUpdate, QueueItem,
  CheckIn, DentureClass, PhotoStatus, Review, ReviewStatus, Sect2Record, Sect3Record, SelfAssessment, Settings, Student, WorkType, Workpiece, WorkpieceView, GateKey } from '../domain/types';
import { SECT2_GATE_OF, sect2GateValue } from '../domain/sect2';
import { saId } from '../domain/selfAssessment';
import { db, kvGet, kvSet } from './db';
import { byNewestReview, isOthersForm, pickLatestReviews } from '../domain/conflict';
import { DEFAULT_SETTINGS, DEMO, SETTINGS_VERSION } from './seed';
export { saId };
import { formatBytes } from '../lib/image';
import {
  dropLocalBlobs, initialPhotoStatus, putLocalBlob, removePhotoFiles, retryPhotoUpload, uploadPendingPhotos,
} from './photoStore';

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ── อ่าน ──────────────────────────────────────────────────────

export async function listWorkpieces(studentId: string): Promise<WorkpieceView[]> {
  const works = await db.workpieces.where('studentId').equals(studentId).toArray();
  const patients = await db.patients.where('ownerStudentId').equals(studentId).toArray();
  const byId = new Map(patients.map((p) => [p.id, p]));
  return works.flatMap((w) => {
    const patient = byId.get(w.patientId);
    return patient ? [{ ...w, patient }] : [];
  });
}

/**
 * ปรับค่าเริ่มต้นที่แก้ทีหลังให้มีผลกับเครื่องที่ตั้งค่าไว้แล้ว — รันครั้งเดียวตอนเปิดแอป
 * v2: เกณฑ์ CD 1 → 2 — แตะเฉพาะเครื่องที่ยังเป็นค่าเก่า
 * v3: saOpen (เปิด/ปิดรวม) → saOpenYears (แยกชั้นปี) — ที่เคยเปิดไว้ ให้เปิดทั้งสองชั้นปีเหมือนเดิม
 * v4: เพิ่มเกณฑ์ Recall สองแถว
 *     เขียนค่าลงเครื่องที่ยังไม่มีช่องนี้ ให้ค่าที่เก็บไว้ตรงกับที่หน้าจออ่านจริง
 *     (getSettings เติม default ให้อยู่แล้ว แต่ถ้าไม่เขียนลง อาจารย์กดปรับเลขอื่นแล้ว
 *      ค่าใหม่จะถูกบันทึกทับด้วยก้อนที่ยังไม่มีสองช่องนี้)
 * ถ้าอาจารย์ตั้งเลขอื่นไว้เอง จะไม่ถูกเขียนทับ
 */
export async function migrateSettings(): Promise<void> {
  const ver = (await kvGet<number>('settingsVersion', 1)) ?? 1;
  if (ver >= SETTINGS_VERSION) return;
  if (ver < 2) {
    const cur = await getSettings();
    if (cur.req.cd === 1) await saveSettings({ req: { ...cur.req, cd: 2 } });
  }
  if (ver < 3) {
    /* ต้องอ่านค่าที่ "เก็บไว้จริง" ไม่ใช่ค่าที่ merge กับ DEFAULT_SETTINGS แล้ว
       เพราะ default มี saOpenYears: [] อยู่ ถ้าดูจากค่า merge จะนึกว่า migrate ไปแล้วเสมอ */
    const stored = (await kvGet<Partial<Settings> & { saOpen?: boolean }>('settings', {})) ?? {};
    if (!Array.isArray(stored.saOpenYears)) {
      await saveSettings({ saOpenYears: stored.saOpen ? [5, 6] : [] });
    }
  }
  if (ver < 4) {
    const stored = (await kvGet<Partial<Settings>>('settings', {})) ?? {};
    const req = stored.req as Partial<typeof DEFAULT_SETTINGS.req> | undefined;
    if (req && (req.recallRemovable === undefined || req.recallFixed === undefined)) {
      await saveSettings({
        req: {
          ...DEFAULT_SETTINGS.req,
          ...req,
          recallRemovable: req.recallRemovable ?? DEFAULT_SETTINGS.req.recallRemovable,
          recallFixed: req.recallFixed ?? DEFAULT_SETTINGS.req.recallFixed,
        },
      });
    }
  }
  await kvSet('settingsVersion', SETTINGS_VERSION);
}

export async function getSettings(): Promise<Settings> {
  const stored = (await kvGet('settings', DEFAULT_SETTINGS)) as Settings;
  /* ⚠️ ต้อง merge `req` ลึกอีกชั้น — spread ชั้นเดียวจะเอา req ที่เก็บไว้มาแทนทั้งก้อน
     วันที่เพิ่มช่องใหม่ในเกณฑ์ (เช่น recallRemovable) เครื่องที่ตั้งค่าไว้แล้ว
     จะได้ค่า undefined ในช่องใหม่ → เกณฑ์กลายเป็น NaN บนหน้าจอโดยไม่มีอะไรฟ้อง */
  return { ...DEFAULT_SETTINGS, ...stored, req: { ...DEFAULT_SETTINGS.req, ...(stored?.req ?? {}) } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await kvSet('settings', next);
  return next;
}

// ── audit ─────────────────────────────────────────────────────

/**
 * จดลงสมุดบันทึก — `scope` บอกว่าเรื่องนี้เกี่ยวกับ นศ. คนไหน/กลุ่มไหน
 * ใช้กรองตอนอ่าน: อาจารย์เห็นเฉพาะกลุ่มที่ดูแล · ไม่ระบุ scope = เรื่องระดับระบบ (หัวหน้าภาคเท่านั้น)
 * (actor_uid ฐานข้อมูลเติมเองจากคนที่ล็อกอิน — ฝั่งแอปปลอมไม่ได้)
 */
export async function logAudit(
  text: string,
  who: string,
  scope?: { studentId?: string; group?: string },
): Promise<void> {
  const entry: AuditEntry = {
    id: uid('a'),
    text,
    who,
    at: new Date().toISOString(),
    studentId: scope?.studentId,
    groupCode: scope?.group,
  };
  await db.audit.add(entry);
}


export async function listAudit(limit = 12): Promise<AuditEntry[]> {
  const all = await db.audit.orderBy('at').reverse().limit(limit).toArray();
  return all;
}

// ── อัปเดต step ───────────────────────────────────────────────

export interface AdvanceInput {
  workpieceId: string;
  performedAt: string; // ISO date — นักศึกษาแก้ได้
  withPhoto: boolean;
  offline: boolean;
  actor: string;
}

export interface AdvanceResult {
  workpiece: Workpiece;
  label: string;
  completedCase: boolean;
  queued: boolean;
}

export async function advanceStep(input: AdvanceInput): Promise<AdvanceResult | null> {
  const w = await db.workpieces.get(input.workpieceId);
  if (!w) return null;
  const next = procAt(w, w.procIndex + 1);
  if (!next) return null;

  const performedAt = clampPerformedAt(input.performedAt, w.acceptedDate);
  const now = new Date().toISOString();
  const updated: Workpiece = { ...w, procIndex: next.index, lastUpdatedAt: now };
  // จบเคสเมื่อไหร่ ใช้ตัดสินเกณฑ์รายปี จึงต้องเก็บเวลาไว้
  if (isComplete(updated)) updated.completedAt = performedAt;
  const label = procLabel(w.type, next);

  const update: ProgressUpdate = {
    id: uid('u'),
    workpieceId: w.id,
    procIndex: next.index,
    progression: next.progression,
    performedAt,
    selfPerformed: next.selfPerformed,
    photoIds: [],
    createdBy: input.actor,
    createdAt: new Date().toISOString(),
    syncedAt: input.offline ? null : new Date().toISOString(),
  };

  await db.transaction('rw', [db.workpieces, db.updates, db.queue, db.photos, db.audit], async () => {
    await db.workpieces.put(updated);
    await db.updates.add(update);
    /* เดิมตรงนี้สร้าง "รูป" เปล่าพร้อมขนาดไฟล์ที่สุ่มขึ้นมา ทั้งที่ไม่มีไฟล์รูปอยู่จริง
       ตอนนี้รูปถูกแนบจริงผ่าน usePhotoAttach ตั้งแต่ก่อนกดยืนยัน — แค่ผูกเข้ากับ update นี้

       ⚠️ ต้องเอาเฉพาะรูปที่ยังไม่มี step ไหนจับจองไว้
       เดิมกวาดรูป "ทุกใบของชิ้นงานนี้" ทำให้รูปของ step 3 ถูกผูกซ้ำเข้ากับ step 4, 5, 6 …
       ต่อไปเรื่อย ๆ · หนึ่งรูปจึงโผล่อยู่ใต้หลาย step และจำนวนรูปต่อ step เฟ้อขึ้นทุกครั้ง
       ตอนนี้ยังไม่มีหน้าไหนอ่าน photoIds จึงไม่มีใครเห็น แต่แถวพวกนี้ sync ขึ้นตู้กลางไปแล้ว
       ใครเขียนหน้า "รูปของ step นี้" วันหน้าจะได้ตัวเลขผิดโดยไม่รู้ว่าผิดที่ไหน */
    if (input.withPhoto) {
      const all = await db.photos.where('workpieceId').equals(w.id).toArray();
      const past = await db.updates.where('workpieceId').equals(w.id).toArray();
      const claimed = new Set(past.flatMap((u) => u.photoIds ?? []));
      const ids = all.map((ph) => ph.id).filter((id) => !claimed.has(id));
      if (ids.length) {
        update.photoIds.push(...ids);
        await db.updates.put(update);
      }
    }
    if (input.offline) {
      const item: QueueItem = {
        id: uid('q'),
        workpieceId: w.id,
        label,
        createdAt: new Date().toISOString(),
        hasPhoto: input.withPhoto,
        kind: 'progress',
      };
      await db.queue.add(item);
    }
    await db.audit.add({
      id: uid('a'), text: `ผ่าน ${label}`, who: input.actor,
      at: new Date().toISOString(), studentId: w.studentId,
    });
  });

  return { workpiece: updated, label, completedCase: isComplete(updated), queued: input.offline };
}

/** เลิกทำ — บันทึกเป็น reversal ไม่ลบประวัติ */
export async function undoStep(workpieceId: string, actor: string): Promise<Workpiece | null> {
  const w = await db.workpieces.get(workpieceId);
  if (!w || w.procIndex < 0) return null;
  const undone = procAt(w, w.procIndex);
  const updated: Workpiece = { ...w, procIndex: w.procIndex - 1, lastUpdatedAt: new Date().toISOString() };
  if (!isComplete(updated)) delete updated.completedAt;

  await db.transaction('rw', [db.workpieces, db.updates, db.queue, db.audit], async () => {
    await db.workpieces.put(updated);
    await db.updates.add({
      id: uid('u'),
      workpieceId: w.id,
      procIndex: w.procIndex,
      progression: undone?.progression ?? 0,
      performedAt: toISODate(new Date()),
      selfPerformed: false,
      photoIds: [],
      reversal: true,
      createdBy: actor,
      createdAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    });
    // ถอนรายการล่าสุดของชิ้นงานนี้ออกจากคิว ถ้ายังไม่ได้ sync
    const queued = await db.queue.where('workpieceId').equals(w.id).toArray();
    const last = queued.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (last) await db.queue.delete(last.id);
    if (undone) {
      await db.audit.add({
        id: uid('a'),
        text: `แก้ ${procLabel(w.type, undone)} → ย้อนกลับ 1 ขั้น`,
        who: actor,
        at: new Date().toISOString(),
        studentId: w.studentId,
      });
    }
  });
  return updated;
}

// ── เปิดชิ้นงานใหม่ ──────────────────────────────────────

export interface NewWorkpieceInput {
  studentId: string;
  patientName: string;
  hn: string;
  sexAge: string;
  type: WorkType;
  dentureClass?: DentureClass;
  pair: boolean;
  tooth?: string;
  kennedy?: KennedyClass;
  variant?: 'cast' | 'prefab';
  acceptedDate: string;
  minimumRequirement: boolean;
  pendingQualification?: boolean;
  payment: Payment;
  sect2Removable: boolean;
  sect2Fixed: boolean;
  designRpd?: string;
  actor: string;
}

export async function createWorkpieces(input: NewWorkpieceInput): Promise<Workpiece[]> {
  const meta = typeMeta(input.type);
  const removable = isArchWork(input.type);
  const now = new Date().toISOString();

  // HN เดิมของนักศึกษาคนเดียวกัน = ผู้ป่วยคนเดิม — ห้ามงอกแถวใหม่
  //
  const hn = input.hn.trim();
  const existing = hn
    ? (await db.patients.where('hn').equals(hn).toArray()).find((p) => p.ownerStudentId === input.studentId)
    : undefined;
  const patientId = existing?.id ?? uid('p');
  if (!existing) {
    await db.patients.add({
      id: patientId,
      /* สวิตช์ "ใช้ชื่อผู้ป่วย" ปิด (นำร่อง · 0026) = ไม่เก็บชื่อตั้งแต่ในเครื่อง · หน้าจอแสดง HN แทนชื่อที่ว่าง */
      name: patientNamesOn() ? input.patientName.trim() : '',
      // เดิมช่องว่างจะได้ HN ปลอม "DEMO-1234" — ผู้ป่วยจริงที่ไม่มี HN จริง
      // จับคู่กับแฟ้มของโรงพยาบาลไม่ได้ และคนละคนที่เว้นว่างเหมือนกันจะกลายเป็นคนละ HN
      // ฟอร์มบังคับกรอกแล้ว ตรงนี้กันไว้อีกชั้นเฉยๆ
      hn,
      sexAge: input.sexAge.trim() || 'ไม่ระบุ',
      ownerStudentId: input.studentId,
    });
  }

  const base = {
    patientId,
    studentId: input.studentId,
    type: input.type,
    variant: input.type === 'PC' ? (input.variant ?? 'cast') : undefined,
    kennedy: input.type === 'RPD' ? input.kennedy : undefined,
    dentureClass: input.dentureClass,
    // วันที่จากช่องกรอกอาจเป็นอนาคตหรือว่าง (พิมพ์เองบนเดสก์ท็อป) — ประทับให้อยู่ในช่วงจริงเสมอ
    acceptedDate: clampPerformedAt(input.acceptedDate, undefined),
    minimumRequirement: input.minimumRequirement,
    pendingQualification: input.pendingQualification,
    payment: input.payment,
    sect2Removable: input.sect2Removable,
    sect2Fixed: input.sect2Fixed,
    designRpd: input.designRpd,
    procIndex: -1,
    lastUpdatedAt: now,
    catalogVersion: CATALOG_VERSION,
  };

  const kennedySuffix = input.type === 'RPD' && input.kennedy ? ` ${input.kennedy}` : '';
  const removableDetail = (arch: Arch) =>
    (input.dentureClass
      ? dentureLabel(input.dentureClass, arch)
      : arch === 'upper' ? `${meta.short}/- (Upper)` : `-/${meta.short} (Lower)`) + kennedySuffix;
  let created: Workpiece[];

  if (removable && input.pair) {
    const pairId = uid('pair');
    created = (['upper', 'lower'] as Arch[]).map((arch) => ({
      ...base,
      id: uid('w'),
      arch,
      pairId,
      detail: removableDetail(arch),
    }));
  } else if (removable) {
    created = [{ ...base, id: uid('w'), arch: 'upper', detail: removableDetail('upper') }];
  } else {
    const tooth = input.tooth?.trim() || '—';
    const suffix =
      input.type === 'PC' ? `Post-core crown (${base.variant} post)` : tooth.includes('–') || tooth.includes('-') ? 'Bridge' : meta.full;
    created = [{ ...base, id: uid('w'), tooth, detail: `${tooth} ${suffix}` }];
  }

  await db.workpieces.bulkAdd(created);
  await logAudit(`สร้างชิ้นงาน ${created.map((c) => c.detail).join(' + ')}`, input.actor, { studentId: input.studentId });
  return created;
}

// ── offline queue ──────────────────────────────────────

export async function listQueue(): Promise<QueueItem[]> {
  const items = await db.queue.toArray();
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface SyncNowResult {
  /** รายการ "รอส่ง" ที่หายออกจากรายการเพราะขึ้นครบจริง */
  cleared: number;
  /** รูปที่ขึ้นเซิร์ฟเวอร์สำเร็จรอบนี้ */
  photos: number;
  /** รูปที่ส่งไม่ผ่านรอบนี้ */
  photosFailed: number;
  /** แถวที่ยังค้างอยู่ในเครื่องหลังกดแล้ว — มากกว่า 0 คือ "ยังไม่ครบ" */
  stillPending: number;
}

/**
 * ผู้ใช้กด "sync ทันที"
 *
 * ⚠️ ป้ายหลอกตัวที่สาม — สองตัวแรกคือ addPhoto รุ่นแรกกับ syncNow ที่ตั้ง
 *    status='ok' ให้รูปทุกใบโดยไม่ส่งอะไร รอบนี้เป็นทีของ "แถวข้อมูล" เอง:
 *
 *    ① ปุ่มนี้ **ไม่เคยเรียกตัวส่งข้อมูลจริงเลย** — `flushNow()` ใน cloudSync.ts
 *       เขียนคอมเมนต์กำกับตัวเองไว้ว่า "ใช้ตอนผู้ใช้กด sync เอง" แต่ไม่มีใครเรียก
 *       แถวจึงขึ้นตอนรอบ 15 วิ ถัดไปเท่านั้น กดปุ่มแล้วไม่เกิดอะไรขึ้นทันที
 *    ② แล้วมันประทับ syncedAt ให้ทุกแถว + ล้างรายการ "รอส่ง" + จด audit ว่าสำเร็จ
 *       **โดยไม่รู้ผลจริง** navigator.onLine เป็น true ได้ทั้งที่ยิงไม่ถึงเซิร์ฟเวอร์
 *       (เน็ตคลินิกที่ต่อติดแต่ไม่ออกเน็ต · captive portal · เซิร์ฟเวอร์ล่ม)
 *       ผู้ใช้จึงเสียสัญญาณเดียวที่บอกว่างานยังไม่ปลอดภัย แล้วไปรู้ตัวตอนเปิดจากอีกเครื่อง
 *
 *    ตอนนี้: ส่งจริงก่อน → ถามว่าเหลือค้างกี่แถว → **ล้างรายการเฉพาะตอนขึ้นครบจริง**
 *    ยังไม่ครบก็คงรายการไว้และบอกตรง ๆ ว่าเหลือเท่าไร
 *
 * การอัปโหลดต้องอยู่นอก transaction — ยิงเน็ตในระหว่างที่ถือ transaction ของ Dexie ค้างไว้
 * ทำให้ธุรกรรมค้างยาวเป็นวินาทีบนเน็ตคลินิก แล้วการเขียนอื่นทั้งแอปรอตาม
 */
export async function syncNow(actor: string): Promise<SyncNowResult> {
  const items = await db.queue.toArray();
  const photos = await uploadPendingPhotos();
  // ส่งแถวข้อมูลขึ้นเดี๋ยวนี้ (และปลุก pump hook ที่เหลือ) — ขั้นที่เคยหายไป
  await flushNow();

  const stillPending = pendingPushCount();
  /* ขึ้นครบ = ไม่มีแถวค้าง และไม่มีรูปที่ส่งไม่ผ่านรอบนี้
     โหมด local/เดโมไม่ได้ติดตั้ง middleware จึงได้ 0 เสมอ — พฤติกรรมเดโมคงเดิม */
  const drained = stillPending === 0 && photos.failed === 0;

  if (!items.length && !photos.uploaded && !photos.failed && !stillPending) {
    return { cleared: 0, photos: 0, photosFailed: 0, stillPending: 0 };
  }

  await db.transaction('rw', [db.queue, db.updates, db.audit], async () => {
    if (drained) {
      const unsynced = await db.updates.filter((u) => u.syncedAt === null).toArray();
      await db.updates.bulkPut(unsynced.map((u) => ({ ...u, syncedAt: new Date().toISOString() })));
      await db.queue.clear();
    }
    await db.audit.add({
      id: uid('a'),
      text: drained
        ? `sync ข้อมูลค้าง ${items.length} รายการ · รูป ${photos.uploaded} ใบขึ้นเซิร์ฟเวอร์`
        : `sync ยังไม่ครบ — เหลือค้าง ${stillPending} แถว · รูปส่งไม่ผ่าน ${photos.failed} ใบ`,
      who: actor,
      at: new Date().toISOString(),
    });
  });

  return {
    cleared: drained ? items.length : 0,
    photos: photos.uploaded,
    photosFailed: photos.failed,
    stillPending,
  };
}

/** workpieceId ที่ยังมีรายการค้างในคิว */
export async function pendingIds(): Promise<Set<string>> {
  const items = await db.queue.toArray();
  return new Set(items.map((i) => i.workpieceId));
}

// ── รูป ─────────────────────────────────────────────────

export async function listPhotos(studentId: string): Promise<Array<Photo & { detail: string }>> {
  const works = await db.workpieces.where('studentId').equals(studentId).toArray();
  const byId = new Map(works.map((w) => [w.id, w]));
  const photos = await db.photos.toArray();
  return photos
    .filter((p) => byId.has(p.workpieceId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({ ...p, detail: byId.get(p.workpieceId)?.detail ?? '' }));
}

/**
 * แนบรูปงานเข้ากับ step ปัจจุบันของชิ้นงาน
 *
 * เดิมฟังก์ชันนี้ไม่รับไฟล์เลย — สร้างแถวเปล่าพร้อม "ขนาดไฟล์" ที่สุ่มขึ้นมา
 * หน้าจอจึงขึ้นว่า "อัปโหลดรูปแล้ว" ทั้งที่ไม่มีรูปอยู่จริงสักใบ
 *
 * ตอนนี้ไบต์ลงตาราง blobs ในเครื่องก่อนเสมอ (ตารางนั้นไม่ sync) แล้วค่อยขึ้น Storage
 * ถ่ายตอนออฟไลน์ข้างเก้าอี้คนไข้ได้ปกติ — ไม่ต้องมีเน็ตถึงจะกดถ่ายได้
 *
 * ⚠️ status ตั้งต้นห้ามเป็น 'ok' เด็ดขาด ไม่ว่าจะออนไลน์อยู่หรือไม่
 *    'ok' เขียนได้จากที่เดียวในระบบคือหลัง storage ตอบรับ (photoStore.uploadOne)
 *
 * ไม่รับ offline แล้ว — ออนไลน์หรือไม่ไม่เปลี่ยนสิ่งที่ฟังก์ชันนี้ทำเลย (ลงเครื่องเหมือนกัน)
 * การตัดสินใจว่า "จะส่งขึ้นเดี๋ยวนี้ไหม" ย้ายไปอยู่ที่ผู้เรียก เพราะมันต้องรอผลไปบอกผู้ใช้
 */
export async function addPhoto(
  workpieceId: string,
  image: { blob: Blob; bytes: number },
): Promise<Photo | null> {
  const w = await db.workpieces.get(workpieceId);
  if (!w) return null;
  const cur = procAt(w, Math.max(0, w.procIndex));
  const photo: Photo = {
    id: uid('ph'),
    workpieceId,
    progression: cur?.progression ?? 0,
    stepLabel: cur ? procLabel(w.type, cur) : typeMeta(w.type).prefix,
    sizeLabel: formatBytes(image.bytes),
    status: initialPhotoStatus(),
    createdAt: new Date().toISOString(),
  };
  // ไบต์ต้องลงเครื่องให้สำเร็จก่อนสร้างแถว ไม่งั้นได้แถวที่ชี้ไปยังรูปที่ไม่มีอยู่
  await putLocalBlob(photo.id, image.blob);
  await db.photos.add(photo);
  return photo;
}

/**
 * สถานะจริงของรูปใบเดียว — ให้หน้าจอรายงานผลตามของจริง
 * (เดิมปุ่ม "ลองส่งใหม่" ขึ้นข้อความสำเร็จทุกครั้ง ไม่ว่าจะส่งขึ้นหรือไม่)
 */
export async function getPhotoStatus(photoId: string): Promise<PhotoStatus | null> {
  const p = await db.photos.get(photoId);
  return p?.status ?? null;
}

/** นับว่ารูปชุดนี้ขึ้นคลาวด์ไปกี่ใบจริงๆ — นับจาก storagePath ไม่ใช่ status (ดูกติกา ① ใน photoStore) */
export async function countUploadedPhotos(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.photos.bulkGet(ids);
  return rows.filter((p) => p?.storagePath).length;
}

/** ผู้ใช้แตะรูปที่ขึ้นว่าส่งไม่สำเร็จ — ปลดใบนั้นแล้วลองส่งจริง (ไม่ใช่แค่เปลี่ยนป้าย) */
export async function retryPhoto(photoId: string): Promise<void> {
  await retryPhotoUpload(photoId);
}

// ── ฝั่งอาจารย์ ───────────────────────────────────────────────

export async function setReview(workpieceId: string, status: ReviewStatus, comment: string, by: string): Promise<void> {
  // อ่าน-แล้ว-เขียนต้องอยู่ใน transaction เดียว — กดปุ่มรัวสองทีเคยได้สองแถวซ้ำ
  await db.transaction('rw', db.reviews, async () => {
    const rows = await db.reviews.where('workpieceId').equals(workpieceId).toArray();
    /**
     * ⚠️ ห้ามลบแถวของอาจารย์ท่านอื่นทิ้ง
     *
     * เดิมตรงนี้ `for (const extra of rows.slice(1)) delete` เพื่อเก็บกวาด "แถวซ้ำ"
     * แต่แถวซ้ำไม่ได้มาจากบั๊กอย่างเดียว — อาจารย์สองท่านกดตัดสินชิ้นงานเดียวกัน
     * คนละเครื่อง ต่างคนต่างไม่เห็นแถวของอีกฝ่าย จึงสร้าง uid คนละตัว ได้สองแถวจริงๆ
     * แล้วบรรทัดนี้ก็ไปลบคำตัดสินจริงของอีกท่านทิ้งถาวร
     *
     * ตอนนี้: ทับได้เฉพาะใบของตัวเอง ของคนอื่นเก็บไว้ทั้งหมด
     * หน้าจอโชว์ใบล่าสุด + ป้ายบอกว่าเคยมีคำตัดสินอื่น (listReviewConflicts)
     */
    const mine = rows
      .filter((r) => r.by === by)
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0];
    const review: Review = {
      id: mine?.id ?? uid('rv'),
      workpieceId,
      status,
      comment,
      by,
      at: new Date().toISOString(),
    };
    await db.reviews.put(review);
  });
  const w = await db.workpieces.get(workpieceId);
  // status pending = แค่บันทึกคอมเมนต์ ไม่ใช่ตีกลับ — เคยลง audit ว่า "ตีกลับให้แก้" ทำประวัติน่าตกใจ
  const action = status === 'approved' ? 'อนุมัติ' : status === 'returned' ? 'ตีกลับให้แก้' : 'บันทึกคอมเมนต์ชิ้นงาน';
  await logAudit(`${action} ${w?.detail ?? workpieceId}`, by, { studentId: w?.studentId });
}

export async function listReviews(): Promise<Map<string, Review>> {
  return pickLatestReviews(await db.reviews.toArray());
}

/**
 * ชิ้นงานไหนมีคำตัดสินของอาจารย์ท่านอื่นถูกทับอยู่ — workpieceId → ใบที่ถูกทับ (ใหม่→เก่า)
 * ใช้ทำป้ายในหน้าตรวจงาน ไม่งั้นท่านที่ตัดสินไปก่อนจะไม่มีทางรู้ว่าของตัวเองถูกแทนที่
 */
export async function listReviewConflicts(): Promise<Map<string, Review[]>> {
  const byWork = new Map<string, Review[]>();
  for (const r of await db.reviews.toArray()) {
    const list = byWork.get(r.workpieceId);
    if (list) list.push(r); else byWork.set(r.workpieceId, [r]);
  }
  const out = new Map<string, Review[]>();
  for (const [id, rows] of byWork) {
    if (rows.length < 2) continue;
    out.set(id, rows.sort(byNewestReview).slice(1));
  }
  return out;
}






/**
 * ลบชิ้นงาน — ลบประวัติ step, รูป, คิว sync และผลตรวจของชิ้นนั้นทั้งหมด
 * ถ้าผู้ป่วยไม่เหลือชิ้นงานเลย ลบผู้ป่วยออกด้วย · การลบถูกบันทึกใน audit log เสมอ
 */
export async function deleteWorkpiece(workpieceId: string, actor: string): Promise<void> {
  const w = await db.workpieces.get(workpieceId);
  if (!w) return;

  // เก็บรายชื่อไฟล์ไว้ก่อนลบแถว — พอแถวหายแล้วจะไม่มีทางรู้ว่าไฟล์ไหนเป็นของชิ้นงานนี้
  // (ไฟล์ที่ค้างในบักเก็ตคือรูปในปากคนไข้ที่ไม่มีใครเป็นเจ้าของแล้ว ลบยากกว่าปล่อยไว้)
  const doomedPhotos = await db.photos.where('workpieceId').equals(workpieceId).toArray();

  await db.transaction(
    'rw',
    [db.workpieces, db.patients, db.updates, db.photos, db.queue, db.reviews, db.audit],
    async () => {
      await db.workpieces.delete(workpieceId);
      await db.updates.where('workpieceId').equals(workpieceId).delete();
      await db.photos.where('workpieceId').equals(workpieceId).delete();
      await db.queue.where('workpieceId').equals(workpieceId).delete();
      await db.reviews.where('workpieceId').equals(workpieceId).delete();

      const remaining = await db.workpieces.where('patientId').equals(w.patientId).count();
      if (remaining === 0) await db.patients.delete(w.patientId);

      await db.audit.add({
        id: uid('a'),
        text: `ลบชิ้นงาน ${w.detail}`,
        who: actor,
        at: new Date().toISOString(),
      });
    },
  );

  // นอก transaction — ยิงเน็ตระหว่างถือ transaction ค้างทำให้การเขียนอื่นทั้งแอปรอตาม
  await dropLocalBlobs(doomedPhotos.map((p) => p.id));
  await removePhotoFiles(doomedPhotos.flatMap((p) => (p.storagePath ? [p.storagePath] : [])));
}

// ── เช็คอินรายคาบ + ประเมิน ──────────────────────────────────

export interface CheckInInput {
  studentId: string;
  date: string;
  punctual: boolean;
  checkinAt?: string;
  photoCount?: number;
  noPatient: boolean;
  patientId?: string;
  activities: string[];
  note?: string;
  actor: string;
}

/**
 * เช็คอินคาบ — หนึ่งคนต่อหนึ่งวันได้ครั้งเดียวเท่านั้น
 *
 * บั๊กที่เจอตอนลองใช้จริง: การ์ดเช็คอินเป็นปุ่มแตะเดียวจบ ถ้ามือถือช้าแล้วนักศึกษาแตะซ้ำ
 * (ซึ่งเกิดแน่ๆ ตอน 9 โมงคนกำลังรีบ) จะได้เช็คอินซ้ำเท่าจำนวนครั้งที่แตะ
 * — แตะ 4 ที ได้ 4 รายการ อาจารย์เห็นชื่อเด็กคนเดียวโผล่ 4 แถวในหน้าประเมิน
 * ซึ่งพังงาน "กันประเมินผิดคน" ทั้งหมดที่ทำไว้
 *
 * กันที่ชั้นข้อมูล ไม่ใช่แค่ที่ปุ่ม เพราะ checkedInToday มาจาก liveQuery
 * กว่าจะ re-render ทัน แตะครั้งที่สองก็ผ่านไปแล้ว
 */
export async function addCheckIn(input: CheckInInput): Promise<CheckIn> {
  // วันที่จากช่องกรอกอาจเป็นอนาคตหรือว่าง — ประทับให้อยู่ในช่วงจริงก่อนใช้เป็นคีย์ของคาบ
  const date = clampPerformedAt(input.date, undefined);
  const existing = await db.checkins
    .where('studentId').equals(input.studentId)
    .and((c) => c.date === date)
    .first();
  if (existing) {
    /**
     * มีคาบของวันนี้อยู่แล้ว — เติมข้อมูลลงของเดิม ไม่สร้างใหม่ และไม่ทิ้งสิ่งที่ผู้ใช้พิมพ์
     *
     * สองทางที่มาถึงตรงนี้:
     *  1. แตะการ์ดเช็คอินรัวๆ — input ว่างเปล่า จึงไม่มีอะไรถูกทับ
     *  2. เปิดฟอร์มแล้วเลือกวันที่ที่เคยเช็คอินไว้ — ต้องเติมกิจกรรมลงคาบเดิม
     *     (ถ้า return เฉยๆ สิ่งที่ผู้ใช้เพิ่งพิมพ์จะหายพร้อมข้อความว่าบันทึกสำเร็จ)
     * เวลาเช็คอินและความตรงต่อเวลาไม่แตะ — ล็อกไว้ตั้งแต่ครั้งแรกแล้ว
     */
    const merged: CheckIn = {
      ...existing,
      activities: input.activities.length ? input.activities : existing.activities,
      // ระบุผู้ป่วยมาทีหลัง = ยกเลิกป้าย "ไม่มีผู้ป่วย" ที่ติดไว้ตอนเช็คอินด่วน (สองอย่างนี้จริงพร้อมกันไม่ได้)
      noPatient: input.patientId ? false : (input.noPatient || existing.noPatient),
      patientId: input.noPatient ? undefined : (input.patientId ?? existing.patientId),
      note: input.note?.trim() || existing.note,
    };
    const changed = JSON.stringify(merged) !== JSON.stringify(existing);
    if (changed) {
      await db.checkins.put(merged);
      const label = merged.activities.join(', ') || 'ไม่ระบุกิจกรรม';
      await logAudit(
        `เติมรายละเอียดคาบ ${checkInDateLabel(date)} · ${label}`,
        input.actor,
        { studentId: input.studentId },
      );
    }
    return merged;
  }

  const entry: CheckIn = {
    id: uid('ci'),
    studentId: input.studentId,
    date,
    punctual: input.punctual,
    checkinAt: input.checkinAt,
    photoCount: input.photoCount,
    noPatient: input.noPatient,
    patientId: input.noPatient ? undefined : input.patientId,
    activities: input.activities,
    note: input.note?.trim() || undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await db.checkins.add(entry);
  await logAudit(
    `เช็คอินคาบคลินิก ${checkInDateLabel(date)} · ${input.activities.join(', ') || 'ไม่ระบุกิจกรรม'}`,
    input.actor,
    { studentId: input.studentId },
  );
  return entry;
}

/** เติมรายละเอียดคาบทีหลัง — เช็คอินด่วนแตะเดียวเก็บแค่เวลา แล้วค่อยมาบอกว่าทำอะไร */
export async function updateCheckIn(
  id: string,
  patch: { activities: string[]; patientId?: string; noPatient?: boolean; note?: string },
  actor: string,
): Promise<void> {
  const before = await db.checkins.get(id);
  // ประเมินแล้ว = คะแนนออกแล้ว ห้ามนักศึกษาแก้ย้อน (กันไว้ชั้นข้อมูล เผื่อ UI พลาด)
  if (before?.status === 'evaluated') return;
  await db.checkins.update(id, {
    activities: patch.activities,
    noPatient: !!patch.noPatient,
    patientId: patch.noPatient ? undefined : patch.patientId,
    note: patch.note?.trim() || undefined,
  });
  const row = await db.checkins.get(id);
  // กดปุ่มบันทึกซ้ำโดยไม่ได้แก้อะไร ไม่ควรงอกบรรทัดใน audit — ประวัติต้องอ่านแล้วเชื่อได้
  if (before && row && JSON.stringify(before) === JSON.stringify(row)) return;
  // แก้จริง → ประทับเวลาไว้ ป้าย "แก้ไขล่าสุด" ฝั่งอาจารย์อ่านจากตรงนี้
  await db.checkins.update(id, { editedAt: new Date().toISOString() });
  await logAudit(
    // ต้องมีวันที่ ไม่งั้นย้อนดูไม่ออกว่าแก้คาบไหน (บรรทัดอื่นในระบบมีวันที่หมด)
    `เติมรายละเอียดคาบ ${checkInDateLabel(row?.date ?? '')} · ${patch.activities.join(', ') || 'ไม่ระบุกิจกรรม'}`,
    actor,
    { studentId: row?.studentId },
  );
}

/**
 * วันที่สำหรับข้อความใน audit log
 * - ต้องมีปีด้วย เพราะหลักสูตร 2 ปี "23/8" เฉยๆ ย้อนดูแล้วแยกไม่ออกว่าปีไหน
 * - กันวันที่เสีย ไม่งั้นได้ "NaN/NaN" ฝังอยู่ในประวัติที่ลบไม่ได้
 */
function checkInDateLabel(iso: string): string {
  // วันล้วนต้อง parse แบบท้องถิ่น — new Date('YYYY-MM-DD') คือเที่ยงคืน UTC (ดูคอมเมนต์ asDate ใน lib/date)
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso);
  if (Number.isNaN(d.getTime())) return '(ไม่ทราบวันที่)';
  const be = String(d.getFullYear() + 543).slice(-2);
  return `${d.getDate()}/${d.getMonth() + 1}/${be}`;
}

export async function listCheckIns(studentId: string): Promise<CheckIn[]> {
  const rows = await db.checkins.where('studentId').equals(studentId).toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function listAllCheckIns(): Promise<CheckIn[]> {
  const rows = await db.checkins.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * ด่านสุดท้ายของ "อ่านอย่างเดียว" สำหรับรุ่นที่เรียนจบแล้ว — เช็คที่ชั้นข้อมูล
 * ไม่ใช่แค่ปิดปุ่มบนหน้าจอ เพราะปุ่มอาจถูกลืมปิดหรือเข้ามาทางลิงก์ตรง
 */
async function isGraduatedStudent(studentId: string): Promise<boolean> {
  const st = await db.students.get(studentId);
  return st ? isAlumni(st) : false;
}

export type EvaluateResult =
  | { ok: true }
  | { ok: false; reason: 'missing' }
  /** นักศึกษาเรียนจบไปแล้ว — ข้อมูลรุ่นเก่าเป็นประวัติที่ปิดจบ ห้ามเขียนทับ */
  | { ok: false; reason: 'graduated' }
  /** มีอาจารย์อีกท่านลงคะแนนคาบนี้ไปแล้ว — ไม่เขียนทับ ให้ UI เตือนก่อน */
  | { ok: false; reason: 'already'; by: string };

export async function evaluateCheckIn(
  id: string,
  scores: Record<string, number>,
  by: string,
): Promise<EvaluateResult> {
  const row = await db.checkins.get(id);
  if (!row) return { ok: false, reason: 'missing' };
  // กันสองอาจารย์ลงคะแนนคาบเดียวกันพร้อมกัน (last-write-wins จะทำให้คะแนนของคนแรกหายเงียบ)
  if (row.status === 'evaluated') return { ok: false, reason: 'already', by: row.evaluatedBy ?? '' };
  if (await isGraduatedStudent(row.studentId)) return { ok: false, reason: 'graduated' };

  await db.checkins.put({
    ...row,
    scores,
    status: 'evaluated',
    evaluatedBy: by,
    evaluatedAt: new Date().toISOString(),
  });
  // ระบุชื่อ นศ. ใน audit log — ถ้าเกิดประเมินผิดคน จะย้อนดูได้ว่าใครลงให้ใครเมื่อไหร่
  const student = await db.students.get(row.studentId);
  await logAudit(
    `ประเมินคาบ ${checkInDateLabel(row.date)} ของ ${student?.name ?? row.studentId}`,
    by,
    { studentId: row.studentId },
  );
  return { ok: true };
}

/**
 * แก้คะแนนคาบที่ประเมินไปแล้ว
 *
 * ทำไมต้องมี: เดิมลงคะแนนแล้วแก้ไม่ได้เลย — อาจารย์กดพลาดทีต้องให้คนดูแลระบบไปแก้ที่ฐานข้อมูล
 * ซึ่งใช้กับผู้ใช้ 96 คนไม่ได้ การ "กันไม่ให้กดผิด" กับ "แก้ได้เมื่อกดผิดไปแล้ว" เป็นคนละเรื่อง
 *
 * หลัก: แก้ได้ แต่ทุกครั้งทิ้งร่องรอย — audit บันทึกค่าเดิม→ค่าใหม่รายหัวข้อ และลบไม่ได้
 * ใครแก้ได้: อาจารย์ท่านใดก็ได้ (อาจารย์เวรสลับกัน คนที่ประเมินเดิมอาจไม่อยู่แล้ว)
 */
export type ReviseResult =
  | { ok: true; changed: number }
  | { ok: false; reason: 'missing' }
  /** คาบนี้ยังไม่เคยประเมิน — ต้องใช้ evaluateCheckIn ไม่ใช่ตัวนี้ */
  | { ok: false; reason: 'not-evaluated' }
  /** นักศึกษาเรียนจบไปแล้ว — แก้คะแนนย้อนหลังไม่ได้ */
  | { ok: false; reason: 'graduated' }
  | { ok: false; reason: 'nochange' };

export async function reviseCheckIn(
  id: string,
  scores: Record<string, number>,
  by: string,
): Promise<ReviseResult> {
  const row = await db.checkins.get(id);
  if (!row) return { ok: false, reason: 'missing' };
  if (row.status !== 'evaluated') return { ok: false, reason: 'not-evaluated' };
  if (await isGraduatedStudent(row.studentId)) return { ok: false, reason: 'graduated' };

  const before = row.scores ?? {};
  const diffs = CRITERIA
    .filter((cr) => (before[cr.key] ?? 0) !== (scores[cr.key] ?? 0))
    .map((cr) => `${cr.label} ${before[cr.key] ?? 0}→${scores[cr.key] ?? 0}`);
  if (!diffs.length) return { ok: false, reason: 'nochange' };

  const wasBy = row.evaluatedBy ?? '';
  await db.checkins.put({
    ...row,
    scores,
    // ผู้ประเมินเปลี่ยนเป็นคนที่แก้ล่าสุด — คนนี้คือคนที่รับผิดชอบคะแนนชุดที่อยู่ในระบบตอนนี้
    evaluatedBy: by,
    evaluatedAt: new Date().toISOString(),
  });

  const student = await db.students.get(row.studentId);
  await logAudit(
    `แก้คะแนนคาบ ${checkInDateLabel(row.date)} ของ ${student?.name ?? row.studentId}`
      + ` · ${diffs.join(', ')}`
      + ` · รวม ${totalScore(before) ?? 0}→${totalScore(scores) ?? 0}`
      + (wasBy && wasBy !== by ? ` (เดิมประเมินโดย ${wasBy})` : ''),
    by,
    { studentId: row.studentId },
  );
  return { ok: true, changed: diffs.length };
}

/**
 * แก้ป้าย "มาสาย" ของคาบที่เช็คอินไปแล้ว — อาจารย์เท่านั้น
 *
 * ทำไมต้องมี: `punctual` คิดครั้งเดียวตอนกดเช็คอิน
 * จากเวลาเครื่อง (เช้าเกิน 09:15 / บ่ายเกิน 13:15 = สาย) แล้วแก้ไม่ได้อีกเลย
 * นักศึกษาที่มาคาบบ่ายจริงแต่ลืมเช็คอินจนตอนเย็น จะถูกบันทึกว่า "มาสาย" ถาวร
 * แล้วหน้าประเมินตนเองขึ้นการ์ด "มาสายบ่อยกว่าที่คิด" ให้อาจารย์อ่าน (`domain/saFeedback.ts`)
 * = ระบบกล่าวหาเขาด้วยข้อมูลที่ผิด และไม่มีใครมีทางแก้ให้เลย
 *
 * หลักเดียวกับ `reviseCheckIn`: **แก้ได้ แต่ทุกครั้งทิ้งร่องรอย** — audit บันทึกค่าเดิม→ค่าใหม่
 * พร้อมเวลาเช็คอินจริงที่ใช้ตัดสิน และเหตุผลที่อาจารย์พิมพ์ · แถว audit ลบไม่ได้
 *
 * ⚠️ **ไม่แตะ `checkinAt`** — เวลาที่ระบบจับได้เป็นข้อเท็จจริง ห้ามเขียนทับ
 * ที่แก้คือ "คำตัดสิน" ว่านับเป็นสายไหม ไม่ใช่ "เวลาที่เขามาถึง"
 * (ฝั่งเซิร์ฟเวอร์ trigger ของ 0020 ก็ยอมให้อาจารย์เท่านั้นเขียนช่องนี้)
 */
export type PunctualResult =
  | { ok: true }
  | { ok: false; reason: 'missing' }
  /** นักศึกษาเรียนจบไปแล้ว — แก้ย้อนหลังไม่ได้ (ด่านเดียวกับการแก้คะแนน) */
  | { ok: false; reason: 'graduated' }
  | { ok: false; reason: 'nochange' };

export async function setCheckInPunctual(
  id: string,
  punctual: boolean,
  by: string,
  note?: string,
): Promise<PunctualResult> {
  const row = await db.checkins.get(id);
  if (!row) return { ok: false, reason: 'missing' };
  if (row.punctual === punctual) return { ok: false, reason: 'nochange' };
  if (await isGraduatedStudent(row.studentId)) return { ok: false, reason: 'graduated' };

  await db.checkins.put({ ...row, punctual });

  const student = await db.students.get(row.studentId);
  await logAudit(
    `แก้ป้ายตรงต่อเวลาคาบ ${checkInDateLabel(row.date)} ของ ${student?.name ?? row.studentId}`
      + ` · ${row.punctual ? 'ตรงเวลา' : 'มาสาย'}→${punctual ? 'ตรงเวลา' : 'มาสาย'}`
      + (row.checkinAt ? ` · เวลาที่ระบบจับได้ ${row.checkinAt}` : '')
      + (note?.trim() ? ` · เหตุผล: ${note.trim()}` : ''),
    by,
    { studentId: row.studentId },
  );
  return { ok: true };
}

export async function deleteCheckIn(id: string, actor: string): Promise<void> {
  const row = await db.checkins.get(id);
  if (!row) return;
  await db.checkins.delete(id);
  await logAudit(`ลบเช็คอินคาบ ${checkInDateLabel(row.date)}`, actor, { studentId: row.studentId });
}

/** step ที่นักศึกษากดผ่านจริงในวันนั้น (ไม่รวมรายการเลิกทำ) — ใช้เชื่อมเช็คอินกับงานจริง */
export async function stepsOnDate(studentId: string, date: string): Promise<string[]> {
  const works = await db.workpieces.where('studentId').equals(studentId).toArray();
  const byId = new Map(works.map((w) => [w.id, w]));
  const ids = works.map((w) => w.id);
  if (!ids.length) return [];
  const updates = await db.updates.where('workpieceId').anyOf(ids).toArray();
  return updates
    .filter((u) => !u.reversal && u.performedAt === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((u) => {
      const w = byId.get(u.workpieceId);
      if (!w) return [];
      const proc = procAt(w, u.procIndex);
      return proc ? [procLabel(w.type, proc)] : [];
    });
}

/* ══════════════════════════════════════════════════════════════════
   เก็บข้อมูลย้อนหลังเท่าที่ภาคกำหนด แล้วลบรุ่นที่เกิน (PDPA · retention)
   ภาคยืนยัน: "จัดเก็บข้อมูลไว้ประมาณ 5 ปี"
   ⚠️ "ประมาณ 5 ปี" ยังไม่ใช่มติภาค — ตัวเลขจริงกับจุดเริ่มนับยังค้างอยู่ (ดู README)
      ระบบจึงล็อกไว้: ตราบใดที่ pdpa_policy.retention_enabled = false ลบอะไรไม่ได้เลย

   ลบสองฝั่งเสมอ:
     · ฝั่งเซิร์ฟเวอร์ ลบด้วย RPC purge_expired_cohorts (migration 0016) ในธุรกรรมเดียว
     · ฝั่งเครื่อง ลบจาก IndexedDB ของเครื่องที่กดปุ่ม
   ทำไมต้องทำทั้งสองฝั่งแทนที่จะพึ่งคิว sync อย่างเดียว — เหตุผลเต็มอยู่ในหัว 0016 ข้อ ⑥
   สรุปสั้นๆ: คิว sync ลบได้เฉพาะแถวที่ "มีอยู่ในเครื่องนี้" และล้มเหลวแบบเงียบได้หลายทาง
   ══════════════════════════════════════════════════════════════════ */

export interface RetentionReport {
  /** รุ่นที่ยังอยู่ในช่วงเก็บ (ใหม่ → เก่า) */
  keep: number[];
  /** รุ่นที่เกินกำหนดเก็บแล้ว พร้อมจำนวนข้อมูลที่จะถูกลบ */
  expired: Array<{ cohort: number; students: number; workpieces: number; checkins: number }>;
  /** เก็บย้อนหลังกี่รุ่นตามนโยบายที่ใช้อยู่ */
  keepCohorts: number;
  /** ภาคเปิดใช้การลบตามกำหนดเก็บแล้วหรือยัง — false = ปุ่มลบต้องกดไม่ได้ */
  enabled: boolean;
  /**
   * คนที่ไม่มี entryYear — เดารุ่นไม่ได้ จึงไม่ลบ
   * ตั้งใจให้เห็นเป็นตัวเลข ไม่ใช่เงียบไป: ถ้ามีคนค้างตรงนี้แปลว่าข้อมูลนำเข้ามาไม่ครบ
   * ต้องไปเติมรุ่นให้ก่อน ไม่ใช่ปล่อยให้ retention คิดว่าลบครบแล้วทั้งที่ยังเหลือ
   */
  undated: number;
}

/** สำรวจว่ามีรุ่นไหนเกินกำหนดเก็บบ้าง — ดูอย่างเดียว ยังไม่ลบ */
export async function retentionReport(asOf: Date = new Date()): Promise<RetentionReport> {
  const pol = pdpaPolicy();
  const students = await db.students.toArray();
  const keep = new Set<number>();
  const expiredIds = new Map<number, string[]>();
  let undated = 0;
  students.forEach((s) => {
    if (!s.entryYear) { undated++; return; }
    const c = cohortOf(s, asOf);
    if (isWithinRetention(c, asOf, pol.retentionCohorts)) keep.add(c);
    else expiredIds.set(c, [...(expiredIds.get(c) ?? []), s.id]);
  });

  const expired: RetentionReport['expired'] = [];
  for (const [cohort, ids] of [...expiredIds.entries()].sort((a, b) => b[0] - a[0])) {
    const idSet = new Set(ids);
    const works = await db.workpieces.filter((w) => idSet.has(w.studentId)).count();
    const checks = await db.checkins.filter((c) => idSet.has(c.studentId)).count();
    expired.push({ cohort, students: ids.length, workpieces: works, checkins: checks });
  }
  return {
    keep: [...keep].sort((a, b) => b - a),
    expired,
    keepCohorts: pol.retentionCohorts,
    enabled: pol.retentionEnabled,
    undated,
  };
}

export interface PurgeResult {
  cohorts: number[];
  students: number;
  /** ลบฝั่งเซิร์ฟเวอร์สำเร็จไหม — false ในโหมด local (ไม่มีเซิร์ฟเวอร์) ก็ถือว่าปกติ */
  server: 'ok' | 'skipped' | 'failed';
  /** เหตุผลที่เซิร์ฟเวอร์ปฏิเสธ — ต้องเอาไปโชว์ ห้ามกลืน */
  serverError?: string;
}

/**
 * ลบข้อมูลของรุ่นที่เกินกำหนดเก็บ — ลบจริง กู้คืนไม่ได้
 *
 * ลำดับสำคัญ: ลบฝั่งเซิร์ฟเวอร์ให้สำเร็จก่อน แล้วค่อยลบในเครื่อง
 * ถ้าทำกลับกันแล้วเซิร์ฟเวอร์ปฏิเสธ เครื่องนี้จะว่างแต่ตู้กลางยังเต็ม
 * แล้ว pullAll รอบถัดไปจะดึงกลับลงมาทั้งหมด — ผู้ใช้เห็นว่า "ลบแล้วมันกลับมา" โดยไม่รู้สาเหตุ
 */
export async function purgeExpiredCohorts(by: string, asOf: Date = new Date()): Promise<PurgeResult> {
  const pol = pdpaPolicy();
  if (!pol.retentionEnabled) {
    // ไม่ throw — หน้าจอกันไว้อยู่แล้ว ตรงนี้เป็นด่านสุดท้ายเผื่อ UI พลาด
    return { cohorts: [], students: 0, server: 'skipped', serverError: 'ภาควิชายังไม่ได้เปิดใช้การลบตามกำหนดเก็บ' };
  }

  const students = await db.students.toArray();
  // ไม่มี entryYear = เดารุ่นไม่ได้ ห้ามลบ (ลบผิดคนคือความเสียหายที่กู้ไม่ได้)
  const doomed = students.filter((s) => !!s.entryYear && !isWithinRetention(cohortOf(s, asOf), asOf, pol.retentionCohorts));
  if (!doomed.length) return { cohorts: [], students: 0, server: 'skipped' };

  const ids = new Set(doomed.map((s) => s.id));
  const cohorts = [...new Set(doomed.map((s) => cohortOf(s, asOf)))].sort((a, b) => b - a);

  // ① ฝั่งเซิร์ฟเวอร์ก่อน — ล้มเหลวแล้วหยุด ไม่แตะข้อมูลในเครื่อง
  let server: PurgeResult['server'] = 'skipped';
  let serverError: string | undefined;
  if (cloudEnabled && supabase) {
    const { error } = await supabase.rpc('purge_expired_cohorts', { p_confirm: 'ลบถาวร' });
    if (error) return { cohorts: [], students: 0, server: 'failed', serverError: error.message };
    server = 'ok';
  }

  // ② แล้วค่อยฝั่งเครื่อง — ตารางลูกทุกใบที่ผูกกับนักศึกษาคนนั้น ไม่ให้เหลือเศษข้อมูลกำพร้า
  const patients = await db.patients.filter((p) => ids.has(p.ownerStudentId)).toArray();
  const patientIds = new Set(patients.map((p) => p.id));
  const works = await db.workpieces.filter((w) => ids.has(w.studentId)).toArray();
  const workIds = new Set(works.map((w) => w.id));
  // ต้องอ่านก่อนลบแถว — หลังลบแล้วไม่มีทางรู้ว่าไฟล์ไหนในบักเก็ตเป็นของรุ่นนี้
  // (retention คือการลบ "ให้หมด" ตามกรอบ PDPA รูปในปากคนไข้ค้างไว้ไม่ได้)
  const doomedPhotos = await db.photos.filter((ph) => workIds.has(ph.workpieceId)).toArray();

  await db.transaction(
    'rw',
    [db.students, db.patients, db.workpieces, db.checkins, db.updates, db.photos, db.groups,
     db.reviews, db.submissions, db.issues, db.queue, db.selfAssessments, db.sect2, db.sect3],
    async () => {
      await db.checkins.filter((c) => ids.has(c.studentId)).delete();
      await db.updates.filter((u) => workIds.has(u.workpieceId)).delete();
      await db.photos.filter((ph) => workIds.has(ph.workpieceId)).delete();
      // สามใบนี้เคยตกหล่น — ผลตรวจงานกับผลประเมิน portfolio ค้างอยู่หลังลบเจ้าของทิ้งไปแล้ว
      await db.reviews.filter((r) => workIds.has(r.workpieceId)).delete();
      await db.submissions.filter((sb) => ids.has(sb.studentId)).delete();
      await db.issues.filter((is) => ids.has(is.studentId)).delete();
      await db.queue.filter((q) => workIds.has(q.workpieceId)).delete();
      await db.selfAssessments.filter((sa) => ids.has(sa.studentId)).delete();
      await db.sect2.filter((r) => ids.has(r.studentId)).delete();
      await db.sect3.filter((r) => ids.has(r.studentId)).delete();
      await db.workpieces.bulkDelete([...workIds]);
      await db.patients.bulkDelete([...patientIds]);
      await db.students.bulkDelete([...ids]);
      // กลุ่มที่ไม่เหลือสมาชิกแล้วก็ลบทิ้ง ไม่งั้นค้างเป็นกลุ่มว่าง
      const groups = await db.groups.toArray();
      const remaining = await db.students.toArray();
      const liveGroups = new Set(remaining.map((s) => s.group));
      await db.groups.bulkDelete(groups.filter((g) => !liveGroups.has(g.code)).map((g) => g.code));
    },
  );

  await dropLocalBlobs(doomedPhotos.map((p) => p.id));
  /**
   * โหมด cloud: purge_expired_cohorts (0016) ลบแถว photos ฝั่งเซิร์ฟเวอร์ไปแล้ว
   * ซึ่ง trigger ใน 0018 จะเก็บกวาด storage.objects ตามให้ — แต่ยังเรียกซ้ำตรงนี้
   * เพราะทางนี้ลบไบต์จริงผ่าน Storage API ส่วน trigger ลบได้แค่แถว metadata
   */
  await removePhotoFiles(doomedPhotos.flatMap((p) => (p.storagePath ? [p.storagePath] : [])));

  // โหมด cloud ไม่ต้องจดซ้ำ — purge_expired_cohorts จดแถว audit ให้แล้วด้วยเวลาของเซิร์ฟเวอร์
  if (server !== 'ok') {
    await logAudit(`ลบข้อมูลรุ่นที่เกินกำหนดเก็บ: ${cohorts.map((c) => `DTMU${c - 2514}`).join(', ')} · ${doomed.length} คน`, by);
  }
  return { cohorts, students: doomed.length, server, serverError };
}

/* ══════════════════════════════════════════════════════════════════
   นำเข้ารายชื่อนักศึกษารุ่นใหม่ (roster) — ภาคส่งรายชื่อมาทุกปี
   ภาคยืนยัน: "DTMU56 และต่อๆ ไปเดี๋ยวมี roster ให้"
   ══════════════════════════════════════════════════════════════════ */

/* ตัวอ่านข้อความรายชื่อย้ายไป lib/rosterParse.ts — เป็นการแปลงข้อความล้วน ไม่แตะฐานข้อมูล
   จึงเทสต์ได้ตรงๆ โดยไม่ต้องมี IndexedDB · ยังส่งต่อชื่อเดิมออกไปให้หน้าจอที่ import จากที่นี่ */
export { parseRoster } from '../lib/rosterParse';
export type { RosterRow, RosterParseResult } from '../lib/rosterParse';
import type { RosterRow } from '../lib/rosterParse';

export interface RosterImportResult {
  added: number;
  updated: number;
  cohort: number;
  /** รหัสนักศึกษา → id ในระบบ (ใช้ผูกอีเมลเข้ารายชื่อเชิญต่อ) */
  idByCode: Record<string, string>;
}

/**
 * บันทึกรายชื่อเข้าระบบ — รหัสที่มีอยู่แล้วจะอัปเดต (ย้ายกลุ่ม/แก้ชื่อ) ไม่สร้างซ้ำ
 * @param dtmu เลขรุ่นของรายชื่อชุดนี้ (ใช้เมื่อแถวไม่ได้ระบุมาเอง)
 */
export async function importRoster(rows: RosterRow[], dtmu: number, by: string): Promise<RosterImportResult> {
  const existing = await db.students.toArray();
  const byCode = new Map(existing.map((s) => [s.code, s]));
  const groups = await db.groups.toArray();
  const groupByCode = new Map(groups.map((g) => [g.code, g]));

  let added = 0;
  let updated = 0;
  const toPut: Student[] = [];
  const newGroups: ClinicGroup[] = [];

  rows.forEach((r) => {
    const entryYear = entryYearFromDtmu(r.dtmu ?? dtmu);
    // รหัสกลุ่มติด tag รุ่น เพื่อไม่ให้ PT1 ของคนละรุ่นชนกัน
    const groupCode = groupCodeFor(r.dtmu ?? dtmu, r.group);
    const prev = byCode.get(r.code);
    if (prev) {
      /* ไม่มีชื่ออังกฤษมาในรอบนี้ = คงของเดิม (รายชื่อบางชุดมีแค่ชื่อไทย) */
      // ไม่แตะ year ของคนเดิม — ชั้นปีจริงคิดจาก entryYear (studentYear) · เดิมบังคับ 5 ทับทุกครั้งที่นำเข้าซ้ำ
      toPut.push({ ...prev, name: r.name, ...(r.nameEn ? { nameEn: r.nameEn } : {}), group: groupCode, entryYear });
      updated++;
    } else {
      toPut.push({
        id: studentIdFor(groupCode, r.code),
        code: r.code,
        name: r.name,
        /* ใส่ช่องเฉพาะเมื่อมีค่า — แถวที่ไม่มีช่องนี้ส่งขึ้นเซิร์ฟเวอร์ที่ยังไม่รัน 0025 ได้ตามเดิม */
        ...(r.nameEn ? { nameEn: r.nameEn } : {}),
        group: groupCode,
        year: 5,
        entryYear,
        advisorIds: groupByCode.get(groupCode)?.advisorIds ?? ['', ''],
      });
      added++;
    }
    if (!groupByCode.has(groupCode) && !newGroups.some((g) => g.code === groupCode)) {
      newGroups.push({ code: groupCode, advisorIds: ['', ''], studentIds: [] });
    }
  });

  await db.transaction('rw', [db.students, db.groups], async () => {
    if (newGroups.length) await db.groups.bulkPut(newGroups);
    await db.students.bulkPut(toPut);
    // อัปเดตรายชื่อสมาชิกของกลุ่มให้ตรงกับความจริง
    const all = await db.students.toArray();
    const groupsNow = await db.groups.toArray();
    await db.groups.bulkPut(groupsNow.map((g) => ({ ...g, studentIds: all.filter((s) => s.group === g.code).map((s) => s.id) })));
  });

  await logAudit(`นำเข้ารายชื่อ DTMU${dtmu}: เพิ่ม ${added} คน · อัปเดต ${updated} คน`, by);
  return { added, updated, cohort: entryYearFromDtmu(dtmu), idByCode: Object.fromEntries(toPut.map((s) => [s.code, s.id])) };
}


/**
 * บันทึกรายชื่ออาจารย์จากแท็บ "อาจารย์" ของแบบฟอร์ม
 * id มาจากหน้าจอ (id ในรายชื่อเชิญเดิม หรือสร้างจากอีเมล — teacherIdFromEmail) · มีอยู่แล้ว = อัปเดตชื่อ
 * ไม่มีชื่ออังกฤษมาในรอบนี้ = คงของเดิม · สิทธิ์เข้าระบบ (invites) หน้าจอทำต่อเอง เพราะต้องต่อเซิร์ฟเวอร์
 */
export async function importTeachers(
  rows: ReadonlyArray<{ id: string; name: string; title?: string; nameEn?: string }>,
  by: string,
): Promise<{ added: number; updated: number }> {
  const prev = await db.teachers.bulkGet(rows.map((r) => r.id));
  let added = 0;
  const toPut = rows.map((r, i) => {
    const old = prev[i];
    if (!old) added++;
    return {
      ...(old ?? {}),
      id: r.id,
      name: r.name,
      ...(r.title ? { title: r.title } : {}),
      ...(r.nameEn ? { nameEn: r.nameEn } : {}),
    };
  });
  await db.teachers.bulkPut(toPut);
  const updated = rows.length - added;
  // audit ไม่ใส่ชื่อ/อีเมล — จำนวนพอให้ตามย้อนได้ว่าใครนำเข้าเมื่อไหร่
  await logAudit(`นำเข้ารายชื่ออาจารย์: เพิ่ม ${added} ท่าน · อัปเดต ${updated} ท่าน`, by);
  return { added, updated };
}


/* ── นำเข้าทั้งรุ่นจากชีตจริง (local เท่านั้น) ─────────────────────────────
   ล้างข้อมูลเดโมออกก่อน (คงตาราง teachers/settings/audit ไว้ — session อาจารย์ไม่หลุด)
   แล้วลงรายชื่อนักศึกษา+กลุ่มจากแท็บ Student list ของชีต */
/** รุ่นจากรหัสนักศึกษา: "6504001" → เข้ามหาลัย 2565 → ขึ้นคลินิกปี 5 ปี 2569 = DTMU55 */
export function dtmuFromCode(code: string): number {
  return 2500 + Number(code.slice(0, 2)) + 4 - 2514;
}

/**
 * รุ่นของ "ชีตทั้งแผ่น" — ใช้เสียงข้างมากของรหัส ไม่ใช่รายคน
 *
 * ⚠️ ชีตชั้นปีหนึ่งมีนักศึกษาตกค้าง/ซ้ำชั้นจากรุ่นก่อนปนอยู่ได้ (ชีตปี 6 จริงมีรหัส 63 อยู่ 3 คน
 * ในกลุ่ม 64 จำนวน 84 คน) ถ้าคิดรุ่นรายคน คนเหล่านั้นจะถูกคำนวณเป็น
 * "ปี 7" แล้วหลุดไปกองรุ่นที่จบแล้วทันที ทั้งที่กำลังเรียนปี 6 อยู่จริง
 * จึงยึดว่า "ชีต = ชั้นเรียน" — ทุกคนในชีตอยู่ชั้นปีเดียวกัน
 */
export function cohortOfRoster(entries: ReadonlyArray<{ code: string }>): { dtmu: number; odd: string[] } {
  const votes = new Map<number, number>();
  entries.forEach((e) => {
    const d = dtmuFromCode(e.code);
    votes.set(d, (votes.get(d) ?? 0) + 1);
  });
  const dtmu = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 55;
  const odd = entries.filter((e) => dtmuFromCode(e.code) !== dtmu).map((e) => e.code);
  return { dtmu, odd };
}

export async function replaceWithRoster(
  entries: Array<{ code: string; name: string; group: string; advisor: string }>,
  actor: string,
  forceDtmu?: number,
): Promise<{ students: number; groups: number; dtmu: number; replaced: number; odd: string[] }> {
  const d = db;

  const detected = cohortOfRoster(entries);
  const dtmu = forceDtmu ?? detected.dtmu;
  const entryYear = dtmu + 2514;

  const groupsMap = new Map<string, { code: string; advisorIds: [string, string]; studentIds: string[] }>();
  const teachers = new Map<string, { id: string; name: string; title: string }>();
  const students = entries.map((e) => {
    const names = e.advisor.split('/').map((x) => x.trim()).filter(Boolean);
    const adv: string[] = names.slice(0, 2).map((n) => {
      // ชีตบางรุ่นใส่คำนำหน้า "อ." มาให้แล้ว (รุ่น 54) บางรุ่นไม่ใส่ (รุ่น 55)
      // ถ้าเติมทื่อๆ จะได้ "อ.อ.สมศักดิ์" — ตัดของเดิมออกก่อนเสมอ
      const bare = n.replace(/^(อ\.|อ|ผศ\.|รศ\.|ศ\.|ดร\.)\s*/g, '').trim() || n;
      const id = `tc-r${dtmu}-${bare}`;
      if (!teachers.has(id)) teachers.set(id, { id, name: `อ.${bare}`, title: 'อาจารย์ที่ปรึกษากลุ่ม' });
      return id;
    });
    while (adv.length < 2) adv.push(adv[0] ?? `tc-r${dtmu}-unknown`);
    // รหัสกลุ่มติด tag รุ่น — PT1 ของคนละรุ่นจะได้ไม่ชนกัน (รูปแบบเดียวกับหน้านำเข้ารายชื่อ)
    const groupCode = groupCodeFor(dtmu, e.group);
    const g = groupsMap.get(groupCode) ?? { code: groupCode, advisorIds: [adv[0], adv[1]] as [string, string], studentIds: [] };
    const sid = studentIdFor(groupCode, e.code);
    g.studentIds.push(sid);
    groupsMap.set(groupCode, g);
    return {
      id: sid, code: e.code, name: e.name, group: groupCode,
      year: 5, entryYear, advisorIds: [adv[0], adv[1]] as [string, string],
    };
  });

  let replaced = 0;
  const droppedPhotoIds: string[] = [];
  await d.transaction('rw', [d.students, d.groups, d.patients, d.workpieces, d.updates, d.photos, d.checkins, d.reviews, d.submissions, d.issues, d.queue, d.teachers, d.audit, d.selfAssessments, d.sect2, d.sect3], async () => {
    /* ⚠️ ล้างเฉพาะ "รุ่นนี้" — รุ่นอื่นที่นำเข้าไว้ก่อนต้องไม่หาย
       เดิมล้างทุกตาราง ทำให้นำเข้าชีตปี 6 ทับข้อมูลปี 5 ทั้งชุด */
    const old = (await d.students.toArray()).filter((st) => st.group.startsWith(`TH${dtmu}-`) || students.some((n) => n.code === st.code));
    const oldIds = new Set(old.map((st) => st.id));
    replaced = old.length;
    if (oldIds.size) {
      const oldWorks = (await d.workpieces.toArray()).filter((w) => oldIds.has(w.studentId));
      const workIds = new Set(oldWorks.map((w) => w.id));
      await d.workpieces.bulkDelete([...workIds]);
      await d.patients.bulkDelete((await d.patients.toArray()).filter((p) => oldIds.has(p.ownerStudentId)).map((p) => p.id));
      await d.updates.bulkDelete((await d.updates.toArray()).filter((u) => workIds.has(u.workpieceId)).map((u) => u.id));
      const photoIds = (await d.photos.toArray()).filter((ph) => workIds.has(ph.workpieceId)).map((ph) => ph.id);
      droppedPhotoIds.push(...photoIds);
      await d.photos.bulkDelete(photoIds);
      await d.checkins.bulkDelete((await d.checkins.toArray()).filter((c) => oldIds.has(c.studentId)).map((c) => c.id));
      await d.reviews.bulkDelete((await d.reviews.toArray()).filter((r) => workIds.has(r.workpieceId)).map((r) => r.id));
      // ของที่ผูกกับคน/ชิ้นงานที่ถูกแทนที่ — ชุดเดียวกับ purgeExpiredCohorts ไม่งั้นค้างเป็นแถวไร้เจ้าของ
      await d.queue.bulkDelete((await d.queue.toArray()).filter((q) => workIds.has(q.workpieceId)).map((q) => q.id));
      await d.selfAssessments.bulkDelete((await d.selfAssessments.toArray()).filter((sa) => oldIds.has(sa.studentId)).map((sa) => sa.id));
      await d.sect2.bulkDelete((await d.sect2.toArray()).filter((r) => oldIds.has(r.studentId)).map((r) => r.id));
      await d.sect3.bulkDelete((await d.sect3.toArray()).filter((r) => oldIds.has(r.studentId)).map((r) => r.id));
      await d.students.bulkDelete([...oldIds]);
      await d.groups.bulkDelete((await d.groups.toArray()).filter((g) => g.code.startsWith(`TH${dtmu}-`)).map((g) => g.code));
    }
    // ล้างอาจารย์เดโมที่ไม่มีใครอ้างถึงแล้ว (เก็บบัญชีที่กำลังล็อกอิน)
    const stillUsed = new Set((await d.students.toArray()).flatMap((st) => st.advisorIds ?? []));
    const keepIds = new Set([...teachers.keys(), ...stillUsed, DEMO.teacherId]);
    const stale = (await d.teachers.toArray()).filter((tc) => !keepIds.has(tc.id));
    if (stale.length) await d.teachers.bulkDelete(stale.map((tc) => tc.id));

    await d.teachers.bulkPut([...teachers.values()]);
    await d.students.bulkPut(students);
    await d.groups.bulkPut([...groupsMap.values()]);
    /* กวาดข้อมูลไร้เจ้าของ: งาน/ผู้ป่วยที่ studentId ไม่ตรงกับนักศึกษาคนไหนเลย
       เกิดจากรูปแบบ id เปลี่ยนข้ามเวอร์ชัน (เช่น st-TH-PT1-… → st-TH55-PT1-…) และบั๊ก นศ. ตกรุ่น
       (st-TH53-… ทั้งที่ตัวคนอยู่ st-TH54-…) — ไม่มีหน้าไหนเปิดถึง แต่ไปโป่งอยู่ในยอดรวมของ dashboard
       (เคยเจอผู้ป่วยไร้เจ้าของนับพันรายบนเครื่องทดสอบ) */
    const liveIds = new Set((await d.students.toArray()).map((st) => st.id));
    const orphanWorks = (await d.workpieces.toArray()).filter((w) => !liveIds.has(w.studentId));
    if (orphanWorks.length) await d.workpieces.bulkDelete(orphanWorks.map((w) => w.id));
    const orphanPatients = (await d.patients.toArray()).filter((p) => !liveIds.has(p.ownerStudentId));
    if (orphanPatients.length) await d.patients.bulkDelete(orphanPatients.map((p) => p.id));
    const orphanCheckins = (await d.checkins.toArray()).filter((c) => !liveIds.has(c.studentId));
    if (orphanCheckins.length) await d.checkins.bulkDelete(orphanCheckins.map((c) => c.id));
    await d.audit.add({
      id: uid('a'),
      text: `นำเข้ารายชื่อรุ่น DTMU${dtmu} จากชีต: ${students.length} คน · ${groupsMap.size} กลุ่ม`
        + (replaced ? ` (แทนที่ของเดิม ${replaced} คน)` : '')
        + (detected.odd.length ? ` · รหัสต่างรุ่น ${detected.odd.length} คน จัดเข้าชั้นเดียวกับชีต` : ''),
      who: actor,
      at: new Date().toISOString(),
    });
  });
  // ไฟล์รูปของชิ้นงานที่ถูกแทนที่ — อยู่คนละตาราง (blobs) จึงลบนอก transaction
  await dropLocalBlobs(droppedPhotoIds);
  return { students: students.length, groups: groupsMap.size, dtmu, replaced, odd: detected.odd };
}


/** อาจารย์ที่ปรึกษาติ๊กข้อกำหนด Sect II / Design RPD ให้นักศึกษา (ค่าตั้งต้นมาจากชีต)
 *  ทุกครั้งลง audit — เป็นเงื่อนไขจบ ต้องย้อนดูได้ว่าใครติ๊กเมื่อไหร่ */
export async function setStudentGate(studentId: string, key: GateKey, value: boolean, actor: string): Promise<void> {
  const st = await db.students.get(studentId);
  if (!st) return;
  const gates = { ...(st.gates ?? {}), [key]: value };
  await db.students.update(studentId, { gates });
  await logAudit(`${value ? 'ติ๊กผ่าน' : 'ติ๊กยังไม่ผ่าน'} ${GATE_LABELS[key]} ให้ ${st.name}`, actor, { studentId, group: st.group });
}

/** แก้หมายเหตุ/สถานะผู้ป่วย (เช่น "รอ preprosth" "รอถอนฟัน") — นักศึกษาแก้เองได้
 *  ค่าเดิมมาจากคอลัมน์หมายเหตุของชีตตอนนำเข้า · ทุกการแก้ลง audit เพื่อให้อาจารย์ย้อนดูได้ */
export async function updatePatientNote(patientId: string, note: string, actor: string): Promise<void> {
  const before = await db.patients.get(patientId);
  if (!before) return;
  const clean = note.trim();
  if ((before.note ?? '') === clean) return;
  await db.patients.update(patientId, { note: clean || undefined });
  /* ⚠️ ห้ามใส่ชื่อหรือ HN ผู้ป่วยลง audit — แถว audit ลบไม่ได้ (trigger ใน 0009)
     ถ้าใส่ชื่อลงไป ข้อมูลจะอยู่เกินกำหนดเก็บถาวรและลบตาม retention ไม่ได้
     ใช้รหัสเคสแทน: อาจารย์ยังจับคู่กับแถวในหน้าเคสได้ แต่ตัวบันทึกไม่มีตัวตนคนไข้ */
  await logAudit(
    `แก้สถานะผู้ป่วย ${caseCode(before.id)}: ${clean || '(ล้างออก)'}`,
    actor,
    { studentId: before.ownerStudentId },
  );
}

/** คืนเคส / ยกคืนสถานะ — นักศึกษาทำเองได้จากหน้าเคส
 *  เคสที่คืนแล้วไม่นับเป็นงานที่กำลังทำ แต่ยังอยู่ในรายการ (ขีดฆ่า) และย้อนกลับได้
 *  ทุกครั้งลง audit — อาจารย์ต้องเห็นว่าใครคืนเคสไหนเมื่อไหร่ เพราะกระทบตัวเลขเกณฑ์ */
export async function setWorkpieceReturned(
  workpieceId: string,
  returned: boolean,
  note: string,
  actor: string,
): Promise<void> {
  const w = await db.workpieces.get(workpieceId);
  if (!w) return;
  const clean = note.trim();
  await db.workpieces.update(workpieceId, {
    returned: returned || undefined,
    returnNote: returned ? (clean || undefined) : undefined,
    lastUpdatedAt: new Date().toISOString(),
  });
  await logAudit(
    returned
      /* รหัสเคส ไม่ใช่ id ภายใน — id ของผู้ป่วยที่นำเข้าจากชีตคือ hash(รหัสนักศึกษา|HN)
         ใส่ลงแถว audit ที่ลบไม่ได้ = เก็บค่าที่ไล่ย้อนไปหา HN ได้ไว้ถาวร (กฎข้อ 2 ของโปรเจกต์) */
      ? `คืนเคส ${w.detail} (${caseCode(w.patientId)})${clean ? ` · ${clean}` : ''}`
      : `ยกเลิกการคืนเคส ${w.detail} — กลับมาเป็นงานที่ทำอยู่`,
    actor,
    { studentId: w.studentId },
  );
}

// ── แบบประเมินตนเอง (Self-assessment) — คีย์คงที่ต่อคนต่อปี (saId ใน domain/selfAssessment) ──

export async function getSelfAssessment(
  studentId: string,
  academicYear: number,
): Promise<SelfAssessment | undefined> {
  return db.selfAssessments.get(saId(studentId, academicYear));
}

export async function listSelfAssessments(academicYear?: number): Promise<SelfAssessment[]> {
  const all = await db.selfAssessments.toArray();
  return academicYear === undefined ? all : all.filter((r) => r.academicYear === academicYear);
}

export interface SaDraftInput {
  studentId: string;
  academicYear: number;
  classYear: number;
  formVersion: string;
  answers: Record<string, string | number | string[] | null>;
}

/**
 * บันทึกร่าง — เรียกได้บ่อยระหว่างกรอก (autosave)
 * ส่งแล้วห้ามแก้: ถ้าชุดนี้ส่งไปแล้วจะไม่เขียนทับ คืนของเดิมกลับไป
 */
export async function saveSelfAssessmentDraft(input: SaDraftInput): Promise<SelfAssessment> {
  const id = saId(input.studentId, input.academicYear);
  const now = new Date().toISOString();
  const prev = await db.selfAssessments.get(id);
  if (prev?.status === 'submitted') return prev;
  const next: SelfAssessment = {
    id,
    studentId: input.studentId,
    academicYear: input.academicYear,
    classYear: input.classYear,
    formVersion: input.formVersion,
    answers: input.answers,
    status: 'draft',
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await db.selfAssessments.put(next);
  return next;
}

/** ส่งจริง — ล็อกไม่ให้แก้ต่อ (ฟอร์มกระดาษก็ส่งแล้วส่งเลย) */
export async function submitSelfAssessment(
  studentId: string,
  academicYear: number,
  actor: string,
): Promise<SelfAssessment | null> {
  const row = await db.selfAssessments.get(saId(studentId, academicYear));
  if (!row || row.status === 'submitted') return row ?? null;
  const next: SelfAssessment = { ...row, status: 'submitted', submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await db.selfAssessments.put(next);
  await logAudit(`ส่งแบบประเมินตนเอง ปีการศึกษา ${academicYear}`, actor, { studentId });
  return next;
}

// ── Section III (Knowledge & skill assessment) ────────────────────────────

export interface Sect3Input {
  /** ส่งมาถ้าแก้ของเดิม · ไม่ส่ง = สร้างแถวใหม่ */
  id?: string;
  studentId: string;
  formKey: string;
  academicYear: number;
  classYear: number;
  patientName?: string;
  hn?: string;
  workpieceId?: string;
  grades: Record<string, 'O' | 'S' | 'U'>;
  total: number | null;
  at: string;
  /** ร่างอัตโนมัติ — ไม่ลง audit ไม่งั้น log ท่วมเพราะเซฟทุกครั้งที่กา */
  silent?: boolean;
  /** เคยกดบันทึกใบนี้มาก่อนแล้วหรือยัง — เหตุผลเต็มอยู่ที่ Sect2Input.edited */
  edited?: boolean;
}


export async function listSect3(studentId?: string, academicYear?: number): Promise<Sect3Record[]> {
  const rows = studentId
    ? await db.sect3.where('studentId').equals(studentId).toArray()
    : await db.sect3.toArray();
  const filtered = academicYear ? rows.filter((r) => r.academicYear === academicYear) : rows;
  // ล่าสุดขึ้นก่อน — ใบเดียวกันประเมินซ้ำได้ อาจารย์ควรเห็นครั้งหลังสุดบนสุด
  return filtered.sort((a, b) => b.at.localeCompare(a.at) || b.createdAt.localeCompare(a.createdAt));
}

export async function saveSect3(input: Sect3Input, actor: string): Promise<Sect3Record> {
  const now = new Date().toISOString();
  const found = input.id ? await db.sect3.get(input.id) : undefined;
  // ใบของอาจารย์ท่านอื่น = แตกใบใหม่ ไม่ทับ (ดู isOthersForm)
  const prev = isOthersForm(found?.by, actor) ? undefined : found;
  const row: Sect3Record = {
    id: prev?.id ?? uid('s3'),
    studentId: input.studentId,
    formKey: input.formKey,
    academicYear: input.academicYear,
    classYear: input.classYear,
    patientName: (patientNamesOn() && input.patientName?.trim()) || undefined,
    hn: input.hn?.trim() || undefined,
    workpieceId: input.workpieceId,
    grades: input.grades,
    total: input.total,
    by: actor,
    // วันที่ประเมินจากช่องกรอก — กันปีอนาคต/ค่าว่างแบบเดียวกับ performedAt
    at: clampPerformedAt(input.at, undefined),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await db.sect3.put(row);
  if (input.silent) return row;
  await logAudit(
    `${input.edited ? 'แก้' : 'บันทึก'}ผลประเมิน Section III · ${input.formKey}${input.total === null ? '' : ` ได้ ${input.total}/10`}`,
    actor,
    { studentId: input.studentId },
  );
  return row;
}

export async function deleteSect3(id: string, actor: string): Promise<void> {
  const row = await db.sect3.get(id);
  if (!row) return;
  await db.sect3.delete(id);
  await logAudit(`ลบผลประเมิน Section III · ${row.formKey}`, actor, { studentId: row.studentId });
}

// ── Section II (Patient exam & treatment planning) ────────────────────────

export interface Sect2Input {
  id?: string;
  studentId: string;
  formKey: string;
  academicYear: number;
  classYear: number;
  patientName?: string;
  hn?: string;
  typeOfWorks?: string;
  workpieceId?: string;
  grades?: Record<string, 'O' | 'S' | 'M' | 'U'>;
  total?: number | null;
  marks?: Record<string, boolean>;
  passed?: boolean;
  at: string;
  /** ร่างอัตโนมัติ — ไม่ลง audit */
  silent?: boolean;
  /**
   * ใบนี้เคยถูก "กดบันทึก" มาก่อนแล้วหรือยัง — หน้าจอเป็นคนบอก
   *
   * ดูจากแถวในฐานข้อมูลอย่างเดียวไม่ได้ เพราะร่างอัตโนมัติสร้างแถวไว้ตั้งแต่อาจารย์กาข้อแรก
   * พอกดบันทึกจริง แถวจึงมีอยู่แล้วเสมอ แล้ว audit จะขึ้นว่า "แก้ผลประเมิน" ทั้งที่เพิ่งบันทึกครั้งแรก
   * แถว audit ลบไม่ได้ตามการออกแบบ ประโยคที่ไม่จริงจึงอยู่ถาวร — และคำว่า "แก้คะแนน"
   * เป็นคนละเรื่องกับ "ลงคะแนนครั้งแรก" มากเวลามีใครย้อนมาอ่าน
   */
  edited?: boolean;
}

export async function listSect2(studentId?: string, academicYear?: number): Promise<Sect2Record[]> {
  const rows = studentId
    ? await db.sect2.where('studentId').equals(studentId).toArray()
    : await db.sect2.toArray();
  const filtered = academicYear ? rows.filter((r) => r.academicYear === academicYear) : rows;
  return filtered.sort((a, b) => b.at.localeCompare(a.at) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * ธง 3 อันในโปรไฟล์ นศ. (Sect II Removable/Fixed · Design RPD) — คิดจากใบประเมินเสมอ
 *
 * กติกาอยู่ที่ `domain/sect2.ts → sect2GateValue()` ที่เดียว เพราะตัวสร้างข้อมูลตัวอย่าง
 * (`data/seed.ts`) ต้องใช้กติกาเดียวกัน ไม่งั้นเดโมจะขัดกับของจริง — เคยขัดมาแล้ว:
 * เดโมเขียนใบ Sect II Fixed ไว้ 58/70 แต่ธงไม่เคยถูกคิด หน้าเกณฑ์ของ นศ. จึงขึ้น
 * "0/4 · ยังไม่มีข้อมูลในระบบ" ทั้งที่หน้าอาจารย์โชว์คะแนนอยู่
 */
async function syncSect2Gate(studentId: string, formKey: string): Promise<void> {
  const st = await db.students.get(studentId);
  if (!st) return;
  const key = SECT2_GATE_OF[formKey];
  if (!key) return;

  const rows = await db.sect2.where('studentId').equals(studentId).toArray();
  const next = sect2GateValue(formKey, rows);

  const gates = { ...(st.gates ?? {}) };
  if (gates[key] === next) return;   // ไม่มีอะไรเปลี่ยน อย่าเขียนซ้ำให้ sync ทำงานเปล่า
  if (next === undefined) delete gates[key]; else gates[key] = next;
  await db.students.update(studentId, { gates });
}

export async function saveSect2(input: Sect2Input, actor: string): Promise<Sect2Record> {
  const now = new Date().toISOString();
  const found = input.id ? await db.sect2.get(input.id) : undefined;
  // ใบของอาจารย์ท่านอื่น = แตกใบใหม่ ไม่ทับ (ดู isOthersForm)
  const prev = isOthersForm(found?.by, actor) ? undefined : found;
  const row: Sect2Record = {
    id: prev?.id ?? uid('s2'),
    studentId: input.studentId,
    formKey: input.formKey,
    academicYear: input.academicYear,
    classYear: input.classYear,
    patientName: (patientNamesOn() && input.patientName?.trim()) || undefined,
    hn: input.hn?.trim() || undefined,
    typeOfWorks: input.typeOfWorks?.trim() || undefined,
    workpieceId: input.workpieceId,
    grades: input.grades,
    total: input.total,
    marks: input.marks,
    passed: input.passed,
    by: actor,
    at: clampPerformedAt(input.at, undefined),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await db.sect2.put(row);
  await syncSect2Gate(row.studentId, row.formKey);
  if (input.silent) return row;
  const score = row.formKey === 'rpdDesign'
    ? (row.passed ? 'ผ่าน' : 'ยังไม่ผ่าน')
    : (row.total === null || row.total === undefined ? 'ยังไม่ครบ' : `ได้ ${row.total}/70`);
  await logAudit(`${input.edited ? 'แก้' : 'บันทึก'}ผลประเมิน Section II · ${row.formKey} ${score}`, actor, { studentId: row.studentId });
  return row;
}

export async function deleteSect2(id: string, actor: string): Promise<void> {
  const row = await db.sect2.get(id);
  if (!row) return;
  await db.sect2.delete(id);
  await syncSect2Gate(row.studentId, row.formKey);   // ลบใบแล้วธงต้องกลับเป็นยังไม่ผ่าน
  await logAudit(`ลบผลประเมิน Section II · ${row.formKey}`, actor, { studentId: row.studentId });
}
