-- ═══════════════════════════════════════════════════════════════════════════
-- ลบข้อมูลตัวอย่าง (ของปลอม) ออกจากเซิร์ฟเวอร์ — ⚠️ ลบจริง กู้คืนไม่ได้
--
-- ต้องทำก่อนรันไฟล์นี้ ตามลำดับ:
--   1. สำรองข้อมูล  `npm run backup`  (ไฟล์นี้ลบถาวร)
--   2. รัน  supabase/check-demo-rows.sql  แล้วดูตัวเลขว่าจะลบเท่าไหร่ ไม่แตะเท่าไหร่
--   3. อัปเดตแอปทุกเครื่องให้เป็นรุ่นที่แก้แล้วก่อน (13 ก.ย. 69 ขึ้นไป)
--      ไม่งั้นเครื่องอาจารย์ที่ยังมีของปลอมค้าง จะดันกลับขึ้นมาใหม่ตอนเปิดแอป
--      (รุ่นที่แก้แล้วล้างของปลอมในเครื่องตัวเองตอนเปิดแอป — seed.ts → purgeLocalDemoRows)
--
-- ทั้งไฟล์เป็น transaction เดียว (SQL Editor ห่อให้) — บรรทัดไหนล้ม ย้อนกลับหมด ไม่ลบครึ่งๆ
-- ผลที่เห็นตอนจบคือจำนวนที่ลบของแต่ละตาราง
--
-- ลายเซ็นเดียวกับ check-demo-rows.sql และ src/data/seed.ts (isDemoStudentId / isDemoHn)
-- ทดสอบบน Postgres จริงแล้วใน `npm run test:rls` ข้อ ⑩ ว่าลบเฉพาะของปลอม
--
-- สิ่งที่ไฟล์นี้ตั้งใจไม่ลบ:
--   · audit — ลบไม่ได้ตามการออกแบบ (0009) และข้อมูลตัวอย่างไม่มีชื่อผู้ป่วยจริงอยู่แล้ว
--   · invites / app_users — บัญชีล็อกอินต้องให้คนตัดสินทีละบัญชี
--   · อาจารย์ที่ยังถูกอ้างถึงจากกลุ่มจริง หรือจากรายชื่อเชิญ
-- ═══════════════════════════════════════════════════════════════════════════

create temporary table _demo_students on commit drop as
  select id from students where id ~ '^st-.+-[1-8]$';
create temporary table _demo_patients on commit drop as
  select id from patients
  where hn like 'DEMO-%' or owner_student_id in (select id from _demo_students);
create temporary table _demo_works on commit drop as
  select id from workpieces
  where student_id in (select id from _demo_students) or patient_id in (select id from _demo_patients);

create temporary table _removed (tbl text, n bigint) on commit drop;

with d as (delete from updates where workpiece_id in (select id from _demo_works) returning 1)
insert into _removed select 'updates', count(*) from d;
with d as (delete from photos where workpiece_id in (select id from _demo_works) returning 1)
insert into _removed select 'photos', count(*) from d;
with d as (delete from reviews where workpiece_id in (select id from _demo_works) returning 1)
insert into _removed select 'reviews', count(*) from d;
with d as (delete from workpieces where id in (select id from _demo_works) returning 1)
insert into _removed select 'workpieces', count(*) from d;
with d as (delete from patients where id in (select id from _demo_patients) returning 1)
insert into _removed select 'patients', count(*) from d;
with d as (delete from checkins where student_id in (select id from _demo_students) returning 1)
insert into _removed select 'checkins', count(*) from d;
with d as (delete from submissions where student_id in (select id from _demo_students) returning 1)
insert into _removed select 'submissions', count(*) from d;
with d as (delete from issues where student_id in (select id from _demo_students) returning 1)
insert into _removed select 'issues', count(*) from d;
with d as (delete from self_assessments where student_id in (select id from _demo_students) returning 1)
insert into _removed select 'self_assessments', count(*) from d;
with d as (delete from sect2_records where student_id in (select id from _demo_students) returning 1)
insert into _removed select 'sect2_records', count(*) from d;
with d as (delete from sect3_records where student_id in (select id from _demo_students) returning 1)
insert into _removed select 'sect3_records', count(*) from d;
with d as (delete from students where id in (select id from _demo_students) returning 1)
insert into _removed select 'students', count(*) from d;

-- กลุ่มที่ไม่เหลือนักศึกษาจริงเลย
with d as (
  delete from groups g
  where not exists (select 1 from students s where s."group" = g.code)
    and not exists (select 1 from unnest(coalesce(g.student_ids, '{}')) u(sid) where u.sid !~ '^st-.+-[1-8]$')
  returning 1
)
insert into _removed select 'groups', count(*) from d;

-- อาจารย์ตัวอย่าง (`tc-<กลุ่ม>-1|2`) ที่ไม่มีกลุ่มไหนอ้างถึงแล้ว และไม่อยู่ในรายชื่อเชิญ/บัญชี
with d as (
  delete from teachers t
  where t.id ~ '^tc-.+-[12]$'
    and not exists (select 1 from groups g where t.id = any(g.advisor_ids))
    and not exists (select 1 from invites i where i.teacher_id = t.id)
    and not exists (select 1 from app_users u where u.teacher_id = t.id)
  returning 1
)
insert into _removed select 'teachers', count(*) from d;

select tbl as "ตาราง", n as "ลบไป" from _removed order by n desc, tbl;
