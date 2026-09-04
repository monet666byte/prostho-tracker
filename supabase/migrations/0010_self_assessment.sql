-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — แบบประเมินตนเอง (self-assessment) · migration ที่ 10
--
-- ที่มา: ฟอร์ม Word ของภาค "Self-assessment (SA) report: MIDS Prosthodontic Clinic"
--        นักศึกษากรอกปีละครั้ง ตอนจบเทอม 1 แล้วอาจารย์ที่ปรึกษาอ่านก่อนนัดคุย
--
-- สิทธิ์การเห็น: อาจารย์ทุกคนในภาคเห็นได้ (เท่ากับตารางอื่นในระบบ — ดู 0004)
--   ผู้ใช้ยืนยัน 4 ก.ย. 69: "เอาให้ทุกคนเห็น บางครั้งมีการแลกกลุ่มบ้าง"
--   คือที่ปรึกษาไม่ได้ตายตัวตลอดปี ถ้าล็อกไว้ที่ advisor_ids อาจารย์ที่รับช่วงต่อจะเปิดอ่านไม่ได้
--   ตัวคุมจึงเป็น audit log แบบเดียวกับตารางอื่น ไม่ใช่การบล็อก
--   ⚠️ ฟอร์มนี้มีช่องที่นักศึกษาเขียนเรื่องส่วนตัว (ข้อจำกัด ความกังวล) — ข้อความที่บอกนักศึกษา
--      ในแอปจึงต้องพูดตรงว่า "อาจารย์ในภาคเห็นได้" ไม่ใช่ "เฉพาะที่ปรึกษา"
--   🔧 ถ้าวันหน้าภาคขอให้แคบลงเหลือเฉพาะที่ปรึกษา: ตัวอย่างอยู่ท้ายไฟล์
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

-- ① นักศึกษา: อ่านของตัวเองเท่านั้น · อาจารย์: อ่านได้ทุกคน (รองรับการแลกกลุ่มระหว่างปี)
drop policy if exists sa_own on self_assessments;
create policy sa_own on self_assessments for select to authenticated
  using (student_id = my_student_id() or is_teacher());

drop policy if exists sa_write_own on self_assessments;
create policy sa_write_own on self_assessments for insert to authenticated
  with check (student_id = my_student_id());

-- ③ แก้ไข: นักศึกษาแก้ได้เฉพาะตอนยังเป็นร่าง · อาจารย์แก้ได้ (ปล่อยสรุป + เขียนความเห็น)
--    ส่งแล้วห้ามนักศึกษาแก้ — ฐานข้อมูลบังคับเอง ไม่ใช่แค่ปุ่มในแอปที่ปิดไว้
drop policy if exists sa_update on self_assessments;
create policy sa_update on self_assessments for update to authenticated
  using (
    is_teacher()
    or (student_id = my_student_id() and status = 'draft')
  )
  with check (
    is_teacher()
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
-- 🔧 ถ้าวันหน้าภาคขอให้แคบลงเหลือ "เฉพาะอาจารย์ที่ปรึกษาของ นศ. คนนั้น":
--
--   create or replace function is_advisor_of(sid text)
--   returns boolean language sql stable security definer set search_path = public
--   as $$ select exists (
--     select 1 from students s
--     where s.id = sid and my_teacher_id() = any(s.advisor_ids)
--   ) $$;
--
--   แล้วเปลี่ยน is_teacher() เป็น is_advisor_of(student_id) ในทั้ง sa_own และ sa_update
--   ⚠️ ทำแล้วอาจารย์ที่รับช่วงกลุ่มระหว่างปีจะเปิดอ่านของ นศ. ไม่ได้จนกว่าจะแก้ advisor_ids
-- ─────────────────────────────────────────────────────────────────────────────
