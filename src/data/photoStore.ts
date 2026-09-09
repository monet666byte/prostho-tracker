/**
 * คลังไฟล์รูปงาน — ไบต์อยู่ที่ Supabase Storage · เครื่องเก็บสำเนาไว้ดูตอนออฟไลน์
 *
 * ที่มา: เดิมรูปเก็บเป็น data URL (base64) อยู่ในคอลัมน์เดียวกับ metadata ในตาราง photos
 * ซึ่งอยู่ใน TABLES ของ cloudSync ด้วย แปลว่า base64 ทั้งก้อนวิ่งขึ้น-ลง Postgres
 * ทุกรอบ sync (ทุก 15 วิ) ที่กลุ่มทดลอง 8 คนยังไหว ที่ 96 คนช้าจนใช้ไม่ได้
 * และไปเบียดโควตาฐานข้อมูลซึ่งเป็นแผนฟรี
 *
 * ที่ร้ายกว่าเรื่องพื้นที่: รูปอยู่ในเครื่องเดียว เปลี่ยนเครื่องหรือล้าง cache = หายถาวร
 * และมันคือรูปที่ถ่ายจากปากคนไข้จริง ถ่ายซ้ำไม่ได้
 *
 * ─── กติกาที่ห้ามพังเด็ดขาด ────────────────────────────────────────────────
 *
 * ① ตัวชี้ขาดว่า "ขึ้นคลาวด์แล้ว" คือ Photo.storagePath ไม่ใช่ Photo.status
 *    status เป็นแค่ป้ายที่สะท้อนตามหลัง ถ้าสองอย่างขัดกันให้เชื่อ storagePath
 *    เหตุผล: เคยมีบั๊กที่หน้าจอขึ้น "อัปโหลดแล้ว" ทั้งที่ไม่มีรูปอยู่จริงสักใบ
 *    มาแล้วสองรอบ (addPhoto รุ่นแรกสร้างแถวเปล่า · syncNow ตั้ง ok ให้ทุกใบโดยไม่ส่งอะไร)
 *
 * ② ห้ามลบไบต์ในเครื่องก่อนที่ storage จะตอบรับ — ลำดับใน uploadOne() ห้ามสลับ
 *    อัป → เซิร์ฟเวอร์ตอบ ok → เขียน storagePath → ค่อยล้าง dataUrl
 *    ล้มตรงไหนก็ตาม ของในเครื่องยังครบ รอบหน้าเริ่มใหม่ที่ใบเดิมได้
 *
 * ③ ห้ามเงียบ — ส่งไม่ขึ้นถาวรต้องโผล่ในการ์ดเตือนหน้า sync ผ่าน reportSyncProblem()
 *    ไม่ใช่ค้างเป็น "รออัปโหลด" ไปเรื่อยๆ จนผู้ใช้เปิดจากอีกเครื่องแล้วรูปไม่อยู่
 */
import { db } from './db';
import { cloudEnabled, supabase } from '../lib/cloud';
import { onRetryRequested, onSyncPump, reportSyncProblem } from './cloudSync';
import { dataUrlToBlob } from '../lib/image';
import { caseCode } from '../lib/privacy';
import { t } from '../lib/i18n';
import type { Photo, PhotoStatus } from '../domain/types';

export const PHOTO_BUCKET = 'case-photos';

/**
 * เพดานสำเนาในเครื่อง — เกินแล้วทิ้งใบเก่าสุด "เฉพาะที่ยืนยันแล้วว่าขึ้นคลาวด์"
 * 60 MB ≈ 200 ใบที่ขนาดหลังบีบ (~300 KB) ซึ่งเกินที่ นศ. หนึ่งคนถ่ายทั้งปี
 * มีเพดานไว้เพราะ Safari ลบข้อมูลเว็บที่ไม่ได้เปิด 7 วัน และโควตาต่อโดเมนไม่ได้ใหญ่
 */
const LOCAL_CACHE_LIMIT = 60 * 1024 * 1024;
/** ลองใหม่กี่รอบก่อนยอมรับว่าเป็นปัญหาถาวร (เน็ตคลินิกสะดุดบ่อย 3 รอบ = ~45 วิ) */
const MAX_ATTEMPTS = 3;
/** อายุลิงก์ที่เซ็น — ยาวพอให้เปิดดูทั้งคาบโดยไม่ต้องเซ็นใหม่ทุกครั้งที่ scroll */
const SIGNED_TTL_SEC = 3600;

/**
 * นักศึกษาเจ้าของเครื่องนี้ — ตั้งตอน initPhotoSync()
 *
 * ต้องมี เพราะเครื่องอาจารย์ดึงแถว photos ของ นศ. ทุกคนลงมา ถ้าไม่กรอง
 * เครื่องอาจารย์จะพยายามอัปรูปของ นศ. ทุกคน แล้วโดน RLS ปฏิเสธทุกใบ
 * = การ์ดเตือนเต็มไปด้วย 403 ที่ไม่ใช่ความผิดใคร (คนอัปต้องเป็นเจ้าของรูปเท่านั้น)
 */
let ownerStudentId: string | undefined;

/* ── สถานะที่ตรงความจริง ──────────────────────────────────────────────────── */

/**
 * สถานะตั้งต้นของรูปที่เพิ่งถ่าย
 * ไม่มีคลาวด์ (เดโม/แชร์/GitHub Pages) = ไม่มีที่ให้อัป จึงต้องเป็น 'local'
 * การขึ้นว่า 'ok' ในโหมดพวกนั้นคือคำที่ไม่มีวันเป็นจริง
 */
export function initialPhotoStatus(): PhotoStatus {
  return cloudEnabled ? 'queue' : 'local';
}

/* ── ชื่อไฟล์ ─────────────────────────────────────────────────────────────── */

/**
 * path ในบักเก็ต — ห้ามมีชื่อคนไข้หรือ HN เด็ดขาด (รูปในปากคือข้อมูลอ่อนไหวที่สุดในระบบนี้
 * และชื่อไฟล์รั่วง่ายกว่าเนื้อข้อมูล: มันโผล่ใน log, ใน URL, ในหน้า dashboard ของ Supabase)
 *
 * caseCode() คำนวณจาก id ภายในของผู้ป่วย ไม่ใช่จาก HN — คนที่รู้ HN เดาไม่ได้ว่าโฟลเดอร์ไหนคือใคร
 *
 * โฟลเดอร์แรกต้องเป็น studentId เพราะ RLS ของ storage อ่านได้แค่ (storage.foldername(name))[1]
 * ถ้าสลับลำดับ นโยบาย "นศ. เห็นเฉพาะของตัวเอง" จะเขียนไม่ได้เลย
 */
export function photoPath(studentId: string, patientId: string, workpieceId: string, photoId: string): string {
  return `${studentId}/${caseCode(patientId)}/${workpieceId}/${photoId}.jpg`;
}

/* ── ไบต์ในเครื่อง ────────────────────────────────────────────────────────── */

export async function putLocalBlob(photoId: string, blob: Blob): Promise<void> {
  await db.blobs.put({ photoId, blob, bytes: blob.size, at: new Date().toISOString() });
}

export async function dropLocalBlobs(photoIds: string[]): Promise<void> {
  if (!photoIds.length) return;
  await db.blobs.bulkDelete(photoIds);
  photoIds.forEach(forgetObjectUrl);
}

/** ไบต์ของรูปใบนี้ — จากสำเนาในเครื่องก่อน ถ้าไม่มีค่อยแกะจาก data URL ของเก่า */
async function bytesFor(photo: Photo): Promise<{ blob: Blob; fromDataUrl: boolean } | null> {
  const local = await db.blobs.get(photo.id);
  if (local) return { blob: local.blob, fromDataUrl: false };
  if (photo.dataUrl) {
    const b = dataUrlToBlob(photo.dataUrl);
    if (b) return { blob: b, fromDataUrl: true };
  }
  return null;
}

/* ── แยกให้ออกว่า "เน็ตสะดุด" กับ "ไม่มีวันผ่าน" ──────────────────────────── */

/**
 * เน็ตสะดุดกับโควตาเต็มต้องปฏิบัติต่างกัน — อันแรกลองใหม่เงียบๆ ได้
 * อันหลังลองกี่รอบก็ไม่ผ่านจนกว่าจะมีคนไปแก้ ต้องบอกผู้ใช้ทันที ไม่ใช่วนรบกวนเน็ตทุก 15 วิ
 */
function classifyUploadError(err: unknown): { permanent: boolean; reason: string } {
  const e = err as { message?: string; status?: number; statusCode?: string | number; error?: string };
  const msg = String(e?.message ?? e?.error ?? err ?? '').trim();
  const code = Number(e?.status ?? e?.statusCode ?? 0);
  const low = msg.toLowerCase();

  // 401 ไม่นับถาวร — supabase-js ต่ออายุ token ให้เองอยู่ รอบหน้ามักผ่าน
  if (code === 403 || low.includes('row-level security') || low.includes('unauthorized')) {
    return { permanent: true, reason: t('ไม่มีสิทธิ์อัปโหลดรูปนี้') };
  }
  if (code === 413 || low.includes('maximum allowed size') || low.includes('payload too large')) {
    return { permanent: true, reason: t('ไฟล์ใหญ่เกินที่เซิร์ฟเวอร์รับ') };
  }
  if (code === 507 || low.includes('quota') || low.includes('storage limit') || low.includes('exceeded the')) {
    return { permanent: true, reason: t('พื้นที่เก็บไฟล์บนเซิร์ฟเวอร์เต็ม') };
  }
  if (low.includes('bucket not found') || low.includes('bucket_not_found')) {
    return { permanent: true, reason: t('ยังไม่ได้สร้างที่เก็บรูปบนเซิร์ฟเวอร์') };
  }
  return { permanent: false, reason: msg || t('ส่งรูปขึ้นเซิร์ฟเวอร์ไม่สำเร็จ') };
}

/* ── อัปทีละใบ ────────────────────────────────────────────────────────────── */

const attempts = new Map<string, number>();

type UploadResult = 'uploaded' | 'retry' | 'failed' | 'skipped';

async function uploadOne(photo: Photo): Promise<UploadResult> {
  if (!supabase) return 'retry';
  if (photo.storagePath) return 'skipped'; // ขึ้นไปแล้ว ไม่ต้องทำอะไร

  const w = await db.workpieces.get(photo.workpieceId);
  if (!w) {
    // ชิ้นงานถูกลบไประหว่างที่รูปยังค้างคิว — เก็บกวาดแล้วจบ ไม่ใช่ความผิดพลาด
    await dropLocalBlobs([photo.id]);
    await db.photos.delete(photo.id);
    return 'skipped';
  }
  // รูปของคนอื่น (เครื่องอาจารย์) — เจ้าของเท่านั้นที่อัปได้ตาม RLS
  if (ownerStudentId === undefined || w.studentId !== ownerStudentId) return 'skipped';

  const src = await bytesFor(photo);
  if (!src) {
    /**
     * ไม่มีไบต์ให้ส่งเลย — เกิดได้เมื่อ นศ. ใช้สองเครื่อง: เครื่อง B ดึงแถวที่เครื่อง A
     * ยังไม่ได้อัปลงมา แถวมี status 'queue' แต่ไบต์อยู่เครื่อง A
     * ห้ามตีเป็น fail เด็ดขาด — เครื่องนี้ทำอะไรไม่ได้ ไม่ได้แปลว่ารูปเสีย
     * ปล่อยค้างเป็น 'รออัปโหลด' ซึ่งเป็นความจริง (ยังไม่ขึ้นจริงๆ) แล้วให้เครื่อง A จัดการ
     */
    return 'skipped';
  }

  const path = photoPath(w.studentId, w.patientId, w.id, photo.id);
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, src.blob, { contentType: 'image/jpeg', upsert: true });

  if (error) {
    const n = (attempts.get(photo.id) ?? 0) + 1;
    attempts.set(photo.id, n);
    const { permanent, reason } = classifyUploadError(error);
    if (!permanent && n < MAX_ATTEMPTS) return 'retry';

    attempts.delete(photo.id);
    const fresh = await db.photos.get(photo.id);
    if (fresh) await db.photos.put({ ...fresh, status: 'fail' });
    // ต้องเห็นด้วยตา ไม่ใช่ค้างเงียบ — ไปโผล่ที่การ์ดเตือนใบเดียวกับของ sync ปกติ
    reportSyncProblem('photos', photo.id, reason);
    return 'failed';
  }

  /**
   * ⚠️ ตั้งแต่บรรทัดนี้ลงไป ลำดับห้ามสลับ
   * เซิร์ฟเวอร์ตอบรับแล้วเท่านั้นถึงจะแตะของในเครื่องได้
   */
  attempts.delete(photo.id);
  // รูปเก่าที่แกะจาก data URL: เก็บเป็น Blob ไว้ด้วย ไม่งั้นพอล้าง dataUrl แล้วจะดูออฟไลน์ไม่ได้
  if (src.fromDataUrl) await putLocalBlob(photo.id, src.blob);

  const fresh = await db.photos.get(photo.id);
  if (fresh) {
    /**
     * ต้องมีคีย์ dataUrl อยู่จริงโดยมีค่าเป็น undefined ห้ามลบคีย์ทิ้ง
     * cloudSync.toRow แปลง undefined → null แต่ "ไม่มีคีย์" = ไม่ส่งคอลัมน์นั้นขึ้นไปเลย
     * ซึ่ง upsert จะคง data_url ก้อนเก่าไว้บน Postgres ตลอดกาล — base64 ไม่หายไปไหน
     */
    await db.photos.put({ ...fresh, storagePath: path, status: 'ok', dataUrl: undefined });
  }
  return 'uploaded';
}

/* ── รอบเก็บกวาด: ส่งของค้างขึ้น ──────────────────────────────────────────── */

let running = false;

/**
 * ส่งรูปที่ยังไม่ขึ้นคลาวด์ — ถูกปลุกจังหวะเดียวกับ flush() ของแถวข้อมูล
 * (รอบ 15 วิ · event online · เปิดจอกลับมา · ปุ่ม sync) ผ่าน onSyncPump
 */
export async function uploadPendingPhotos(): Promise<{ uploaded: number; failed: number }> {
  if (!cloudEnabled || !supabase || running || ownerStudentId === undefined) {
    return { uploaded: 0, failed: 0 };
  }
  running = true;
  try {
    // อ่านผ่าน index status (ตาราง photos บนเครื่องอาจารย์มีของทุกคน สแกนทั้งตารางทุก 15 วิ ไม่ไหว)
    // แต่ยังกรอง storagePath ซ้ำอีกชั้น เพราะ status เชื่อไม่ได้ — ดูกติกา ① หัวไฟล์
    const rows = await db.photos.where('status').anyOf('queue', 'local').toArray();
    const pending = rows.filter((p) => !p.storagePath);
    let uploaded = 0;
    let failed = 0;
    for (const p of pending) {
      const r = await uploadOne(p);
      if (r === 'uploaded') uploaded++;
      else if (r === 'failed') failed++;
    }
    if (uploaded) await pruneLocalCache();
    return { uploaded, failed };
  } finally {
    running = false;
  }
}

/* ── ย้ายรูปเก่าที่อยู่ในเครื่องผู้ใช้จริงอยู่แล้ว ─────────────────────────── */

let migrating = false;

/**
 * รูปที่ถ่ายไว้ก่อนย้ายมาใช้ storage — ยังเป็น data URL อยู่ในแถว
 *
 * ทำทีละใบเป็น background หลังเปิดแอป ไม่บล็อกอะไร ล้มกลางทางก็ไม่มีอะไรหาย
 * เพราะ dataUrl ถูกล้าง "หลัง" storagePath ถูกตั้งเท่านั้น (ดูลำดับใน uploadOne)
 * เงื่อนไขหาใบถัดไปคือ "มี dataUrl แต่ไม่มี storagePath" ซึ่งคำนวณใหม่ได้ทุกรอบ
 * จึงไม่ต้องจำสถานะการย้ายไว้ที่ไหนเลย และรันซ้ำกี่รอบก็ปลอดภัย
 */
export async function migrateLegacyPhotos(): Promise<number> {
  if (!cloudEnabled || !supabase || migrating || ownerStudentId === undefined) return 0;
  migrating = true;
  try {
    const legacy = (await db.photos.toArray()).filter((p) => p.dataUrl && !p.storagePath);
    let moved = 0;
    for (const p of legacy) {
      // หยุดถ้าเน็ตหลุดกลางทาง — ที่เหลือรอรอบหน้า ดีกว่าไล่ยิงทั้งชุดให้ fail หมด
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      const r = await uploadOne(p);
      if (r === 'uploaded') moved++;
      else if (r === 'retry') break;
    }
    if (moved) await pruneLocalCache();
    return moved;
  } finally {
    migrating = false;
  }
}

/* ── เพดานสำเนาในเครื่อง ──────────────────────────────────────────────────── */

async function pruneLocalCache(): Promise<void> {
  const rows = await db.blobs.toArray();
  let total = rows.reduce((n, r) => n + r.bytes, 0);
  if (total <= LOCAL_CACHE_LIMIT) return;

  /**
   * ⚠️ ทิ้งได้เฉพาะใบที่ storagePath ยืนยันแล้วเท่านั้น
   * ใบที่ยังไม่ขึ้นคลาวด์คือสำเนาเดียวที่มีอยู่ในโลก ลบทิ้ง = รูปคนไข้หายถาวร
   */
  const confirmed = new Set(
    (await db.photos.toArray()).filter((p) => p.storagePath).map((p) => p.id),
  );
  const evictable = rows
    .filter((r) => confirmed.has(r.photoId))
    .sort((a, b) => a.at.localeCompare(b.at)); // เก่าสุดไปก่อน

  const drop: string[] = [];
  for (const r of evictable) {
    if (total <= LOCAL_CACHE_LIMIT) break;
    drop.push(r.photoId);
    total -= r.bytes;
  }
  await dropLocalBlobs(drop);
}

/* ── ลบไฟล์ ───────────────────────────────────────────────────────────────── */

/**
 * ลบไฟล์ในบักเก็ต — เรียกตอนลบชิ้นงาน/ลบนักศึกษา
 *
 * ล้มก็ไม่ทำให้การลบข้อมูลล้มตาม: 0018 มี trigger บนตาราง photos ที่เก็บกวาด
 * storage.objects ให้อีกชั้นตอนแถวถูกลบฝั่งเซิร์ฟเวอร์ (ครอบ purge_expired_cohorts ของ 0016 ด้วย)
 * ทางนี้เป็นทางหลักเพราะมันลบไบต์จริง — trigger เป็นตาข่ายกันไฟล์ค้างเฉยๆ
 */
export async function removePhotoFiles(paths: string[]): Promise<void> {
  const clean = paths.filter(Boolean);
  if (!clean.length || !supabase) return;
  for (let i = 0; i < clean.length; i += 100) {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(clean.slice(i, i + 100));
    if (error) console.error('ลบไฟล์รูปบนเซิร์ฟเวอร์ไม่สำเร็จ', error);
  }
}

/* ── ลิงก์สำหรับแสดงผล ────────────────────────────────────────────────────── */

const objectUrls = new Map<string, string>(); // photoId → blob: URL
const signedUrls = new Map<string, { url: string; exp: number }>(); // path → ลิงก์ที่เซ็นแล้ว

function forgetObjectUrl(photoId: string) {
  const u = objectUrls.get(photoId);
  if (!u) return;
  URL.revokeObjectURL(u);
  objectUrls.delete(photoId);
}

/**
 * หา src ให้รูปหลายใบพร้อมกัน — คืน Map photoId → URL
 *
 * รับเป็นชุดไม่ใช่ทีละใบ เพราะบักเก็ตเป็น private ต้องขอลิงก์ที่เซ็นแล้ว
 * หน้าตรวจงานของอาจารย์เปิดทีเดียว 6 รูป × หลายชิ้นงาน ถ้ายิงทีละใบคือหลายสิบ request
 */
export async function resolvePhotoSrc(photos: Photo[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const needSign: string[] = [];
  const owner = new Map<string, string>(); // path → photoId

  for (const p of photos) {
    const cached = objectUrls.get(p.id);
    if (cached) { out.set(p.id, cached); continue; }

    // สำเนาในเครื่องมาก่อนเสมอ — เร็วกว่า ไม่กินเน็ต และใช้ได้ตอนออฟไลน์
    const local = await db.blobs.get(p.id);
    if (local) {
      const u = URL.createObjectURL(local.blob);
      objectUrls.set(p.id, u);
      out.set(p.id, u);
      continue;
    }
    // ของเก่าที่ยังไม่ได้ย้าย — ยังต้องแสดงได้ระหว่างรอคิวย้าย
    if (p.dataUrl) { out.set(p.id, p.dataUrl); continue; }

    if (p.storagePath && supabase) {
      const s = signedUrls.get(p.storagePath);
      if (s && s.exp > Date.now()) { out.set(p.id, s.url); continue; }
      needSign.push(p.storagePath);
      owner.set(p.storagePath, p.id);
    }
  }

  if (needSign.length && supabase) {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(needSign, SIGNED_TTL_SEC);
    for (const row of data ?? []) {
      if (!row.signedUrl || !row.path) continue;
      // หมดอายุก่อนจริง 1 นาที — กันกรณีผู้ใช้เปิดรูปพอดีตอนลิงก์กำลังจะหมด
      signedUrls.set(row.path, { url: row.signedUrl, exp: Date.now() + (SIGNED_TTL_SEC - 60) * 1000 });
      const id = owner.get(row.path);
      if (id) out.set(id, row.signedUrl);
    }
  }
  return out;
}

/* ── ลองใหม่ ──────────────────────────────────────────────────────────────── */

/** ผู้ใช้แตะรูปที่ขึ้นว่า "ส่งไม่สำเร็จ" ในหน้าคลังรูป */
export async function retryPhotoUpload(photoId: string): Promise<void> {
  attempts.delete(photoId);
  const p = await db.photos.get(photoId);
  if (!p || p.storagePath) return;
  await db.photos.put({ ...p, status: initialPhotoStatus() });
  await uploadPendingPhotos();
}

/** ผู้ใช้กด "ลองส่งใหม่" ที่การ์ดเตือนหน้า sync — ปลดใบที่ยอมแพ้ไปแล้วทั้งหมด */
async function retryAllFailed(): Promise<void> {
  attempts.clear();
  const failed = await db.photos.where('status').equals('fail').toArray();
  for (const p of failed) {
    if (p.storagePath) continue;
    await db.photos.put({ ...p, status: initialPhotoStatus() });
  }
  await uploadPendingPhotos();
}

/* ── จุดสตาร์ท ────────────────────────────────────────────────────────────── */

let wired = false;

/**
 * เรียกคู่กับ initCloudSync() ใน store/app.ts — ต้องส่ง studentId ของคนที่ล็อกอินมาด้วย
 * ไม่ใช่ import จาก store เอง เพราะไฟล์นี้ถูก cloudSync/repo เรียกใช้ตั้งแต่ตอน init
 * ถ้าไป import store กลับมาจะเป็นวงกลมและลำดับการ init จะเดาไม่ได้
 */
export function initPhotoSync(studentId: string | undefined): void {
  ownerStudentId = studentId;
  if (!cloudEnabled) return;
  if (!wired) {
    wired = true;
    onSyncPump(async () => { await uploadPendingPhotos(); });
    onRetryRequested(() => void retryAllFailed());
  }
  // ย้ายของเก่าเป็น background — ไม่ await ไม่งั้นเปิดแอปค้างรอรูปเป็นสิบใบ
  void (async () => {
    await uploadPendingPhotos();
    await migrateLegacyPhotos();
  })();
}

/** ออกจากระบบ / สลับบัญชี — สำเนาลิงก์ของคนก่อนต้องไม่ค้าง */
export function stopPhotoSync(): void {
  ownerStudentId = undefined;
  attempts.clear();
  signedUrls.clear();
  [...objectUrls.keys()].forEach(forgetObjectUrl);
}
