-- ═══════════════════════════════════════════════════════════════════════════
-- 0027 · ปิดช่องที่เหลือก่อนส่งมอบระบบให้ภาค
--
-- ไฟล์นี้แก้กฎการเข้าถึงกับโครงสร้างประกอบ ไม่ลบข้อมูลผู้ป่วย ไม่แตะบัญชีจริงคนไหน
-- (ลบเฉพาะบัญชีทดสอบ @example.com ที่ 0003/0005 ใส่ไว้ — ดู ④) · รันซ้ำได้ทุกบล็อก
--
-- ① checkin_delete_guard — นักศึกษาลบได้เฉพาะคาบที่ยังไม่มีคะแนน
--    RLS ของ checkins ให้เจ้าของแถวลบได้ทั้งแถว แต่คาบที่อาจารย์ประเมินแล้วคือหลักฐาน
--    ในสมุดที่เซ็นจริง ยิง API ลบตรงๆ ได้ = คะแนนหายโดยไม่มีร่องรอย (trigger 0017/0020
--    กันแค่ update ไม่ได้กัน delete)
-- ② กฎอ่านที่เคยเป็น using (true) ต้องเป็นบัญชีที่ผูกกับรายชื่อแล้วเท่านั้น
--    0023 ให้ @student.mahidol.edu สร้างบัญชี "ยังไม่ผูก" ได้ → บัญชีพวกนั้นเคยอ่าน
--    รายชื่ออาจารย์ / กลุ่ม / ค่าตั้ง / นโยบาย PDPA ได้ทั้งตาราง ทั้งที่ยังไม่มีใครยืนยันว่าเป็นใคร
-- ③ index บน updated_at ทุกตารางที่แอปดึงแบบ "เฉพาะแถวที่ขยับ" (pullAll เทียบคอลัมน์นี้ทุก 15 วิ)
--    + audit(actor_uid) สำหรับกฎ audit_read + students(code) สำหรับ request_link
-- ④ ลบบัญชีทดสอบ @example.com ทั้งบัญชีล็อกอินและรายชื่อเชิญ (0003/0005 ใส่ไว้ตอนพัฒนา)
--    เผื่อมีคนรัน 0003 ซ้ำแล้วบัญชีฟื้น — ไฟล์นี้อยู่หลังจึงลบทับให้เสมอ
-- ⑤ request_link นับจำนวนครั้ง — บัญชีหนึ่งขอผูกได้ไม่เกิน 5 ครั้ง
--    ทุกครั้งที่ส่งรหัสถูกจะได้ชื่อ+กลุ่มของรหัสนั้นกลับมา (แอปต้องใช้ให้เจ้าตัวตรวจ)
--    ไม่มีเพดาน = บัญชีนักศึกษาหนึ่งบัญชีไล่รหัส 7 หลักแล้วเก็บชื่อทั้งรายชื่อได้
--    ตัวนับต้องอยู่รอดตอนกด "แก้รหัส" ด้วย ไม่งั้นกดยกเลิกแล้วขอใหม่ = นับหนึ่งใหม่ทุกรอบ
--    → cancel_link_request เปลี่ยนสถานะเป็น 'cancelled' แทนการลบแถว (my_link_request ถือว่าไม่มีคำขอ)
--
-- วิธีติดตั้ง: SQL Editor → Run · จากนั้นรัน supabase/security-check.sql ยืนยันทุกครั้ง
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- ① นักศึกษาลบคาบที่ประเมินแล้วไม่ได้
--
-- ผ่านได้สามทาง: อาจารย์/หัวหน้ารายวิชา (ลบตามหน้าที่ · ตัวลบตามกำหนดเก็บ 0016/0019 เรียกในนามหัวหน้ารายวิชา)
-- และคำสั่งที่ไม่มีคนล็อกอิน (SQL Editor / service_role — remove-demo-rows.sql ต้องยังลบข้อมูลตัวอย่างได้)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function guard_checkin_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or is_teacher() or is_admin() then return old; end if;
  if old.status is distinct from 'pending' or old.scores is not null then
    raise exception 'คาบที่อาจารย์ประเมินแล้วลบไม่ได้ — ติดต่ออาจารย์ที่ปรึกษา';
  end if;
  return old;
end $$;
revoke execute on function guard_checkin_delete() from public, anon;

drop trigger if exists checkin_delete_guard on checkins;
create trigger checkin_delete_guard
  before delete on checkins
  for each row execute function guard_checkin_delete();


-- ─────────────────────────────────────────────────────────────────────────────
-- ② อ่านข้อมูลกลางได้เฉพาะบัญชีที่ผูกแล้ว
--
-- my_role() (0016) คืน admin / teacher / student ตาม app_users · บัญชีที่ยังไม่ผูก = null
-- หัวหน้ารายวิชาที่ไม่มีแถว teachers ก็ผ่าน (is_admin() มาก่อนในลำดับของ my_role)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists teachers_read on teachers;
create policy teachers_read on teachers for select to authenticated
  using (my_role() is not null);

drop policy if exists groups_read on groups;
create policy groups_read on groups for select to authenticated
  using (my_role() is not null);

drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings for select to authenticated
  using (my_role() is not null);

drop policy if exists pdpa_policy_read on pdpa_policy;
create policy pdpa_policy_read on pdpa_policy for select to authenticated
  using (my_role() is not null);


-- ─────────────────────────────────────────────────────────────────────────────
-- ③ index
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  -- ต้องตรงกับ TABLES ใน src/data/cloudSync.ts + สองตารางค่าตั้งที่แอปดึงแยก
  foreach t in array array[
    'teachers','students','groups','patients','workpieces','updates','photos',
    'checkins','reviews','submissions','issues','audit','self_assessments',
    'sect2_records','sect3_records','app_settings','pdpa_policy'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('create index if not exists %I on %I (updated_at)', t || '_updated_at_idx', t);
  end loop;
end $$;

create index if not exists audit_actor_uid_idx on audit (actor_uid);
-- ไม่ unique โดยเจตนา — request_link ตรวจเองว่ารหัสซ้ำแล้วปฏิเสธ (ข้อมูลเก่าจากชีตอาจซ้ำได้)
create index if not exists students_code_idx on students (code);


-- ─────────────────────────────────────────────────────────────────────────────
-- ④ บัญชีทดสอบ @example.com ต้องไม่มีบนเซิร์ฟเวอร์จริง
--
-- ลำดับเดียวกับ supabase/remove-test-accounts.sql: auth.users ก่อน (app_users / link_requests
-- หายตาม cascade) แล้วค่อยรายชื่อเชิญ · audit ไม่แตะ (ลบไม่ได้ตามการออกแบบ)
-- ─────────────────────────────────────────────────────────────────────────────
delete from auth.users where email ilike '%@example.com';
delete from public.app_users where email ilike '%@example.com';
delete from public.invites where email ilike '%@example.com';


-- ─────────────────────────────────────────────────────────────────────────────
-- ⑤ request_link — ไม่เกิน 5 ครั้งต่อบัญชี
-- ─────────────────────────────────────────────────────────────────────────────
alter table link_requests add column if not exists attempts int not null default 0;

-- สถานะ 'cancelled' = เคยขอแล้วกดยกเลิกเอง · แถวยังอยู่เพื่อเก็บตัวนับ
alter table link_requests drop constraint if exists link_requests_status_check;
alter table link_requests add constraint link_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

create or replace function request_link(p_student_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_email text;
  st students%rowtype;
  n int;
  used int;
begin
  if me is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if exists (select 1 from app_users where uid = me) then
    raise exception 'บัญชีนี้ผูกกับรายชื่อแล้ว';
  end if;
  select email into my_email from auth.users where id = me;
  if not self_link_email_ok(my_email) then
    raise exception 'ผูกบัญชีเองได้เฉพาะอีเมล @student.mahidol.edu — ติดต่อภาควิชาเพื่อเพิ่มรายชื่อ';
  end if;

  -- เพดานตรวจก่อนอ่านรายชื่อ — ครบแล้วแม้รหัสถูกก็ไม่บอกชื่อใครอีก
  select attempts into used from link_requests where uid = me;
  if coalesce(used, 0) >= 5 then
    raise exception 'ส่งคำขอครบ 5 ครั้งแล้ว — ติดต่ออาจารย์ที่ปรึกษาให้ผูกบัญชีให้';
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

  insert into link_requests (uid, email, student_id, status, created_at, attempts)
  values (me, lower(my_email), st.id, 'pending', now(), 1)
  on conflict (uid) do update
    set email = excluded.email, student_id = excluded.student_id, status = 'pending',
        created_at = now(), decided_at = null, decided_by = null,
        attempts = link_requests.attempts + 1;

  -- แอปโชว์ชื่อ/กลุ่มให้เจ้าตัวตรวจว่าใส่รหัสถูก (LinkAccount.tsx) — คงรูปเดิม
  return jsonb_build_object('status', 'pending', 'student_name', st.name, 'student_code', st.code, 'group_code', st."group");
end $$;

-- ยกเลิก = เก็บแถวไว้ (ตัวนับต้องอยู่รอด) · คำขอที่ยืนยันแล้วยกเลิกไม่ได้เหมือนเดิม
create or replace function cancel_link_request()
returns void language sql security definer set search_path = public
as $$
  update link_requests set status = 'cancelled', decided_at = null, decided_by = null
  where uid = auth.uid() and status <> 'approved'
$$;

-- แถวที่ยกเลิกแล้ว = "ยังไม่เคยส่ง" ในสายตาแอป
create or replace function my_link_request()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'status', r.status, 'student_name', s.name, 'student_code', s.code, 'group_code', s."group",
    'created_at', r.created_at, 'decided_at', r.decided_at
  )
  from link_requests r left join students s on s.id = r.student_id
  where r.uid = auth.uid() and r.status <> 'cancelled'
$$;

-- สิทธิ์เรียกคงเดิม (create or replace ไม่ล้าง grant) — ยืนยันซ้ำให้ชัดตามแนว 0021
do $$
declare f text;
begin
  foreach f in array array['request_link(text)', 'cancel_link_request()', 'my_link_request()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
