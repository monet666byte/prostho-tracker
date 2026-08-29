-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ยามรายแถว (per-row RLS) · migration ที่ 4
--
-- กติกาที่เคาะกับผู้ใช้ (29 ส.ค.):
--   นักศึกษา  → เห็น/แก้ได้เฉพาะข้อมูลของตัวเอง (คนไข้ ชิ้นงาน คาบ ของตัวเองล้วน)
--   อาจารย์   → เห็น/แก้ได้ทั้งชั้นปี  ← เจตนา ไม่ใช่ความหละหลวม เพราะ
--                 · อาจารย์เวรต้องเซ็นให้ นศ. ทุกกลุ่มที่อยู่ในคลินิกวันนั้น
--                 · หัวหน้าภาค/ผู้ประสานรายวิชาต้องเห็นภาพรวม 96 คน
--                 · หน้า "ภาพรวมชั้นปี" และ "วิเคราะห์รวม" ต้องใช้ข้อมูลทั้งชั้น
--               ตัวคุมของฝั่งอาจารย์คือ audit log (แบบเดียวกับเวชระเบียน) ไม่ใช่การบล็อก
--
-- 🔧 ถ้าวันหน้าภาคขอเข้มขึ้นเป็น "อาจารย์เห็นเฉพาะกลุ่มที่ปรึกษาตัวเอง":
--    แก้ที่ฟังก์ชัน is_teacher() ด้านล่างให้เป็น teaches_group(<คอลัมน์กลุ่ม>) แล้วไล่เปลี่ยนใน policy
--    (คอมเมนต์ตัวอย่างอยู่ท้ายไฟล์)
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ① ฟังก์ชันช่วย: "ฉันเป็นใคร" — security definer เพราะต้องอ่าน app_users ข้ามสิทธิ์ตัวเอง
create or replace function my_student_id()
returns text language sql stable security definer set search_path = public
as $$ select student_id from app_users where uid = auth.uid() $$;

create or replace function my_teacher_id()
returns text language sql stable security definer set search_path = public
as $$ select teacher_id from app_users where uid = auth.uid() $$;

-- มี teacher_id = มีสิทธิ์ระดับอาจารย์ (บัญชีสาธิตที่ผูกทั้งสองฝั่งก็ได้สิทธิ์นี้ด้วย)
create or replace function is_teacher()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select teacher_id is not null from app_users where uid = auth.uid()), false) $$;

-- ชิ้นงานที่เป็นของฉัน — ใช้ในตารางลูก (updates / photos / reviews)
create or replace function my_workpiece_ids()
returns setof text language sql stable security definer set search_path = public
as $$ select id from workpieces where student_id = my_student_id() $$;

-- ② ล้าง policy รวมของ migration ก่อนหน้า แล้ววางกติกาใหม่รายตาราง
do $$
declare t text;
begin
  foreach t in array array[
    'teachers','students','groups','patients','workpieces','updates',
    'photos','checkins','reviews','submissions','issues','audit'
  ] loop
    execute format('drop policy if exists signed_in_all on %I', t);
    execute format('drop policy if exists dev_all on %I', t);
  end loop;
end $$;

-- ── ข้อมูลกลางที่ทุกคนต้องอ่านได้ (ไม่มีข้อมูลผู้ป่วย) ────────────────────────
-- รายชื่ออาจารย์ + กลุ่มคลินิก: อ่านได้ทุกคนที่ล็อกอิน แก้ได้เฉพาะอาจารย์
create policy teachers_read on teachers for select to authenticated using (true);
create policy teachers_write on teachers for all to authenticated
  using (is_teacher()) with check (is_teacher());

create policy groups_read on groups for select to authenticated using (true);
create policy groups_write on groups for all to authenticated
  using (is_teacher()) with check (is_teacher());

-- ── ข้อมูลนักศึกษา: ตัวเองหรืออาจารย์เท่านั้น ──────────────────────────────────
create policy students_own on students for all to authenticated
  using (is_teacher() or id = my_student_id())
  with check (is_teacher() or id = my_student_id());

-- ── ข้อมูลผู้ป่วย (อ่อนไหวที่สุด): เจ้าของเคสหรืออาจารย์ ──────────────────────
create policy patients_own on patients for all to authenticated
  using (is_teacher() or owner_student_id = my_student_id())
  with check (is_teacher() or owner_student_id = my_student_id());

create policy workpieces_own on workpieces for all to authenticated
  using (is_teacher() or student_id = my_student_id())
  with check (is_teacher() or student_id = my_student_id());

-- ── ตารางลูกของชิ้นงาน: ตามสิทธิ์ของชิ้นงานแม่ ────────────────────────────────
create policy updates_own on updates for all to authenticated
  using (is_teacher() or workpiece_id in (select my_workpiece_ids()))
  with check (is_teacher() or workpiece_id in (select my_workpiece_ids()));

create policy photos_own on photos for all to authenticated
  using (is_teacher() or workpiece_id in (select my_workpiece_ids()))
  with check (is_teacher() or workpiece_id in (select my_workpiece_ids()));

create policy reviews_own on reviews for all to authenticated
  using (is_teacher() or workpiece_id in (select my_workpiece_ids()))
  with check (is_teacher() or workpiece_id in (select my_workpiece_ids()));

-- ── คาบคลินิก / การส่งรายงาน / ช่องหมายเหตุ: ของตัวเองหรืออาจารย์ ─────────────
create policy checkins_own on checkins for all to authenticated
  using (is_teacher() or student_id = my_student_id())
  with check (is_teacher() or student_id = my_student_id());

create policy submissions_own on submissions for all to authenticated
  using (is_teacher() or student_id = my_student_id())
  with check (is_teacher() or student_id = my_student_id());

create policy issues_own on issues for all to authenticated
  using (is_teacher() or student_id = my_student_id())
  with check (is_teacher() or student_id = my_student_id());

-- ── audit log: ทุกคนเขียนได้ (ระบบจดให้เอง) แต่อ่านได้เฉพาะอาจารย์ ────────────
--    เขียนได้อย่างเดียว ลบ/แก้ไม่ได้เลย = หลักฐานที่ย้อนแก้ไม่ได้จริง
create policy audit_insert on audit for insert to authenticated with check (true);
create policy audit_read on audit for select to authenticated using (is_teacher());

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔧 ตัวอย่างถ้าจะเข้มขึ้นเป็น "อาจารย์เห็นเฉพาะกลุ่มที่ปรึกษาตัวเอง":
--
--   create or replace function is_teacher_of_student(sid text)
--   returns boolean language sql stable security definer set search_path = public
--   as $$ select exists (
--     select 1 from students s
--     where s.id = sid and my_teacher_id() = any(s.advisor_ids)
--   ) $$;
--
--   แล้วเปลี่ยน is_teacher() ใน policy ของ students/patients/workpieces/checkins
--   เป็น is_teacher_of_student(<คอลัมน์ student_id>)
--   ⚠️ ทำแล้วหน้า "ภาพรวมชั้นปี" กับ "วิเคราะห์รวม" จะเห็นแค่กลุ่มตัวเอง ต้องแก้ UI ด้วย
-- ─────────────────────────────────────────────────────────────────────────────
