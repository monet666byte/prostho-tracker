-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — แบบประเมินตนเองที่ส่งแล้ว แก้ต่อได้ระหว่างที่ยังเปิดรับ · migration ที่ 32
--
-- เดิม: ส่งแล้วล็อกทันที นักศึกษาที่อยากแก้ต้องรออาจารย์กด "เปิดให้แก้ใหม่"
-- ใหม่: ตราบที่ชั้นปีนั้นยังเปิดรับฟอร์ม (สวิตช์ในหน้าตั้งค่า → app_settings.value.saOpenYears)
--       นักศึกษาแก้คำตอบที่ส่งแล้วได้เอง · สถานะยังเป็น "ส่งแล้ว" และเวลาส่งคงเดิม
--       อาจารย์ปิดสวิตช์ = ล็อก
-- หลังปิดรับ: อาจารย์กด "เปิดให้แก้ใหม่" ให้รายคน → ประทับ reopened_at ไว้ แอปจึงรู้ว่าร่างนี้
--       "อาจารย์เปิดให้คนนี้" ต่างจากร่างที่ไม่เคยส่ง (ซึ่งยังล็อกตามสวิตช์)
--
-- เซิร์ฟเวอร์ต้องเช็คเอง ไม่ใช่แค่หน้าจอ — ไม่งั้นยิง API ตรงแก้หลังปิดรับได้
-- กติกาฝั่งแอปอยู่ที่ saStudentCanEdit() ใน src/domain/selfAssessment.ts — ต้องตรงกัน
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run (ต้องรัน 0028 ก่อน)
-- ─────────────────────────────────────────────────────────────────────────────

-- ① ชั้นปีนี้เปิดรับแบบประเมินอยู่ไหม — อ่านก้อนค่าตั้งเดียวกับที่แอปใช้ (saOpenFor)
--    ค่าเก่าก่อนแยกชั้นปีเก็บเป็น saOpen: boolean · ไม่มีแถว/อ่านไม่ออก = ปิด
create or replace function sa_form_open(p_class_year int)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when jsonb_typeof(value->'saOpenYears') = 'array' then (value->'saOpenYears') @> to_jsonb(p_class_year)
      when jsonb_typeof(value->'saOpen') = 'boolean' then (value->>'saOpen')::boolean
      else false
    end
    from app_settings where id = 'app'
  ), false)
$$;
revoke all on function sa_form_open(int) from public, anon;
grant execute on function sa_form_open(int) to authenticated;

-- ② อาจารย์เปิดให้แก้ใหม่เมื่อไร — ตั้งโดยเซิร์ฟเวอร์เท่านั้น (ยามใน ③)
alter table self_assessments add column if not exists reopened_at timestamptz;

-- ③ ยาม: เหมือน 0028 ยกเว้นกิ่ง "นักศึกษาแก้ฉบับที่ส่งแล้ว" และ reopened_at
create or replace function guard_self_assessment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('prostho.restore', true), '') = 'on' then
    return new;   -- กู้จากสำเนา: คงทุกช่องตามสำเนา รวม created_at / submitted_at
  end if;

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
      new.reopened_at  := case when old.status = 'submitted' then now() else old.reopened_at end;
    else
      new.submitted_at := old.submitted_at;
      new.reopened_at  := old.reopened_at;
    end if;
    return new;
  end if;

  -- นักศึกษา · reopened_at เป็นของอาจารย์ แก้เองไม่ได้
  if tg_op = 'UPDATE' then
    new.reopened_at := old.reopened_at;
    if new.student_id    is distinct from old.student_id
       or new.academic_year is distinct from old.academic_year then
      raise exception 'แก้เจ้าของหรือปีของแบบประเมินไม่ได้';
    end if;
    if old.status = 'submitted' then
      -- เช็คจากชั้นปีของฉบับเดิม — ไม่งั้นส่ง class_year ของชั้นปีที่เปิดอยู่มาเพื่อปลดล็อกได้
      if not sa_form_open(old.class_year) then
        raise exception 'ส่งแล้วแก้ไม่ได้ — ให้อาจารย์ที่ปรึกษาเปิดให้แก้ใหม่';
      end if;
      -- แก้ได้แค่คำตอบ · ถอนการส่งเองไม่ได้ · เวลาส่งคงเดิม (updated_at บอกว่าแก้ล่าสุดเมื่อไร)
      -- ช่องอื่นคงค่าเดิมเงียบๆ แทน raise — เครื่องที่อัปเดตแอปแล้วส่งฉบับฟอร์มใหม่มา sync ต้องไม่พัง
      new.status       := 'submitted';
      new.submitted_at := old.submitted_at;
      new.class_year   := old.class_year;
      new.form_version := old.form_version;
      return new;
    end if;
    -- เวลาส่ง = เวลาของเซิร์ฟเวอร์ตอนเปลี่ยนสถานะ ไม่ใช่ค่าที่ client ส่งมา
    new.submitted_at := case when new.status = 'submitted' then now() else null end;
    return new;
  end if;

  -- INSERT โดย นศ.
  if new.student_id is distinct from my_student_id() then
    raise exception 'สร้างแบบประเมินแทนคนอื่นไม่ได้';
  end if;
  new.reopened_at := null;
  new.submitted_at := case when new.status = 'submitted' then now() else null end;
  return new;
end $$;

-- ④ RLS: แถวที่ส่งแล้วต้อง "มองเห็นเพื่อแก้" ได้ระหว่างเปิดรับ (เดิมเฉพาะร่าง)
--    ปิดรับแล้ว = RLS กรองทิ้ง 0 แถว · ยามใน ③ เป็นชั้นที่สอง
drop policy if exists sa_update on self_assessments;
create policy sa_update on self_assessments for update to authenticated
  using (
    is_teacher()
    or (student_id = my_student_id() and (status = 'draft' or sa_form_open(class_year)))
  )
  with check (
    is_teacher()
    or student_id = my_student_id()
  );
