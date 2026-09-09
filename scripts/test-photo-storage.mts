/**
 * ทดสอบว่า "ย้ายรูปไป Supabase Storage แล้วรูปคนไข้ไม่หาย และป้ายไม่โกหก"
 * รันด้วย `npm run test:photos`
 *
 * ทำไมต้องมี: รูปในปากคนไข้ถ่ายซ้ำไม่ได้ ถ้าโค้ดลบของในเครื่องเร็วไปหนึ่งจังหวะ
 * ก่อนที่คลาวด์จะยืนยัน มันหายถาวรโดยไม่มี error ให้ใครเห็น
 * และระบบนี้เคยขึ้นป้าย "อัปโหลดแล้ว" ทั้งที่ไม่มีรูปอยู่จริงมาแล้วสองรอบ
 * (addPhoto รุ่นแรกสร้างแถวเปล่า · syncNow ตั้ง status='ok' ให้ทุกใบโดยไม่ส่งอะไรขึ้นไป)
 * ทั้งสองรอบไม่มีเทสต์จับได้ เพราะไม่มีใครเขียนเทสต์ที่ถามว่า "แล้วไฟล์อยู่ไหน"
 *
 * วิธีทำงาน: ก๊อป src/data/photoStore.ts ตัวจริงไป temp แล้วตัด import ทิ้ง ใส่ของปลอมแทน
 * (บักเก็ตปลอม + ลิ้นชักปลอม) — ตรรกะที่ทดสอบคือของจริงทุกบรรทัด
 *
 * ⚠️ caseCode() กับ dataUrlToBlob() ใช้ของจริง ไม่ปลอม — ข้อ ③ ทดสอบว่าชื่อไฟล์
 *    ไม่มี HN หรือชื่อคนไข้ ซึ่งถ้าใช้ของปลอมก็ทดสอบไปเท่านั้นเอง ไม่ได้ตรวจอะไร
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const urlOf = (rel: string) => pathToFileURL(join(root, rel)).href;

/* ── สภาพแวดล้อมกลาง (บักเก็ต + รายการที่ถูกแจ้งเตือน) ────────────────────── */

interface Env {
  /** ไฟล์ในบักเก็ต: path → ขนาด/ชนิด */
  bucket: Map<string, { bytes: number; type?: string }>;
  /** จำนวนครั้งที่มีการยิง upload (รวมที่ล้ม) — ใช้พิสูจน์ว่า "ไม่ได้ยิงเลย" */
  uploads: number;
  /** ตั้งไว้ = ให้ upload ล้มด้วย error ก้อนนี้ (จำลองเน็ตหลุด / โควตาเต็ม / RLS) */
  fail: { message: string; statusCode?: string } | null;
  /** ของที่ photoStore แจ้งเข้าการ์ดเตือนหน้า sync */
  problems: { table: string; key: unknown; reason: string }[];
}
const ENV: Env = { bucket: new Map(), uploads: 0, fail: null, problems: [] };
(globalThis as never as { __PHOTO_ENV__: Env }).__PHOTO_ENV__ = ENV;

const resetEnv = () => {
  ENV.bucket.clear();
  ENV.uploads = 0;
  ENV.fail = null;
  ENV.problems.length = 0;
};

/* ── ของปลอมที่ยัดแทน import ของ photoStore.ts ────────────────────────────── */

const PRELUDE = (cloud: boolean) => `
const ENV = globalThis.__PHOTO_ENV__;

import { caseCode } from ${JSON.stringify(urlOf('src/lib/privacy.ts'))};
import { dataUrlToBlob } from ${JSON.stringify(urlOf('src/lib/image.ts'))};
export { caseCode, dataUrlToBlob };

export const cloudEnabled = ${cloud};
/** i18n ตัวจริงอ่าน localStorage — โหมดไทยคืนข้อความเดิมอยู่แล้ว จำลองแค่การแทนตัวแปร */
export const t = (s, p) => (p ? s.replace(/\\{(\\w+)\\}/g, (_, k) => String(p[k] ?? '')) : s);

/* cloudSync ปลอม — สนใจแค่ว่ามีอะไรถูกแจ้งเข้าการ์ดเตือนบ้าง */
export const reportSyncProblem = (table, key, reason) => { ENV.problems.push({ table, key, reason }); };
export const onSyncPump = () => () => {};
export const onRetryRequested = () => () => {};

/* Node ไม่มี URL.createObjectURL — ตัวเลขในลิงก์ไม่สำคัญ ขอแค่ได้สตริงกลับมา */
if (typeof URL.createObjectURL !== 'function') {
  let n = 0;
  URL.createObjectURL = () => 'blob:fake/' + (++n);
  URL.revokeObjectURL = () => {};
}

/* ── ลิ้นชักในเครื่องปลอม ──────────────────────────────────────────────────
   ใช้ structuredClone เหมือน IndexedDB ของจริง — สำคัญกับข้อ ⑦ ที่ตรวจว่า
   คีย์ dataUrl ยัง "มีอยู่" โดยมีค่าเป็น undefined (ไม่ใช่ถูกลบคีย์ทิ้ง) */
class Tbl {
  constructor(pk) { this.pk = pk; this.m = new Map(); }
  async get(k) { return this.m.get(k); }
  async put(o) { this.m.set(o[this.pk], structuredClone(o)); }
  async add(o) { this.m.set(o[this.pk], structuredClone(o)); }
  async delete(k) { this.m.delete(k); }
  async bulkDelete(ks) { ks.forEach((k) => this.m.delete(k)); }
  async bulkGet(ks) { return ks.map((k) => this.m.get(k)); }
  async toArray() { return [...this.m.values()]; }
  where(field) {
    const rows = () => [...this.m.values()];
    return {
      anyOf: (...vals) => {
        const set = new Set(vals.flat());
        return { toArray: async () => rows().filter((r) => set.has(r[field])) };
      },
      equals: (v) => ({ toArray: async () => rows().filter((r) => r[field] === v) }),
    };
  }
}
export const db = {
  photos: new Tbl('id'),
  blobs: new Tbl('photoId'),
  workpieces: new Tbl('id'),
};

/* ── บักเก็ตปลอม ──────────────────────────────────────────────────────────── */
export const supabase = ${cloud} ? {
  storage: {
    from(bucket) {
      return {
        async upload(path, blob, opts) {
          ENV.uploads++;
          if (ENV.fail) return { data: null, error: ENV.fail };
          if (bucket !== 'case-photos') {
            return { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
          }
          ENV.bucket.set(path, { bytes: blob.size, type: opts?.contentType });
          return { data: { path }, error: null };
        },
        async remove(paths) {
          paths.forEach((p) => ENV.bucket.delete(p));
          return { data: null, error: null };
        },
        async createSignedUrls(paths, ttl) {
          return {
            data: paths.map((p) => ({ path: p, signedUrl: 'https://fake/' + p + '?ttl=' + ttl, error: null })),
            error: null,
          };
        },
      };
    },
  },
} : null;
`;

let nth = 0;

interface Store {
  db: {
    photos: { get: (k: string) => Promise<Rec | undefined>; put: (o: Rec) => Promise<void>; toArray: () => Promise<Rec[]> };
    blobs: { get: (k: string) => Promise<Rec | undefined>; put: (o: Rec) => Promise<void>; toArray: () => Promise<Rec[]> };
    workpieces: { put: (o: Rec) => Promise<void> };
  };
  initialPhotoStatus: () => string;
  initPhotoSync: (id: string | undefined) => void;
  uploadPendingPhotos: () => Promise<{ uploaded: number; failed: number }>;
  migrateLegacyPhotos: () => Promise<number>;
  removePhotoFiles: (paths: string[]) => Promise<void>;
  resolvePhotoSrc: (photos: Rec[]) => Promise<Map<string, string>>;
  retryPhotoUpload: (id: string) => Promise<void>;
  photoPath: (s: string, p: string, w: string, ph: string) => string;
  caseCode: (id: string) => string;
}
type Rec = Record<string, unknown>;

/** เปิด "เครื่อง" ใหม่หนึ่งเครื่อง — cloud=false จำลองโหมดเดโม/แชร์/GitHub Pages */
async function store(cloud = true): Promise<Store> {
  const src = readFileSync(join(root, 'src/data/photoStore.ts'), 'utf8')
    .replace("import { db } from './db';", '')
    .replace("import { cloudEnabled, supabase } from '../lib/cloud';", '')
    .replace("import { onRetryRequested, onSyncPump, reportSyncProblem } from './cloudSync';", '')
    .replace("import { dataUrlToBlob } from '../lib/image';", '')
    .replace("import { caseCode } from '../lib/privacy';", '')
    .replace("import { t } from '../lib/i18n';", '')
    .replace("import type { Photo, PhotoStatus } from '../domain/types';", '');
  const dir = mkdtempSync(join(tmpdir(), `photostore-${nth++}-`));
  const f = join(dir, 'mod.mts');
  writeFileSync(f, PRELUDE(cloud) + src);
  return (await import(f)) as unknown as Store;
}

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  → ' + extra : ''));
  if (!ok) failures++;
}
/** initPhotoSync ยิงงานเป็น background — รอให้จบก่อนค่อยตรวจ */
const settle = () => new Promise((r) => setTimeout(r, 60));

/* ── ข้อมูลสมมติ (ห้ามมีข้อมูลผู้ป่วยจริงใน repo) ─────────────────────────── */
const PATIENT_HN = 'DEMO-4471';
const PATIENT_NAME = 'ผู้ป่วย ก';
const WORK = { id: 'w1', studentId: 'st1', patientId: 'pt1', type: 'CD', detail: 'CD บน' };
const photoRow = (over: Rec = {}): Rec => ({
  id: 'ph1',
  workpieceId: 'w1',
  progression: 40,
  stepLabel: 'CD-4',
  sizeLabel: '210 KB',
  status: 'queue',
  createdAt: '2026-09-10T02:00:00.000Z',
  ...over,
});
const jpeg = (n = 2048) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
/** data URL ปลอมของรูปเก่า — เนื้อในไม่ต้องเป็น JPEG จริง ขอแค่ base64 ถอดได้ */
const LEGACY_DATA_URL = 'data:image/jpeg;base64,' + Buffer.from('รูปเก่าในเครื่อง').toString('base64');

/* ══ ① โหมดที่ไม่มีคลาวด์ ต้องไม่อ้างว่าอัปโหลดแล้ว ════════════════════════ */
console.log('\nโหมดเดโม / แชร์ / GitHub Pages (ไม่มีเซิร์ฟเวอร์ให้อัป)');
{
  resetEnv();
  const m = await store(false);
  check('สถานะตั้งต้นคือ "เก็บในเครื่อง" ไม่ใช่ ok', m.initialPhotoStatus() === 'local', m.initialPhotoStatus());

  await m.db.workpieces.put(WORK);
  await m.db.photos.put(photoRow({ status: m.initialPhotoStatus() }));
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });
  m.initPhotoSync('st1');
  await settle();

  const p = (await m.db.photos.get('ph1'))!;
  check('ไม่ยิงอัปโหลดเลย', ENV.uploads === 0, String(ENV.uploads));
  check('ไม่มีป้าย "อัปโหลดแล้ว" หลุดมา', p.status !== 'ok', String(p.status));
  check('ไม่มี storagePath ปลอมๆ ติดมา', p.storagePath === undefined);
  check('รูปยังอยู่ในเครื่องครบ', !!(await m.db.blobs.get('ph1')));
}

/* ══ ② ถ่ายตอนออฟไลน์ แล้วขึ้นเองตอนเน็ตกลับมา ════════════════════════════ */
console.log('\nถ่ายรูปข้างเก้าอี้คนไข้ตอนเน็ตหลุด แล้วกลับมาออนไลน์');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  await m.db.photos.put(photoRow());
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });

  // ยังไม่ต่อคลาวด์ (ยังไม่เรียก initPhotoSync) = จำลองช่วงที่ยังออฟไลน์อยู่
  check('ตอนออฟไลน์ ไบต์อยู่ในเครื่องแล้ว', !!(await m.db.blobs.get('ph1')));
  check('ตอนออฟไลน์ ยังไม่มีไฟล์บนเซิร์ฟเวอร์', ENV.bucket.size === 0);

  m.initPhotoSync('st1');
  await settle();

  const p = (await m.db.photos.get('ph1'))!;
  check('พอออนไลน์แล้วไฟล์ขึ้นบักเก็ตจริง', ENV.bucket.size === 1, [...ENV.bucket.keys()].join());
  check('storagePath ถูกตั้งตามไฟล์ที่ขึ้นจริง', ENV.bucket.has(String(p.storagePath)), String(p.storagePath));
  check('สถานะเป็น ok หลังเซิร์ฟเวอร์ตอบรับเท่านั้น', p.status === 'ok', String(p.status));
  check('สำเนาในเครื่องยังอยู่ (ดูรูปตัวเองตอนออฟไลน์ได้)', !!(await m.db.blobs.get('ph1')));
  check('ส่งขึ้นเป็น image/jpeg', ENV.bucket.get(String(p.storagePath))?.type === 'image/jpeg');
}

/* ══ ③ ชื่อไฟล์ห้ามมีชื่อคนไข้หรือ HN ═════════════════════════════════════ */
console.log('\nชื่อไฟล์ในบักเก็ต (ข้อมูลอ่อนไหวที่สุดในระบบ)');
{
  resetEnv();
  const m = await store(true);
  const path = m.photoPath('st1', 'pt1', 'w1', 'ph1');

  check('ไม่มี HN อยู่ในชื่อไฟล์', !path.includes(PATIENT_HN), path);
  check('ไม่มีชื่อคนไข้อยู่ในชื่อไฟล์', !path.includes(PATIENT_NAME), path);
  check('ไม่มี patientId ดิบอยู่ในชื่อไฟล์', !path.includes('pt1'), path);
  check('ใช้รหัสเคสจาก privacy.caseCode()', path.includes(m.caseCode('pt1')), path);
  // ถ้าโฟลเดอร์แรกไม่ใช่ studentId นโยบาย RLS ใน 0018 จะเขียนไม่ได้เลย
  check('โฟลเดอร์แรกเป็น studentId (RLS ของ 0018 อ่านตำแหน่งนี้)', path.startsWith('st1/'), path);
  check('รหัสเคสคงที่ ไม่สุ่มใหม่ทุกครั้ง', m.photoPath('st1', 'pt1', 'w1', 'ph1') === path);
}

/* ══ ④ เน็ตสะดุด — ลองใหม่ก่อน แล้วค่อยยอมแพ้แบบมีเสียง ═══════════════════ */
console.log('\nเน็ตคลินิกสะดุด (ล้มแบบชั่วคราว)');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  await m.db.photos.put(photoRow());
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });
  ENV.fail = { message: 'network error' };

  m.initPhotoSync('st1');
  await settle();
  let p = (await m.db.photos.get('ph1'))!;
  check('รอบแรกยังไม่ประกาศว่าล้ม (เน็ตสะดุดเป็นเรื่องปกติ)', p.status === 'queue', String(p.status));
  check('รอบแรกยังไม่รบกวนผู้ใช้', ENV.problems.length === 0);

  await m.uploadPendingPhotos();
  await m.uploadPendingPhotos();
  p = (await m.db.photos.get('ph1'))!;
  check('ครบโควตาแล้วขึ้นว่าส่งไม่สำเร็จ', p.status === 'fail', String(p.status));
  check('โผล่ในการ์ดเตือนหน้า sync — ไม่เงียบ', ENV.problems.length === 1, JSON.stringify(ENV.problems));
  check('ไม่มี storagePath ปลอม', p.storagePath === undefined);
  check('⚠️ รูปในเครื่องยังอยู่ครบ ไม่ถูกลบตอนล้ม', !!(await m.db.blobs.get('ph1')));

  // ผู้ใช้แตะปุ่มลองใหม่หลังเน็ตกลับมา
  ENV.fail = null;
  await m.retryPhotoUpload('ph1');
  p = (await m.db.photos.get('ph1'))!;
  check('กดลองใหม่แล้วขึ้นได้จริง', p.status === 'ok' && ENV.bucket.size === 1, String(p.status));
}

/* ══ ⑤ โควตาเต็ม / ไม่มีสิทธิ์ — ลองใหม่ไปก็เท่านั้น ต้องบอกทันที ══════════ */
console.log('\nพื้นที่เก็บไฟล์บนเซิร์ฟเวอร์เต็ม');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  await m.db.photos.put(photoRow());
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });
  ENV.fail = { message: 'exceeded the storage quota', statusCode: '507' };

  m.initPhotoSync('st1');
  await settle();

  const p = (await m.db.photos.get('ph1'))!;
  check('ยอมแพ้ตั้งแต่รอบแรก ไม่วนรบกวนเน็ตทุก 15 วิ', ENV.uploads === 1, String(ENV.uploads));
  check('บอกผู้ใช้ทันที ไม่ค้างเป็น "รออัปโหลด" เงียบๆ', ENV.problems.length === 1, JSON.stringify(ENV.problems));
  check('บอกสาเหตุที่คนอ่านรู้เรื่อง', String(ENV.problems[0]?.reason).includes('เต็ม'), ENV.problems[0]?.reason);
  check('⚠️ รูปในเครื่องยังอยู่ครบ', !!(await m.db.blobs.get('ph1')));
  check('ไม่มีแถวไหนอ้างว่าอัปโหลดแล้ว', p.status !== 'ok' && p.storagePath === undefined);
}

/* ══ ⑥ รูปเก่าที่อยู่ในเครื่องผู้ใช้จริงอยู่แล้ว ═══════════════════════════ */
console.log('\nย้ายรูปเก่า (data URL) ขึ้นบักเก็ต');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  // ของเก่าหน้าตาแบบนี้: status 'ok' (ป้ายหลอกของเดิม) · มี dataUrl · ไม่มี storagePath · ไม่มี blob
  await m.db.photos.put(photoRow({ status: 'ok', dataUrl: LEGACY_DATA_URL }));

  m.initPhotoSync('st1');
  await settle();

  const p = (await m.db.photos.get('ph1'))!;
  check('ไฟล์ขึ้นบักเก็ตแล้ว', ENV.bucket.size === 1, [...ENV.bucket.keys()].join());
  check('storagePath ถูกตั้ง', ENV.bucket.has(String(p.storagePath)), String(p.storagePath));
  check('ล้าง dataUrl ทิ้งหลังยืนยันแล้วเท่านั้น', p.dataUrl === undefined);
  /* คีย์ต้องยังอยู่ ไม่ใช่ถูกลบทิ้ง — cloudSync.toRow แปลง undefined → null
     แต่ "ไม่มีคีย์" = ไม่ส่งคอลัมน์นั้นขึ้นไป แล้ว upsert จะคง data_url ก้อนเก่า
     ไว้บน Postgres ตลอดกาล = base64 ไม่เคยหายไปจากฐานข้อมูลเลย */
  check('⚠️ คีย์ dataUrl ยังมีอยู่ (ไม่งั้น base64 ค้างบน Postgres ตลอดกาล)', 'dataUrl' in p);
  check('เก็บสำเนาลงเครื่องด้วย (ยังดูออฟไลน์ได้เหมือนเดิม)', !!(await m.db.blobs.get('ph1')));
}

/* ══ ⑦ ย้ายไม่สำเร็จ ต้องไม่มีอะไรหาย ════════════════════════════════════ */
console.log('\nย้ายรูปเก่าแล้วล้มกลางทาง');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  await m.db.photos.put(photoRow({ status: 'ok', dataUrl: LEGACY_DATA_URL }));
  ENV.fail = { message: 'network error' };

  m.initPhotoSync('st1');
  await settle();
  await m.migrateLegacyPhotos();
  await m.migrateLegacyPhotos();

  const p = (await m.db.photos.get('ph1'))!;
  check('⚠️ dataUrl ยังอยู่ครบ ไม่ถูกล้างก่อนยืนยัน', p.dataUrl === LEGACY_DATA_URL);
  check('ไม่มี storagePath ปลอม', p.storagePath === undefined);
  check('ไม่มีไฟล์ค้างในบักเก็ต', ENV.bucket.size === 0);

  // เน็ตกลับมา → ย้ายต่อจากใบเดิมได้เลย ไม่ต้องจำสถานะไว้ที่ไหน
  ENV.fail = null;
  const moved = await m.migrateLegacyPhotos();
  check('เน็ตกลับมาแล้วย้ายต่อได้', moved === 1 && ENV.bucket.size === 1, String(moved));
}

/* ══ ⑧ เพดานสำเนาในเครื่อง ห้ามกินของที่ยังไม่ขึ้น ═══════════════════════ */
console.log('\nสำเนาในเครื่องชนเพดาน 60 MB');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  const MB = 1024 * 1024;

  // สองใบที่ขึ้นคลาวด์แล้ว (ทิ้งได้) + หนึ่งใบที่ยังไม่ขึ้น (ห้ามแตะ)
  await m.db.photos.put(photoRow({ id: 'old1', status: 'ok', storagePath: 'st1/x/w1/old1.jpg' }));
  await m.db.photos.put(photoRow({ id: 'old2', status: 'ok', storagePath: 'st1/x/w1/old2.jpg' }));
  /* ใบที่ส่งขึ้นไม่ได้ถาวร (โควตาเต็ม/ไฟล์ใหญ่เกิน) — ไบต์ในเครื่องคือสำเนาเดียวที่มีในโลก
     ตั้ง 'fail' เพราะถ้าตั้ง 'queue' ตัวอัปจะเก็บมันขึ้นคลาวด์สำเร็จเสียก่อน
     แล้วเทสต์จะกลายเป็นทดสอบใบที่ยืนยันแล้ว = ไม่ได้ตรวจอะไรเลย (เจอตอนรันรอบแรก) */
  await m.db.photos.put(photoRow({ id: 'notUp', status: 'fail' }));
  await m.db.blobs.put({ photoId: 'old1', blob: jpeg(), bytes: 25 * MB, at: '2026-01-01T00:00:00.000Z' });
  await m.db.blobs.put({ photoId: 'old2', blob: jpeg(), bytes: 25 * MB, at: '2026-02-01T00:00:00.000Z' });
  // ใบที่ยังไม่ขึ้นเป็นใบ "เก่าที่สุด" โดยตั้งใจ — ถ้าโค้ดเรียงตามอายุอย่างเดียว มันจะโดนทิ้งก่อนใคร
  await m.db.blobs.put({ photoId: 'notUp', blob: jpeg(), bytes: 25 * MB, at: '2025-12-01T00:00:00.000Z' });

  // อัปใบใหม่ให้สำเร็จหนึ่งใบ เพื่อให้ pruneLocalCache ทำงาน
  await m.db.photos.put(photoRow({ id: 'ph1' }));
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });
  m.initPhotoSync('st1');
  await settle();

  const left = (await m.db.blobs.toArray()).map((r) => r.photoId as string);
  const total = (await m.db.blobs.toArray()).reduce((n, r) => n + (r.bytes as number), 0);
  check('⚠️ ใบที่ยังไม่ขึ้นคลาวด์ไม่ถูกทิ้ง (เป็นสำเนาเดียวที่มีในโลก)', left.includes('notUp'), left.join());
  check('ทิ้งใบเก่าสุดที่ยืนยันแล้วก่อน', !left.includes('old1'), left.join());
  check('ใบที่ยืนยันแล้วใบที่สองยังอยู่ (ทิ้งเท่าที่จำเป็น)', left.includes('old2'), left.join());
  check('เหลืออยู่ใต้เพดาน', total <= 60 * MB, `${Math.round(total / MB)} MB`);
}

/* ══ ⑨ ลบแล้วไฟล์ต้องไม่ค้าง ══════════════════════════════════════════════ */
console.log('\nลบชิ้นงาน / ลบรูป');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  await m.db.photos.put(photoRow());
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });
  m.initPhotoSync('st1');
  await settle();

  const path = String((await m.db.photos.get('ph1'))!.storagePath);
  check('ตั้งต้น: มีไฟล์อยู่ในบักเก็ต', ENV.bucket.size === 1);
  await m.removePhotoFiles([path]);
  check('ลบแล้วไฟล์ไม่ค้างในบักเก็ต', ENV.bucket.size === 0);
  // ส่ง path ว่าง/undefined ปนมาต้องไม่พัง (แถวที่ยังไม่เคยขึ้นคลาวด์ไม่มี path)
  await m.removePhotoFiles(['', undefined as unknown as string]);
  check('รับ path ว่างได้ ไม่ล้ม', true);
}

/* ══ ⑩ เครื่องอาจารย์ต้องไม่ไล่อัปรูปของ นศ. ทุกคน ═══════════════════════ */
console.log('\nเครื่องอาจารย์ (ดึงแถวของ นศ. ทุกคนลงมา)');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK); // ของ st1
  await m.db.photos.put(photoRow());
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });

  m.initPhotoSync(undefined); // บัญชีอาจารย์ ไม่มี studentId
  await settle();
  check('ไม่ไล่อัปรูปของคนอื่น', ENV.uploads === 0, String(ENV.uploads));
  check('ไม่มี 403 รกการ์ดเตือน', ENV.problems.length === 0, JSON.stringify(ENV.problems));

  // ดูรูปยังต้องได้ตามปกติ
  const rows = await m.db.photos.toArray();
  const srcs = await m.resolvePhotoSrc(rows);
  check('อาจารย์ยังเปิดดูรูปได้', !!srcs.get('ph1'));
}

/* ══ ⑪ เครื่องที่สองของ นศ. คนเดียวกัน (ไม่มีไบต์อยู่) ═══════════════════ */
console.log('\nนักศึกษาเปิดจากเครื่องที่สอง ระหว่างที่เครื่องแรกยังไม่ได้อัป');
{
  resetEnv();
  const m = await store(true);
  await m.db.workpieces.put(WORK);
  // แถวไหลมาทาง sync แล้ว แต่ไบต์ยังอยู่เครื่องแรก
  await m.db.photos.put(photoRow({ status: 'queue' }));

  m.initPhotoSync('st1');
  await settle();

  const p = (await m.db.photos.get('ph1'))!;
  check('ไม่ยิงอัปทั้งที่ไม่มีไฟล์จะส่ง', ENV.uploads === 0, String(ENV.uploads));
  check('ไม่ตีเป็น "ส่งไม่สำเร็จ" — เครื่องนี้ไม่ได้ผิดอะไร', p.status === 'queue', String(p.status));
  check('ไม่รบกวนผู้ใช้ด้วยปัญหาที่เครื่องนี้แก้ไม่ได้', ENV.problems.length === 0);
  check('และไม่โกหกว่าอัปแล้ว', p.storagePath === undefined && p.status !== 'ok');
}

/* ══ ⑫ ชิ้นงานถูกลบระหว่างรูปยังค้างคิว ═════════════════════════════════ */
console.log('\nลบชิ้นงานทิ้งระหว่างที่รูปยังค้างคิว');
{
  resetEnv();
  const m = await store(true);
  await m.db.photos.put(photoRow()); // ไม่มี workpiece w1 แล้ว
  await m.db.blobs.put({ photoId: 'ph1', blob: jpeg(), bytes: 2048, at: '2026-09-10T02:00:00.000Z' });

  m.initPhotoSync('st1');
  await settle();

  check('ไม่อัปรูปของชิ้นงานที่ไม่มีแล้ว', ENV.bucket.size === 0);
  check('เก็บกวาดแถวกำพร้าทิ้ง', (await m.db.photos.get('ph1')) === undefined);
  check('เก็บกวาดไบต์กำพร้าในเครื่องด้วย', (await m.db.blobs.get('ph1')) === undefined);
  check('ไม่นับเป็นความผิดพลาด', ENV.problems.length === 0);
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
