-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — เติมคอลัมน์ที่แอปเขียนแต่ตารางกลางไม่มี · migration ที่ 13
--
-- ที่มา: ตรวจอัตโนมัติ 7 ก.ย. 69 โดยเทียบฟิลด์ใน src/domain/types.ts
--        กับคอลัมน์จริงในตาราง (ผ่านการ rename ของ cloudSync.ts)
--        เจอ 5 ฟิลด์ที่ "หายเงียบ" — เขียนลงเครื่องได้ปกติ แต่ sync ขึ้นตู้กลางไม่ได้
--        ไม่มี error ให้เห็น ข้อมูลแค่หายไปเฉยๆ ตอนเปิดจากอีกเครื่อง
--
-- ⚠️ อันที่กระทบแรงสุดคือ students.gates — ธง "ผ่าน Section II / Design RPD"
--    ซึ่งตอนนี้ระบบติ๊กให้เองเมื่ออาจารย์ประเมินครบ (ดู syncSect2Gate ใน repo.ts)
--    และมันไปมีผลกับการนับ "ครบเกณฑ์จบ" ถ้าไม่ซิงก์ อาจารย์อีกเครื่องจะเห็นว่ายังไม่ผ่าน
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ธงข้อกำหนดก่อนจบที่ไม่ใช่ชิ้นงาน (Sect II Removable/Fixed · Design RPD)
-- เก็บเป็น jsonb เพราะเป็นชุดคีย์ที่อาจเพิ่มได้ในอนาคต ไม่อยากเพิ่มคอลัมน์ทุกครั้ง
alter table students add column if not exists gates jsonb;

-- ปีการศึกษาที่ชิ้นงานนี้นับเข้าเกณฑ์ (ชีตมีคอลัมน์ "for PT502 / for PT602")
alter table workpieces add column if not exists counts_for_year int;

-- มาจากการนำเข้าชีต — ไม่รู้วันจบจริง จึงนับเป็นยอดยกมาในกราฟสะสม
alter table workpieces add column if not exists from_sheet boolean;

-- คืนเคส/ยกเลิก — เก็บแถวไว้ให้เห็น แต่ไม่นับเป็นงานที่ทำอยู่
-- ถ้าไม่ซิงก์ เคสที่คืนไปแล้วจะโผล่กลับมาเป็นงานค้างบนอีกเครื่อง
alter table workpieces add column if not exists returned boolean;
alter table workpieces add column if not exists return_note text;

-- ─────────────────────────────────────────────────────────────────────────────
-- ตรวจว่าเติมครบ — ควรได้ 5 แถว
-- ─────────────────────────────────────────────────────────────────────────────
-- select table_name, column_name from information_schema.columns
--  where (table_name = 'students'   and column_name = 'gates')
--     or (table_name = 'workpieces' and column_name in
--         ('counts_for_year','from_sheet','returned','return_note'))
--  order by table_name, column_name;
