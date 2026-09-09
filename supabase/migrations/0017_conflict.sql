-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ชนกันแล้วต้องไม่หายเงียบ · migration ที่ 17
--
-- ที่มา: ไล่ด้วยโพรบสองเครื่องเขียนชนกัน (scripts/test-conflict.mts) 9 ก.ย. 69
-- ก่อนหน้านี้ทั้งระบบใช้ "คนเขียนทีหลังชนะ" ซึ่งพอแค่ระดับ pilot
-- แต่ที่ 96 คน + อาจารย์สองท่านต่อนักศึกษาหนึ่งคน มันแปลว่างานของคนหนึ่งหายโดยไม่มีใครรู้
--
-- ไฟล์นี้แก้ 3 อย่าง (อีก 3 อย่างแก้ในโค้ดแอป ดู cloudSync.ts / repo.ts):
--   ① ตราเวลาต้องมาจากนาฬิกาเซิร์ฟเวอร์ ไม่ใช่นาฬิกาเครื่องผู้ใช้
--   ② students.gates ผสานรายช่อง ไม่ใช่ทับทั้งก้อน
--   ③ คะแนนรายคาบ: ของเดิมถูกเก็บไว้เสมอก่อนถูกทับ + นศ. เขียนทับคะแนนไม่ได้
--      (และไม่ถูก reject ด้วย — reject ทำให้คิวทั้งตารางถูกทิ้ง)
--
-- ⚠️ เลขข้าม 0015/0016 — ไม่เคยมีไฟล์สองเลขนั้น ตั้งใจใช้ 0017 ตามที่ตกลงกันไว้
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
-- ต้องรัน 0001–0014 มาก่อน · รันซ้ำได้ ไม่พัง
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ ① ตราเวลาจากเซิร์ฟเวอร์ ═══════════════════════════════════════════════
--
-- บั๊กที่โพรบจับได้: cloudSync.toRow() ประทับ updated_at ด้วย new Date() ของเครื่องผู้ใช้
-- แล้ว pullAll เทียบ "remoteMax เท่าเดิมมั้ย" เพื่อตัดสินใจว่าจะดึงหรือข้าม
-- เครื่องเดียวที่นาฬิกาเดินเร็ว 1 ชม. เขียนแถวเดียว → remoteMax ค้างอยู่ที่เวลาอนาคต
-- → เครื่องอื่นทั้งหมด "ข้าม" การดึงตารางนั้นไปเรื่อยๆ จนกว่าจะมีใครเขียนทับเวลานั้น
-- อาจารย์เปิดดูแล้วเห็นข้อมูลเก่าค้างโดยไม่มีอะไรบอก · ในเครื่อง ~100 เครื่อง เจอแน่นอน
--
-- แก้ที่ฐานข้อมูล ไม่ใช่ที่แอป เพราะแอปเป็นฝ่ายที่เชื่อไม่ได้ (เครื่องผู้ใช้ตั้งเวลาเองได้)
-- แอปเลิกส่งคอลัมน์นี้ไปแล้วด้วย แต่ trigger ต้องมี เผื่อเครื่องที่ยังไม่อัปเดตแอป

create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ตั้งชื่อขึ้นต้น zz_ ตั้งใจ — Postgres ยิง BEFORE trigger เรียงตามชื่อ
-- ตัวนี้ต้องยิงหลังสุดเสมอ จะได้ทับค่าที่ trigger อื่น (เช่น guard_portfolio_record) ตั้งไว้
do $$
declare t text;
begin
  foreach t in array array[
    'teachers','students','groups','patients','workpieces','updates','photos',
    'checkins','reviews','submissions','issues','audit','self_assessments',
    'sect2_records','sect3_records'
  ] loop
    -- ตารางอาจยังไม่มีถ้าข้าม migration บางตัว — ข้ามไปเงียบๆ ดีกว่าให้ทั้งไฟล์ล้ม
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists zz_touch_updated_at on %I', t);
    execute format(
      'create trigger zz_touch_updated_at before insert or update on %I
         for each row execute function touch_updated_at()', t);
  end loop;
end $$;
-- app_settings ไม่อยู่ในรายการ — 0014 ประทับเวลาเองอยู่แล้ว


-- ═══ ② students.gates — ผสานรายช่อง ═══════════════════════════════════════
--
-- บั๊กที่โพรบจับได้: นักศึกษาหนึ่งคนมีอาจารย์ที่ปรึกษาสองท่าน (advisorIds เป็น tuple 2 ช่อง)
-- อ. ก ติ๊ก "ผ่าน Sect II Removable" · อ. ข ติ๊ก "ผ่าน Design RPD" พร้อมกันคนละเครื่อง
-- cloudSync ส่ง "ทั้งแถว" ขึ้นไปเสมอ ไม่ใช่เฉพาะช่องที่แก้ → ติ๊กของอีกคนถูกลบทิ้ง
-- ทั้งที่ไม่มีใครแตะช่องนั้นเลย และนี่คือเงื่อนไขจบของนักศึกษา
--
-- ทำไมใช้ "ผสาน" ไม่ใช่ "กันไม่ให้ชน": สองคนติ๊กคนละช่องไม่ใช่ความขัดแย้งจริง
-- ไม่มีอะไรต้องให้มนุษย์ตัดสิน รวมกันได้เลย — และผสานฝั่งเซิร์ฟเวอร์แปลว่า
-- เครื่องที่ออฟไลน์อยู่ส่งขึ้นมาทีหลังก็ยังถูก ไม่ต้องออนไลน์ตอนกดติ๊ก

create or replace function merge_student_gates()
returns trigger language plpgsql set search_path = public
as $$
declare merged jsonb;
begin
  -- เครื่องเก่าที่ยังไม่มีคอลัมน์นี้ส่ง null มา = "ไม่ได้แตะ" ห้ามล้างของคนอื่น
  if new.gates is null then
    new.gates := old.gates;
    return new;
  end if;
  -- '||' ของ jsonb = รวมคีย์ ฝั่งขวาชนะเฉพาะคีย์ที่ซ้ำกัน
  -- ผลคือช่องที่เครื่องนี้ไม่ได้แตะ จะคงค่าที่อยู่บนตู้กลางไว้
  merged := coalesce(old.gates, '{}'::jsonb) || new.gates;
  /* คีย์ที่ตั้งค่าเป็น null = "ตั้งใจลบ" ต่างจากการไม่ส่งคีย์นั้นมาเลย
     ต้องแยกให้ออก เพราะ repo.syncSect2Gate ลบธงทิ้งเมื่อใบประเมินถูกลบหมด
     ถ้าไม่มีทางบอก "ลบ" ธงจะค้างเป็นผ่านตลอดกาล — บั๊กที่แก้ไปแล้วรอบไล่บั๊ก 4 */
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into merged
    from jsonb_each(merged) as e(k, v) where v <> 'null'::jsonb;
  new.gates := merged;
  return new;
end $$;

drop trigger if exists students_merge_gates on students;
create trigger students_merge_gates before update on students
  for each row execute function merge_student_gates();


-- ═══ ③ คะแนนรายคาบ — ของเดิมต้องไม่หาย ════════════════════════════════════
--
-- สองเรื่องที่โพรบจับได้ในตารางนี้:
--
--   (ก) อาจารย์สองท่านลงคะแนนคาบเดียวกัน — evaluateCheckIn กัน status='evaluated'
--       แต่กันจาก "สำเนาในเครื่อง" ทั้งสองเครื่องเห็น pending พร้อมกันก็ผ่านทั้งคู่
--       คะแนนของคนแรกหายสนิท ไม่มีร่องรอย
--
--   (ข) นักศึกษาเติมกิจกรรมลงคาบที่อาจารย์เพิ่งลงคะแนน (ตอนตัวเองยังออฟไลน์อยู่)
--       สำเนาเก่าของ นศ. มี status='pending' → upsert ทั้งแถวทับ = คะแนนหาย
--       trigger เดิม (0006) กันไว้ด้วยการ raise exception ซึ่ง "ปลอดภัยแต่แพง":
--       supabase upsert เป็นก้อน แถวเดียว raise ทั้งก้อนตก → ครบ 3 ครั้งแอปทิ้งคิวทั้งตาราง
--       = คาบอื่นของ นศ. ที่ไม่เกี่ยวข้องเลยหายไปด้วย
--
-- ทางแก้: ไม่ raise แต่ "คงค่าเดิมไว้เงียบๆ" — ปลอดภัยเท่ากัน (นศ. แก้ไม่ได้เหมือนเดิม)
-- แต่ของที่ นศ. พิมพ์จริง (กิจกรรม/โน้ต) ยังลงได้ และไม่มีก้อนไหนตก
-- raise เก็บไว้เฉพาะกรณีปลอมตัวตน (ย้ายแถวไปเป็นของคนอื่น) ซึ่งแอปไม่เคยทำ

alter table checkins add column if not exists score_history jsonb not null default '[]'::jsonb;

comment on column checkins.score_history is
  'คะแนนชุดก่อนหน้าทุกชุด เรียงเก่า→ใหม่ · เติมอัตโนมัติก่อนถูกทับ ลบไม่ได้จากแอป
   ใช้โชว์ป้าย "อ. ข แก้ทับของ อ. ก" ในหน้าประเมินรายคาบ';

create or replace function guard_checkin_scoring()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if is_teacher() then return new; end if;
    -- นักศึกษาสร้างคาบใหม่ได้ แต่ต้องเป็น "รอประเมิน" เปล่าๆ เท่านั้น
    if new.status is distinct from 'pending'
       or new.scores is not null
       or new.evaluated_by is not null
       or new.evaluated_at is not null then
      raise exception 'นักศึกษาสร้างคาบที่มีคะแนนไว้ล่วงหน้าไม่ได้';
    end if;
    return new;
  end if;

  -- ── UPDATE ──
  -- ย้ายคาบไปเป็นของคนอื่น / เปลี่ยนวันคาบ = ปลอมตัวตน ไม่ใช่เรื่อง sync ชนกัน
  -- อันนี้ raise ต่อ เพราะแอปไม่เคยทำ ถ้าเจอแปลว่ามีคนยิง API ตรง
  if not is_teacher() and (new.student_id is distinct from old.student_id
                           or new.date is distinct from old.date) then
    raise exception 'นักศึกษาแก้เจ้าของ/วันที่ของคาบไม่ได้';
  end if;

  if not is_teacher() then
    -- ช่องคะแนนและเวลาที่ระบบจับให้: คงของเดิมไว้เงียบๆ ไม่ raise
    -- (raise = ทั้งก้อน upsert ตก = คาบอื่นที่ไม่เกี่ยวหายไปด้วย)
    new.status        := old.status;
    new.scores        := old.scores;
    new.evaluated_by  := old.evaluated_by;
    new.evaluated_at  := old.evaluated_at;
    new.punctual      := old.punctual;
    new.checkin_at    := old.checkin_at;
    new.score_history := old.score_history;
    return new;
  end if;

  -- ── อาจารย์แก้คะแนนทับของอาจารย์อีกท่าน ──
  -- ไม่ห้าม (อาจารย์เวรสลับกัน คนที่ประเมินเดิมอาจไม่อยู่แล้ว — เหตุผลเดียวกับ reviseCheckIn)
  -- แต่ของเดิมต้องถูกเก็บไว้เสมอ ไม่ใช่หายไปเฉยๆ
  new.score_history := coalesce(old.score_history, '[]'::jsonb);
  if old.status = 'evaluated'
     and old.scores is not null
     and new.scores is distinct from old.scores then
    new.score_history := new.score_history || jsonb_build_object(
      'scores', old.scores,
      'by',     old.evaluated_by,
      'at',     old.evaluated_at,
      -- เวลาเซิร์ฟเวอร์ตอนถูกทับ — ไม่เชื่อนาฬิกาเครื่องไหนทั้งนั้น
      'replacedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  end if;
  return new;
end $$;

drop trigger if exists checkin_scoring_guard on checkins;
create trigger checkin_scoring_guard
  before insert or update on checkins
  for each row execute function guard_checkin_scoring();

-- นักศึกษาห้ามล้างประวัติคะแนนทิ้ง แม้จะเป็นคาบของตัวเอง (กันไว้ที่ policy อีกชั้น)
-- อาจารย์เขียนได้ แต่ trigger ข้างบนเป็นคนกำหนดค่าจริง ไม่ใช่ค่าที่ client ส่งมา


-- ─────────────────────────────────────────────────────────────────────────────
-- ตรวจว่าติดตั้งครบ
-- ─────────────────────────────────────────────────────────────────────────────
-- ควรได้ 15 แถว (ตราเวลาเซิร์ฟเวอร์):
--   select event_object_table from information_schema.triggers
--    where trigger_name = 'zz_touch_updated_at' order by 1;
--
-- ควรได้ 1 แถว (ผสาน gates):
--   select trigger_name from information_schema.triggers
--    where trigger_name = 'students_merge_gates';
--
-- ควรได้ 1 แถว (ประวัติคะแนน):
--   select column_name from information_schema.columns
--    where table_name = 'checkins' and column_name = 'score_history';
