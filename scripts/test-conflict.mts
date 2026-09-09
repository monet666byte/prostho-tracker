/**
 * ทดสอบว่า "สองเครื่องเขียนชนกันแล้วข้อมูลไม่หายเงียบ" — รันด้วย `npm run test:conflict`
 *
 * ทำไมต้องมี: ก่อนหน้านี้ทั้งระบบใช้ "คนเขียนทีหลังชนะ" ซึ่งพอสำหรับ pilot คนเดียว
 * แต่ที่ 96 คน + อาจารย์สองท่านต่อนักศึกษาหนึ่งคน มันแปลว่างานของคนหนึ่งหายไปเฉยๆ
 * โดยไม่มี error ไม่มีป้าย ไม่มีใครรู้ — และตัวเลขพวกนี้ผูกกับการจบของนักศึกษา
 *
 * ทั้ง 5 ข้อล่างนี้ "เคยพังจริง" ทุกข้อ เจอด้วยการรันโพรบแบบนี้ ไม่ใช่การอ่านโค้ด
 * (9 ก.ย. 69 — เหมือน test-settings-sync.mts ที่จับ race ได้สองตัวตอนเขียนรอบแรก)
 *
 * วิธีทำงาน: ก๊อป src/data/cloudSync.ts ตัวจริงไป temp แล้วตัด import ทิ้ง ใส่ของปลอมแทน
 * แต่ละ "เครื่อง" = โมดูลคนละสำเนา (มีคิว/ลิ้นชัก/นาฬิกาของตัวเอง) ต่อตู้กลางใบเดียวกัน
 *
 * ⚠️ ตู้กลางปลอมในไฟล์นี้ "จำลองกติกาของ supabase/migrations/0017_conflict.sql"
 *    ประทับ updated_at ด้วยนาฬิกาตู้ · ผสาน students.gates รายช่อง · เก็บ checkins.score_history
 *    ถ้าแก้ 0017 ต้องมาแก้ที่นี่ด้วย ไม่งั้นเทสต์จะผ่านทั้งที่ของจริงพัง
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
  /** ตารางไหน "ปฏิเสธ" การเขียน — จำลอง RLS / trigger ที่ raise */
  reject: Set<string>;
  /** true = ตู้กลางที่ยังไม่ได้รัน 0017 (เชื่อตราเวลาที่เครื่องส่งมา) — ใช้ทดสอบด่านฝั่งแอป */
  trustClientStamp: boolean;
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
  reject: new Set(),
  trustClientStamp: false,
  clock: Date.parse('2026-09-09T03:00:00.000Z'),
};
(globalThis as never as { __SRV__: Srv }).__SRV__ = SRV;

const srvTbl = (t: string) => {
  let m = SRV.tables.get(t);
  if (!m) SRV.tables.set(t, (m = new Map()));
  return m;
};
const resetServer = () => { SRV.tables.clear(); SRV.reject.clear(); SRV.trustClientStamp = false; };

/* ── ของปลอมที่ยัดแทน import ของ cloudSync.ts ──────────────────────────────── */

const PRELUDE = (dev: string, skewMs: number, isTeacher: boolean) => `
const SRV = globalThis.__SRV__;
const DEV = ${JSON.stringify(dev)};
const SKEW = ${skewMs};
const IS_TEACHER = ${isTeacher};

/* นาฬิกาของ "เครื่องนี้" — ตั้งเพี้ยนได้ เพื่อพิสูจน์ว่าระบบไม่ได้เชื่อมันอีกแล้ว
   (class ในโมดูลบังชื่อ Date ของ global เฉพาะในไฟล์นี้) */
const RealDate = globalThis.Date;
class Date extends RealDate {
  constructor(...a) { if (!a.length) super(RealDate.now() + SKEW); else super(...a); }
  static now() { return RealDate.now() + SKEW; }
}

export const cloudEnabled = true;
export const flushSettings = async () => {};
export const pullSettings = async () => false;
export const loadCachedPolicy = async () => {};
export const pullPdpaPolicy = async () => {};

const srvTbl = (t) => { let m = SRV.tables.get(t); if (!m) SRV.tables.set(t, (m = new Map())); return m; };
/** เวลาของ "ตู้กลาง" — เดินทีละ 1 มิลลิวินาทีทุกครั้งที่มีคนเขียน (แทน now() ของ Postgres) */
const serverStamp = () => new RealDate(SRV.clock++).toISOString();

/* ── ลิ้นชักในเครื่องปลอม — เขียนผ่าน middleware จริงของ cloudSync ────────── */
const PK = { teachers:'id', students:'id', groups:'code', patients:'id', workpieces:'id',
  updates:'id', photos:'id', checkins:'id', reviews:'id', submissions:'id',
  issues:'studentId', audit:'id', selfAssessments:'id', sect2:'id', sect3:'id' };
const local = new Map();
const tbl = (n) => { let m = local.get(n); if (!m) local.set(n, m = new Map()); return m; };
export const peek = (n, k) => tbl(n).get(k);
export const dump = (n) => [...tbl(n).values()];
/** ใส่ข้อมูลลงลิ้นชักโดยไม่ผ่านคิว — จำลอง "สภาพก่อนหน้าที่ sync มาแล้ว" */
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

/* ── supabase ปลอม — ฝั่งนี้คือที่ที่กติกาของ 0017_conflict.sql ถูกจำลอง ──── */
function applyTriggers(table, incoming) {
  const pk = SRV.pkcol[table];
  const old = srvTbl(table).get(incoming[pk]);
  const row = { ...incoming };

  // ① ตราเวลามาจากนาฬิกาตู้กลางเสมอ ไม่ว่าเครื่องจะส่งอะไรมา (trigger zz_touch_updated_at)
  if (!SRV.trustClientStamp) row.updated_at = serverStamp();
  else row.updated_at = incoming.updated_at ?? serverStamp();

  if (old) {
    // ② students.gates — ผสานรายช่อง (trigger students_merge_gates)
    if (table === 'students') {
      if (row.gates == null) row.gates = old.gates;
      else {
        const merged = { ...(old.gates ?? {}), ...row.gates };
        for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
        row.gates = merged;
      }
    }
    // ③ checkins — trigger checkin_scoring_guard
    if (table === 'checkins' && !IS_TEACHER) {
      // นักศึกษาแตะช่องคะแนนไม่ได้ — คงของเดิมไว้เงียบๆ (ไม่ raise ไม่งั้นทั้งก้อน upsert ตก)
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
        // จำลอง "ทั้งก้อนตก" แบบ Postgres: statement เดียว แถวเดียวผิดก็ตกทั้งหมด
        if (arr.some((r) => SRV.reject.has(t + '|' + r[SRV.pkcol[t]]))) {
          return Promise.resolve({ error: { message: 'ถูกปฏิเสธ (RLS/trigger)' } });
        }
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
            const pk = SRV.pkcol[t];
            const r = rows().sort((a, b) => String(a[pk]).localeCompare(String(b[pk])));
            return Promise.resolve({ data: r.slice(from, to + 1), error: null });
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

let nth = 0;
type Device = {
  db: { table: (n: string) => { put: (o: unknown) => Promise<unknown> } };
  pullAll: () => Promise<void>;
  seedLocal: (n: string, rows: unknown[]) => void;
  peek: (n: string, k: unknown) => Record<string, unknown> | undefined;
  dump: (n: string) => Record<string, unknown>[];
  syncProblems: () => { table: string; key: unknown; reason: string }[];
  retryQuarantined: () => void;
  flushNow: () => Promise<void>;
};

/** เปิด "เครื่อง" ใหม่หนึ่งเครื่อง · skewMin = นาฬิกาเพี้ยนไปกี่นาที · isTeacher = บทบาทที่ RLS เห็น */
async function device(name: string, skewMin = 0, isTeacher = true): Promise<Device> {
  const src = readFileSync(join(root, 'src/data/cloudSync.ts'), 'utf8')
    .replace("import { db, kvGet, kvSet } from './db';", '')
    .replace("import { cloudEnabled, supabase } from '../lib/cloud';", '')
    .replace("import { flushSettings, pullSettings } from './settingsSync';", '')
    .replace("import { loadCachedPolicy, pullPdpaPolicy } from './pdpaSync';", '');
  const dir = mkdtempSync(join(tmpdir(), `conflict-${nth++}-`));
  const f = join(dir, 'mod.mts');
  writeFileSync(f, PRELUDE(name, skewMin * 60_000, isTeacher) + src);
  return (await import(f)) as Device;
}

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  → ' + extra : ''));
  if (!ok) failures++;
}
/** คิว flush ของ cloudSync หน่วง 1.5 วิ — รอให้ของขึ้นจริงก่อนค่อยตรวจ */
const settle = () => new Promise((r) => setTimeout(r, 2000));

const STUDENT = {
  id: 'st1', code: '6504001', name: 'นศ. ก', group: 'TH-PT1',
  year: 5, entryYear: 2569, advisorIds: ['t1', 't2'], gates: {},
};
const CHECKIN = {
  id: 'ci1', studentId: 'st1', date: '2026-09-09', punctual: true, noPatient: false,
  patientId: undefined, activities: ['Laboratory work'], note: undefined,
  status: 'pending', createdAt: '2026-09-09T01:00:00Z',
};

/* ══ ① อาจารย์สองท่านติ๊กเงื่อนไขจบคนละช่อง ของ นศ. คนเดียวกัน ═════════════ */
console.log('\nอาจารย์สองท่านติ๊กเงื่อนไขจบคนละช่อง (นศ. หนึ่งคนมีที่ปรึกษาสองท่าน)');
{
  resetServer();
  const A = await device('อ.ก');
  const B = await device('อ.ข');
  A.seedLocal('students', [STUDENT]);
  B.seedLocal('students', [STUDENT]);

  await A.db.table('students').put({ ...structuredClone(STUDENT), gates: { sect2Removable: true } });
  await B.db.table('students').put({ ...structuredClone(STUDENT), gates: { designRpd: true } });
  await settle();

  const g = (srvTbl('students').get('st1')?.gates ?? {}) as Record<string, boolean>;
  check('ติ๊กของทั้งสองท่านอยู่ครบ', !!g.sect2Removable && !!g.designRpd, JSON.stringify(g));

  // ลบธงต้องยังทำได้ (syncSect2Gate ลบเมื่อใบประเมินถูกลบหมด) — ส่ง null = ตั้งใจลบ
  await A.db.table('students').put({ ...structuredClone(STUDENT), gates: { sect2Removable: null } });
  await settle();
  const g2 = (srvTbl('students').get('st1')?.gates ?? {}) as Record<string, boolean>;
  check('ลบธงทิ้งได้ (ไม่ค้างเป็นผ่านตลอดกาล)', !('sect2Removable' in g2), JSON.stringify(g2));
  check('ลบช่องหนึ่ง ไม่กระทบอีกช่อง', g2.designRpd === true, JSON.stringify(g2));
}

/* ══ ② อาจารย์สองท่านลงคะแนนคาบเดียวกัน ═══════════════════════════════════ */
console.log('\nอาจารย์สองท่านลงคะแนนคาบเดียวกันพร้อมกัน');
{
  resetServer();
  const A = await device('อ.ก');
  const B = await device('อ.ข');
  A.seedLocal('checkins', [CHECKIN]);
  B.seedLocal('checkins', [CHECKIN]);

  await A.db.table('checkins').put({ ...structuredClone(CHECKIN),
    status: 'evaluated', scores: { knowledge: 3 }, evaluatedBy: 'อ. ก', evaluatedAt: 'tA' });
  await settle();
  await B.db.table('checkins').put({ ...structuredClone(CHECKIN),
    status: 'evaluated', scores: { knowledge: 1 }, evaluatedBy: 'อ. ข', evaluatedAt: 'tB' });
  await settle();

  const row = srvTbl('checkins').get('ci1')!;
  const hist = (row.score_history ?? []) as { by?: string; scores?: Record<string, number> }[];
  check('คะแนนชุดล่าสุดคือของคนที่กดทีหลัง', row.evaluated_by === 'อ. ข', String(row.evaluated_by));
  check('คะแนนของท่านแรกยังอยู่ ไม่หายเงียบ', hist.length === 1 && hist[0].by === 'อ. ก', JSON.stringify(hist));
  check('เก็บคะแนนจริงของท่านแรกไว้ด้วย', hist[0]?.scores?.knowledge === 3, JSON.stringify(hist[0]?.scores));
}

/* ══ ③ นาฬิกาเครื่องเพี้ยน ต้องไม่ทำให้ทั้งตารางหยุดไหล ═══════════════════ */
console.log('\nเครื่องหนึ่งตั้งนาฬิกาเดินเร็ว 1 ชั่วโมง');
{
  resetServer();
  const FAST = await device('เครื่องนาฬิกาเพี้ยน', 60);
  const OK1 = await device('เครื่องปกติ-1');
  const OK2 = await device('เครื่องปกติ-2');
  const work = (id: string, procIndex: number) => ({
    id, patientId: 'p1', studentId: 'st1', type: 'CD', detail: 'CD/-',
    acceptedDate: '2026-06-01', minimumRequirement: true, payment: 'ยกเว้น',
    sect2Removable: false, sect2Fixed: false, procIndex,
    lastUpdatedAt: '2026-09-09T01:00:00Z', catalogVersion: 'DTPT502-2569',
  });

  await FAST.db.table('workpieces').put(work('wA', 1));
  await settle();
  await OK2.pullAll();
  check('เครื่องปกติดึงของรอบแรกได้', OK2.dump('workpieces').length === 1);

  await OK1.db.table('workpieces').put(work('wB', 5));
  await settle();
  await OK2.pullAll();
  const seen = OK2.dump('workpieces').map((x) => x.id).sort();
  // เคยพังตรงนี้: เครื่องนาฬิกาเพี้ยนดัน "เวลาสูงสุด" ไปอยู่อนาคต
  // ตัวเช็ค "เท่าเดิม = ไม่มีอะไรใหม่" จึงเป็นจริงตลอด → ตารางนั้นหยุดไหลถาวร
  check('งานที่เครื่องอื่นเพิ่งบันทึกยังไหลลงมา', seen.includes('wB'), 'เห็น ' + JSON.stringify(seen));
}

/* ── ③b ด่านฝั่งแอป: ตู้กลางที่ยังไม่ได้รัน 0017 ก็ต้องไม่ค้าง ─────────────── */
{
  resetServer();
  SRV.trustClientStamp = true; // ยังไม่ได้รัน 0017 — ตราเวลาเป็นของเครื่องผู้ใช้
  const OK = await device('เครื่องปกติ');
  const w = (id: string) => ({
    id, patientId: 'p1', studentId: 'st1', type: 'CD', detail: 'CD/-',
    acceptedDate: '2026-06-01', minimumRequirement: true, payment: 'ยกเว้น',
    sect2Removable: false, sect2Fixed: false, procIndex: 1,
    lastUpdatedAt: '2026-09-09T01:00:00Z', catalogVersion: 'DTPT502-2569',
  });
  // แถวเก่าที่เครื่องนาฬิกาเพี้ยนเคยเขียนไว้ ค้างอยู่บนตู้กลางด้วยเวลาอนาคต
  srvTbl('workpieces').set('wOld', { ...w('wOld'), updated_at: '2099-01-01T00:00:00.000Z' });
  await OK.pullAll();
  srvTbl('workpieces').set('wNew', { ...w('wNew'), updated_at: new Date().toISOString() });
  await OK.pullAll();
  // เคยพัง: ค่าสูงสุดค้างที่ปี 2099 → "เท่าเดิม = ไม่มีอะไรใหม่" เป็นจริงตลอด ตารางหยุดไหลถาวร
  check('ตราเวลาอนาคตค้างอยู่ ก็ยังดึงของใหม่ได้ (ด่านฝั่งแอป)',
    OK.dump('workpieces').some((x) => x.id === 'wNew'),
    'เห็น ' + JSON.stringify(OK.dump('workpieces').map((x) => x.id).sort()));
}

/* ══ ④ นักศึกษาแก้คาบตอนออฟไลน์ ทับคาบที่อาจารย์เพิ่งลงคะแนน ═════════════ */
console.log('\nนศ. เติมกิจกรรมตอนออฟไลน์ ทับคาบที่อาจารย์เพิ่งลงคะแนน');
{
  resetServer();
  const TCH = await device('อ.ก');
  const STU = await device('นศ.ก', 0, false);
  TCH.seedLocal('checkins', [CHECKIN]);
  STU.seedLocal('checkins', [CHECKIN]);

  await TCH.db.table('checkins').put({ ...structuredClone(CHECKIN),
    status: 'evaluated', scores: { knowledge: 3 }, evaluatedBy: 'อ. ก', evaluatedAt: 'tA' });
  await settle();

  // เครื่อง นศ. ยังถือสำเนาเก่า (status pending) เพราะเพิ่งออฟไลน์อยู่
  await STU.db.table('checkins').put({ ...structuredClone(CHECKIN),
    activities: ['Try in / Delivery'], note: 'ทำ try-in' });
  await settle();

  const row = srvTbl('checkins').get('ci1')!;
  check('คะแนนอาจารย์ไม่ถูกล้างเป็น pending', row.status === 'evaluated', 'status=' + String(row.status));
  check('คะแนนยังอยู่ครบ', JSON.stringify(row.scores) === '{"knowledge":3}', JSON.stringify(row.scores));
  check('สิ่งที่นักศึกษาพิมพ์ก็ขึ้นได้ ไม่ถูกทิ้ง',
    JSON.stringify(row.activities) === '["Try in / Delivery"]', JSON.stringify(row.activities));
}

/* ══ ⑤ แถวเดียวถูกปฏิเสธ ต้องไม่ลากงานอื่นในคิวหายไปด้วย ═════════════════ */
console.log('\nแถวเดียวถูกเซิร์ฟเวอร์ปฏิเสธ (RLS/trigger)');
{
  resetServer();
  const STU = await device('นศ.ก', 0, false);
  const mk = (id: string) => ({ ...structuredClone(CHECKIN), id, date: '2026-09-0' + id.slice(-1) });
  SRV.reject.add('checkins|ci_bad');

  await STU.db.table('checkins').put({ ...mk('ci_bad'), note: 'แถวที่เซิร์ฟเวอร์ไม่รับ' });
  await STU.db.table('checkins').put({ ...mk('ci_1'), note: 'คาบปกติ 1' });
  await STU.db.table('checkins').put({ ...mk('ci_2'), note: 'คาบปกติ 2' });
  /* ต้องครบโควตา retry ก่อนถึงจะยอมแยกส่งรายแถว
     ก้อนที่ตกไม่ได้ตั้งเวลาลองใหม่ให้ตัวเอง (ในแอปจริงรอบ 15 วิ กับ event 'online' เป็นคนพากลับมา)
     เทสต์จึงเรียก flushNow ตรงๆ แทนการนั่งรอ */
  await settle();
  for (let i = 0; i < 3; i++) await STU.flushNow();

  // เคยพัง: upsert เป็นก้อน แถวเดียวตกทั้งก้อนตก แล้ว clearSent ล้างทุก id ในคิว
  // = คาบปกติที่ไม่เกี่ยวข้องเลยหายไปพร้อมกัน โดยไม่มีอะไรบอกผู้ใช้
  check('คาบปกติขึ้นตู้กลางได้ ไม่โดนลากหายไปด้วย',
    srvTbl('checkins').has('ci_1') && srvTbl('checkins').has('ci_2'),
    'บนตู้กลางมี ' + JSON.stringify([...srvTbl('checkins').keys()]));

  const probs = STU.syncProblems();
  check('แถวที่ส่งไม่ได้ถูกบอกให้ผู้ใช้รู้ ไม่ทิ้งเงียบ',
    probs.length === 1 && probs[0].key === 'ci_bad', JSON.stringify(probs));
  check('ของที่ส่งไม่ได้ยังอยู่ในเครื่องครบ', !!STU.peek('checkins', 'ci_bad'));

  // ผู้ใช้กด "ลองส่งใหม่" หลังผู้ดูแลแก้สิทธิ์ให้แล้ว
  SRV.reject.clear();
  STU.retryQuarantined();
  await settle();
  check('กดลองใหม่แล้วขึ้นได้', srvTbl('checkins').has('ci_bad'));
  check('รายการเตือนหายไปหลังส่งสำเร็จ', STU.syncProblems().length === 0);
}

/* ══ ⑥ คำตัดสินชิ้นงาน: สองท่านตัดสินชิ้นเดียวกัน (ตรรกะฝั่งแอป) ═════════ */
console.log('\nอาจารย์สองท่านอนุมัติ/ตีกลับชิ้นงานเดียวกัน');
{
  const { pickLatestReviews } = await import(join(root, 'src/domain/conflict.ts')) as {
    pickLatestReviews: (r: unknown[]) => Map<string, { by?: string }>;
  };
  const rows = [
    { id: 'rv_B', workpieceId: 'w1', status: 'returned', comment: 'แก้ occlusion', by: 'อ. ข', at: '2026-09-09T05:00:00Z' },
    { id: 'rv_A', workpieceId: 'w1', status: 'approved', comment: 'ผ่าน', by: 'อ. ก', at: '2026-09-09T04:00:00Z' },
  ];
  // เคยพัง: `new Map(all.map(...))` เอา "แถวท้ายอาร์เรย์" ซึ่งคือลำดับที่ IndexedDB คืนมา
  // สองเครื่องจึงเห็นคำตัดสินคนละอันของชิ้นงานเดียวกัน โดยไม่มีอะไรบอก
  check('เลือกใบล่าสุดเสมอ ไม่ขึ้นกับลำดับที่อ่านมา',
    pickLatestReviews(rows).get('w1')?.by === 'อ. ข' &&
    pickLatestReviews([...rows].reverse()).get('w1')?.by === 'อ. ข');
  check('ใบของอีกท่านไม่ถูกลบทิ้ง (ยังนับได้ 2 ใบ)', rows.length === 2);
}

/* ══ ⑦ ใบประเมิน portfolio: ทับได้เฉพาะใบของตัวเอง ═══════════════════════ */
console.log('\nใบประเมิน Section II/III — อาจารย์สองท่านเปิดใบเดียวกัน');
{
  const { isOthersForm } = await import(join(root, 'src/domain/conflict.ts')) as {
    isOthersForm: (prevBy: string | undefined, actor: string) => boolean;
  };
  // เคยพัง: Sheet รับใบของท่านอื่นมาแก้ต่อ + ร่างอัตโนมัติยิงทุกครั้งที่กา
  // = คะแนนของอีกท่านถูกทับรัวๆ ตลอดเวลาที่เปิดใบค้างไว้
  check('เจอใบของท่านอื่น → แตกใบใหม่', isOthersForm('อ. ก', 'อ. ข'));
  check('ใบของตัวเอง → แก้ต่อได้ ไม่แตกใบซ้ำ', !isOthersForm('อ. ข', 'อ. ข'));
  check('ใบร่างที่ยังไม่มีเจ้าของ → แก้ต่อได้', !isOthersForm(undefined, 'อ. ข'));
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
