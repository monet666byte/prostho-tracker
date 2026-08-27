/**
 * Repository — API เดียวที่ UI เรียกใช้
 * ตอนนี้อ่าน/เขียน IndexedDB; ถ้าย้ายไปเซิร์ฟเวอร์กลาง แก้เฉพาะไฟล์นี้
 */

import { CATALOG_VERSION, TYPES, dentureLabel } from '../domain/catalog';
import { isComplete, procAt, procLabel } from '../domain/rules';
import type {
  Arch, AuditEntry, KennedyClass, Payment, Photo, ProgressUpdate, QueueItem,
  CheckIn, DentureClass, Review, ReviewStatus, Settings, SubmissionStatus, WorkType, Workpiece, WorkpieceView,
} from '../domain/types';
import { db, kvGet, kvSet } from './db';
import { DEFAULT_SETTINGS } from './seed';

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

export async function logAudit(text: string, who: string): Promise<void> {
  const entry: AuditEntry = { id: uid('a'), text, who, at: new Date().toISOString() };
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
    if (input.withPhoto) {
      const photo: Photo = {
        id: uid('ph'),
        workpieceId: w.id,
        progression: next.progression,
        stepLabel: label,
        sizeLabel: `${(1.4 + Math.random() * 1.6).toFixed(1)} MB`,
        status: input.offline ? 'queue' : 'ok',
        createdAt: new Date().toISOString(),
      };
      await db.photos.add(photo);
      update.photoIds.push(photo.id);
      await db.updates.put(update);
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
    await db.audit.add({ id: uid('a'), text: `ผ่าน ${label}`, who: input.actor, at: new Date().toISOString() });
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
      performedAt: new Date().toISOString().slice(0, 10),
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

  const patientId = uid('p');
  await db.patients.add({
    id: patientId,
    name: input.patientName.trim() || 'ผู้ป่วยใหม่',
    hn: input.hn.trim() || `DEMO-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    sexAge: input.sexAge.trim() || 'ไม่ระบุ',
    ownerStudentId: input.studentId,
  });

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
  await logAudit(`สร้างชิ้นงาน ${created.map((c) => c.detail).join(' + ')}`, input.actor);
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

export async function addPhoto(workpieceId: string, offline: boolean): Promise<void> {
  const w = await db.workpieces.get(workpieceId);
  if (!w) return;
  const cur = procAt(w, Math.max(0, w.procIndex));
  await db.photos.add({
    id: uid('ph'),
    workpieceId,
    progression: cur?.progression ?? 0,
    stepLabel: cur ? procLabel(w.type, cur) : TYPES[w.type].prefix,
    sizeLabel: `${(1.4 + Math.random() * 1.6).toFixed(1)} MB`,
    status: offline ? 'queue' : 'ok',
    createdAt: new Date().toISOString(),
  });
}

export async function retryPhoto(photoId: string, offline: boolean): Promise<void> {
  await db.photos.update(photoId, { status: offline ? 'queue' : 'ok' });
}

// ── ฝั่งอาจารย์ ───────────────────────────────────────────────

export async function setReview(workpieceId: string, status: ReviewStatus, comment: string, by: string): Promise<void> {
  const existing = (await db.reviews.where('workpieceId').equals(workpieceId).toArray())[0];
  const review: Review = {
    id: existing?.id ?? uid('rv'),
    workpieceId,
    status,
    comment,
    by,
    at: new Date().toISOString(),
  };
  await db.reviews.put(review);
  const w = await db.workpieces.get(workpieceId);
  await logAudit(`${status === 'approved' ? 'อนุมัติ' : 'ตีกลับให้แก้'} ${w?.detail ?? workpieceId}`, by);
}

export async function listReviews(): Promise<Map<string, Review>> {
  const all = await db.reviews.toArray();
  return new Map(all.map((r) => [r.workpieceId, r]));
}

const CYCLE: SubmissionStatus[] = ['none', 'sent', 'approved', 'issue', 'late'];

export async function cycleSubmission(studentId: string, roundId: string, by: string): Promise<void> {
  const id = `${studentId}-${roundId}`;
  const cur = await db.submissions.get(id);
  const next = CYCLE[(CYCLE.indexOf(cur?.status ?? 'none') + 1) % CYCLE.length];
  await db.submissions.put({ id, studentId, roundId, status: next, approvedBy: next === 'approved' ? by : undefined });
}

export async function approveRound(studentIds: string[], roundId: string, by: string): Promise<number> {
  const rows = await db.submissions.where('roundId').equals(roundId).toArray();
  const target = rows.filter((r) => studentIds.includes(r.studentId) && r.status === 'sent');
  await db.submissions.bulkPut(target.map((r) => ({ ...r, status: 'approved' as const, approvedBy: by })));
  if (target.length) await logAudit(`อนุมัติรายงานรอบนี้ ${target.length} คน`, by);
  return target.length;
}

/** อาจารย์ตรวจรับ / ตีกลับว่าชิ้นงานเข้าเกณฑ์หรือยัง (คอลัมน์ "ยังไม่เข้าเกณฑ์ ... รอตรวจ" ในชีต) */
export async function setReportIssue(studentId: string, text: string): Promise<void> {
  if (text.trim()) await db.issues.put({ studentId, text });
  else await db.issues.delete(studentId);
}

export async function listReportIssues(): Promise<Map<string, string>> {
  const rows = await db.issues.toArray();
  return new Map(rows.map((r) => [r.studentId, r.text]));
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

export async function addCheckIn(input: CheckInInput): Promise<CheckIn> {
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
  await logAudit(`เช็คอินคาบคลินิก ${checkInDateLabel(input.date)} · ${input.activities.join(', ') || 'ไม่ระบุกิจกรรม'}`, input.actor);
  return entry;
}

function checkInDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
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
export async function evaluateCheckIn(id: string, scores: Record<string, number>, by: string): Promise<void> {
  const row = await db.checkins.get(id);
  if (!row) return;
  await db.checkins.put({
    ...row,
    scores,
    status: 'evaluated',
    evaluatedBy: by,
    evaluatedAt: new Date().toISOString(),
  });
  await logAudit(`ประเมินคาบ ${checkInDateLabel(row.date)} ของนักศึกษา`, by);
}

export async function deleteCheckIn(id: string, actor: string): Promise<void> {
  const row = await db.checkins.get(id);
  if (!row) return;
  await db.checkins.delete(id);
  await logAudit(`ลบเช็คอินคาบ ${checkInDateLabel(row.date)}`, actor);
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
