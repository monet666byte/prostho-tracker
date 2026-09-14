-- ═══════════════════════════════════════════════════════════════════════════
-- 0023 · นักศึกษาผูกบัญชีเอง แล้วอาจารย์ที่ปรึกษากดยืนยัน (14 ก.ย. 69)
--
-- ทำไม: ล็อกอินด้วย Google แล้ว แต่อีเมลนักศึกษาเป็น ชื่อ.นามสกุลย่อ@student.mahidol.edu
--   ไม่มีรหัสนักศึกษาในอีเมล ระบบจับคู่เองไม่ได้ · ผู้ใช้ไม่อยากให้ใครกรอกอีเมลทีละคนทุกปี
--
-- ขั้นตอน:
--   ① นักศึกษากดเข้าด้วย Google (@student.mahidol.edu) → ได้บัญชีที่ "ยังไม่ผูก" = เห็นข้อมูลอะไรไม่ได้เลย
--   ② ใส่รหัสนักศึกษา → request_link() สร้างคำขอ
--   ③ อาจารย์ที่ปรึกษาของกลุ่มนั้น (หรือหัวหน้าภาค) เห็นใน pending_link_requests() แล้วกด decide_link()
--   ④ ยืนยันแล้ว = สร้าง app_users + invites ให้ · เข้าครั้งหน้าได้เลย
--
-- ⚠️ ด่านอาจารย์ยืนยันห้ามถอดออก — ถ้าผูกทันทีที่ใส่รหัส นักศึกษาคนหนึ่งใส่รหัสเพื่อนแล้วเห็นคนไข้ของเพื่อนได้
-- คนที่ไม่ใช่ @student.mahidol.edu (เช่น อาจารย์) ยังต้องมีชื่อในรายชื่อเชิญก่อนเหมือนเดิม
--
-- ไม่ลบข้อมูล · รันซ้ำได้
-- วิธีติดตั้ง: SQL Editor → Run · แล้วรัน supabase/security-check.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ① อีเมลแบบไหนสร้างบัญชี "ยังไม่ผูก" เองได้ — ที่เดียวในระบบ (เพิ่มโดเมนต้องแก้ตรงนี้)
create or replace function self_link_email_ok(p_email text)
returns boolean language sql immutable set search_path = public
as $$ select lower(coalesce(p_email, '')) like '%@student.mahidol.edu' $$;


-- ② ตอนสร้างบัญชี: อยู่ในรายชื่อเชิญ = ผูกทันที (เดิม) · อีเมลนักศึกษามหาลัย = สร้างได้แต่ยังไม่ผูก · อื่นๆ = ไม่ให้สร้าง
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invites%rowtype;
begin
  select * into inv from invites where lower(email) = lower(new.email);
  if not found then
    if self_link_email_ok(new.email) then
      return new;  -- ไม่มีแถว app_users = RLS ไม่ให้เห็นอะไรเลย จนกว่าอาจารย์ยืนยัน
    end if;
    raise exception 'อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าระบบ — ติดต่อภาควิชาเพื่อเพิ่มรายชื่อ';
  end if;

  insert into app_users (uid, email, role, student_id, teacher_id, is_admin)
  values (new.id, new.email, inv.role, inv.student_id, inv.teacher_id, inv.is_admin)
  on conflict (uid) do update
    set role = excluded.role,
        student_id = excluded.student_id,
        teacher_id = excluded.teacher_id,
        is_admin = excluded.is_admin;
  return new;
end $$;


-- ③ ตารางคำขอ — ไม่มี policy = แตะตรงไม่ได้ ทุกอย่างผ่านฟังก์ชันข้างล่าง
create table if not exists link_requests (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null unique references auth.users (id) on delete cascade,  -- บัญชีละหนึ่งคำขอ
  email text not null,
  student_id text not null references students (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index if not exists link_requests_pending_idx on link_requests (student_id) where status = 'pending';
alter table link_requests enable row level security;
revoke all on link_requests from anon, authenticated;


-- ④ ใครยืนยันคำขอของนักศึกษาคนนี้ได้: หัวหน้าภาค หรืออาจารย์ที่ปรึกษาของกลุ่มที่นักศึกษาสังกัด
create or replace function can_decide_link(p_student_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select is_admin() or (
    is_teacher() and exists (
      select 1 from students s join groups g on g.code = s."group"
      where s.id = p_student_id and my_teacher_id() = any(g.advisor_ids)
    )
  )
$$;


-- ⑤ นักศึกษาส่งคำขอด้วยรหัสนักศึกษา — คืนชื่อ/กลุ่มให้เจ้าตัวตรวจว่าใส่รหัสถูก
--    (คนเรียกต้องมีบัญชี @student.mahidol.edu ที่ยังไม่ผูก — เห็นได้แค่ชื่อกับกลุ่มของรหัสที่ใส่)
create or replace function request_link(p_student_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_email text;
  st students%rowtype;
  n int;
begin
  if me is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if exists (select 1 from app_users where uid = me) then
    raise exception 'บัญชีนี้ผูกกับรายชื่อแล้ว';
  end if;
  select email into my_email from auth.users where id = me;
  if not self_link_email_ok(my_email) then
    raise exception 'ผูกบัญชีเองได้เฉพาะอีเมล @student.mahidol.edu — ติดต่อภาควิชาเพื่อเพิ่มรายชื่อ';
  end if;

  select count(*) into n from students where code = btrim(coalesce(p_student_code, ''));
  if n = 0 then
    raise exception 'ไม่พบรหัสนักศึกษานี้ในรายชื่อ — ตรวจรหัสอีกครั้ง หรือติดต่ออาจารย์ที่ปรึกษา';
  elsif n > 1 then
    raise exception 'รหัสนี้มีมากกว่าหนึ่งรายการในระบบ — ติดต่ออาจารย์ที่ปรึกษา';
  end if;
  select * into st from students where code = btrim(p_student_code);

  if exists (select 1 from app_users where student_id = st.id) then
    raise exception 'รหัสนี้มีบัญชีผูกไว้แล้ว — ถ้าไม่ใช่ของคุณ ติดต่ออาจารย์ที่ปรึกษา';
  end if;

  insert into link_requests (uid, email, student_id, status, created_at)
  values (me, lower(my_email), st.id, 'pending', now())
  on conflict (uid) do update
    set email = excluded.email, student_id = excluded.student_id, status = 'pending',
        created_at = now(), decided_at = null, decided_by = null;

  return jsonb_build_object('status', 'pending', 'student_name', st.name, 'student_code', st.code, 'group_code', st."group");
end $$;


-- ⑥ สถานะคำขอของฉัน (null = ยังไม่เคยส่ง)
create or replace function my_link_request()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'status', r.status, 'student_name', s.name, 'student_code', s.code, 'group_code', s."group",
    'created_at', r.created_at, 'decided_at', r.decided_at
  )
  from link_requests r left join students s on s.id = r.student_id
  where r.uid = auth.uid()
$$;


-- ⑦ ยกเลิกคำขอของฉัน (เช่น ใส่รหัสผิด) — คำขอที่ยืนยันแล้วยกเลิกไม่ได้
create or replace function cancel_link_request()
returns void language sql security definer set search_path = public
as $$ delete from link_requests where uid = auth.uid() and status <> 'approved' $$;


-- ⑧ รายการรอยืนยันที่ฉันมีสิทธิ์ตัดสิน · same_student = มีกี่บัญชีขอผูกนักศึกษาคนเดียวกัน (มากกว่า 1 = น่าสงสัย)
create or replace function pending_link_requests()
returns table (
  id uuid, email text, student_id text, student_code text, student_name text,
  group_code text, created_at timestamptz, same_student int
)
language sql stable security definer set search_path = public
as $$
  select r.id, r.email, s.id, s.code, s.name, s."group", r.created_at,
         (select count(*)::int from link_requests r2 where r2.student_id = r.student_id and r2.status = 'pending')
  from link_requests r
  join students s on s.id = r.student_id
  where r.status = 'pending' and can_decide_link(s.id)
  order by r.created_at
$$;


-- ⑨ ยืนยัน/ปฏิเสธ — ยืนยันแล้วสร้าง app_users + invites · คำขออื่นที่ขอนักศึกษาคนเดียวกันถูกปฏิเสธให้เอง · จด audit
create or replace function decide_link(p_request uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  r link_requests%rowtype;
  st students%rowtype;
  actor text;
begin
  select * into r from link_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'คำขอนี้ไม่ได้รอยืนยันแล้ว — รีเฟรชหน้าอีกครั้ง';
  end if;
  if not can_decide_link(r.student_id) then
    raise exception 'ยืนยันได้เฉพาะอาจารย์ที่ปรึกษาของกลุ่ม หรือหัวหน้าภาค';
  end if;
  select * into st from students where id = r.student_id;
  actor := coalesce(
    (select name from teachers where id = my_teacher_id()),
    (select email from app_users where uid = auth.uid()),
    'ไม่ทราบผู้ใช้'
  );

  if p_approve then
    if exists (select 1 from app_users where student_id = r.student_id) then
      raise exception 'นักศึกษาคนนี้มีบัญชีผูกไว้แล้ว';
    end if;
    if exists (select 1 from app_users where uid = r.uid) then
      raise exception 'บัญชีนี้ผูกกับรายชื่ออื่นแล้ว';
    end if;
    if exists (select 1 from invites where lower(email) = lower(r.email)) then
      -- ไม่เขียนทับรายชื่อเชิญที่หัวหน้าภาคตั้งไว้ (อาจเป็นบทบาทอื่น)
      raise exception 'อีเมลนี้มีอยู่ในรายชื่อเชิญแล้ว — ให้หัวหน้าภาคตรวจในหน้ารายชื่อ';
    end if;
    insert into invites (email, role, student_id, teacher_id, is_admin)
    values (lower(r.email), 'student', r.student_id, null, false);
    insert into app_users (uid, email, role, student_id, teacher_id, is_admin)
    values (r.uid, r.email, 'student', r.student_id, null, false);
    update link_requests set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = r.id;
    update link_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid()
      where student_id = r.student_id and status = 'pending' and id <> r.id;
  else
    update link_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = r.id;
  end if;

  insert into audit (id, text, who, at_when, student_id, group_code)
  values (
    'a-link-' || replace(gen_random_uuid()::text, '-', ''),
    format('%s บัญชี %s เป็น %s (%s)', case when p_approve then 'ยืนยัน' else 'ปฏิเสธ' end, r.email, st.name, st.code),
    actor,
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    r.student_id,
    st."group"
  );

  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end);
end $$;


-- ⑩ สิทธิ์เรียก: เฉพาะคนที่ล็อกอิน (anon ห้าม · ตามแนว 0021)
do $$
declare f text;
begin
  foreach f in array array[
    'self_link_email_ok(text)', 'can_decide_link(text)', 'request_link(text)', 'my_link_request()',
    'cancel_link_request()', 'pending_link_requests()', 'decide_link(uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
