/**
 * เทสต์ชุดที่ 18 — "คาบคลินิกจริง: 12 เครื่อง + อาจารย์ 2 ท่าน พร้อมกัน"
 * รันด้วย `npm run test:clinic`
 *
 * ทำไมต้องมี (12 ก.ย. 69): `CLAUDE.md` จดไว้ว่า **"ยังไม่เคยนำร่องกับผู้ใช้จริงหลายเครื่อง
 * พร้อมกัน"** · `test:conflict` ทดสอบสองเครื่องชนกันทีละคู่ ซึ่งจับบั๊กได้จริงไปแล้วห้าตัว
 * แต่สภาพจริงของคาบคลินิกคือ **นักศึกษาทั้งกลุ่มเช็คอินในนาทีเดียวกัน** ตอนคาบเริ่ม
 * แล้วอาจารย์เวรสองท่านไล่ประเมินขณะที่นักศึกษายังแก้ของตัวเองอยู่
 *
 * ความเสี่ยงคนละแบบกับ `test:conflict`:
 *   · ของหายเพราะ "คนจำนวนมากเขียนพร้อมกัน" ไม่ใช่ "สองคนเขียนช่องเดียวกัน"
 *   · หน้าอาจารย์เห็นไม่ครบ แล้วอาจารย์สรุปว่าใครไม่มาเรียน
 *   · เครื่องเดียวกันของคนเดียวกัน (มือถือ + ไอแพด) ทับกันเอง
 *
 * วิธีทำงาน: เหมือน `test:conflict` — ก๊อป `src/data/cloudSync.ts` ตัวจริงไป temp
 * แล้วสับ import เป็นของปลอม · **หนึ่งโมดูล = หนึ่งเครื่อง** มีคิว/ลิ้นชัก/นาฬิกาของตัวเอง
 * ต่อตู้กลางปลอมใบเดียวกัน
 *
 * ⚠️ ตู้กลางปลอมจำลองกติกาของ `0017_conflict.sql` + `0020_checkin_field_owner.sql`
 *    (ประทับ `updated_at` ด้วยนาฬิกาตู้ · ผสาน `students.gates` · เก็บ `checkins.score_history` ·
 *     นักศึกษาแตะช่องคะแนนไม่ได้ · อาจารย์แตะโน้ต/กิจกรรมของนักศึกษาไม่ได้)
 *    **แก้ `0017`/`0020` เมื่อไหร่ต้องมาแก้ทั้งไฟล์นี้และ `test-conflict.mts` ด้วย**
 *    ไม่งั้นเทสต์ผ่านทั้งที่ของจริงพัง
 *
 * บั๊กที่ไฟล์นี้จับได้ตอนเขียนรอบแรก (12 ก.ย. 69):
 *   ② อาจารย์กด "บันทึกผล · ลงนาม" แล้วโน้ตที่นักศึกษาเพิ่งพิมพ์หายไป
 *     — แก้แล้วด้วย `0020` (กฎฝั่งเซิร์ฟเวอร์ ทิศกลับของสิ่งที่ `0017` ทำไว้)
 *   ④ นักศึกษาคนเดียวเปิดสองเครื่อง แล้ว step ที่กดบนเครื่องหนึ่งถูกย้อน
 *     — ยังไม่แก้ ต้องทำคิวรายช่อง · ล็อกพฤติกรรมปัจจุบันไว้แล้ว (ดูคอมเมนต์ในข้อ ④)
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ── ตู้แฟ้มกลางปลอม (ใบเดียว ทุกเครื่องต่อเข้ามาที่นี่) ───────────────────── */

interface Srv {
  tables: Map<string, Map<unknown, Record<string, unknown>>>;
  pkcol: Record<string, string>;
  clock: number;
  /** นับจำนวนครั้งที่แต่ละตารางถูกอ่านทีละหน้า — ใช้พิสูจน์ว่า "ข้ามการดึง" จริงไหม */
  pageReads: Map<string, number>;
  /** ให้ทำงานนี้ทุกครั้งที่มีการดึงหน้าแรกของตารางนี้ — จำลอง "มีคนเขียนระหว่างเราดึง" */
  duringPull: Map<string, () => void>;
}
const SRV: Srv = {
  tables: new Map(),
  pkcol: {
    teachers: 'id', students: 'id', groups: 'code', patients: 'id', workpieces: 'id',
    updates: 'id', photos: 'id', checkins: 'id', reviews: 'id', submissions: 'id',
    issues: 'student_id', audit: 'id', self_assessments: 'id',
    sect2_records: 'id', sect3_records: 'id',
  },
  clock: Date.parse('2026-09-12T02:00:00.000Z'),
  pageReads: new Map(),
  duringPull: new Map(),
};
(globalThis as never as { __SRV__: Srv }).__SRV__ = SRV;

const srvTbl = (t: string) => {
  let m = SRV.tables.get(t);
  if (!m) SRV.tables.set(t, (m = new Map()));
  return m;
};
const resetServer = () => {
  SRV.tables.clear();
  SRV.pageReads.clear();
  SRV.duringPull.clear();
};

/* ── ของปลอมที่ยัดแทน import ของ cloudSync.ts ─────────────────────────────── */

const PRELUDE = (dev: string, isTeacher: boolean) => `
const SRV = globalThis.__SRV__;
const DEV = ${JSON.stringify(dev)};
const IS_TEACHER = ${isTeacher};

export const cloudEnabled = true;
export const flushSettings = async () => {};
export const pullSettings = async () => false;
export const loadCachedPolicy = async () => {};
export const pullPdpaPolicy = async () => {};

const srvTbl = (t) => { let m = SRV.tables.get(t); if (!m) SRV.tables.set(t, (m = new Map())); return m; };
/** เวลาของตู้กลาง — เดินทีละ 1 มิลลิวินาทีทุกครั้งที่มีคนเขียน (แทน now() ของ Postgres) */
const serverStamp = () => new Date(SRV.clock++).toISOString();

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
  async mutate(req) {
    const m = tbl(name);
    if (req.type === 'add' || req.type === 'put') req.values.forEach((v) => m.set(v[PK[name]], v));
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

/* setInterval ทำเป็นของเปล่า — รอบ 15 วิของแอปจริงทำให้เทสต์ไม่นิ่ง (เราขับ sync เองทุกจังหวะ) */
globalThis.setInterval = () => 0;
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };

/* ── supabase ปลอม — ที่ที่กติกาของ 0017_conflict.sql ถูกจำลอง ───────────── */
function applyTriggers(table, incoming) {
  const pk = SRV.pkcol[table];
  const old = srvTbl(table).get(incoming[pk]);
  const row = { ...incoming };
  row.updated_at = serverStamp(); // trigger zz_touch_updated_at — ไม่เชื่อนาฬิกาเครื่องไหน

  if (old) {
    if (table === 'students') {
      if (row.gates == null) row.gates = old.gates;
      else {
        const merged = { ...(old.gates ?? {}), ...row.gates };
        for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
        row.gates = merged;
      }
    }
    if (table === 'checkins' && !IS_TEACHER) {
      /* นักศึกษาแตะช่องคะแนนไม่ได้ — คงของเดิมไว้เงียบๆ (ไม่ raise ไม่งั้นทั้งก้อน upsert ตก) */
      row.status = old.status;
      row.scores = old.scores;
      row.evaluated_by = old.evaluated_by;
      row.evaluated_at = old.evaluated_at;
      row.punctual = old.punctual;
      row.checkin_at = old.checkin_at;
      row.score_history = old.score_history;
      return row;
    }
    if (table === 'checkins') {
      /* 0020 · ทิศกลับ — ช่องของนักศึกษา อาจารย์เขียนทับไม่ได้
         (ค่าที่อาจารย์ส่งมาคือฉบับที่เครื่องเผอิญถืออยู่ ไม่ใช่เจตนาจะแก้) */
      row.note = old.note;
      row.activities = old.activities;
      row.patient_id = old.patient_id;
      row.no_patient = old.no_patient;
      row.photo_count = old.photo_count;
      row.created_at = old.created_at;
      row.edited_at = old.edited_at;
      row.student_id = old.student_id;
      row.date = old.date;

      row.score_history = old.score_history ?? [];
      if (old.status === 'evaluated' && old.scores
          && JSON.stringify(row.scores) !== JSON.stringify(old.scores)) {
        row.score_history = [...row.score_history,
          { scores: old.scores, by: old.evaluated_by, at: old.evaluated_at, replacedAt: serverStamp() }];
      }
    }
  } else if (table === 'checkins') {
    row.score_history = row.score_history ?? [];
  }
  return row;
}

export const supabase = {
  from(t) {
    return {
      upsert(rows) {
        const arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach((r) => srvTbl(t).set(r[SRV.pkcol[t]], applyTriggers(t, r)));
        return Promise.resolve({ error: null });
      },
      delete() {
        return { in(_col, ids) { ids.forEach((i) => srvTbl(t).delete(i)); return Promise.resolve({ error: null }); } };
      },
      select() {
        const rows = () => [...srvTbl(t).values()];
        const self = {
          order() { return self; },
          limit(n) {
            const r = rows().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
            return Promise.resolve({ data: r.slice(0, n), error: null });
          },
          range(from, to) {
            SRV.pageReads.set(t, (SRV.pageReads.get(t) ?? 0) + 1);
            /* จุดที่จำลอง "มีคนอื่นเขียนระหว่างที่เรากำลังดึงทีละหน้า" —
               เรียกตอนขอหน้าแรก เพราะช่วงนั้นคือช่วงที่แอปจริงยังไม่ได้ข้อมูลครบ */
            if (from === 0) SRV.duringPull.get(t)?.();
            const pk = SRV.pkcol[t];
            const r = rows().sort((a, b) => String(a[pk]).localeCompare(String(b[pk])));
            return Promise.resolve({ data: r.slice(from, to + 1), error: null });
          },
          then(res) { return Promise.resolve({ count: rows().length, error: null }).then(res); },
        };
        return self;
      },
    };
  },
  channel() { return { on() { return this; }, subscribe() { return this; } }; },
  removeAllChannels() {},
  auth: { getUser: async () => ({ data: { user: { id: 'u-' + DEV } } }) },
};
`;

let nth = 0;
interface Device {
  db: { table: (n: string) => { put: (o: unknown) => Promise<unknown>; delete: (k: unknown) => Promise<unknown> } };
  pullAll: () => Promise<void>;
  pushAll: () => Promise<void>;
  seedLocal: (n: string, rows: unknown[]) => void;
  peek: (n: string, k: unknown) => Record<string, unknown> | undefined;
  dump: (n: string) => Record<string, unknown>[];
  flushNow: () => Promise<void>;
  pendingPushCount: () => number;
  syncProblems: () => { table: string; key: unknown; reason: string }[];
}

/** เปิด "เครื่อง" ใหม่หนึ่งเครื่อง · isTeacher = บทบาทที่ RLS/trigger ฝั่งตู้เห็น */
async function device(name: string, isTeacher = false): Promise<Device> {
  const src = readFileSync(join(root, 'src/data/cloudSync.ts'), 'utf8')
    .replace("import { db, kvGet, kvSet } from './db';", '')
    .replace("import { cloudEnabled, supabase } from '../lib/cloud';", '')
    .replace("import { flushSettings, pullSettings } from './settingsSync';", '')
    .replace("import { loadCachedPolicy, pullPdpaPolicy } from './pdpaSync';", '');
  const dir = mkdtempSync(join(tmpdir(), `clinic-${nth++}-`));
  const f = join(dir, 'mod.mts');
  writeFileSync(f, PRELUDE(name, isTeacher) + src);
  return (await import(f)) as unknown as Device;
}

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) failures++;
}
/** คิว flush ของ cloudSync หน่วง 1.5 วิ — รอให้ของขึ้นจริงก่อนค่อยตรวจ */
const settle = () => new Promise((r) => setTimeout(r, 2000));

/* ── ข้อมูลของกลุ่มจริงหนึ่งกลุ่ม: 12 คน (ขนาดกลุ่มจริงของภาค) ─────────────── */
const GROUP = 'TH-PT1';
const N = 12;
const studentIds = Array.from({ length: N }, (_, i) => `st${i + 1}`);
const roster = studentIds.map((id, i) => ({
  id, code: `65040${String(i + 1).padStart(2, '0')}`, name: `นศ. คนที่ ${i + 1}`,
  group: GROUP, year: 5, entryYear: 2569, advisorIds: ['t1', 't2'], gates: {},
}));
const rosterRows = roster.map((s) => ({
  id: s.id, code: s.code, name: s.name, group: s.group, year: s.year,
  entry_year: s.entryYear, advisor_ids: s.advisorIds, gates: {},
  updated_at: '2026-09-11T00:00:00.000Z',
}));
const seedServerRoster = () => rosterRows.forEach((r) => srvTbl('students').set(r.id, r));

const checkinOf = (sid: string) => ({
  id: `ci-${sid}`, studentId: sid, date: '2026-09-12', punctual: true, noPatient: false,
  activities: ['Primary impression'], status: 'pending', createdAt: '2026-09-12T02:00:00.000Z',
});

/* ══ ① คาบเริ่ม — นักศึกษา 12 คนเช็คอินในนาทีเดียวกัน ════════════════════════
   สภาพจริง: คาบ 09:00 ทุกคนหยิบมือถือขึ้นมากดพร้อมกัน จากไวไฟตัวเดียวกัน
   ถ้าหน้าอาจารย์เห็นไม่ครบ อาจารย์จะสรุปว่าคนที่หายไป "ไม่มาเรียน" */
console.log('① คาบเริ่ม — 12 คนเช็คอินพร้อมกัน');
{
  resetServer();
  seedServerRoster();

  const phones = await Promise.all(studentIds.map((id) => device(`phone-${id}`)));
  await Promise.all(phones.map((p, i) => {
    p.seedLocal('students', [roster[i]]);
    return p.db.table('checkins').put(checkinOf(studentIds[i]));
  }));
  await settle();
  await Promise.all(phones.map((p) => p.flushNow()));

  check('ตู้กลางได้ครบ 12 คาบ', srvTbl('checkins').size === N, srvTbl('checkins').size);
  check('ไม่มีเครื่องไหนมีของค้างส่ง', phones.every((p) => p.pendingPushCount() === 0),
    phones.map((p) => p.pendingPushCount()).filter((n) => n > 0));

  const teacher = await device('อ.เวร-1', true);
  await teacher.pullAll();
  const seen = teacher.dump('checkins');
  check('หน้าอาจารย์เห็นครบ 12 คาบ', seen.length === N, seen.length);
  check('ไม่มีคาบไหนซ้ำหรือสลับเจ้าของ',
    new Set(seen.map((c) => c.studentId)).size === N,
    seen.map((c) => c.studentId).sort());
}

/* ══ ② อาจารย์ประเมิน ขณะที่นักศึกษาแก้โน้ตของคาบเดียวกัน ══════════════════
   สภาพจริงที่สุดของคาบ: อาจารย์เปิดหน้าประเมินไว้ แล้วนักศึกษาบอก "ขอแก้โน้ตนิดนึง"
   ทั้งสองฝ่ายมีฉบับของตัวเองในมือ แล้วกดเซฟไล่กัน */
console.log('\n② อาจารย์ประเมิน ขณะที่นักศึกษาแก้โน้ตคาบเดียวกัน');
{
  resetServer();
  seedServerRoster();
  const ci = checkinOf('st1');
  srvTbl('checkins').set(ci.id, {
    id: ci.id, student_id: 'st1', date: ci.date, punctual: true, no_patient: false,
    activities: ci.activities, status: 'pending', created_at: ci.createdAt,
    updated_at: '2026-09-12T02:00:00.000Z',
  });

  const phone = await device('phone-st1');
  const teacher = await device('อ.เวร-1', true);
  await phone.pullAll();
  await teacher.pullAll();

  // นักศึกษาแก้โน้ต — อาจารย์ยังถือฉบับที่ยังไม่มีโน้ต
  const mine = { ...phone.peek('checkins', ci.id)!, note: 'ลืมเอา shade guide มา' };
  await phone.db.table('checkins').put(mine);
  await settle();
  await phone.flushNow();

  // อาจารย์กดบันทึกผล · ลงนาม จากฉบับเดิมในมือ
  const theirs = {
    ...teacher.peek('checkins', ci.id)!,
    status: 'evaluated', scores: { knowledge: 3, skill: 2 },
    evaluatedBy: 'อ. เวร-1', evaluatedAt: '2026-09-12T05:00:00.000Z',
  };
  await teacher.db.table('checkins').put(theirs);
  await settle();
  await teacher.flushNow();

  const onServer = srvTbl('checkins').get(ci.id)!;
  check('คะแนนของอาจารย์ขึ้นตู้กลาง', onServer.status === 'evaluated', onServer.status);
  /* ⚠️ ข้อนี้คือสิ่งที่ไฟล์นี้มีไว้หา — trigger 0017 กันแค่ "นักศึกษาทับคะแนนอาจารย์"
     ไม่ได้กัน "อาจารย์ทับของนักศึกษา" เพราะอาจารย์มีสิทธิ์แก้ทุกช่องโดยการออกแบบ */
  check('โน้ตที่นักศึกษาเพิ่งพิมพ์ยังอยู่', onServer.note === 'ลืมเอา shade guide มา', onServer.note);
}

/* ══ ③ อาจารย์สองท่านประเมินคาบเดียวกัน — ของเดิมต้องไม่หาย ═════════════════
   อาจารย์เวรสลับกันจริง คนที่ประเมินไปแล้วอาจไม่อยู่ตอนมีคนมาแก้
   กติกาที่ตกลงไว้ใน 0017: ไม่ห้ามทับ แต่ของเดิมต้องถูกเก็บใน score_history */
console.log('\n③ อาจารย์สองท่านประเมินคาบเดียวกัน');
{
  resetServer();
  seedServerRoster();
  const ci = checkinOf('st2');
  srvTbl('checkins').set(ci.id, {
    id: ci.id, student_id: 'st2', date: ci.date, punctual: true, no_patient: false,
    activities: ci.activities, status: 'pending', created_at: ci.createdAt,
    updated_at: '2026-09-12T02:00:00.000Z',
  });

  const a = await device('อ.เวร-1', true);
  const b = await device('อ.เวร-2', true);
  await a.pullAll();
  await b.pullAll();

  await a.db.table('checkins').put({
    ...a.peek('checkins', ci.id)!, status: 'evaluated',
    scores: { knowledge: 3, skill: 3 }, evaluatedBy: 'อ. หนึ่ง', evaluatedAt: '2026-09-12T05:00:00.000Z',
  });
  await settle();
  await a.flushNow();

  await b.pullAll(); // อาจารย์ท่านที่สองเห็นของท่านแรกก่อนแก้
  await b.db.table('checkins').put({
    ...b.peek('checkins', ci.id)!, status: 'evaluated',
    scores: { knowledge: 2, skill: 2 }, evaluatedBy: 'อ. สอง', evaluatedAt: '2026-09-12T06:00:00.000Z',
  });
  await settle();
  await b.flushNow();

  const onServer = srvTbl('checkins').get(ci.id)!;
  const hist = (onServer.score_history ?? []) as Array<{ by?: string }>;
  check('คะแนนล่าสุดเป็นของท่านที่สอง', onServer.evaluated_by === 'อ. สอง', onServer.evaluated_by);
  check('คะแนนของท่านแรกถูกเก็บไว้ ไม่หายเงียบ', hist.some((h) => h.by === 'อ. หนึ่ง'), hist);
}

/* ══ ④ คนเดียวกัน สองเครื่อง (มือถือ + ไอแพด) ════════════════════════════════
   นักศึกษาหลายคนใช้ไอแพดตอนอยู่ยูนิต และมือถือตอนเดินไปแล็บ — สองเครื่องเปิดค้างทั้งคู่
   ถ้าเครื่องที่ถือฉบับเก่ากดเซฟทีหลัง step ที่เพิ่งกดบนเครื่องอีกตัวจะหาย */
console.log('\n④ คนเดียวกัน สองเครื่อง (มือถือ + ไอแพด)');
{
  resetServer();
  seedServerRoster();
  const w = {
    id: 'w1', patient_id: 'p1', student_id: 'st3', type: 'CD', arch: 'upper',
    detail: 'CD/- (Upper)', accepted_date: '2026-06-03', minimum_requirement: true,
    pending_qualification: false, proc_index: 3, note: '',
    updated_at: '2026-09-12T02:00:00.000Z',
  };
  srvTbl('workpieces').set('w1', w);

  const ipad = await device('ipad-st3');
  const phone = await device('phone-st3');
  await ipad.pullAll();
  await phone.pullAll();

  // บนไอแพด: กด step ต่อไป
  await ipad.db.table('workpieces').put({ ...ipad.peek('workpieces', 'w1')!, procIndex: 4 });
  await settle();
  await ipad.flushNow();

  // บนมือถือ (ยังถือฉบับ procIndex 3): พิมพ์โน้ตแล้วเซฟ
  await phone.db.table('workpieces').put({ ...phone.peek('workpieces', 'w1')!, note: 'นัดต่อ 19 ก.ย.' });
  await settle();
  await phone.flushNow();

  const onServer = srvTbl('workpieces').get('w1')!;
  check('โน้ตที่พิมพ์บนมือถือขึ้นตู้กลาง', onServer.note === 'นัดต่อ 19 ก.ย.', onServer.note);
  /* ⚠️ ข้อนี้ "ล็อกพฤติกรรมที่เป็นอยู่" ไม่ใช่ยืนยันว่าถูก — step ที่กดบนไอแพดถูกย้อนกลับ
     เพราะมือถือ upsert ทั้งแถวจากฉบับ procIndex 3 ที่ยังถืออยู่

     ทำไมยังไม่แก้: `workpieces` ไม่มีการแบ่งเจ้าของช่องระหว่างบทบาท ทุกช่องเป็นของนักศึกษา
     กฎฝั่งเซิร์ฟเวอร์แบบ `0020` ช่วยไม่ได้ เพราะทั้งสองเครื่องคือคนเดียวกัน
     ทางแก้จริงคือให้คิวจำ "ช่องที่แก้" ไม่ใช่แค่คีย์ของแถว — งานใหญ่ใน `cloudSync.ts`
     ซึ่งเป็นไฟล์ที่เสี่ยงที่สุด · ยังไม่ทำ บันทึกไว้ใน README แล้ว

     หน้าต่างของปัญหาแคบ (คิว flush ใน 1.5 วิ · pullAll ทุก 15 วิ) และต้องเป็น
     "คนเดียวกันเปิดสองเครื่องพร้อมกัน แล้วแก้เคสเดียวกันคนละช่องในไม่กี่วินาที"

     ⚠️ ถ้าวันหน้ามีใครทำคิวรายช่องแล้ว **ข้อนี้จะตก** — ให้แก้เป็น === 4 แล้วลบคอมเมนต์นี้
        (การตกของมันคือสัญญาณว่าแก้สำเร็จ ไม่ใช่ว่าพัง) */
  check('สองเครื่องของคนเดียวกัน: คนเซฟทีหลังชนะทั้งแถว (ข้อจำกัดที่รู้อยู่ ยังไม่แก้)',
    onServer.proc_index === 3, onServer.proc_index);
}

/* ══ ⑤ มีคนเขียนระหว่างที่อาจารย์กำลังดึงข้อมูล ═════════════════════════════
   `pullAll` อ่านค่า "ใหม่สุด" ก่อน แล้วค่อยดึงทีละหน้า — บนเน็ตคลินิกช่วงนั้นกินเวลาเป็นวินาที
   ถ้าแถวที่เขียนเข้ามาระหว่างนั้นถูกนับว่า "ดึงแล้ว" มันจะไม่ไหลลงเครื่องนี้อีกเลย
   จนกว่าจะมีคนอื่นเขียนตารางนั้นซ้ำ — เป็นการหายแบบที่ไม่มี error ให้ใครเห็น */
console.log('\n⑤ มีคนเช็คอินระหว่างที่อาจารย์กำลังดึงข้อมูล');
{
  resetServer();
  seedServerRoster();
  for (const sid of studentIds.slice(0, 3)) {
    srvTbl('checkins').set(`ci-${sid}`, {
      id: `ci-${sid}`, student_id: sid, date: '2026-09-12', punctual: true,
      no_patient: false, activities: ['Primary impression'], status: 'pending',
      created_at: '2026-09-12T02:00:00.000Z', updated_at: `2026-09-12T02:0${sid.slice(2)}:00.000Z`,
    });
  }

  const teacher = await device('อ.เวร-1', true);
  // คนที่ 4 กดเช็คอินตอนที่อาจารย์ขอหน้าแรกไปแล้ว
  SRV.duringPull.set('checkins', () => {
    srvTbl('checkins').set('ci-late', {
      id: 'ci-late', student_id: 'st9', date: '2026-09-12', punctual: false,
      no_patient: false, activities: ['Try in/Delivery'], status: 'pending',
      created_at: '2026-09-12T02:10:00.000Z', updated_at: new Date(SRV.clock++).toISOString(),
    });
  });
  await teacher.pullAll();
  SRV.duringPull.delete('checkins');

  const first = teacher.dump('checkins').length;
  await teacher.pullAll(); // รอบถัดไปของตัวจับเวลา 15 วิ
  const second = teacher.dump('checkins');

  check('รอบถัดไปต้องเห็นคาบที่เข้ามาสาย (ห้ามถูกข้ามถาวร)',
    second.some((c) => c.id === 'ci-late'), { first, second: second.length });
  check('ไม่มีคาบไหนหายไปจากรอบแรก', second.length >= first, { first, second: second.length });
}

/* ══ ⑥ อาจารย์ติ๊กประตู Sect II ขณะที่อีกท่านติ๊กประตูอื่นของคนเดียวกัน ══════
   ประตู (gates) อยู่ใน `students.gates` ก้อนเดียว — สองท่านติ๊กช่องต่างกันพร้อมกัน
   ถ้าเขียนทับทั้งก้อน ประตูของอีกท่านจะหลุด ซึ่ง 0017 มี trigger ผสานรายช่องไว้แล้ว
   ข้อนี้ยืนยันว่าการผสานนั้นทนสองเครื่องพร้อมกันจริง ไม่ใช่แค่ทีละคู่ */
console.log('\n⑥ อาจารย์สองท่านติ๊กประตูคนละช่องของนักศึกษาคนเดียวกัน');
{
  resetServer();
  seedServerRoster();
  const a = await device('อ.เวร-1', true);
  const b = await device('อ.เวร-2', true);
  await a.pullAll();
  await b.pullAll();

  await a.db.table('students').put({ ...a.peek('students', 'st4')!, gates: { osce: true } });
  await b.db.table('students').put({ ...b.peek('students', 'st4')!, gates: { designRpd: true } });
  await settle();
  await Promise.all([a.flushNow(), b.flushNow()]);

  const gates = (srvTbl('students').get('st4')!.gates ?? {}) as Record<string, unknown>;
  check('ประตูที่ท่านแรกติ๊กยังอยู่', gates.osce === true, gates);
  check('ประตูที่ท่านที่สองติ๊กก็อยู่', gates.designRpd === true, gates);
}

/* ══ ⑦ ทั้งกลุ่มกดพร้อมกัน แล้วทุกเครื่องดึงกลับ — ต้องเห็นตรงกันหมด ═══════
   ข้อนี้คือ "นำร่องหลายเครื่องพร้อมกัน" ที่ CLAUDE.md บอกว่ายังไม่เคยทำ
   วัดสิ่งเดียว: หลังฝุ่นหายตลบ ทุกเครื่องเห็นข้อมูลชุดเดียวกันไหม */
console.log('\n⑦ ทั้งกลุ่มกดพร้อมกัน แล้วทุกเครื่องดึงกลับ');
{
  resetServer();
  seedServerRoster();
  const phones = await Promise.all(studentIds.map((id) => device(`phone-${id}`)));

  // ทุกคนสร้างชิ้นงานใหม่ + เช็คอิน + แถวประวัติ พร้อมกัน (สามตารางในจังหวะเดียว)
  await Promise.all(phones.map(async (p, i) => {
    const sid = studentIds[i];
    p.seedLocal('students', [roster[i]]);
    await p.db.table('workpieces').put({
      id: `w-${sid}`, patientId: `p-${sid}`, studentId: sid, type: 'RPD', arch: 'lower',
      detail: 'RPD (Lower)', acceptedDate: '2026-09-12', minimumRequirement: true,
      pendingQualification: false, procIndex: 0,
    });
    await p.db.table('checkins').put(checkinOf(sid));
    await p.db.table('updates').put({
      id: `u-${sid}`, workpieceId: `w-${sid}`, at: '2026-09-12T03:00:00.000Z',
      text: 'Primary impression', by: sid,
    });
  }));
  await settle();
  await Promise.all(phones.map((p) => p.flushNow()));

  check('ชิ้นงานขึ้นครบ 12', srvTbl('workpieces').size === N, srvTbl('workpieces').size);
  check('คาบขึ้นครบ 12', srvTbl('checkins').size === N, srvTbl('checkins').size);
  check('แถวประวัติขึ้นครบ 12', srvTbl('updates').size === N, srvTbl('updates').size);
  check('ไม่มีเครื่องไหนรายงานปัญหา sync',
    phones.every((p) => p.syncProblems().length === 0),
    phones.flatMap((p) => p.syncProblems()));

  // ทุกเครื่องดึงกลับ แล้วต้องเห็นเท่ากัน
  await Promise.all(phones.map((p) => p.pullAll()));
  const counts = phones.map((p) => p.dump('workpieces').length);
  check('ทุกเครื่องเห็นชิ้นงานเท่ากันหมด', new Set(counts).size === 1 && counts[0] === N, counts);

  const teacher = await device('อ.เวร-1', true);
  await teacher.pullAll();
  check('อาจารย์เห็นครบทั้งสามตาราง',
    teacher.dump('workpieces').length === N && teacher.dump('checkins').length === N
      && teacher.dump('updates').length === N,
    { w: teacher.dump('workpieces').length, c: teacher.dump('checkins').length, u: teacher.dump('updates').length });
}

/* ══ ⑧ ตู้กลางปลอมต้องตรงกับ SQL จริง ═════════════════════════════════════
   `CLAUDE.md` เตือนไว้ว่ากับดักของวิธีนี้คือ "แก้ migration แล้วลืมแก้ตู้ปลอม
   → เทสต์ผ่านทั้งที่ของจริงพัง" · ข้อนี้เทียบรายชื่อช่องให้เอง ไม่ต้องพึ่งความจำใคร */
console.log('\n⑧ ตู้กลางปลอมต้องตรงกับ 0020 ตัวจริง');
{
  const sql = readFileSync(join(root, 'supabase/migrations/0020_checkin_field_owner.sql'), 'utf8');
  // เอาเฉพาะบล็อกหลังด่านของนักศึกษา (`return new;` ตัวที่สอง) = กฎของฝั่งอาจารย์
  const teacherBlock = sql.slice(sql.indexOf('ใหม่ใน 0020'));
  const inSql = new Set(
    [...teacherBlock.matchAll(/new\.([a-z_]+)\s*:=\s*old\.\1/g)].map((m) => m[1]),
  );
  const self = readFileSync(join(root, 'scripts/test-clinic-day.mts'), 'utf8');
  const mirrorBlock = self.slice(self.indexOf("0020 · ทิศกลับ"), self.indexOf('row.score_history = old.score_history ?? []'));
  const inMirror = new Set(
    [...mirrorBlock.matchAll(/row\.([a-z_]+)\s*=\s*old\.\1/g)].map((m) => m[1]),
  );

  check('อ่านรายชื่อช่องจาก SQL ได้ (ไม่ใช่ regex ตกรูป)', inSql.size >= 8, [...inSql]);
  const onlySql = [...inSql].filter((f) => !inMirror.has(f));
  const onlyMirror = [...inMirror].filter((f) => !inSql.has(f));
  check('ทุกช่องที่ SQL คงไว้ ตู้ปลอมก็คงไว้', onlySql.length === 0, onlySql);
  check('ตู้ปลอมไม่ได้คงช่องที่ SQL ไม่ได้คง', onlyMirror.length === 0, onlyMirror);
  check('ช่องโน้ตอยู่ในรายการ (หัวใจของบั๊กข้อ ②)', inSql.has('note') && inMirror.has('note'));
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
