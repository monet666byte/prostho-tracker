-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 · อาจารย์เลือกกลุ่มที่ปรึกษาเอง · หัวหน้าภาคแก้ให้ได้ (14 ก.ย. 69)
--
-- ปัญหา: นำเข้ารายชื่อรุ่นใหม่ได้กลุ่มที่ advisor_ids = ['', ''] และไม่มีหน้าไหนในแอปตั้งที่ปรึกษาได้
--   (ที่ปรึกษามาจากการนำเข้าชีตเท่านั้น) → รุ่นใหม่ไม่มี "กลุ่มของฉัน" และคำขอผูกบัญชี (0023)
--   ยืนยันได้แค่หัวหน้าภาค
--
-- ผู้ใช้เคาะ: อาจารย์เลือกเองว่าดูแลกลุ่มไหน (ครั้งเดียวต่อรุ่น) + หัวหน้าภาคแก้ได้
-- ผู้ใช้ยืนยัน: **กลุ่มหนึ่งมีที่ปรึกษากี่ท่านก็ได้ · อาจารย์หนึ่งท่านดูแลได้หลายกลุ่ม**
--   → เดิม my_group() / is_my_student() คืนแค่ "กลุ่มแรก" ของอาจารย์ (0005) = ดูแลสองกลุ่มแล้ว
--     เห็น audit ของกลุ่มที่สองไม่ได้ · ไฟล์นี้เพิ่ม my_advised_groups() แล้ววางกฎ audit ใหม่ให้ครอบทุกกลุ่ม
--
-- ผู้ใช้เคาะเพิ่ม: **ขึ้นปีการศึกษาใหม่ ล้างที่เลือกไว้ทั้งหมด ทุกคนเลือกใหม่**
--   วันที่ล้าง "เดี๋ยวคุยกันอีกที" — ตอนนี้ใช้ 1 มิ.ย. (ตรงกับ academicYear() ในแอป) · แก้ที่ current_academic_year() ที่เดียว
--   กลไก: groups.advisor_year = ปีการศึกษาที่ตั้งที่ปรึกษา · ปีไม่ตรงปัจจุบัน = ถือว่าไม่มีที่ปรึกษา (กฎบนฐานข้อมูลเช็คเอง
--   ไม่ต้องรอใครกด) · และ reset_advisors_for_new_year() ล้างข้อมูลจริงให้หน้าจอเห็นตรงกัน (แอปเรียกตอนอาจารย์เปิดแอป)
--
-- ⚠️ ที่ปรึกษาเก็บสองที่ ต้องตรงกันเสมอ — ฟังก์ชันในไฟล์นี้เขียนทั้งคู่ในคำสั่งเดียว:
--    groups.advisor_ids   → กฎบนฐานข้อมูลใช้ (my_group · can_decide_link)
--    students.advisor_ids → หน้าจอใช้ (ชื่อที่ปรึกษา · กลุ่มของฉัน)
-- รูปแบบที่เก็บ: รายชื่อรหัสอาจารย์ที่ไม่ว่าง ถ้าน้อยกว่า 2 เติม '' ให้ครบ 2 ช่อง (แอปรุ่นเก่าอ่านรูปนี้)
--
-- ไม่ลบข้อมูล · รันซ้ำได้ · วิธีติดตั้ง: SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════


-- ⓪ ปีการศึกษา (พ.ศ.) ปัจจุบัน — ⚠️ วันขึ้นปี 1 มิ.ย. เป็นสมมติฐาน รอผู้ใช้เคาะ (ตรงกับ lib/date.ts → academicYear)
create or replace function current_academic_year()
returns int language sql stable set search_path = public
as $$ select (extract(year from (now() at time zone 'Asia/Bangkok') - interval '5 months'))::int + 543 $$;

alter table groups add column if not exists advisor_year int;
-- ที่ปรึกษาที่มีอยู่แล้วตอนติดตั้ง (จากการนำเข้าชีต) นับเป็นของปีนี้ ไม่งั้นหายทันทีที่รันไฟล์นี้
update groups set advisor_year = current_academic_year()
where advisor_year is null and exists (select 1 from unnest(advisor_ids) x where x <> '');

-- ประทับปีทุกครั้งที่รายชื่อที่ปรึกษาเปลี่ยน ไม่ว่าจะมาทางไหน (ฟังก์ชันข้างล่าง · การนำเข้าชีตที่ sync ขึ้นมาตรงๆ)
create or replace function stamp_advisor_year()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.advisor_ids is distinct from old.advisor_ids then
    new.advisor_year := current_academic_year();
  end if;
  return new;
end $$;
drop trigger if exists groups_stamp_advisor_year on groups;
create trigger groups_stamp_advisor_year before insert or update on groups
  for each row execute function stamp_advisor_year();

-- ที่ปรึกษาที่ "ใช้ได้ปีนี้" ของกลุ่ม — กฎทุกข้อต้องอ่านผ่านตัวนี้ ห้ามอ่าน advisor_ids ตรง
create or replace function current_advisors(p_group text)
returns text[] language sql stable security definer set search_path = public
as $$
  select case when g.advisor_year = current_academic_year() then g.advisor_ids else array[]::text[] end
  from groups g where g.code = p_group
$$;


-- ① เขียนที่ปรึกษาของกลุ่มลงทั้งสองที่ + จด audit (ใช้ภายในเท่านั้น — ไม่เปิดให้เรียกตรง)
create or replace function write_group_advisors(p_group text, p_ids text[], p_note text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare
  slots text[] := array(select x from unnest(coalesce(p_ids, array[]::text[])) with ordinality u(x, n)
                        where coalesce(x, '') <> '' group by x order by min(n));
  actor text;
begin
  while coalesce(array_length(slots, 1), 0) < 2 loop slots := array_append(slots, ''); end loop;
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


-- ② อาจารย์: "ฉันเป็นที่ปรึกษากลุ่มนี้" — ต่อท้ายรายชื่อที่ปรึกษา (ไม่จำกัดจำนวน · ดูแลหลายกลุ่มได้)
create or replace function claim_group(p_group text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare
  me text := my_teacher_id();
  cur text[];
  tname text;
begin
  if me is null then raise exception 'เลือกกลุ่มที่ปรึกษาได้เฉพาะอาจารย์'; end if;
  perform 1 from groups where code = p_group for update;
  if not found then raise exception 'ไม่พบกลุ่มนี้'; end if;
  cur := current_advisors(p_group);  -- ของปีก่อน = ว่าง
  if me = any(coalesce(cur, array[]::text[])) then return cur; end if;  -- เลือกไว้แล้ว ไม่ต้องทำอะไร
  select name into tname from teachers where id = me;
  return write_group_advisors(p_group, coalesce(cur, array[]::text[]) || me,
    format('%s เลือกเป็นอาจารย์ที่ปรึกษากลุ่ม %s', coalesce(tname, me), p_group));
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
  perform 1 from groups where code = p_group for update;
  if not found then raise exception 'ไม่พบกลุ่มนี้'; end if;
  cur := current_advisors(p_group);
  if not (me = any(coalesce(cur, array[]::text[]))) then return cur; end if;
  select name into tname from teachers where id = me;
  cur := array_remove(cur, me);
  return write_group_advisors(p_group, cur, format('%s ถอนตัวจากอาจารย์ที่ปรึกษากลุ่ม %s', coalesce(tname, me), p_group));
end $$;


-- ④ หัวหน้าภาค: ตั้งที่ปรึกษาของกลุ่มตรงๆ (กี่ท่านก็ได้ · ว่างได้)
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
  select string_agg(t.name, ' / ') into names from teachers t where t.id = any(ids);
  return write_group_advisors(p_group, ids, format('ตั้งอาจารย์ที่ปรึกษากลุ่ม %s: %s', p_group, coalesce(names, 'ไม่มี')));
end $$;


-- ⑤ กลุ่มทั้งหมดที่ฉันเป็นที่ปรึกษา — แทน my_group() (คืนกลุ่มเดียว) ในกฎที่ตั้งใจให้อาจารย์เห็นกลุ่มที่ดูแล
create or replace function my_advised_groups()
returns text[] language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(g.code), array[]::text[]) from groups g
  where my_teacher_id() is not null and my_teacher_id() = any(g.advisor_ids)
    and g.advisor_year = current_academic_year()   -- ของปีก่อนไม่นับ (ขึ้นปีใหม่ = ล้าง)
$$;

-- ใครยืนยันบัญชีนักศึกษาได้ (0023) — ใช้ที่ปรึกษาของปีนี้เท่านั้น
create or replace function can_decide_link(p_student_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select is_admin() or (
    is_teacher() and exists (
      select 1 from students s where s.id = p_student_id and s."group" = any(my_advised_groups())
    )
  )
$$;

-- ⑤ข ขึ้นปีการศึกษาใหม่: ล้างที่ปรึกษาของปีก่อนออกจากข้อมูลจริง (ทั้งสองที่) — เรียกซ้ำได้ ไม่มีอะไรให้ล้างก็ไม่ทำอะไร
--    แอปเรียกตอนอาจารย์เปิดแอป · กฎบนฐานข้อมูลไม่นับของปีก่อนอยู่แล้ว ตัวนี้มีไว้ให้หน้าจอเห็นตรงกัน
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
  update groups set advisor_ids = array['', ''] where code = any(stale);   -- trigger ประทับปีนี้ให้
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

-- นักศึกษาคนนี้อยู่ในกลุ่มใดกลุ่มหนึ่งที่ฉันดูแลไหม (เดิม 0005 ดูแค่กลุ่มแรก)
-- ⚠️ ความหมายเดิม "นศ. อยู่กลุ่มเดียวกับฉัน" สำหรับนักศึกษาไม่มีที่ใช้แล้ว (0021 ห่อด้วย is_teacher() ทุกจุด)
create or replace function is_my_student(sid text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from students s where s.id = sid and s."group" = any(my_advised_groups()))
$$;

-- กฎอ่าน audit — เหมือน 0021 ทุกข้อ ยกเว้นข้อสุดท้ายครอบทุกกลุ่มที่ดูแล
drop policy if exists audit_read on audit;
create policy audit_read on audit for select to authenticated using (
  is_admin()                                                                   -- หัวหน้าภาค: ทั้งระบบ
  or actor_uid = auth.uid()                                                    -- ของที่ตัวเองทำ
  or (student_id is not null and student_id = my_student_id())                 -- เรื่องที่เกี่ยวกับตัวเอง
  or (is_teacher() and student_id is not null and is_my_student(student_id))  -- อาจารย์: นศ. ในกลุ่มที่ดูแล
  or (is_teacher() and group_code is not null and group_code = any(my_advised_groups()))  -- อาจารย์: เรื่องของทุกกลุ่มที่ดูแล
);


-- ⑥ สิทธิ์เรียก
revoke all on function write_group_advisors(text, text[], text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['claim_group(text)', 'release_group(text)', 'set_group_advisors(text, text[])',
                           'my_advised_groups()', 'is_my_student(text)', 'can_decide_link(text)',
                           'current_advisors(text)', 'reset_advisors_for_new_year()', 'current_academic_year()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
