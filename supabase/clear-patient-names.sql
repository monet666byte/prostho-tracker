-- ═══════════════════════════════════════════════════════════════════════════
-- ลบชื่อผู้ป่วยที่ถูกกรอกไว้ก่อนเปิดใช้ "ไม่เก็บชื่อ" (0026) — ⚠️ ลบจริง แก้คืนไม่ได้
--
-- ใช้เมื่อ: รัน 0026 แล้ว และสวิตช์ "ใช้ชื่อผู้ป่วย" ปิดอยู่ · มีเคสที่เปิดก่อนหน้านั้นยังมีชื่อค้าง
-- ไม่แตะ: HN · เพศ/อายุ · เคส · รูป · audit (audit ไม่มีชื่อผู้ป่วยตามกติกาอยู่แล้ว)
--
-- ทั้งไฟล์เป็นคำสั่งเดียว — ถ้าสวิตช์เปิดอยู่จะไม่ลบอะไร และบอกไว้ในผลลัพธ์
-- รันซ้ำได้ · ผลตอนจบ = จำนวนที่ลบ + จำนวนที่เหลือ (ต้องเป็น 0)
-- ═══════════════════════════════════════════════════════════════════════════

with guard as (
  select not patient_names_enabled() as ok
), p as (
  update patients set name = '' where (select ok from guard) and name <> '' returning 1
), s2 as (
  update sect2_records set patient_name = null where (select ok from guard) and patient_name is not null returning 1
), s3 as (
  update sect3_records set patient_name = null where (select ok from guard) and patient_name is not null returning 1
)
select
  case when (select ok from guard) then 'สวิตช์ปิดอยู่ — ลบแล้ว' else '✗ สวิตช์ "ใช้ชื่อผู้ป่วย" เปิดอยู่ — ไม่ได้ลบอะไร' end as "สถานะ",
  (select count(*) from p)  as "ชื่อในทะเบียนผู้ป่วย",
  (select count(*) from s2) as "ชื่อในใบ Section II",
  (select count(*) from s3) as "ชื่อในใบ Section III";
