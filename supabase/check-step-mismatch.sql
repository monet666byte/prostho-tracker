-- ═══════════════════════════════════════════════════════════════════════════
-- "มีเคสไหนที่ประวัติบอกว่าทำ step แล้ว แต่ตัวเคสยังไม่ขยับไหม" — ก๊อปทั้งไฟล์ → SQL Editor → Run
--
-- อ่านอย่างเดียว ไม่แก้อะไร · statement เดียว · ไม่แสดงชื่อ/HN ผู้ป่วย (มีแค่รหัสเคสกับรหัสนักศึกษา)
--
-- ทำไมต้องมี (13 ก.ย. 69): ซ้อม "อัปเดตแอปบนเครื่องที่ใช้งานอยู่" ด้วยแอปรุ่นเก่าตัวจริง
--   (scripts/test-upgrade.mts) พบว่าเครื่องที่ติดแอปรุ่นก่อน 11 ก.ย. 69 ถ้ากด step ตอนออฟไลน์
--   แล้วปิดแอปก่อนเน็ตกลับ → ตอนเปิดใหม่ แถวประวัติ (updates) ขึ้นเซิร์ฟเวอร์ แต่เลข step ของเคสถูกย้อน
--   อัปเดตเป็นรุ่นใหม่แล้วก็ไม่กลับมาเอง เพราะเสียหายไปตั้งแต่ตอนแอปรุ่นเก่าเปิด
--   (บั๊กต้นทางแก้แล้วใน commit c73ff80 · ไฟล์นี้ใช้ดูว่ามีเคสไหนโดนไปก่อนหน้านั้นหรือเปล่า)
--
-- วิธีตัดสิน: ดูแถวประวัติ "ล่าสุด" ของแต่ละเคส
--   · กดผ่าน step      → เคสต้องอยู่ที่ step นั้น
--   · กดเลิกทำ (reversal) → เคสต้องอยู่ก่อน step นั้นหนึ่งขั้น
--   และนับเฉพาะเมื่อแถวประวัตินั้น "ใหม่กว่า" การแก้เคสครั้งล่าสุด
--   (ถ้าเคสถูกแก้ทีหลัง เช่น อาจารย์ตีกลับ/นำเข้าชีต ถือว่าตั้งใจ ไม่นับว่าผิด)
--
-- ผลว่าง = ไม่มีเคสที่ไม่ตรงกัน · มีแถว = ให้นักศึกษาเจ้าของเปิดเคสนั้นแล้วกด step ให้ตรงอีกครั้ง
-- ═══════════════════════════════════════════════════════════════════════════

with latest as (
  select distinct on (u.workpiece_id)
         u.workpiece_id, u.proc_index, u.reversal, u.created_at
  from updates u
  order by u.workpiece_id, u.created_at desc, u.id desc
)
select w.id                 as "รหัสเคส",
       w.student_id         as "นักศึกษา",
       w.type               as "ประเภท",
       w.proc_index         as "step ในเคส",
       case when l.reversal then l.proc_index - 1 else l.proc_index end as "step ตามประวัติ",
       l.created_at         as "ประวัติล่าสุดเมื่อ",
       w.last_updated_at    as "แก้เคสล่าสุดเมื่อ"
from workpieces w
join latest l on l.workpiece_id = w.id
where w.proc_index <> case when l.reversal then l.proc_index - 1 else l.proc_index end
  and l.created_at > w.last_updated_at
order by w.student_id, w.id;
