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
  union all select '0020 อาจารย์ทับโน้ตของนักศึกษาไม่ได้',
    exists (select 1 from pg_proc where proname = 'guard_checkin_scoring'
            and pg_get_functiondef(oid) like '%new.note := old.note%')
) x
order by x.label;
