-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ให้หัวหน้าภาคจัดการรายชื่อเองได้ · migration ที่ 7
--
-- เดิม: ตาราง invites ไม่มี policy เลย = ไม่มีใครอ่าน/เขียนผ่านแอปได้
--       (มีแค่ trigger ตอนสมัครที่เป็น security definer เลยข้ามยามไปได้)
--       ผลคือเพิ่มคนเข้าระบบต้องพิมพ์ SQL ทุกครั้ง — ภาคทำเองไม่ได้ และ backup ก็ดึงไม่ได้
--
-- ใหม่: หัวหน้าภาค (is_admin) จัดการได้เต็ม ผ่านหน้า "จัดการรายชื่อ" ในแอป
--
-- วิธีติดตั้ง: SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists invites_admin on invites;
create policy invites_admin on invites for all to authenticated
  using (is_admin()) with check (is_admin());

-- หัวหน้าภาคดูได้ว่าใครผูกบัญชีแล้วบ้าง (คนที่ยังไม่ผูก = เชิญแล้วแต่ยังไม่ได้สมัคร)
drop policy if exists app_users_admin on app_users;
create policy app_users_admin on app_users for select to authenticated
  using (is_admin());

-- หัวหน้าภาคต้องอ่านรายชื่อ นศ./อาจารย์ ได้ครบ เพื่อจับคู่กับอีเมลตอนเชิญ
-- (อาจารย์ทั่วไปอ่านได้อยู่แล้วจาก 0004 — บรรทัดนี้เผื่อกรณี admin ที่ไม่ได้เป็นอาจารย์)
drop policy if exists students_admin_read on students;
create policy students_admin_read on students for select to authenticated
  using (is_admin());
