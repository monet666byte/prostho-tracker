/**
 * เทสต์ชุดที่ 20 — "sync หลายเครื่องพร้อมกัน บน Postgres ตัวจริง" · รันด้วย `npm run test:sync-pg`
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

interface Stage { db: PGlite; netDown: Set<string>; uid: Record<string, string>; errors: Map<string, string[]>; upserted: Map<string, number> }
const G = globalThis as never as { __STAGE__: Stage; __CLIENT__: (dev: string, who: string) => unknown };

G.__CLIENT__ = (dev: string, who: string) =>
  pgSupabase(G.__STAGE__.db, { uid: G.__STAGE__.uid[who] }, {
    pkOf: REMOTE_PK,
    networkDown: () => G.__STAGE__.netDown.has(dev),
    onUpsert: (_t, n) => G.__STAGE__.upserted.set(dev, (G.__STAGE__.upserted.get(dev) ?? 0) + n),
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
  syncProblems: () => { table: string; key: unknown; reason: string }[];
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
  return { db, netDown: new Set(), uid, errors: new Map(), upserted: new Map() };
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

/* ══ ⑧ เน็ตหลุดนานเกินโควตา แล้วกลับมา ══════════════════════════════════════ */
console.log('\n⑧ เน็ตหลุดนานเกินโควตา แล้วกลับมา');
{
  const S = await stage(); G.__STAGE__ = S;
  const phone = await device('phone-st9', 'st9');
  await phone.db.table('patients').put(patientOf('st9'));
  await phone.db.table('workpieces').put(workpieceOf('st9', { procIndex: 0 }));
  await settle(); await phone.flushNow();

  S.netDown.add('phone-st9');
  await phone.db.table('workpieces').put({ ...phone.peek('workpieces', 'w-st9')!, procIndex: 5 });
  await phone.db.table('checkins').put(checkinOf('st9'));
  await settle();
  for (let i = 0; i < 6; i++) await phone.flushNow();
  check('เน็ตหลุดไม่ถูกกักเป็นปัญหา', phone.syncProblems().length === 0, phone.syncProblems());

  S.netDown.delete('phone-st9');
  await phone.pullAll();
  await phone.flushNow();
  const [w] = await server(S.db, `select proc_index from workpieces where id = 'w-st9'`);
  check('step ที่กดตอนเน็ตหลุดขึ้นเซิร์ฟเวอร์', w.proc_index === 5, w.proc_index);
  check('คาบที่เช็คอินตอนเน็ตหลุดขึ้นเซิร์ฟเวอร์',
    (await server(S.db, `select 1 from checkins where id = 'ci-st9'`)).length === 1);
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
  (t1 as unknown as { seedLocal: (n: string, r: unknown[]) => void }).seedLocal('checkins', [checkinOf('st2', { id: 'ci-only-local' })]);
  S.upserted.set('ipad-t1', 0);
  await t1.pushAll();
  check('แถวที่มีแค่ในเครื่อง ยังถูกส่งขึ้นไป — และส่งแค่แถวนั้น',
    (await server(S.db, `select 1 from checkins where id = 'ci-only-local'`)).length === 1 && S.upserted.get('ipad-t1') === 1,
    { ส่งขึ้นไป: S.upserted.get('ipad-t1') });
  await S.db.close();
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
