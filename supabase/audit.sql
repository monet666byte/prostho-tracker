-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ใบตรวจสุขภาพความปลอดภัยของฐานข้อมูล (อ่านอย่างเดียว)
--
-- วิธีใช้: ก๊อป "ส่วน A" ทั้งก้อน → Supabase Dashboard → SQL Editor → Run
--          อ่านผลจากบนลงล่าง แถวที่ขึ้นต้นด้วย 🔴 ต้องแก้ก่อนรับข้อมูลผู้ป่วยจริง
--
-- ไฟล์นี้ **ไม่เขียนอะไรลงฐานข้อมูลเลย** มีแต่ SELECT รันซ้ำกี่ครั้งก็ได้ ไม่มีผลข้างเคียง
-- ควรรันทุกครั้งหลังรัน migration ใหม่ และก่อนเปิดให้คนจริงใช้
--
-- ทำไมต้องมี: migration ไฟล์ก่อนหน้าเปิดสิทธิ์กว้างไว้ชั่วคราวแล้วให้ไฟล์หลังมาปิด
-- (เช่น `dev_all` ใน 0001 เปิดให้ anon ทุกตาราง แล้ว 0004 มาลบทิ้ง)
-- ถ้าวันไหนรัน migration ข้ามลำดับ หรือรันไฟล์เก่าซ้ำ ประตูจะเปิดค้างโดยไม่มีอะไรเตือน
-- ตรวจจากไฟล์ .sql ในรีโปไม่พอ — ต้องถามฐานข้อมูลจริงว่า "ตอนนี้สภาพเป็นยังไง"
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- ส่วน A — ตรวจโครงสร้างและสิทธิ์ (รันได้เสมอ ไม่ว่า migration ไหนรันไปแล้วบ้าง)
-- ═════════════════════════════════════════════════════════════════════════════

with

-- ① ตารางข้อมูลจริงทุกใบใน schema public
tbl as (
  select c.oid, c.relname::text as t, c.relrowsecurity as rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),

-- ② policy พร้อมชื่อ role ที่ policy นั้นให้สิทธิ์ (oid 0 = PUBLIC = ทุก role)
pol as (
  select
    p.polname::text as name,
    c.relname::text as t,
    (select coalesce(string_agg(coalesce(r.rolname::text, 'PUBLIC'), ','), 'PUBLIC')
       from unnest(p.polroles) ro
       left join pg_roles r on r.oid = ro) as roles,
    coalesce(pg_get_expr(p.polqual, p.polrelid), '-')      as using_expr,
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') as check_expr,
    case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                  when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
),

-- ③ ตารางที่ถือข้อมูลผู้ป่วยหรือข้อมูลรายบุคคล — ที่นี่ห้ามมี policy แบบ "ใครก็ได้"
sensitive(t) as (
  values ('patients'),('workpieces'),('updates'),('photos'),('checkins'),
         ('reviews'),('submissions'),('self_assessments'),
         ('sect2_records'),('sect3_records'),('students'),('audit')
),

-- ④ ตารางที่ตั้งใจไม่มี policy (client ต้องแตะไม่ได้เลย)
no_policy_ok(t) as (values ('invites')),

findings as (

  -- ── 🔴 ตารางที่ไม่ได้เปิด RLS = ใครล็อกอินก็อ่านได้ทั้งตาราง ──────────────
  select 1 as ord, '🔴 ต้องแก้ก่อนใช้จริง' as ระดับ,
         'ตารางไม่ได้เปิด RLS' as เรื่อง,
         t as ที่ไหน,
         'ทุกบัญชีที่ล็อกอินอ่าน/เขียนได้ทั้งตาราง — สั่ง: alter table ' || t || ' enable row level security;' as รายละเอียด
  from tbl where not rls

  union all
  -- ── 🔴 policy ที่เปิดให้ anon (คนที่ยังไม่ล็อกอิน) ────────────────────────
  --    0001 เคยเปิดไว้ทั้ง 12 ตารางตอนยังไม่มี login · 0003/0004 เป็นคนมาลบ
  --    ถ้าอันไหนยังโผล่ = migration ไม่ได้รันตามลำดับ หรือมีคนรัน 0001 ซ้ำ
  select 1, '🔴 ต้องแก้ก่อนใช้จริง',
         'policy เปิดให้คนที่ยังไม่ล็อกอิน (anon/PUBLIC)',
         t || ' · policy "' || name || '"',
         'role = ' || roles || ' · สั่ง: drop policy "' || name || '" on ' || t || ';'
  from pol where roles like '%anon%' or roles like '%PUBLIC%'

  union all
  -- ── 🔴 ตารางข้อมูลรายบุคคลที่มี policy แบบ "ผ่านได้เสมอ" ──────────────────
  select 1, '🔴 ต้องแก้ก่อนใช้จริง',
         'ตารางข้อมูลรายบุคคลมี policy ที่ไม่กรองอะไรเลย',
         p.t || ' · policy "' || p.name || '" (' || p.cmd || ')',
         'using = ' || p.using_expr || ' / with check = ' || p.check_expr
  from pol p join sensitive s on s.t = p.t
  where (p.using_expr = 'true' and p.cmd in ('ALL','SELECT','UPDATE','DELETE'))
     or (p.check_expr = 'true' and p.cmd in ('ALL','INSERT','UPDATE'))

  union all
  -- ── 🔴 ฟังก์ชัน security definer ที่ไม่ได้ตรึง search_path ────────────────
  --    ฟังก์ชันพวกนี้รันด้วยสิทธิ์เจ้าของ ถ้าไม่ตรึง search_path
  --    คนที่สร้างตาราง/ฟังก์ชันชื่อซ้ำใน schema ของตัวเองหลอกให้มันเรียกของปลอมได้
  select 1, '🔴 ต้องแก้ก่อนใช้จริง',
         'ฟังก์ชัน security definer ไม่ได้ตรึง search_path',
         p.proname::text,
         'สั่ง: alter function ' || p.proname || '(...) set search_path = public;'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
      where cfg like 'search_path=%')

  union all
  -- ── 🔴 ร่องรอยว่า 0009 ยังไม่ได้ลง (ช่องโหว่จากการตรวจ 2 ก.ย. ยังเปิดอยู่) ──
  --    0009 ทำ 4 อย่างในไฟล์เดียว ถ้าลงไม่สำเร็จ ทั้งสี่อย่างหายไปพร้อมกัน:
  --      · นศ. ยิง API แก้แถว students ของตัวเองได้ (เปลี่ยนชื่อ/กลุ่ม/ที่ปรึกษา)
  --        เปลี่ยนกลุ่ม = my_group() เปลี่ยนตาม = อ่าน audit ของกลุ่มอื่นที่มีชื่อ+HN ผู้ป่วย
  --      · audit log แก้/ลบได้ และ actor_uid ปลอมได้จากฝั่ง client
  --      · สมัครด้วยอีเมลที่ไม่ได้รับเชิญได้ (จองอีเมลอาจารย์ตัวจริงทิ้งไว้)
  --      · ไม่มีคอลัมน์ entry_year → push รายชื่อขึ้นตู้กลางถูกปฏิเสธเงียบ ๆ และ 0016 ลงไม่ได้
  select 1, '🔴 ต้องแก้ก่อนใช้จริง',
         '0009_close_holes.sql ยังไม่ได้ลง (หรือลงไม่ครบ)',
         'ขาด: ' || x.what,
         'รัน 0009_close_holes.sql ให้ผ่านก่อน แล้วค่อยรัน 0016 — 0016 พึ่งคอลัมน์ entry_year ของ 0009'
  from (
    select 'คอลัมน์ students.entry_year' as what
    where to_regclass('public.students') is not null
      and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'students' and column_name = 'entry_year')
    union all
    select 'trigger กัน audit ถูกแก้/ลบ'
    where to_regclass('public.audit') is not null
      and not exists (
        select 1 from pg_trigger g
        where g.tgrelid = 'public.audit'::regclass and g.tgname = 'audit_no_change' and not g.tgisinternal)
    union all
    select 'policy เก่า students_own ยังอยู่ (นศ. เขียนแถวตัวเองได้)'
    where exists (select 1 from pol where pol.t = 'students' and pol.name = 'students_own')
  ) x

  union all
  -- ── 🟠 ตารางเปิด RLS แต่ไม่มี policy เลย = client อ่านไม่ได้เลย ───────────
  --    ปลอดภัยแต่ฟีเจอร์จะเงียบ ๆ ว่าง (ยกเว้น invites ที่ตั้งใจให้เป็นแบบนั้น)
  select 2, '🟠 น่าจะผิดพลาด',
         'เปิด RLS แต่ไม่มี policy เลย — แอปจะเห็นตารางนี้ว่าง',
         t, 'ถ้าตั้งใจให้ client แตะไม่ได้ ข้ามได้'
  from tbl
  where rls and t not in (select t from no_policy_ok)
    and not exists (select 1 from pol where pol.t = tbl.t)

  union all
  -- ── 🟠 audit log ต้องแก้/ลบไม่ได้ (0009) ─────────────────────────────────
  select 2, '🟠 น่าจะผิดพลาด',
         'audit log ขาดยามที่ควรมี',
         'trigger ' || x.need || ' บนตาราง audit',
         'audit ต้องแก้และลบไม่ได้ — ดู 0009_close_holes.sql'
  from (values ('audit_stamp'), ('audit_no_change')) as x(need)
  where to_regclass('public.audit') is not null
    and not exists (
      select 1 from pg_trigger g
      where g.tgrelid = 'public.audit'::regclass and g.tgname = x.need and not g.tgisinternal)

  union all
  -- ── 🟠 ตราเวลาต้องมาจากเซิร์ฟเวอร์ทุกตาราง (0017) ────────────────────────
  --    ขาดแม้ตารางเดียว = เครื่องที่นาฬิกาเดินเร็วทำให้ตารางนั้นหยุดไหลลงเครื่องอื่น
  select 2, '🟠 น่าจะผิดพลาด',
         'ขาด trigger ประทับเวลาจากเซิร์ฟเวอร์ (0017 ยังไม่ได้รัน?)',
         x.t,
         'เวลาจะมาจากนาฬิกาเครื่องผู้ใช้ — เครื่องที่ตั้งเวลาผิดทำให้ข้อมูลค้างทั้งตาราง'
  from (values ('teachers'),('students'),('groups'),('patients'),('workpieces'),
               ('updates'),('photos'),('checkins'),('reviews'),('submissions'),
               ('issues'),('audit'),('self_assessments'),('sect2_records'),('sect3_records')) as x(t)
  where to_regclass('public.' || x.t) is not null
    and not exists (
      select 1 from pg_trigger g
      where g.tgrelid = ('public.' || x.t)::regclass
        and g.tgname = 'zz_touch_updated_at' and not g.tgisinternal)

  union all
  -- ── 🟠 ถังเก็บไฟล์ที่เปิดสาธารณะ ─────────────────────────────────────────
  --    ถัง public = ใครมีลิงก์ก็เปิดรูปคนไข้ได้ ไม่ต้องล็อกอิน
  select 1, '🔴 ต้องแก้ก่อนใช้จริง',
         'ถังเก็บไฟล์เปิดสาธารณะ',
         'storage bucket: ' || b.id,
         'ใครมีลิงก์ก็เปิดไฟล์ได้โดยไม่ต้องล็อกอิน'
  from storage.buckets b where b.public

  union all
  -- ── 🔵 สรุปว่า migration ไหนรันไปแล้วบ้าง (ดูเฉย ๆ ไม่ใช่ปัญหา) ───────────
  select 3, '🔵 สถานะ', 'migration ที่รันแล้ว', x.label,
         case when x.present then 'รันแล้ว ✓' else 'ยังไม่ได้รัน ✗' end
  from (
    select '0003 auth (ตาราง app_users)'      as label, to_regclass('public.app_users')        is not null as present
    union all select '0010 แบบประเมินตนเอง',        to_regclass('public.self_assessments')  is not null
    union all select '0012 สมุด portfolio',          to_regclass('public.sect2_records')     is not null
    union all select '0014 ค่าตั้งของภาค',           to_regclass('public.app_settings')      is not null
    union all select '0016 PDPA (ตาราง pdpa_policy)', to_regclass('public.pdpa_policy')      is not null
    union all select '0017 กันข้อมูลชนกัน',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='touch_updated_at')
    union all select '0018 คลังรูปบนเซิร์ฟเวอร์',
      exists (select 1 from storage.buckets where id = 'case-photos')
  ) x
)

select ระดับ, เรื่อง, ที่ไหน, รายละเอียด
from findings
order by ord, เรื่อง, ที่ไหน;


-- ═════════════════════════════════════════════════════════════════════════════
-- ส่วน B — ตรวจเนื้อข้อมูล (รันได้เมื่อ 0016 รันแล้วเท่านั้น)
--          ถ้ายังไม่ได้รัน จะขึ้น error ว่าไม่มีตาราง pdpa_policy — ข้ามไปก่อนได้
-- ═════════════════════════════════════════════════════════════════════════════

-- B1. สวิตช์ PDPA ตอนนี้เปิดอะไรไว้บ้าง — ก่อนคณะอนุมัติ ทุกช่องต้องเป็นค่าปิด
--     (retention_enabled = false · export_roles = {} · export_identified_roles = {})
select
  case when retention_enabled then '🔴 เปิดอยู่' else '🟢 ปิดอยู่' end as "ลบข้อมูลรุ่นเก่า",
  retention_cohorts                                                    as "เก็บย้อนหลัง (รุ่น)",
  case when cardinality(export_roles) = 0 then '🟢 ไม่มีใครส่งออกได้'
       else '🔴 ' || array_to_string(export_roles, ',') end            as "สิทธิ์ส่งออก",
  case when cardinality(export_identified_roles) = 0 then '🟢 ปิดบังชื่อ/HN เสมอ'
       else '🔴 ' || array_to_string(export_identified_roles, ',') end as "ส่งออกแบบมีชื่อ/HN",
  case when mask_by_default then '🟢 ปิดบังไว้ก่อน' else '🟠 ไม่ปิดบัง' end as "ปิดบังในหน้าจอ",
  updated_by                                                            as "แก้ล่าสุดโดย",
  updated_at                                                            as "เมื่อ"
from pdpa_policy where id = 'app';


-- B2. audit log ต้องไม่มีชื่อหรือ HN ผู้ป่วยอยู่ในข้อความ
--     เพราะแถว audit ลบไม่ได้ตามการออกแบบ ใส่ไปแล้วจะลบตาม retention ไม่ได้ตลอดกาล
--     (มองหาเลข HN แบบ 6–9 หลัก และรูปแบบ DEMO-xxxx ของข้อมูลตัวอย่าง)
select count(*) as "แถว audit ที่น่าจะมี HN ปนอยู่",
       min(at_when) as "เก่าสุด", max(at_when) as "ล่าสุด"
from audit
where text ~ '(HN|hn)[ :]*[0-9A-Za-z-]{4,}' or text ~ '\m[0-9]{6,9}\M';

-- ดูของจริง 20 แถวแรก (ถ้าเลขข้างบนไม่เป็นศูนย์)
select id, who, at_when, text
from audit
where text ~ '(HN|hn)[ :]*[0-9A-Za-z-]{4,}' or text ~ '\m[0-9]{6,9}\M'
order by at_when desc limit 20;


-- B3. นักศึกษาที่ยังไม่มีรุ่น (entry_year) — retention จะข้ามคนพวกนี้ไปเลย
--     เดารุ่นแล้วลบผิดคนคือความเสียหายที่กู้ไม่ได้ ระบบจึงเลือกไม่ลบ
select count(*) as "นศ. ที่ยังไม่มีรุ่น (retention จะไม่แตะ)"
from students where entry_year is null;
