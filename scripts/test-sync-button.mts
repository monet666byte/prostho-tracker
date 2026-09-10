/**
 * เทสต์ชุดที่ 13 — ปุ่ม "sync ทันที" ต้องไม่โกหก · รันด้วย `npm run test:sync-button`
 *
 * ทำไมต้องมี: นี่คือปุ่มที่นักศึกษากดตอนออกจากคลินิกเพื่อให้แน่ใจว่างานขึ้นเซิร์ฟเวอร์แล้ว
 * ถ้ามันบอกว่าสำเร็จทั้งที่ไม่สำเร็จ ผู้ใช้จะเสียสัญญาณเดียวที่มี แล้วไปรู้ตัวตอนเปิดจาก
 * อีกเครื่องแล้วงานไม่อยู่ — ซึ่งสายไปแล้ว
 *
 * ป้ายหลอกในระบบนี้เคยมีมาสามตัว (สองตัวแรกแก้ไปแล้ว ตัวที่สามคือรอบนี้):
 *   ① addPhoto รุ่นแรกสร้างแถวรูปเปล่าพร้อมขนาดไฟล์ที่สุ่มขึ้นมา
 *   ② syncNow ตั้ง status='ok' ให้รูปทุกใบโดยไม่ส่งอะไร
 *   ③ syncNow ประทับ syncedAt + ล้างรายการ "รอส่ง" + จด audit ว่าสำเร็จ โดยไม่รู้ผลจริง
 *      และ **ไม่เคยเรียก flushNow()** ตัวส่งข้อมูลจริงเลย
 *
 * วิธีทำงาน (เหมือน test-export / test-conflict): ก๊อป repo.ts ตัวจริงไป temp
 * แล้วสับ import ที่เป็นของเบราว์เซอร์เป็นของปลอมที่คุมได้ — โค้ด syncNow ที่ถูกทดสอบ
 * เป็นของจริงทุกบรรทัด ไม่ได้เขียนตรรกะซ้ำในเทสต์
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const abs = (rel: string) => pathToFileURL(join(root, 'src', rel)).href;
const dir = mkdtempSync(join(tmpdir(), 'prostho-sync-'));

/* ── ① ตู้ข้อมูลปลอมในหน่วยความจำ — มีเท่าที่ syncNow แตะ ─────────────────── */
interface Row { [k: string]: unknown }
class Table {
  rows: Row[] = [];
  async toArray() { return [...this.rows]; }
  async add(r: Row) { this.rows.push(r); return r.id; }
  async clear() { this.rows = []; }
  async bulkPut(rs: Row[]) {
    for (const r of rs) {
      const i = this.rows.findIndex((x) => x.id === r.id);
      if (i >= 0) this.rows[i] = r; else this.rows.push(r);
    }
  }
  filter(fn: (r: Row) => boolean) {
    const self = this;
    return { async toArray() { return self.rows.filter(fn); } };
  }
  async put(r: Row) { await this.bulkPut([r]); }
  async get(id: unknown) { return this.rows.find((x) => x.id === id); }
  where(col: string) {
    const self = this;
    return {
      equals: (v: unknown) => ({ async toArray() { return self.rows.filter((r) => r[col] === v); } }),
      anyOf: (vs: unknown[]) => ({ async toArray() { return self.rows.filter((r) => vs.includes(r[col])); } }),
    };
  }
}
const G = globalThis as any;

function freshDb() {
  const tables: Record<string, Table> = {
    queue: new Table(), updates: new Table(), audit: new Table(),
    workpieces: new Table(), photos: new Table(),
  };
  return {
    ...tables,
    table: (n: string) => tables[n],
    // ธุรกรรมปลอม: รันตรง ๆ พอ — ที่เทสต์นี้สนใจคือ "เขียนอะไรลงไป" ไม่ใช่ atomicity
    async transaction(_mode: string, _tables: unknown, fn: () => Promise<void>) { await fn(); },
    _tables: tables,
  };
}

/* ── ② ก๊อป repo.ts แล้วสับ import ─────────────────────────────────────────── */
let src = readFileSync(join(root, 'src/data/repo.ts'), 'utf8');
const swap = (needle: string, replacement: string) => {
  if (!src.includes(needle)) {
    console.log(`❌ หา import ไม่เจอใน repo.ts: ${needle.slice(0, 70)}…\n   (repo.ts เปลี่ยนโครงแล้ว — ต้องมาแก้ test-sync-button.mts ด้วย)`);
    bad++;
    return;
  }
  src = src.replace(needle, replacement);
};

// ของที่คำนวณล้วน เอาของจริงมาใช้ได้เลย
for (const [needle, rel] of [
  ["from '../domain/catalog'", 'domain/catalog.ts'],
  ["from '../domain/checkin'", 'domain/checkin.ts'],
  ["from '../domain/cohort'", 'domain/cohort.ts'],
  ["from '../lib/privacy'", 'lib/privacy.ts'],
  ["from '../lib/date'", 'lib/date.ts'],
  ["from '../domain/rules'", 'domain/rules.ts'],
  ["from '../domain/types'", 'domain/types.ts'],
  ["from '../domain/selfAssessment'", 'domain/selfAssessment.ts'],
  ["from '../domain/conflict'", 'domain/conflict.ts'],
  ["from '../lib/i18n'", 'lib/i18n.ts'],
  ["from '../lib/image'", 'lib/image.ts'],
] as const) {
  swap(needle, `from '${abs(rel)}'`);
}

// ของที่เป็นเบราว์เซอร์ล้วน → ของปลอมที่คุมจากเทสต์
swap(
  "import { pdpaPolicy } from './pdpaSync';",
  `const pdpaPolicy = () => ({ retentionEnabled: false, retentionCohorts: 5, exportRoles: [], exportIdentifiedRoles: [], maskByDefault: true });`,
);
swap(
  "import { cloudEnabled, supabase } from '../lib/cloud';",
  `const cloudEnabled = false;\nconst supabase = null as any;`,
);
swap(
  "import { flushNow, pendingPushCount } from './cloudSync';",
  `const flushNow = async () => { (globalThis as any).__FLUSHED__++; await (globalThis as any).__ON_FLUSH__(); };
const pendingPushCount = () => (globalThis as any).__PENDING__;`,
);
swap(
  "import { db, kvGet, kvSet } from './db';",
  `const db = (globalThis as any).__DB__;
const kvGet = async () => undefined;
const kvSet = async () => {};`,
);
swap(
  "import { DEFAULT_SETTINGS, DEMO, SETTINGS_VERSION } from './seed';",
  `const DEFAULT_SETTINGS = {} as any;\nconst DEMO = {} as any;\nconst SETTINGS_VERSION = 1;`,
);
swap(
  `import {
  dropLocalBlobs, initialPhotoStatus, putLocalBlob, removePhotoFiles, retryPhotoUpload, uploadPendingPhotos,
} from './photoStore';`,
  `const dropLocalBlobs = async () => {};
const initialPhotoStatus = () => 'queue' as any;
const putLocalBlob = async () => {};
const removePhotoFiles = async () => {};
const retryPhotoUpload = async () => {};
const uploadPendingPhotos = async () => (globalThis as any).__PHOTOS__;`,
);

const modPath = join(dir, 'repo.mts');
writeFileSync(modPath, src, 'utf8');

let bust = 0;
const load = async () => await import(`${pathToFileURL(modPath).href}?v=${++bust}`);

/* ── ③ ตั้งฉากแล้วกดปุ่ม ───────────────────────────────────────────────────── */
interface Scene {
  queue?: number;          // มีรายการ "รอส่ง" กี่รายการ
  unsynced?: number;       // มีแถว updates ที่ syncedAt = null กี่แถว
  pendingAfter?: number;   // หลังส่งจริงแล้วยังเหลือค้างกี่แถว
  photos?: { uploaded: number; failed: number };
}
async function press(scene: Scene) {
  const db = freshDb();
  for (let i = 0; i < (scene.queue ?? 0); i++) {
    db._tables.queue.rows.push({ id: `q${i}`, workpieceId: 'w1', label: `step ${i}`, createdAt: new Date().toISOString(), kind: 'progress' });
  }
  for (let i = 0; i < (scene.unsynced ?? 0); i++) {
    db._tables.updates.rows.push({ id: `u${i}`, workpieceId: 'w1', syncedAt: null });
  }
  G.__DB__ = db;
  G.__FLUSHED__ = 0;
  G.__PENDING__ = scene.pendingAfter ?? 0;
  G.__PHOTOS__ = scene.photos ?? { uploaded: 0, failed: 0 };
  // ระหว่าง flush ของจริงจะส่งขึ้นจนเหลือเท่าที่ตั้งไว้ — จำลองด้วย hook นี้
  G.__ON_FLUSH__ = async () => {};

  const m = await load();
  const result = await m.syncNow('นศ. ทดสอบ');
  return {
    result,
    flushed: G.__FLUSHED__ as number,
    queue: db._tables.queue.rows.length,
    stillNull: db._tables.updates.rows.filter((r) => r.syncedAt === null).length,
    audit: db._tables.audit.rows.map((r) => String(r.text)),
  };
}

console.log('\n① ทุกอย่างขึ้นครบ — ปุ่มควรบอกว่าสำเร็จ และล้างรายการได้');
{
  const r = await press({ queue: 3, unsynced: 3, pendingAfter: 0, photos: { uploaded: 2, failed: 0 } });
  ok('เรียกตัวส่งข้อมูลจริง (flushNow) — ขั้นที่เคยหายไปทั้งขั้น', r.flushed === 1, `เรียก ${r.flushed} ครั้ง`);
  ok('รายการ "รอส่ง" ถูกล้าง', r.queue === 0, r.queue);
  ok('แถวที่ยังไม่ sync ถูกประทับเวลาครบ', r.stillNull === 0, r.stillNull);
  ok('รายงานจำนวนที่ล้างได้ถูกต้อง', r.result.cleared === 3 && r.result.photos === 2, JSON.stringify(r.result));
  ok('บอกว่ายังไม่มีอะไรค้าง', r.result.stillPending === 0);
  ok('audit เขียนว่าสำเร็จ', r.audit.some((a) => a.includes('sync ข้อมูลค้าง')), r.audit.join(' | '));
}

console.log('\n② ส่งไม่ขึ้น (เน็ตต่อติดแต่ยิงไม่ถึงเซิร์ฟเวอร์) — ห้ามบอกว่าสำเร็จ');
/* นี่คือเคสที่ทำให้บั๊กนี้ร้ายแรง: navigator.onLine เป็น true ปุ่มจึงกดได้
   แต่ upsert ทุกก้อนตก แถวยังค้างอยู่ในเครื่องครบ */
{
  const r = await press({ queue: 3, unsynced: 3, pendingAfter: 5, photos: { uploaded: 0, failed: 0 } });
  ok('รายการ "รอส่ง" ต้องยังอยู่ (สัญญาณเดียวที่ผู้ใช้มี)', r.queue === 3, r.queue);
  ok('ห้ามประทับ syncedAt ให้แถวที่ยังไม่ได้ขึ้น', r.stillNull === 3, r.stillNull);
  ok('รายงานว่ายังค้าง 5 แถว', r.result.stillPending === 5, JSON.stringify(r.result));
  ok('ไม่รายงานว่าล้างอะไรได้', r.result.cleared === 0);
  ok('audit เขียนตามจริงว่ายังไม่ครบ',
    r.audit.some((a) => a.includes('ยังไม่ครบ')) && !r.audit.some((a) => a.includes('sync ข้อมูลค้าง')),
    r.audit.join(' | '));
}

console.log('\n③ แถวขึ้นครบแต่รูปส่งไม่ผ่าน — ยังไม่ถือว่าเสร็จ');
/* รูปถ่ายจากปากคนไข้ ถ่ายซ้ำไม่ได้ ล้างรายการทิ้งไม่ได้ถ้ายังไม่ขึ้น */
{
  const r = await press({ queue: 2, unsynced: 2, pendingAfter: 0, photos: { uploaded: 1, failed: 2 } });
  ok('รายการยังอยู่', r.queue === 2, r.queue);
  ok('ยังไม่ประทับ syncedAt', r.stillNull === 2, r.stillNull);
  ok('รายงานจำนวนรูปที่ส่งไม่ผ่าน', r.result.photosFailed === 2, JSON.stringify(r.result));
  ok('audit เขียนตามจริง', r.audit.some((a) => a.includes('ยังไม่ครบ')), r.audit.join(' | '));
}

console.log('\n④ ไม่มีอะไรค้างเลย — ต้องไม่จด audit ปลอม');
{
  const r = await press({ queue: 0, unsynced: 0, pendingAfter: 0, photos: { uploaded: 0, failed: 0 } });
  ok('ยังเรียกตัวส่งข้อมูลจริง (เผื่อมีของค้างที่ไม่ได้อยู่ในรายการ)', r.flushed === 1, r.flushed);
  ok('ไม่จด audit', r.audit.length === 0, r.audit.join(' | '));
  ok('รายงานว่าไม่มีอะไรทำ', r.result.cleared === 0 && r.result.photos === 0);
}

console.log('\n⑤ โหมด local/เดโม — พฤติกรรมเดิมต้องไม่เปลี่ยน');
/* เดโมไม่ได้ติดตั้ง middleware จึงได้ pendingPushCount() = 0 เสมอ
   กดปุ่มแล้วรายการต้องล้างเหมือนเดิม ไม่งั้นเดโมที่โชว์เรื่องออฟไลน์จะพัง */
{
  const r = await press({ queue: 4, unsynced: 4, pendingAfter: 0, photos: { uploaded: 0, failed: 0 } });
  ok('รายการล้างได้เหมือนเดิม', r.queue === 0 && r.result.cleared === 4, JSON.stringify(r.result));
  ok('แถวถูกประทับเวลาครบ', r.stillNull === 0);
}

console.log('\n⑥ มีของค้างที่ไม่ได้อยู่ในรายการ "รอส่ง" ก็ต้องไม่เงียบ');
/* รายการ "รอส่ง" ถูกเติมเฉพาะตอนกดผ่าน step แบบออฟไลน์ (advanceStep)
   แต่การแก้อย่างอื่น (คะแนน · ใบประเมิน · โน้ต) เข้าคิว middleware ตรง ๆ ไม่ผ่านรายการนี้
   ถ้าดูแค่รายการ ปุ่มจะเงียบทั้งที่ยังมีของค้างจริง */
{
  const r = await press({ queue: 0, unsynced: 0, pendingAfter: 7, photos: { uploaded: 0, failed: 0 } });
  ok('รายงานว่ายังค้าง 7 แถว ไม่ใช่ "ไม่มีรายการค้าง"', r.result.stillPending === 7, JSON.stringify(r.result));
  ok('จด audit ว่ายังไม่ครบ', r.audit.some((a) => a.includes('ยังไม่ครบ')), r.audit.join(' | '));
}

console.log('\n⑦ รูปต้องผูกกับ step ที่แนบไว้ step เดียว ไม่ใช่ตามไปทุก step ถัดไป');
/* เดิม advanceStep กวาดรูป "ทุกใบของชิ้นงานนี้" มาผูกกับ update ที่กำลังสร้าง
   รูปของ step 3 จึงถูกผูกซ้ำเข้ากับ step 4, 5, 6 … ต่อไปเรื่อย ๆ
   หนึ่งรูปโผล่ใต้หลาย step และจำนวนรูปต่อ step เฟ้อขึ้นทุกครั้งที่กดผ่านขั้น */
{
  const db = freshDb();
  // ชิ้นงาน CD ที่ยังไม่เริ่ม (procIndex = -1)
  db._tables.workpieces.rows.push({
    id: 'w1', patientId: 'p1', studentId: 's1', type: 'CD', detail: 'CD',
    acceptedDate: '2026-06-15', minimumRequirement: true, payment: 'ชำระแล้ว',
    sect2Removable: true, sect2Fixed: true, procIndex: -1,
    lastUpdatedAt: '2026-09-10T00:00:00.000Z', catalogVersion: 'DTPT502-2569',
  });
  G.__DB__ = db;
  G.__FLUSHED__ = 0;
  G.__PENDING__ = 0;
  G.__PHOTOS__ = { uploaded: 0, failed: 0 };
  G.__ON_FLUSH__ = async () => {};
  const m = await load();

  // step แรก: แนบรูป A แล้วกดผ่าน
  db._tables.photos.rows.push({ id: 'phA', workpieceId: 'w1' });
  await m.advanceStep({ workpieceId: 'w1', performedAt: '2026-09-10', actor: 'นศ.', offline: false, withPhoto: true });
  // step สอง: แนบรูป B แล้วกดผ่าน
  db._tables.photos.rows.push({ id: 'phB', workpieceId: 'w1' });
  await m.advanceStep({ workpieceId: 'w1', performedAt: '2026-09-11', actor: 'นศ.', offline: false, withPhoto: true });
  // step สาม: ไม่แนบรูปใหม่ แต่กดแบบ withPhoto
  await m.advanceStep({ workpieceId: 'w1', performedAt: '2026-09-12', actor: 'นศ.', offline: false, withPhoto: true });

  const ups = db._tables.updates.rows.map((u) => (u.photoIds as string[]) ?? []);
  ok('step แรกได้รูป A', JSON.stringify(ups[0]) === '["phA"]', JSON.stringify(ups[0]));
  ok('step สองได้เฉพาะรูป B ไม่ลากรูป A มาด้วย', JSON.stringify(ups[1]) === '["phB"]', JSON.stringify(ups[1]));
  ok('step สามไม่มีรูปใหม่ → ต้องว่าง ไม่ใช่ได้ทั้ง A และ B', JSON.stringify(ups[2]) === '[]', JSON.stringify(ups[2]));
  const all = ups.flat();
  ok('ไม่มีรูปใบไหนถูกนับซ้ำ', new Set(all).size === all.length, all.join(','));
}

console.log(bad ? `\n❌ ไม่ผ่าน ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
