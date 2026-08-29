-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — จำกัดขอบเขต audit log · migration ที่ 5
--
-- เหตุผล (ผู้ใช้เคาะ 29 ส.ค.): ให้อาจารย์ทุกคนเห็น audit ของทั้งระบบ
-- "มันดู invade เกินไป" — จะกลายเป็นบรรยากาศจับผิดกันเองในภาค
--
-- กติกาใหม่: เห็นได้ 3 กรณีเท่านั้น
--   ① ของตัวเองทำเอง        → เห็นเสมอ (สิทธิ์รู้ว่าระบบจดอะไรเกี่ยวกับเราไว้ ตามหลัก PDPA)
--   ② เกี่ยวกับกลุ่มที่ปรึกษาของตัวเอง → อาจารย์เห็น (จำเป็นต่อการดูแล นศ. ในกลุ่ม)
--   ③ หัวหน้าภาค (is_admin)  → เห็นทั้งระบบ
--
-- วิธีติดตั้ง: รัน 0004 ก่อน แล้วค่อยรันไฟล์นี้ (SQL Editor → Run)
-- ─────────────────────────────────────────────────────────────────────────────

-- ① บทบาทหัวหน้าภาค — คนเดียวที่เห็น audit ทั้งระบบ
alter table invites   add column if not exists is_admin boolean not null default false;
alter table app_users add column if not exists is_admin boolean not null default false;

-- trigger ตอนสมัครต้องคัดลอกธงนี้มาด้วย
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
    return new;
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

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select is_admin from app_users where uid = auth.uid()), false) $$;

-- ② audit ต้องรู้ว่า "เรื่องนี้เกี่ยวกับใคร/กลุ่มไหน" ถึงจะกรองได้
--    actor_uid ให้ฐานข้อมูลเติมเองจากคนที่ล็อกอิน — ฝั่งแอปปลอมไม่ได้
alter table audit add column if not exists actor_uid  uuid default auth.uid();
alter table audit add column if not exists student_id text;
alter table audit add column if not exists group_code text;
create index if not exists audit_scope_idx on audit (student_id, group_code);

-- ③ กลุ่มที่ฉันเป็นที่ปรึกษา (อาจารย์) หรือกลุ่มที่ฉันสังกัด (นักศึกษา)
create or replace function my_group()
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select g.code from groups g where my_teacher_id() = any(g.advisor_ids) limit 1),
    (select s."group" from students s where s.id = my_student_id() limit 1)
  )
$$;

-- ④ นักศึกษาคนนี้อยู่ในกลุ่มที่ฉันดูแลไหม
create or replace function is_my_student(sid text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from students s where s.id = sid and s."group" = my_group())
$$;

-- ⑤ กติกาอ่าน audit ใหม่
drop policy if exists audit_read on audit;
create policy audit_read on audit for select to authenticated using (
  is_admin()                                                   -- หัวหน้าภาค: ทั้งระบบ
  or actor_uid = auth.uid()                                    -- ของตัวเองทำเอง
  or (student_id is not null and is_my_student(student_id))    -- นศ. ในกลุ่มที่ดูแล
  or (group_code is not null and group_code = my_group())      -- เรื่องของกลุ่มตัวเอง
);

-- เขียนได้ทุกคน แก้/ลบไม่ได้เลย (คงเดิม) — ความเป็นหลักฐานอยู่ตรงนี้
-- หมายเหตุ: แถวที่ไม่มีทั้ง student_id และ group_code = เรื่องระดับระบบ เห็นได้เฉพาะ admin

-- ⑥ ตั้งหัวหน้าภาคสำหรับทดสอบ — บัญชีสาธิตให้เป็น admin จะได้เห็นภาพรวมตอนพรี
update invites   set is_admin = true where email = 'demo@example.com';
update app_users set is_admin = true where email = 'demo@example.com';
