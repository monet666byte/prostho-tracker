-- ═══════════════════════════════════════════════════════════════════════════
-- 0025 · ชื่อภาษาอังกฤษของนักศึกษาและอาจารย์ (14 ก.ย. 69)
--
-- ผู้ใช้ขอ: แอปมีสองภาษา แต่เก็บชื่อได้ช่องเดียว → โหมดอังกฤษยังขึ้นชื่อไทย
--   และแบบฟอร์มขอรายชื่อจากภาค (docs/prostho-roster-request-template.xlsx) มีคอลัมน์ชื่ออังกฤษ
--   "ทำสองภาษาก่อน จะได้กรอกทีเดียว"
--
-- name     = ชื่อไทย (หลัก · audit และเอกสารภาษาไทยใช้ช่องนี้เสมอ)
-- name_en  = ชื่ออังกฤษ (ไม่บังคับ · ว่าง = โหมดอังกฤษแสดงชื่อไทย)
--
-- สิทธิ์ไม่เปลี่ยน — กฎของตาราง students/teachers คุมทั้งแถวอยู่แล้ว (เขียนได้เฉพาะอาจารย์ · 0009)
--
-- ⚠️ ต้องรันไฟล์นี้ก่อนเปิดใช้แอปรุ่นที่นำเข้าชื่ออังกฤษ — ไม่งั้นเซิร์ฟเวอร์ปฏิเสธแถวที่มีชื่ออังกฤษ
-- ไม่ลบข้อมูล · รันซ้ำได้ · วิธีติดตั้ง: SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

alter table students add column if not exists name_en text;
alter table teachers add column if not exists name_en text;

-- ชื่อยาวเกินคนจริง = ข้อมูลที่อ่านผิด (ตรงกับ MAX_NAME_LENGTH ใน lib/rosterParse.ts)
alter table students drop constraint if exists students_name_en_len;
alter table students add constraint students_name_en_len check (name_en is null or char_length(name_en) <= 120);
alter table teachers drop constraint if exists teachers_name_en_len;
alter table teachers add constraint teachers_name_en_len check (name_en is null or char_length(name_en) <= 120);

-- PostgREST จำโครงตารางไว้ — สั่งให้อ่านใหม่ แอปจะได้ส่งช่อง name_en ได้ทันที
notify pgrst, 'reload schema';
