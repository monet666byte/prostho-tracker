/**
 * เทสต์ชุดที่ 19 — "กฎการเข้าถึงกันได้จริงไหม บน Postgres ตัวจริง" · รันด้วย `npm run test:rls`
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
  /* ข้อนี้ไม่ได้ตรวจว่าโค้ดถูก — ตรวจว่า "ความเสี่ยงที่รายงานไว้มีอยู่จริง"
     ถ้าวันหน้าลบบัญชีทดสอบออกจาก migration แล้ว ข้อนี้จะเปลี่ยนเป็นผ่านเอง */
  const claim = await signUp(db, 'demo@example.com');
  const role = claim.uid
    ? await as(db, { uid: claim.uid }, async (tx) => (await tx.query<{ r: string }>(`select my_role() as r`)).rows[0].r)
    : null;
  const seesAll = claim.uid ? await visible(db, { uid: claim.uid }, `select 1 from patients`) : 0;
  console.log(`   (สมัคร demo@example.com ได้: ${!!claim.uid} · บทบาทที่ได้: ${role && role.ok ? role.value : '-'} · เห็นผู้ป่วย ${seesAll} คน)`);
  /* ⚠️ ความเสี่ยงที่ "รอเจ้าของระบบตัดสินใจ" — ไม่นับเป็นเทสต์ตก โดยเจตนา
     เหตุผล: การลบบัญชีทดสอบคือการลบข้อมูลบนเซิร์ฟเวอร์จริง ต้องให้คนตัดสิน ไม่ใช่เทสต์
     ถ้านับเป็นตก `npm test` จะแดงถาวร แล้วเทสต์ที่ตกเพราะบั๊กใหม่จะจมหายไปกับข้อนี้
     เมื่อมี migration ที่ลบบัญชีทดสอบแล้ว ให้เปลี่ยนข้อนี้เป็น check() ธรรมดา */
  const stillAdmin = !!(role && role.ok && role.value === 'admin');
  if (stillAdmin) {
    console.log('⚠️  ความเสี่ยงที่ยังเปิดอยู่ (ไม่นับเป็นตก — รอเจ้าของระบบตัดสินใจ):');
    console.log('    ใครสมัครด้วย demo@example.com ได้สิทธิ์หัวหน้าภาคทันที');
    console.log('    บนเซิร์ฟเวอร์จริง: อันตรายถ้า Confirm email ปิด หรือบัญชีนั้นใช้รหัสผ่านที่เดาได้');
    console.log('    ดู supabase/security-check.sql แถว ⑧ และ ⑪');
  } else {
    check('บัญชีทดสอบในรายชื่อเชิญ ไม่ได้สิทธิ์หัวหน้าภาค', true);
  }
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

await db.close();
console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
