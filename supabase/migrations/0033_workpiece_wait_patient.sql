-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — เคสหยุดเพราะคนไข้ ("รอคนไข้") · migration ที่ 33
--
-- นักศึกษาบอกได้ว่าเคสหยุดเพราะคนไข้ (ไม่ว่าง · รอ pre-prosth · refer) ไม่ใช่ตัวเองช้า
-- ระหว่างรอ แอปไม่นับเคสนั้นเป็น "ค้าง" และไม่ขึ้น "ต้องตาม" เพราะเงียบ
-- เลยวันนัดแล้ว (หรือไม่มีวันนัดแล้วเกิน 30 วัน) กลับมานับตามปกติ
-- กติกาฝั่งแอปอยู่ที่ isWaitingForPatient() ใน src/domain/rules.ts — ค่าใน check ต้องตรงกับ WaitReason
--
-- เพิ่มคอลัมน์อย่างเดียว ไม่แตะกฎการเข้าถึง: แถว workpieces ใครเขียนได้ยังเป็นตามกฎเดิม (0004 · 0030)
-- แอปรุ่นนี้เช็คก่อนว่ามีคอลัมน์แล้วค่อยโชว์ปุ่ม (src/data/waitFeature.ts) — ยังไม่รันไฟล์นี้ = ปุ่มไม่ขึ้น
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run · รันซ้ำได้
-- ─────────────────────────────────────────────────────────────────────────────

alter table workpieces add column if not exists wait_reason text;
alter table workpieces add column if not exists wait_until date;
alter table workpieces add column if not exists wait_since date;

alter table workpieces drop constraint if exists workpieces_wait_reason_check;
alter table workpieces add constraint workpieces_wait_reason_check
  check (wait_reason is null or wait_reason in ('busy', 'preprosth', 'refer', 'other'));
