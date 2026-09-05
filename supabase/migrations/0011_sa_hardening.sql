-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ปิดช่องโหว่แบบประเมินตนเอง + audit · migration ที่ 11
-- จากการตรวจ security 6 ก.ย. 69 (โจทย์: "มีคนไม่ดีสมัคร เอา AI มาแกะ API")
--
-- RLS สั่งได้แค่ "แถวไหนแตะได้" สั่งไม่ได้ว่า "คอลัมน์ไหนแตะได้ / ค่าไหนต้องเป็นของจริง"
-- ช่องที่เหลือจึงต้องปิดด้วย unique index + trigger เหมือนที่ทำกับคะแนนเช็คอิน (0006)
--
-- ① นศ. สร้างแถวซ้ำปีเดียวกันได้ (id เลือกเองจากฝั่ง client)
--    → หน้าอาจารย์ใช้ Map(studentId→row) แถวสุดท้ายชนะ นศ. เลยแทนที่ฉบับที่ส่งจริงได้
-- ② นศ. ตั้ง submitted_at เองได้ → ย้อนวันส่งให้ดูเหมือนส่งทัน
-- ③ นศ. แก้ student_id / academic_year ของแถวเดิมได้
-- ④ อาจารย์ (ทุกคนในภาค) แก้ answers ของ นศ. ได้ผ่าน API ตรง โดยไม่มีร่องรอย
-- ⑤ audit: นศ. ใส่ student_id/group_code ของคนอื่นได้ → แต่งเหตุการณ์ปลอมโผล่ในหน้าที่ปรึกษากลุ่มอื่น
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run (ต้องรัน 0010 มาก่อน)
-- ─────────────────────────────────────────────────────────────────────────────

-- ① หนึ่งคนหนึ่งชุดต่อปี — ฐานข้อมูลบังคับ ไม่พึ่งการตั้งชื่อ id ฝั่ง client
create unique index if not exists sa_student_year_uidx
  on self_assessments (student_id, academic_year);

-- ②③④ ยามคอลัมน์ของแบบประเมินตนเอง
create or replace function guard_self_assessment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  -- created_at เป็นของเซิร์ฟเวอร์: client ส่งค่าของตัวเองมาทุกครั้งที่ sync (คนละนาฬิกา)
  -- ถ้า raise ตรงนี้ การ sync ปกติจะพังทั้งตาราง → คงค่าเดิมเงียบๆ แทน
  if tg_op = 'UPDATE' then new.created_at := old.created_at; else new.created_at := now(); end if;

  -- บัญชีสาธิตผูกทั้งสองฝั่ง: ถ้ากำลังแตะแถวของ "ตัวเอง" ให้ถือเป็นนักศึกษา
  if is_teacher() and new.student_id is distinct from my_student_id() then
    -- อาจารย์แก้ได้อย่างเดียวคือ "เปิดให้ นศ. แก้ใหม่" (status กลับเป็น draft)
    -- คำตอบเป็นคำพูดของ นศ. — ต่อให้ที่ปรึกษาก็แก้แทนไม่ได้ (เหมือนฟอร์มกระดาษที่เซ็นแล้ว)
    if tg_op = 'INSERT' then
      raise exception 'อาจารย์สร้างแบบประเมินตนเองแทนนักศึกษาไม่ได้';
    end if;
    if new.answers       is distinct from old.answers
       or new.student_id    is distinct from old.student_id
       or new.academic_year is distinct from old.academic_year
       or new.class_year    is distinct from old.class_year
       or new.form_version  is distinct from old.form_version then
      raise exception 'อาจารย์แก้คำตอบของนักศึกษาไม่ได้ — เปิดให้นักศึกษาแก้เองได้เท่านั้น';
    end if;
    if new.status = 'draft' then
      new.submitted_at := null;   -- เปิดใหม่ = ยังไม่ได้ส่ง
    else
      new.submitted_at := old.submitted_at;
    end if;
    return new;
  end if;

  -- นักศึกษา
  if tg_op = 'UPDATE' then
    if new.student_id    is distinct from old.student_id
       or new.academic_year is distinct from old.academic_year then
      raise exception 'แก้เจ้าของหรือปีของแบบประเมินไม่ได้';
    end if;
    if old.status = 'submitted' then
      raise exception 'ส่งแล้วแก้ไม่ได้ — ให้อาจารย์ที่ปรึกษาเปิดให้แก้ใหม่';
    end if;
    -- เวลาส่ง = เวลาของเซิร์ฟเวอร์ตอนเปลี่ยนสถานะ ไม่ใช่ค่าที่ client ส่งมา
    new.submitted_at := case when new.status = 'submitted' then now() else null end;
    return new;
  end if;

  -- INSERT โดย นศ.
  if new.student_id is distinct from my_student_id() then
    raise exception 'สร้างแบบประเมินแทนคนอื่นไม่ได้';
  end if;
  new.submitted_at := case when new.status = 'submitted' then now() else null end;
  return new;
end $$;

drop trigger if exists self_assessment_guard on self_assessments;
create trigger self_assessment_guard
  before insert or update on self_assessments
  for each row execute function guard_self_assessment();

-- ⑤ audit: นศ. เขียนได้เฉพาะเรื่องของตัวเอง ห้ามอ้างกลุ่ม · อาจารย์เขียนได้ตามเดิม
--    (บัญชีที่ยังไม่ผูกกับใคร = เขียนไม่ได้เลย ปิดทาง spam log)
drop policy if exists audit_insert on audit;
create policy audit_insert on audit for insert to authenticated with check (
  is_teacher()
  or (
    my_student_id() is not null
    and student_id = my_student_id()
    and group_code is null
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ทดสอบหลังรัน (ทำในแท็บ SQL Editor เดียวกัน — ทุกคำสั่งต้อง "ล้มเหลว"):
--   · ล็อกอินเป็น นศ. แล้ว insert self_assessments ซ้ำ (student_id, academic_year) เดิม
--   · นศ. update แถวที่ status = 'submitted'
--   · อาจารย์ update answers ของ นศ.
--   · นศ. insert audit ที่ group_code ไม่ใช่ null
-- ─────────────────────────────────────────────────────────────────────────────
