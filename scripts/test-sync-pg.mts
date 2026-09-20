/**
 * "sync หลายเครื่องพร้อมกัน บน Postgres ตัวจริง" · รันด้วย `npm run test:sync-pg`
 *
 * ทำไมต้องมี (13 ก.ย. 69): test:clinic / test:conflict / test:offline ทดสอบ cloudSync.ts ตัวจริง
 * กับ "ตู้กลางปลอม" ที่เขียนเลียนแบบ trigger ด้วยมือ · ตู้ปลอมรับทุกช่อง ยอมทุกคน ไม่มี NOT NULL
 * ไม่มี RLS — ของที่ตู้ปลอมไม่รู้จักคือของที่เทสต์เดิมไม่เคยทดสอบเลย
 *
 * ชุดนี้ใช้ cloudSync.ts ตัวจริงเหมือนเดิม แต่ตู้กลางคือ Postgres จริง (PGlite) ที่รัน migration ทุกไฟล์
 * ผ่าน `scripts/pg-postgrest.mts` ซึ่งลอกพฤติกรรมของ supabase-js มาจากโค้ดจริงของไลบรารี
 * แต่ละ "เครื่อง" ล็อกอินเป็นคนจริงในรายชื่อเชิญ แล้วถูกกฎ RLS / trigger ของจริงคุม
 *
 * ชุดเดิมยังเก็บไว้ (เร็วกว่ามาก และจำลองจังหวะเน็ต/ปิดแท็บได้ละเอียดกว่า)
 * ถ้าสองชุดให้ผลไม่ตรงกัน = ตู้ปลอมเพี้ยนจากของจริง ให้เชื่อชุดนี้
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase } from './pg-supabase.mts';
import { pgSupabase, REMOTE_PK } from './pg-postgrest.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
  if (!ok) failures++;
}
const settle = () => new Promise((r) => setTimeout(r, 2000));

/* ── เวทีกลาง: Postgres + สวิตช์เน็ต ───────────────────────────────────────── */

interface Stage { db: PGlite; netDown: Set<string>; authGone: Set<string>; uid: Record<string, string>; errors: Map<string, string[]>; upserted: Map<string, number>; pulled: Map<string, number> }
const G = globalThis as never as { __STAGE__: Stage; __CLIENT__: (dev: string, who: string) => unknown };

G.__CLIENT__ = (dev: string, who: string) =>
  pgSupabase(G.__STAGE__.db, { uid: G.__STAGE__.uid[who] }, {
    pkOf: REMOTE_PK,
    networkDown: () => G.__STAGE__.netDown.has(dev),
    authExpired: () => G.__STAGE__.authGone.has(dev),
    onUpsert: (_t, n) => G.__STAGE__.upserted.set(dev, (G.__STAGE__.upserted.get(dev) ?? 0) + n),
    onSelect: (t, n) => G.__STAGE__.pulled.set(`${dev}|${t}`, (G.__STAGE__.pulled.get(`${dev}|${t}`) ?? 0) + n),
    onError: (e) => {
      const list = G.__STAGE__.errors.get(dev) ?? [];
      list.push(`${e.code} ${e.message}`.slice(0, 140));
      G.__STAGE__.errors.set(dev, list);
    },
  });

/** ลิ้นชักในเครื่อง (Dexie) ปลอม — ตัวเดียวกับ test:clinic รวม getMany ที่คิวรายช่องใช้ */
const PRELUDE = (dev: string, who: string) => `
const DEV = ${JSON.stringify(dev)};
export const cloudEnabled = true;
export const flushSettings = async () => {};
export const pullSettings = async () => false;
export const loadCachedPolicy = async () => {};
export const pullPdpaPolicy = async () => {};

const PK = { teachers:'id', students:'id', groups:'code', patients:'id', workpieces:'id',
  updates:'id', photos:'id', checkins:'id', reviews:'id', submissions:'id',
  issues:'studentId', audit:'id', selfAssessments:'id', sect2:'id', sect3:'id' };
const local = new Map();
const tbl = (n) => { let m = local.get(n); if (!m) local.set(n, m = new Map()); return m; };
export const peek = (n, k) => tbl(n).get(k);
export const dump = (n) => [...tbl(n).values()];
export const seedLocal = (n, rows) => rows.forEach((r) => tbl(n).set(r[PK[n]], structuredClone(r)));

let mw = null;
const downCore = { table: (name) => ({
  async getMany(req) { const m = tbl(name); return req.keys.map((k) => m.get(k)); },
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
export const kvGet = async (k, f) => (kv.has(k) ? kv.get(k) : f);
export const kvSet = async (k, v) => { kv.set(k, v); };

globalThis.setInterval = () => 0;
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };

/* ตู้กลาง = Postgres จริง ในนามคนที่ล็อกอินบนเครื่องนี้ */
export const supabase = globalThis.__CLIENT__(DEV, ${JSON.stringify(who)});
`;

interface Device {
  db: { table: (n: string) => { put: (o: unknown) => Promise<unknown>; delete: (k: unknown) => Promise<unknown> } };
  pullAll: () => Promise<void>;
  pushAll: () => Promise<void>;
  flushNow: () => Promise<void>;
  peek: (n: string, k: unknown) => Record<string, unknown> | undefined;
  dump: (n: string) => Record<string, unknown>[];
  pendingPushCount: () => number;
  initCloudSync: () => Promise<void>;
  kvSet: (k: string, v: unknown) => Promise<void>;
  seedLocal: (n: string, rows: unknown[]) => void;
  syncProblems: () => { table: string; key: unknown; reason: string }[];
  onOutboxChange: (fn: () => void) => () => void;
  syncStatus: () => { link: 'ok' | 'down' | 'auth'; lastContactAt: number | null; pendingSince: number | null };
}

let nth = 0;
async function device(dev: string, who: string): Promise<Device> {
  const src = readFileSync(join(root, 'src/data/cloudSync.ts'), 'utf8')
    .replace("import { db, kvGet, kvSet } from './db';", '')
    .replace("import { cloudEnabled, supabase } from '../lib/cloud';", '')
    .replace("import { flushSettings, pullSettings } from './settingsSync';", '')
    .replace("import { loadCachedPolicy, pullPdpaPolicy } from './pdpaSync';", '');
  if (/from '\.\/db'|from '\.\.\/lib\/cloud'/.test(src)) {
    throw new Error('cloudSync.ts เปลี่ยนรูป import — แก้รายการ replace ใน test-sync-pg.mts');
  }
  const dir = mkdtempSync(join(tmpdir(), `syncpg-${nth++}-`));
  const f = join(dir, 'mod.mts');
  writeFileSync(f, PRELUDE(dev, who) + src);
  return (await import(f)) as unknown as Device;
}

/* ── ข้อมูลตั้งต้น: กลุ่มจริงขนาด 12 คน + อาจารย์เวร 2 ท่าน ────────────────────── */

const N = 12;
const sids = Array.from({ length: N }, (_, i) => `st${i + 1}`);

async function stage(): Promise<Stage> {
  /* โมดูลของ "เครื่อง" ตั้ง globalThis.window / document ปลอมไว้ (cloudSync ต้องใช้)
     PGlite ดูตัวแปรพวกนี้เพื่อเดาว่ารันในเบราว์เซอร์ แล้วไปอ่าน location.pathname ที่ไม่มี
     → ต้องถอดออกชั่วคราวตอนสร้างฐานข้อมูลใหม่ แล้วค่อยคืน */
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document };
  delete g.window; delete g.document;
  let made: Awaited<ReturnType<typeof freshDatabase>>;
  try {
    made = await freshDatabase(root);
  } finally {
    if (saved.window !== undefined) g.window = saved.window;
    if (saved.document !== undefined) g.document = saved.document;
  }
  const { db, results } = made;
  const broken = results.filter((r) => !r.ok);
  if (broken.length) throw new Error('migration พัง: ' + JSON.stringify(broken));

  await db.exec(`
    insert into teachers (id, name) values ('t1', 'อ. หนึ่ง'), ('t2', 'อ. สอง');
    insert into groups (code, advisor_ids, student_ids) values
      ('TH-PT1', array['t1','t2'], array[${sids.map((s) => `'${s}'`).join(',')}]);
  `);
  for (const [i, s] of sids.entries()) {
    await db.query(
      `insert into students (id, code, name, "group", year, entry_year) values ($1, $2, $3, 'TH-PT1', 5, 2569)`,
      [s, `65040${String(i + 1).padStart(2, '0')}`, `นศ. คนที่ ${i + 1}`]);
    await db.query(`insert into invites (email, role, student_id) values ($1, 'student', $2)`, [`${s}@student.test`, s]);
  }
  await db.exec(`
    insert into invites (email, role, teacher_id) values
      ('t1@teacher.test', 'teacher', 't1'), ('t2@teacher.test', 'teacher', 't2');
  `);
  const uid: Record<string, string> = {};
  for (const who of [...sids, 't1', 't2']) {
    const email = who.startsWith('t') && !who.startsWith('st') ? `${who}@teacher.test` : `${who}@student.test`;
    const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
    uid[who] = r.rows[0].id;
  }
  return { db, netDown: new Set(), authGone: new Set(), uid, errors: new Map(), upserted: new Map(), pulled: new Map() };
}

/** อ่านแถวบนเซิร์ฟเวอร์ตรงๆ (สิทธิ์เจ้าของ ไม่ผ่าน RLS) — ใช้ตรวจผลเท่านั้น */
const server = async (db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, unknown>>(sql, params)).rows;

/* ── แถวแบบที่แอปสร้างจริง (ลอกจาก repo.ts → addCheckIn / addWorkpiece) ────── */

const checkinOf = (sid: string, over: Record<string, unknown> = {}) => ({
  id: `ci-${sid}`, studentId: sid, date: '2026-09-13', punctual: true,
  checkinAt: '2026-09-13T01:55:00.000Z', photoCount: undefined, noPatient: false,
  patientId: undefined, activities: ['Primary impression'], note: undefined,
  status: 'pending', createdAt: '2026-09-13T01:55:00.000Z', ...over,
});

const patientOf = (sid: string) => ({
  id: `p-${sid}`, name: `ผู้ป่วยของ ${sid}`, hn: `HN-${sid}`, sexAge: 'ไม่ระบุ', ownerStudentId: sid,
});

const workpieceOf = (sid: string, over: Record<string, unknown> = {}) => ({
  id: `w-${sid}`, patientId: `p-${sid}`, studentId: sid, type: 'CD', variant: undefined,
  kennedy: undefined, dentureClass: undefined, acceptedDate: '2026-06-03',
  minimumRequirement: true, pendingQualification: false, payment: 'ยังไม่ชำระ',
  sect2Removable: false, sect2Fixed: false, designRpd: undefined, procIndex: -1,
  lastUpdatedAt: '2026-09-13T02:00:00.000Z', catalogVersion: 'test', arch: 'upper',
  detail: 'CD/- (Upper)', ...over,
});

/* ══════════════════════════════════════════════════════════════════════════ */

/* ══ ① คาบเริ่ม — 12 คนเช็คอินพร้อมกัน ═══════════════════════════════════════ */
console.log('① คาบเริ่ม — 12 คนเช็คอินพร้อมกัน (Postgres จริง)');
{
  const S = await stage(); G.__STAGE__ = S;
  const phones = await Promise.all(sids.map((s) => device(`phone-${s}`, s)));
  await Promise.all(phones.map((p, i) => p.db.table('checkins').put(checkinOf(sids[i]))));
  await settle();
  await Promise.all(phones.map((p) => p.flushNow()));

  const rows = await server(S.db, `select student_id from checkins`);
  check('เซิร์ฟเวอร์ได้ครบ 12 คาบ', rows.length === N, rows.length);
  check('ไม่มีเครื่องไหนค้างส่ง', phones.every((p) => p.pendingPushCount() === 0),
    phones.map((p) => p.pendingPushCount()));
  check('ไม่มีเครื่องไหนถูกปฏิเสธ', phones.every((p) => p.syncProblems().length === 0),
    phones.flatMap((p) => p.syncProblems()));

  const t1 = await device('ipad-t1', 't1');
  await t1.pullAll();
  check('อาจารย์เห็นครบ 12 คาบ', t1.dump('checkins').length === N, t1.dump('checkins').length);

  const st1 = await device('ipad-st1', 'st1');
  await st1.pullAll();
  check('นักศึกษาดึงลงมาได้แค่คาบของตัวเอง (RLS จริง)',
    st1.dump('checkins').length === 1 && st1.dump('checkins')[0].studentId === 'st1',
    st1.dump('checkins').map((c) => c.studentId));
  await S.db.close();
}

/* ══ ② อาจารย์ประเมิน ขณะที่นักศึกษาแก้โน้ต ═════════════════════════════════ */
console.log('\n② อาจารย์ประเมิน ขณะที่นักศึกษาแก้โน้ต');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st1', 'st1');
  await phone.db.table('checkins').put(checkinOf('st1'));
  await settle(); await phone.flushNow();

  const teacher = await device('ipad-t1', 't1');
  await teacher.pullAll();
  await phone.pullAll();

  await phone.db.table('checkins').put({ ...phone.peek('checkins', 'ci-st1')!, note: 'ลืมเอา shade guide มา' });
  await settle(); await phone.flushNow();

  await teacher.db.table('checkins').put({
    ...teacher.peek('checkins', 'ci-st1')!, status: 'evaluated',
    scores: { knowledge: 3, skill: 2 }, evaluatedBy: 'อ. หนึ่ง', evaluatedAt: '2026-09-13T05:00:00.000Z',
  });
  await settle(); await teacher.flushNow();

  const [row] = await server(S.db, `select note, status, scores from checkins where id = 'ci-st1'`);
  check('คะแนนของอาจารย์ขึ้นเซิร์ฟเวอร์', row.status === 'evaluated', row);
  check('โน้ตที่นักศึกษาเพิ่งพิมพ์ยังอยู่', row.note === 'ลืมเอา shade guide มา', row.note);
  check('ไม่มีใครถูกปฏิเสธ', phone.syncProblems().length + teacher.syncProblems().length === 0,
    [...phone.syncProblems(), ...teacher.syncProblems()]);
  await S.db.close();
}

/* ══ ③ อาจารย์สองท่านประเมินคาบเดียวกัน ═════════════════════════════════════ */
console.log('\n③ อาจารย์สองท่านประเมินคาบเดียวกัน');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st2', 'st2');
  await phone.db.table('checkins').put(checkinOf('st2'));
  await settle(); await phone.flushNow();

  const a = await device('ipad-t1', 't1');
  const b = await device('ipad-t2', 't2');
  await a.pullAll(); await b.pullAll();
  await a.db.table('checkins').put({
    ...a.peek('checkins', 'ci-st2')!, status: 'evaluated', scores: { knowledge: 3 },
    evaluatedBy: 'อ. หนึ่ง', evaluatedAt: '2026-09-13T05:00:00.000Z',
  });
  await settle(); await a.flushNow();
  await b.pullAll();
  await b.db.table('checkins').put({
    ...b.peek('checkins', 'ci-st2')!, scores: { knowledge: 1 },
    evaluatedBy: 'อ. สอง', evaluatedAt: '2026-09-13T06:00:00.000Z',
  });
  await settle(); await b.flushNow();

  const [row] = await server(S.db, `select evaluated_by, score_history from checkins where id = 'ci-st2'`);
  const hist = (row.score_history ?? []) as Array<{ by?: string }>;
  check('คะแนนล่าสุดเป็นของ อ. สอง', row.evaluated_by === 'อ. สอง', row.evaluated_by);
  check('คะแนนของ อ. หนึ่ง ถูกเก็บใน score_history (trigger จริง)', hist.some((h) => h.by === 'อ. หนึ่ง'), hist);
  await S.db.close();
}

/* ══ ④ คนเดียวกัน สองเครื่อง แก้คนละช่อง ════════════════════════════════════ */
console.log('\n④ คนเดียวกัน สองเครื่อง แก้คนละช่องของเคสเดียวกัน');
{
  const S = await stage(); G.__STAGE__ = S;
  const ipad = await device('ipad-st3', 'st3');
  await ipad.db.table('patients').put(patientOf('st3'));
  await ipad.db.table('workpieces').put(workpieceOf('st3', { procIndex: 3 }));
  await settle(); await ipad.flushNow();
  check('เปิดเคสใหม่ขึ้นเซิร์ฟเวอร์ได้ (NOT NULL / ชนิดข้อมูลจริง)',
    (await server(S.db, `select 1 from workpieces where id = 'w-st3'`)).length === 1,
    ipad.syncProblems());

  const phone = await device('phone-st3', 'st3');
  await phone.pullAll();
  await ipad.db.table('workpieces').put({ ...ipad.peek('workpieces', 'w-st3')!, procIndex: 4 });
  await settle(); await ipad.flushNow();
  await phone.db.table('workpieces').put({ ...phone.peek('workpieces', 'w-st3')!, returnNote: 'นัดต่อ 20 ก.ย.' });
  await settle(); await phone.flushNow();

  const [row] = await server(S.db, `select proc_index, return_note from workpieces where id = 'w-st3'`);
  check('step ที่กดบนไอแพดไม่ถูกมือถือย้อน', row.proc_index === 4, row.proc_index);
  check('ช่องที่มือถือแก้ก็ขึ้น', row.return_note === 'นัดต่อ 20 ก.ย.', row.return_note);
  await S.db.close();
}

/* ══ ⑤ 12 คน × 2 เครื่องพร้อมกัน ════════════════════════════════════════════ */
console.log('\n⑤ 12 คน × 2 เครื่อง = 24 เครื่องพร้อมกัน');
{
  const S = await stage(); G.__STAGE__ = S;
  const pairs = await Promise.all(sids.map(async (s) => ({
    s, ipad: await device(`ipad-${s}`, s), phone: await device(`phone-${s}`, s),
  })));
  await Promise.all(pairs.map(async (p) => {
    await p.ipad.db.table('patients').put(patientOf(p.s));
    await p.ipad.db.table('workpieces').put(workpieceOf(p.s, { procIndex: 1 }));
  }));
  await settle();
  await Promise.all(pairs.map((p) => p.ipad.flushNow()));
  await Promise.all(pairs.map((p) => p.phone.pullAll()));

  await Promise.all(pairs.flatMap((p) => [
    p.ipad.db.table('workpieces').put({ ...p.ipad.peek('workpieces', `w-${p.s}`)!, procIndex: 4 }),
    p.phone.db.table('workpieces').put({ ...p.phone.peek('workpieces', `w-${p.s}`)!, returnNote: `โน้ตของ ${p.s}` }),
  ]));
  await settle();
  await Promise.all(pairs.flatMap((p) => [p.ipad.flushNow(), p.phone.flushNow()]));

  const rows = await server(S.db, `select id, student_id, proc_index, return_note from workpieces order by id`);
  check('ครบ 12 เคส', rows.length === N, rows.length);
  check('ทุกเคสได้ step ใหม่', rows.every((r) => r.proc_index === 4), rows.map((r) => r.proc_index));
  check('ทุกเคสได้โน้ตของเจ้าของ ไม่ปนข้ามคน',
    rows.every((r) => r.return_note === `โน้ตของ ${r.student_id}`),
    rows.filter((r) => r.return_note !== `โน้ตของ ${r.student_id}`).slice(0, 3));
  check('ไม่มีเครื่องไหนถูกปฏิเสธ',
    pairs.every((p) => p.ipad.syncProblems().length + p.phone.syncProblems().length === 0),
    pairs.flatMap((p) => [...p.ipad.syncProblems(), ...p.phone.syncProblems()]).slice(0, 3));
  await S.db.close();
}

/* ══ ⑥ แถวถูกลบบนเซิร์ฟเวอร์ระหว่างที่ยังค้างส่ง ═══════════════════════════ */
console.log('\n⑥ แถวถูกลบบนเซิร์ฟเวอร์ระหว่างที่ยังค้างส่ง');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st6', 'st6');
  await phone.db.table('patients').put(patientOf('st6'));
  await phone.db.table('workpieces').put(workpieceOf('st6', { procIndex: 1 }));
  await settle(); await phone.flushNow();

  await phone.db.table('workpieces').put({ ...phone.peek('workpieces', 'w-st6')!, procIndex: 6 });
  await S.db.query(`delete from workpieces where id = 'w-st6'`);
  await settle(); await phone.flushNow();

  const back = await server(S.db, `select proc_index from workpieces where id = 'w-st6'`);
  check('แถวกลับขึ้นเซิร์ฟเวอร์ ไม่หายเงียบ (PATCH ไม่โดน → สร้างใหม่ ผ่าน RLS จริง)',
    back.length === 1 && back[0].proc_index === 6, { back, problems: phone.syncProblems() });
  check('คิวว่าง', phone.pendingPushCount() === 0, phone.pendingPushCount());
  await S.db.close();
}

/* ══ ⑦ เซิร์ฟเวอร์ปฏิเสธจริง — ต้องขึ้นให้เห็น ไม่วนเงียบ ไม่ลากแถวอื่นตก ═══ */
console.log('\n⑦ เซิร์ฟเวอร์ปฏิเสธจริง (trigger / RLS)');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st7', 'st7');
  await phone.db.table('checkins').put(checkinOf('st7'));
  await phone.db.table('checkins').put(checkinOf('st7', { id: 'ci-st7-b', date: '2026-09-12' }));
  await settle(); await phone.flushNow();

  // ย้ายวันคาบ — trigger checkin_scoring_guard raise (P0001) ทุกครั้ง
  await phone.db.table('checkins').put({ ...phone.peek('checkins', 'ci-st7')!, date: '2026-01-01' });
  // แถวข้างๆ ที่ถูกต้อง
  await phone.db.table('checkins').put({ ...phone.peek('checkins', 'ci-st7-b')!, note: 'แถวที่ถูกต้อง' });
  await settle();
  for (let i = 0; i < 5; i++) await phone.flushNow();

  const [good] = await server(S.db, `select note from checkins where id = 'ci-st7-b'`);
  check('แถวที่ถูกต้องข้างๆ ขึ้นได้', good.note === 'แถวที่ถูกต้อง', good.note);
  check('แถวที่ถูกปฏิเสธขึ้นรายการปัญหาให้ผู้ใช้เห็น',
    phone.syncProblems().some((p) => p.key === 'ci-st7'), phone.syncProblems());
  check('ไม่วนส่งตลอดกาล', phone.pendingPushCount() === 0, phone.pendingPushCount());

  // RLS: นักศึกษาปลอมคาบของคนอื่น
  await phone.db.table('checkins').put(checkinOf('st8', { id: 'ci-forged' }));
  await settle();
  for (let i = 0; i < 5; i++) await phone.flushNow();
  check('คาบปลอมของคนอื่นไม่ขึ้นเซิร์ฟเวอร์ (RLS จริง)',
    (await server(S.db, `select 1 from checkins where id = 'ci-forged'`)).length === 0);
  check('คาบปลอมถูกกักให้เห็น ไม่วนส่ง', phone.syncProblems().some((p) => p.key === 'ci-forged')
    && phone.pendingPushCount() === 0, { problems: phone.syncProblems(), pending: phone.pendingPushCount() });
  await S.db.close();
}

/* ══ ⑦ข เซิร์ฟเวอร์ปฏิเสธ "การลบ" — ต้องบอกผู้ใช้ เอาแถวกลับมา และเลิกวน ═══════
 *
 * นักศึกษาลบคาบที่อาจารย์ประเมินแล้ว → trigger checkin_delete_guard (0027) raise ทุกครั้ง
 * ทางลบเดิมเขียนแค่ `if (!error) clearSent(...)` — ไม่นับรอบ ไม่กัก ไม่บอกใคร
 * ผล: วนลบทุก 15 วิ ตลอดกาล · ป้ายค้างส่งไม่เคยเป็น 0 · ออกจากระบบแบบล้างเครื่องไม่ได้
 * และหน้าจอของนักศึกษาแสดงว่าคาบหายไปแล้ว ทั้งที่บนเซิร์ฟเวอร์ (และหน้าอาจารย์) ยังอยู่ */
console.log('\n⑦ข เซิร์ฟเวอร์ปฏิเสธการลบ (checkin_delete_guard)');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st6', 'st6');
  const teacher = await device('ipad-t1-del', 't1');
  await phone.db.table('checkins').put(checkinOf('st6'));
  await phone.db.table('checkins').put(checkinOf('st6', { id: 'ci-st6-b', date: '2026-09-12' }));
  await settle(); await phone.flushNow();

  await teacher.pullAll();
  await teacher.db.table('checkins').put({
    ...teacher.peek('checkins', 'ci-st6')!, status: 'evaluated',
    scores: { knowledge: 3 }, evaluatedBy: 'อ. หนึ่ง', evaluatedAt: '2026-09-13T05:00:00.000Z',
  });
  await settle(); await teacher.flushNow();
  await phone.pullAll();

  // ลบสองคาบพร้อมกัน: คาบที่ประเมินแล้ว (ต้องถูกปฏิเสธ) กับคาบที่ยังไม่ประเมิน (ต้องลบได้)
  await phone.db.table('checkins').delete('ci-st6');
  await phone.db.table('checkins').delete('ci-st6-b');
  await settle();
  for (let i = 0; i < 5; i++) await phone.flushNow();

  check('คาบที่ประเมินแล้วยังอยู่บนเซิร์ฟเวอร์',
    (await server(S.db, `select 1 from checkins where id = 'ci-st6'`)).length === 1);
  check('คาบที่ยังไม่ประเมินถูกลบจริง ไม่ติดร่างแหไปด้วย',
    (await server(S.db, `select 1 from checkins where id = 'ci-st6-b'`)).length === 0);
  check('ไม่วนลบตลอดกาล', phone.pendingPushCount() === 0, phone.pendingPushCount());
  const prob = phone.syncProblems().find((p) => p.key === 'ci-st6') as { kind?: string } | undefined;
  check('ขึ้นรายการปัญหาให้ผู้ใช้เห็น และบอกว่าเป็นการลบ', prob?.kind === 'delete', phone.syncProblems());
  check('คาบกลับมาอยู่ในเครื่อง พร้อมคะแนนของอาจารย์',
    phone.peek('checkins', 'ci-st6')?.status === 'evaluated', phone.peek('checkins', 'ci-st6'));
  check('คาบที่ลบสำเร็จไม่ฟื้น', phone.peek('checkins', 'ci-st6-b') === undefined);

  // แถวที่เอากลับมาต้องไม่ถูกแช่แข็ง — อาจารย์แก้คะแนนทีหลัง เครื่องนักศึกษาต้องได้ของใหม่
  await teacher.db.table('checkins').put({ ...teacher.peek('checkins', 'ci-st6')!, scores: { knowledge: 4 } });
  await settle(); await teacher.flushNow();
  await phone.pullAll();
  check('แถวที่เอากลับมายังรับของใหม่จากเซิร์ฟเวอร์ได้',
    (phone.peek('checkins', 'ci-st6')?.scores as { knowledge?: number } | undefined)?.knowledge === 4,
    phone.peek('checkins', 'ci-st6'));
  await S.db.close();
}

/* ══ ⑦ง แอปรุ่นเก่าลบเคสที่อาจารย์ประเมินแล้ว (0030) ═══════════════════════════
 * แอปรุ่นใหม่ปฏิเสธตั้งแต่ตอนกดปุ่ม · ข้อนี้จำลองแอปรุ่นเก่า/การลบตรงในลิ้นชัก: ลบเคส + ประวัติ + ผู้ป่วย พร้อมกัน
 * เซิร์ฟเวอร์ต้องปฏิเสธทั้งชุด และเครื่องต้องได้ทั้งชุดกลับมา — ห้ามจบที่ "เคสกลับมาแต่ประวัติหาย" */
console.log('\n⑦ง แอปรุ่นเก่าลบเคสที่อาจารย์ประเมินแล้ว (0030)');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st4', 'st4');
  await phone.db.table('patients').put(patientOf('st4'));
  await phone.db.table('workpieces').put(workpieceOf('st4', { procIndex: 2 }));
  await phone.db.table('updates').put({
    id: 'u-st4-1', workpieceId: 'w-st4', procIndex: 2, progression: 2, performedAt: '2026-09-10',
    selfPerformed: true, photoIds: [], reversal: false, createdBy: 'นศ. คนที่ 4', createdAt: '2026-09-10T02:00:00.000Z',
  });
  await settle(); await phone.flushNow();
  await S.db.query(`insert into sect3_records (id, student_id, form_key, academic_year, class_year, workpiece_id, by_who, at_when)
    values ('s3-st4', 'st4', 'cd', 2569, 5, 'w-st4', 'อ. หนึ่ง', '2026-09-12')`);

  await phone.db.table('workpieces').delete('w-st4');
  await phone.db.table('updates').delete('u-st4-1');
  await phone.db.table('patients').delete('p-st4');
  await settle();
  for (let i = 0; i < 5; i++) await phone.flushNow();

  const left = await server(S.db, `select (select count(*)::int from workpieces where id = 'w-st4') as w,
    (select count(*)::int from updates where id = 'u-st4-1') as u, (select count(*)::int from patients where id = 'p-st4') as p`);
  check('เซิร์ฟเวอร์ยังมีครบทั้งเคส ประวัติ และผู้ป่วย', left[0].w === 1 && left[0].u === 1 && left[0].p === 1, left[0]);
  check('เครื่องได้ทั้งชุดกลับมา ไม่ใช่กลับมาครึ่งเดียว',
    !!phone.peek('workpieces', 'w-st4') && !!phone.peek('updates', 'u-st4-1') && !!phone.peek('patients', 'p-st4'),
    { w: !!phone.peek('workpieces', 'w-st4'), u: !!phone.peek('updates', 'u-st4-1'), p: !!phone.peek('patients', 'p-st4') });
  const kinds = phone.syncProblems().map((x) => (x as { kind?: string }).kind);
  check('บอกผู้ใช้ว่าลบไม่ได้ (3 รายการ แบบ "ลบไม่ผ่าน")', kinds.length === 3 && kinds.every((k) => k === 'delete'), phone.syncProblems());
  check('ไม่วนลบตลอดกาล', phone.pendingPushCount() === 0, phone.pendingPushCount());
  await S.db.close();
}

/* ══ ⑦ค คนเดียวสองเครื่อง ออฟไลน์ทั้งคู่ เช็คอินวันเดียวกัน (0029) ═══════════════
 *
 * กติกา "วันละหนึ่งเช็คอิน" ของแอปมองเห็นแค่ลิ้นชักของเครื่องตัวเอง — สองเครื่องจึงได้ id คนละตัว
 * ก่อน 0029 ทั้งสองแถวขึ้นเซิร์ฟเวอร์ อาจารย์เห็นชื่อคนเดียวสองแถวในหน้าประเมินรายคาบ */
console.log('\n⑦ค คนเดียวสองเครื่อง เช็คอินวันเดียวกันตอนออฟไลน์ (0029)');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st5', 'st5');
  const ipad = await device('ipad-st5', 'st5');
  S.netDown.add('phone-st5'); S.netDown.add('ipad-st5');
  await phone.db.table('checkins').put(checkinOf('st5', { id: 'ci-st5-phone' }));
  await ipad.db.table('checkins').put(checkinOf('st5', { id: 'ci-st5-ipad', note: 'จดจากไอแพด' }));
  await settle();
  S.netDown.clear();
  await phone.flushNow();
  for (let i = 0; i < 5; i++) await ipad.flushNow();

  const rows = await server(S.db, `select id from checkins where student_id = 'st5' and date = '2026-09-13'`);
  check('เซิร์ฟเวอร์มีคาบของวันนั้นแถวเดียว', rows.length === 1 && rows[0].id === 'ci-st5-phone', rows);
  check('เครื่องที่ขึ้นทีหลัง: งานยังอยู่ในเครื่องครบ ไม่หายเงียบ',
    ipad.peek('checkins', 'ci-st5-ipad')?.note === 'จดจากไอแพด', ipad.peek('checkins', 'ci-st5-ipad'));
  const dupe = ipad.syncProblems().find((p) => p.key === 'ci-st5-ipad');
  check('ขึ้นรายการปัญหาพร้อมชื่อกฎ ให้หน้าจอแปลเป็นคำอธิบายได้',
    !!dupe && dupe.reason.includes('checkins_student_date_uidx'), ipad.syncProblems());
  check('ไม่วนส่งตลอดกาล', ipad.pendingPushCount() === 0, ipad.pendingPushCount());

  // นักศึกษาลบคาบที่ซ้ำทิ้ง → การ์ดเตือนต้องหาย และคาบจริงบนเซิร์ฟเวอร์ต้องไม่โดนลูกหลง
  await ipad.db.table('checkins').delete('ci-st5-ipad');
  await settle(); await ipad.flushNow();
  check('ลบคาบที่ซ้ำแล้ว รายการปัญหาหาย', ipad.syncProblems().length === 0, ipad.syncProblems());
  check('คาบจริงบนเซิร์ฟเวอร์ยังอยู่',
    (await server(S.db, `select 1 from checkins where id = 'ci-st5-phone'`)).length === 1);
  check('ไม่มีของค้างส่ง', ipad.pendingPushCount() === 0, ipad.pendingPushCount());
  await S.db.close();
}

/* ══ ⑧ เน็ตหลุดนานเกินโควตา แล้วกลับมา ══════════════════════════════════════ */
console.log('\n⑧ เน็ตหลุดนานเกินโควตา แล้วกลับมา');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st9', 'st9');
  await phone.db.table('patients').put(patientOf('st9'));
  await phone.db.table('workpieces').put(workpieceOf('st9', { procIndex: 0 }));
  await settle(); await phone.flushNow();

  S.netDown.add('phone-st9');
  // หน้าตั้งค่าของนักศึกษาฟังตัวนี้ — เลข "รอส่ง" ต้องขยับตามคิวจริง ไม่ใช่ขึ้น 0 ตอนเน็ตหลุด
  const seen: number[] = [];
  const stopWatching = phone.onOutboxChange(() => seen.push(phone.pendingPushCount()));
  await phone.db.table('workpieces').put({ ...phone.peek('workpieces', 'w-st9')!, procIndex: 5 });
  const firstPendingAt = phone.syncStatus().pendingSince;
  await new Promise((r) => setTimeout(r, 30));
  await phone.db.table('checkins').put(checkinOf('st9'));
  await settle();
  for (let i = 0; i < 6; i++) await phone.flushNow();
  // แถบ "ค้างเกิน 1 วัน" พึ่งค่านี้ — ถ้าเริ่มนับใหม่ทุกครั้งที่กดบันทึก คนที่ทำงานต่อเนื่องจะไม่มีวันถูกเตือน
  check('อายุของค้างส่งนับจากงานชิ้นแรก ไม่เริ่มใหม่เมื่อมีงานเพิ่ม',
    firstPendingAt !== null && phone.syncStatus().pendingSince === firstPendingAt,
    { first: firstPendingAt, now: phone.syncStatus().pendingSince });
  check('เน็ตหลุดไม่ถูกกักเป็นปัญหา', phone.syncProblems().length === 0, phone.syncProblems());
  check('เน็ตหลุด: สถานะเป็น "ต่อเซิร์ฟเวอร์ไม่ได้" และเริ่มนับอายุของค้าง',
    phone.syncStatus().link === 'down' && typeof phone.syncStatus().pendingSince === 'number', phone.syncStatus());
  check('เน็ตหลุด: หน้าจอได้รับแจ้งว่ามีของค้างส่ง 2 รายการ',
    seen.at(-1) === 2 && phone.pendingPushCount() === 2, { seen, now: phone.pendingPushCount() });

  S.netDown.delete('phone-st9');
  await phone.pullAll();
  await phone.flushNow();
  check('เน็ตกลับมา: หน้าจอได้รับแจ้งว่าเหลือ 0', seen.at(-1) === 0, seen);
  check('เน็ตกลับมา: สถานะกลับเป็นปกติ ไม่มีของค้าง และจำเวลาที่ถึงเซิร์ฟเวอร์',
    phone.syncStatus().link === 'ok' && phone.syncStatus().pendingSince === null && phone.syncStatus().lastContactAt !== null,
    phone.syncStatus());
  stopWatching();
  const [w] = await server(S.db, `select proc_index from workpieces where id = 'w-st9'`);
  check('step ที่กดตอนเน็ตหลุดขึ้นเซิร์ฟเวอร์', w.proc_index === 5, w.proc_index);
  check('คาบที่เช็คอินตอนเน็ตหลุดขึ้นเซิร์ฟเวอร์',
    (await server(S.db, `select 1 from checkins where id = 'ci-st9'`)).length === 1);
  await S.db.close();
}

/* ══ ⑧ข หมดเวลาเข้าสู่ระบบกลางคาบ ═══════════════════════════════════════════
 * เดิม PGRST301 ถูกนับเป็น "เซิร์ฟเวอร์ปฏิเสธแถวนี้" → ครบ 3 รอบงานถูกกักพร้อมข้อความ "JWT expired"
 * ทั้งที่แถวไม่ได้ผิดอะไร แค่ต้องล็อกอินใหม่ · ต้องคาไว้ในคิว และบอกหน้าจอให้ชวนเข้าสู่ระบบ */
console.log('\n⑧ข หมดเวลาเข้าสู่ระบบกลางคาบ');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st10', 'st10');
  await phone.db.table('checkins').put(checkinOf('st10'));
  await settle(); await phone.flushNow();

  S.authGone.add('phone-st10');
  await phone.db.table('checkins').put({ ...phone.peek('checkins', 'ci-st10')!, note: 'พิมพ์ตอน session หมดอายุ' });
  await settle();
  for (let i = 0; i < 6; i++) await phone.flushNow();
  check('งานไม่ถูกกักเป็น "ส่งไม่ได้"', phone.syncProblems().length === 0, phone.syncProblems());
  check('งานยังรออยู่ในคิว', phone.pendingPushCount() === 1, phone.pendingPushCount());
  check('สถานะบอกว่าต้องเข้าสู่ระบบใหม่', phone.syncStatus().link === 'auth', phone.syncStatus());
  await phone.pullAll();
  check('ทางดึงที่ล้มเพราะเหตุเดียวกัน ไม่ทำให้สถานะกลายเป็น "เน็ตหลุด"', phone.syncStatus().link === 'auth', phone.syncStatus());

  S.authGone.delete('phone-st10'); // ล็อกอินใหม่แล้ว
  await phone.flushNow();
  const [row] = await server(S.db, `select note from checkins where id = 'ci-st10'`);
  check('ล็อกอินใหม่แล้วงานที่ค้างขึ้นเซิร์ฟเวอร์เอง', row.note === 'พิมพ์ตอน session หมดอายุ', row);
  check('สถานะกลับเป็นปกติ', phone.syncStatus().link === 'ok' && phone.pendingPushCount() === 0, phone.syncStatus());
  await S.db.close();
}

/* ══ ⑨ pushAll ตอนเปิดแอป — แถวที่ช่องไม่เท่ากันในก้อนเดียว ═════════════════
   supabase-js รวมชื่อช่องของทุกแถว แล้วแถวที่ไม่มีช่องนั้นได้ NULL (ไม่ใช่ค่า default)
   ตู้ปลอมเดิมไม่รู้จักพฤติกรรมนี้เลย · ข้อนี้ถามว่า "ของที่อยู่บนเซิร์ฟเวอร์อยู่แล้ว
   ถูกเขียนทับเป็น NULL ไหม" และ "มีก้อนไหนถูกปฏิเสธเพราะ NOT NULL ไหม" */
console.log('\n⑨ pushAll ตอนเปิดแอป — แถวในก้อนเดียวกันมีช่องไม่เท่ากัน');
{
  const S = await stage(); G.__STAGE__ = S;
  const a = await device('ipad-st10', 'st10');
  await a.db.table('patients').put(patientOf('st10'));
  // เคสแรก: คืนเคสแล้ว มี returned/returnNote · เคสที่สอง: เปิดใหม่ ไม่มีสองช่องนั้นเลย
  await a.db.table('workpieces').put(workpieceOf('st10', { id: 'w-old', returned: true, returnNote: 'คนไข้ย้าย' }));
  await settle(); await a.flushNow();
  await a.db.table('workpieces').put(workpieceOf('st10', { id: 'w-new' }));
  await settle(); await a.flushNow();

  // เครื่องใหม่ของคนเดียวกัน: มีสำเนาเก่าของ w-old ที่ "ไม่มี" ช่อง returned (ก่อนคืนเคส)
  const b = await device('phone-st10', 'st10');
  const stale = workpieceOf('st10', { id: 'w-old' });
  const fresh = { ...workpieceOf('st10', { id: 'w-new' }), returned: false };
  (b as unknown as { seedLocal: (n: string, r: unknown[]) => void }).seedLocal('workpieces', [stale, fresh]);
  await b.pushAll();

  const [old] = await server(S.db, `select returned, return_note from workpieces where id = 'w-old'`);
  const pushErr = b.syncProblems();
  console.log(`   (หลัง pushAll: w-old returned=${old.returned} · return_note=${old.return_note})`);
  check('pushAll ไม่เขียนทับ "คืนเคส" ที่อยู่บนเซิร์ฟเวอร์เป็นค่าว่าง',
    old.returned === true && old.return_note === 'คนไข้ย้าย', { old, pushErr });
  await S.db.close();
}

/* ══ ⑩ อีกเครื่องแก้ข้อมูล ระหว่างที่เครื่องนี้กำลังเปิดแอป ══════════════════
   ลำดับตอนเปิดแอป: flush → pullAll → **pushAll** (ดันทุกแถวในเครื่องขึ้นไป)
   pullAll กับ pushAll ห่างกันเป็นวินาทีบนเน็ตคลินิก (15 ตาราง ตารางละหลายร้อยแถว)
   ถ้าอาจารย์บันทึกคะแนน / นักศึกษาเครื่องอื่นกด step ในช่วงนั้น แล้ว pushAll เขียนทับทั้งแถว
   = ของที่เพิ่งทำหายไปโดยไม่มีใครรู้ · คอมเมนต์ในโค้ดบอกว่าตั้งใจ "ดันของที่ตู้ยังไม่มี" เท่านั้น */
console.log('\n⑩ อีกเครื่องแก้ข้อมูล ระหว่างที่เครื่องนี้กำลังเปิดแอป');
{
  const S = await stage(); G.__STAGE__ = S;
  const ipad = await device('ipad-st11', 'st11');
  await ipad.db.table('patients').put(patientOf('st11'));
  await ipad.db.table('workpieces').put(workpieceOf('st11', { procIndex: 2 }));
  await ipad.db.table('checkins').put(checkinOf('st11'));
  await settle(); await ipad.flushNow();

  const phone = await device('phone-st11', 'st11');
  await phone.pullAll();                          // เปิดแอปบนมือถือ: ดึงลงมาแล้ว…

  // …ระหว่างนั้นไอแพดกด step ต่อ และอาจารย์บันทึกคะแนนคาบ
  await ipad.db.table('workpieces').put({ ...ipad.peek('workpieces', 'w-st11')!, procIndex: 5 });
  await settle(); await ipad.flushNow();
  const t1 = await device('ipad-t1', 't1');
  await t1.pullAll();
  await t1.db.table('checkins').put({
    ...t1.peek('checkins', 'ci-st11')!, status: 'evaluated', scores: { knowledge: 3 },
    evaluatedBy: 'อ. หนึ่ง', evaluatedAt: '2026-09-13T05:00:00.000Z',
  });
  await settle(); await t1.flushNow();

  await phone.pushAll();                          // …แล้วมือถือดันทุกแถวในเครื่องขึ้นไป

  const [w] = await server(S.db, `select proc_index from workpieces where id = 'w-st11'`);
  check('step ที่ไอแพดเพิ่งกด ไม่ถูก pushAll ของมือถือย้อน', w.proc_index === 5, w.proc_index);
  const [c] = await server(S.db, `select status, scores from checkins where id = 'ci-st11'`);
  check('คะแนนที่อาจารย์เพิ่งบันทึกยังอยู่', c.status === 'evaluated', c);

  // แถวที่เซิร์ฟเวอร์ยังไม่มีจริงๆ ต้องยังถูกดันขึ้น — นี่คือหน้าที่ของ pushAll
  const lost = workpieceOf('st11', { id: 'w-lost', procIndex: 0 });
  (phone as unknown as { seedLocal: (n: string, r: unknown[]) => void }).seedLocal('workpieces', [lost]);
  await phone.pushAll();
  check('แถวที่เซิร์ฟเวอร์ยังไม่มี ยังถูก pushAll ดันขึ้นไป (หน้าที่เดิมของมัน)',
    (await server(S.db, `select 1 from workpieces where id = 'w-lost'`)).length === 1,
    S.errors.get('phone-st11'));
  await S.db.close();
}

/* ══ ⑪ เปิดแอปบนเครื่องอาจารย์ — ต้องไม่ส่งทุกแถวขึ้นไปใหม่ ═══════════════════
   วัดจากสำเนาจริง 29 ส.ค.: pushAll เดิมส่งทุกแถวในเครื่อง ≈ 1 MB ต่อการเปิดแอปหนึ่งครั้ง
   ทั้งที่แทบทุกแถวเพิ่งดึงลงมา · และแถวที่คนอื่นเพิ่งลบระหว่างดึงกับส่ง ถูกฟื้นกลับขึ้นไป */
console.log('\n⑪ เปิดแอปบนเครื่องอาจารย์ — ส่งเฉพาะแถวที่เซิร์ฟเวอร์ยังไม่มี');
{
  const S = await stage(); G.__STAGE__ = S;
  const phones = await Promise.all(sids.slice(0, 6).map((s) => device(`phone-${s}`, s)));
  await Promise.all(phones.map(async (p, i) => {
    await p.db.table('patients').put(patientOf(sids[i]));
    await p.db.table('workpieces').put(workpieceOf(sids[i]));
    await p.db.table('checkins').put(checkinOf(sids[i]));
  }));
  await settle();
  await Promise.all(phones.map((p) => p.flushNow()));

  const t1 = await device('ipad-t1', 't1');
  await t1.pullAll();
  const localRows = ['students', 'patients', 'workpieces', 'checkins'].reduce((n, t) => n + t1.dump(t).length, 0);
  S.upserted.set('ipad-t1', 0);
  await t1.pushAll();
  check('ไม่มีอะไรใหม่ในเครื่อง → pushAll ไม่ส่งแถวไหนเลย',
    (S.upserted.get('ipad-t1') ?? 0) === 0, { ส่งขึ้นไป: S.upserted.get('ipad-t1'), แถวในเครื่อง: localRows });

  // คนอื่นลบเคสหนึ่งบนเซิร์ฟเวอร์ระหว่างที่เครื่องนี้ดึงเสร็จแล้วแต่ยังไม่ส่ง
  await t1.pullAll();
  await S.db.query(`delete from workpieces where id = 'w-st1'`);
  await t1.pushAll();
  check('แถวที่คนอื่นเพิ่งลบบนเซิร์ฟเวอร์ ไม่ถูกเครื่องนี้ฟื้นกลับ',
    (await server(S.db, `select 1 from workpieces where id = 'w-st1'`)).length === 0);

  // แถวที่เครื่องมีแต่เซิร์ฟเวอร์ไม่เคยเห็น ยังต้องถูกส่ง (หน้าที่เดิมของ pushAll)
  (t1 as unknown as { seedLocal: (n: string, r: unknown[]) => void }).seedLocal('checkins', [checkinOf('st2', { id: 'ci-only-local', date: '2026-09-11' })]); // คนละวันกับคาบที่ st2 มีอยู่แล้ว (0029: วันละแถว)
  S.upserted.set('ipad-t1', 0);
  await t1.pushAll();
  check('แถวที่มีแค่ในเครื่อง ยังถูกส่งขึ้นไป — และส่งแค่แถวนั้น',
    (await server(S.db, `select 1 from checkins where id = 'ci-only-local'`)).length === 1 && S.upserted.get('ipad-t1') === 1,
    { ส่งขึ้นไป: S.upserted.get('ipad-t1') });
  await S.db.close();
}

/* ══ ⑫ รอบ 15 วิ ต้องดึงเฉพาะแถวที่ขยับ ไม่ใช่ทั้งตาราง ═══════════════════════
   วัดด้วย `npm run perf:scale` (ข้อมูลเต็มปี 200 คน): เดิมมีคนเช็คอินแถวเดียว เครื่องอาจารย์ดึงคาบ
   16,000 แถวลงมาใหม่ทุกรอบ ≈ 700 MB/ชม. ต่อเครื่อง · ข้อนี้ต้องตกกับโค้ดก่อนแก้ */
console.log('\n⑫ รอบ 15 วิ — ดึงเฉพาะแถวที่ขยับ');
{
  const S = await stage(); G.__STAGE__ = S;
  const phones = await Promise.all(sids.map((s) => device(`phone-${s}`, s)));
  await Promise.all(phones.map((p, i) => p.db.table('checkins').put(checkinOf(sids[i]))));
  await settle();
  await Promise.all(phones.map((p) => p.flushNow()));
  /* ทำให้คาบเดิมเป็น "ของเมื่อชั่วโมงก่อน" — ไม่งั้นทุกแถวอยู่ในช่วงเผื่อ 2 นาทีหมด แล้ววัดอะไรไม่ได้
     (replica = ข้าม trigger ประทับเวลา เฉพาะตอนจัดฉาก) */
  await S.db.exec(`set session_replication_role = replica;
    update checkins set updated_at = now() - interval '2 hours';
    update checkins set updated_at = now() - interval '1 hour' where id = 'ci-st12';
    update students set updated_at = now() - interval '1 hour';
    update groups set updated_at = now() - interval '1 hour';
    set session_replication_role = origin;`);

  const t1 = await device('ipad-t1', 't1');
  await t1.pullAll();
  check('เปิดแอป: ดึงคาบทั้งตาราง (ยังไม่รู้ว่าตู้มีอะไร)', (S.pulled.get('ipad-t1|checkins') ?? 0) === N, S.pulled.get('ipad-t1|checkins'));

  // นักศึกษาคนหนึ่งแก้โน้ต + อีกคนเช็คอินคาบใหม่
  await phones[0].db.table('checkins').put(checkinOf(sids[0], { note: 'ลืมเครื่องมือ' }));
  await phones[1].db.table('checkins').put(checkinOf(sids[1], { id: 'ci-st2-b', date: '2026-09-14' }));
  await settle();
  await Promise.all(phones.slice(0, 2).map((p) => p.flushNow()));

  S.pulled.clear();
  await t1.pullAll();
  /* 3 = 2 แถวที่ขยับ + แถวล่าสุดเดิม (ci-st12) ที่อยู่ในช่วงเผื่อ 2 นาทีของรอบก่อน — ตั้งใจ */
  check('รอบถัดไป: ดึงลงมาแค่แถวที่ขยับ (3) ไม่ใช่ทั้งตาราง (13)', (S.pulled.get('ipad-t1|checkins') ?? 0) === 3, S.pulled.get('ipad-t1|checkins'));
  check('...และได้ของครบถูกต้อง', t1.peek('checkins', `ci-${sids[0]}`)?.note === 'ลืมเครื่องมือ' && !!t1.peek('checkins', 'ci-st2-b'));

  // แถวที่ commit ช้า: ตราเวลาเก่ากว่าค่าสูงสุดที่เครื่องเห็นไปแล้ว ~1 นาที (now() = เวลาเริ่ม transaction)
  await S.db.exec(`set session_replication_role = replica;
    update checkins set note = 'commit ช้า', updated_at = (select max(updated_at) from checkins) - interval '1 minute' where id = 'ci-st5';
    set session_replication_role = origin;`);
  await phones[2].db.table('checkins').put(checkinOf(sids[2], { note: 'ตัวปลุกให้มีของใหม่' }));
  await settle();
  await phones[2].flushNow();
  await t1.pullAll();
  check('แถวที่ commit ช้ากว่าตราเวลาของตัวเอง ยังได้ (ช่วงเผื่อ 2 นาที)', t1.peek('checkins', 'ci-st5')?.note === 'commit ช้า', t1.peek('checkins', 'ci-st5')?.note);

  // รอบ 15 วิ + เปิดจอกลับมา + ปุ่ม sync ชนกัน ระหว่างที่เครื่องช้ายังดึงไม่เสร็จ
  const t9 = await device('ipad-t9', 't2');
  S.pulled.clear();
  await Promise.all([t9.pullAll(), t9.pullAll(), t9.pullAll(), t9.pullAll()]);
  check('เรียก pullAll ซ้อนกัน 4 ครั้งตอนเปิดแอป → ดึงทั้งตารางรอบเดียว + รอบตามที่ดึงเฉพาะที่ขยับ',
    (S.pulled.get('ipad-t9|checkins') ?? 0) <= N + 1 + 3, S.pulled.get('ipad-t9|checkins'));

  // ไม่มีอะไรขยับ → ไม่ดึงแถวไหนเลย
  S.pulled.clear();
  await t1.pullAll();
  check('ไม่มีอะไรขยับ → ไม่ดึงแถวข้อมูลเลย', [...S.pulled.values()].reduce((a, b) => a + b, 0) === 0, Object.fromEntries(S.pulled));

  // รายชื่อกลุ่มขยับ = สิทธิ์การมองเห็นอาจเปลี่ยน → ตารางที่เหลือในรอบนั้นดึงทั้งตาราง
  await S.db.query(`update groups set advisor_ids = array['t1'] where code = 'TH-PT1'`);
  await phones[3].db.table('checkins').put(checkinOf(sids[3], { note: 'ปลุก' }));
  await settle();
  await phones[3].flushNow();
  S.pulled.clear();
  await t1.pullAll();
  check('กลุ่มขยับ → คาบดึงทั้งตาราง (กันแถวเก่าที่เพิ่งมองเห็นตกหล่น)', (S.pulled.get('ipad-t1|checkins') ?? 0) === N + 1, S.pulled.get('ipad-t1|checkins'));
  await S.db.close();
}

/* ══ ⑬ วันเปิดเทอม — รุ่นใหม่ 30 คนเปิดแอปครั้งแรกพร้อมกัน ══════════════════════
   ภาคสร้างบัญชี + รายชื่อเชิญไว้ล่วงหน้า แล้วคาบแรกทุกคนล็อกอินในห้องเดียวกัน
   ของที่ต้องจริง: ไม่มีใครเห็นของคนอื่น · ไม่มีเครื่องไหนดันของค้างในเครื่อง (ข้อมูลตัวอย่าง /
   ของบัญชีก่อนหน้าบนไอแพดที่ใช้ร่วมกัน) ขึ้นเซิร์ฟเวอร์ · เช็คอินพร้อมกันแล้วครบ */
console.log('\n⑬ วันเปิดเทอม — รุ่นใหม่ 30 คนเปิดแอปครั้งแรกพร้อมกัน');
{
  const S = await stage(); G.__STAGE__ = S;
  const fresh = Array.from({ length: 30 }, (_, i) => `nw${i + 1}`);
  await S.db.query(`insert into groups (code, advisor_ids, student_ids) values ('TH-PT2', array['t2'], $1)`, [fresh]);
  for (const [i, sid] of fresh.entries()) {
    await S.db.query(`insert into students (id, code, name, "group", year, entry_year) values ($1, $2, $3, 'TH-PT2', 5, 2570)`,
      [sid, `67040${String(i + 1).padStart(2, '0')}`, `นศ. รุ่นใหม่ ${i + 1}`]);
    await S.db.query(`insert into invites (email, role, student_id) values ($1, 'student', $2)`, [`${sid}@student.test`, sid]);
    S.uid[sid] = (await S.db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`${sid}@student.test`])).rows[0].id;
  }
  const before = await server(S.db, `select (select count(*)::int from students) s, (select count(*)::int from groups) g, (select count(*)::int from teachers) t, (select count(*)::int from checkins) c`);

  const devs = await Promise.all(fresh.map((sid) => device(`phone-${sid}`, sid)));
  /* 5 เครื่องแรกเคยเปิดลิงก์เดโมไว้ (ข้อมูลตัวอย่างค้างในเครื่อง)
     อีก 5 เครื่องเป็นไอแพดของภาคที่รุ่นพี่เคยล็อกอินไว้ มีคาบที่ยังไม่ได้ส่งค้างอยู่ */
  for (const d of devs.slice(0, 5)) {
    d.seedLocal('students', [{ id: 'st-TH-PT1-3', code: '6504003', name: 'นศ. ค', group: 'TH-PT1', year: 5, advisorIds: ['tc-TH-PT1-1'] }]);
    d.seedLocal('teachers', [{ id: 'tc-TH-PT1-1', name: 'อ. ก.' }]);
    d.seedLocal('patients', [{ id: 'pt-a', name: 'ผู้ป่วย A', hn: 'DEMO-0142', sexAge: 'ญ 68 ปี', ownerStudentId: 'st-TH-PT1-3' }]);
  }
  for (const d of devs.slice(5, 10)) {
    await d.kvSet('cloudBoundUid', `${S.uid.st1}@v2`);
    await d.kvSet('syncOutbox', { v: 2, dirty: [['checkins', [['ci-st1', null]]]], deletes: [] });
    d.seedLocal('checkins', [checkinOf('st1', { note: 'ของรุ่นพี่ที่ค้างในไอแพด' })]);
  }

  const t0 = Date.now();
  await Promise.all(devs.map((d) => d.initCloudSync()));
  const openMs = Date.now() - t0;

  check('ทุกเครื่องเห็นแถวนักศึกษาของตัวเองเท่านั้น (RLS จริง)',
    devs.every((d, i) => d.dump('students').length === 1 && d.dump('students')[0].id === fresh[i]),
    devs.map((d) => d.dump('students').map((x) => x.id).join('+')).filter((x, i) => x !== fresh[i]));
  check('ของตัวอย่างที่ค้างในเครื่อง ถูกล้างตอนผูกบัญชี ไม่ค้างให้เห็น', devs.slice(0, 5).every((d) => !d.peek('patients', 'pt-a')));
  check('คาบของรุ่นพี่ในไอแพดร่วม ถูกล้าง ไม่ถูกส่งในนามรุ่นน้อง',
    devs.slice(5, 10).every((d) => !d.peek('checkins', 'ci-st1') && d.pendingPushCount() === 0)
    && (await server(S.db, `select 1 from checkins where note = 'ของรุ่นพี่ที่ค้างในไอแพด'`)).length === 0);
  const after = await server(S.db, `select (select count(*)::int from students) s, (select count(*)::int from groups) g, (select count(*)::int from teachers) t, (select count(*)::int from checkins) c`);
  check('เปิดแอปพร้อมกัน 30 เครื่อง ไม่มีแถวงอกบนเซิร์ฟเวอร์', JSON.stringify(before) === JSON.stringify(after), { before, after });
  check('ไม่มีเครื่องไหนโดนเซิร์ฟเวอร์ปฏิเสธระหว่างเปิดแอป', [...S.errors.keys()].filter((k) => k.startsWith('phone-nw')).length === 0,
    Object.fromEntries([...S.errors].filter(([k]) => k.startsWith('phone-nw'))));

  // คาบแรก: ทุกคนกดเช็คอินในนาทีเดียวกัน
  await Promise.all(devs.map((d, i) => d.db.table('checkins').put(checkinOf(fresh[i]))));
  await settle();
  await Promise.all(devs.map((d) => d.flushNow()));
  const ci = await server(S.db, `select student_id from checkins where student_id like 'nw%'`);
  check('เช็คอินพร้อมกัน 30 คน → เซิร์ฟเวอร์ได้ครบ 30 ไม่ซ้ำ', ci.length === 30 && new Set(ci.map((r) => r.student_id)).size === 30, ci.length);
  check('ไม่มีเครื่องไหนค้างส่ง/ถูกกัก', devs.every((d) => d.pendingPushCount() === 0 && d.syncProblems().length === 0));

  const t2 = await device('ipad-t2', 't2');
  await t2.initCloudSync();
  check('อาจารย์ประจำกลุ่มใหม่เห็นเช็คอินครบ 30', t2.dump('checkins').filter((c) => String(c.studentId).startsWith('nw')).length === 30);
  console.log(`   (เปิดแอป 30 เครื่องพร้อมกันบน Postgres ในเครื่อง: ${openMs} ms — ตัวเลขประกอบ ไม่ใช่เกณฑ์)`);
  await S.db.close();
}

/* ══ ⑭ เกิน 1,000 แถว — PostgREST ตัดทุกคำขอที่ 1,000 แถว ═══════════════════
   บั๊กจริง 29 ส.ค. 69 (cfc33b6): มีคาบ 1,215 แถว ดึงได้ 1,000 เงียบๆ · `mutate:sync` M24 พบว่าไม่มีเทสต์เฝ้า */
console.log('\n⑭ ตารางเกิน 1,000 แถว — ต้องดึงครบทุกหน้า  [M24]');
{
  const S = await stage(); G.__STAGE__ = S;
  await S.db.query(`insert into checkins (id, student_id, date, activities, created_at)
    select 'bulk-' || g, 'st' || (1 + g % 12), to_char(date '2026-01-01' + (g / 12), 'YYYY-MM-DD'), '{}', '2026-06-01T00:00:00Z'
    from generate_series(1, 1215) g`);
  const t1 = await device('ipad-t1', 't1');
  await t1.pullAll();
  check('อาจารย์ดึงคาบลงมาครบ 1,215 แถว', t1.dump('checkins').length === 1215, t1.dump('checkins').length);
  await S.db.close();
}

/* ══ ⑮ ส่งแถวใหม่หลายแถวในก้อนเดียว ช่องไม่เท่ากัน ════════════════════════════
   supabase-js ใส่ NULL ให้ช่องที่แถวนั้นไม่มี (ถ้าไม่ได้บอก defaultToNull: false) → ช่อง NOT NULL ทำทั้งก้อนตก
   ⑨ เฝ้าเรื่องนี้ใน pushAll แล้ว แต่ flush (ทางที่ใช้ทุกวัน) ไม่มีใครเฝ้า · `mutate:sync` M14 */
console.log('\n⑮ เช็คอินออฟไลน์สองคาบ ช่องไม่เท่ากัน แล้วส่งขึ้นพร้อมกันในก้อนเดียว  [M14]');
{
  const S = await stage(); G.__STAGE__ = S;
  const p = await device('phone-st1', 'st1');
  S.netDown.add('phone-st1');
  await p.db.table('checkins').put(checkinOf('st1', { id: 'ci-a', punctual: false }));
  const noPunctual: Record<string, unknown> = checkinOf('st1', { id: 'ci-b', date: '2026-09-14' });
  delete noPunctual.punctual; // แถวที่สร้างจากฟอร์มรุ่นเก่า/ทางอื่น ไม่มีช่องนี้
  await p.db.table('checkins').put(noPunctual);
  await settle();
  S.netDown.delete('phone-st1');
  await p.flushNow();
  const rows = await server(S.db, `select id, punctual from checkins where id in ('ci-a', 'ci-b') order by id`);
  check('ส่งรอบเดียวขึ้นครบทั้งสองคาบ (ก้อนไม่ตกเพราะ NULL)', rows.length === 2, rows);
  check('คาบที่ไม่มีช่อง punctual ได้ค่า default ของคอลัมน์ ไม่ใช่ NULL', rows.find((r) => r.id === 'ci-b')?.punctual === true, rows);
  await S.db.close();
}

/* ══ ⑯ ค่าว่างจากเซิร์ฟเวอร์ → undefined ในเครื่อง ═══════════════════════════
   หน้าจอเช็คแบบ `x !== undefined` / `'k' in obj` หลายที่ · ถ้าเก็บเป็น null จะขึ้น "null" หรือนับผิด
   และ changedFields จะเห็นว่า null ≠ undefined → ส่งช่องที่ไม่ได้แก้ขึ้นไปทุกครั้งที่แก้แถวนั้น · M35 */
console.log('\n⑯ ช่องที่เซิร์ฟเวอร์เป็น NULL ต้องเป็น undefined ในเครื่อง  [M35]');
{
  const S = await stage(); G.__STAGE__ = S;
  await S.db.query(`insert into checkins (id, student_id, date, activities, created_at, note) values ('ci-null', 'st1', '2026-09-13', '{}', '2026-09-13T00:00:00Z', null)`);
  const p = await device('phone-st1', 'st1');
  await p.pullAll();
  const row = p.peek('checkins', 'ci-null');
  check('note ที่เป็น NULL บนเซิร์ฟเวอร์ = undefined ในเครื่อง', !!row && row.note === undefined, row?.note);
  await p.db.table('checkins').put({ ...row, activities: ['Laboratory work'] });
  await settle();
  S.upserted.set('phone-st1', 0);
  await p.flushNow();
  check('แก้ช่องเดียว → ไม่ส่งแถวทั้งแถวขึ้นไป (ช่องว่างไม่ถูกนับว่าแก้)', (S.upserted.get('phone-st1') ?? 0) === 0, S.upserted.get('phone-st1'));
  await S.db.close();
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
