-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 · อาจารย์เลือกกลุ่มที่ปรึกษาเอง · หัวหน้าภาคแก้ให้ได้ (14 ก.ย. 69)
--
-- ปัญหา: นำเข้ารายชื่อรุ่นใหม่ได้กลุ่มที่ advisor_ids = ['', ''] และไม่มีหน้าไหนในแอปตั้งที่ปรึกษาได้
--   (ที่ปรึกษามาจากการนำเข้าชีตเท่านั้น) → รุ่นใหม่ไม่มี "กลุ่มของฉัน" และคำขอผูกบัญชี (0023)
--   ยืนยันได้แค่หัวหน้าภาค
--
-- ผู้ใช้เคาะ: อาจารย์เลือกเองว่าดูแลกลุ่มไหน (ครั้งเดียวต่อรุ่น) + หัวหน้าภาคแก้ได้
--
-- ⚠️ ที่ปรึกษาเก็บสองที่ ต้องตรงกันเสมอ — ฟังก์ชันในไฟล์นี้เขียนทั้งคู่ในคำสั่งเดียว:
--    groups.advisor_ids   → กฎบนฐานข้อมูลใช้ (my_group · can_decide_link)
--    students.advisor_ids → หน้าจอใช้ (ชื่อที่ปรึกษา · กลุ่มของฉัน)
-- กลุ่มละ 2 ช่องเสมอ ('' = ว่าง) ตามรูปแบบเดิมของแอป
--
-- ไม่ลบข้อมูล · รันซ้ำได้ · วิธีติดตั้ง: SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════


-- ① เขียนที่ปรึกษาของกลุ่มลงทั้งสองที่ + จด audit (ใช้ภายในเท่านั้น — ไม่เปิดให้เรียกตรง)
create or replace function write_group_advisors(p_group text, p_ids text[], p_note text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare
  slots text[] := array[coalesce(p_ids[1], ''), coalesce(p_ids[2], '')];
  actor text;
begin
  update groups set advisor_ids = slots where code = p_group;
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


-- ② อาจารย์: "ฉันเป็นที่ปรึกษากลุ่มนี้" — ลงช่องที่ว่าง · ครบ 2 ท่านแล้วต้องให้หัวหน้าภาคแก้
create or replace function claim_group(p_group text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare
  me text := my_teacher_id();
  cur text[];
  tname text;
begin
  if me is null then raise exception 'เลือกกลุ่มที่ปรึกษาได้เฉพาะอาจารย์'; end if;
  select advisor_ids into cur from groups where code = p_group for update;
  if not found then raise exception 'ไม่พบกลุ่มนี้'; end if;
  cur := array[coalesce(cur[1], ''), coalesce(cur[2], '')];
  if me = any(cur) then return cur; end if;  -- เลือกไว้แล้ว ไม่ต้องทำอะไร
  select name into tname from teachers where id = me;
  if cur[1] = '' then
    cur[1] := me;
  elsif cur[2] = '' then
    cur[2] := me;
  else
    raise exception 'กลุ่มนี้มีอาจารย์ที่ปรึกษาครบ 2 ท่านแล้ว — ถ้าไม่ถูกต้อง ติดต่อหัวหน้าภาค';
  end if;
  return write_group_advisors(p_group, cur, format('%s เลือกเป็นอาจารย์ที่ปรึกษากลุ่ม %s', coalesce(tname, me), p_group));
end $$;


-- ③ อาจารย์: ถอนตัวจากกลุ่มที่เลือกผิด
create or replace function release_group(p_group text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare
  me text := my_teacher_id();
  cur text[];
  tname text;
begin
  if me is null then raise exception 'เฉพาะอาจารย์'; end if;
  select advisor_ids into cur from groups where code = p_group for update;
  if not found then raise exception 'ไม่พบกลุ่มนี้'; end if;
  cur := array[coalesce(cur[1], ''), coalesce(cur[2], '')];
  if not (me = any(cur)) then return cur; end if;
  select name into tname from teachers where id = me;
  cur := array[case when cur[1] = me then '' else cur[1] end, case when cur[2] = me then '' else cur[2] end];
  return write_group_advisors(p_group, cur, format('%s ถอนตัวจากอาจารย์ที่ปรึกษากลุ่ม %s', coalesce(tname, me), p_group));
end $$;


-- ④ หัวหน้าภาค: ตั้งที่ปรึกษาของกลุ่มตรงๆ (สูงสุด 2 ท่าน · ว่างได้)
create or replace function set_group_advisors(p_group text, p_ids text[])
returns text[] language plpgsql security definer set search_path = public
as $$
declare
  ids text[] := array[]::text[];
  x text;
  names text;
begin
  if not is_admin() then raise exception 'ตั้งอาจารย์ที่ปรึกษาให้คนอื่นได้เฉพาะหัวหน้าภาค'; end if;
  if not exists (select 1 from groups where code = p_group) then raise exception 'ไม่พบกลุ่มนี้'; end if;
  foreach x in array coalesce(p_ids, array[]::text[]) loop
    x := coalesce(btrim(x), '');
    if x = '' or x = any(ids) then continue; end if;
    if not exists (select 1 from teachers where id = x) then raise exception 'ไม่พบอาจารย์รหัส %', x; end if;
    ids := ids || x;
  end loop;
  if coalesce(array_length(ids, 1), 0) > 2 then raise exception 'กลุ่มหนึ่งมีอาจารย์ที่ปรึกษาได้ไม่เกิน 2 ท่าน'; end if;
  select string_agg(t.name, ' / ') into names from teachers t where t.id = any(ids);
  return write_group_advisors(p_group, ids, format('ตั้งอาจารย์ที่ปรึกษากลุ่ม %s: %s', p_group, coalesce(names, 'ไม่มี')));
end $$;


-- ⑤ สิทธิ์เรียก
revoke all on function write_group_advisors(text, text[], text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['claim_group(text)', 'release_group(text)', 'set_group_advisors(text, text[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
