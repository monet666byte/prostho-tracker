-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — แบบประเมินตนเอง (self-assessment) · migration ที่ 10
--
-- ที่มา: ฟอร์ม Word ของภาค "Self-assessment (SA) report: MIDS Prosthodontic Clinic"
--        นักศึกษากรอกปีละครั้ง ตอนจบเทอม 1 แล้วอาจารย์ที่ปรึกษาอ่านก่อนนัดคุย
--
-- ⚠️ ตารางนี้ "เข้มกว่า" ตารางอื่นในระบบโดยตั้งใจ
--    ตารางอื่นให้อาจารย์ทุกคนเห็นทั้งชั้นปี (เพราะอาจารย์เวรต้องเซ็นให้ทุกกลุ่ม — ดู 0004)
--    แต่ฟอร์มนี้มีช่องที่นักศึกษาเขียนเรื่องส่วนตัว (ข้อจำกัด ความกังวล ความกลัว)
--    จึงเปิดให้เฉพาะ "อาจารย์ที่ปรึกษาของนักศึกษาคนนั้น" เท่านั้น
--    🔧 ถ้าภาคขอให้อาจารย์ทุกคนเห็น: เปลี่ยน is_advisor_of(student_id) เป็น is_teacher()
--       ในทั้งสอง policy ด้านล่าง (ตัวอย่างอยู่ท้ายไฟล์)
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists self_assessments (
  id text primary key,                     -- sa-<student_id>-<ปีการศึกษา> · หนึ่งชุดต่อคนต่อปี
  student_id text not null,
  academic_year int not null,              -- พ.ศ.
  class_year int not null,                 -- ชั้นปีตอนกรอก (ฟอร์มมีบล็อกเฉพาะปี 5)
  form_version text not null,              -- ฟอร์มฉบับไหน — ภาคปรับได้ทุกปี ของเก่าต้องยังอ่านออก
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'draft',    -- draft | submitted
  submitted_at timestamptz,
  feedback_released_at timestamptz,        -- อาจารย์กดปล่อยสรุปให้นักศึกษาเห็นเมื่อไหร่
  feedback_released_by text,
  advisor_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sa_student_idx on self_assessments (student_id);
create index if not exists sa_year_idx on self_assessments (academic_year);

alter table self_assessments enable row level security;

-- ① "ฉันเป็นที่ปรึกษาของ นศ. คนนี้ไหม" — อ่าน advisor_ids ของนักศึกษาข้ามสิทธิ์ตัวเอง
create or replace function is_advisor_of(sid text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from students s
    where s.id = sid and my_teacher_id() = any(s.advisor_ids)
  )
$$;

-- ② นักศึกษา: อ่าน/เขียนของตัวเองเท่านั้น · อาจารย์ที่ปรึกษา: อ่านได้
drop policy if exists sa_own on self_assessments;
create policy sa_own on self_assessments for select to authenticated
  using (student_id = my_student_id() or is_advisor_of(student_id));

drop policy if exists sa_write_own on self_assessments;
create policy sa_write_own on self_assessments for insert to authenticated
  with check (student_id = my_student_id());

-- ③ แก้ไข: นักศึกษาแก้ได้เฉพาะตอนยังเป็นร่าง · ที่ปรึกษาแก้ได้ (ปล่อยสรุป + เขียนความเห็น)
--    ส่งแล้วห้ามนักศึกษาแก้ — ฐานข้อมูลบังคับเอง ไม่ใช่แค่ปุ่มในแอปที่ปิดไว้
drop policy if exists sa_update on self_assessments;
create policy sa_update on self_assessments for update to authenticated
  using (
    is_advisor_of(student_id)
    or (student_id = my_student_id() and status = 'draft')
  )
  with check (
    is_advisor_of(student_id)
    or student_id = my_student_id()
  );

-- ④ ลบไม่ได้เลย — ทั้งนักศึกษาและอาจารย์ (เป็นหลักฐานประกอบการให้คำปรึกษา)
--    ไม่สร้าง policy for delete = ไม่มีใครลบได้ผ่าน API

-- ⑤ ให้เห็นการเปลี่ยนแปลงทันทีเหมือนตารางอื่น (ถ้าไม่รัน ยังเห็นผ่าน polling 15 วิ)
do $$
begin
  alter publication supabase_realtime add table self_assessments;
exception when duplicate_object then null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔧 ถ้าภาคขอให้อาจารย์ทุกคนเห็น (ไม่ใช่แค่ที่ปรึกษาของกลุ่มนั้น):
--
--   drop policy sa_own on self_assessments;
--   create policy sa_own on self_assessments for select to authenticated
--     using (student_id = my_student_id() or is_teacher());
--
--   แล้วเปลี่ยน is_advisor_of(student_id) เป็น is_teacher() ใน sa_update ด้วย
-- ─────────────────────────────────────────────────────────────────────────────
