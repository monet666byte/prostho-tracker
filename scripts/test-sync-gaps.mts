/**
 * "รูในตาข่าย" ที่ `npm run mutate:sync` หาเจอ · รันด้วย `npm run test:sync-gaps`
 *
 * ทำไมต้องมี (13 ก.ย. 69): ใส่บั๊กที่เคยเกิดจริง/เกือบเกิด 41 จุดลง cloudSync.ts ทีละจุด
 * ทุกชุดใน npm test ตอนนั้นจับได้ 24 จุด · อีก 11 จุดเป็นบั๊กที่ทำข้อมูลหายได้จริงแต่ไม่มีเทสต์ไหนร้อง
 * (อีก 6 จุดมีด่านซ้อนกันอยู่ ใส่บั๊กจุดเดียวแล้วด่านถัดไปรับไว้ — ดูหมายเหตุใน mutate-sync.mts)
 *
 * ทุกข้อในไฟล์นี้ต้อง **ตกกับบั๊กตัวที่มันเฝ้า** (รหัส Mxx) — ถ้าวันหน้าแก้ cloudSync.ts แล้ว
 * ข้อไหนผ่านทั้งที่ใส่บั๊กกลับเข้าไป แปลงว่าข้อนั้นไม่ได้เฝ้าอะไรแล้ว
 *
 * ตู้กลางปลอมตัวนี้เล็กกว่าของ test:clinic โดยตั้งใจ แต่มี "ตะขอ" ที่ชุดอื่นไม่มี:
 *   ทำอะไรบางอย่าง *ระหว่าง* ที่คำขอกำลังวิ่ง · ปฏิเสธชั่วคราว N ครั้ง · ยิง realtime เอง · อ่านลิ้นชักพัง
 * เรื่องที่พึ่งพฤติกรรม Postgres/PostgREST จริง (NULL ในก้อน · หน้าละ 1,000 แถว) อยู่ใน test:sync-pg ⑬–⑮
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

interface Srv {
  tables: Map<string, Map<unknown, Record<string, unknown>>>;
  clock: number;
  offline: boolean;
  /** เรียกตอนคำขอเริ่ม ก่อนตอบกลับ = "ระหว่างรอเน็ต" */
  hook: { update?: (t: string, pk: unknown) => Promise<void> | void; delete?: (t: string, ids: unknown[]) => Promise<void> | void };
  /** ตาราง → จำนวนครั้งที่ upsert จะถูกปฏิเสธ (มีรหัส) ก่อนยอมรับ */
  refuseUpsert: Map<string, number>;
  realtime: ((payload: unknown) => void) | null;
  pageSize: number;
}
const SRV: Srv = { tables: new Map(), clock: Date.parse('2026-09-13T02:00:00.000Z'), offline: false, hook: {}, refuseUpsert: new Map(), realtime: null, pageSize: 1000 };
const G = globalThis as never as { __SRV__: Srv; __DBFAIL__: { getMany: boolean } };
G.__SRV__ = SRV;
G.__DBFAIL__ = { getMany: false };
const PKCOL: Record<string, string> = {
  teachers: 'id', students: 'id', groups: 'code', patients: 'id', workpieces: 'id', updates: 'id', photos: 'id',
  checkins: 'id', reviews: 'id', submissions: 'id', issues: 'student_id', audit: 'id', self_assessments: 'id',
  sect2_records: 'id', sect3_records: 'id',
};
const srvTbl = (t: string) => { let m = SRV.tables.get(t); if (!m) SRV.tables.set(t, (m = new Map())); return m; };
const reset = () => { SRV.tables.clear(); SRV.offline = false; SRV.hook = {}; SRV.refuseUpsert.clear(); SRV.realtime = null; G.__DBFAIL__.getMany = false; };

const PRELUDE = (dev: string) => `
const SRV = globalThis.__SRV__;
const PKCOL = ${JSON.stringify(PKCOL)};
export const cloudEnabled = true;
export const flushSettings = async () => {};
export const pullSettings = async () => false;
export const loadCachedPolicy = async () => {};
export const pullPdpaPolicy = async () => {};
const srvTbl = (t) => { let m = SRV.tables.get(t); if (!m) SRV.tables.set(t, (m = new Map())); return m; };
const stamp = () => new Date(SRV.clock++).toISOString();
const NET = { message: 'TypeError: Failed to fetch', code: '' };

const PK = { teachers:'id', students:'id', groups:'code', patients:'id', workpieces:'id', updates:'id', photos:'id',
  checkins:'id', reviews:'id', submissions:'id', issues:'studentId', audit:'id', selfAssessments:'id', sect2:'id', sect3:'id' };
const local = new Map();
const tbl = (n) => { let m = local.get(n); if (!m) local.set(n, m = new Map()); return m; };
export const peek = (n, k) => tbl(n).get(k);
export const seedLocal = (n, rows) => rows.forEach((r) => tbl(n).set(r[PK[n]], structuredClone(r)));
let mw = null;
const downCore = { table: (name) => ({
  async getMany(req) {
    if (globalThis.__DBFAIL__.getMany) throw new Error('IndexedDB อ่านไม่ได้ (จำลอง)');
    return req.keys.map((k) => tbl(name).get(k));
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
const kv = new Map();
export const kvGet = async (k, f) => (kv.has(k) ? structuredClone(kv.get(k)) : f);
export const kvSet = async (k, v) => { kv.set(k, structuredClone(v)); };
globalThis.setInterval = () => 0;
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };

export const supabase = {
  from(t) {
    const pkc = PKCOL[t];
    return {
      async upsert(rows, o = {}) {
        if (SRV.offline) return { error: NET };
        const left = SRV.refuseUpsert.get(t) ?? 0;
        if (left > 0) { SRV.refuseUpsert.set(t, left - 1); return { error: { message: 'ชนชั่วคราว', code: '40001' } }; }
        for (const r of rows) {
          if (o.ignoreDuplicates && srvTbl(t).has(r[pkc])) continue;
          srvTbl(t).set(r[pkc], { ...r, updated_at: stamp() });
        }
        return { error: null };
      },
      update(patch) {
        return { eq(_c, val) {
          const run = async () => {
            if (SRV.offline) return { data: null, error: NET };
            await SRV.hook.update?.(t, val);
            const old = srvTbl(t).get(val);
            if (!old) return { data: [], error: null };
            srvTbl(t).set(val, { ...old, ...patch, updated_at: stamp() });
            return { data: [{ [pkc]: val }], error: null };
          };
          return { select: run, then: (a, b) => run().then(a, b) };
        } };
      },
      delete() {
        return { async in(_c, ids) {
          if (SRV.offline) return { error: NET };
          await SRV.hook.delete?.(t, ids);
          ids.forEach((i) => srvTbl(t).delete(i));
          return { error: null };
        } };
      },
      select() {
        let since = null;
        const rows = () => [...srvTbl(t).values()].filter((r) => since === null || String(r.updated_at) >= since);
        const self = {
          gte(_c, v) { since = String(v); return self; },
          order() { return self; },
          async limit(n) {
            if (SRV.offline) return { data: null, error: NET };
            return { data: rows().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, n), error: null };
          },
          async range(from, to) {
            if (SRV.offline) return { data: null, error: NET };
            return { data: rows().sort((a, b) => String(a[pkc]).localeCompare(String(b[pkc]))).slice(from, to + 1), error: null };
          },
          then(res, rej) { return Promise.resolve(SRV.offline ? { count: null, error: NET } : { count: rows().length, error: null }).then(res, rej); },
        };
        return self;
      },
    };
  },
  channel() { return { on(_e, _f, fn) { SRV.realtime = fn; return this; }, subscribe() { return this; } }; },
  removeAllChannels() {},
  auth: { getUser: async () => ({ data: { user: { id: 'u-${dev}' } } }) },
};
`;

interface Device {
  db: { table: (n: string) => { put: (o: unknown) => Promise<unknown>; delete: (k: unknown) => Promise<unknown> } };
  peek: (n: string, k: unknown) => Record<string, unknown> | undefined;
  seedLocal: (n: string, rows: unknown[]) => void;
  flushNow: () => Promise<void>;
  pullAll: () => Promise<void>;
  initCloudSync: () => Promise<void>;
  stopCloudSync: () => void;
  persistOutboxNow: () => Promise<void>;
  setSyncPaused: (v: boolean) => void;
  pendingPushCount: () => number;
  syncProblems: () => { table: string; key: unknown; reason: string }[];
}
let nth = 0;
async function device(name: string): Promise<Device> {
  const src = readFileSync(join(root, 'src/data/cloudSync.ts'), 'utf8')
    .replace("import { db, kvGet, kvSet } from './db';", '')
    .replace("import { cloudEnabled, supabase } from '../lib/cloud';", '')
    .replace("import { flushSettings, pullSettings } from './settingsSync';", '')
    .replace("import { loadCachedPolicy, pullPdpaPolicy } from './pdpaSync';", '');
  if (/from '\.\/db'|from '\.\.\/lib\/cloud'/.test(src)) throw new Error('cloudSync.ts เปลี่ยนรูป import — แก้รายการ replace ใน test-sync-gaps.mts');
  const dir = mkdtempSync(join(tmpdir(), `gaps-${nth++}-`));
  writeFileSync(join(dir, 'mod.mts'), PRELUDE(name) + src);
  return (await import(join(dir, 'mod.mts'))) as unknown as Device;
}

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) failures++;
}
const settle = () => new Promise((r) => setTimeout(r, 1700));
const srv = (t: string, k: unknown) => srvTbl(t).get(k);

const W = { id: 'w1', patientId: 'p1', studentId: 's1', type: 'CD', procIndex: 5, lastUpdatedAt: '2026-09-12T02:00:00.000Z', acceptedDate: '2026-06-03', detail: 'CD/-' };
const W_ROW = { id: 'w1', patient_id: 'p1', student_id: 's1', type: 'CD', proc_index: 5, last_updated_at: '2026-09-12T02:00:00.000Z', accepted_date: '2026-06-03', detail: 'CD/-', updated_at: '2026-09-12T02:00:00.000Z' };

/* ① M03 ─ undoStep ลบช่อง completedAt ทิ้งด้วย `delete` ─────────────────── */
console.log('① เลิกทำ step สุดท้ายของเคสที่ปิดแล้ว — ช่อง "ปิดเคสเมื่อ" ต้องหายจากเซิร์ฟเวอร์ด้วย  [M03]');
{
  reset();
  srvTbl('workpieces').set('w1', { ...W_ROW, completed_at: '2026-09-12' });
  const d = await device('d1');
  d.seedLocal('workpieces', [{ ...W, completedAt: '2026-09-12' }]);
  const undone: Record<string, unknown> = { ...W, completedAt: '2026-09-12', procIndex: 4, lastUpdatedAt: '2026-09-13T03:00:00.000Z' };
  delete undone.completedAt; // แบบเดียวกับ repo.ts → undoStep
  await d.db.table('workpieces').put(undone);
  await settle();
  await d.flushNow();
  check('เซิร์ฟเวอร์: completed_at ถูกล้าง (อีกเครื่องไม่เห็นว่าเคสยังปิดอยู่)', srv('workpieces', 'w1')?.completed_at == null, srv('workpieces', 'w1')?.completed_at);
  check('เซิร์ฟเวอร์: step ถอยแล้ว', srv('workpieces', 'w1')?.proc_index === 4);
}

/* ② M10 ─ แก้อีกช่องของแถวเดิมระหว่างที่ PATCH กำลังวิ่ง ────────────────── */
console.log('\n② แก้อีกช่องของเคสเดิม ระหว่างที่เครื่องกำลังส่งช่องแรก  [M10]');
{
  reset();
  srvTbl('workpieces').set('w1', { ...W_ROW });
  const d = await device('d2');
  d.seedLocal('workpieces', [W]);
  let fired = false;
  SRV.hook.update = async (t) => {
    if (fired || t !== 'workpieces') return;
    fired = true;
    await d.db.table('workpieces').put({ ...(d.peek('workpieces', 'w1') as object), detail: 'CD/- (แก้ระหว่างส่ง)' });
  };
  await d.db.table('workpieces').put({ ...W, procIndex: 6 });
  await settle();
  await d.flushNow();
  await d.flushNow();
  check('ช่องที่แก้ระหว่างรอเน็ตยังอยู่ในคิว แล้วขึ้นเซิร์ฟเวอร์รอบถัดไป', srv('workpieces', 'w1')?.detail === 'CD/- (แก้ระหว่างส่ง)', srv('workpieces', 'w1')?.detail);
  check('ช่องแรกก็ขึ้น', srv('workpieces', 'w1')?.proc_index === 6);
}

/* ③ M09 ─ ลบอีกแถวระหว่างที่คำสั่งลบก้อนแรกกำลังวิ่ง ────────────────────── */
console.log('\n③ ลบคาบอีกคาบ ระหว่างที่เครื่องกำลังส่งคำสั่งลบคาบแรก  [M09]');
{
  reset();
  for (const id of ['c1', 'c2']) srvTbl('checkins').set(id, { id, student_id: 's1', date: '2026-09-12', updated_at: '2026-09-12T00:00:00.000Z' });
  const d = await device('d3');
  d.seedLocal('checkins', [{ id: 'c1', studentId: 's1', date: '2026-09-12' }, { id: 'c2', studentId: 's1', date: '2026-09-12' }]);
  let fired = false;
  SRV.hook.delete = async () => { if (!fired) { fired = true; await d.db.table('checkins').delete('c2'); } };
  await d.db.table('checkins').delete('c1');
  await settle();
  await d.flushNow();
  await d.flushNow();
  check('คาบที่ลบระหว่างรอเน็ต ถูกลบบนเซิร์ฟเวอร์ด้วย (ไม่ฟื้นกลับมาในเครื่องอื่น)', !srv('checkins', 'c2') && !srv('checkins', 'c1'), [...srvTbl('checkins').keys()]);
}

/* ④ M31 ─ หยุด sync ซ้อนกันสองงาน ───────────────────────────────────────── */
console.log('\n④ หยุด sync ซ้อนกันสองงาน (เช่น seed กับโหลดรุ่นที่จบแล้ว) งานแรกจบก่อน  [M31]');
{
  reset();
  const d = await device('d4');
  d.setSyncPaused(true);
  d.setSyncPaused(true);
  d.setSyncPaused(false); // งานแรกจบ
  await d.db.table('patients').put({ id: 'demo-p', name: 'ของงานที่สอง', hn: 'DEMO-1', ownerStudentId: 's1' });
  check('งานที่สองยังเขียนอยู่ → ของที่เขียนต้องไม่เข้าคิวส่งขึ้นเซิร์ฟเวอร์', d.pendingPushCount() === 0, d.pendingPushCount());
  d.setSyncPaused(false);
  await d.db.table('patients').put({ id: 'real-p', name: 'ผู้ป่วยจริง', hn: 'HN1', ownerStudentId: 's1' });
  check('ทั้งสองงานจบ → กลับมาเข้าคิวตามปกติ', d.pendingPushCount() === 1, d.pendingPushCount());
}

/* ⑤ M32 ─ ถูกปฏิเสธชั่วคราว (ชนกันจังหวะเดียว) ────────────────────────── */
console.log('\n⑤ เซิร์ฟเวอร์ปฏิเสธชั่วคราว 2 ครั้ง แล้วรับ — ต้องไม่ถูกกักตั้งแต่ครั้งแรก  [M32]');
{
  reset();
  const d = await device('d5');
  // ตั้งก่อนเขียน — ตัวตั้งเวลา 1.5 วิของคิวจะส่งเองระหว่าง settle (ครั้งแรกที่เขียนข้อนี้ตั้งทีหลัง แล้วข้อนี้ไม่ได้เฝ้าอะไร)
  SRV.refuseUpsert.set('checkins', 2);
  await d.db.table('checkins').put({ id: 'c9', studentId: 's1', date: '2026-09-13', activities: [], createdAt: '2026-09-13T01:00:00.000Z' });
  await settle();
  await d.flushNow();
  await d.flushNow();
  await d.flushNow();
  check('ไม่มีอะไรถูกกัก', d.syncProblems().length === 0, d.syncProblems());
  check('คาบขึ้นเซิร์ฟเวอร์ในที่สุด', !!srv('checkins', 'c9'));
}

/* ⑥ M29 ─ ออกจากระบบแล้วเข้าใหม่บัญชีเดิม โดยไม่รีโหลดหน้า ──────────────── */
console.log('\n⑥ มีงานค้างส่ง → ออกจากระบบ → เข้าใหม่บัญชีเดิม (ไม่ได้รีโหลดหน้า)  [M29]');
{
  reset();
  srvTbl('students').set('s1', { id: 's1', code: '1', name: 'x', group: 'G', year: 5, updated_at: '2026-09-12T00:00:00.000Z' });
  srvTbl('workpieces').set('w1', { ...W_ROW });
  const d = await device('d6');
  await d.initCloudSync();
  SRV.offline = true;
  await d.db.table('workpieces').put({ ...(d.peek('workpieces', 'w1') as object), procIndex: 9 });
  await d.persistOutboxNow();
  d.stopCloudSync(); // ออกจากระบบ (ล้างไม่ได้เพราะมีงานค้าง — ข้อมูลยังอยู่ในเครื่อง)
  SRV.offline = false;
  await d.initCloudSync();
  await d.flushNow();
  check('step ที่ค้างส่งขึ้นเซิร์ฟเวอร์หลังเข้าระบบใหม่', srv('workpieces', 'w1')?.proc_index === 9, srv('workpieces', 'w1')?.proc_index);
  check('และไม่ถูกฉบับเก่าบนเซิร์ฟเวอร์ทับในเครื่อง', d.peek('workpieces', 'w1')?.procIndex === 9, d.peek('workpieces', 'w1')?.procIndex);
}

/* ⑦ M36 ─ realtime ส่งฉบับเก่าเข้ามาระหว่างที่ของเรายังรอส่ง ───────────── */
console.log('\n⑦ realtime ส่งฉบับบนเซิร์ฟเวอร์เข้ามา ระหว่างที่ step ที่เพิ่งกดยังรอส่ง 1.5 วิ  [M36]');
{
  reset();
  srvTbl('students').set('s1', { id: 's1', code: '1', name: 'x', group: 'G', year: 5, updated_at: '2026-09-12T00:00:00.000Z' });
  srvTbl('workpieces').set('w1', { ...W_ROW });
  const d = await device('d7');
  await d.initCloudSync();
  await d.db.table('workpieces').put({ ...(d.peek('workpieces', 'w1') as object), procIndex: 6 });
  SRV.realtime?.({ table: 'workpieces', eventType: 'UPDATE', new: { ...W_ROW, detail: 'อีกเครื่องแก้', updated_at: '2026-09-13T03:00:00.000Z' }, old: {} });
  await new Promise((r) => setTimeout(r, 50));
  check('มี realtime ให้ทดสอบจริง (ตัวคุม)', SRV.realtime !== null);
  check('step ที่เพิ่งกดยังอยู่ในเครื่อง ไม่ถูกฉบับจากเซิร์ฟเวอร์ทับ', d.peek('workpieces', 'w1')?.procIndex === 6, d.peek('workpieces', 'w1')?.procIndex);
  await settle();
  await d.flushNow();
  check('และขึ้นเซิร์ฟเวอร์', srv('workpieces', 'w1')?.proc_index === 6);
}

/* ⑧ M06 ─ อ่านฉบับเดิมในลิ้นชักไม่ได้ ──────────────────────────────────── */
console.log('\n⑧ ลิ้นชักในเครื่องอ่านฉบับเดิมไม่ได้ตอนเขียน — ต้องถือว่าแก้ทั้งแถว ไม่ใช่ "ไม่ได้แก้อะไร"  [M06]');
{
  reset();
  srvTbl('workpieces').set('w1', { ...W_ROW });
  const d = await device('d8');
  d.seedLocal('workpieces', [W]);
  G.__DBFAIL__.getMany = true;
  await d.db.table('workpieces').put({ ...W, procIndex: 7 });
  G.__DBFAIL__.getMany = false;
  check('แถวเข้าคิว', d.pendingPushCount() === 1, d.pendingPushCount());
  await settle();
  await d.flushNow();
  check('ขึ้นเซิร์ฟเวอร์', srv('workpieces', 'w1')?.proc_index === 7);
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
