-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ปิดสองช่องในตัวลบข้อมูลตามกำหนดเก็บ · migration ที่ 19
--
-- `purge_expired_cohorts` ของ 0016 ขึ้น production แล้ว (10 ก.ย. 69) และเป็นฟังก์ชัน
-- ที่ลบข้อมูลจริงกู้คืนไม่ได้ ไล่อ่านซ้ำหลังขึ้นแล้วเจอสองเรื่อง — ทั้งคู่ยังไม่มีใครโดน
-- เพราะ `retention_enabled` ยังเป็น false อยู่ (สวิตช์ยังปิด ฟังก์ชันจึง raise ทุกครั้ง)
-- แต่ต้องแก้ก่อนวันที่ภาคเคาะระยะเวลาเก็บแล้วเปิดสวิตช์
--
-- ① กวาดกลุ่มว่างเกินขอบเขต
--    ท่อนเก็บกวาดท้ายฟังก์ชันเขียนว่า "ลบกลุ่มที่ไม่เหลือใคร" แต่เงื่อนไขไม่ได้จำกัดว่า
--    ต้องเป็นกลุ่มที่การลบรอบนี้ทำให้ว่าง — มันลบ **ทุกกลุ่มว่างในตาราง**
--    กลุ่มว่างเกิดขึ้นจริงในระบบ: `importRoster` (repo.ts) สร้างกลุ่มด้วย studentIds = []
--    ก่อน แล้วค่อยเติมสมาชิกทีหลัง · ถ้าภาคเตรียมกลุ่มของรุ่นใหม่ไว้ล่วงหน้า แล้วหัวหน้าภาค
--    สั่งลบรุ่นเก่าในจังหวะนั้น กลุ่มที่เตรียมไว้จะหายไปด้วยโดยไม่มีอะไรบอก
--    (ผลลัพธ์ที่คืนออกมาก็ไม่ได้นับกลุ่มที่ลบไป จึงไม่มีใครเห็น)
--    → รอบนี้จำกัดให้ลบได้เฉพาะกลุ่มที่มีสมาชิกของรุ่นที่ถูกลบอยู่ก่อนหน้า
--
-- ② บัญชีล็อกอินกับรายชื่อเชิญของคนที่ถูกลบ ยังอยู่ตลอดกาล
--    ตาราง `invites` กับ `app_users` เก็บ **อีเมล** ของนักศึกษาไว้ และ purge ไม่แตะทั้งคู่
--    ปลายทางของ retention คือ "ข้อมูลของรุ่นนั้นไม่อยู่ในระบบแล้ว" แต่อีเมลยังอยู่
--    → รอบนี้ลบแถว `invites` ให้ (ปลอดภัย กระทบแค่การสมัครในอนาคต)
--      ส่วน `app_users` / บัญชีใน `auth.users` **ไม่แตะโดยตั้งใจ** — การลบบัญชีจริง
--      เป็นการกระทำที่ย้อนไม่ได้และกระทบระบบล็อกอิน ควรเป็นขั้นที่คนกดเอง
--      จึงคืนรายการอีเมลที่ยังเหลือออกมาในผลลัพธ์ (`accounts_left`) ให้หัวหน้าภาค
--      เอาไปลบใน Authentication → Users ของ Supabase เอง
--      (ลบบัญชีใน auth.users แล้ว app_users จะหายตามเองด้วย on delete cascade ของ 0003)
--
-- ไฟล์นี้ไม่ลด "ความเข้ม" ของอะไรเลย: ด่านสองชั้นเดิม (เป็นหัวหน้าภาค + เปิดสวิตช์)
-- กับคำยืนยัน "ลบถาวร" ยังอยู่ครบเหมือนเดิม
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
--             ต้องรัน 0016 มาก่อน · รันซ้ำได้ ไม่พัง
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function purge_expired_cohorts(p_confirm text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pol      pdpa_policy%rowtype;
  ids      text[];
  years    int[];
  pids     text[];
  wids     text[];
  gcodes   text[];   -- ① กลุ่มที่ "มีสมาชิกของรุ่นที่ถูกลบ" อยู่ก่อนลบ
  emails   text[];   -- ② อีเมลที่ยังเหลือใน auth.users ให้คนไปกดลบเอง
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

  -- ① จำไว้ก่อนว่ากลุ่มไหนมีสมาชิกของรุ่นนี้อยู่ — ท้ายฟังก์ชันจะลบได้เฉพาะกลุ่มในลิสต์นี้
  select coalesce(array_agg(g.code), '{}') into gcodes from groups g where g.student_ids && ids;

  -- ② อีเมลของคนที่กำลังจะถูกลบ เก็บไว้รายงาน (ยังไม่ลบบัญชี — เหตุผลอยู่ในหัวไฟล์)
  select coalesce(array_agg(u.email), '{}') into emails from app_users u where u.student_id = any(ids);

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

  -- ② รายชื่อเชิญลบได้เลย — ไม่ใช่บัญชี แค่สิทธิ์สมัคร ถ้าไม่ลบคนเดิมสมัครกลับมาได้
  delete from invites where student_id = any(ids);

  -- ถอนชื่อออกจากกลุ่มก่อน แล้วค่อยลบกลุ่มที่ไม่เหลือใคร (ไม่งั้นเหลือกลุ่มว่างค้าง)
  update groups g
     set student_ids = (select coalesce(array_agg(u.sid), '{}')
                        from unnest(g.student_ids) as u(sid) where not (u.sid = any(ids))),
         updated_at  = now()
   where g.student_ids && ids;

  delete from students where id = any(ids);

  /* ① เดิมไม่มีเงื่อนไข g.code = any(gcodes) — จึงกวาดกลุ่มว่างทั้งตาราง
        รวมกลุ่มที่ภาคเพิ่งเตรียมไว้ให้รุ่นใหม่ซึ่งยังไม่มีสมาชิก */
  delete from groups g
   where g.code = any(gcodes)
     and coalesce(array_length(g.student_ids, 1), 0) = 0
     and not exists (select 1 from students s where s."group" = g.code);

  n_del := jsonb_build_object(
    'students', array_length(ids, 1),
    'cohorts',  to_jsonb(years),
    'patients', coalesce(array_length(pids, 1), 0),
    'workpieces', coalesce(array_length(wids, 1), 0),
    -- ② บัญชีที่ยังเหลือ ต้องไปลบใน Authentication → Users เอง
    'accounts_left', to_jsonb(emails)
  );

  -- จดไว้ว่าใครสั่งลบอะไรเมื่อไหร่ — แถวนี้ลบไม่ได้ (trigger 0009)
  perform set_config('prostho.audit_trusted', 'on', true);
  insert into audit (id, text, who, at_when, kind, detail)
  values (
    'a-ret-' || replace(gen_random_uuid()::text, '-', ''),
    format('ลบข้อมูลรุ่นที่เกินกำหนดเก็บ (ฝั่งเซิร์ฟเวอร์): %s คน · รุ่น %s · เหลือบัญชีให้ลบเองอีก %s',
           array_length(ids, 1), array_to_string(years, ', '), coalesce(array_length(emails, 1), 0)),
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
-- ① สวิตช์ยังต้องปิดอยู่ (ไฟล์นี้ไม่ได้แตะนโยบาย)
--    select retention_enabled from pdpa_policy;            → false
--
-- ② สั่งลบทั้งที่สวิตช์ปิด — ต้อง error เหมือนเดิม
--    select purge_expired_cohorts('ลบถาวร');
--
-- ③ ไม่ส่งคำยืนยัน — ต้อง error เหมือนเดิม
--    select purge_expired_cohorts();
--
-- ④ ฟังก์ชันยังตรึง search_path และเป็น security definer อยู่
--    select prosecdef, proconfig from pg_proc where proname = 'purge_expired_cohorts';
--    → true | {search_path=public}
--
-- ⑤ ผลลัพธ์มีช่อง accounts_left เพิ่มมาแล้ว (ดูจาก source ก็ได้)
--    select pg_get_functiondef(oid) like '%accounts_left%'
--      from pg_proc where proname = 'purge_expired_cohorts';   → true
-- ─────────────────────────────────────────────────────────────────────────────
