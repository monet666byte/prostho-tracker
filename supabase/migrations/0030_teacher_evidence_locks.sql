-- ─────────────────────────────────────────────────────────────────────────────
-- 0030 — ของที่อาจารย์ตรวจแล้ว นักศึกษาลบ/แก้ย้อนหลังผ่าน API ตรงไม่ได้
--
--   ที่มา: docs/survey-post-approval-locks.md · RLS ให้นักศึกษาทำได้ทุกอย่างกับแถวของตัวเองใน
--   workpieces / updates / patients (0004) โดยไม่มียามฝั่งเซิร์ฟเวอร์เลย
--
--   ① เคสที่มี "หลักฐานของอาจารย์" ผูกอยู่ ลบไม่ได้ — หลักฐาน = ใบประเมิน Section II/III ที่อ้าง workpiece_id นี้
--      หรือผลตรวจงาน (reviews) ที่มีชื่อผู้ตรวจ · เดิมลบได้ แล้วใบประเมินกลายเป็นแถวกำพร้าหายจากทุกหน้าจอ
--      ต้องกันทั้งชุดพร้อมกัน: **เคส + ประวัติ step ของเคส + ผู้ป่วยของเคส** — แอปลบสามอย่างนี้ในคราวเดียว
--      (repo.ts → deleteWorkpiece) ถ้ากันแค่เคส จะได้ "เคสกลับมาแต่ประวัติกับผู้ป่วยหายไปแล้ว" ซึ่งแย่กว่าเดิม
--      แอปรุ่นที่มาพร้อมไฟล์นี้ปฏิเสธตั้งแต่ตอนกดปุ่ม (domain/rules.ts → workpieceDeleteBlock) · ยามนี้กันแอปรุ่นเก่าและการยิง API ตรง
--      รูปงานไม่กัน — ลบรูปที่ถ่ายผิดต้องทำได้เสมอ (PDPA: ลบง่ายดีกว่า)
--
--   ② ช่องบอกตัวตนของแถวประวัติ (updates) แก้ไม่ได้หลังสร้าง: เคสไหน · ขั้นไหน · ทำวันไหน · ใครทำ · เป็นรายการเลิกทำไหม
--      แอปไม่เคยแก้ช่องพวกนี้หลังสร้าง (เติมแค่ photo_ids / note) จึงไม่มีงานจริงถูกบล็อก · ประวัติคือหลักฐานตัวจริง
--      ส่วนเลขขั้นใน workpieces เป็นแค่ยอดสรุป — **ไม่แตะ** (ปุ่มเลิกทำลดเลขจริง · เครื่องออฟไลน์ส่ง 2→5 เป็นก้อนเดียว)
--
--   ③ ตาราง submissions / issues ไม่มีโค้ดไหนใช้แล้ว แต่นักศึกษายังเขียน approved_by ของตัวเองได้ — ปิดให้เขียนได้เฉพาะอาจารย์
--      ก่อนที่วันหนึ่งจะมีคนทำหน้าจอมาใช้แล้วเปิดโล่งอยู่
--
--   ทุกยามผ่านได้สามทางเหมือน 0027: อาจารย์/หัวหน้ารายวิชา · คำสั่งที่ไม่มีคนล็อกอิน (SQL Editor · ตัวลบตามกำหนดเก็บ · remove-demo-rows.sql)
--   ใช้ raise ไม่ใช่ "คงค่าเดิมเงียบๆ" — ช่องพวกนี้มาจากปุ่มที่นักศึกษากดเอง เงียบ = งานหายโดยไม่มีใครรู้ (เหตุผลเต็มใน survey)
--   การลบที่ถูกปฏิเสธ แอปดึงแถวกลับลงเครื่องและบอกเหตุผลให้เอง (cloudSync.ts → restoreRefusedDelete)
--
-- ต้องรัน 0001–0029 มาก่อน · รันซ้ำได้ · รันแล้วให้รัน supabase/security-check.sql ตาม
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ ① เคสที่มีหลักฐานของอาจารย์ ═══════════════════════════════════════════════

create or replace function workpiece_has_teacher_evidence(wid text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from sect2_records where workpiece_id = wid)
      or exists (select 1 from sect3_records where workpiece_id = wid)
      or exists (select 1 from reviews where workpiece_id = wid and coalesce(by_who, '') <> '');
$$;
revoke execute on function workpiece_has_teacher_evidence(text) from public, anon;

create or replace function guard_workpiece_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or is_teacher() or is_admin() then return old; end if;
  if workpiece_has_teacher_evidence(old.id) then
    raise exception 'เคสนี้มีผลประเมินของอาจารย์แล้ว ลบไม่ได้ — ใช้ "คืนเคส" แทน หรือติดต่ออาจารย์ที่ปรึกษา';
  end if;
  return old;
end $$;
revoke execute on function guard_workpiece_delete() from public, anon;

drop trigger if exists workpiece_delete_guard on workpieces;
create trigger workpiece_delete_guard
  before delete on workpieces
  for each row execute function guard_workpiece_delete();

create or replace function guard_patient_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or is_teacher() or is_admin() then return old; end if;
  if exists (select 1 from workpieces w where w.patient_id = old.id and workpiece_has_teacher_evidence(w.id)) then
    raise exception 'ผู้ป่วยรายนี้มีเคสที่อาจารย์ประเมินแล้ว ลบไม่ได้ — ติดต่ออาจารย์ที่ปรึกษา';
  end if;
  return old;
end $$;
revoke execute on function guard_patient_delete() from public, anon;

drop trigger if exists patient_delete_guard on patients;
create trigger patient_delete_guard
  before delete on patients
  for each row execute function guard_patient_delete();

-- ═══ ② ประวัติ step ═════════════════════════════════════════════════════════════

create or replace function guard_update_row()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or is_teacher() or is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if workpiece_has_teacher_evidence(old.workpiece_id) then
      raise exception 'ประวัติของเคสที่อาจารย์ประเมินแล้ว ลบไม่ได้ — ติดต่ออาจารย์ที่ปรึกษา';
    end if;
    return old;
  end if;
  if new.workpiece_id is distinct from old.workpiece_id
     or new.proc_index is distinct from old.proc_index
     or new.progression is distinct from old.progression
     or new.performed_at is distinct from old.performed_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.reversal is distinct from old.reversal
     or new.self_performed is distinct from old.self_performed then
    raise exception 'ประวัติขั้นตอนแก้ย้อนหลังไม่ได้ — ถ้าบันทึกผิดให้กด "เลิกทำ" แล้วบันทึกใหม่';
  end if;
  return new;
end $$;
revoke execute on function guard_update_row() from public, anon;

drop trigger if exists update_row_guard on updates;
create trigger update_row_guard
  before update or delete on updates
  for each row execute function guard_update_row();

-- ═══ ③ ตารางที่ไม่มีใครใช้ — เขียนได้เฉพาะอาจารย์ ═══════════════════════════════

drop policy if exists submissions_own on submissions;
drop policy if exists submissions_read on submissions;
drop policy if exists submissions_write on submissions;
create policy submissions_read on submissions for select to authenticated
  using (is_teacher() or student_id = my_student_id());
create policy submissions_write on submissions for all to authenticated
  using (is_teacher()) with check (is_teacher());

drop policy if exists issues_own on issues;
drop policy if exists issues_read on issues;
drop policy if exists issues_write on issues;
create policy issues_read on issues for select to authenticated
  using (is_teacher() or student_id = my_student_id());
create policy issues_write on issues for all to authenticated
  using (is_teacher()) with check (is_teacher());
