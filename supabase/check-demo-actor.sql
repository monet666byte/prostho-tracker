-- ═══════════════════════════════════════════════════════════════════════════
-- "มีรายการที่จดชื่อคนทำเป็น นศ. Liv (ชื่อเดโม) ทั้งที่เป็นคนจริงไหม" — ก๊อปทั้งไฟล์ → SQL Editor → Run
--
-- อ่านอย่างเดียว ไม่แก้อะไร · statement เดียว ผลที่เห็นคือคำตอบเสมอ
--
-- ทำไมต้องมี (14 ก.ย. 69): เครื่องที่ล็อกอินครั้งแรกยังไม่มีรายชื่อในลิ้นชักตอนเปิดแอป
--   แอปจึงจดชื่อคนทำรายการเป็น "นศ. Liv" ไปจนกว่าจะปิดแอปเปิดใหม่ (แก้ในแอปแล้ว · test:first-login)
--   ชื่อนี้ลงไปที่ audit.who · updates.created_by · sect2/sect3 by_who
--   **audit แก้ไม่ได้โดยการออกแบบ** — ไฟล์นี้แค่บอกว่ามีกี่แถว และเป็นของบัญชีไหน (จาก actor_uid ซึ่งเชื่อได้)
--
-- ตัดข้อมูลตัวอย่างออก (นักศึกษา id `st-<กลุ่ม>-<1–8>` — ลายเซ็นเดียวกับ check-demo-rows.sql)
-- เพราะข้อมูลตัวอย่างใช้ชื่อ "นศ. Liv" อยู่แล้วโดยตั้งใจ
-- ⚠️ แถว audit ที่ไม่ผูกนักศึกษา (student_id ว่าง) ของข้อมูลตั้งต้นที่แอปดันขึ้นตอนเปิดระบบครั้งแรก
--    อาจโผล่มาด้วย — ดูวันที่ ถ้าตรงกับวันตั้งต้นระบบคือของตัวอย่าง ไม่ใช่คนจริง
-- ผลว่าง = ไม่โดน
-- ═══════════════════════════════════════════════════════════════════════════

select 'audit' as "ตาราง",
       coalesce(u.email, '(ไม่รู้บัญชี)') as "บัญชีที่ทำจริง",
       count(*) as "แถว",
       min(a.at_when)::text as "ครั้งแรก",
       max(a.at_when)::text as "ครั้งล่าสุด"
from audit a
left join app_users u on u.uid = a.actor_uid
where a.who = 'นศ. Liv'
  and (a.student_id is null or a.student_id !~ '^st-.+-[1-8]$')
group by u.email

union all
select 'updates (ประวัติ step)', '(ดูชื่อนักศึกษาเจ้าของงาน)', count(*), min(x.created_at)::text, max(x.created_at)::text
from updates x
join workpieces w on w.id = x.workpiece_id
where x.created_by = 'นศ. Liv' and w.student_id !~ '^st-.+-[1-8]$'
having count(*) > 0

union all
select 'sect2_records (ใบประเมิน)', '(ช่องผู้ประเมินผิด)', count(*), min(s.updated_at)::text, max(s.updated_at)::text
from sect2_records s
where s.by_who = 'นศ. Liv' and s.student_id !~ '^st-.+-[1-8]$'
having count(*) > 0

union all
select 'sect3_records (ใบประเมิน)', '(ช่องผู้ประเมินผิด)', count(*), min(s.updated_at)::text, max(s.updated_at)::text
from sect3_records s
where s.by_who = 'นศ. Liv' and s.student_id !~ '^st-.+-[1-8]$'
having count(*) > 0;
