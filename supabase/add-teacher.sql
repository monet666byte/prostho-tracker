-- ═══════════════════════════════════════════════════════════════════════════
-- เพิ่มอาจารย์ (หรือแก้ชื่อ/สิทธิ์อาจารย์ที่มีอยู่แล้ว) — ก๊อปทั้งไฟล์ → SQL Editor → แก้บรรทัดใต้ "แก้ตรงนี้" → Run
--
-- ทำอะไร (statement เดียว · รันซ้ำได้ ไม่สร้างซ้ำ):
--   ① สร้าง/อัปเดตแถวในตาราง teachers (ชื่อไทย + ชื่ออังกฤษ)
--   ② ใส่อีเมลลงรายชื่อเชิญ (invites) ในฐานะอาจารย์ → กดปุ่ม Google ด้วยอีเมลนี้แล้วเข้าได้เลย
--   ③ ถ้าอีเมลนี้เคยมีบัญชีในระบบแล้ว อัปเดตบัญชีนั้นให้เป็นอาจารย์ด้วย
--
-- id อาจารย์: ถ้าอีเมลนี้เคยเชิญไว้แล้ว ใช้ id เดิม · ถ้าใหม่ สร้างจากอีเมล (tc-xxxxxxxxxx) — ไม่มีชื่อคนอยู่ใน id
-- กลุ่มที่ปรึกษา: ไม่ต้องใส่ อาจารย์เลือกเองในแอปตอนเข้าครั้งแรก (0024)
-- นักศึกษา: ไม่ต้องใช้ไฟล์นี้ — นำเข้าจากแบบฟอร์มในหน้า "รายชื่อ & นำเข้า" ของแอป (มีอีเมล = ได้สิทธิ์เข้าระบบทันที)
--
-- ⚠️ ไฟล์นี้อยู่ใน repo ที่เป็น public — แก้ค่าใน SQL Editor เท่านั้น ห้ามบันทึกอีเมล/ชื่อจริงกลับลงไฟล์นี้
-- ═══════════════════════════════════════════════════════════════════════════

with input (email, name, name_en, is_admin) as (
  values
    -- ▼▼▼ แก้ตรงนี้ · บรรทัดละ 1 ท่าน · หลายท่านให้คั่นด้วยจุลภาค ท่านสุดท้ายไม่มีจุลภาค ▼▼▼
    -- (อีเมลที่ใช้กดปุ่ม Google, ชื่อไทย, ชื่ออังกฤษ ไม่มีให้ใส่ '', true = หัวหน้ารายวิชา ปกติ false)
    ('name.sur@mahidol.edu', 'อ.ทพ. ชื่อ นามสกุล', 'Dr. Firstname Lastname', false)
    -- ,('name2.sur@mahidol.edu', 'อ.ทพ.ญ. ชื่อ นามสกุล', 'Dr. Firstname Lastname', false)
    -- ▲▲▲ แก้ตรงนี้ ▲▲▲
),
p as (
  select distinct on (lower(trim(i.email)))
    lower(trim(i.email)) as email,
    trim(i.name) as name,
    nullif(trim(i.name_en), '') as name_en,
    i.is_admin,
    coalesce(
      (select v.teacher_id from invites v where lower(v.email) = lower(trim(i.email)) and v.teacher_id is not null),
      'tc-' || substr(encode(sha256(convert_to(lower(trim(i.email)), 'UTF8')), 'hex'), 1, 10)
    ) as teacher_id
  from input i
  where trim(i.email) like '%_@_%.__%' and trim(i.name) <> ''
    -- กันกด Run ทั้งที่ยังไม่ได้แก้ — ค่าตัวอย่างจะไม่ถูกบันทึกลงเซิร์ฟเวอร์จริง
    and lower(trim(i.email)) not like 'name%.sur@mahidol.edu'
),
t as (
  insert into teachers (id, name, name_en)
  select teacher_id, name, name_en from p
  -- ชื่ออังกฤษเว้นว่างตอนรันซ้ำ = คงของเดิม ไม่ลบทิ้ง
  on conflict (id) do update set name = excluded.name, name_en = coalesce(excluded.name_en, teachers.name_en)
  returning id
),
inv as (
  insert into invites (email, role, student_id, teacher_id, is_admin)
  select email, 'teacher', null, teacher_id, is_admin from p
  on conflict (email) do update
    set role = 'teacher', teacher_id = excluded.teacher_id, is_admin = excluded.is_admin
  returning email
),
acct as (
  update app_users a
     set role = 'teacher', teacher_id = p.teacher_id, is_admin = p.is_admin
    from p
   where lower(a.email) = p.email
  returning lower(a.email) as email
)
select
  coalesce(p.email, lower(trim(i.email)))                                   as "อีเมล",
  case when p.email is null then '✗ ไม่ได้บันทึก — ยังเป็นอีเมลตัวอย่าง อีเมลผิดรูป หรือชื่อไทยว่าง' else '✓ บันทึกแล้ว' end as "ผล",
  p.teacher_id                                                              as "id อาจารย์",
  p.name                                                                    as "ชื่อไทย",
  p.name_en                                                                 as "ชื่ออังกฤษ (ว่าง = คงของเดิม)",
  case when p.email is null then null when p.is_admin then 'หัวหน้ารายวิชา' else 'อาจารย์' end as "สิทธิ์",
  case when p.email is null then null
       when exists (select 1 from acct c where c.email = p.email) then 'มีบัญชีแล้ว — อัปเดตเป็นอาจารย์แล้ว ให้ปิดแอปเปิดใหม่'
       else 'ยังไม่มีบัญชี — กดปุ่ม Google ด้วยอีเมลนี้ได้เลย' end        as "บัญชี"
from input i
left join p on p.email = lower(trim(i.email));


-- ─── ดูรายชื่ออาจารย์ทั้งหมดที่เชิญไว้ (ก๊อปไปรันแยก) ─────────────────────────
-- select i.email, t.name, t.name_en, i.is_admin as "หัวหน้ารายวิชา",
--        exists (select 1 from app_users a where lower(a.email) = lower(i.email)) as "สมัครแล้ว"
-- from invites i left join teachers t on t.id = i.teacher_id
-- where i.role = 'teacher' order by t.name;

-- ─── เอาอาจารย์ออกจากรายชื่อเชิญ (ก๊อปไปรันแยก · แก้อีเมลก่อน) ────────────────
-- ลบแค่สิทธิ์เข้าระบบใหม่ · แถวใน teachers เก็บไว้ เพราะใบประเมิน/ประวัติเก่าอ้างถึงอยู่
-- คนที่สมัครไปแล้วต้องลบบัญชีในหน้า Authentication → Users อีกที
-- delete from invites where lower(email) = lower('name.sur@mahidol.edu');
