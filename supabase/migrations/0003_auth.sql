-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ยามหน้าประตูจริง (auth) · migration ที่ 3
--
-- แนวคิด: ภาควิชาเป็นคน "เชิญ" ล่วงหน้าว่าอีเมลไหนคือใคร (ตาราง invites)
-- พอคนนั้นสมัคร/ล็อกอินครั้งแรก trigger จะผูกบัญชีเข้ากับ นศ./อาจารย์ ให้อัตโนมัติ
-- → ไม่มีใครแอบสมัครแล้วกลายเป็นนักศึกษาคนอื่นได้ และไม่ต้องกรอกอะไรเพิ่มตอนสมัคร
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ① รายชื่อที่ภาคเชิญไว้ (ใครมีสิทธิ์เข้าระบบ และเข้าในฐานะใคร)
create table if not exists invites (
  email text primary key,
  role text not null check (role in ('student', 'teacher')),
  student_id text,
  teacher_id text,
  created_at timestamptz not null default now()
);

-- ② บัญชีที่ผูกกับ auth แล้ว (1 แถว = 1 คนที่ล็อกอินได้จริง)
create table if not exists app_users (
  uid uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('student', 'teacher')),
  student_id text,
  teacher_id text,
  created_at timestamptz not null default now()
);

-- ③ trigger: สมัครเสร็จปุ๊บ ผูกกับ invite ทันที
--    security definer = รันด้วยสิทธิ์เจ้าของฟังก์ชัน (ผู้ใช้ทั่วไปแตะ invites ไม่ได้)
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
    -- ไม่อยู่ในรายชื่อที่เชิญ → สร้างบัญชีได้แต่ยังไม่ผูกกับใคร (แอปจะบอกให้ติดต่อภาค)
    return new;
  end if;

  insert into app_users (uid, email, role, student_id, teacher_id)
  values (new.id, new.email, inv.role, inv.student_id, inv.teacher_id)
  on conflict (uid) do update
    set role = excluded.role,
        student_id = excluded.student_id,
        teacher_id = excluded.teacher_id;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ④ RLS ของสองตารางใหม่
alter table invites enable row level security;
alter table app_users enable row level security;

-- invites: ไม่เปิดให้ client อ่านเลย (มีเฉพาะ trigger ที่เป็น security definer)
drop policy if exists invites_no_access on invites;

-- app_users: เห็นได้เฉพาะแถวของตัวเอง — แอปใช้ดูว่า "ฉันคือ นศ. คนไหน"
drop policy if exists app_users_self on app_users;
create policy app_users_self on app_users
  for select to authenticated
  using (uid = auth.uid());

-- ⑤ ปิดประตูตารางข้อมูลจริงทั้ง 12 ใบ: ต้องล็อกอินก่อนถึงอ่าน/เขียนได้
--    (เฟสถัดไปค่อยไล่ทำ per-row: นศ. เห็นเฉพาะงานตัวเอง / อาจารย์เห็นเฉพาะกลุ่มที่ปรึกษา)
do $$
declare t text;
begin
  foreach t in array array[
    'teachers','students','groups','patients','workpieces','updates',
    'photos','checkins','reviews','submissions','issues','audit'
  ] loop
    execute format('drop policy if exists dev_all on %I', t);
    execute format(
      'create policy signed_in_all on %I for all to authenticated using (true) with check (true)', t
    );
  end loop;
exception when duplicate_object then null;
end $$;

-- ⑥ บัญชีทดสอบของทีมพัฒนา — ผูกกับตัวละครในข้อมูลตัวอย่าง
--    (ของจริงตอน pilot จะ import รายชื่อจากชีตภาคมาลงตารางนี้แทน)
insert into invites (email, role, student_id, teacher_id) values
  ('nak-test@example.com',   'student', 'st-TH-PT7-1', null),
  ('ajarn-test@example.com', 'teacher', null,          'tc-TH-PT7-1'),
  -- บัญชีสาธิตตอนพรี: สลับ นศ.↔อาจารย์ ได้ในบัญชีเดียว (ของจริงคนละคนคนละบัญชี)
  ('demo@example.com',       'student', 'st-TH-PT7-1', 'tc-TH-PT7-1')
on conflict (email) do update
  set role = excluded.role,
      student_id = excluded.student_id,
      teacher_id = excluded.teacher_id;
