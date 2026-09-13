/**
 * เทสต์ชุดที่ 16 — "ทำงานตอนไม่มีเน็ต แล้วปิดแท็บ" · รันด้วย `npm run test:offline`
 *
 * ทำไมต้องมี: แอปนี้ขายว่าใช้ในคลินิกที่เน็ตไม่ถึงได้ ถ้าคำสัญญานั้นไม่จริง
 * นักศึกษาจะเสียงานของทั้งคาบโดยไม่มีอะไรบอก — และไม่มีใครรู้ว่าเคยมีงานนั้นอยู่
 *
 * บั๊กที่ไฟล์นี้จับได้ตอนเขียนรอบแรก (11 ก.ย. 69) — พิสูจน์ได้ก่อนแก้:
 *   `dirty` / `pendingDeletes` ใน cloudSync.ts เป็น Map ในหน่วยความจำ หายไปพร้อมแท็บ
 *   และไม่มีตัว flush ตอน pagehide · เปิดแอปรอบหน้า `pullAll()` ทำงานก่อน `pushAll()`
 *   แล้ว bulkPut ทับแถวท้องถิ่นด้วยฉบับบนเซิร์ฟเวอร์ เพราะตัวกัน `skip` อ่านจากคิวที่ว่างแล้ว
 *   → step ที่กดตอนออฟไลน์หายไป **แต่แถว `updates` เป็นแถวใหม่จึงรอด**
 *   ได้สภาพที่แย่กว่าข้อมูลหาย: "ประวัติบอกว่าทำแล้ว แต่เคสบอกว่ายังไม่ทำ"
 *
 * วิธีทำงาน: ก๊อป src/data/cloudSync.ts ตัวจริงไป temp แล้วสับ import เป็นของปลอม
 * ต่างจาก test-conflict.mts ที่หนึ่งโมดูล = หนึ่งเครื่อง — ที่นี่ **หนึ่งโมดูล = หนึ่งครั้งที่เปิดแอป**
 * ลิ้นชัก (IndexedDB) กับ kv อยู่บน globalThis ผูกกับชื่อเครื่อง จึงอยู่รอดข้ามการ "เปิดใหม่"
 * ขณะที่คิวในหน่วยความจำเริ่มใหม่ทุกครั้ง — ตรงกับพฤติกรรมของเบราว์เซอร์จริง
 *
 * ⚠️ ตู้กลางปลอมที่นี่จำลองแค่สิ่งที่เรื่องนี้ต้องใช้ (ประทับ updated_at ฝั่งตู้ + สวิตช์ออฟไลน์)
 *    กติกา trigger เต็มรูปแบบอยู่ใน test-conflict.mts
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ── ตู้แฟ้มกลางปลอม ─────────────────────────────────────────────────────── */
interface Srv {
  tables: Map<string, Map<unknown, Record<string, unknown>>>;
  pkcol: Record<string, string>;
  /** true = เน็ตไม่ถึงตู้กลาง (ทุก request ตอบ error เหมือนตอนอยู่ในคลินิกชั้นใต้ดิน) */
  offline: boolean;
  clock: number;
}
const SRV: Srv = {
  tables: new Map(),
  pkcol: {
    teachers: 'id', students: 'id', groups: 'code', patients: 'id', workpieces: 'id',
    updates: 'id', photos: 'id', checkins: 'id', reviews: 'id', submissions: 'id',
    issues: 'student_id', audit: 'id', self_assessments: 'id',
    sect2_records: 'id', sect3_records: 'id',
  },
  offline: false,
  clock: Date.parse('2026-09-11T03:00:00.000Z'),
};
(globalThis as never as { __SRV__: Srv }).__SRV__ = SRV;
(globalThis as never as { __DISK__: Map<string, unknown> }).__DISK__ = new Map();

const srvTbl = (t: string) => {
  let m = SRV.tables.get(t);
  if (!m) SRV.tables.set(t, (m = new Map()));
  return m;
};
const resetAll = () => {
  SRV.tables.clear();
  SRV.offline = false;
  (globalThis as never as { __DISK__: Map<string, unknown> }).__DISK__.clear();
};

const PRELUDE = (dev: string) => `
const SRV = globalThis.__SRV__;
const DEV = ${JSON.stringify(dev)};
const DISK = globalThis.__DISK__;

export const cloudEnabled = true;
export const flushSettings = async () => {};
export const pullSettings = async () => false;
export const loadCachedPolicy = async () => {};
export const pullPdpaPolicy = async () => {};

const srvTbl = (t) => { let m = SRV.tables.get(t); if (!m) SRV.tables.set(t, (m = new Map())); return m; };
const serverStamp = () => new Date(SRV.clock++).toISOString();

/* ── "ดิสก์" ที่อยู่รอดข้ามการเปิดแอป: ลิ้นชัก Dexie + ตาราง kv ───────────
   ผูกกับชื่อเครื่องบน globalThis — เปิดแอปใหม่ = โมดูลใหม่ แต่ดิสก์ก้อนเดิม */
const PK = { teachers:'id', students:'id', groups:'code', patients:'id', workpieces:'id',
  updates:'id', photos:'id', checkins:'id', reviews:'id', submissions:'id',
  issues:'studentId', audit:'id', selfAssessments:'id', sect2:'id', sect3:'id' };
const diskKey = 'tables|' + DEV;
if (!DISK.has(diskKey)) DISK.set(diskKey, new Map());
const local = DISK.get(diskKey);
const kvKey = 'kv|' + DEV;
if (!DISK.has(kvKey)) DISK.set(kvKey, new Map());
const kvStore = DISK.get(kvKey);

const tbl = (n) => { let m = local.get(n); if (!m) local.set(n, m = new Map()); return m; };
export const peek = (n, k) => tbl(n).get(k);
export const dump = (n) => [...tbl(n).values()];
/** ใส่ข้อมูลลงลิ้นชักโดยไม่ผ่านคิว — จำลอง "สภาพที่ sync ตรงกันแล้ว" */
export const seedLocal = (n, rows) => rows.forEach((r) => tbl(n).set(r[PK[n]], structuredClone(r)));
export const rawKv = (k) => kvStore.get(k);

let mw = null;
const downCore = { table: (name) => ({
  /* DBCore จริงมี getMany — middleware ของ cloudSync ใช้อ่านฉบับเดิมก่อนเขียน
     เพื่อรู้ว่าแก้ช่องไหน (คิวรายช่อง 13 ก.ย. 69) · ถ้าตู้ปลอมไม่มี
     middleware จะ fallback เป็น "ทั้งแถว" แล้วเทสต์จะวัดพฤติกรรมเก่าโดยไม่รู้ตัว */
  async getMany(req) {
    const m = tbl(name);
    return req.keys.map((k) => m.get(k));
  },
  async mutate(req) {
    const m = tbl(name);
    if (req.type === 'add' || req.type === 'put') req.values.forEach((v) => m.set(v[PK[name]], structuredClone(v)));
    else if (req.type === 'delete') req.keys.forEach((k) => m.delete(k));
    return {};
  },
}) };
export const db = {
  use(spec) { mw = spec.create(downCore); },
  table(name) {
    const m = tbl(name);
    const mutate = (req) => (mw ? mw.table(name) : downCore.table(name)).mutate(req);
    return {
      async get(id) { return m.get(id); },
      async bulkGet(ids) { return ids.map((i) => m.get(i)); },
      async bulkPut(objs) { return mutate({ type: 'put', values: objs }); },
      async put(o) { return mutate({ type: 'put', values: [o] }); },
      async add(o) { return mutate({ type: 'add', values: [o] }); },
      async delete(k) { return mutate({ type: 'delete', keys: [k] }); },
      async toArray() { return [...m.values()]; },
      async clear() { m.clear(); },
    };
  },
};
export const kvGet = async (k, f) => (kvStore.has(k) ? structuredClone(kvStore.get(k)) : f);
export const kvSet = async (k, v) => { kvStore.set(k, structuredClone(v)); };

/* ── สภาพแวดล้อมเบราว์เซอร์เท่าที่ cloudSync ต้องใช้ ──────────────────────
   setInterval ทำเป็นของเปล่า: รอบ 15 วิของแอปจริงจะทำให้เทสต์ไม่นิ่ง
   (และค้างไม่ให้ node จบ) — ในเทสต์เราขับ sync เองทุกจังหวะ */
const listeners = { pagehide: [], online: [], visibilitychange: [] };
export const firePagehide = async () => { for (const fn of listeners.pagehide) await fn(); };
globalThis.window = {
  addEventListener: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
  removeEventListener: () => {},
};
globalThis.document = {
  hidden: false,
  addEventListener: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
  removeEventListener: () => {},
};
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;

/* ── supabase ปลอม ─────────────────────────────────────────────────────── */
const netErr = { error: { message: 'ต่อเน็ตไม่ได้' } };
export const supabase = {
  from(t) {
    return {
      /* ignoreDuplicates = ON CONFLICT DO NOTHING (pushAll ใช้ตั้งแต่ 13 ก.ย. 69)
         ตู้ปลอมที่ไม่รู้จักตัวเลือกนี้จะเขียนทับแถวที่มีแล้ว = ทดสอบพฤติกรรมเก่าต่อไปเงียบๆ
         พฤติกรรมเต็มของ supabase-js (NULL ของช่องที่ไม่มี ฯลฯ) ทดสอบใน test:sync-pg บน Postgres จริง */
      upsert(rows, o = {}) {
        if (SRV.offline) return Promise.resolve(netErr);
        const arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach((r) => {
          const pk = SRV.pkcol[t];
          if (o.ignoreDuplicates && srvTbl(t).has(r[pk])) return;
          srvTbl(t).set(r[pk], { ...r, updated_at: serverStamp() });
        });
        return Promise.resolve({ error: null });
      },
      /* PATCH เฉพาะคอลัมน์ — คิวรายช่อง (13 ก.ย. 69) · เคารพสวิตช์ออฟไลน์ด้วย */
      update(patch) {
        return {
          eq(_col, val) {
            const run = () => {
              if (SRV.offline) return Promise.resolve({ data: null, error: netErr.error });
              const m = srvTbl(t);
              const old = m.get(val);
              if (!old) return Promise.resolve({ data: [], error: null });
              m.set(val, { ...old, ...patch, updated_at: serverStamp() });
              return Promise.resolve({ data: [{ [_col]: val }], error: null });
            };
            const self2 = { select: run, then: (r) => run().then(r) };
            return self2;
          },
        };
      },
      delete() {
        return { in(_col, ids) {
          if (SRV.offline) return Promise.resolve(netErr);
          ids.forEach((i) => srvTbl(t).delete(i));
          return Promise.resolve({ error: null });
        } };
      },
      select() {
        /* gte = pullAll รอบที่ดึงเฉพาะแถวที่ขยับ (13 ก.ย. 69) — เทียบแบบสตริงเหมือนตราเวลา ISO */
        let since = null;
        const rows = () => [...srvTbl(t).values()].filter((r) => since === null || String(r.updated_at) >= since);
        const self = {
          gte(_col, v) { since = String(v); return self; },
          order() { return self; },
          limit(n) {
            if (SRV.offline) return Promise.resolve({ data: null, error: netErr.error });
            const r = rows().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
            return Promise.resolve({ data: r.slice(0, n), error: null });
          },
          range(from, to) {
            if (SRV.offline) return Promise.resolve({ data: null, error: netErr.error });
            const pk = SRV.pkcol[t];
            const r = rows().sort((a, b) => String(a[pk]).localeCompare(String(b[pk])));
            return Promise.resolve({ data: r.slice(from, to + 1), error: null });
          },
          // head:true + count — initCloudSync ใช้เช็คว่าตู้กลางว่างหรือยัง
          then(res) {
            if (SRV.offline) return Promise.resolve({ count: null, error: netErr.error }).then(res);
            return Promise.resolve({ count: rows().length, error: null }).then(res);
          },
        };
        return self;
      },
    };
  },
  channel() { return { on() { return this; }, subscribe() { return this; } }; },
  removeAllChannels() {},
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
};
`;

interface AppSession {
  db: { table: (n: string) => { put: (o: unknown) => Promise<unknown>; delete: (k: unknown) => Promise<unknown> } };
  initCloudSync: () => Promise<void>;
  pullAll: () => Promise<void>;
  flushNow: () => Promise<void>;
  pendingPushCount: () => number;
  seedLocal: (n: string, rows: unknown[]) => void;
  peek: (n: string, k: unknown) => Record<string, unknown> | undefined;
  dump: (n: string) => Record<string, unknown>[];
  rawKv: (k: string) => unknown;
  firePagehide: () => Promise<void>;
  stopCloudSync: () => void;
  syncProblems: () => Array<{ table: string; key: unknown; reason: string }>;
}

let nth = 0;
/** "เปิดแอปหนึ่งครั้ง" บนเครื่องชื่อ `dev` — ดิสก์เดิม คิวในหน่วยความจำเริ่มใหม่ */
async function openApp(dev: string): Promise<AppSession> {
  const src = readFileSync(join(root, 'src/data/cloudSync.ts'), 'utf8')
    .replace("import { db, kvGet, kvSet } from './db';", '')
    .replace("import { cloudEnabled, supabase } from '../lib/cloud';", '')
    .replace("import { flushSettings, pullSettings } from './settingsSync';", '')
    .replace("import { loadCachedPolicy, pullPdpaPolicy } from './pdpaSync';", '');
  const dir = mkdtempSync(join(tmpdir(), `offline-${nth++}-`));
  const f = join(dir, 'mod.mts');
  writeFileSync(f, PRELUDE(dev) + src);
  return (await import(f)) as unknown as AppSession;
}

/** จำนวน "คีย์" ที่ค้างในสำเนาคิวบนดิสก์ — นับคีย์ ไม่ใช่จำนวนตาราง */
const outboxKeys = (app: AppSession): number => {
  const snap = app.rawKv('syncOutbox') as
    { dirty?: Array<[string, unknown[]]>; deletes?: Array<[string, unknown[]]> } | undefined;
  const count = (rows: Array<[string, unknown[]]> = []) => rows.reduce((n, [, k]) => n + k.length, 0);
  return count(snap?.dirty) + count(snap?.deletes);
};

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  → ' + extra : ''));
  if (!ok) failures++;
}
/** flush ของ cloudSync หน่วง 1.5 วิ — รอให้ของขึ้นจริงก่อนค่อยตรวจ */
const settle = () => new Promise((r) => setTimeout(r, 2000));

/**
 * "ปิดแท็บ" ให้เหมือนของจริง — ยิง pagehide แล้วปล่อยให้งานที่ค้างอยู่จบ แล้วดับเซสชันนั้น
 *
 * ตัว listener ของ pagehide เป็น `() => { void persistOutboxNow(); void flush(); }`
 * (ในเบราว์เซอร์จริงรอไม่ได้อยู่แล้ว) — ถ้าไม่ปล่อยเวลาให้มันจบก่อน แล้วเปิดเน็ตในฉากถัดไป
 * flush ที่ค้างอยู่ของ "แท็บที่ปิดไปแล้ว" จะสำเร็จขึ้นมาแล้วเขียนคิวทับ = ผลเทสต์เชื่อไม่ได้
 */
async function closeTab(app: AppSession): Promise<void> {
  await app.firePagehide();
  await new Promise((r) => setTimeout(r, 100));
  app.stopCloudSync();
}

const WORK = {
  id: 'w1', patientId: 'p1', studentId: 'st1', type: 'CD', arch: 'upper',
  detail: 'CD/- (Upper)', acceptedDate: '2026-06-03', minimumRequirement: true,
  pendingQualification: false, procIndex: 3, lastUpdatedAt: '2026-09-01T00:00:00.000Z',
};
/** ทำให้ตู้กลาง "ไม่ว่าง" — initCloudSync เช็คจำนวนแถว students เพื่อตัดสินว่านี่คือ
 *  การตั้งต้นระบบครั้งแรกหรือไม่ · ตู้ที่มีแค่ workpieces แต่ students ว่างจะถูกอ่านว่าว่าง
 *  แล้วข้าม flush/pull ไปดัน fixture ขึ้นแทน (ไม่ใช่สภาพที่เกิดจริง — roster มาก่อนทุกอย่าง) */
const seedServerRoster = () => {
  srvTbl('students').set('st1', {
    id: 'st1', code: '6504001', name: 'นศ. ก', group: 'TH-PT1', year: 5,
    entry_year: 2569, advisor_ids: ['t1', 't2'], updated_at: '2026-09-01T00:00:00.000Z',
  });
};

const srvRow = (o: Record<string, unknown>) => {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) r[k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] = v;
  r.updated_at = '2026-09-01T00:00:00.000Z';
  return r;
};

/* ══ ① กด step ตอนออฟไลน์ → ปิดแท็บ → เปิดใหม่ตอนมีเน็ต ═══════════════════ */
console.log('\n① นักศึกษากด step ตอนออฟไลน์ แล้วปิดแท็บก่อนเน็ตกลับมา');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w1', srvRow(WORK));

  // เปิดแอปครั้งที่ 1 — ออนไลน์ ข้อมูลตรงกับตู้กลาง
  const s1 = await openApp('มือถือ นศ.');
  s1.seedLocal('workpieces', [WORK]);
  await s1.initCloudSync();

  // เน็ตหลุด (คลินิกชั้นใต้ดิน) แล้วกด step: procIndex 3 → 4
  SRV.offline = true;
  await s1.db.table('workpieces').put({ ...structuredClone(WORK), procIndex: 4, lastUpdatedAt: '2026-09-11T04:00:00.000Z' });
  // แถวประวัติเป็น "แถวใหม่" — อันนี้รอดอยู่แล้วเพราะตู้กลางไม่มีให้ทับ
  await s1.db.table('updates').put({
    id: 'u-new', workpieceId: 'w1', procIndex: 4, progression: 2,
    performedAt: '2026-09-11', selfPerformed: false, photoIds: [],
    createdBy: 'นศ. ก', createdAt: '2026-09-11T04:00:00.000Z', syncedAt: null,
  });
  await settle();
  check('ออฟไลน์: ส่งขึ้นไม่ได้ → คิวยังค้างอยู่', s1.pendingPushCount() >= 2,
    `ค้าง ${s1.pendingPushCount()} แถว`);
  check('ตู้กลางยังเป็นฉบับเก่า (ยังไม่มีอะไรขึ้นไป)',
    srvTbl('workpieces').get('w1')?.proc_index === 3);

  // ปิดแท็บ — pagehide คือ event สุดท้ายที่เชื่อถือได้บน iOS
  await closeTab(s1);
  check('ปิดแท็บแล้วคิวถูกเขียนลงเครื่อง (ไม่หายไปกับแท็บ)',
    !!s1.rawKv('syncOutbox'), JSON.stringify(s1.rawKv('syncOutbox')));

  // เปิดแอปครั้งที่ 2 — เน็ตกลับมาแล้ว (โมดูลใหม่ = คิวในหน่วยความจำว่าง, ดิสก์เดิม)
  SRV.offline = false;
  const s2 = await openApp('มือถือ นศ.');
  check('เปิดใหม่: ลิ้นชักยังจำ step ที่กดไว้ (ยังไม่ถูกอะไรทับ)',
    s2.peek('workpieces', 'w1')?.procIndex === 4);

  await s2.initCloudSync();
  await settle();

  check('⭐ step ที่กดตอนออฟไลน์ยังอยู่หลังเปิดแอปใหม่',
    s2.peek('workpieces', 'w1')?.procIndex === 4,
    `procIndex = ${s2.peek('workpieces', 'w1')?.procIndex}`);
  check('⭐ และขึ้นถึงตู้กลางแล้วจริง',
    srvTbl('workpieces').get('w1')?.proc_index === 4,
    `บนตู้ = ${srvTbl('workpieces').get('w1')?.proc_index}`);
  check('ประวัติกับตัวเคสเล่าเรื่องเดียวกัน (ไม่ใช่ "ประวัติมี แต่เคสไม่ขยับ")',
    s2.peek('workpieces', 'w1')?.procIndex === 4 && !!s2.peek('updates', 'u-new'));
  check('คิวว่างแล้วหลังส่งสำเร็จ', s2.pendingPushCount() === 0,
    `ค้าง ${s2.pendingPushCount()}`);
  check('สำเนาคิวในเครื่องถูกล้างตาม (เปิดรอบหน้าจะไม่ส่งซ้ำ)',
    outboxKeys(s2) === 0, JSON.stringify(s2.rawKv('syncOutbox')));
  s1.stopCloudSync();
  s2.stopCloudSync();
}

/* ══ ② ออฟไลน์ทั้งคาบ หลายแถว หลายตาราง แล้วปิดแท็บ ═══════════════════════ */
console.log('\n② ออฟไลน์ทั้งคาบ (แก้หลายแถว หลายตาราง) แล้วปิดแท็บ');
{
  resetAll();
  seedServerRoster();
  const W2 = { ...structuredClone(WORK), id: 'w2', procIndex: 5 };
  srvTbl('workpieces').set('w1', srvRow(WORK));
  srvTbl('workpieces').set('w2', srvRow(W2));
  srvTbl('patients').set('p1', { id: 'p1', name: 'ผู้ป่วย A', hn: 'HN-1', sex_age: 'ญ 68 ปี', owner_student_id: 'st1', updated_at: '2026-09-01T00:00:00.000Z' });

  const s1 = await openApp('ไอแพด นศ.');
  s1.seedLocal('workpieces', [WORK, W2]);
  s1.seedLocal('patients', [{ id: 'p1', name: 'ผู้ป่วย A', hn: 'HN-1', sexAge: 'ญ 68 ปี', ownerStudentId: 'st1' }]);
  await s1.initCloudSync();

  SRV.offline = true;
  await s1.db.table('workpieces').put({ ...structuredClone(WORK), procIndex: 6 });
  await s1.db.table('workpieces').put({ ...structuredClone(W2), procIndex: 7 });
  await s1.db.table('patients').put({ id: 'p1', name: 'ผู้ป่วย A', hn: 'HN-1', sexAge: 'ญ 68 ปี', ownerStudentId: 'st1', note: 'รอถอนฟัน' });
  await settle();
  await closeTab(s1);

  SRV.offline = false;
  const s2 = await openApp('ไอแพด นศ.');
  await s2.initCloudSync();
  await settle();

  check('ทั้งสองเคสยังเป็นฉบับที่นักศึกษาทำไว้',
    s2.peek('workpieces', 'w1')?.procIndex === 6 && s2.peek('workpieces', 'w2')?.procIndex === 7,
    `w1=${s2.peek('workpieces', 'w1')?.procIndex} w2=${s2.peek('workpieces', 'w2')?.procIndex}`);
  check('ข้ามตารางก็ไม่หาย (สถานะผู้ป่วยที่พิมพ์ไว้)',
    s2.peek('patients', 'p1')?.note === 'รอถอนฟัน', String(s2.peek('patients', 'p1')?.note));
  check('ขึ้นตู้กลางครบทั้งสามแถว',
    srvTbl('workpieces').get('w1')?.proc_index === 6
    && srvTbl('workpieces').get('w2')?.proc_index === 7
    && srvTbl('patients').get('p1')?.note === 'รอถอนฟัน');
  s1.stopCloudSync();
  s2.stopCloudSync();
}

/* ══ ③ ลบตอนออฟไลน์ แล้วปิดแท็บ — ของที่ลบต้องไม่ฟื้น ═══════════════════ */
console.log('\n③ คืนเคส/ลบตอนออฟไลน์ แล้วปิดแท็บ — ของที่ลบห้ามฟื้นกลับมา');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w1', srvRow(WORK));
  const s1 = await openApp('เครื่อง อจ.');
  s1.seedLocal('workpieces', [WORK]);
  await s1.initCloudSync();

  SRV.offline = true;
  await s1.db.table('workpieces').delete('w1');
  await settle();
  await closeTab(s1);

  SRV.offline = false;
  const s2 = await openApp('เครื่อง อจ.');
  await s2.initCloudSync();
  await settle();

  check('แถวที่ลบไม่ถูก pull ดึงกลับมาในเครื่อง', s2.peek('workpieces', 'w1') === undefined);
  check('และถูกลบบนตู้กลางด้วย', srvTbl('workpieces').get('w1') === undefined);
  s1.stopCloudSync();
  s2.stopCloudSync();
}

/* ══ ④ เปิดแอปแล้วเน็ตยังไม่กลับ — ห้ามทิ้งคิว ═════════════════════════ */
console.log('\n④ เปิดแอปใหม่แต่เน็ตยังไม่กลับมา — คิวต้องยังอยู่ รอรอบหน้า');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w1', srvRow(WORK));
  const s1 = await openApp('มือถือ ออฟไลน์ยาว');
  s1.seedLocal('workpieces', [WORK]);
  await s1.initCloudSync();

  SRV.offline = true;
  await s1.db.table('workpieces').put({ ...structuredClone(WORK), procIndex: 4 });
  await settle();
  await closeTab(s1);

  // เปิดใหม่ทั้งที่ยังไม่มีเน็ต (นักศึกษาเปิดแอปดูเคสระหว่างคาบ)
  const s2 = await openApp('มือถือ ออฟไลน์ยาว');
  await s2.initCloudSync();
  await settle();
  check('ยังออฟไลน์: ลิ้นชักยังเป็นฉบับที่ทำไว้', s2.peek('workpieces', 'w1')?.procIndex === 4);
  check('คิวยังไม่ถูกทิ้ง', s2.pendingPushCount() >= 1, `ค้าง ${s2.pendingPushCount()}`);

  // ปิดอีกรอบ เปิดอีกรอบ แล้วเน็ตกลับมา — ผ่านสองรอบยังต้องไม่หาย
  await closeTab(s2);
  SRV.offline = false;
  const s3 = await openApp('มือถือ ออฟไลน์ยาว');
  await s3.initCloudSync();
  await settle();
  check('⭐ ปิด-เปิดสองรอบแล้วเน็ตกลับ → งานยังอยู่และขึ้นตู้กลางได้',
    s3.peek('workpieces', 'w1')?.procIndex === 4
    && srvTbl('workpieces').get('w1')?.proc_index === 4,
    `local=${s3.peek('workpieces', 'w1')?.procIndex} srv=${srvTbl('workpieces').get('w1')?.proc_index}`);
  s3.stopCloudSync();
}

/* ══ ⑤ ของบนตู้กลางที่ใหม่กว่า ยังต้องไหลลงมาได้ตามปกติ ═══════════════════ */
console.log('\n⑤ ตัวกันของหายต้องไม่กลายเป็นตัวกันไม่ให้ sync');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w1', srvRow(WORK));
  const s1 = await openApp('เครื่องที่ไม่ได้แก้อะไร');
  s1.seedLocal('workpieces', [WORK]);
  await s1.initCloudSync();

  // อาจารย์แก้บนตู้กลาง (เครื่องอื่น) — เครื่องนี้ไม่มีคิวค้าง
  srvTbl('workpieces').set('w1', { ...srvRow({ ...WORK, procIndex: 9 }), updated_at: '2026-09-11T09:00:00.000Z' });
  await s1.pullAll();
  check('ไม่มีคิวค้าง → ของใหม่จากตู้กลางไหลลงมาทับได้ตามปกติ',
    s1.peek('workpieces', 'w1')?.procIndex === 9,
    `procIndex = ${s1.peek('workpieces', 'w1')?.procIndex}`);
  s1.stopCloudSync();
}

/* ══ ⑥ เปลี่ยนบัญชี — คิวของคนก่อนต้องไม่ถูกส่งในชื่อคนใหม่ ═══════════════ */
console.log('\n⑥ เครื่องรวมที่เปลี่ยนคนล็อกอิน — คิวของบัญชีก่อนต้องไม่ตามไป');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w1', srvRow(WORK));
  const s1 = await openApp('เครื่องรวมในคลินิก');
  s1.seedLocal('workpieces', [WORK]);
  await s1.initCloudSync();

  SRV.offline = true;
  await s1.db.table('workpieces').put({ ...structuredClone(WORK), procIndex: 4 });
  await settle();
  await closeTab(s1);
  check('มีคิวค้างของบัญชีแรกอยู่ในเครื่อง', outboxKeys(s1) > 0,
    JSON.stringify(s1.rawKv('syncOutbox')));

  // ล็อกอินด้วยบัญชีอื่น → bindToUser ล้างลิ้นชัก ต้องล้างคิวด้วย
  SRV.offline = false;
  (globalThis as never as { __DISK__: Map<string, unknown> }).__DISK__
    .set('kv|เครื่องรวมในคลินิก', new Map([['syncOutbox', (s1.rawKv('syncOutbox'))]]));
  const s2 = await openApp('เครื่องรวมในคลินิก');
  await s2.initCloudSync();
  await settle();
  check('บัญชีใหม่: คิวของบัญชีก่อนถูกล้าง ไม่ส่งของคนอื่นในชื่อเรา',
    outboxKeys(s2) === 0, JSON.stringify(s2.rawKv('syncOutbox')));
  s1.stopCloudSync();
  s2.stopCloudSync();
}

/* ══ ⑥ข ออกจากระบบแล้วเข้าใหม่ในแท็บเดิม — รอบ 15 วิต้องไม่ซ้อน ══════════════
   เจอ 14 ก.ย. 69: stopCloudSync ไม่ถอดตัวจับเวลา → ออกจากระบบแล้วยังยิงคำขอ
   และล็อกอินใหม่แต่ละครั้งเพิ่มอีกชุด · นับตัวจับเวลาที่ "ยังเดินจริง" จาก setInterval ของระบบ */
console.log('\n⑥ข ออกจากระบบ/เข้าใหม่ในแท็บเดิม — รอบ sync ต้องไม่ซ้อน');
{
  resetAll();
  seedServerRoster();
  /* PRELUDE ของ openApp ปิด setInterval เป็นของเปล่าตอน import — จึงสวมตัวนับ "หลัง" เปิดแอป
     ตัวนับไม่ตั้งเวลาจริง (กันเทสต์ไม่นิ่ง) แค่จำว่าตัวไหนถูกตั้งแล้วยังไม่ถูกเคลียร์ */
  const app = await openApp('iPad กลางคลินิก');
  const live = new Set<number>();
  let nextId = 1_000_000;
  const g = globalThis as unknown as { setInterval: unknown; clearInterval: unknown };
  const [origSet, origClear] = [g.setInterval, g.clearInterval];
  g.setInterval = (_fn: unknown, ms?: number) => { const id = nextId++; if (ms === 15_000) live.add(id); return id; };
  g.clearInterval = (id: number) => { live.delete(id); };
  try {
    await app.initCloudSync();
    check('ล็อกอิน: มีรอบ sync 1 ชุด', live.size === 1, `${live.size} ชุด`);
    app.stopCloudSync();
    check('ออกจากระบบ: รอบ sync หยุดจริง', live.size === 0, `${live.size} ชุด`);
    await app.initCloudSync();
    app.stopCloudSync();
    await app.initCloudSync();
    check('ออก/เข้าซ้ำสองรอบ: ยังมีแค่ 1 ชุด ไม่ซ้อน', live.size === 1, `${live.size} ชุด`);
    app.stopCloudSync();
  } finally {
    g.setInterval = origSet;
    g.clearInterval = origClear;
  }
}

/* ══ ⑦ ตัวสำรองข้อมูลต้องครอบทุกตารางที่แอป sync ═══════════════════════════
   สำเนาที่ขาดโดยไม่มีใครรู้ แย่กว่าไม่มีสำเนา — เพราะวันที่ต้องกู้จริงถึงจะรู้ว่าขาด
   เจอ 11 ก.ย. 69: backup ชุด 29 ส.ค. ขาด self_assessments / sect2 / sect3 / settings / pdpa_policy
   ทั้งหมดเป็นตารางที่เพิ่มหลังเขียน backup.ts แล้วไม่มีอะไรเตือน                        */
console.log('\n⑦ scripts/backup.ts ครอบทุกตารางที่ cloudSync.ts sync อยู่');
{
  const syncSrc = readFileSync(join(root, 'src/data/cloudSync.ts'), 'utf8');
  const backupSrc = readFileSync(join(root, 'scripts/backup.ts'), 'utf8');

  const syncTables = [...syncSrc.matchAll(/remote:\s*'([^']+)'/g)].map((m) => m[1]);
  const backupBlock = backupSrc.slice(
    backupSrc.indexOf('const TABLES'),
    backupSrc.indexOf('const PHOTO_BUCKET'),
  );
  const backupTables = [...backupBlock.matchAll(/\['([^']+)',/g)].map((m) => m[1]);

  check('อ่านรายการตารางจากทั้งสองไฟล์ได้ (ถ้าโครงไฟล์เปลี่ยน ต้องมาแก้เทสต์นี้)',
    syncTables.length >= 15 && backupTables.length >= 15,
    `sync ${syncTables.length} · backup ${backupTables.length}`);

  const missing = syncTables.filter((t) => !backupTables.includes(t));
  check('⭐ ไม่มีตารางไหนที่แอป sync แต่ backup ไม่ได้เก็บ',
    missing.length === 0, missing.length ? `ขาด: ${missing.join(', ')}` : 'ครบ');

  // ตารางที่ backup เก็บเพิ่ม (invites/app_users/settings/pdpa_policy) ไม่ได้ sync ลงเครื่อง
  // ตั้งใจให้เก็บ — แต่ต้องอยู่ในรายการที่รู้จัก ไม่ใช่ชื่อที่พิมพ์ผิด
  const KNOWN_EXTRA = ['invites', 'app_users', 'app_settings', 'pdpa_policy'];
  const unexpected = backupTables.filter((t) => !syncTables.includes(t) && !KNOWN_EXTRA.includes(t));
  check('ไม่มีชื่อตารางแปลกปลอมใน backup (กันพิมพ์ผิดแล้วได้ไฟล์เปล่า)',
    unexpected.length === 0, unexpected.join(', ') || 'ไม่มี');

  check('สำรองไบต์รูปจาก Storage ด้วย ไม่ใช่เก็บแต่ storage_path',
    /storage\/v1\/object/.test(backupSrc) && /PHOTO_BUCKET/.test(backupSrc));

  /* ชื่อตารางที่พิมพ์ผิดจะได้ 404 → สคริปต์เตือนแล้วข้าม = ไฟล์เปล่าโดยไม่มีใครรู้
     เจอจริง 11 ก.ย. 69: เขียน 'settings' ทั้งที่ของจริงชื่อ 'app_settings' (0014)
     จึงเทียบชื่อที่ backup ใช้ กับชื่อที่โค้ดแอปเรียกจริง (.from('…')) */
  const appSrc = ['src/data/settingsSync.ts', 'src/data/pdpaSync.ts', 'src/data/repo.ts',
    'src/lib/auth.ts', 'src/routes/teacher/Roster.tsx']
    .map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
  const calledInApp = new Set([...appSrc.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]));
  const extrasNotFound = KNOWN_EXTRA.filter((t2) => !calledInApp.has(t2));
  check('ชื่อตารางพิเศษใน backup ตรงกับชื่อที่แอปเรียกจริง',
    extrasNotFound.length === 0, extrasNotFound.join(', ') || 'ตรงทุกชื่อ');
}

/* ══ ⑧ ปุ่มสำรองข้อมูลในแอป — ประตูใหม่ที่ข้อมูลผู้ป่วยออกจากระบบ ═══════════
   กติกาของโปรเจกต์: ประตูออกทุกบานต้องมีด่านเท่ากัน (ดู lib/export.ts)
   ① เป็นหัวหน้าภาค ② ภาคเปิดสิทธิ์ส่งออกแบบมีชื่อ ③ จด audit ก่อนสร้างไฟล์
   และต้องบอกตรงๆ ว่าไฟล์นี้ไม่รวมไบต์รูป — สำเนาที่ไม่ครบโดยคนกดไม่รู้ แย่กว่าไม่มีสำเนา   */
console.log('\n⑧ ปุ่มสำรองข้อมูลในแอป — ด่านต้องเท่ากับประตูส่งออกอื่น');
{
  const FB_PRELUDE = (role: string, allowed: boolean, identified: boolean) => `
const ROLE = ${JSON.stringify(role)};
export const currentPdpaRole = () => ROLE;
export const exportPermission = () => ({ allowed: ${allowed}, identified: ${identified} });

globalThis.__AUDIT__ = [];
globalThis.__FILES__ = [];
export const logAudit = async (text, who) => { globalThis.__AUDIT__.push({ text, who }); };

const rows = {
  patients: [{ id: 'p1', name: 'ผู้ป่วย A', hn: 'HN-1' }],
  photos: [{ id: 'ph1', workpieceId: 'w1', storagePath: 'st1/x.jpg' }],
};
export const db = { table: (n) => ({ async toArray() { return rows[n] ?? []; } }) };

/* ต้องจด audit "ก่อน" สร้างไฟล์ — ลำดับนี้คือสิ่งที่เทสต์ตรวจ จึงบันทึกลำดับไว้ */
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.URL = { createObjectURL: (b) => { globalThis.__FILES__.push({ body: b.parts[0], auditAtThatMoment: globalThis.__AUDIT__.length }); return 'blob:x'; }, revokeObjectURL: () => {} };
globalThis.document = { createElement: () => ({ click() {} }) };
`;
  const load = async (role: string, allowed: boolean, identified: boolean) => {
    const src = readFileSync(join(root, 'src/data/fullBackup.ts'), 'utf8')
      .replace("import { db } from './db';", '')
      .replace("import { logAudit } from './repo';", '')
      .replace("import { exportPermission } from '../lib/export';", '')
      .replace("import { currentPdpaRole } from '../store/app';", '');
    const dir = mkdtempSync(join(tmpdir(), `fullbackup-${nth++}-`));
    const f = join(dir, 'mod.mts');
    writeFileSync(f, FB_PRELUDE(role, allowed, identified) + src);
    return (await import(f)) as { downloadFullBackup: (a: string) => Promise<Record<string, unknown>> };
  };
  const g = globalThis as never as { __AUDIT__: unknown[]; __FILES__: Array<{ body: string; auditAtThatMoment: number }> };

  // ① อาจารย์ธรรมดา (ไม่ใช่หัวหน้าภาค) → ไม่มีไฟล์ ไม่มี audit
  {
    const m = await load('teacher', true, true);
    const res = await m.downloadFullBackup('อ. ก');
    check('อาจารย์ที่ไม่ใช่หัวหน้าภาค → ปฏิเสธ', res.ok === false, String(res.reason));
    check('ไม่มีไฟล์ถูกสร้าง', g.__FILES__.length === 0);
    check('ไม่มี audit ถูกจด (ไม่ได้เกิดอะไรขึ้น)', g.__AUDIT__.length === 0);
  }
  // ② หัวหน้าภาค แต่ภาคยังไม่เปิดสิทธิ์แบบมีชื่อ → ปฏิเสธ ไม่ใช่ลดรูปให้
  {
    const m = await load('admin', true, false);
    const res = await m.downloadFullBackup('หัวหน้าภาค');
    check('ยังไม่เปิดสิทธิ์ส่งออกแบบมีชื่อ → ปฏิเสธ (ไม่ปิดบังแล้วปล่อยผ่าน)',
      res.ok === false, String(res.reason));
    check('ไม่มีไฟล์ถูกสร้าง', g.__FILES__.length === 0);
  }
  // ③ ปิดสิทธิ์ส่งออกทั้งหมด → ปฏิเสธ
  {
    const m = await load('admin', false, true);
    const res = await m.downloadFullBackup('หัวหน้าภาค');
    check('ปิดสิทธิ์ส่งออกทั้งหมด → ปฏิเสธ', res.ok === false, String(res.reason));
  }
  // ④ ทางที่ผ่าน — ต้องได้ไฟล์ + audit ที่จดไว้ "ก่อน" สร้างไฟล์ + ไม่มี HN ในข้อความ audit
  {
    const m = await load('admin', true, true);
    const res = await m.downloadFullBackup('หัวหน้าภาค');
    check('หัวหน้าภาค + ภาคเปิดสิทธิ์ → สำรองได้', res.ok === true, String(res.reason ?? ''));
    check('ได้ไฟล์ออกมาหนึ่งไฟล์', g.__FILES__.length === 1, String(g.__FILES__.length));
    check('⭐ จด audit ก่อนสร้างไฟล์ (ไม่ใช่หลัง)',
      g.__FILES__[0]?.auditAtThatMoment === 1, `audit ตอนสร้างไฟล์ = ${g.__FILES__[0]?.auditAtThatMoment}`);
    const auditText = String((g.__AUDIT__[0] as { text?: string } | undefined)?.text ?? '');
    check('ข้อความ audit ไม่มีชื่อ/HN ผู้ป่วย (แถว audit ลบไม่ได้)',
      !auditText.includes('HN-1') && !auditText.includes('ผู้ป่วย A'), auditText);
    const body = g.__FILES__[0]?.body ?? '';
    check('ในไฟล์มีข้อมูลจริง (กู้กลับได้ ไม่ใช่ไฟล์เปล่า)', body.includes('HN-1'));
    check('ไฟล์บอกไว้ในตัวเองว่าไม่รวมไบต์รูป', /photosNotIncluded/.test(body) && /case-photos/.test(body));
    check('บอกจำนวนรูปที่ไม่ได้อยู่ในไฟล์ กลับไปให้หน้าจอโชว์',
      res.photosNotIncluded === 1, String(res.photosNotIncluded));
  }
}

/* ══ ⑨ สำเนาคิวรูปใหม่ (รายช่อง) ต้องทนการปิดแท็บ และรูปเก่าต้องยังอ่านออก ════
   คิวเปลี่ยนรูปเมื่อ 13 ก.ย. 69: เดิมเก็บแค่ pk ตอนนี้เก็บ `[pk, ช่องที่แก้]` (v: 2)
   สองความเสี่ยงที่ต้องปิด:
   ① สำเนารูปใหม่อ่านกลับไม่ได้ = งานที่ทำตอนออฟไลน์หายหมด (บั๊กเดิมที่แก้ไป 11 ก.ย.)
   ② ผู้ใช้ที่อัปเดตแอปกลางคาบมีสำเนา **รูปเก่า** ค้างในเครื่อง — ถ้าอ่านไม่ออก
      ของที่ค้างส่งอยู่ก็หายไปพร้อมกัน · รูปเก่าไม่บอกว่าแก้ช่องไหน จึงต้องถือว่า
      "ทั้งแถว" ซึ่งเป็นพฤติกรรมเดิม (ปลอดภัย แค่เปลืองเน็ต) */
console.log('\nสำเนาคิวรายช่อง — ปิดแท็บแล้วเปิดใหม่');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w1', {
    id: 'w1', patient_id: 'p1', student_id: 'st1', type: 'CD', arch: 'upper',
    detail: 'CD/- (Upper)', accepted_date: '2026-06-03', minimum_requirement: true,
    pending_qualification: false, proc_index: 3, note: 'โน้ตเดิมบนตู้',
    updated_at: '2026-09-01T00:00:00.000Z',
  });

  const a = await openApp('dev-a');
  await a.initCloudSync();
  await settle();

  SRV.offline = true;                                   // เน็ตหายกลางคลินิก
  const w = a.peek('workpieces', 'w1')!;
  await a.db.table('workpieces').put({ ...w, procIndex: 7 });   // กด step ตอนออฟไลน์
  await settle();

  const snap = a.rawKv('syncOutbox') as { v?: number; dirty?: unknown[] } | undefined;
  check('สำเนาคิวเป็นรุ่น 2', snap?.v === 2, JSON.stringify(snap).slice(0, 140));
  check('สำเนาคิวจดว่าแก้ช่อง procIndex',
    JSON.stringify(snap ?? {}).includes('procIndex'), JSON.stringify(snap ?? {}).slice(0, 180));

  await closeTab(a);                                    // ปิดแท็บทั้งที่ยังส่งไม่ได้

  SRV.offline = false;
  const b = await openApp('dev-a');                     // เปิดใหม่ตอนมีเน็ต
  await b.initCloudSync();
  await settle();
  await b.flushNow();
  await settle();

  const onServer = srvTbl('workpieces').get('w1')!;
  check('step ที่กดตอนออฟไลน์ขึ้นตู้กลางแล้ว', onServer.proc_index === 7, String(onServer.proc_index));
  check('ช่องที่เราไม่ได้แตะยังเป็นของตู้กลาง (ไม่ถูกฉบับเก่าในเครื่องทับ)',
    onServer.note === 'โน้ตเดิมบนตู้', String(onServer.note));
  check('คิวว่างแล้ว', outboxKeys(b) === 0, JSON.stringify(b.rawKv('syncOutbox')));
}

/* ── สำเนารูปเก่า (v1) ที่ค้างในเครื่องของผู้ใช้ที่เพิ่งอัปเดตแอป ── */
console.log('\nสำเนาคิวรูปเก่าบนดิสก์ ต้องยังอ่านออก');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w2', {
    id: 'w2', patient_id: 'p2', student_id: 'st1', type: 'RPD', arch: 'lower',
    detail: 'RPD (Lower)', accepted_date: '2026-06-03', minimum_requirement: true,
    pending_qualification: false, proc_index: 0, note: '',
    updated_at: '2026-09-01T00:00:00.000Z',
  });

  // วางสำเนารูปเก่าลงดิสก์ตรงๆ: dirty เป็นรายการ pk เดี่ยวๆ ไม่มี v
  const disk = (globalThis as never as { __DISK__: Map<string, unknown> }).__DISK__;
  const kvKey = 'kv|dev-old';
  /* ⚠️ ต้องใส่ `cloudBoundUid` ด้วย ไม่ใช่แค่คิว — ไม่งั้น `bindToUser` อ่านว่า
     "บัญชีใหม่" แล้วล้างลิ้นชัก+คิวทิ้งตามการออกแบบ แล้วเทสต์จะตกเพราะ fixture
     ไม่ใช่เพราะโค้ดผิด (บทเรียนเดิมจาก 11 ก.ย.: เทสต์ตกแล้วอย่ารีบสรุปว่าโค้ดผิด)
     ค่าคือ `${uid}@${POLICY_VERSION}` — auth ปลอมคืน uid 'u1' และ POLICY_VERSION คือ 'v2' */
  disk.set(kvKey, new Map<string, unknown>([
    ['cloudBoundUid', 'u1@v2'],
    ['syncOutbox', { dirty: [['workpieces', ['w2']]], deletes: [] }],
  ]));
  // และมีแถวฉบับท้องถิ่นที่ยังไม่ได้ส่งอยู่ในลิ้นชักด้วย
  const tablesKey = 'tables|dev-old';
  disk.set(tablesKey, new Map([['workpieces', new Map([['w2', {
    id: 'w2', patientId: 'p2', studentId: 'st1', type: 'RPD', arch: 'lower',
    detail: 'RPD (Lower)', acceptedDate: '2026-06-03', minimumRequirement: true,
    pendingQualification: false, procIndex: 9, note: 'พิมพ์ไว้ตอนออฟไลน์',
  }]])]]));

  const old = await openApp('dev-old');
  await old.initCloudSync();
  await settle();
  await old.flushNow();
  await settle();

  const row = srvTbl('workpieces').get('w2')!;
  check('งานที่ค้างในสำเนารูปเก่าถูกส่งขึ้นจริง', row.proc_index === 9, String(row.proc_index));
  check('ส่งขึ้นแบบทั้งแถว (รูปเก่าไม่รู้ว่าแก้ช่องไหน)',
    row.note === 'พิมพ์ไว้ตอนออฟไลน์', String(row.note));
  check('คิวว่างหลังส่งเสร็จ', outboxKeys(old) === 0, JSON.stringify(old.rawKv('syncOutbox')));
}

/* ══ ⑩ เน็ตหลุดนานกว่า 3 รอบ แล้วกลับมา — งานต้องไม่หาย ════════════════════
   ห้องคลินิกชั้นใต้ดิน ไวไฟหลุดครึ่งนาทีเป็นเรื่องปกติ = ตัว sync ล้มหลายรอบติดกัน
   เจอ 13 ก.ย. 69 จากการอ่านโค้ด แล้วพิสูจน์ด้วยข้อนี้:
   · ตกครบ 3 รอบ → แถวถูก "กัก" และถูกเอาออกจากคิว
   · แต่ตัวกัน skip ของ pullAll อ่านจากคิวเท่านั้น ไม่ได้ดูรายการที่กัก
   · เน็ตกลับมา → pull ทับฉบับในเครื่องด้วยฉบับบนตู้ → **งานที่ผู้ใช้ทำหายไป**
     ทั้งที่หน้าจอบอกว่า "กักไว้ให้ลองส่งใหม่" · กดลองส่งใหม่ก็ส่งฉบับที่ถูกทับแล้ว
   เน็ตหลุดไม่ใช่ "ตู้ปฏิเสธ" — ต้องรอส่งต่อไปเรื่อยๆ นั่นคือคำสัญญาของแอปออฟไลน์ */
console.log('\nเน็ตหลุดนานกว่า 3 รอบ แล้วกลับมา');
{
  resetAll();
  seedServerRoster();
  srvTbl('workpieces').set('w3', {
    id: 'w3', patient_id: 'p3', student_id: 'st1', type: 'CD', arch: 'upper',
    detail: 'CD/- (Upper)', accepted_date: '2026-06-03', minimum_requirement: true,
    pending_qualification: false, proc_index: 2, note: '',
    updated_at: '2026-09-01T00:00:00.000Z',
  });

  const a = await openApp('dev-basement');
  await a.initCloudSync();
  await settle();

  // ทั้งแถวใหม่ (ส่งทั้งแถว) และแถวเดิมที่แก้ช่องเดียว (ส่งแบบรายช่อง) — ครบทั้งสองทาง
  SRV.offline = true;
  await a.db.table('workpieces').put({ ...a.peek('workpieces', 'w3')!, procIndex: 8 });
  await a.db.table('workpieces').put({
    id: 'w4', patientId: 'p4', studentId: 'st1', type: 'RPD', arch: 'lower',
    detail: 'RPD (Lower)', acceptedDate: '2026-09-11', minimumRequirement: true,
    pendingQualification: false, procIndex: 1,
  });
  await settle();
  for (let i = 0; i < 6; i++) await a.flushNow();   // ไวไฟหลุด ~90 วิ = รอบ 15 วิ หกรอบ

  check('เน็ตหลุดไม่ใช่ความผิดของแถว — ไม่ต้องกักไว้เป็นปัญหา',
    a.syncProblems().length === 0, JSON.stringify(a.syncProblems()));
  check('ของยังอยู่ในคิวรอส่ง', a.pendingPushCount() === 2, String(a.pendingPushCount()));

  SRV.offline = false;                               // เน็ตกลับมา
  await a.pullAll();                                 // รอบ 15 วิ ดึงก่อนก็ได้
  await a.flushNow();
  await settle();

  check('step ที่กดตอนเน็ตหลุดยังอยู่ในเครื่อง (ไม่ถูก pull ทับ)',
    a.peek('workpieces', 'w3')?.procIndex === 8, String(a.peek('workpieces', 'w3')?.procIndex));
  check('step นั้นขึ้นตู้กลางแล้ว', srvTbl('workpieces').get('w3')!.proc_index === 8,
    String(srvTbl('workpieces').get('w3')!.proc_index));
  check('เคสใหม่ที่เปิดตอนเน็ตหลุดขึ้นตู้กลาง', srvTbl('workpieces').has('w4'),
    srvTbl('workpieces').has('w4') ? 'มี' : 'หาย');
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
