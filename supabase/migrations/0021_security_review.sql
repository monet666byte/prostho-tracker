-- ═══════════════════════════════════════════════════════════════════════════
-- 0021 · ปิดช่องจากการตรวจความปลอดภัย 13 ก.ย. 69
--
-- ตรวจโดยอ่าน migration ทั้ง 20 ไฟล์เรียงลำดับ (ไฟล์หลังเขียนทับกฎของไฟล์ก่อน)
-- ก่อนรับข้อมูลผู้ป่วยจริง · รอบก่อนตรวจ 2–6 ก.ย. ซึ่งยังไม่มี 0009 · 0016 · 0017 · 0020
--
-- ไฟล์นี้ปลอดภัยที่จะรันได้เลย: ไม่ลบข้อมูล ไม่ลบบัญชี แก้เฉพาะกฎการเข้าถึง
-- เรื่องที่ต้องให้คนตัดสินก่อน (บัญชีทดสอบ · การตั้งค่าในหน้า Authentication)
-- แยกไว้ใน supabase/security-check.sql
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → SQL Editor → Run · แล้วรัน supabase/security-check.sql ยืนยัน
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- ① นักศึกษาอ่าน audit log ของเพื่อนร่วมกลุ่มได้
--
-- กฎเดิม (0005) ตั้งใจให้ "อาจารย์เห็นเรื่องของกลุ่มที่ดูแล" แต่เขียนไว้ไม่ได้เช็คว่าเป็นอาจารย์:
--   or (student_id is not null and is_my_student(student_id))
--   or (group_code is not null and group_code = my_group())
-- และ my_group() ของ "นักศึกษา" คืนกลุ่มที่ตัวเองสังกัด (ตั้งใจไว้ใช้ที่อื่น)
-- ส่วน is_my_student() เป็น security definer จึงอ่านตาราง students ข้ามสิทธิ์ได้
--
-- ผล: นักศึกษาทุกคนอ่านแถว audit ที่เกี่ยวกับเพื่อนในกลุ่มเดียวกันได้ทั้งหมด เช่น
--   "แก้คะแนนคาบ 19 ส.ค. ของ นศ. ข · Overall Knowledge 3→1"
--   "เปลี่ยนป้ายตรงต่อเวลาของ นศ. ค"
-- และแอปดึงแถวพวกนี้ลงเก็บในเครื่องของนักศึกษาเองด้วย (sync ดึงทุกแถวที่ RLS ยอม)
-- แถว audit รุ่นก่อนกฎ caseCode อาจมีชื่อผู้ป่วยกับ HN อยู่ด้วย (ดูคอมเมนต์ใน 0009)
--
-- ของใหม่: สองเงื่อนไขนั้นต้องเป็นอาจารย์ · และเพิ่ม "เรื่องที่เกี่ยวกับตัวเอง"
-- ให้นักศึกษาตามหลัก PDPA ที่ 0005 ตั้งใจไว้ (สิทธิ์รู้ว่าระบบจดอะไรเกี่ยวกับเรา)
-- หน้าจอฝั่งนักศึกษาไม่ได้อ่าน audit เลย จึงไม่กระทบการใช้งาน (ตรวจแล้ว)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists audit_read on audit;
create policy audit_read on audit for select to authenticated using (
  is_admin()                                                                   -- หัวหน้าภาค: ทั้งระบบ
  or actor_uid = auth.uid()                                                    -- ของที่ตัวเองทำ
  or (student_id is not null and student_id = my_student_id())                 -- เรื่องที่เกี่ยวกับตัวเอง
  or (is_teacher() and student_id is not null and is_my_student(student_id))  -- อาจารย์: นศ. ในกลุ่มที่ดูแล
  or (is_teacher() and group_code is not null and group_code = my_group())     -- อาจารย์: เรื่องของกลุ่มที่ดูแล
);


-- ─────────────────────────────────────────────────────────────────────────────
-- ② นักศึกษาชี้แถวรูปของตัวเองไปที่ไฟล์ของคนอื่นได้ แล้วลบไฟล์นั้นทิ้ง
--
-- ตาราง photos: RLS ตรวจว่า workpiece_id เป็นของเรา แต่ไม่ได้ตรวจ storage_path
-- trigger cleanup_photo_object (0018) เป็น security definer และลบ storage.objects
-- ตาม storage_path ทุกครั้งที่แถวรูปหาย → ข้าม RLS ของบักเก็ตไปได้
--
-- ลำดับการโจมตี: สร้างแถวรูปใต้ชิ้นงานของตัวเอง · ใส่ storage_path เป็นไฟล์ของเพื่อน
-- → ลบแถวนั้น → trigger ลบไฟล์รูปของเพื่อนให้
-- ความน่าจะเกิดต่ำ (ต้องรู้ที่อยู่ไฟล์ครบ ซึ่งมี id สุ่มอยู่ในนั้น) แต่ความเสียหายกู้ไม่ได้
-- เพราะรูปในปากคนไข้ถ่ายซ้ำไม่ได้ · ปิดตั้งแต่ตอนเขียน ไม่ต้องไปพึ่งตอนลบ
--
-- ถ้าหาเจ้าของชิ้นงานไม่เจอ (ชิ้นงานยังไม่ขึ้นตู้) ปล่อยผ่าน:
-- นักศึกษาเขียนแถวรูปได้เฉพาะใต้ชิ้นงานที่มีอยู่แล้วของตัวเอง (RLS photos_own) อยู่แล้ว
-- กรณีหาไม่เจอจึงเกิดได้แค่กับอาจารย์ ซึ่งลบไฟล์ใดก็ได้ตามสิทธิ์อยู่แล้ว (0018)
-- และการ raise ในกรณีนั้นจะทำให้รูปที่ถูกต้องค้างส่งโดยไม่มีเหตุผล
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function guard_photo_storage_path()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner text;
begin
  if new.storage_path is null then
    return new;
  end if;
  select student_id into owner from workpieces where id = new.workpiece_id;
  if owner is not null and split_part(new.storage_path, '/', 1) is distinct from owner then
    raise exception 'ที่อยู่ไฟล์รูปต้องอยู่ในโฟลเดอร์ของเจ้าของชิ้นงาน';
  end if;
  return new;
end $$;

drop trigger if exists photos_path_guard on photos;
create trigger photos_path_guard
  before insert or update of storage_path, workpiece_id on photos
  for each row execute function guard_photo_storage_path();


-- ─────────────────────────────────────────────────────────────────────────────
-- ③ ฟังก์ชัน security definer เรียกได้โดยคนที่ไม่ได้ล็อกอิน
--
-- ฟังก์ชันใน schema public ถูกเปิดเป็น /rest/v1/rpc/<ชื่อ> อัตโนมัติ
-- และ Postgres ให้สิทธิ์ EXECUTE กับ PUBLIC ตั้งแต่สร้าง (Supabase ยังให้ anon ตรงๆ อีกชั้น)
-- 0016 ถอดสิทธิ์จาก PUBLIC ไว้บางตัว แต่ไม่ได้ถอดจาก anon ที่ได้มาตรงๆ
-- เช่น expired_student_ids() ตั้งใจ "ไม่เปิดให้เรียกตรง" แต่ anon อาจยังเรียกได้
-- และได้รายชื่อ id นักศึกษาที่ครบกำหนดลบคืนไป
--
-- ฟังก์ชันที่มีข้อมูลสำคัญทุกตัวเช็ค is_admin() ข้างในอยู่แล้ว (ตรวจแล้ว)
-- ข้อนี้จึงเป็นการปิดชั้นนอกให้ครบ ไม่ใช่รูรั่วที่เปิดอยู่ทั้งบาน
--
-- ⚠️ ห้ามถอดจาก authenticated — กฎ RLS ทุกข้อเรียก is_teacher() / my_student_id()
--    ด้วยสิทธิ์ของคนที่ล็อกอิน ถอดเมื่อไหร่ทุกคำขอจะพังทันที
--    จึงให้ authenticated แบบตรงๆ ก่อน แล้วค่อยถอดจาก PUBLIC กับ anon
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if f.proname = 'expired_student_ids' then
      -- ตั้งใจให้เป็นวัตถุดิบของ purge/preview เท่านั้น (0016) — ไม่มีใครเรียกตรงได้เลย
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
      execute format('revoke execute on function %s from public, anon', f.sig);
    end if;
  end loop;
end $$;

-- ฟังก์ชันที่จะสร้างวันหน้า: ไม่ให้ anon เรียกได้ตั้งแต่เกิด
alter default privileges in schema public revoke execute on functions from public, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- ทดสอบหลังรัน
--   รัน supabase/security-check.sql — ทุกแถวที่ขึ้น 🔴 ต้องหายไป ยกเว้นเรื่องบัญชีทดสอบ
--   ซึ่งไฟล์นี้ตั้งใจไม่แตะ (ต้องให้เจ้าของระบบตัดสินใจก่อน)
-- ─────────────────────────────────────────────────────────────────────────────
