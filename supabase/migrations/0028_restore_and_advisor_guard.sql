-- ─────────────────────────────────────────────────────────────────────────────
-- 0028 — สองช่องที่เหลือจากการตรวจก่อนส่งมอบ
--
--   ① แบบประเมินตนเอง "กู้จากสำเนาไม่ได้เลย" — ไม่ว่าบัญชีไหน
--      กฎ insert ของตาราง (0010) ยอมเฉพาะนักศึกษาเจ้าของ และยาม guard_self_assessment (0011)
--      raise ทันทีที่อาจารย์ insert · restore.ts ล็อกอินด้วยบัญชีอาจารย์ → แถวที่หายกู้กลับไม่ได้
--      (service key ก็ไม่ได้: my_student_id() เป็น null → ยาม raise เหมือนกัน)
--      → ฟังก์ชัน restore_self_assessments() ให้หัวหน้ารายวิชาเรียกเท่านั้น · จด audit ทุกครั้ง
--        ยามเดิมยังทำงานเหมือนเดิมกับทุกทางอื่น (แอป · REST ตรง)
--
--   ② อาจารย์ตั้งตัวเองเป็นที่ปรึกษากลุ่มไหนก็ได้ด้วยการเขียน groups.advisor_ids ตรงๆ
--      (กฎ groups_write ของ 0004 ให้อาจารย์ทุกท่านเขียนได้ · trigger 0024 ประทับปีให้ด้วย)
--      ข้ามปุ่ม claim_group ที่จด audit และได้สิทธิ์ยืนยันคำขอผูกบัญชีของกลุ่มนั้นทันที
--      อีกทางที่เกิดโดยไม่ตั้งใจ: เครื่องที่ถือแถว groups ฉบับเก่า sync ขึ้นทั้งแถว → ทับที่ปรึกษาที่เพิ่งเลือก
--      → การแก้ advisor_ids ตรงๆ ของคนที่ไม่ใช่หัวหน้ารายวิชา "คงค่าเดิมไว้เงียบๆ" (แนวเดียวกับ 0020 —
--        raise จะทำให้การ sync ปกติของแถวนั้นถูกกักทั้งแถว) · ทางที่ถูกคือ claim_group / release_group /
--        set_group_advisors / reset_advisors_for_new_year ซึ่งเปิดธงให้ผ่าน
--
-- ต้องรัน 0001–0027 มาก่อน · รันซ้ำได้ · รันแล้วให้รัน supabase/security-check.sql ตาม
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ ① กู้แบบประเมินตนเอง ═════════════════════════════════════════════════════

-- ยามเดิม + ทางผ่านเดียว: ธง prostho.restore ซึ่งตั้งได้จากในฟังก์ชัน restore_self_assessments เท่านั้น
-- (client ตั้งค่าธงเองผ่าน REST ไม่ได้ — set_config ไม่ได้อยู่ใน schema ที่เปิดให้เรียก)
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

-- กู้แถวจากสำเนา — p_rows = array ของแถวตามรูปคอลัมน์จริง (ที่ backup.ts เขียนไว้)
-- p_overwrite = false: เติมเฉพาะแถวที่หาย (ค่าเริ่มต้น · กู้รายคน) · true: ทับตามสำเนา (กู้ทั้งระบบ)
-- คืนจำนวนแถวที่เขียนจริง
create or replace function restore_self_assessments(p_rows jsonb, p_overwrite boolean default false)
returns int language plpgsql security definer set search_path = public
as $$
declare
  n int := 0;
  who_text text;
begin
  if not is_admin() then
    raise exception 'กู้แบบประเมินตนเองได้เฉพาะหัวหน้ารายวิชา';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows ต้องเป็น array ของแถว';
  end if;

  perform set_config('prostho.restore', 'on', true);   -- true = เฉพาะ transaction นี้
  if p_overwrite then
    insert into self_assessments
    select * from jsonb_populate_recordset(null::self_assessments, p_rows)
    on conflict (id) do update set
      student_id = excluded.student_id, academic_year = excluded.academic_year,
      class_year = excluded.class_year, form_version = excluded.form_version,
      answers = excluded.answers, status = excluded.status, submitted_at = excluded.submitted_at,
      created_at = excluded.created_at, updated_at = excluded.updated_at;
  else
    insert into self_assessments
    select * from jsonb_populate_recordset(null::self_assessments, p_rows)
    on conflict (id) do nothing;
  end if;
  get diagnostics n = row_count;
  perform set_config('prostho.restore', 'off', true);

  who_text := coalesce((select email from app_users where uid = auth.uid()), 'ไม่ทราบผู้ใช้');
  insert into audit (id, text, who, at_when)
  values (
    'a-restore-sa-' || replace(gen_random_uuid()::text, '-', ''),
    format('กู้แบบประเมินตนเองจากสำเนา: ส่งมา %s แถว · เขียนจริง %s แถว%s',
           jsonb_array_length(p_rows), n, case when p_overwrite then ' (ทับตามสำเนา)' else ' (เติมเฉพาะที่หาย)' end),
    who_text,
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  return n;
end $$;

revoke all on function restore_self_assessments(jsonb, boolean) from public, anon;
grant execute on function restore_self_assessments(jsonb, boolean) to authenticated, service_role;


-- ═══ ② ที่ปรึกษากลุ่ม: แก้ได้ผ่านฟังก์ชันเท่านั้น ═════════════════════════════

-- ชื่อ trigger ตั้งใจให้เรียงก่อน groups_stamp_advisor_year (0024) — BEFORE trigger ยิงตามลำดับตัวอักษร
-- ตัวนี้คืนค่าเดิมก่อน ตัวประทับปีจึงเห็นว่า "ไม่มีอะไรเปลี่ยน" และไม่ประทับปีใหม่ให้
create or replace function guard_group_advisors()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.advisor_ids is distinct from old.advisor_ids
     and coalesce(current_setting('prostho.advisor_write', true), '') <> 'on'
     and auth.uid() is not null          -- SQL Editor / service_role (งานดูแลระบบ) ผ่านได้
     and not is_admin() then
    new.advisor_ids := old.advisor_ids;
    new.advisor_year := old.advisor_year;
  end if;
  return new;
end $$;
revoke all on function guard_group_advisors() from public, anon;

drop trigger if exists groups_guard_advisors on groups;
create trigger groups_guard_advisors before update on groups
  for each row execute function guard_group_advisors();

-- ทางที่ถูก: เปิดธงก่อนเขียน (เนื้อฟังก์ชันเหมือน 0024 ทุกบรรทัด เพิ่มแค่ธง)
create or replace function write_group_advisors(p_group text, p_ids text[], p_note text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare
  slots text[] := array(select x from unnest(coalesce(p_ids, array[]::text[])) with ordinality u(x, n)
                        where coalesce(x, '') <> '' group by x order by min(n));
  actor text;
begin
  while coalesce(array_length(slots, 1), 0) < 2 loop slots := array_append(slots, ''); end loop;
  perform set_config('prostho.advisor_write', 'on', true);
  update groups set advisor_ids = slots where code = p_group;
  perform set_config('prostho.advisor_write', 'off', true);
  update students set advisor_ids = slots where "group" = p_group;
  actor := coalesce(
    (select name from teachers where id = my_teacher_id()),
    (select email from app_users where uid = auth.uid()),
    'ไม่ทราบผู้ใช้'
  );
  insert into audit (id, text, who, at_when, group_code)
  values (
    'a-adv-' || replace(gen_random_uuid()::text, '-', ''),
    p_note,
    actor,
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    p_group
  );
  return slots;
end $$;
revoke all on function write_group_advisors(text, text[], text) from public, anon, authenticated;

create or replace function reset_advisors_for_new_year()
returns int language plpgsql security definer set search_path = public
as $$
declare
  stale text[];
  y int := current_academic_year();
begin
  if not is_teacher() and not is_admin() then return 0; end if;
  select coalesce(array_agg(code), array[]::text[]) into stale from groups
  where advisor_year is distinct from y and exists (select 1 from unnest(advisor_ids) x where x <> '');
  if coalesce(array_length(stale, 1), 0) = 0 then return 0; end if;
  perform set_config('prostho.advisor_write', 'on', true);
  update groups set advisor_ids = array['', ''] where code = any(stale);   -- trigger 0024 ประทับปีนี้ให้
  perform set_config('prostho.advisor_write', 'off', true);
  update students set advisor_ids = array['', ''] where "group" = any(stale);
  insert into audit (id, text, who, at_when)
  values (
    'a-adv-reset-' || y,   -- id ตายตัวต่อปี = สองเครื่องเปิดพร้อมกันก็จดครั้งเดียว
    format('ขึ้นปีการศึกษา %s — ล้างอาจารย์ที่ปรึกษาของปีก่อน %s กลุ่ม ให้อาจารย์เลือกใหม่', y, array_length(stale, 1)),
    'ระบบ',
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) on conflict (id) do nothing;
  return array_length(stale, 1);
end $$;
revoke all on function reset_advisors_for_new_year() from public, anon;
grant execute on function reset_advisors_for_new_year() to authenticated, service_role;

notify pgrst, 'reload schema';
