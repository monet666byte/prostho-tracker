-- ─────────────────────────────────────────────────────────────────────────────
-- 0031 — รอยทางฝั่งเซิร์ฟเวอร์ของ "เลขขั้น" ในเคส (ไม่บล็อกอะไรทั้งนั้น)
--
--   ที่มา: docs/survey-post-approval-locks.md ข้อ 4 · นักศึกษาตั้ง workpieces.proc_index / completed_at เป็นค่าอะไรก็ได้ผ่าน API ตรง
--   (RLS ให้เจ้าของแก้ได้ทั้งแถว) แล้วหน้าอาจารย์ขึ้น "จบแล้ว" ทันที โดยไม่ต้องมีแถวประวัติ step รองรับ
--   **ล็อกไม่ได้** — ปุ่ม "เลิกทำ" ลดเลขจริง และเครื่องที่ออฟไลน์ทั้งวันส่ง 2→5 ขึ้นมาเป็นก้อนเดียว กฎแบบ "ขยับได้ทีละขั้น" จะบล็อกงานจริง
--   ส่วน "คงค่าเดิมเงียบๆ" = step ที่กดตอนออฟไลน์หายโดยไม่มีใครรู้ ซึ่งแพงที่สุดของระบบนี้
--
--   → จดทุกครั้งที่เลขขั้น / วันจบ / สถานะคืนเคส เปลี่ยน ลงตารางแยกที่ **แอปไม่ sync** (ไม่อยู่ใน TABLES ของ cloudSync.ts)
--     จึงไม่มีผลกับเครื่องผู้ใช้เลย · ใครทำ (auth.uid) กับเวลา มาจากเซิร์ฟเวอร์ ปลอมจากเครื่องไม่ได้ (ต่างจาก audit ที่เขียนจากแอป)
--     ใช้ตรวจย้อนเมื่อสงสัยว่าตัวเลขกระโดด: เทียบกับแถว updates ของเคสเดียวกัน
--   ไม่เก็บชื่อ/HN ผู้ป่วย — มีแค่ id เคส (id ของระบบนี้ไม่ฝังข้อมูลส่วนตัว)
--   ตารางโตช้า: หนึ่งแถวต่อการกด step หนึ่งครั้ง · ล้างบรรทัดเก่าตามกำหนดเก็บได้ (ไม่มีอะไรพึ่งมัน)
--
-- ต้องรัน 0001–0030 มาก่อน · รันซ้ำได้ · รันแล้วให้รัน supabase/security-check.sql ตาม
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists workpiece_step_log (
  id bigint generated always as identity primary key,
  workpiece_id text not null,
  student_id text not null,
  old_proc_index int,
  new_proc_index int,
  old_completed_at text,
  new_completed_at text,
  old_returned boolean,
  new_returned boolean,
  actor_uid uuid,                          -- auth.uid() ของคนที่ส่งคำขอ · null = SQL Editor / service key
  at_when timestamptz not null default now()
);
create index if not exists workpiece_step_log_wp_idx on workpiece_step_log (workpiece_id, at_when);

alter table workpiece_step_log enable row level security;

-- อ่านได้เฉพาะอาจารย์/หัวหน้ารายวิชา · ไม่มี policy เขียนให้ใครเลย — เขียนได้ทางเดียวคือ trigger ข้างล่าง (security definer)
drop policy if exists workpiece_step_log_read on workpiece_step_log;
create policy workpiece_step_log_read on workpiece_step_log for select to authenticated
  using (is_teacher() or is_admin());

create or replace function log_workpiece_step()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.proc_index is distinct from old.proc_index
     or new.completed_at is distinct from old.completed_at
     or new.returned is distinct from old.returned then
    insert into workpiece_step_log
      (workpiece_id, student_id, old_proc_index, new_proc_index, old_completed_at, new_completed_at, old_returned, new_returned, actor_uid)
    values
      (new.id, new.student_id, old.proc_index, new.proc_index, old.completed_at, new.completed_at, old.returned, new.returned, auth.uid());
  end if;
  return new;  -- ไม่แก้ค่า ไม่ raise — จดอย่างเดียว
end $$;
revoke execute on function log_workpiece_step() from public, anon;

drop trigger if exists workpiece_step_log_trg on workpieces;
create trigger workpiece_step_log_trg
  after update on workpieces
  for each row execute function log_workpiece_step();

-- เคสถูกลบ (เจ้าของลบเคสที่เปิดผิด · ตัวลบตามกำหนดเก็บ) → รอยของเคสนั้นไปด้วย ไม่ค้างเป็นข้อมูลของคนที่ถูกลบออกจากระบบแล้ว
create or replace function drop_workpiece_step_log()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from workpiece_step_log where workpiece_id = old.id;
  return old;
end $$;
revoke execute on function drop_workpiece_step_log() from public, anon;

drop trigger if exists workpiece_step_log_cleanup on workpieces;
create trigger workpiece_step_log_cleanup
  after delete on workpieces
  for each row execute function drop_workpiece_step_log();
