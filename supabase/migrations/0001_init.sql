-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ตู้แฟ้มกลาง (PostgreSQL บน Supabase) · migration แรก
-- โครงตารางสะท้อน src/domain/types.ts แบบ 1:1 (คอลัมน์เป็น snake_case)
--
-- วิธีติดตั้ง: ก๊อปไฟล์นี้ทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ครูอาจารย์
create table if not exists teachers (
  id text primary key,
  name text not null,
  title text,
  updated_at timestamptz not null default now()
);

-- นักศึกษา
create table if not exists students (
  id text primary key,
  code text not null,
  name text not null,
  "group" text not null,
  year int not null,
  advisor_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists students_group_idx on students ("group");

-- กลุ่มคลินิก PT1–PT12
create table if not exists groups (
  code text primary key,
  advisor_ids text[] not null default '{}',
  student_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ผู้ป่วย
create table if not exists patients (
  id text primary key,
  name text not null,
  hn text not null,
  sex_age text not null default '',
  note text,
  owner_student_id text not null,
  updated_at timestamptz not null default now()
);
create index if not exists patients_owner_idx on patients (owner_student_id);

-- ชิ้นงาน
create table if not exists workpieces (
  id text primary key,
  patient_id text not null,
  student_id text not null,
  type text not null,
  variant text,
  arch text,
  pair_id text,
  tooth text,
  kennedy text,
  denture_class text,
  detail text not null default '',
  accepted_date text not null,
  minimum_requirement boolean not null default true,
  pending_qualification boolean not null default false,
  payment text not null default 'ยังไม่ชำระ',
  sect2_removable boolean not null default false,
  sect2_fixed boolean not null default false,
  design_rpd text,
  proc_index int not null default -1,
  last_updated_at text not null,
  completed_at text,
  catalog_version text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists workpieces_student_idx on workpieces (student_id);
create index if not exists workpieces_patient_idx on workpieces (patient_id);

-- ประวัติการผ่าน step (1 แถว = ผ่าน 1 ครั้ง)
create table if not exists updates (
  id text primary key,
  workpiece_id text not null,
  proc_index int not null,
  progression int not null,
  performed_at text not null,
  self_performed boolean not null default false,
  photo_ids text[] not null default '{}',
  note text,
  reversal boolean not null default false,
  created_by text not null default '',
  created_at text not null,
  synced_at text,
  updated_at timestamptz not null default now()
);
create index if not exists updates_workpiece_idx on updates (workpiece_id);

-- รูปแนบ (เดโม — เก็บ metadata; ไฟล์จริงใช้ Supabase Storage ใน phase ถัดไป)
create table if not exists photos (
  id text primary key,
  workpiece_id text not null,
  progression int not null default 0,
  step_label text not null default '',
  data_url text,
  size_label text not null default '',
  status text not null default 'ok',
  created_at text not null,
  updated_at timestamptz not null default now()
);
create index if not exists photos_workpiece_idx on photos (workpiece_id);

-- เช็คอินรายคาบ (1 แถว = 1 แถวในสมุด logbook)
create table if not exists checkins (
  id text primary key,
  student_id text not null,
  date text not null,
  punctual boolean not null default true,
  checkin_at text,
  photo_count int,
  no_patient boolean not null default false,
  patient_id text,
  activities text[] not null default '{}',
  note text,
  status text not null default 'pending',
  scores jsonb,
  evaluated_by text,
  evaluated_at text,
  created_at text not null,
  updated_at timestamptz not null default now()
);
create index if not exists checkins_student_date_idx on checkins (student_id, date);
create index if not exists checkins_status_idx on checkins (status);

-- คอมเมนต์อาจารย์ต่อชิ้นงาน
create table if not exists reviews (
  id text primary key,
  workpiece_id text not null,
  status text not null default 'pending',
  comment text,
  by_who text,
  at_when text,
  updated_at timestamptz not null default now()
);
create index if not exists reviews_workpiece_idx on reviews (workpiece_id);

-- การส่งรายงานตามรอบ
create table if not exists submissions (
  id text primary key,
  student_id text not null,
  round_id text not null,
  status text not null default 'none',
  approved_by text,
  comment text,
  updated_at timestamptz not null default now()
);

-- ช่อง Report issues ต่อนักศึกษา
create table if not exists issues (
  student_id text primary key,
  text text not null default '',
  updated_at timestamptz not null default now()
);

-- audit log (append-only)
create table if not exists audit (
  id text primary key,
  text text not null,
  who text not null default '',
  at_when text not null,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ⚠️ ชั่วคราว (ช่วงพัฒนา ยังไม่มี login จริง): เปิดให้ anon อ่าน/เขียนได้ทุกตาราง
-- ห้ามใส่ข้อมูลผู้ป่วยจริงจนกว่าจะทำ auth + policy จริงเสร็จ (งาน session ถัดไป)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'teachers','students','groups','patients','workpieces','updates',
    'photos','checkins','reviews','submissions','issues','audit'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'drop policy if exists dev_all on %I', t
    );
    execute format(
      'create policy dev_all on %I for all to anon, authenticated using (true) with check (true)', t
    );
  end loop;
end $$;
