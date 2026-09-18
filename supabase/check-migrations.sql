-- ═══════════════════════════════════════════════════════════════════════════
-- "migration ไหนลงแล้วบ้าง" — ก๊อปทั้งไฟล์ → SQL Editor → Run
--
-- ทำไมต้องมีไฟล์แยก: `audit.sql` มีหลาย statement และ **SQL Editor โชว์ผลของ
-- statement สุดท้ายเท่านั้น** ตารางสถานะจึงมักถูกกลบ (เจอมาแล้ว 10 ก.ย. 69)
-- ไฟล์นี้มี statement เดียว เพื่อให้ผลที่เห็นคือคำตอบเสมอ
--
-- ⚠️ ทุกบรรทัดดูจาก **ร่องรอยที่ migration นั้นทิ้งไว้จริง** ไม่ใช่จากตารางบันทึกเวอร์ชัน
--    (โปรเจกต์นี้รัน SQL ด้วยมือ ไม่มีตารางนั้น) · ถ้าขึ้น "ยังไม่ได้รัน" แปลว่า
--    ของที่ควรเกิดยังไม่เกิด ซึ่งเชื่อถือได้กว่าความจำของใครก็ตาม
--
-- ⚠️ `0009` ดูสามร่องรอยพร้อมกัน เพราะ SQL Editor ห่อทั้งไฟล์เป็น transaction เดียว
--    บรรทัดไหนล้ม = ย้อนกลับหมด · ได้ครบสามแปลว่าลงผ่านจริง ไม่ใช่ลงครึ่งเดียว
-- ═══════════════════════════════════════════════════════════════════════════

select
  case when x.present then '✓ รันแล้ว' else '✗ ยังไม่ได้รัน' end as "สถานะ",
  x.label                                                        as "migration"
from (
  select '0003 auth (ตาราง app_users)' as label,
         to_regclass('public.app_users') is not null as present

  -- 0009 ทำ 4 อย่างในไฟล์เดียว — ดูร่องรอยสามตัวที่ต้องมีพร้อมกัน
  union all select '0009 ปิดช่องโหว่ (entry_year + audit แก้ไม่ได้)',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'students'
              and column_name = 'entry_year')
    and exists (select 1 from pg_trigger where tgname = 'audit_no_change')
    and exists (select 1 from pg_trigger where tgname = 'audit_stamp')

  union all select '0010 แบบประเมินตนเอง',
    to_regclass('public.self_assessments') is not null

  union all select '0012 สมุด portfolio (Section II/III)',
    to_regclass('public.sect2_records') is not null

  union all select '0014 ค่าตั้งของภาค',
    to_regclass('public.app_settings') is not null

  union all select '0016 PDPA (ตาราง pdpa_policy)',
    to_regclass('public.pdpa_policy') is not null

  union all select '0017 กันข้อมูลชนกัน (ตราเวลาฝั่งเซิร์ฟเวอร์)',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'touch_updated_at')

  union all select '0018 คลังรูปบนเซิร์ฟเวอร์ (บักเก็ต case-photos)',
    exists (select 1 from storage.buckets where id = 'case-photos')

  union all select '0019 ปิดช่องในตัวลบตามกำหนดเก็บ',
    exists (select 1 from pg_proc where proname = 'purge_expired_cohorts'
            and pg_get_functiondef(oid) like '%accounts_left%')

  -- 0020 แทนฟังก์ชันชื่อเดิมของ 0017 — ดูชื่อไม่ได้ ต้องดูเนื้อใน
  -- ⚠️ ต้องเป็น regex ที่ยอมให้เว้นวรรคกี่ช่องก็ได้ ไม่ใช่ like — ในไฟล์จริงจัดแนวไว้เป็น
  --    `new.note        := old.note` · ครั้งแรกเขียน like '%new.note := old.note%' แล้วมันตอบว่า
  --    "ยังไม่ได้รัน" ทั้งที่รันไปแล้ว (จับได้ 13 ก.ย. 69 ตอนรันไฟล์นี้บน Postgres จริงในเครื่อง)
  union all select '0020 อาจารย์ทับโน้ตของนักศึกษาไม่ได้',
    exists (select 1 from pg_proc where proname = 'guard_checkin_scoring'
            and pg_get_functiondef(oid) ~ 'new\.note\s*:=\s*old\.note')

  union all select '0021 ปิดช่องจากการตรวจความปลอดภัย 13 ก.ย.',
    exists (select 1 from pg_trigger where tgname = 'photos_path_guard')

  -- 0022 ไม่สร้างของใหม่ — ดูผลของมัน: บัญชีสาธิตต้องไม่ใช่หัวหน้าภาค
  union all select '0022 ถอดหัวหน้าภาคจากบัญชีสาธิต demo@',
    not exists (select 1 from invites where lower(email) = 'demo@example.com' and is_admin)
    and not exists (select 1 from app_users where lower(email) = 'demo@example.com' and is_admin)

  -- 0023 ดูสองร่องรอยพร้อมกัน (ตาราง + trigger สมัครบัญชีรุ่นใหม่)
  union all select '0023 นักศึกษาผูกบัญชีเอง + อาจารย์ยืนยัน',
    to_regclass('public.link_requests') is not null
    and exists (select 1 from pg_proc where proname = 'handle_new_user'
                and pg_get_functiondef(oid) like '%self_link_email_ok%')

  -- 0024 ดูสามร่องรอย (คอลัมน์ปี · ตัวล้างขึ้นปีใหม่ · กฎ audit ที่ครอบทุกกลุ่ม)
  union all select '0024 ที่ปรึกษากลุ่ม (หลายท่าน · หลายกลุ่ม · ล้างเมื่อขึ้นปี)',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'groups' and column_name = 'advisor_year')
    and exists (select 1 from pg_proc where proname = 'reset_advisors_for_new_year')
    and exists (select 1 from pg_policies where tablename = 'audit' and policyname = 'audit_read'
                and qual like '%my_advised_groups%')

  -- 0025 ช่องชื่ออังกฤษต้องมีทั้งสองตาราง
  union all select '0025 ชื่อภาษาอังกฤษ (นักศึกษา + อาจารย์)',
    (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name in ('students', 'teachers') and column_name = 'name_en') = 2

  -- 0026 สวิตช์ใช้ชื่อผู้ป่วย: คอลัมน์ + trigger ล้างชื่อ
  union all select '0026 สวิตช์ใช้ชื่อผู้ป่วย (นำร่องใช้แค่ HN)',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'pdpa_policy' and column_name = 'patient_names')
    and exists (select 1 from pg_trigger where tgname = 'zz_zz_strip_patient_name')

  -- 0027 ดูสามร่องรอย (trigger กันลบคาบ · ตัวนับคำขอผูกบัญชี · กฎอ่านที่เช็ค my_role)
  -- qual ของ policy ถูกจัดรูปโดย Postgres เอง (`(my_role() IS NOT NULL)`) จึงใช้ like ได้ ไม่มีเว้นวรรคหลายช่อง
  union all select '0027 ปิดช่องก่อนส่งมอบ (ลบคาบที่ประเมินแล้ว · เพดาน request_link · บัญชีทดสอบ)',
    exists (select 1 from pg_trigger where tgname = 'checkin_delete_guard')
    and exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'link_requests' and column_name = 'attempts')
    and exists (select 1 from pg_policies where tablename = 'teachers' and policyname = 'teachers_read'
                and qual like '%my_role()%')

  -- 0028 ดูสองร่องรอย (ตัวกู้แบบประเมินตนเอง · ยามที่ปรึกษากลุ่ม)
  union all select '0028 กู้แบบประเมินตนเองได้ · ที่ปรึกษากลุ่มแก้ผ่านฟังก์ชันเท่านั้น',
    exists (select 1 from pg_proc where proname = 'restore_self_assessments')
    and exists (select 1 from pg_trigger where tgname = 'groups_guard_advisors')
) x
order by x.label;
