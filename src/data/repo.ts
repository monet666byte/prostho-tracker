/**
 * Repository — API เดียวที่ UI เรียกใช้
 * ตอนนี้อ่าน/เขียน IndexedDB; ถ้าย้ายไปเซิร์ฟเวอร์กลาง แก้เฉพาะไฟล์นี้
 */

import { CATALOG_VERSION, TYPES, dentureLabel } from '../domain/catalog';
import { CRITERIA, totalScore } from '../domain/checkin';
import { cohortOf, entryYearFromDtmu, isAlumni, isWithinRetention } from '../domain/cohort';
import { toISODate } from '../lib/date';
import { isComplete, procAt, procLabel } from '../domain/rules';
import type {
  Arch, AuditEntry, ClinicGroup, KennedyClass, Payment, Photo, ProgressUpdate, QueueItem,
  CheckIn, DentureClass, Review, ReviewStatus, Settings, Student, WorkType, Workpiece, WorkpieceView,
} from '../domain/types';
import { db, kvGet, kvSet } from './db';
import { DEFAULT_SETTINGS } from './seed';
import { t } from '../lib/i18n';
import { formatBytes } from '../lib/image';

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

export async function getWorkpiece(id: string): Promise<WorkpieceView | null> {
  const w = await db.workpieces.get(id);
  if (!w) return null;
  const patient = await db.patients.get(w.patientId);
  return patient ? { ...w, patient } : null;
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await kvGet('settings', DEFAULT_SETTINGS)) };
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

  const now = new Date().toISOString();
  const updated: Workpiece = { ...w, procIndex: next.index, lastUpdatedAt: now };
  // จบเคสเมื่อไหร่ ใช้ตัดสินเกณฑ์รายปี จึงต้องเก็บเวลาไว้
  if (isComplete(updated)) updated.completedAt = input.performedAt;
  const label = procLabel(w.type, next);

  const update: ProgressUpdate = {
    id: uid('u'),
    workpieceId: w.id,
    procIndex: next.index,
    progression: next.progression,
    performedAt: input.performedAt,
    selfPerformed: next.selfPerformed,
    photoIds: [],
    createdBy: input.actor,
    createdAt: new Date().toISOString(),
    syncedAt: input.offline ? null : new Date().toISOString(),
  };

  await db.transaction('rw', [db.workpieces, db.updates, db.queue, db.photos, db.audit], async () => {
    await db.workpieces.put(updated);
    await db.updates.add(update);
    // เดิมตรงนี้สร้าง "รูป" เปล่าพร้อมขนาดไฟล์ที่สุ่มขึ้นมา ทั้งที่ไม่มีไฟล์รูปอยู่จริง
    // ตอนนี้รูปถูกแนบจริงผ่าน usePhotoAttach ตั้งแต่ก่อนกดยืนยัน — แค่ผูกเข้ากับ update นี้
    if (input.withPhoto) {
      const recent = await db.photos.where('workpieceId').equals(w.id).toArray();
      const ids = recent.map((ph) => ph.id);
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
      id: uid('a'), text: `${t('ผ่าน')} ${label}`, who: input.actor,
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

// ── เปิดชิ้นงานใหม่ (S7) ──────────────────────────────────────

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
  const meta = TYPES[input.type];
  const removable = input.type === 'CD' || input.type === 'RPD' || input.type === 'APD';
  const now = new Date().toISOString();

  // HN เดิมของนักศึกษาคนเดียวกัน = ผู้ป่วยคนเดิม — ห้ามงอกแถวใหม่
  // (เคสจริง: คนไข้ทำ CD เสร็จแล้วกลับมาทำ Crown/recall — เคยกลายเป็นสองคนในแอป เจอ 1 ก.ย. 69)
  const hn = input.hn.trim();
  const existing = hn
    ? (await db.patients.where('hn').equals(hn).toArray()).find((p) => p.ownerStudentId === input.studentId)
    : undefined;
  const patientId = existing?.id ?? uid('p');
  if (!existing) {
    await db.patients.add({
      id: patientId,
      name: input.patientName.trim() || 'ผู้ป่วยใหม่',
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
    acceptedDate: input.acceptedDate,
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
  await logAudit(`${t('สร้างชิ้นงาน')} ${created.map((c) => c.detail).join(' + ')}`, input.actor, { studentId: input.studentId });
  return created;
}

// ── offline queue (S10) ──────────────────────────────────────

export async function listQueue(): Promise<QueueItem[]> {
  const items = await db.queue.toArray();
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function syncNow(actor: string): Promise<number> {
  const items = await db.queue.toArray();
  if (!items.length) return 0;
  await db.transaction('rw', [db.queue, db.updates, db.photos, db.audit], async () => {
    const unsynced = await db.updates.filter((u) => u.syncedAt === null).toArray();
    await db.updates.bulkPut(unsynced.map((u) => ({ ...u, syncedAt: new Date().toISOString() })));
    const queuedPhotos = await db.photos.where('status').equals('queue').toArray();
    await db.photos.bulkPut(queuedPhotos.map((p) => ({ ...p, status: 'ok' as const })));
    await db.queue.clear();
    await db.audit.add({
      id: uid('a'),
      text: `sync ข้อมูลค้าง ${items.length} รายการขึ้นเซิร์ฟเวอร์`,
      who: actor,
      at: new Date().toISOString(),
    });
  });
  return items.length;
}

/** workpieceId ที่ยังมีรายการค้างในคิว */
export async function pendingIds(): Promise<Set<string>> {
  const items = await db.queue.toArray();
  return new Set(items.map((i) => i.workpieceId));
}

// ── รูป (S9) ─────────────────────────────────────────────────

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
 * TODO เมื่อขยายเกินกลุ่มทดลอง: ย้ายไป Supabase Storage แล้วเก็บแค่ลิงก์
 * ตอนนี้ data URL อยู่ในแถวเดียวกับข้อมูลอื่น พอสำหรับ 8 คน แต่ 96 คนจะหนัก
 */
export async function addPhoto(
  workpieceId: string,
  offline: boolean,
  image: { dataUrl: string; bytes: number },
): Promise<void> {
  const w = await db.workpieces.get(workpieceId);
  if (!w) return;
  const cur = procAt(w, Math.max(0, w.procIndex));
  await db.photos.add({
    id: uid('ph'),
    workpieceId,
    progression: cur?.progression ?? 0,
    stepLabel: cur ? procLabel(w.type, cur) : TYPES[w.type].prefix,
    dataUrl: image.dataUrl,
    sizeLabel: formatBytes(image.bytes),
    status: offline ? 'queue' : 'ok',
    createdAt: new Date().toISOString(),
  });
}

export async function retryPhoto(photoId: string, offline: boolean): Promise<void> {
  await db.photos.update(photoId, { status: offline ? 'queue' : 'ok' });
}

// ── ฝั่งอาจารย์ ───────────────────────────────────────────────

export async function setReview(workpieceId: string, status: ReviewStatus, comment: string, by: string): Promise<void> {
  // อ่าน-แล้ว-เขียนต้องอยู่ใน transaction เดียว — กดปุ่มรัวสองทีเคยได้สองแถวซ้ำ (เจอ 1 ก.ย. 69)
  await db.transaction('rw', db.reviews, async () => {
    const rows = await db.reviews.where('workpieceId').equals(workpieceId).toArray();
    // เก็บกวาดแถวซ้ำที่อาจหลงมาจากบั๊กเดิม — เหลือแถวเดียวต่อชิ้นงานเสมอ
    for (const extra of rows.slice(1)) await db.reviews.delete(extra.id);
    const review: Review = {
      id: rows[0]?.id ?? uid('rv'),
      workpieceId,
      status,
      comment,
      by,
      at: new Date().toISOString(),
    };
    await db.reviews.put(review);
  });
  const w = await db.workpieces.get(workpieceId);
  // status pending = แค่บันทึกคอมเมนต์ ไม่ใช่ตีกลับ — เคยลง audit ว่า "ตีกลับให้แก้" ทำประวัติน่าตกใจ (เจอ 1 ก.ย. 69)
  const action = status === 'approved' ? t('อนุมัติ') : status === 'returned' ? t('ตีกลับให้แก้') : t('บันทึกคอมเมนต์ชิ้นงาน');
  await logAudit(`${action} ${w?.detail ?? workpieceId}`, by, { studentId: w?.studentId });
}

export async function listReviews(): Promise<Map<string, Review>> {
  const all = await db.reviews.toArray();
  return new Map(all.map((r) => [r.workpieceId, r]));
}






/**
 * ลบชิ้นงาน — ลบประวัติ step, รูป, คิว sync และผลตรวจของชิ้นนั้นทั้งหมด
 * ถ้าผู้ป่วยไม่เหลือชิ้นงานเลย ลบผู้ป่วยออกด้วย · การลบถูกบันทึกใน audit log เสมอ
 */
export async function deleteWorkpiece(workpieceId: string, actor: string): Promise<void> {
  const w = await db.workpieces.get(workpieceId);
  if (!w) return;

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
  const existing = await db.checkins
    .where('studentId').equals(input.studentId)
    .and((c) => c.date === input.date)
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
      noPatient: input.noPatient || existing.noPatient,
      patientId: input.noPatient ? undefined : (input.patientId ?? existing.patientId),
      note: input.note?.trim() || existing.note,
    };
    const changed = JSON.stringify(merged) !== JSON.stringify(existing);
    if (changed) {
      await db.checkins.put(merged);
      const label = merged.activities.map((a) => t(a)).join(', ') || t('ไม่ระบุกิจกรรม');
      await logAudit(
        `${t('เติมรายละเอียดคาบ')} ${checkInDateLabel(input.date)} · ${label}`,
        input.actor,
        { studentId: input.studentId },
      );
    }
    return merged;
  }

  const entry: CheckIn = {
    id: uid('ci'),
    studentId: input.studentId,
    date: input.date,
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
    `${t('เช็คอินคาบคลินิก')} ${checkInDateLabel(input.date)} · ${input.activities.map((a) => t(a)).join(', ') || t('ไม่ระบุกิจกรรม')}`,
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
    `${t('เติมรายละเอียดคาบ')} ${checkInDateLabel(row?.date ?? '')} · ${patch.activities.map((a) => t(a)).join(', ') || t('ไม่ระบุกิจกรรม')}`,
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

/** อาจารย์ให้คะแนน = ลงนามแทนการเซ็นสมุด */
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
   เก็บข้อมูลย้อนหลังเท่าที่ภาคกำหนด (ปัจจุบัน 5 รุ่น) แล้วลบรุ่นที่เกิน
   อาจารย์ขอ 1 ก.ย. 69: "จัดเก็บข้อมูลไว้ประมาณ 5 ปี"
   ══════════════════════════════════════════════════════════════════ */

export interface RetentionReport {
  /** รุ่นที่ยังอยู่ในช่วงเก็บ (ใหม่ → เก่า) */
  keep: number[];
  /** รุ่นที่เกินกำหนดเก็บแล้ว พร้อมจำนวนข้อมูลที่จะถูกลบ */
  expired: Array<{ cohort: number; students: number; workpieces: number; checkins: number }>;
}

/** สำรวจว่ามีรุ่นไหนเกินกำหนดเก็บบ้าง — ดูอย่างเดียว ยังไม่ลบ */
export async function retentionReport(asOf: Date = new Date()): Promise<RetentionReport> {
  const students = await db.students.toArray();
  const keep = new Set<number>();
  const expiredIds = new Map<number, string[]>();
  students.forEach((s) => {
    const c = cohortOf(s, asOf);
    if (isWithinRetention(c, asOf)) keep.add(c);
    else expiredIds.set(c, [...(expiredIds.get(c) ?? []), s.id]);
  });

  const expired: RetentionReport['expired'] = [];
  for (const [cohort, ids] of [...expiredIds.entries()].sort((a, b) => b[0] - a[0])) {
    const idSet = new Set(ids);
    const works = await db.workpieces.filter((w) => idSet.has(w.studentId)).count();
    const checks = await db.checkins.filter((c) => idSet.has(c.studentId)).count();
    expired.push({ cohort, students: ids.length, workpieces: works, checkins: checks });
  }
  return { keep: [...keep].sort((a, b) => b - a), expired };
}

/**
 * ลบข้อมูลของรุ่นที่เกินกำหนดเก็บ — ลบจริง กู้คืนไม่ได้
 * ลบทุกตารางที่ผูกกับนักศึกษาคนนั้น ไม่ให้เหลือเศษข้อมูลกำพร้า
 */
export async function purgeExpiredCohorts(by: string, asOf: Date = new Date()): Promise<{ cohorts: number[]; students: number }> {
  const students = await db.students.toArray();
  const doomed = students.filter((s) => !isWithinRetention(cohortOf(s, asOf), asOf));
  if (!doomed.length) return { cohorts: [], students: 0 };

  const ids = new Set(doomed.map((s) => s.id));
  const cohorts = [...new Set(doomed.map((s) => cohortOf(s, asOf)))].sort((a, b) => b - a);
  const patients = await db.patients.filter((p) => ids.has(p.ownerStudentId)).toArray();
  const patientIds = new Set(patients.map((p) => p.id));
  const works = await db.workpieces.filter((w) => ids.has(w.studentId)).toArray();
  const workIds = new Set(works.map((w) => w.id));

  await db.transaction('rw', [db.students, db.patients, db.workpieces, db.checkins, db.updates, db.photos, db.groups], async () => {
    await db.checkins.filter((c) => ids.has(c.studentId)).delete();
    await db.updates.filter((u) => workIds.has(u.workpieceId)).delete();
    await db.photos.filter((ph) => workIds.has(ph.workpieceId)).delete();
    await db.workpieces.bulkDelete([...workIds]);
    await db.patients.bulkDelete([...patientIds]);
    await db.students.bulkDelete([...ids]);
    // กลุ่มที่ไม่เหลือสมาชิกแล้วก็ลบทิ้ง ไม่งั้นค้างเป็นกลุ่มว่าง
    const groups = await db.groups.toArray();
    const remaining = await db.students.toArray();
    const liveGroups = new Set(remaining.map((s) => s.group));
    await db.groups.bulkDelete(groups.filter((g) => !liveGroups.has(g.code)).map((g) => g.code));
  });

  await logAudit(`ลบข้อมูลรุ่นที่เกินกำหนดเก็บ: ${cohorts.map((c) => `DTMU${c - 2514}`).join(', ')} · ${doomed.length} คน`, by);
  return { cohorts, students: doomed.length };
}

/* ══════════════════════════════════════════════════════════════════
   นำเข้ารายชื่อนักศึกษารุ่นใหม่ (roster) — ภาคส่งรายชื่อมาทุกปี
   ผู้ใช้ยืนยัน 1 ก.ย. 69: "DTMU56 และต่อๆ ไปเดี๋ยวมี roster ให้"
   ══════════════════════════════════════════════════════════════════ */

export interface RosterRow {
  code: string;   // รหัสนักศึกษา เช่น 6604001
  name: string;
  group: string;  // PT1–PT12 (ใส่มาแบบสั้นก็ได้)
  /** เลขรุ่น DTMU เช่น 56 — ไม่ใส่ก็ใช้ค่าที่เลือกไว้ตอนนำเข้า */
  dtmu?: number;
}

export interface RosterParseResult {
  rows: RosterRow[];
  /** บรรทัดที่อ่านไม่ออก พร้อมเหตุผล — โชว์ให้เห็นก่อนกดนำเข้า */
  errors: Array<{ line: number; text: string; reason: string }>;
}

/**
 * อ่านรายชื่อจากข้อความที่วางมา — รองรับทั้ง CSV, TSV และวางจาก Excel
 * รูปแบบ: รหัส, ชื่อ, กลุ่ม[, เลขรุ่น]  ·  บรรทัดหัวตารางข้ามให้อัตโนมัติ
 */
export function parseRoster(text: string): RosterParseResult {
  const rows: RosterRow[] = [];
  const errors: RosterParseResult['errors'] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(/\t|,|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    // ข้ามหัวตาราง: ไม่มีเซลล์ไหนขึ้นต้นด้วยตัวเลข 7 หลัก
    const code = cells.find((c) => /^\d{7}$/.test(c));
    if (!code) {
      // หัวตารางต้องอยู่บรรทัดแรกเท่านั้น — บรรทัดอื่นที่ไม่มีรหัสถือว่าผิดจริง
      if (i === 0 && /รหัส|code|ชื่อ|name|กลุ่ม|group/i.test(line)) return;
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: 'ไม่พบรหัสนักศึกษา 7 หลัก' });
      return;
    }
    if (seen.has(code)) {
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: 'รหัสซ้ำกับบรรทัดก่อนหน้า' });
      return;
    }
    const group = cells.find((c) => /^(TH\d*-)?PT\d{1,2}$/i.test(c));
    if (!group) {
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: 'ไม่พบกลุ่ม (PT1–PT12)' });
      return;
    }
    const dtmuCell = cells.find((c) => /^(DTMU)?\d{2}$/i.test(c) && c !== code);
    const name = cells.find((c) => c !== code && c !== group && c !== dtmuCell) ?? '';
    if (!name) {
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: 'ไม่พบชื่อ' });
      return;
    }
    seen.add(code);
    rows.push({
      code,
      name,
      group: group.toUpperCase().replace(/^TH\d*-/, ''),
      dtmu: dtmuCell ? Number(dtmuCell.replace(/\D/g, '')) : undefined,
    });
  });
  return { rows, errors };
}

export interface RosterImportResult {
  added: number;
  updated: number;
  cohort: number;
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
    const groupCode = `TH${r.dtmu ?? dtmu}-${r.group}`;
    const prev = byCode.get(r.code);
    if (prev) {
      toPut.push({ ...prev, name: r.name, group: groupCode, entryYear, year: 5 });
      updated++;
    } else {
      toPut.push({
        id: `st-${groupCode}-${r.code}`,
        code: r.code,
        name: r.name,
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
  return { added, updated, cohort: entryYearFromDtmu(dtmu) };
}


/* ── นำเข้าทั้งรุ่นจากชีตจริง (local เท่านั้น) ─────────────────────────────
   ล้างข้อมูลเดโมออกก่อน (คงตาราง teachers/settings/audit ไว้ — session อาจารย์ไม่หลุด)
   แล้วลงรายชื่อนักศึกษา+กลุ่มจากแท็บ Student list ของชีต */
export async function replaceWithRoster(
  entries: Array<{ code: string; name: string; group: string; advisor: string }>,
  actor: string,
): Promise<{ students: number; groups: number }> {
  const { db: d } = await import('./db');
  const groupsMap = new Map<string, { code: string; advisorIds: [string, string]; studentIds: string[] }>();
  const teachers = new Map<string, { id: string; name: string; title: string }>();
  const students = entries.map((e) => {
    const names = e.advisor.split('/').map((x) => x.trim()).filter(Boolean);
    const adv: string[] = names.slice(0, 2).map((n) => {
      const id = `tc-r55-${n}`;
      if (!teachers.has(id)) teachers.set(id, { id, name: `อ.${n}`, title: 'อาจารย์ที่ปรึกษากลุ่ม' });
      return id;
    });
    while (adv.length < 2) adv.push(adv[0] ?? 'tc-r55-unknown');
    const g = groupsMap.get(e.group) ?? { code: e.group, advisorIds: [adv[0], adv[1]] as [string, string], studentIds: [] };
    const sid = `st-r55-${e.code}`;
    g.studentIds.push(sid);
    groupsMap.set(e.group, g);
    return { id: sid, code: e.code, name: e.name, group: e.group, year: 5, advisorIds: [adv[0], adv[1]] as [string, string] };
  });

  await d.transaction('rw', [d.students, d.groups, d.patients, d.workpieces, d.updates, d.photos, d.checkins, d.reviews, d.submissions, d.issues, d.queue, d.teachers, d.audit], async () => {
    // ล้างเฉพาะข้อมูลงาน — teachers เดิมคงไว้ (บัญชีเดโมของอาจารย์ยังล็อกอินได้)
    await Promise.all([
      d.students.clear(), d.groups.clear(), d.patients.clear(), d.workpieces.clear(),
      d.updates.clear(), d.photos.clear(), d.checkins.clear(), d.reviews.clear(),
      d.submissions.clear(), d.issues.clear(), d.queue.clear(),
    ]);
    await d.teachers.bulkPut([...teachers.values()]);
    await d.students.bulkAdd(students);
    await d.groups.bulkAdd([...groupsMap.values()]);
    await d.audit.add({
      id: uid('a'),
      text: `นำเข้ารายชื่อทั้งรุ่นจากชีตจริง: ${students.length} คน · ${groupsMap.size} กลุ่ม (ล้างข้อมูลเดโมแล้ว)`,
      who: actor,
      at: new Date().toISOString(),
    } as never);
  });
  return { students: students.length, groups: groupsMap.size };
}


/** แก้หมายเหตุ/สถานะผู้ป่วย (เช่น "รอ preprosth" "รอถอนฟัน") — นักศึกษาแก้เองได้
 *  ค่าเดิมมาจากคอลัมน์หมายเหตุของชีตตอนนำเข้า · ทุกการแก้ลง audit เพื่อให้อาจารย์ย้อนดูได้ */
export async function updatePatientNote(patientId: string, note: string, actor: string): Promise<void> {
  const before = await db.patients.get(patientId);
  if (!before) return;
  const clean = note.trim();
  if ((before.note ?? '') === clean) return;
  await db.patients.update(patientId, { note: clean || undefined });
  await logAudit(
    `แก้สถานะผู้ป่วย ${before.name}${before.hn ? ` (HN ${before.hn})` : ''}: ${clean || '(ล้างออก)'}`,
    actor,
    { studentId: before.ownerStudentId },
  );
}
