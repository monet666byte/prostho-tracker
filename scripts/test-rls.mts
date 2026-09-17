/**
 * "กฎการเข้าถึงกันได้จริงไหม บน Postgres ตัวจริง" · รันด้วย `npm run test:rls`
 *
 * ทำไมต้องมี (13 ก.ย. 69): กฎ RLS / trigger / สิทธิ์ฟังก์ชันของโปรเจกต์นี้ถูกตรวจด้วย "การอ่าน" มาตลอด
 * ส่วนเทสต์ sync ใช้ตู้กลางปลอมที่เขียนเลียนแบบกฎด้วยมือ ซึ่งเพี้ยนจากของจริงได้เงียบๆ
 * การตรวจความปลอดภัย 13 ก.ย. เจอสามช่องด้วยการอ่าน (ปิดใน 0021) — ชุดนี้พิสูจน์ด้วยการ "ลองเจาะ"
 *
 * วิธีทำงาน: `scripts/pg-supabase.mts` สร้าง Postgres จริง (PGlite) แล้วรัน migration ทุกไฟล์
 * จากนั้นสลับตัวตนด้วย role จริง (`set local role authenticated` + `request.jwt.claim.sub`)
 * แบบเดียวกับที่ Supabase ทำกับทุกคำขอ — กฎที่ถูกทดสอบคือบรรทัดเดียวกับที่รันบนเซิร์ฟเวอร์
 *
 * ⚠️ ข้อจำกัด: role / auth / storage ของ Supabase เป็นของจำลองใน pg-supabase.mts
 *    สิทธิ์เริ่มต้นของ anon จำลองตามที่ Supabase ตั้งไว้ · ของจริงยืนยันด้วย supabase/security-check.sql
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readdirSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { freshDatabase } from './pg-supabase.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
  if (!ok) failures++;
}

/* ── สลับตัวตน ─────────────────────────────────────────────────────────────── */

type Who = { uid: string } | 'anon';

/** รันงานในนามคนหนึ่ง แล้วย้อนกลับเสมอ (ไม่ทิ้งผลไว้ให้ข้ออื่นเห็น) — คืนผลหรือ error */
async function as<T>(db: PGlite, who: Who, fn: (tx: Transaction) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let out: { ok: true; value: T } | { ok: false; error: string } = { ok: false, error: 'ไม่ได้รัน' };
  try {
    await db.transaction(async (tx) => {
      if (who === 'anon') {
        await tx.exec(`set local role anon; select set_config('request.jwt.claim.sub', '', true);`);
      } else {
        await tx.exec(`set local role authenticated;`);
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.uid]);
      }
      try {
        out = { ok: true, value: await fn(tx) };
      } catch (e) {
        out = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      await tx.rollback();
    });
  } catch {
    /* rollback ข้างบนทำให้ transaction() throw — เป็นเรื่องปกติ */
  }
  return out;
}

/** นับแถวที่คนนั้นมองเห็น */
const visible = async (db: PGlite, who: Who, sql: string, params: unknown[] = []) => {
  const r = await as(db, who, async (tx) => (await tx.query(sql, params)).rows.length);
  return r.ok ? r.value : -1;
};

/** สมัครบัญชี (trigger handle_new_user ผูกกับรายชื่อเชิญเอง) — คืน uid หรือ error */
async function signUp(db: PGlite, email: string): Promise<{ uid?: string; error?: string }> {
  try {
    const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
    return { uid: r.rows[0].id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/* ── ข้อมูลตั้งต้น: สองกลุ่ม · อาจารย์ที่ปรึกษากลุ่มละคน · หัวหน้าภาค ───────── */

async function seed(db: PGlite) {
  await db.exec(`
    insert into teachers (id, name) values ('t1', 'อ. หนึ่ง'), ('t2', 'อ. สอง'), ('tadmin', 'หัวหน้าภาค');
    insert into groups (code, advisor_ids, student_ids) values
      ('G1', array['t1'], array['sA','sB']), ('G2', array['t2'], array['sC']);
    insert into students (id, code, name, "group", year, entry_year) values
      ('sA', '6504001', 'นศ. เอ', 'G1', 5, 2569),
      ('sB', '6504002', 'นศ. บี', 'G1', 5, 2569),
      ('sC', '6504003', 'นศ. ซี', 'G2', 5, 2569);
    insert into invites (email, role, student_id, teacher_id, is_admin) values
      ('a@student.test', 'student', 'sA', null, false),
      ('b@student.test', 'student', 'sB', null, false),
      ('c@student.test', 'student', 'sC', null, false),
      ('t1@teacher.test', 'teacher', null, 't1', false),
      ('t2@teacher.test', 'teacher', null, 't2', false),
      ('head@teacher.test', 'teacher', null, 'tadmin', true);
    insert into patients (id, name, hn, owner_student_id) values
      ('pA', 'ผู้ป่วยของเอ', 'HN-A', 'sA'), ('pB', 'ผู้ป่วยของบี', 'HN-B', 'sB');
    insert into workpieces (id, patient_id, student_id, type, accepted_date, last_updated_at) values
      ('wA', 'pA', 'sA', 'CD', '2026-06-03', '2026-09-01'),
      ('wB', 'pB', 'sB', 'CD', '2026-06-03', '2026-09-01');
    insert into checkins (id, student_id, date, note, created_at) values
      ('cA', 'sA', '2026-09-12', 'โน้ตของเอ', '2026-09-12T02:00:00Z'),
      ('cB', 'sB', '2026-09-12', 'โน้ตของบี', '2026-09-12T02:00:00Z');
    insert into storage.objects (bucket_id, name) values
      ('case-photos', 'sB/PT-XXXX/wB/ph-b1.jpg');
  `);
  // audit แบบที่ระบบจดจริง: อาจารย์แก้คะแนนคาบของ นศ. บี (อยู่กลุ่มเดียวกับ เอ)
  await db.exec(`
    insert into audit (id, text, at_when, student_id, group_code) values
      ('a1', 'แก้คะแนนคาบ 12 ก.ย. ของ นศ. บี · Overall Knowledge 3→1', '2026-09-12T05:00:00', 'sB', null),
      ('a2', 'ประกาศของกลุ่ม G1', '2026-09-12T05:00:00', null, 'G1'),
      ('a3', 'เรื่องของ นศ. เอ เอง', '2026-09-12T05:00:00', 'sA', null);
  `);
  const ids: Record<string, string> = {};
  for (const [k, email] of Object.entries({
    A: 'a@student.test', B: 'b@student.test', C: 'c@student.test',
    T1: 't1@teacher.test', T2: 't2@teacher.test', HEAD: 'head@teacher.test',
  })) {
    const r = await signUp(db, email);
    if (!r.uid) throw new Error('สมัครบัญชีทดสอบไม่ได้: ' + email + ' ' + r.error);
    ids[k] = r.uid;
  }
  return {
    A: { uid: ids.A }, B: { uid: ids.B }, C: { uid: ids.C },
    T1: { uid: ids.T1 }, T2: { uid: ids.T2 }, HEAD: { uid: ids.HEAD },
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */

const { db, results } = await freshDatabase(root);

console.log('migration ทุกไฟล์บน Postgres จริง');
const broken = results.filter((r) => !r.ok);
check(`รันผ่านครบ ${results.length} ไฟล์`, broken.length === 0, broken.map((b) => `${b.file}: ${b.error}`).join(' | '));
if (broken.length) process.exit(1);

const U = await seed(db);

/* ── ① การสมัคร ─────────────────────────────────────────────────────────────── */
console.log('\n① สมัครบัญชี');
{
  const outsider = await signUp(db, 'stranger@gmail.com');
  check('อีเมลนอกรายชื่อเชิญสมัครไม่ได้ (0009)', !outsider.uid, outsider.error ?? 'สมัครได้!');

  const me = await as(db, U.A, async (tx) =>
    (await tx.query<{ student_id: string; is_admin: boolean }>(`select student_id, is_admin from app_users where uid = auth.uid()`)).rows[0]);
  check('สมัครแล้วผูกกับนักศึกษาที่ถูกเชิญ', me.ok && me.value?.student_id === 'sA', me);

  const escalate = await as(db, U.A, async (tx) =>
    (await tx.query(`update app_users set is_admin = true, teacher_id = 't1' where uid = auth.uid() returning uid`)).rows.length);
  check('นักศึกษาตั้งตัวเองเป็นหัวหน้าภาค/อาจารย์ไม่ได้', !escalate.ok || escalate.value === 0, escalate);

  const selfInvite = await as(db, U.T1, async (tx) =>
    (await tx.query(`insert into invites (email, role, teacher_id, is_admin) values ('x@x.test','teacher','t1',true)`)).affectedRows);
  check('อาจารย์ที่ไม่ใช่หัวหน้าภาคเพิ่มรายชื่อเชิญไม่ได้', !selfInvite.ok, selfInvite);
}

/* ── ② ข้อมูลผู้ป่วย: นักศึกษาเห็นแค่ของตัวเอง ────────────────────────────────── */
console.log('\n② ข้อมูลผู้ป่วยแยกกันต่อคน');
{
  check('นศ. เอ เห็นผู้ป่วยของตัวเอง 1 คน', await visible(db, U.A, `select 1 from patients`) === 1);
  check('นศ. เอ มองไม่เห็นผู้ป่วยของ นศ. บี',
    await visible(db, U.A, `select 1 from patients where id = 'pB'`) === 0);
  check('นศ. เอ มองไม่เห็นชิ้นงานของ นศ. บี',
    await visible(db, U.A, `select 1 from workpieces where id = 'wB'`) === 0);
  check('นศ. เอ มองไม่เห็นคาบของ นศ. บี',
    await visible(db, U.A, `select 1 from checkins where id = 'cB'`) === 0);

  const steal = await as(db, U.A, async (tx) =>
    (await tx.query(`update patients set owner_student_id = 'sA' where id = 'pB' returning id`)).rows.length);
  check('นศ. เอ ยึดผู้ป่วยของ นศ. บี มาเป็นของตัวเองไม่ได้', !steal.ok || steal.value === 0, steal);

  const give = await as(db, U.A, async (tx) =>
    (await tx.query(`update workpieces set student_id = 'sB' where id = 'wA' returning id`)).rows.length);
  check('นศ. เอ โยนชิ้นงานไปเป็นของคนอื่นไม่ได้', !give.ok, give);

  check('อาจารย์เห็นผู้ป่วยทั้งชั้นปี (ตามที่ภาคเคาะไว้ใน 0004)',
    await visible(db, U.T2, `select 1 from patients`) === 2);
  check('คนที่ไม่ได้ล็อกอินเห็นผู้ป่วย 0 คน', await visible(db, 'anon', `select 1 from patients`) <= 0);
}

/* ── ③ รายชื่อนักศึกษา: อ่านได้ของตัวเอง แก้ไม่ได้ ───────────────────────────── */
console.log('\n③ แถวนักศึกษาของตัวเอง');
{
  const rename = await as(db, U.A, async (tx) =>
    (await tx.query(`update students set "group" = 'G2', gates = '{"osce": true}' where id = 'sA' returning id`)).rows.length);
  check('นักศึกษาย้ายกลุ่ม/ติ๊กผ่าน OSCE ให้ตัวเองไม่ได้ (0009)', !rename.ok || rename.value === 0, rename);
  check('นักศึกษาอ่านรายชื่อเพื่อนไม่ได้', await visible(db, U.A, `select 1 from students where id = 'sB'`) === 0);
}

/* ── ④ คะแนนคาบ ───────────────────────────────────────────────────────────── */
console.log('\n④ คะแนนคาบ');
{
  const fake = await as(db, U.A, async (tx) =>
    (await tx.query(`insert into checkins (id, student_id, date, status, scores, created_at)
                     values ('cFake','sA','2026-09-13','evaluated','{"knowledge":3}','2026-09-13T01:00:00Z')`)).affectedRows);
  check('นักศึกษาสร้างคาบที่มีคะแนนไว้ล่วงหน้าไม่ได้', !fake.ok, fake);

  const bump = await as(db, U.A, async (tx) => {
    await tx.query(`update checkins set scores = '{"knowledge":3}', status = 'evaluated' where id = 'cA'`);
    return (await tx.query<{ status: string; scores: unknown }>(`select status, scores from checkins where id = 'cA'`)).rows[0];
  });
  check('นักศึกษาแก้คะแนนตัวเอง → ระบบคงค่าเดิมเงียบๆ (0017)',
    bump.ok && bump.value.status === 'pending' && bump.value.scores === null, bump);

  /* 0020 · บนตู้ปลอมผ่านมาแล้ว — ข้อนี้คือของจริง */
  const overwrite = await as(db, U.T1, async (tx) => {
    await tx.query(`update checkins set note = null, scores = '{"knowledge":3}', status = 'evaluated' where id = 'cA'`);
    return (await tx.query<{ note: string; status: string }>(`select note, status from checkins where id = 'cA'`)).rows[0];
  });
  check('อาจารย์บันทึกคะแนนแล้วโน้ตของนักศึกษาไม่หาย (0020 บน Postgres จริง)',
    overwrite.ok && overwrite.value.note === 'โน้ตของเอ' && overwrite.value.status === 'evaluated', overwrite);
}

/* ── ⑤ audit log ─────────────────────────────────────────────────────────── */
console.log('\n⑤ audit log');
{
  check('นศ. เอ อ่านแถวที่อาจารย์แก้คะแนนของ นศ. บี ไม่ได้ (0021)',
    await visible(db, U.A, `select 1 from audit where id = 'a1'`) === 0);
  check('นศ. เอ อ่านเรื่องระดับกลุ่มของอาจารย์ไม่ได้ (0021)',
    await visible(db, U.A, `select 1 from audit where id = 'a2'`) === 0);
  check('นศ. เอ ยังอ่านเรื่องที่เกี่ยวกับตัวเองได้ (สิทธิ์ตาม PDPA)',
    await visible(db, U.A, `select 1 from audit where id = 'a3'`) === 1);
  check('อ. ที่ปรึกษากลุ่ม G1 เห็นเรื่องของ นศ. บี',
    await visible(db, U.T1, `select 1 from audit where id = 'a1'`) === 1);
  check('อ. กลุ่ม G2 ไม่เห็นเรื่องของกลุ่ม G1 (ตามที่ภาคเคาะไว้ใน 0005)',
    await visible(db, U.T2, `select 1 from audit where id in ('a1','a2')`) === 0);
  check('หัวหน้าภาคเห็นทั้งหมด', await visible(db, U.HEAD, `select 1 from audit`) === 3);

  /* กันสองชั้น: ไม่มีกฎ UPDATE/DELETE บน audit เลย RLS จึงกรองแถวทิ้งก่อน (0 แถว ไม่มี error)
     และถ้าวันหน้ามีคนเผลอเพิ่มกฎ trigger audit_no_change (0009) จะ raise อีกชั้น
     ⚠️ ครั้งแรกเขียนข้อนี้ให้คาดหวัง error แล้วตก — ของจริงคือ "ไม่มีแถวไหนเปลี่ยน" ซึ่งปลอดภัยเท่ากัน
        จึงตรวจที่ผล (ข้อความยังเหมือนเดิม) ไม่ใช่ที่รูปแบบของการปฏิเสธ */
  const tamper = await as(db, U.HEAD, async (tx) => {
    const upd = await tx.query(`update audit set text = 'แก้ประวัติ' where id = 'a1'`).then((r) => r.affectedRows ?? 0, () => 0);
    const del = await tx.query(`delete from audit where id = 'a1'`).then((r) => r.affectedRows ?? 0, () => 0);
    const row = (await tx.query<{ text: string }>(`select text from audit where id = 'a1'`)).rows[0];
    return { upd, del, text: row?.text };
  });
  check('แม้หัวหน้าภาคก็แก้หรือลบ audit ไม่ได้',
    tamper.ok && tamper.value.upd === 0 && tamper.value.del === 0 && tamper.value.text?.startsWith('แก้คะแนนคาบ'), tamper);

  /* ชั้นที่สอง: ข้าม RLS ด้วยสิทธิ์เจ้าของตาราง (เหมือนมีคนเผลอเพิ่มกฎ) — trigger ต้องยังกันอยู่ */
  const ownerTamper = await db.query(`update audit set text = 'แก้ประวัติ' where id = 'a1'`).then(() => 'แก้ได้', (e: Error) => e.message);
  check('ต่อให้ข้ามกฎ RLS ไปได้ trigger ยังห้ามแก้ audit (0009)', ownerTamper !== 'แก้ได้', ownerTamper);

  const forge = await as(db, U.A, async (tx) => {
    await tx.query(`insert into audit (id, text, at_when, student_id, kind, detail, actor_uid)
                    values ('aF','ปลอม','2026-09-13','sA','export','{"rows":999}', '${U.HEAD.uid}')`);
    return (await tx.query<{ kind: string; actor_uid: string }>(`select kind, actor_uid from audit where id = 'aF'`)).rows[0];
  });
  check('นักศึกษาปลอมผู้กระทำ/ประเภทรายการใน audit ไม่ได้',
    forge.ok && forge.value.kind === null && forge.value.actor_uid === U.A.uid, forge);
}

/* ── ⑥ รูปงาน ───────────────────────────────────────────────────────────── */
console.log('\n⑥ รูปงาน');
{
  const point = await as(db, U.A, async (tx) =>
    (await tx.query(`insert into photos (id, workpiece_id, created_at, storage_path)
                     values ('phEvil','wA','2026-09-13','sB/PT-XXXX/wB/ph-b1.jpg')`)).affectedRows);
  check('นศ. เอ ชี้แถวรูปไปที่ไฟล์ของ นศ. บี ไม่ได้ (0021)', !point.ok, point);

  const own = await as(db, U.A, async (tx) =>
    (await tx.query(`insert into photos (id, workpiece_id, created_at, storage_path)
                     values ('phOk','wA','2026-09-13','sA/PT-YYYY/wA/ph-a1.jpg')`)).affectedRows);
  check('รูปของตัวเองในโฟลเดอร์ตัวเองบันทึกได้ปกติ', own.ok, own);

  check('นศ. เอ มองไม่เห็นไฟล์ในโฟลเดอร์ของ นศ. บี',
    await visible(db, U.A, `select 1 from storage.objects where name like 'sB/%'`) === 0);
  const del = await as(db, U.A, async (tx) =>
    (await tx.query(`delete from storage.objects where name like 'sB/%' returning id`)).rows.length);
  check('นศ. เอ ลบไฟล์ของ นศ. บี ตรงๆ ไม่ได้', !del.ok || del.value === 0, del);
}

/* ── ⑦ ฟังก์ชันที่มีอำนาจ ──────────────────────────────────────────────────── */
console.log('\n⑦ ฟังก์ชันที่มีอำนาจ');
{
  const anonPurge = await as(db, 'anon', async (tx) => (await tx.query(`select purge_expired_cohorts('ลบถาวร')`)).rows);
  check('คนไม่ได้ล็อกอินเรียกตัวลบข้อมูลไม่ได้', !anonPurge.ok, anonPurge);
  const anonList = await as(db, 'anon', async (tx) => (await tx.query(`select * from expired_student_ids()`)).rows);
  check('คนไม่ได้ล็อกอินขอรายชื่อนักศึกษาที่ครบกำหนดลบไม่ได้ (0021)', !anonList.ok, anonList);
  const teacherPurge = await as(db, U.T1, async (tx) => (await tx.query(`select purge_expired_cohorts('ลบถาวร')`)).rows);
  check('อาจารย์ที่ไม่ใช่หัวหน้าภาคเรียกตัวลบข้อมูลไม่ได้', !teacherPurge.ok, teacherPurge);
  const policy = await as(db, U.T1, async (tx) =>
    (await tx.query(`update pdpa_policy set export_roles = '{teacher}', export_identified_roles = '{teacher}' where id = 'app' returning id`)).rows.length);
  check('อาจารย์ที่ไม่ใช่หัวหน้าภาคเปิดสิทธิ์ส่งออกพร้อมชื่อให้ตัวเองไม่ได้', !policy.ok || policy.value === 0, policy);
  const rlsHelper = await as(db, U.A, async (tx) => (await tx.query(`select is_teacher(), my_student_id()`)).rows[0]);
  check('ผู้ใช้ที่ล็อกอินยังเรียกตัวช่วยของกฎได้ (ถ้าไม่ได้ ทุกคำขอจะพัง)', rlsHelper.ok, rlsHelper);
}

/* ── ⑧ บัญชีทดสอบที่ migration ใส่ไว้ ─────────────────────────────────────── */
console.log('\n⑧ บัญชีทดสอบ @example.com');
{
  /* 0003/0005 ใส่บัญชี @example.com ที่มีสิทธิ์อาจารย์/หัวหน้าภาคไว้ · 0027 ลบทั้งรายชื่อเชิญและบัญชีล็อกอิน
     เดิมข้อนี้เป็นแค่การพิมพ์เตือน (ลบบัญชีบนเซิร์ฟเวอร์จริงต้องให้คนตัดสิน) — ตอนนี้ migration จัดการแล้ว
     จึงเป็น check จริง: ถ้าใครรัน 0003 ซ้ำแล้ว 0027 ไม่ได้ลบทับ ข้อนี้ต้องตก */
  const leftovers = (await db.query(`select 1 from invites where email ilike '%@example.com'`)).rows.length;
  check('ไม่มีรายชื่อเชิญ @example.com เหลืออยู่หลัง 0027', leftovers === 0, leftovers);
  const claim = await signUp(db, 'demo@example.com');
  check('สมัคร demo@example.com ไม่ได้อีกแล้ว (ไม่อยู่ในรายชื่อเชิญ)', !claim.uid, claim.error ?? 'สมัครได้!');
  const users = (await db.query(`select 1 from auth.users where email ilike '%@example.com'`)).rows.length;
  check('ไม่มีบัญชีล็อกอิน @example.com เหลืออยู่', users === 0, users);

  /* SQL ตั้งเจ้าของระบบเป็นหัวหน้าภาค — ผู้ใช้รันเองด้วยอีเมลจริง (ไม่อยู่ใน repo เพราะ repo เป็น public)
     ตัวนี้ก๊อปรูปเดียวกับที่ส่งให้ผู้ใช้ ใส่อีเมลสมมติ · ต้องได้ผลทั้งแบบ "สมัครก่อน" และ "สมัครทีหลัง" */
  const ownerSql = (email: string) => `
    insert into invites (email, role, student_id, teacher_id, is_admin) values
      ('${email}', 'student', 'st-TH-PT7-1', 'tc-TH-PT7-1', true)
    on conflict (email) do update
      set role = excluded.role, student_id = excluded.student_id,
          teacher_id = excluded.teacher_id, is_admin = true;
    update app_users
       set role = 'student', student_id = 'st-TH-PT7-1', teacher_id = 'tc-TH-PT7-1', is_admin = true
     where lower(email) = '${email}';`;
  await db.exec(ownerSql('owner-after@test.local'));
  const after = await signUp(db, 'owner-after@test.local');
  const afterRole = after.uid ? await as(db, { uid: after.uid }, async (tx) => (await tx.query<{ r: string }>(`select my_role() as r`)).rows[0].r) : null;
  check('เจ้าของระบบ (สมัครหลังรัน SQL) ได้สิทธิ์หัวหน้าภาค', !!(afterRole && afterRole.ok && afterRole.value === 'admin'), afterRole ?? after.error);

  await db.exec(`insert into invites (email, role, student_id) values ('owner-before@test.local', 'student', 'sA')`);
  const before = await signUp(db, 'owner-before@test.local');
  await db.exec(ownerSql('owner-before@test.local'));
  const beforeRole = before.uid ? await as(db, { uid: before.uid }, async (tx) => (await tx.query<{ r: string; t: string | null }>(`select my_role() as r, my_teacher_id() as t`)).rows[0]) : null;
  check('เจ้าของระบบ (สมัครไว้ก่อนแล้ว) ได้สิทธิ์หัวหน้าภาค + สลับเป็นอาจารย์ได้',
    !!(beforeRole && beforeRole.ok && beforeRole.value.r === 'admin' && beforeRole.value.t === 'tc-TH-PT7-1'), beforeRole ?? before.error);
  const ownerSees = before.uid ? await visible(db, { uid: before.uid }, `select 1 from patients`) : -1;
  check('หัวหน้าภาคเห็นผู้ป่วยทุกคน', ownerSees === 2, ownerSees);
  await db.exec(`delete from auth.users where email like 'owner-%@test.local'; delete from invites where email like 'owner-%@test.local'`);
}

/* ── ⑨ ก่อนรัน 0021 ช่องพวกนี้เปิดอยู่จริง (พิสูจน์ว่าเทสต์ไม่ได้ผ่านลอยๆ) ──── */
console.log('\n⑨ สภาพเซิร์ฟเวอร์ก่อนรัน 0021');
{
  const fake = mkdtempSync(join(tmpdir(), 'rls-before-'));
  mkdirSync(join(fake, 'supabase/migrations'), { recursive: true });
  for (const f of readdirSync(join(root, 'supabase/migrations')).filter((f) => /^\d{4}_/.test(f) && f < '0021')) {
    copyFileSync(join(root, 'supabase/migrations', f), join(fake, 'supabase/migrations', f));
  }
  const before = await freshDatabase(fake);
  const B = await seed(before.db);
  check('ก่อน 0021: นศ. เอ อ่านแถวแก้คะแนนของ นศ. บี ได้ (ช่องที่รายงานมีจริง)',
    await visible(before.db, B.A, `select 1 from audit where id = 'a1'`) === 1);
  const pointBefore = await as(before.db, B.A, async (tx) =>
    (await tx.query(`insert into photos (id, workpiece_id, created_at, storage_path)
                     values ('phEvil','wA','2026-09-13','sB/PT-XXXX/wB/ph-b1.jpg')`)).affectedRows);
  check('ก่อน 0021: นศ. เอ ชี้แถวรูปไปไฟล์ของ นศ. บี ได้ (ช่องที่รายงานมีจริง)', pointBefore.ok, pointBefore);
  const anonBefore = await as(before.db, 'anon', async (tx) => (await tx.query(`select * from expired_student_ids()`)).rows);
  check('ก่อน 0021: คนไม่ได้ล็อกอินเรียกฟังก์ชันได้ (ช่องที่รายงานมีจริง)', anonBefore.ok, anonBefore);
  await before.db.close();
}

/* ── ⑩ ตัวลบข้อมูลตัวอย่างบนเซิร์ฟเวอร์ ลบเฉพาะของปลอม ─────────────────────
   ไฟล์ลบถาวรที่ผู้ใช้จะเอาไปรันบนเซิร์ฟเวอร์จริง — ต้องพิสูจน์ก่อนว่าไม่แตะของจริงสักแถว
   ของปลอม: รูปแบบที่ seed.ts สร้าง · ของจริง: รูปแบบที่ importRoster (repo.ts) สร้าง */
console.log('\n⑩ ตัวลบข้อมูลตัวอย่างบนเซิร์ฟเวอร์');
{
  const { readFileSync } = await import('node:fs');
  await db.exec(`
    -- ของปลอม (ลอกรูปแบบจาก buildPeople / buildCases ใน seed.ts)
    insert into teachers (id, name) values ('tc-TH7-PT1-1', 'อ. ก.'), ('tc-TH7-PT1-2', 'อ. ข.');
    insert into groups (code, advisor_ids, student_ids) values ('TH7-PT1', array['tc-TH7-PT1-1','tc-TH7-PT1-2'], array['st-TH7-PT1-1','st-TH7-PT1-2']);
    insert into students (id, code, name, "group", year, entry_year) values
      ('st-TH7-PT1-1', '6304001', 'นศ. ก', 'TH7-PT1', 6, 2567),
      ('st-TH7-PT1-2', '6304002', 'นศ. ข', 'TH7-PT1', 6, 2567);
    insert into patients (id, name, hn, owner_student_id) values
      ('st-TH7-PT1-1-p0', 'ผู้ป่วย ก', 'DEMO-5449', 'st-TH7-PT1-1');
    insert into workpieces (id, patient_id, student_id, type, accepted_date, last_updated_at) values
      ('st-TH7-PT1-1-w0', 'st-TH7-PT1-1-p0', 'st-TH7-PT1-1', 'CD', '2025-06-03', '2026-01-01');
    insert into updates (id, workpiece_id, proc_index, progression, performed_at, created_at) values
      ('u-demo', 'st-TH7-PT1-1-w0', 1, 1, '2025-07-01', '2025-07-01');
    insert into checkins (id, student_id, date, created_at) values ('ci-demo', 'st-TH7-PT1-1', '2025-07-01', '2025-07-01');

    -- ของจริง (รูปแบบของ importRoster: st-<กลุ่ม>-<รหัส 7 หลัก>) — ห้ามหาย
    insert into students (id, code, name, "group", year, entry_year) values
      ('st-TH-PT9-6604048', '6604048', 'นศ. จริง', 'TH-PT9', 5, 2569);
    insert into groups (code, advisor_ids, student_ids) values ('TH-PT9', array['t1'], array['st-TH-PT9-6604048']);
    insert into patients (id, name, hn, owner_student_id) values ('p-real', 'ผู้ป่วยจริง', 'HN-12345', 'st-TH-PT9-6604048');
    insert into workpieces (id, patient_id, student_id, type, accepted_date, last_updated_at) values
      ('w-real', 'p-real', 'st-TH-PT9-6604048', 'RPD', '2026-06-03', '2026-09-01');
    insert into checkins (id, student_id, date, created_at) values ('ci-real', 'st-TH-PT9-6604048', '2026-09-12', '2026-09-12');
  `);

  const check1 = await db.query<Record<string, unknown>>(readFileSync(join(root, 'supabase/check-demo-rows.sql'), 'utf8'));
  const row = (name: string) => check1.rows.find((r) => r['ตาราง'] === name) as Record<string, number> | undefined;
  check('ไฟล์ตรวจนับนักศึกษาตัวอย่างถูก (2 ของปลอม)', Number(row('นักศึกษา')?.['ข้อมูลตัวอย่าง']) === 2, row('นักศึกษา'));
  check('ไฟล์ตรวจนับผู้ป่วยตัวอย่างถูก', Number(row('ผู้ป่วย')?.['ข้อมูลตัวอย่าง']) === 1, row('ผู้ป่วย'));

  const beforeReal = {
    students: (await db.query(`select 1 from students where id !~ '^st-.+-[1-8]$'`)).rows.length,
    patients: (await db.query(`select 1 from patients where hn not like 'DEMO-%'`)).rows.length,
    works: (await db.query(`select 1 from workpieces where id in ('wA','wB','w-real')`)).rows.length,
    invites: (await db.query(`select 1 from invites`)).rows.length,
  };

  const removeSql = readFileSync(join(root, 'supabase/remove-demo-rows.sql'), 'utf8');
  let removeErr = '';
  try {
    await db.exec('begin;\n' + removeSql + '\ncommit;');
  } catch (e) {
    removeErr = (e as Error).message;
    await db.exec('rollback;').catch(() => {});
  }
  check('ไฟล์ลบรันผ่านบน Postgres จริง', removeErr === '', removeErr);

  const left = async (sql: string) => (await db.query(sql)).rows.length;
  check('นักศึกษาตัวอย่างหายหมด', await left(`select 1 from students where id ~ '^st-.+-[1-8]$'`) === 0);
  check('ผู้ป่วย HN DEMO- หายหมด', await left(`select 1 from patients where hn like 'DEMO-%'`) === 0);
  check('ชิ้นงาน/step/คาบของตัวอย่างหายหมด',
    await left(`select 1 from workpieces where id = 'st-TH7-PT1-1-w0'`) + await left(`select 1 from updates where id = 'u-demo'`)
      + await left(`select 1 from checkins where id = 'ci-demo'`) === 0);
  check('กลุ่มตัวอย่างที่ไม่เหลือใครหาย', await left(`select 1 from groups where code = 'TH7-PT1'`) === 0);
  check('อาจารย์ตัวอย่างที่ไม่มีใครอ้างถึงหาย', await left(`select 1 from teachers where id like 'tc-TH7-PT1-%'`) === 0);

  const afterReal = {
    students: await left(`select 1 from students where id !~ '^st-.+-[1-8]$'`),
    patients: await left(`select 1 from patients where hn not like 'DEMO-%'`),
    works: await left(`select 1 from workpieces where id in ('wA','wB','w-real')`),
    invites: await left(`select 1 from invites`),
  };
  check('ของจริงไม่หายสักแถว (นักศึกษา/ผู้ป่วย/ชิ้นงาน/รายชื่อเชิญ)',
    JSON.stringify(beforeReal) === JSON.stringify(afterReal), { beforeReal, afterReal });
  check('นักศึกษารูปแบบของจริงยังอยู่พร้อมคาบ',
    await left(`select 1 from students where id = 'st-TH-PT9-6604048'`) === 1 && await left(`select 1 from checkins where id = 'ci-real'`) === 1);
}

/* ── ⑪ นักศึกษาผูกบัญชีเอง + อาจารย์ยืนยัน (0023) ─────────────────────────────
   ด่านที่ต้องแน่นที่สุด: บัญชีที่ยังไม่ผูกต้องเห็นอะไรไม่ได้เลย · ใส่รหัสเพื่อนแล้วต้องไม่ได้สิทธิ์ของเพื่อน
   · อาจารย์กลุ่มอื่นยืนยันแทนไม่ได้ · นักศึกษายืนยันตัวเองไม่ได้ */
console.log('\n⑪ ผูกบัญชีเองด้วยรหัสนักศึกษา (0023)');
{
  await db.exec(`insert into students (id, code, name, "group", year, entry_year) values ('sD', '6504004', 'นศ. ดี', 'G1', 5, 2569)`);
  await db.exec(`insert into patients (id, name, hn, owner_student_id) values ('pD', 'ผู้ป่วยของดี', 'HN-D', 'sD')`);

  const other = await signUp(db, 'someone@gmail.com');
  check('อีเมลนอกมหาลัยที่ไม่ได้รับเชิญ ยังสร้างบัญชีไม่ได้', !other.uid, other.error ?? 'สร้างได้!');

  const dee = await signUp(db, 'dee.real@student.mahidol.edu');
  check('อีเมล @student.mahidol.edu สร้างบัญชีได้ (ยังไม่ผูก)', !!dee.uid, dee.error);
  const D = { uid: dee.uid! };
  const bad = await signUp(db, 'mallory@student.mahidol.edu');
  const M = { uid: bad.uid! };

  const seen = {
    patients: await visible(db, D, `select 1 from patients`),
    students: await visible(db, D, `select 1 from students`),
    audit: await visible(db, D, `select 1 from audit`),
    invites: await visible(db, D, `select 1 from invites`),
    requests: await visible(db, D, `select 1 from link_requests`),
  };
  check('บัญชีที่ยังไม่ผูก เห็นอะไรไม่ได้เลย', Object.values(seen).every((n) => n <= 0), seen);

  const selfLink = await as(db, D, async (tx) =>
    (await tx.query(`insert into app_users (uid, email, role, student_id) values (auth.uid(), 'x', 'student', 'sA') returning uid`)).rows.length);
  check('บัญชีที่ยังไม่ผูก เขียนแถว app_users ให้ตัวเองไม่ได้', !selfLink.ok || selfLink.value === 0, selfLink);

  const wrong = await as(db, D, async (tx) => (await tx.query(`select request_link('9999999')`)).rows);
  check('ใส่รหัสที่ไม่มี → ปฏิเสธพร้อมข้อความ', !wrong.ok && /ไม่พบรหัส/.test(wrong.error), wrong);
  const taken = await as(db, D, async (tx) => (await tx.query(`select request_link('6504001')`)).rows);
  check('ขอผูกรหัสที่มีบัญชีอยู่แล้ว (นศ. เอ) ไม่ได้', !taken.ok && /ผูกไว้แล้ว/.test(taken.error), taken);

  const anonReq = await as(db, 'anon', async (tx) => (await tx.query(`select request_link('6504004')`)).rows);
  check('คนไม่ได้ล็อกอินส่งคำขอไม่ได้', !anonReq.ok, anonReq);
  const linkedReq = await as(db, U.A, async (tx) => (await tx.query(`select request_link('6504004')`)).rows);
  check('บัญชีที่ผูกแล้วส่งคำขอผูกคนอื่นไม่ได้', !linkedReq.ok, linkedReq);

  // เจ้าตัวกับคนแอบอ้างขอผูกรหัสเดียวกัน
  (await db.exec(`select set_config('request.jwt.claim.sub', '', false)`));
  const mine = await (async () => {
    await db.exec(`set role authenticated`);
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [D.uid]);
      const r = (await db.query<{ j: { student_name: string } }>(`select request_link(' 6504004 ') as j`)).rows[0].j;
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [M.uid]);
      await db.query(`select request_link('6504004')`);
      return r;
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
    }
  })();
  check('ส่งคำขอสำเร็จ และได้ชื่อกลับมาให้ตรวจ (ตัดช่องว่างให้)', mine.student_name === 'นศ. ดี', mine);

  const stillBlind = await visible(db, D, `select 1 from patients`);
  check('ส่งคำขอแล้วแต่ยังไม่ยืนยัน → ยังไม่เห็นผู้ป่วย', stillBlind <= 0, stillBlind);

  const reqs = await db.query<{ id: string; uid: string }>(`select id, uid from link_requests where student_id = 'sD'`);
  const deeReq = reqs.rows.find((r) => r.uid === D.uid)!.id;
  const malReq = reqs.rows.find((r) => r.uid === M.uid)!.id;

  const listT2 = await as(db, U.T2, async (tx) => (await tx.query(`select * from pending_link_requests()`)).rows.length);
  check('อาจารย์กลุ่มอื่น (G2) ไม่เห็นคำขอของกลุ่ม G1', listT2.ok && listT2.value === 0, listT2);
  const listT1 = await as(db, U.T1, async (tx) => (await tx.query<{ same_student: number }>(`select * from pending_link_requests()`)).rows);
  check('อาจารย์ที่ปรึกษา G1 เห็นทั้งสองคำขอ และเห็นว่าขอคนเดียวกัน 2 บัญชี',
    listT1.ok && listT1.value.length === 2 && listT1.value.every((r) => r.same_student === 2), listT1);
  const listStudent = await as(db, U.A, async (tx) => (await tx.query(`select * from pending_link_requests()`)).rows.length);
  check('นักศึกษาเห็นรายการรอยืนยันไม่ได้', listStudent.ok && listStudent.value === 0, listStudent);

  const t2Approve = await as(db, U.T2, async (tx) => (await tx.query(`select decide_link($1, true)`, [malReq])).rows);
  check('อาจารย์กลุ่มอื่นยืนยันแทนไม่ได้', !t2Approve.ok, t2Approve);
  const selfApprove = await as(db, M, async (tx) => (await tx.query(`select decide_link($1, true)`, [malReq])).rows);
  check('คนขอยืนยันคำขอตัวเองไม่ได้', !selfApprove.ok, selfApprove);
  const studentApprove = await as(db, U.B, async (tx) => (await tx.query(`select decide_link($1, true)`, [malReq])).rows);
  check('นักศึกษาในกลุ่มเดียวกันยืนยันให้ไม่ได้', !studentApprove.ok, studentApprove);
  const direct = await as(db, M, async (tx) =>
    (await tx.query(`update link_requests set status = 'approved' where uid = auth.uid() returning id`)).rows.length);
  check('แก้สถานะคำขอตรงๆ ไม่ได้', !direct.ok || direct.value === 0, direct);

  // ยืนยันจริงต้องทำใน transaction ที่ commit — ใช้ role จริง
  await db.exec(`set role authenticated`);
  let approveErr = '';
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U.T1.uid]);
    await db.query(`select decide_link($1, true)`, [deeReq]);
  } catch (e) {
    approveErr = (e as Error).message;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  }
  check('อาจารย์ที่ปรึกษายืนยันได้', approveErr === '', approveErr);

  const deeRole = await as(db, D, async (tx) => (await tx.query<{ s: string }>(`select my_student_id() as s`)).rows[0].s);
  check('ยืนยันแล้ว: บัญชีผูกกับ นศ. ดี', deeRole.ok && deeRole.value === 'sD', deeRole);
  const deeSees = await visible(db, D, `select 1 from patients`);
  check('ยืนยันแล้ว: เห็นผู้ป่วยของตัวเองคนเดียว', deeSees === 1, deeSees);
  const deeTeacher = await as(db, D, async (tx) => (await tx.query<{ t: boolean }>(`select is_teacher() as t`)).rows[0].t);
  check('ยืนยันแล้วเป็นแค่นักศึกษา ไม่ได้สิทธิ์อาจารย์', deeTeacher.ok && deeTeacher.value === false, deeTeacher);
  const malStatus = await db.query<{ status: string }>(`select status from link_requests where id = $1`, [malReq]);
  check('คำขอของคนแอบอ้างที่ขอคนเดียวกัน ถูกปฏิเสธให้อัตโนมัติ', malStatus.rows[0]?.status === 'rejected', malStatus.rows);
  const malSees = await visible(db, M, `select 1 from patients`);
  check('คนแอบอ้างยังเห็นอะไรไม่ได้', malSees <= 0, malSees);
  const inv = await db.query<{ student_id: string }>(`select student_id from invites where email = 'dee.real@student.mahidol.edu'`);
  check('ยืนยันแล้วเพิ่มในรายชื่อเชิญให้ด้วย (สร้างบัญชีใหม่ครั้งหน้าผูกเอง)', inv.rows[0]?.student_id === 'sD', inv.rows);
  const trail = await db.query<{ who: string; text: string }>(`select who, text from audit where id like 'a-link-%'`);
  check('จด audit ว่าใครยืนยันใคร', trail.rows.length === 1 && trail.rows[0].who === 'อ. หนึ่ง' && trail.rows[0].text.includes('นศ. ดี'), trail.rows);

  const again = await as(db, U.T1, async (tx) => (await tx.query(`select decide_link($1, true)`, [malReq])).rows);
  check('ยืนยันคำขอที่ถูกปฏิเสธไปแล้วซ้ำไม่ได้', !again.ok, again);
}

/* ── ⑫ อาจารย์เลือกกลุ่มที่ปรึกษาเอง · หัวหน้าภาคแก้ได้ (0024) ────────────────── */
console.log('\n⑫ กลุ่มที่ปรึกษา (0024)');
{
  /** รันแล้ว commit จริง (ข้อต่อไปต้องเห็นผล) — คืน error ถ้าล้ม */
  const commitAs = async (who: { uid: string }, sql: string, params: unknown[] = []) => {
    await db.exec(`set role authenticated`);
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who.uid]);
      return { ok: true as const, rows: (await db.query(sql, params)).rows };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
    }
  };
  const slots = async () => {
    const g = await db.query<{ a: string[] }>(`select advisor_ids as a from groups where code = 'G3'`);
    const s = await db.query<{ a: string[] }>(`select distinct advisor_ids as a from students where "group" = 'G3'`);
    return { groups: g.rows[0]?.a, students: s.rows.map((r) => r.a) };
  };
  await db.exec(`
    insert into groups (code, advisor_ids, student_ids) values ('G3', array['',''], array['sE']);
    insert into students (id, code, name, "group", year, entry_year, advisor_ids) values ('sE', '6604005', 'นศ. อี', 'G3', 5, 2570, array['','']);
  `);

  const byStudent = await commitAs(U.A, `select claim_group('G3')`);
  check('นักศึกษาเลือกเป็นที่ปรึกษาไม่ได้', !byStudent.ok, byStudent);
  const byAnon = await as(db, 'anon', async (tx) => (await tx.query(`select claim_group('G3')`)).rows);
  check('คนไม่ได้ล็อกอินเรียกไม่ได้', !byAnon.ok, byAnon);
  const direct = await commitAs(U.T1, `select write_group_advisors('G3', array['t1',''], 'x')`);
  check('เรียกตัวเขียนภายในตรงๆ ไม่ได้ (ข้ามการตรวจ)', !direct.ok, direct);

  const t2 = await commitAs(U.T2, `select claim_group('G3')`);
  check('อาจารย์เลือกกลุ่มที่ว่างได้', t2.ok, t2);
  let now = await slots();
  check('ลงทั้ง groups และ students ตรงกัน', JSON.stringify(now.groups) === '["t2",""]' && JSON.stringify(now.students) === '[["t2",""]]', now);
  const again = await commitAs(U.T2, `select claim_group('G3')`);
  check('เลือกซ้ำไม่ลงสองช่อง', again.ok && JSON.stringify((await slots()).groups) === '["t2",""]', await slots());

  const decide = await as(db, U.T2, async (tx) => (await tx.query<{ ok: boolean }>(`select can_decide_link('sE') as ok`)).rows[0].ok);
  check('เลือกแล้วยืนยันบัญชีนักศึกษาในกลุ่มนั้นได้ (0023)', decide.ok && decide.value === true, decide);

  const t1 = await commitAs(U.T1, `select claim_group('G3')`);
  check('ท่านที่สองลงต่อท้ายได้', t1.ok && JSON.stringify((await slots()).groups) === '["t2","t1"]', await slots());
  const third = await commitAs(U.HEAD, `select claim_group('G3')`);
  check('ท่านที่สามก็เลือกได้ (กลุ่มหนึ่งมีที่ปรึกษากี่ท่านก็ได้ · ผู้ใช้ยืนยัน)', third.ok && JSON.stringify((await slots()).groups) === '["t2","t1","tadmin"]', third.ok ? await slots() : third);

  // อ. หนึ่ง ดูแลทั้ง G1 และ G3 — ต้องเห็นเรื่องของทั้งสองกลุ่ม ไม่ใช่แค่กลุ่มแรก
  await db.exec(`insert into audit (id, text, at_when, student_id, group_code) values
    ('a-g3-student', 'เรื่องของ นศ. อี', '2026-09-14T05:00:00', 'sE', null),
    ('a-g3-group', 'ประกาศของกลุ่ม G3', '2026-09-14T05:00:00', null, 'G3')`);
  const multi = await as(db, U.T1, async (tx) => (await tx.query<{ id: string }>(`select id from audit where id in ('a1', 'a2', 'a-g3-student', 'a-g3-group') order by id`)).rows.map((r) => r.id));
  check('อาจารย์ที่ดูแลสองกลุ่ม เห็น audit ของทั้งสองกลุ่ม', multi.ok && JSON.stringify(multi.value) === '["a-g3-group","a-g3-student","a1","a2"]', multi);
  const outsider = await as(db, U.C, async (tx) => (await tx.query(`select id from audit where id in ('a-g3-student', 'a-g3-group')`)).rows.length);
  check('นักศึกษากลุ่มอื่นยังไม่เห็นเรื่องของ G3', outsider.ok && outsider.value === 0, outsider);
  const mineAll = await as(db, U.T1, async (tx) => (await tx.query<{ g: string[] }>(`select my_advised_groups() as g`)).rows[0].g.sort());
  // (อ. หนึ่ง ดูแลกลุ่มจากข้อ ⑩ ด้วย — ตรวจแค่ว่าครบทั้งสองกลุ่มที่ตั้งใจ)
  check('my_advised_groups คืนทุกกลุ่มที่ดูแล', mineAll.ok && mineAll.value.includes('G1') && mineAll.value.includes('G3'), mineAll);

  const rel = await commitAs(U.T2, `select release_group('G3')`);
  now = await slots();
  check('ถอนตัวได้ และลงทั้งสองที่', rel.ok && JSON.stringify(now.groups) === '["t1","tadmin"]' && JSON.stringify(now.students) === '[["t1","tadmin"]]', now);

  const notAdmin = await commitAs(U.T1, `select set_group_advisors('G3', array['t2'])`);
  check('อาจารย์ทั่วไปตั้งที่ปรึกษาให้คนอื่นไม่ได้', !notAdmin.ok, notAdmin);
  const dedupe = await commitAs(U.HEAD, `select set_group_advisors('G3', array['t1','t1','t2'])`);
  check('หัวหน้าภาคตั้งได้ · ชื่อซ้ำถูกรวม', dedupe.ok && JSON.stringify((await slots()).groups) === '["t1","t2"]', await slots());
  const three = await commitAs(U.HEAD, `select set_group_advisors('G3', array['t1','t2','tadmin'])`);
  check('หัวหน้าภาคตั้ง 3 ท่านได้', three.ok && JSON.stringify((await slots()).groups) === '["t1","t2","tadmin"]', three.ok ? await slots() : three);
  const ghost = await commitAs(U.HEAD, `select set_group_advisors('G3', array['nobody'])`);
  check('รหัสอาจารย์ที่ไม่มีอยู่ตั้งไม่ได้', !ghost.ok, ghost);
  const clear = await commitAs(U.HEAD, `select set_group_advisors('G3', array[]::text[])`);
  check('ล้างที่ปรึกษาได้ (กลับเป็นช่องว่าง 2 ช่อง)', clear.ok && JSON.stringify((await slots()).groups) === '["",""]', await slots());

  // ── ขึ้นปีการศึกษาใหม่ = ล้าง (ผู้ใช้เคาะ 14 ก.ย. 69 · วันที่ยังไม่เคาะ ใช้ 1 มิ.ย.) ──
  const y = (await db.query<{ y: number }>(`select current_academic_year() as y`)).rows[0].y;
  const expect = new Date().getMonth() >= 5 ? new Date().getFullYear() + 543 : new Date().getFullYear() + 542;
  check('current_academic_year ตรงกับ academicYear() ของแอป', y === expect, { sql: y, app: expect });

  const viaSync = await commitAs(U.T1, `update groups set advisor_ids = array['t2', ''] where code = 'G3' returning advisor_year`);
  check('แก้ที่ปรึกษาทางอื่น (เช่นนำเข้าชีตที่ sync ขึ้นมา) ถูกประทับปีให้เอง', viaSync.ok && (viaSync.rows[0] as { advisor_year: number }).advisor_year === y, viaSync);
  await db.exec(`update groups set advisor_year = ${y - 1} where code = 'G3'`);   // จำลองว่าเป็นของปีก่อน
  const staleMine = await as(db, U.T2, async (tx) => (await tx.query<{ g: string[]; d: boolean; c: string[] }>(
    `select my_advised_groups() as g, can_decide_link('sE') as d, current_advisors('G3') as c`)).rows[0]);
  check('ที่ปรึกษาของปีก่อน: ไม่นับเป็นกลุ่มของฉัน · ยืนยันบัญชีไม่ได้', staleMine.ok && !staleMine.value.g.includes('G3') && staleMine.value.d === false && staleMine.value.c.length === 0, staleMine);
  const staleAudit = await as(db, U.T2, async (tx) => (await tx.query(`select id from audit where id = 'a-g3-group'`)).rows.length);
  check('ที่ปรึกษาของปีก่อน: ไม่เห็น audit ของกลุ่มนั้นแล้ว', staleAudit.ok && staleAudit.value === 0, staleAudit);

  const byStudentReset = await commitAs(U.A, `select reset_advisors_for_new_year() as n`);
  check('นักศึกษาสั่งล้างไม่ได้ (ไม่มีผล)', byStudentReset.ok && (byStudentReset.rows[0] as { n: number }).n === 0 && JSON.stringify((await slots()).groups) === '["t2",""]', byStudentReset);
  const g1Before = (await db.query<{ a: string[] }>(`select advisor_ids as a from groups where code = 'G1'`)).rows[0].a;
  const reset = await commitAs(U.T1, `select reset_advisors_for_new_year() as n`);
  now = await slots();
  check('อาจารย์เปิดแอป → ล้างของปีก่อนทั้งสองที่', reset.ok && (reset.rows[0] as { n: number }).n === 1 && JSON.stringify(now.groups) === '["",""]' && JSON.stringify(now.students) === '[["",""]]', { reset, now });
  const g1After = (await db.query<{ a: string[] }>(`select advisor_ids as a from groups where code = 'G1'`)).rows[0].a;
  check('กลุ่มที่ตั้งในปีนี้ไม่ถูกแตะ', JSON.stringify(g1Before) === JSON.stringify(g1After), { g1Before, g1After });
  const resetAgain = await commitAs(U.T2, `select reset_advisors_for_new_year() as n`);
  const resetRows = await db.query(`select 1 from audit where id = 'a-adv-reset-' || $1`, [y]);
  check('เรียกซ้ำไม่ล้างซ้ำ · จด audit ครั้งเดียว', resetAgain.ok && (resetAgain.rows[0] as { n: number }).n === 0 && resetRows.rows.length === 1, { resetAgain, n: resetRows.rows.length });

  const trail = await db.query<{ who: string; text: string; group_code: string }>(`select who, text, group_code from audit where id like 'a-adv-%' and id not like 'a-adv-reset-%' order by at_when`);
  check('ทุกการเปลี่ยนจด audit พร้อมชื่อคนทำ', trail.rows.length === 7 && trail.rows.every((r) => r.group_code === 'G3' && r.who !== ''), trail.rows);
}

/* ── ⑬ ชื่อภาษาอังกฤษ (0025) — ช่องใหม่ต้องอยู่ใต้กฎเดิมของตาราง ─────────────── */
console.log('\n⑬ ชื่อภาษาอังกฤษ (0025)');
{
  const byTeacher = await as(db, U.T1, async (tx) =>
    (await tx.query<{ n: string }>(`update students set name_en = 'Student E' where id = 'sE' returning name_en as n`)).rows);
  check('อาจารย์ใส่ชื่ออังกฤษของนักศึกษาได้', byTeacher.ok && byTeacher.value[0]?.n === 'Student E', byTeacher);
  const bySelf = await as(db, U.A, async (tx) =>
    (await tx.query(`update students set name_en = 'Hacked' where id = my_student_id() returning 1`)).rows.length);
  check('นักศึกษาแก้ชื่ออังกฤษของตัวเองไม่ได้ (0 แถว หรือถูกปฏิเสธ)', !bySelf.ok || bySelf.value === 0, bySelf);
  const tooLong = await as(db, U.T1, async (tx) =>
    (await tx.query(`update students set name_en = repeat('a', 121) where id = 'sE'`)).rows);
  check('ชื่ออังกฤษยาวเกิน 120 ตัว เข้าไม่ได้', !tooLong.ok, tooLong);
  const teacherCol = await as(db, U.HEAD, async (tx) =>
    (await tx.query<{ n: string | null }>(`select name_en as n from teachers limit 1`)).rows);
  check('ตาราง teachers มีช่องชื่ออังกฤษ และอ่านได้', teacherCol.ok, teacherCol);
  const checker = await db.query<{ 'สถานะ': string; migration: string }>(
    (await import('node:fs')).readFileSync(new URL('../supabase/check-migrations.sql', import.meta.url), 'utf8'));
  const row = checker.rows.find((r) => r.migration.startsWith('0025'));
  check('check-migrations.sql ตอบว่า 0025 รันแล้ว', !!row && row['สถานะ'].startsWith('✓'), row);
}

/* ── เพิ่มอาจารย์: SQL (add-teacher.sql) กับแอป (แท็บอาจารย์ในแบบฟอร์ม) ต้องได้ id เดียวกัน · 15 ก.ย. 69 ── */
console.log('\nเพิ่มอาจารย์ — add-teacher.sql กับหน้ารายชื่อในแอป');
{
  const { readFileSync } = await import('node:fs');
  const { teacherIdFromEmail } = await import('../src/lib/rosterParse.ts');
  const sqlFile = readFileSync(join(root, 'supabase/add-teacher.sql'), 'utf8');
  const withRows = (rows: string) => sqlFile.replace("('name.sur@mahidol.edu', 'อ.ทพ. ชื่อ นามสกุล', 'Dr. Firstname Lastname', false)", rows);

  const raw = await db.query<{ 'ผล': string }>(sqlFile);
  check('กด Run ทั้งที่ยังเป็นค่าตัวอย่าง → ไม่บันทึก', raw.rows[0]?.['ผล'].startsWith('✗')
    && (await db.query(`select 1 from invites where email like 'name%.sur@mahidol.edu'`)).rows.length === 0, raw.rows);

  const r = await db.query<{ 'id อาจารย์': string }>(withRows("('New.Teacher@Mahidol.edu', 'อ.ทพ. ใหม่', 'Dr New', false)"));
  const jsId = await teacherIdFromEmail('new.teacher@mahidol.edu');
  check('id จาก SQL = id จากแอป (คนเดียวกันเพิ่มสองทางไม่ซ้ำ)', r.rows[0]?.['id อาจารย์'] === jsId, { sql: r.rows[0], jsId });
  await db.query(withRows("('new.teacher@mahidol.edu', 'อ.ทพ. ใหม่ แก้ชื่อ', '', false)"));
  const tr = await db.query<{ name: string; name_en: string | null }>(`select name, name_en from teachers where id = $1`, [jsId]);
  check('รันซ้ำ: แก้ชื่อไทยได้ · ชื่ออังกฤษว่างไม่ลบของเดิม · ไม่สร้างแถวซ้ำ',
    tr.rows.length === 1 && tr.rows[0].name === 'อ.ทพ. ใหม่ แก้ชื่อ' && tr.rows[0].name_en === 'Dr New', tr.rows);

  /* ทางแอป: หัวหน้ารายวิชาเขียน teachers + invites เอง (RLS จริง) · อาจารย์ทั่วไปให้สิทธิ์คนใหม่ไม่ได้ */
  const appId = await teacherIdFromEmail('app.teacher@mahidol.edu');
  const byHead = await as(db, U.HEAD, async (tx) => {
    await tx.query(`insert into teachers (id, name) values ($1, 'อ. แอป')`, [appId]);
    return (await tx.query(`insert into invites (email, role, teacher_id, is_admin) values ('app.teacher@mahidol.edu', 'teacher', $1, false) on conflict (email) do nothing returning email`, [appId])).rows.length;
  });
  check('หัวหน้ารายวิชาเพิ่มอาจารย์ + เชิญอีเมลจากแอปได้', byHead.ok && byHead.value === 1, byHead);
  const byTeacher = await as(db, U.T1, async (tx) =>
    (await tx.query(`insert into invites (email, role, teacher_id, is_admin) values ('sneak@mahidol.edu', 'teacher', 'tc-x', true) returning email`)).rows.length);
  check('อาจารย์ทั่วไปเชิญคนเข้าระบบ (และตั้งหัวหน้ารายวิชา) ไม่ได้', !byTeacher.ok || byTeacher.value === 0, byTeacher);
  // as() ย้อนกลับเสมอ — ทดสอบการผูกบัญชีกับอาจารย์ที่เพิ่มด้วย SQL ข้างบน (แถวอยู่จริง)
  const signed = await signUp(db, 'New.Teacher@mahidol.edu');
  const linked = await db.query<{ teacher_id: string; role: string }>(`select teacher_id, role from app_users where uid = $1`, [signed.uid ?? null]);
  check('อาจารย์ที่เพิ่มแล้ว กดสมัคร (อีเมลตัวใหญ่เล็กต่างกันได้) แล้วผูกเป็นอาจารย์คนนั้นทันที', linked.rows[0]?.teacher_id === jsId && linked.rows[0]?.role === 'teacher', { signed, rows: linked.rows });
}

/* ── ⑭ สวิตช์ "ใช้ชื่อผู้ป่วย" (0026) — นำร่องเก็บแค่ HN ──────────────────────── */
console.log('\n⑭ ไม่เก็บชื่อผู้ป่วย (0026)');
{
  const commit = async (who: { uid: string }, sql: string, params: unknown[] = []) => {
    await db.exec(`set role authenticated`);
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who.uid]);
      return { ok: true as const, rows: (await db.query(sql, params)).rows as Record<string, unknown>[] };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
    }
  };
  const pol = await db.query<{ v: boolean }>(`select patient_names as v from pdpa_policy where id = 'app'`);
  check('ค่าเริ่มต้น = ไม่เก็บชื่อ', pol.rows[0]?.v === false, pol.rows);

  const add = await commit(U.A, `insert into patients (id, name, hn, owner_student_id) values ('pN1', 'สมหญิง จริงจัง', 'HN-N1', 'sA') returning name, hn`);
  check('นักศึกษาเปิดเคสพร้อมชื่อ → ชื่อถูกล้างที่เซิร์ฟเวอร์ · HN อยู่ครบ',
    add.ok && add.rows[0]?.name === '' && add.rows[0]?.hn === 'HN-N1', add);
  /* จำลองชื่อที่กรอกไว้ก่อนรัน 0026 — ปิด trigger ชั่วคราวแล้วเขียนตรง (seed ของไฟล์นี้รันหลัง migration จึงไม่มีชื่อค้าง) */
  await db.exec(`alter table patients disable trigger zz_zz_strip_patient_name;
    update patients set name = 'ผู้ป่วยของเอ' where id = 'pA'; update patients set name = 'ผู้ป่วยของบี' where id = 'pB';
    alter table patients enable trigger zz_zz_strip_patient_name;`);
  const old = await db.query<{ name: string }>(`select name from patients where id = 'pA'`);
  check('ชื่อที่ค้างอยู่ไม่ถูกลบเงียบๆ จนกว่าจะมีการเขียนแถวนั้น', old.rows[0]?.name === 'ผู้ป่วยของเอ', old.rows);
  const touch = await commit(U.A, `update patients set note = 'x' where id = 'pA' returning name`);
  check('แก้แถวเดิม (แอปรุ่นเก่าส่งชื่อกลับมา) → ชื่อถูกล้างไปด้วย', touch.ok && touch.rows[0]?.name === '', touch);

  const s2 = await commit(U.T1, `insert into sect2_records (id, student_id, form_key, academic_year, class_year, patient_name, hn, by_who, at_when)
    values ('s2N', 'sA', 'removable', 2569, 5, 'สมหญิง จริงจัง', 'HN-N1', 'อ. หนึ่ง', '2026-09-15') returning patient_name, hn`);
  check('ใบ Section II ที่อาจารย์กรอกชื่อ → ชื่อถูกล้าง · HN อยู่', s2.ok && s2.rows[0]?.patient_name === null && s2.rows[0]?.hn === 'HN-N1', s2);

  const byTeacher = await commit(U.T1, `update pdpa_policy set patient_names = true where id = 'app' returning 1`);
  check('อาจารย์ที่ไม่ใช่หัวหน้ารายวิชาเปิดสวิตช์ไม่ได้', !byTeacher.ok || byTeacher.rows.length === 0, byTeacher);
  const byStudent = await commit(U.A, `update pdpa_policy set patient_names = true where id = 'app' returning 1`);
  check('นักศึกษาเปิดสวิตช์ไม่ได้', !byStudent.ok || byStudent.rows.length === 0, byStudent);

  const cleared = await db.query<{ n: number }>(`select count(*)::int as n from patients where name <> ''`);
  const script = (await import('node:fs')).readFileSync(new URL('../supabase/clear-patient-names.sql', import.meta.url), 'utf8');
  await db.query(script);
  const after = await db.query<{ n: number }>(`select count(*)::int as n from patients where name <> ''`);
  check('clear-patient-names.sql ลบชื่อที่ค้างจนเหลือ 0 (HN ไม่หาย)',
    cleared.rows[0].n > 0 && after.rows[0].n === 0 && (await db.query(`select 1 from patients where hn = 'HN-B'`)).rows.length === 1,
    { before: cleared.rows[0].n, after: after.rows[0].n });

  const on = await commit(U.HEAD, `update pdpa_policy set patient_names = true where id = 'app' returning 1`);
  check('หัวหน้ารายวิชาเปิดสวิตช์ได้', on.ok && on.rows.length === 1, on);
  const named = await commit(U.A, `update patients set name = 'สมหญิง จริงจัง' where id = 'pN1' returning name`);
  check('เปิดแล้ว → เติมชื่อได้ตามปกติ', named.ok && named.rows[0]?.name === 'สมหญิง จริงจัง', named);
  const guarded = await db.query<{ label: string }>(script);
  check('สวิตช์เปิดอยู่ → สคริปต์ลบชื่อไม่ลบอะไร',
    (await db.query(`select 1 from patients where id = 'pN1' and name = 'สมหญิง จริงจัง'`)).rows.length === 1, guarded.rows);
  await db.exec(`update pdpa_policy set patient_names = false where id = 'app'`);
}

/* ── ⑮ ปิดช่องก่อนส่งมอบ (0027) ───────────────────────────────────────────────
   ลบคาบที่ประเมินแล้ว · บัญชีที่ยังไม่ผูกอ่านข้อมูลกลางไม่ได้ · เพดาน request_link 5 ครั้ง */
console.log('\n⑮ ปิดช่องก่อนส่งมอบ (0027)');
{
  const commit = async (who: { uid: string }, sql: string, params: unknown[] = []) => {
    await db.exec(`set role authenticated`);
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who.uid]);
      return { ok: true as const, rows: (await db.query(sql, params)).rows as Record<string, unknown>[] };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
    }
  };

  // ── ลบคาบ ──
  await db.exec(`insert into checkins (id, student_id, date, created_at) values ('cEval', 'sA', '2026-09-16', '2026-09-16T02:00:00Z')`);
  const graded = await commit(U.T1, `update checkins set scores = '{"knowledge":3}', status = 'evaluated', evaluated_by = 'อ. หนึ่ง' where id = 'cEval' returning status`);
  check('เตรียมคาบที่อาจารย์ประเมินแล้ว', graded.ok && graded.rows[0]?.status === 'evaluated', graded);
  const delEval = await as(db, U.A, async (tx) => (await tx.query(`delete from checkins where id = 'cEval' returning id`)).rows.length);
  check('นักศึกษาลบคาบที่ประเมินแล้วไม่ได้ (ถูกปฏิเสธ)', !delEval.ok && /ประเมินแล้วลบไม่ได้/.test(delEval.error), delEval);
  const delPending = await as(db, U.A, async (tx) => (await tx.query(`delete from checkins where id = 'cA' returning id`)).rows.length);
  check('นักศึกษาลบคาบที่ยังไม่มีคะแนนของตัวเองได้', delPending.ok && delPending.value === 1, delPending);
  const delByTeacher = await as(db, U.T1, async (tx) => (await tx.query(`delete from checkins where id = 'cEval' returning id`)).rows.length);
  check('อาจารย์ลบคาบที่ประเมินแล้วได้ตามหน้าที่', delByTeacher.ok && delByTeacher.value === 1, delByTeacher);
  const delByServer = await db.query(`delete from checkins where id = 'cEval' returning id`).then((r) => r.rows.length, (e: Error) => e.message);
  check('คำสั่งที่ไม่มีคนล็อกอิน (SQL Editor / remove-demo-rows) ยังลบได้', delByServer === 1, delByServer);

  // ── บัญชีที่ยังไม่ผูก อ่านข้อมูลกลางไม่ได้ ──
  const blind = await signUp(db, 'blind@student.mahidol.edu');
  const BL = { uid: blind.uid! };
  const central = async (who: Who) => ({
    teachers: await visible(db, who, `select 1 from teachers`),
    groups: await visible(db, who, `select 1 from groups`),
    app_settings: await visible(db, who, `select 1 from app_settings`),
    pdpa_policy: await visible(db, who, `select 1 from pdpa_policy`),
  });
  const blindSees = await central(BL);
  check('บัญชีที่ยังไม่ผูก เห็น teachers/groups/app_settings/pdpa_policy 0 แถว', Object.values(blindSees).every((n) => n === 0), blindSees);
  const studentSees = await central(U.A);
  check('นักศึกษาที่ผูกแล้วยังอ่านข้อมูลกลางได้ครบ (แอปต้องใช้)', Object.values(studentSees).every((n) => n > 0), studentSees);
  await db.exec(`insert into invites (email, role, student_id, teacher_id, is_admin) values ('adminonly@teacher.test', 'teacher', null, null, true)`);
  const adminOnly = await signUp(db, 'adminonly@teacher.test');
  const adminSees = adminOnly.uid ? await central({ uid: adminOnly.uid }) : { none: -1 };
  check('หัวหน้ารายวิชาที่ไม่มีแถว teachers ยังอ่านข้อมูลกลางได้ (my_role = admin)', Object.values(adminSees).every((n) => n > 0), adminSees);

  // ── เพดาน request_link ──
  await db.exec(`insert into students (id, code, name, "group", year, entry_year) values ('sF', '6504006', 'นศ. เอฟ', 'G1', 5, 2569)`);
  const six = await signUp(db, 'six.tries@student.mahidol.edu');
  const SX = { uid: six.uid! };
  const results: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const r = await commit(SX, `select request_link('6504006') as j`);
    results.push(r.ok ? 'ok' : r.error);
    // กด "แก้รหัส" ระหว่างทาง — ตัวนับต้องไม่ถูกล้าง
    if (i === 2) await commit(SX, `select cancel_link_request()`);
  }
  check('ส่งคำขอได้ 5 ครั้งแรก (รวมรอบที่กดแก้รหัสแล้วส่งใหม่)', results.slice(0, 5).every((r) => r === 'ok'), results);
  check('ครั้งที่ 6 ถูกปฏิเสธ', /ครบ 5 ครั้ง/.test(results[5]), results[5]);
  const counter = await db.query<{ attempts: number; status: string }>(`select attempts, status from link_requests where uid = $1`, [SX.uid]);
  check('ตัวนับบนแถวเดียวของบัญชีนั้น = 5 · สถานะกลับเป็นรอยืนยัน', counter.rows[0]?.attempts === 5 && counter.rows[0]?.status === 'pending', counter.rows);
  const afterCancel = await commit(SX, `select cancel_link_request()`);
  const mine = await as(db, SX, async (tx) => (await tx.query<{ j: unknown }>(`select my_link_request() as j`)).rows[0].j);
  check('ยกเลิกแล้ว แอปเห็นว่า "ยังไม่มีคำขอ" (แถวยังอยู่แต่ซ่อน)', afterCancel.ok && mine.ok && mine.value === null, { afterCancel, mine });
  const stillCapped = await commit(SX, `select request_link('6504006')`);
  check('ยกเลิกแล้วขอใหม่ก็ยังติดเพดาน', !stillCapped.ok && /ครบ 5 ครั้ง/.test(stillCapped.error), stillCapped);
  const listT1 = await as(db, U.T1, async (tx) => (await tx.query<{ email: string }>(`select email from pending_link_requests()`)).rows.map((r) => r.email));
  check('คำขอที่ยกเลิกแล้วไม่โผล่ในรายการรอยืนยันของอาจารย์', listT1.ok && !listT1.value.includes('six.tries@student.mahidol.edu'), listT1);

  const checker = await db.query<{ 'สถานะ': string; migration: string }>(
    (await import('node:fs')).readFileSync(new URL('../supabase/check-migrations.sql', import.meta.url), 'utf8'));
  const row = checker.rows.find((r) => r.migration.startsWith('0027'));
  check('check-migrations.sql ตอบว่า 0027 รันแล้ว', !!row && row['สถานะ'].startsWith('✓'), row);
}

await db.close();
console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
