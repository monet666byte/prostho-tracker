-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — โครง PDPA (retention · สิทธิ์ export · audit ของการ export)
-- migration ที่ 16
--
-- ⚠️ ไฟล์นี้คือ "โครงที่พร้อมเปิด" ไม่ใช่การเปิดใช้จริง
--    ค่าเริ่มต้นทุกตัวคือ "ปิด/ห้าม" — ภาควิชาต้องมาเปิดเองทีละข้อหลังอนุมัติ
--    รันไฟล์นี้แล้วระบบจะ "เข้มขึ้น" (ส่งออกไม่ได้จนกว่าจะเปิดสิทธิ์) ไม่ใช่หลวมลง
--
-- สิ่งที่ไฟล์นี้เพิ่ม
--   ① pdpa_policy — ตารางนโยบายแถวเดียว แก้ได้เฉพาะหัวหน้าภาค (is_admin)
--       · retention_enabled  ปิดไว้ → ฟังก์ชันลบตามกำหนดจะปฏิเสธทุกครั้ง
--       · export_roles       ว่าง   → ไม่มีใครส่งออกได้เลย
--       · export_identified_roles ว่าง → ไม่มีใครส่งออก "แบบมีชื่อ/HN" ได้เลย
--   ② my_role() — บทบาทของคนที่ล็อกอินตามที่ฐานข้อมูลรู้จริง (แอปอ้างเองไม่ได้)
--   ③ audit.kind / audit.detail — ช่องบอกว่าแถวนี้เป็นเหตุการณ์ชนิดไหน
--       ฝั่งแอปเขียนค่าพวกนี้เองไม่ได้ (trigger ล้างทิ้ง) มีแต่ฟังก์ชันในไฟล์นี้ที่เขียนได้
--   ④ log_export() — ประตูเดียวของการส่งออกในโหมด cloud
--       ตรวจสิทธิ์ก่อน → ไม่ผ่าน = raise (แอปไม่สร้างไฟล์) → ผ่าน = จดลง audit
--       เวลาและตัวตนผู้ทำมาจากเซิร์ฟเวอร์ ฝั่งแอปปลอมไม่ได้
--   ⑤ retention_preview() / purge_expired_cohorts() — ลบจริงฝั่งเซิร์ฟเวอร์
--       เดิมการลบทำแค่ในเครื่องแล้วอาศัยคิว sync ซึ่งพลาดได้หลายทาง (ดูหมายเหตุข้อ ⑤)
--
-- สิ่งที่ไฟล์นี้ "ไม่" ทำ (ตั้งใจ — ต้องให้ภาคตัดสินก่อน)
--   · ไม่แตะ policy เดิมของตารางใดเลย — ไม่มีบรรทัดไหนทำให้ RLS หลวมลง
--   · ไม่แตะกติกา "audit แก้/ลบไม่ได้" ของ 0009 — แถว audit ยังลบไม่ได้แม้แต่ตอน retention
--     (ผลคือ audit ของรุ่นที่ถูกลบจะยังอยู่ ดูหัวข้อ "ค้างให้ภาคตัดสิน" ใน README)
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
--             ต้องรัน 0001–0014 มาก่อน · ไม่มีไฟล์ 0015
--             ไม่เกี่ยวกับ 0017_conflict.sql เลย (คนละตาราง คนละฟังก์ชัน) รันสลับลำดับกันได้
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- ① ปีการศึกษาไทยฝั่งเซิร์ฟเวอร์ — ต้องตรงกับ academicYear() ใน src/lib/date.ts
--    เซิร์ฟเวอร์อยู่สิงคโปร์ (UTC+8) ไทย UTC+7 — ถ้าใช้ current_date เฉยๆ
--    ช่วงเที่ยงคืนถึงตีหนึ่งของวันที่ 1 มิ.ย. จะคำนวณคนละปีกับในแอป
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function current_academic_year()
returns int language sql stable set search_path = public as $$
  select (extract(year from d)::int + 543)
         - case when extract(month from d)::int >= 6 then 0 else 1 end
  from (select (timezone('Asia/Bangkok', now()))::date as d) s
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ② บทบาทตามที่ฐานข้อมูลรู้ — ไม่ใช่ค่าที่แอปส่งมา
--    บัญชีที่ผูกทั้งสองฝั่ง (บัญชีสาธิต) นับเป็น admin > teacher > student
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function my_role()
returns text language sql stable security definer set search_path = public as $$
  select case
    when is_admin() then 'admin'
    when my_teacher_id() is not null then 'teacher'
    when my_student_id() is not null then 'student'
    else null
  end
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ③ ตารางนโยบาย PDPA — แถวเดียว (id = 'app') เหมือน app_settings
--
--    ทำไมไม่ใส่รวมใน app_settings: app_settings อาจารย์ทุกคนแก้ได้
--    แต่ "ใครส่งออกข้อมูลผู้ป่วยได้บ้าง" กับ "ลบข้อมูลจริงได้หรือยัง"
--    ต้องเป็นสิทธิ์ของหัวหน้าภาคคนเดียว ไม่งั้นอาจารย์คนไหนก็เปิดสิทธิ์ให้ตัวเองได้
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists pdpa_policy (
  id text primary key,

  -- ── retention ──────────────────────────────────────────────────────────
  -- ปิดไว้ก่อน: ตราบใดที่เป็น false ฟังก์ชันลบจะ raise ทุกครั้ง แม้หัวหน้าภาคสั่งเอง
  -- เปิดเมื่อภาคเคาะระยะเวลาเก็บที่แน่นอนแล้วเท่านั้น
  retention_enabled  boolean not null default false,
  -- เก็บย้อนหลังกี่รุ่น — ค่าตั้งต้น 5 ตามที่อาจารย์ขอ (1 ก.ย. 69) แต่ยังไม่ใช่มติภาค
  retention_cohorts  int     not null default 5 check (retention_cohorts between 1 and 50),

  -- ── สิทธิ์ส่งออก ────────────────────────────────────────────────────────
  -- ว่าง = ไม่มีใครส่งออกได้ · ใส่ได้เฉพาะ 'student' / 'teacher' / 'admin'
  export_roles            text[] not null default '{}',
  -- ใครส่งออก "แบบมีชื่อผู้ป่วย + HN" ได้ — ต้องเป็น subset ของ export_roles
  -- ว่าง = ทุกคนที่ส่งออกได้ จะได้ไฟล์ที่ปิดบังชื่อ/HN เสมอ
  export_identified_roles text[] not null default '{}',

  -- ── การปิดบังในหน้าจอ ───────────────────────────────────────────────────
  -- true = หน้าที่ไม่ได้ทำงานกับเคสตรงๆ แสดงแค่รหัสเคส (ค่าเริ่มต้นคือปิดบังไว้ก่อน)
  mask_by_default boolean not null default true,

  updated_by text,
  updated_at timestamptz not null default now()
);

insert into pdpa_policy (id) values ('app') on conflict (id) do nothing;

alter table pdpa_policy enable row level security;

-- อ่าน: ทุกคนที่ล็อกอิน — แอปต้องรู้ว่าปุ่มส่งออกควรกดได้ไหม และควรปิดบังหรือยัง
drop policy if exists pdpa_policy_read on pdpa_policy;
create policy pdpa_policy_read on pdpa_policy for select to authenticated using (true);

-- เขียน: หัวหน้าภาคเท่านั้น · ไม่มี policy delete เลย — แถวนี้ห้ามหาย
-- (ถ้าหาย แอปจะกลับไปใช้ค่า "ปิดทุกอย่าง" ในโค้ด ซึ่งปลอดภัยแต่ใช้งานไม่ได้)
drop policy if exists pdpa_policy_write on pdpa_policy;
create policy pdpa_policy_write on pdpa_policy for insert to authenticated
  with check (is_admin());

drop policy if exists pdpa_policy_update on pdpa_policy;
create policy pdpa_policy_update on pdpa_policy for update to authenticated
  using (is_admin()) with check (is_admin());

-- ยาม: แถวเดียว · เวลาจากเซิร์ฟเวอร์ · บทบาทต้องเป็นค่าที่รู้จัก · identified ⊆ export
create or replace function guard_pdpa_policy()
returns trigger language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  if new.id <> 'app' then
    raise exception 'ตารางนโยบาย PDPA มีได้แถวเดียว (id = app)';
  end if;

  select u.r into bad from unnest(new.export_roles) as u(r)
    where u.r not in ('student', 'teacher', 'admin') limit 1;
  if bad is not null then
    raise exception 'บทบาทที่ไม่รู้จักใน export_roles: %', bad;
  end if;

  select u.r into bad from unnest(new.export_identified_roles) as u(r)
    where u.r not in ('student', 'teacher', 'admin') limit 1;
  if bad is not null then
    raise exception 'บทบาทที่ไม่รู้จักใน export_identified_roles: %', bad;
  end if;

  -- ให้สิทธิ์ "ส่งออกพร้อมชื่อ" กับคนที่ส่งออกไม่ได้เลย = ตั้งค่าผิดแน่ๆ ปฏิเสธไปเลย
  select u.r into bad from unnest(new.export_identified_roles) as u(r)
    where not (u.r = any(new.export_roles)) limit 1;
  if bad is not null then
    raise exception 'บทบาท % ส่งออกไม่ได้ จะให้สิทธิ์ส่งออกพร้อมชื่อไม่ได้', bad;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists pdpa_policy_guard on pdpa_policy;
create trigger pdpa_policy_guard before insert or update on pdpa_policy
  for each row execute function guard_pdpa_policy();

-- realtime: หัวหน้าภาคเปิดสิทธิ์ → เครื่องที่เปิดแอปค้างอยู่รู้ทันที
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'pdpa_policy') then
    alter publication supabase_realtime add table pdpa_policy;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ④ audit: เพิ่มช่อง kind / detail สำหรับเหตุการณ์ที่ต้องค้นย้อนหลังเป็นชุด
--    (เช่น "ขอดูรายการ export ทั้งหมดของปีนี้" — ค้นจาก text ล้วนไม่ไหว)
--
--    ⚠️ สองช่องนี้ฝั่งแอปเขียนเองไม่ได้ — trigger ล้างเป็น null ทุกครั้ง
--    ยกเว้นการเขียนที่มาจากฟังก์ชันในไฟล์นี้ ซึ่งตั้งธงประจำ transaction ไว้ก่อน
--    ถ้าไม่กันตรงนี้ ใครก็ยิง API แต่งแถว kind='export' ปลอมได้ = หลักฐานเชื่อไม่ได้
-- ═══════════════════════════════════════════════════════════════════════════
alter table audit add column if not exists kind   text;
alter table audit add column if not exists detail jsonb;
create index if not exists audit_kind_idx on audit (kind, at_when desc);

-- แทนที่ audit_stamp_actor() จาก 0009 — คงพฤติกรรมเดิมไว้ครบ (ประทับ actor_uid เสมอ)
-- แล้วเพิ่มความเข้ม: kind/detail ที่ client ส่งมาเองถูกล้างทิ้ง
create or replace function audit_stamp_actor()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.actor_uid := auth.uid();   -- ไม่สนว่า client ส่งอะไรมา (เดิมจาก 0009)
  -- ธงนี้ตั้งได้จากฟังก์ชัน security definer ในไฟล์นี้เท่านั้น และหมดอายุเมื่อจบ transaction
  if coalesce(current_setting('prostho.audit_trusted', true), '') <> 'on' then
    new.kind   := null;
    new.detail := null;
  end if;
  return new;
end $$;
-- trigger audit_stamp จาก 0009 ชี้มาที่ฟังก์ชันนี้อยู่แล้ว ไม่ต้องสร้างใหม่
-- trigger audit_no_change จาก 0009 (ห้าม update/delete) ยังอยู่ครบ ไม่แตะ

-- ═══════════════════════════════════════════════════════════════════════════
-- ⑤ ประตูของการส่งออก
--
--    ขอบเขตที่ทำได้จริง — พูดตรงๆ ไว้ตรงนี้ เผื่อคนอ่านทีหลังเข้าใจผิด:
--    ฟังก์ชันนี้คุม "ปุ่มส่งออกในแอป" ให้ตรวจสิทธิ์ที่เซิร์ฟเวอร์และทิ้งร่องรอยเสมอ
--    มันไม่ได้ (และทำไม่ได้) กันคนที่เขียนสคริปต์ยิง REST API อ่านแถวเองแล้วประกอบ CSV
--    ตัวคุมของกรณีนั้นคือ RLS (0004–0012) ว่าบัญชีนั้นอ่านแถวไหนได้บ้าง
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function log_export(
  p_scope       text,     -- ส่งออกอะไร เช่น 'own-progress' | 'group' | 'cohort'
  p_row_count   int,      -- กี่แถว
  p_identified  boolean,  -- ไฟล์นี้มีชื่อ/HN จริงไหม
  p_student_id  text default null,   -- ถ้าเป็นการส่งออกของ นศ. คนเดียว
  p_group_code  text default null,
  p_note        text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare
  pol   pdpa_policy%rowtype;
  role  text;
  aid   text;
begin
  role := my_role();
  if role is null then
    raise exception 'บัญชีนี้ยังไม่ได้ผูกกับนักศึกษาหรืออาจารย์ — ส่งออกไม่ได้';
  end if;

  select * into pol from pdpa_policy where id = 'app';
  if not found then
    raise exception 'ยังไม่ได้ตั้งนโยบาย PDPA — ส่งออกไม่ได้';
  end if;

  if not (role = any(pol.export_roles)) then
    raise exception 'ภาควิชายังไม่ได้เปิดสิทธิ์ส่งออกให้บทบาท %', role;
  end if;

  if p_identified and not (role = any(pol.export_identified_roles)) then
    raise exception 'บทบาท % ส่งออกได้เฉพาะไฟล์ที่ปิดบังชื่อและ HN', role;
  end if;

  -- นักศึกษาส่งออกได้เฉพาะของตัวเอง — ต่อให้แอปส่ง id คนอื่นมาก็ไม่ผ่าน
  if role = 'student' then
    if p_student_id is distinct from my_student_id() then
      raise exception 'นักศึกษาส่งออกข้อมูลของคนอื่นไม่ได้';
    end if;
    if p_group_code is not null then
      raise exception 'นักศึกษาส่งออกข้อมูลระดับกลุ่มไม่ได้';
    end if;
  end if;

  aid := 'a-exp-' || replace(gen_random_uuid()::text, '-', '');

  -- เปิดธงให้ trigger ยอมรับ kind/detail แค่ใน transaction นี้
  perform set_config('prostho.audit_trusted', 'on', true);
  insert into audit (id, text, who, at_when, student_id, group_code, kind, detail)
  values (
    aid,
    format('ส่งออกข้อมูล (%s) %s แถว%s',
           p_scope, p_row_count,
           case when p_identified then ' · มีชื่อและ HN' else ' · ปิดบังชื่อและ HN' end),
    coalesce((select email from app_users where uid = auth.uid()), 'ไม่ทราบผู้ใช้'),
    to_char(timezone('Asia/Bangkok', now()), 'YYYY-MM-DD"T"HH24:MI:SS'),
    p_student_id,
    p_group_code,
    'export',
    jsonb_build_object(
      'scope', p_scope,
      'rows', p_row_count,
      'identified', p_identified,
      'role', role,
      'note', p_note,
      'at', to_char(timezone('Asia/Bangkok', now()), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    )
  );
  perform set_config('prostho.audit_trusted', 'off', true);

  return aid;
end $$;

revoke all on function log_export(text, int, boolean, text, text, text) from public;
grant execute on function log_export(text, int, boolean, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⑥ retention: ดูก่อน แล้วค่อยลบ
--
--    ทำไมต้องมีฝั่งเซิร์ฟเวอร์ ทั้งที่แอปมีปุ่มลบอยู่แล้ว (purgeExpiredCohorts ใน repo.ts):
--    ปุ่มเดิมลบใน IndexedDB แล้วปล่อยให้คิว sync ตามไปลบบนเซิร์ฟเวอร์
--    ซึ่งพลาดได้อย่างน้อย 4 ทาง และพลาดแบบ "เงียบ" ทั้งหมด
--      · เครื่องที่กดปุ่มไม่ได้โหลดรุ่นเก่าลงมาครบ → แถวที่ไม่มีในเครื่องไม่มีใครสั่งลบ
--      · คิวลบล้มเหลว (เน็ตหลุด/ปิดแท็บ) → คิวอยู่ใน memory หายไปพร้อมแท็บ
--      · self_assessments ไม่มี policy delete เลย (ตั้งใจ ตาม 0010 ④) → ลบผ่าน API ไม่ได้
--      · เครื่องอื่นที่ยังมีข้อมูลเก่าค้าง จะ push กลับขึ้นไปใหม่
--    ฟังก์ชันนี้ลบที่ต้นทางในธุรกรรมเดียว แล้วเครื่องทุกเครื่องจะเห็นตรงกันตอน pull รอบถัดไป
-- ═══════════════════════════════════════════════════════════════════════════

-- นักศึกษาที่เกินกำหนดเก็บ ณ ตอนนี้
-- ⚠️ ข้ามคนที่ไม่มี entry_year ทิ้งไว้เสมอ — เดารุ่นแล้วลบผิดคนคือความเสียหายที่กู้ไม่ได้
create or replace function expired_student_ids()
returns table (student_id text, entry_year int)
language sql stable security definer set search_path = public as $$
  select s.id, s.entry_year
  from students s, pdpa_policy p
  where p.id = 'app'
    and s.entry_year is not null
    and (current_academic_year() - s.entry_year) >= p.retention_cohorts
$$;

-- ตัวช่วยข้างบนเป็นวัตถุดิบของฟังก์ชันอื่นเท่านั้น — ไม่เปิดให้เรียกตรงจากแอป
revoke all on function expired_student_ids() from public, authenticated;

-- ดูอย่างเดียว ไม่ลบ — หน้าตั้งค่าเรียกตัวนี้มาโชว์ก่อนกดปุ่ม (หัวหน้าภาคเท่านั้น)
-- ⚠️ ชื่อคอลัมน์ผลลัพธ์ตั้งใจขึ้นต้นด้วย n_ / cohort_ ไม่ใช้ชื่อ students / patients ตรงๆ
--    ใน RETURNS TABLE ชื่อพวกนี้เป็น OUT parameter ที่อ้างถึงได้ในตัวฟังก์ชัน
--    ถ้าตั้งชื่อชนกับชื่อตารางจริง จะได้ ambiguous reference ตอนรัน ซึ่งจับได้ตอนรันเท่านั้น
create or replace function retention_preview()
returns table (
  cohort_year   int,
  n_students    bigint,
  n_patients    bigint,
  n_workpieces  bigint,
  n_checkins    bigint,
  n_assessments bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'ดูรายการที่เกินกำหนดเก็บได้เฉพาะหัวหน้าภาค';
  end if;

  return query
  with doomed as (select e.student_id as sid, e.entry_year as yr from expired_student_ids() e)
  select
    d.yr,
    count(distinct d.sid),
    (select count(*) from patients        x where x.owner_student_id in (select d2.sid from doomed d2 where d2.yr = d.yr)),
    (select count(*) from workpieces      x where x.student_id       in (select d2.sid from doomed d2 where d2.yr = d.yr)),
    (select count(*) from checkins        x where x.student_id       in (select d2.sid from doomed d2 where d2.yr = d.yr)),
    (select count(*) from self_assessments x where x.student_id      in (select d2.sid from doomed d2 where d2.yr = d.yr))
      + (select count(*) from sect2_records x where x.student_id     in (select d2.sid from doomed d2 where d2.yr = d.yr))
      + (select count(*) from sect3_records x where x.student_id     in (select d2.sid from doomed d2 where d2.yr = d.yr))
  from doomed d
  group by d.yr
  order by d.yr desc;
end $$;

revoke all on function retention_preview() from public;
grant execute on function retention_preview() to authenticated;

/**
 * ลบข้อมูลของรุ่นที่เกินกำหนดเก็บ — ลบจริง กู้คืนไม่ได้
 *
 * เงื่อนไขสองชั้นที่ต้องผ่านทั้งคู่:
 *   ① คนสั่งต้องเป็นหัวหน้าภาค (is_admin)
 *   ② ภาคต้องเปิดสวิตช์ retention_enabled ไว้แล้ว
 * ค่าเริ่มต้นของ ② คือ false — ตราบใดที่ยังไม่มีมติภาคเรื่องระยะเวลาเก็บ ฟังก์ชันนี้ไม่ทำอะไรเลย
 */
create or replace function purge_expired_cohorts(p_confirm text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pol      pdpa_policy%rowtype;
  ids      text[];
  years    int[];
  pids     text[];
  wids     text[];
  n_del    jsonb;
begin
  if not is_admin() then
    raise exception 'ลบข้อมูลตามกำหนดเก็บได้เฉพาะหัวหน้าภาค';
  end if;

  select * into pol from pdpa_policy where id = 'app';
  if not found or not pol.retention_enabled then
    raise exception 'ภาควิชายังไม่ได้เปิดใช้การลบตามกำหนดเก็บ (retention_enabled = false)';
  end if;

  -- กันกดพลาด: ต้องพิมพ์คำยืนยันมาด้วย (แอปส่งให้อัตโนมัติหลังผู้ใช้ยืนยันในกล่อง)
  if coalesce(p_confirm, '') <> 'ลบถาวร' then
    raise exception 'ต้องส่งคำยืนยัน "ลบถาวร" มาด้วย';
  end if;

  select array_agg(student_id), array_agg(distinct entry_year)
    into ids, years
  from expired_student_ids();

  if ids is null or array_length(ids, 1) = 0 then
    return jsonb_build_object('students', 0, 'cohorts', '[]'::jsonb);
  end if;

  select coalesce(array_agg(id), '{}') into pids   from patients   where owner_student_id = any(ids);
  select coalesce(array_agg(id), '{}') into wids   from workpieces where student_id       = any(ids);

  delete from updates          where workpiece_id = any(wids);
  delete from photos           where workpiece_id = any(wids);
  delete from reviews          where workpiece_id = any(wids);
  delete from workpieces       where id           = any(wids);
  delete from patients         where id           = any(pids);
  delete from checkins         where student_id   = any(ids);
  delete from submissions      where student_id   = any(ids);
  delete from issues           where student_id   = any(ids);
  delete from self_assessments where student_id   = any(ids);
  delete from sect2_records    where student_id   = any(ids);
  delete from sect3_records    where student_id   = any(ids);

  -- ถอนชื่อออกจากกลุ่มก่อน แล้วค่อยลบกลุ่มที่ไม่เหลือใคร (ไม่งั้นเหลือกลุ่มว่างค้าง)
  update groups g
     set student_ids = (select coalesce(array_agg(u.sid), '{}')
                        from unnest(g.student_ids) as u(sid) where not (u.sid = any(ids))),
         updated_at  = now()
   where g.student_ids && ids;

  delete from students where id = any(ids);

  delete from groups g
   where coalesce(array_length(g.student_ids, 1), 0) = 0
     and not exists (select 1 from students s where s."group" = g.code);

  n_del := jsonb_build_object(
    'students', array_length(ids, 1),
    'cohorts',  to_jsonb(years),
    'patients', coalesce(array_length(pids, 1), 0),
    'workpieces', coalesce(array_length(wids, 1), 0)
  );

  -- จดไว้ว่าใครสั่งลบอะไรเมื่อไหร่ — แถวนี้ลบไม่ได้ (trigger 0009)
  perform set_config('prostho.audit_trusted', 'on', true);
  insert into audit (id, text, who, at_when, kind, detail)
  values (
    'a-ret-' || replace(gen_random_uuid()::text, '-', ''),
    format('ลบข้อมูลรุ่นที่เกินกำหนดเก็บ (ฝั่งเซิร์ฟเวอร์): %s คน · รุ่น %s',
           array_length(ids, 1), array_to_string(years, ', ')),
    coalesce((select email from app_users where uid = auth.uid()), 'ไม่ทราบผู้ใช้'),
    to_char(timezone('Asia/Bangkok', now()), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'retention',
    n_del
  );
  perform set_config('prostho.audit_trusted', 'off', true);

  return n_del;
end $$;

revoke all on function purge_expired_cohorts(text) from public;
grant execute on function purge_expired_cohorts(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ตรวจหลังรัน — ผลที่ "ถูกต้อง" เขียนกำกับไว้ทุกข้อ
--
-- ① ค่าเริ่มต้นต้องปิดหมด
--    select retention_enabled, retention_cohorts, export_roles, export_identified_roles
--      from pdpa_policy;
--    → false | 5 | {} | {}
--
-- ② ล็อกอินเป็นอาจารย์ (ไม่ใช่หัวหน้าภาค) แล้วลองแก้นโยบาย — ต้องได้ 0 แถว
--    update pdpa_policy set export_roles = '{teacher}' where id = 'app';
--
-- ③ ล็อกอินเป็นใครก็ได้ แล้วขอส่งออก — ต้อง error ("ยังไม่ได้เปิดสิทธิ์ส่งออก")
--    select log_export('own-progress', 5, false, my_student_id());
--
-- ④ แต่งแถว audit ปลอมว่าเป็น export — ต้องผ่าน แต่ kind/detail ต้องกลายเป็น null
--    insert into audit (id, text, who, at_when, student_id, kind, detail)
--      values ('fake1', 'ส่งออก', 'me', now()::text, my_student_id(), 'export', '{"rows":9}');
--    select kind, detail from audit where id = 'fake1';   → null | null
--
-- ⑤ ล็อกอินเป็นหัวหน้าภาค แล้วสั่งลบทั้งที่ยังไม่เปิดสวิตช์ — ต้อง error
--    select purge_expired_cohorts('ลบถาวร');
--
-- ⑥ audit ยังลบไม่ได้ (กติกา 0009 ต้องไม่เปลี่ยน) — ต้อง error
--    delete from audit where id = 'fake1';
-- ─────────────────────────────────────────────────────────────────────────────
