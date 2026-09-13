-- ═══════════════════════════════════════════════════════════════════════════
-- "มีข้อมูลตัวอย่าง (ของปลอม) อยู่บนเซิร์ฟเวอร์ไหม" — ก๊อปทั้งไฟล์ → SQL Editor → Run
--
-- อ่านอย่างเดียว ไม่ลบอะไร · statement เดียว ผลที่เห็นคือคำตอบเสมอ
--
-- ทำไมต้องมี (13 ก.ย. 69): พิสูจน์ด้วยหน้าจอแอปจริงในโหมด cloud ว่า
--   อาจารย์เปิดหน้า "ตั้งค่าเกณฑ์" → แอปเขียนรุ่นที่จบแล้วแบบข้อมูลปลอมลงเครื่อง
--   → เปิดแอปครั้งถัดไป ของปลอมถูกดันขึ้นเซิร์ฟเวอร์ (บนเซิร์ฟเวอร์จำลอง: ผู้ป่วย 2 → 1,143)
--   บั๊กนี้มีมาตั้งแต่ 7 ก.ย. 69 และแก้ในแอปแล้ว · ไฟล์นี้ดูว่าเซิร์ฟเวอร์จริงโดนไปแล้วหรือยัง
-- และอีกทางที่เป็นไปได้: ตอนตั้งต้นระบบครั้งแรก แอปดันข้อมูลตัวอย่างขึ้นไปเป็นของตั้งต้นโดยตั้งใจ
--   (cloudSync.ts · "ตู้กลางยังว่างจริงๆ → เอา fixture ในเครื่องขึ้นไปตั้งต้น")
--
-- ── ลายเซ็นของข้อมูลตัวอย่าง (ต้องตรงกับ isDemoStudentId / isDemoHn ใน src/data/seed.ts) ──
--   นักศึกษา: id `st-<กลุ่ม>-<ลำดับ 1–8>`   ← นักศึกษาจริงที่นำเข้ารายชื่อได้ `st-<กลุ่ม>-<รหัส 7 หลัก>`
--   ผู้ป่วย:   HN ขึ้นต้น `DEMO-`
--   ห้ามจับด้วยรหัสกลุ่มหรือชื่อ — รุ่นจริงในอนาคตใช้รหัสกลุ่มรูปแบบเดียวกันได้
-- ═══════════════════════════════════════════════════════════════════════════

with
demo_students as (select id from students where id ~ '^st-.+-[1-8]$'),
real_students  as (select id from students where id !~ '^st-.+-[1-8]$'),
demo_patients  as (
  select id from patients
  where hn like 'DEMO-%' or owner_student_id in (select id from demo_students)
),
demo_works as (
  select id from workpieces
  where student_id in (select id from demo_students) or patient_id in (select id from demo_patients)
)
select 'นักศึกษา' as "ตาราง",
       (select count(*) from demo_students) as "ข้อมูลตัวอย่าง",
       (select count(*) from real_students) as "ข้อมูลอื่น (ไม่แตะ)"
union all select 'ผู้ป่วย',
       (select count(*) from demo_patients),
       (select count(*) from patients) - (select count(*) from demo_patients)
union all select 'ชิ้นงาน',
       (select count(*) from demo_works),
       (select count(*) from workpieces) - (select count(*) from demo_works)
union all select 'บันทึก step',
       (select count(*) from updates where workpiece_id in (select id from demo_works)),
       (select count(*) from updates where workpiece_id not in (select id from demo_works))
union all select 'คาบคลินิก',
       (select count(*) from checkins where student_id in (select id from demo_students)),
       (select count(*) from checkins where student_id not in (select id from demo_students))
union all select 'แบบประเมินตนเอง',
       (select count(*) from self_assessments where student_id in (select id from demo_students)),
       (select count(*) from self_assessments where student_id not in (select id from demo_students))
union all select 'สมุด Section II',
       (select count(*) from sect2_records where student_id in (select id from demo_students)),
       (select count(*) from sect2_records where student_id not in (select id from demo_students))
union all select 'สมุด Section III',
       (select count(*) from sect3_records where student_id in (select id from demo_students)),
       (select count(*) from sect3_records where student_id not in (select id from demo_students));

-- ถ้าคอลัมน์ "ข้อมูลตัวอย่าง" เป็น 0 ทุกแถว = เซิร์ฟเวอร์สะอาด ไม่ต้องทำอะไร
-- ถ้าไม่ใช่ 0 และต้องการลบ: อ่านหัวไฟล์ supabase/remove-demo-rows.sql ก่อนรัน
-- ⚠️ ถ้า "ข้อมูลอื่น" เป็น 0 ด้วย แปลว่าทั้งเซิร์ฟเวอร์คือข้อมูลตัวอย่าง (สภาพก่อนนำเข้ารายชื่อจริง)
