-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ตรวจเนื้อข้อมูล (อ่านอย่างเดียว) · คู่กับ audit.sql
--
-- ⚠️ SQL Editor ของ Supabase โชว์ผลของ statement สุดท้ายเท่านั้น
--    ไฟล์นี้มี 4 คำถาม → **ก๊อปรันทีละบล็อก** (ไฮไลต์บล็อกที่ต้องการแล้วกด Run)
--    ไม่ใช่รันทั้งไฟล์ทีเดียว ไม่งั้นจะเห็นแค่คำตอบสุดท้าย
--
-- บล็อก ① อ่านตาราง pdpa_policy (0016) และคอลัมน์ patient_names (0026) — ยืนยันด้วย
-- check-migrations.sql ว่าสองไฟล์นั้นลงแล้ว ไม่งั้นจะขึ้นว่าไม่มีตาราง/คอลัมน์
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════

-- ①  สวิตช์ PDPA ตอนนี้เปิดอะไรไว้บ้าง — ก่อนคณะอนุมัติ ทุกช่องต้องเป็นค่าปิด
--     (retention_enabled = false · export_roles = {} · export_identified_roles = {} · patient_names = false)
select
  case when patient_names then '🟠 เก็บชื่อผู้ป่วย' else '🟢 ใช้แค่ HN' end as "ชื่อผู้ป่วย (0026)",
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


-- ⑤ แถวกำพร้า — ชี้ไปหาของที่ไม่มีอยู่แล้ว
--    ไม่มี foreign key ระหว่างตารางพวกนี้ (ดู 0001) การลบจึงไม่มีอะไรเตือน
--    ปกติควรเป็น 0 ทุกช่อง · ไม่เป็น 0 = มีการลบที่ไม่ครบสาย เช่นลบผู้ป่วยทิ้งแต่ชิ้นงานยังอยู่
select
  (select count(*) from workpieces w where not exists (select 1 from patients p where p.id = w.patient_id))
    as "ชิ้นงานที่ชี้ไปหาผู้ป่วยที่ไม่มีแล้ว",
  (select count(*) from workpieces w where not exists (select 1 from students s where s.id = w.student_id))
    as "ชิ้นงานที่ชี้ไปหา นศ. ที่ไม่มีแล้ว",
  (select count(*) from patients p where not exists (select 1 from students s where s.id = p.owner_student_id))
    as "ผู้ป่วยที่เจ้าของไม่มีแล้ว",
  (select count(*) from updates u where not exists (select 1 from workpieces w where w.id = u.workpiece_id))
    as "ประวัติ step ที่ชิ้นงานไม่มีแล้ว",
  (select count(*) from photos ph where not exists (select 1 from workpieces w where w.id = ph.workpiece_id))
    as "รูปที่ชิ้นงานไม่มีแล้ว";


-- ⑥ บัญชีล็อกอินที่ไม่มีนักศึกษาอยู่ในระบบแล้ว
--    เกิดหลังลบตามกำหนดเก็บ — purge ลบแถว students แต่ไม่ลบบัญชี (ตั้งใจ ดู 0019 ②)
--    ตาราง app_users เก็บ "อีเมล" ไว้ ซึ่งเป็นข้อมูลส่วนบุคคล
--    ต้องเอารายชื่อนี้ไปลบเองที่ Authentication → Users (ลบที่นั่นแล้ว app_users หายตามเอง)
select u.email, u.role, u.student_id, u.created_at
from app_users u
where u.student_id is not null
  and not exists (select 1 from students s where s.id = u.student_id)
order by u.created_at;
