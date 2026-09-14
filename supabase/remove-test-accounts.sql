-- ═══════════════════════════════════════════════════════════════════════════
-- ลบบัญชีทดสอบ @example.com ออกจากเซิร์ฟเวอร์จริง — ⚠️ ลบจริง (ผู้ใช้เคาะ 14 ก.ย. 69)
--
-- ทำไม: ภาคอนุญาตให้เก็บข้อมูลผู้ป่วยจริงช่วงนำร่อง · demo@ / ajarn-test@ มีสิทธิ์อาจารย์
--   = ใครล็อกอินบัญชีนี้ได้ เห็นผู้ป่วยจริงทุกคน · 0003 ใส่ไว้ตอนพัฒนาและไม่มีไฟล์ไหนลบ
-- พรีเซนต์ใช้เว็บเดโม (GitHub Pages · ข้อมูลสมมติ ไม่แตะเซิร์ฟเวอร์) แทน
--
-- ลบ: auth.users (บัญชีล็อกอิน → app_users / link_requests หายตาม cascade) + invites
-- ไม่ลบ: audit (ลบไม่ได้ตามการออกแบบ) · ข้อมูลตัวอย่าง (ใช้ remove-demo-rows.sql)
--
-- ลำดับก่อนนำร่อง: ① ไฟล์นี้ → ② ย้ายบัญชีเจ้าของออกจากตัวละครตัวอย่าง (SQL ในแชท) → ③ remove-demo-rows.sql
-- ทั้งไฟล์เป็น transaction เดียว — บรรทัดไหนล้มย้อนกลับหมด · ผลตอนจบ = จำนวนที่ลบ
-- ═══════════════════════════════════════════════════════════════════════════

create temporary table _test_emails on commit drop as
  select unnest(array['demo@example.com', 'ajarn-test@example.com', 'nak-test@example.com']) as email;

create temporary table _removed (what text, n bigint) on commit drop;

with d as (delete from auth.users where lower(email) in (select email from _test_emails) returning 1)
insert into _removed select 'บัญชีล็อกอิน (auth.users)', count(*) from d;

with d as (delete from invites where lower(email) in (select email from _test_emails) returning 1)
insert into _removed select 'รายชื่อเชิญ (invites)', count(*) from d;

select what as "ลบ", n as "จำนวน",
       case when what like 'บัญชี%' then
         (select count(*) from app_users where lower(email) in (select email from _test_emails))::text || ' แถว app_users ที่เหลือ (ต้องเป็น 0)'
       else '' end as "ตรวจ"
from _removed;
