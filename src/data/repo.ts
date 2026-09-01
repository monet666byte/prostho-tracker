/**
 * Repository — API เดียวที่ UI เรียกใช้
 * ตอนนี้อ่าน/เขียน IndexedDB; ถ้าย้ายไปเซิร์ฟเวอร์กลาง แก้เฉพาะไฟล์นี้
 */

import { CATALOG_VERSION, TYPES, dentureLabel } from '../domain/catalog';
import { CRITERIA, totalScore } from '../domain/checkin';
import { toISODate } from '../lib/date';
import { isComplete, procAt, procLabel } from '../domain/rules';
import type {
  Arch, AuditEntry, KennedyClass, Payment, Photo, ProgressUpdate, QueueItem,
  CheckIn, DentureClass, Review, ReviewStatus, Settings, WorkType, Workpiece, WorkpieceView,
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
export type EvaluateResult =
  | { ok: true }
  | { ok: false; reason: 'missing' }
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
  | { ok: false; reason: 'nochange' };

export async function reviseCheckIn(
  id: string,
  scores: Record<string, number>,
  by: string,
): Promise<ReviseResult> {
  const row = await db.checkins.get(id);
  if (!row) return { ok: false, reason: 'missing' };
  if (row.status !== 'evaluated') return { ok: false, reason: 'not-evaluated' };

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
