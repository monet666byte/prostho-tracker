-- ═══════════════════════════════════════════════════════════════════════════
-- ตรวจความปลอดภัยของเซิร์ฟเวอร์จริง — ก๊อปทั้งไฟล์ → SQL Editor → Run
--
-- statement เดียว ผลที่เห็นคือคำตอบเสมอ (บทเรียนจาก audit.sql ที่ผลถูกกลบ)
-- อ่านอย่างเดียว ไม่แก้อะไร · รันซ้ำได้ทุกเมื่อ ควรรันก่อนรับข้อมูลผู้ป่วยจริง
-- และทุกครั้งหลังรัน migration ใหม่
--
-- 🔴 = ต้องแก้ก่อนมีข้อมูลจริง · 🟠 = ต้องมีคนตัดสินใจ · ✅ = ผ่าน
-- ถ้าไม่มีแถว 🔴 เลย แปลว่าเรื่องที่ตรวจด้วย SQL ได้ผ่านหมด
-- (เรื่องที่ตรวจด้วย SQL ไม่ได้ อยู่ท้ายไฟล์ ต้องเปิดดูในหน้า Dashboard เอง)
-- ═══════════════════════════════════════════════════════════════════════════

with findings as (

  -- ① ตารางที่ลืมเปิด RLS = ใครล็อกอินก็อ่าน/เขียนได้ทั้งตาราง
  select 1 as ord, '🔴' as ระดับ, 'ตารางไม่ได้เปิด RLS' as เรื่อง,
         c.relname::text as ที่ไหน,
         'ทุกคนที่ล็อกอิน (หรือไม่ล็อกอิน) อ่าน/เขียนตารางนี้ได้หมด' as รายละเอียด
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all
  -- ② กฎที่เปิดให้คนไม่ได้ล็อกอิน
  select 2, '🔴', 'กฎเปิดให้คนไม่ได้ล็อกอิน',
         tablename || ' · ' || policyname,
         'role = ' || array_to_string(roles, ', ') || ' · คำสั่ง ' || cmd
  from pg_policies
  where schemaname in ('public', 'storage')
    and (roles && array['anon', 'public']::name[])

  union all
  -- ③ กฎเขียนที่ไม่กรองอะไรเลย
  select 3, '🔴', 'กฎเขียนที่ไม่กรองอะไร',
         tablename || ' · ' || policyname,
         'คำสั่ง ' || cmd || ' ใช้เงื่อนไข true — ใครล็อกอินก็เขียนได้'
  from pg_policies
  where schemaname = 'public'
    and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')

  union all
  -- ④ นักศึกษาอ่าน audit ของเพื่อนร่วมกลุ่มได้ (แก้ใน 0021)
  select 4, '🔴', 'นักศึกษาอ่าน audit ของเพื่อนในกลุ่มได้',
         'audit · audit_read',
         'กฎยังไม่เช็คว่าเป็นอาจารย์ก่อนเปิดเรื่องของกลุ่ม — รัน 0021'
  from pg_policies
  where schemaname = 'public' and tablename = 'audit' and policyname = 'audit_read'
    and qual like '%is_my_student%' and qual not like '%is_teacher%'

  union all
  -- ⑤ ฟังก์ชันที่คนไม่ได้ล็อกอินเรียกได้ (แก้ใน 0021)
  select 5, '🔴', 'คนไม่ได้ล็อกอินเรียกฟังก์ชันได้',
         p.proname::text,
         'ฟังก์ชัน security definer · เปิดเป็น /rest/v1/rpc/' || p.proname || ' — รัน 0021'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')

  union all
  -- ⑥ แถวรูปที่ชี้ไปไฟล์ในโฟลเดอร์ของคนอื่น (ร่องรอยว่าเคยถูกใช้ช่องที่ 0021 ปิด)
  select 6, '🔴', 'แถวรูปชี้ไปไฟล์ของนักศึกษาคนอื่น',
         'photos · ' || ph.id,
         'storage_path อยู่ในโฟลเดอร์ ' || split_part(ph.storage_path, '/', 1)
           || ' แต่ชิ้นงานเป็นของ ' || w.student_id
  from photos ph join workpieces w on w.id = ph.workpiece_id
  where ph.storage_path is not null
    and split_part(ph.storage_path, '/', 1) <> w.student_id

  union all
  -- ⑦ บักเก็ตรูปต้องไม่เป็นสาธารณะ
  select 7, '🔴', 'บักเก็ตรูปเปิดสาธารณะ',
         b.id::text, 'ใครมีลิงก์ก็เปิดรูปในปากคนไข้ได้โดยไม่ต้องล็อกอิน'
  from storage.buckets b
  where b.id = 'case-photos' and b.public

  union all
  -- ⑧ บัญชีทดสอบบนเซิร์ฟเวอร์จริง
  --    0003 ใส่ไว้สามอีเมล และ 0005 ตั้ง demo@example.com เป็นหัวหน้าภาค
  --    ไม่มี migration ไหนลบออก · ใครได้บัญชีนี้ = เห็นข้อมูลทั้งระบบ จัดการรายชื่อเชิญ
  --    และสั่งลบข้อมูลตามกำหนดเก็บได้ · ถ้าหน้า Authentication ปิด "Confirm email" ไว้
  --    และบัญชียังไม่เคยถูกสมัคร ใครก็สมัครด้วยอีเมลนี้ได้ทันที
  select 8, '🟠', 'บัญชีทดสอบบนเซิร์ฟเวอร์จริง',
         i.email,
         'บทบาท ' || i.role
           || case when i.is_admin then ' · หัวหน้าภาค' else '' end
           || case when i.teacher_id is not null then ' · สิทธิ์อาจารย์' else '' end
           || case when exists (select 1 from app_users u where lower(u.email) = lower(i.email))
                   then ' · สมัครแล้ว (ต้องมีรหัสผ่านที่เดายาก)' else ' · ยังไม่มีคนสมัคร' end
  from invites i
  where i.email ilike '%@example.com'

  union all
  -- ⑨ รายชื่อหัวหน้าภาคทั้งหมด — ทุกคนในนี้เห็นข้อมูลทั้งระบบ ต้องรู้จักทุกชื่อ
  --    (แยกสองท่อนแทน full join — full join ด้วย lower() บางรุ่นของ Postgres ไม่รับ)
  select 9, '🟠', 'บัญชีที่มีสิทธิ์หัวหน้าภาค', i.email,
         case when exists (select 1 from app_users u where lower(u.email) = lower(i.email))
              then 'สมัครแล้ว' else 'เชิญแล้ว ยังไม่สมัคร' end
  from invites i
  where i.is_admin

  union all
  select 9, '🟠', 'บัญชีที่มีสิทธิ์หัวหน้าภาค', u.email,
         'สมัครแล้ว แต่ไม่อยู่ในรายชื่อเชิญ — ต้องรู้ว่ามาจากไหน'
  from app_users u
  where u.is_admin
    and not exists (select 1 from invites i where lower(i.email) = lower(u.email))

  union all
  -- ⑩ อีเมลที่เชิญแล้วแต่เจ้าตัวยังไม่สมัคร
  --    0009 กันคนนอกรายชื่อสมัครได้แล้ว แต่คนที่ **รู้อีเมลที่อยู่ในรายชื่อ** ยังสมัครแทนได้
  --    ถ้าหน้า Authentication ปิด "Confirm email" ไว้ — เพราะไม่ต้องเข้ากล่องจดหมายนั้นเลย
  --    อีเมลอาจารย์หาได้จากเว็บคณะ · สมัครก่อนเจ้าตัว = ได้สิทธิ์อาจารย์ เห็นข้อมูลผู้ป่วยทั้งชั้นปี
  --    แถวนี้ไม่ใช่ปัญหาถ้า Confirm email เปิดอยู่ — ต้องเปิดดูในหน้า Dashboard ยืนยัน
  select 11, '🟠', 'อีเมลที่เชิญแล้ว ยังไม่มีคนสมัคร',
         i.role || ' ' || count(*)::text || ' บัญชี',
         'ปลอดภัยเฉพาะเมื่อ Authentication เปิด Confirm email · ถ้าปิดอยู่ ใครรู้อีเมลก็สมัครแทนได้'
  from invites i
  where not exists (select 1 from app_users u where lower(u.email) = lower(i.email))
  group by i.role

  union all
  -- ⑩ สรุปว่า 0021 ลงหรือยัง
  select 10,
         case when exists (select 1 from pg_trigger where tgname = 'photos_path_guard')
              then '✅' else '🔴' end,
         'migration 0021 (ปิดช่องจากการตรวจ 13 ก.ย.)',
         'photos_path_guard',
         case when exists (select 1 from pg_trigger where tgname = 'photos_path_guard')
              then 'ลงแล้ว' else 'ยังไม่ได้รัน' end
)

select ระดับ, เรื่อง, ที่ไหน, รายละเอียด
from findings
order by ord, ที่ไหน;

-- ═══════════════════════════════════════════════════════════════════════════
-- เรื่องที่ SQL ตรวจไม่ได้ — เปิดดูใน Supabase Dashboard เอง
--
-- Authentication → Sign In / Providers → Email
--   · Confirm email          ต้อง "เปิด" ← สำคัญที่สุดในหน้านี้
--       ปิด = ใครรู้อีเมลที่อยู่ในรายชื่อเชิญ (อีเมลอาจารย์หาได้จากเว็บคณะ) สมัครแทนเจ้าตัวได้
--       โดยไม่ต้องเข้ากล่องจดหมายนั้น แล้วได้สิทธิ์ของคนนั้นทันที (ดูแถว ⑪)
--   · Secure email change    ต้อง "เปิด"
-- Authentication → Policies (หรือ Attack Protection)
--   · Leaked password protection   เปิดถ้าแผนที่ใช้มีให้
--   · ความยาวรหัสผ่านขั้นต่ำ          อย่างน้อย 8 ตัว
-- Authentication → Users
--   · บัญชี @example.com ที่ขึ้นในแถว ⑧ — ลบทิ้งหรือเปลี่ยนรหัสให้ยาวและสุ่ม
-- Project Settings → API
--   · service_role key ต้องไม่อยู่ในโค้ดแอป ไม่อยู่ใน GitHub ไม่อยู่ในแชท
-- ═══════════════════════════════════════════════════════════════════════════
