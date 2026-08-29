-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ปิดช่องนักศึกษาให้คะแนนตัวเอง · migration ที่ 6
--
-- ช่องโหว่ที่เจอตอนทดสอบ 0004 (29 ส.ค.):
--   นักศึกษาแก้แถวเช็คอิน "ของตัวเอง" ได้ตามสิทธิ์ — ซึ่งถูกต้องสำหรับช่องกิจกรรม/โน้ต
--   แต่แถวเดียวกันมีช่องคะแนนอยู่ด้วย → ยิง API ตรงๆ ตั้ง status='evaluated' + scores เองได้
--   (ผ่านหน้าแอปทำไม่ได้ แต่คนที่รู้วิธีเรียก API ทำได้ = ต้องปิดที่ฐานข้อมูล)
--
-- RLS สั่งได้แค่ "แถวไหนแตะได้" สั่งไม่ได้ว่า "คอลัมน์ไหนแตะได้"
-- จึงต้องใช้ trigger เทียบค่าเก่า/ใหม่แทน
--
-- วิธีติดตั้ง: SQL Editor → Run (ต้องรัน 0004 และ 0005 มาก่อน)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function guard_checkin_scoring()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- อาจารย์ให้คะแนนได้ตามปกติ
  if is_teacher() then return new; end if;

  if tg_op = 'INSERT' then
    -- นักศึกษาสร้างคาบใหม่ได้ แต่ต้องเป็น "รอประเมิน" เปล่าๆ เท่านั้น
    if new.status is distinct from 'pending'
       or new.scores is not null
       or new.evaluated_by is not null
       or new.evaluated_at is not null then
      raise exception 'นักศึกษาสร้างคาบที่มีคะแนนไว้ล่วงหน้าไม่ได้';
    end if;
    return new;
  end if;

  -- แก้คาบเดิม: ช่องคะแนนและช่องเวลาที่ระบบจับให้ ห้ามแตะ
  if new.status      is distinct from old.status
     or new.scores       is distinct from old.scores
     or new.evaluated_by is distinct from old.evaluated_by
     or new.evaluated_at is distinct from old.evaluated_at
     or new.punctual     is distinct from old.punctual
     or new.checkin_at   is distinct from old.checkin_at
     or new.student_id   is distinct from old.student_id
     or new.date         is distinct from old.date then
    raise exception 'นักศึกษาแก้คะแนน/เวลาเช็คอินของตัวเองไม่ได้';
  end if;

  return new;
end $$;

drop trigger if exists checkin_scoring_guard on checkins;
create trigger checkin_scoring_guard
  before insert or update on checkins
  for each row execute function guard_checkin_scoring();

-- ── คอมเมนต์ของอาจารย์: นักศึกษาอ่านได้ แต่เขียนแทนอาจารย์ไม่ได้ ──────────────
-- (เดิม policy เดียวคุมทั้งอ่านและเขียน → นศ. แต่งคอมเมนต์ปลอมในชิ้นงานตัวเองได้)
drop policy if exists reviews_own on reviews;

create policy reviews_read on reviews for select to authenticated
  using (is_teacher() or workpiece_id in (select my_workpiece_ids()));

create policy reviews_write on reviews for all to authenticated
  using (is_teacher()) with check (is_teacher());
