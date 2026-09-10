-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ตรวจเนื้อข้อมูล (อ่านอย่างเดียว) · คู่กับ audit.sql
--
-- ⚠️ SQL Editor ของ Supabase โชว์ผลของ statement สุดท้ายเท่านั้น
--    ไฟล์นี้มี 4 คำถาม → **ก๊อปรันทีละบล็อก** (ไฮไลต์บล็อกที่ต้องการแล้วกด Run)
--    ไม่ใช่รันทั้งไฟล์ทีเดียว ไม่งั้นจะเห็นแค่คำตอบสุดท้าย
--
-- ต้องรัน 0009 กับ 0016 ให้ผ่านก่อน ไม่งั้นจะขึ้นว่าไม่มีตาราง pdpa_policy
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════

-- ①  สวิตช์ PDPA ตอนนี้เปิดอะไรไว้บ้าง — ก่อนคณะอนุมัติ ทุกช่องต้องเป็นค่าปิด
--     (retention_enabled = false · export_roles = {} · export_identified_roles = {})
select
  case when retention_enabled then '🔴 เปิดอยู่' else '🟢 ปิดอยู่' end as "ลบข้อมูลรุ่นเก่า",
  retention_cohorts                                                    as "เก็บย้อนหลัง (รุ่น)",
  case when cardinality(export_roles) = 0 then '🟢 ไม่มีใครส่งออกได้'
       else '🔴 ' || array_to_string(export_roles, ',') end            as "สิทธิ์ส่งออก",
  case when cardinality(export_identified_roles) = 0 then '🟢 ปิดบังชื่อ/HN เสมอ'
       else '🔴 ' || array_to_string(export_identified_roles, ',') end as "ส่งออกแบบมีชื่อ/HN",
  case when mask_by_default then '🟢 ปิดบังไว้ก่อน' else '🟠 ไม่ปิดบัง' end as "ปิดบังในหน้าจอ",
  updated_by                                                            as "แก้ล่าสุดโดย",
  updated_at                                                            as "เมื่อ"
from pdpa_policy where id = 'app';


-- ②  audit log ต้องไม่มีชื่อหรือ HN ผู้ป่วยอยู่ในข้อความ
--     เพราะแถว audit ลบไม่ได้ตามการออกแบบ ใส่ไปแล้วจะลบตาม retention ไม่ได้ตลอดกาล
--     (มองหาเลข HN แบบ 6–9 หลัก และรูปแบบ DEMO-xxxx ของข้อมูลตัวอย่าง)
select count(*) as "แถว audit ที่น่าจะมี HN ปนอยู่",
       min(at_when) as "เก่าสุด", max(at_when) as "ล่าสุด"
from audit
where text ~ '(HN|hn)[ :]*[0-9A-Za-z-]{4,}' or text ~ '\m[0-9]{6,9}\M';

-- ดูของจริง 20 แถวแรก (ถ้าเลขข้างบนไม่เป็นศูนย์)
select id, who, at_when, text
from audit
where text ~ '(HN|hn)[ :]*[0-9A-Za-z-]{4,}' or text ~ '\m[0-9]{6,9}\M'
order by at_when desc limit 20;


-- ③  นักศึกษาที่ยังไม่มีรุ่น (entry_year) — retention จะข้ามคนพวกนี้ไปเลย
--     เดารุ่นแล้วลบผิดคนคือความเสียหายที่กู้ไม่ได้ ระบบจึงเลือกไม่ลบ
select count(*) as "นศ. ที่ยังไม่มีรุ่น (retention จะไม่แตะ)"
from students where entry_year is null;


-- ④ นศ. ที่ยังไม่มีรุ่นในตู้กลาง มีจริงหรือแค่ยังไม่ได้ sync ขึ้นมา
--    คอลัมน์ entry_year เกิดตอน 0009 แถวที่ push ขึ้นไปก่อนหน้านั้นจึงว่างทั้งหมด
--    (และก่อนมีคอลัมน์นี้ การ push ตาราง students ถูกปฏิเสธทั้งก้อนด้วย)
--    แก้เอง: เปิดแอปในโหมด cloud หนึ่งครั้ง — ตอนเปิดแอปจะดันทุกแถวขึ้นใหม่
--    แล้วกลับมารันบล็อกนี้อีกที ตัวเลข "ยังไม่มีรุ่น" ควรเหลือ 0
select count(*) filter (where entry_year is null) as "ยังไม่มีรุ่น",
       count(*) filter (where entry_year is not null) as "มีรุ่นแล้ว",
       count(*) as "ทั้งหมด"
from students;
