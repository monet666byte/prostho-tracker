-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ปิดช่องโหว่จากการตรวจ security 2 ก.ย. 69 · migration ที่ 9
--
-- ① นักศึกษาแก้แถว students ของตัวเองไม่ได้อีก (อ่านได้อย่างเดียว)
--    เดิม students_own เป็น for all → ยิง API เปลี่ยนชื่อ/รหัส/กลุ่ม/ที่ปรึกษาตัวเองได้
--    · เปลี่ยนชื่อเป็นเพื่อน → อาจารย์ประเมินผิดคน
--    · เปลี่ยนกลุ่ม → my_group() เปลี่ยนตาม → อ่าน audit ของกลุ่มอื่น (มีชื่อผู้ป่วย+HN)
--    หน้าแอปฝั่งนักศึกษาไม่เคยเขียนตารางนี้เลย ปิดได้โดยไม่กระทบอะไร
-- ② audit: actor_uid ให้ trigger ประทับจากคนที่ล็อกอินเสมอ (default เฉยๆ ถูก client ส่งค่าทับได้)
--    และห้ามแก้/ลบทุกกรณี แม้วันหน้าจะมีคนเผลอเพิ่ม policy
-- ③ สมัครด้วยอีเมลที่ไม่อยู่ในรายชื่อเชิญ → ปฏิเสธตั้งแต่ตอนสมัคร
--    เดิมสร้างบัญชีได้แต่ไม่ผูกใคร → คนนอก "จอง" อีเมลอาจารย์ไว้ก่อนได้ ตัวจริงสมัครไม่ได้
--    ⚠️ ผลข้างเคียงที่ตั้งใจ: จะเพิ่มคนใน Supabase dashboard ก็ต้องใส่ invites ก่อนเหมือนกัน
-- ④ เพิ่มคอลัมน์ entry_year ("รุ่น") ที่แอปส่งมาแต่ตารางยังไม่มี
--    ไม่มีคอลัมน์นี้ = push ตาราง students ถูกปฏิเสธเงียบๆ รายชื่อที่นำเข้าไม่ขึ้นตู้กลาง
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run (ต้องรัน 0001–0008 มาก่อน)
-- ─────────────────────────────────────────────────────────────────────────────

-- ④ คอลัมน์ที่หายไป (ทำก่อน เพราะไม่กระทบสิทธิ์)
alter table students add column if not exists entry_year int;

-- ① students: นักศึกษาอ่านแถวตัวเอง · เขียนได้เฉพาะอาจารย์
drop policy if exists students_own on students;
drop policy if exists students_read on students;
drop policy if exists students_write on students;

create policy students_read on students for select to authenticated
  using (is_teacher() or id = my_student_id());

create policy students_write on students for all to authenticated
  using (is_teacher()) with check (is_teacher());
-- (students_admin_read จาก 0007 คงไว้ — หัวหน้าภาคที่ไม่ใช่อาจารย์ยังอ่านได้)

-- ② audit: ประทับ actor_uid เอง + ห้ามแก้/ลบ
create or replace function audit_stamp_actor()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.actor_uid := auth.uid();   -- ไม่สนว่า client ส่งอะไรมา
  return new;
end $$;

drop trigger if exists audit_stamp on audit;
create trigger audit_stamp
  before insert on audit
  for each row execute function audit_stamp_actor();

create or replace function audit_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'audit log แก้ไขหรือลบไม่ได้';
end $$;

drop trigger if exists audit_no_change on audit;
create trigger audit_no_change
  before update or delete on audit
  for each row execute function audit_immutable();

-- ③ สมัครได้เฉพาะอีเมลที่ภาคเชิญไว้
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invites%rowtype;
begin
  select * into inv from invites where lower(email) = lower(new.email);
  if not found then
    raise exception 'อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าระบบ — ติดต่อภาควิชาเพื่อเพิ่มรายชื่อ';
  end if;

  insert into app_users (uid, email, role, student_id, teacher_id, is_admin)
  values (new.id, new.email, inv.role, inv.student_id, inv.teacher_id, inv.is_admin)
  on conflict (uid) do update
    set role = excluded.role,
        student_id = excluded.student_id,
        teacher_id = excluded.teacher_id,
        is_admin = excluded.is_admin;
  return new;
end $$;
-- trigger on_auth_user_created จาก 0003 ชี้มาที่ฟังก์ชันนี้อยู่แล้ว ไม่ต้องสร้างใหม่
