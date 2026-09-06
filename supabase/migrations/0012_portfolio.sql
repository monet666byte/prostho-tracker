-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — สมุด portfolio Section II + III · migration ที่ 12
--
-- ที่มา: สมุดจริง "Clinical Performance Portfolio" (Edited: 3 May 2024)
--   Section II  ตรวจแผนการรักษา Removable/Fixed (เต็ม 70) + ใบ RPD design (ผ่าน/ไม่ผ่าน)
--   Section III ความรู้และทักษะ 12 ใบ + ใบ recall 3 ใบ (ใบละเต็ม 10)
--
-- ⚠️ ต่างจาก self_assessments ตรงที่ "อาจารย์เป็นคนกรอก ไม่ใช่นักศึกษา"
--    นักศึกษาต้องเขียนไม่ได้เลย ไม่งั้นให้คะแนนตัวเองได้
--    RLS ข้างล่างจึงไม่มี policy insert/update/delete ให้นักศึกษาแม้แต่ข้อเดียว
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
--             (ต้องรัน 0010 กับ 0011 ให้เสร็จก่อน)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section II ───────────────────────────────────────────────────────────────
create table if not exists sect2_records (
  id text primary key,
  student_id text not null,
  form_key text not null,                  -- removable | fixed | rpdDesign
  academic_year int not null,              -- พ.ศ.
  class_year int not null,
  patient_name text,                       -- ช่องบนหัวฟอร์ม (เขียนมือ ไม่บังคับผูกกับทะเบียนเคส)
  hn text,
  type_of_works text,
  workpiece_id text,
  grades jsonb,                            -- ใบให้คะแนน: คีย์หัวข้อ → O/S/M/U
  total numeric,                           -- null = ยังกาไม่ครบ (ร่าง)
  marks jsonb,                             -- ใบ RPD design: คีย์ข้อ → true/false
  passed boolean,
  by_who text not null,                    -- ชื่ออาจารย์ที่ประเมิน (ตรงกับคอลัมน์ by ในแอป)
  at_when text not null,                   -- วันที่ในช่อง Date ของฟอร์ม (ISO date)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists s2_student_idx on sect2_records (student_id);
create index if not exists s2_year_idx on sect2_records (academic_year);

-- ── Section III ──────────────────────────────────────────────────────────────
create table if not exists sect3_records (
  id text primary key,
  student_id text not null,
  form_key text not null,                  -- cdK1 … recallFdp
  academic_year int not null,
  class_year int not null,
  patient_name text,
  hn text,
  workpiece_id text,
  grades jsonb not null default '{}'::jsonb,  -- คีย์ข้อ → O/S/U
  total numeric,                           -- null = ยังกาไม่ครบ (ร่าง)
  by_who text not null,
  at_when text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists s3_student_idx on sect3_records (student_id);
create index if not exists s3_year_idx on sect3_records (academic_year);

alter table sect2_records enable row level security;
alter table sect3_records enable row level security;

-- ── สิทธิ์: นักศึกษาอ่านของตัวเอง · อาจารย์อ่านได้ทุกคนและเป็นคนเดียวที่เขียนได้ ──
-- อาจารย์ทุกคนอ่าน/เขียนได้เท่ากัน (เหตุผลเดียวกับ 0010: ที่ปรึกษาแลกกลุ่มกันระหว่างปี
-- ถ้าล็อกที่ advisor_ids คนที่รับช่วงต่อจะกรอกต่อไม่ได้) ตัวคุมคือ audit log
do $$
declare tbl text;
begin
  foreach tbl in array array['sect2_records', 'sect3_records'] loop
    execute format('drop policy if exists %1$s_read on %1$s', tbl);
    execute format($f$
      create policy %1$s_read on %1$s for select to authenticated
        using (student_id = my_student_id() or is_teacher())
    $f$, tbl);

    -- เขียนได้เฉพาะอาจารย์ — ไม่มี policy ให้นักศึกษาเลยแม้แต่ insert
    execute format('drop policy if exists %1$s_write on %1$s', tbl);
    execute format($f$
      create policy %1$s_write on %1$s for insert to authenticated
        with check (is_teacher())
    $f$, tbl);

    execute format('drop policy if exists %1$s_update on %1$s', tbl);
    execute format($f$
      create policy %1$s_update on %1$s for update to authenticated
        using (is_teacher()) with check (is_teacher())
    $f$, tbl);

    -- ลบได้เฉพาะอาจารย์ (แอปมีปุ่มลบใบที่กรอกผิด) · ทุกครั้งลง audit ในแอป
    execute format('drop policy if exists %1$s_delete on %1$s', tbl);
    execute format($f$
      create policy %1$s_delete on %1$s for delete to authenticated
        using (is_teacher())
    $f$, tbl);
  end loop;
end $$;

-- ── ยามฝั่งเซิร์ฟเวอร์: กันแก้เจ้าของแถวและกันปลอมวันที่สร้าง ──────────────────
-- แอปส่ง by_who มาจากเครื่องผู้ใช้ ซึ่งปลอมได้ถ้ามีคนยิง API ตรง
-- แต่จะยิงได้ต้องเป็นอาจารย์อยู่แล้ว (is_teacher) จึงกันแค่ระดับ "แก้แถวคนอื่นให้เพี้ยน"
create or replace function guard_portfolio_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- ย้ายแถวไปเป็นของ นศ. คนอื่น หรือเปลี่ยนว่าเป็นใบไหน = ไม่อนุญาต ให้สร้างใบใหม่แทน
    if new.student_id is distinct from old.student_id then
      raise exception 'ห้ามย้ายผลประเมินไปเป็นของนักศึกษาคนอื่น';
    end if;
    if new.form_key is distinct from old.form_key then
      raise exception 'ห้ามเปลี่ยนว่าแถวนี้เป็นใบไหน';
    end if;
    new.created_at := old.created_at;   -- คงไว้เงียบๆ ไม่ให้ sync พังเพราะเรื่องเล็ก
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sect2_guard on sect2_records;
create trigger sect2_guard before update on sect2_records
  for each row execute function guard_portfolio_record();

drop trigger if exists sect3_guard on sect3_records;
create trigger sect3_guard before update on sect3_records
  for each row execute function guard_portfolio_record();

-- ── realtime ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'sect2_records') then
    alter publication supabase_realtime add table sect2_records;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'sect3_records') then
    alter publication supabase_realtime add table sect3_records;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ตรวจว่าปิดรูจริงไหม — รันตอน login เป็น "นักศึกษา" ทั้ง 3 ข้อต้อง error
-- ถ้าข้อไหนผ่าน แปลว่ารูยังเปิดอยู่ อย่าเพิ่งเปิดใช้จริง
-- ─────────────────────────────────────────────────────────────────────────────
-- ① นักศึกษาให้คะแนนตัวเอง — ต้องโดนบล็อก
-- insert into sect3_records (id, student_id, form_key, academic_year, class_year,
--                            grades, total, by_who, at_when)
--   values ('hack1', my_student_id(), 'cdK1', 2569, 5, '{}'::jsonb, 10, 'ตัวเอง', '2026-09-07');
--
-- ② นักศึกษาแก้คะแนนที่อาจารย์ให้ไว้ — ต้องโดนบล็อก
-- update sect3_records set total = 10 where student_id = my_student_id();
--
-- ③ นักศึกษาอ่านของเพื่อน — ต้องได้ 0 แถว (ไม่ error แต่ต้องว่าง)
-- select count(*) from sect3_records where student_id <> my_student_id();
