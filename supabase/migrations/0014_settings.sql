-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ตั้งค่าของภาคขึ้นตู้กลาง · migration ที่ 14
--
-- ปัญหาที่แก้: ค่าตั้งของภาค (เกณฑ์ขั้นต่ำ, ชั้นปีที่เปิดแบบประเมินตนเอง, จำนวนวันเตือน)
--   เก็บอยู่ในตาราง kv ของแต่ละเครื่อง ซึ่งไม่เคย sync
--   ผลจริง: อาจารย์กด "เปิดฟอร์มปี 5" บนโน้ตบุ๊กตัวเอง → นักศึกษาทุกคนยังเห็นว่าปิดอยู่
--   ตัวนี้บล็อกการใช้งานจริง จึงต้องมีตารางกลางให้ทุกเครื่องอ่านค่าเดียวกัน
--
-- ทำไมไม่ sync ทั้งตาราง kv: kv มี session ที่ล็อกอินอยู่ กับ cloudBoundUid ปนอยู่ด้วย
--   ซึ่งเป็นของ "เครื่องนี้" ไม่ใช่ของภาค ห้ามขึ้นตู้กลางเด็ดขาด
--   จึงยกขึ้นมาเฉพาะก้อน settings ก้อนเดียว เป็นแถวเดียวคงที่ (id = 'app')
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
--             (ต้องรัน 0012 กับ 0013 ให้เสร็จก่อน)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists app_settings (
  id text primary key,                      -- มีแถวเดียวเสมอ: 'app'
  value jsonb not null default '{}'::jsonb, -- ก้อน Settings ทั้งก้อนตามที่แอปเก็บใน kv
  updated_by text,                          -- ชื่ออาจารย์ที่แก้ล่าสุด (ไว้ตอบว่า "ใครเปิดฟอร์ม")
  updated_at timestamptz not null default now()
);

-- แถวตั้งต้น — ว่างไว้ก่อน เครื่องแรกที่เข้ามาจะดันค่าที่ตั้งไว้ขึ้นเอง
insert into app_settings (id, value) values ('app', '{}'::jsonb)
  on conflict (id) do nothing;

alter table app_settings enable row level security;

-- ── สิทธิ์ ────────────────────────────────────────────────────────────────────
-- อ่าน: ทุกคนที่ล็อกอิน — นักศึกษาต้องรู้ว่าฟอร์มเปิดหรือยังและเกณฑ์ขั้นต่ำเท่าไหร่
-- เขียน: อาจารย์เท่านั้น — ไม่งั้นนักศึกษาแก้เกณฑ์ขั้นต่ำของตัวเองได้
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings for select to authenticated
  using (true);

drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings for insert to authenticated
  with check (is_teacher());

drop policy if exists app_settings_update on app_settings;
create policy app_settings_update on app_settings for update to authenticated
  using (is_teacher()) with check (is_teacher());

-- ไม่มี policy delete เลย — แถวนี้ห้ามหาย ถ้าหายทุกเครื่องจะกลับไปใช้ค่า default เงียบๆ

-- ── ยาม: กันสร้างแถวอื่นนอกจาก 'app' และประทับเวลาเองเสมอ ─────────────────────
-- เวลาต้องมาจากเซิร์ฟเวอร์ ไม่ใช่นาฬิกาเครื่องผู้ใช้ เพราะฝั่งแอปใช้ค่านี้ตัดสินว่า
-- "ของใครใหม่กว่า" ถ้าเครื่องไหนตั้งนาฬิกาเพี้ยนไปข้างหน้า ค่าของเครื่องนั้นจะชนะตลอด
create or replace function guard_app_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id <> 'app' then
    raise exception 'ตารางตั้งค่ามีได้แถวเดียว (id = app)';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists app_settings_guard on app_settings;
create trigger app_settings_guard before insert or update on app_settings
  for each row execute function guard_app_settings();

-- ── realtime: อาจารย์กดเปิดฟอร์ม → เครื่องนักศึกษาที่เปิดแอปค้างอยู่เห็นทันที ────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'app_settings') then
    alter publication supabase_realtime add table app_settings;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
