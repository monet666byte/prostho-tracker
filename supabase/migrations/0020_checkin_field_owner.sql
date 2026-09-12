-- ═══════════════════════════════════════════════════════════════════════════
-- 0020 · อาจารย์บันทึกคะแนน แล้วโน้ตที่นักศึกษาเพิ่งพิมพ์หายไป
--
-- เจอ 12 ก.ย. 69 ด้วย scripts/test-clinic-day.mts ข้อ ② — จำลองคาบจริง
-- 12 เครื่อง + อาจารย์เวร 2 ท่านพร้อมกัน (ไม่ใช่การอ่านโค้ด)
--
-- เกิดขึ้นได้ยังไง
--   แอปเป็น local-first · คิวรอส่งเก็บแค่ "คีย์ของแถวที่แก้" ไม่ได้เก็บว่าแก้ช่องไหน
--   ตอนส่งจริงมันอ่านแถวล่าสุดจากลิ้นชักในเครื่องแล้ว upsert **ทั้งแถว**
--   เครื่องที่ถือฉบับเก่าของช่องที่ตัวเองไม่ได้แตะ จึงเขียนค่าเก่านั้นทับของใหม่
--
--   สภาพจริงในคาบ: อาจารย์เปิดหน้าประเมินไว้ → นักศึกษาบอก "ขอแก้โน้ตนิดนึง"
--   → นักศึกษาเซฟ (โน้ตขึ้นตู้กลาง) → อาจารย์กด "บันทึกผล · ลงนาม"
--   ฉบับในมืออาจารย์ยังไม่มีโน้ต → โน้ตหายโดยไม่มี error ไม่มีป้าย ไม่มีใครรู้
--   โน้ตนั้นคือสิ่งที่พิมพ์ลงสมุดที่เซ็นจริง — หายแล้วสร้างใหม่ไม่ได้
--
-- ทำไมแก้ที่ฐานข้อมูล ไม่แก้ที่แอป
--   0017 กันทิศทางเดียวไว้แล้ว: "นักศึกษาแตะช่องคะแนนไม่ได้ — คงค่าเดิมไว้เงียบๆ"
--   ที่ขาดคือ **ทิศกลับ** · ตารางนี้มีเจ้าของช่องชัดเจนอยู่แล้ว จึงเขียนกฎให้ครบคู่ได้
--   (`0017` ใช้วิธีเดียวกันกับ `students.gates` มาแล้ว — ผสานฝั่งเซิร์ฟเวอร์
--    ปลอดภัยกว่าให้ทุกเครื่องจำว่าตัวเองแก้ช่องไหน)
--
--   ตรงนี้ถูกต้องเพราะ **หน้าอาจารย์ไม่มีช่องให้แก้โน้ต/กิจกรรม/ผู้ป่วยของคาบเลย**
--   (`evaluateCheckIn` · `reviseCheckIn` · `setCheckInPunctual` ใน `data/repo.ts`
--    เขียนแค่ช่องคะแนนกับป้ายตรงเวลา) การคงค่าเดิมไว้จึงไม่ได้ตัดความสามารถอะไรทิ้ง
--
-- ⚠️ สิ่งที่ migration นี้ **ไม่** แก้: ตาราง `workpieces`
--    ที่นั่นไม่มีการแบ่งเจ้าของช่องระหว่างบทบาท — ทุกช่องเป็นของนักศึกษา
--    ถ้านักศึกษาคนเดียวเปิดสองเครื่อง (มือถือ + ไอแพด) แล้วเซฟไล่กันในช่วงไม่กี่วินาที
--    คนเซฟทีหลังยังชนะทั้งแถว · กฎฝั่งเซิร์ฟเวอร์ช่วยไม่ได้เพราะทั้งสองเครื่องเป็นคนเดียวกัน
--    ทางแก้จริงคือให้คิวจำ "ช่องที่แก้" ไม่ใช่แค่คีย์ — เป็นงานใหญ่ในไฟล์ที่เสี่ยงที่สุด
--    ยังไม่ทำ · บันทึกไว้ใน `README.md` และล็อกพฤติกรรมปัจจุบันไว้ใน `test:clinic` ข้อ ④
--
-- ⚠️ ไฟล์นี้ replace ฟังก์ชัน `guard_checkin_scoring()` ของ `0017` ทั้งตัว
--    trigger `checkin_scoring_guard` ชี้มาที่ชื่อเดิม ไม่ต้องสร้างใหม่
--    **แก้ไฟล์นี้แล้วต้องไปแก้ตู้กลางปลอมใน `scripts/test-conflict.mts`
--    และ `scripts/test-clinic-day.mts` ด้วย** ไม่งั้นเทสต์ผ่านทั้งที่ของจริงพัง
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- ── ใหม่ใน 0020: ทิศกลับ — ช่องของนักศึกษา อาจารย์เขียนทับไม่ได้ ──────────
  -- เหตุผลเต็มอยู่หัวไฟล์ · หน้าอาจารย์ไม่มีช่องให้แก้ของพวกนี้เลย
  -- ค่าที่ส่งมาจึงเป็น "ฉบับที่เครื่องอาจารย์เผอิญถืออยู่" ไม่ใช่เจตนาจะแก้
  new.note        := old.note;
  new.activities  := old.activities;
  new.patient_id  := old.patient_id;
  new.no_patient  := old.no_patient;
  new.photo_count := old.photo_count;
  new.created_at  := old.created_at;
  new.edited_at   := old.edited_at;
  -- สองช่องนี้เปลี่ยนไม่ได้จากหน้าไหนทั้งนั้น — คงไว้เพื่อกันการยิง API ตรงด้วย
  new.student_id  := old.student_id;
  new.date        := old.date;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- ทดสอบหลังรัน (ทำในแท็บ SQL Editor · ล็อกอินเป็นอาจารย์)
--
--   -- ① เตรียมคาบที่มีโน้ตของนักศึกษา
--   insert into checkins (id, student_id, date, activities, note, status, created_at)
--   values ('ci-test', 'st-test', '2026-09-12', '{Lab work}', 'โน้ตของนักศึกษา', 'pending', now()::text);
--
--   -- ② จำลองอาจารย์ upsert ทั้งแถวโดยถือโน้ตฉบับเก่า (ค่าว่าง)
--   update checkins set note = null, scores = '{"knowledge":3}'::jsonb, status = 'evaluated'
--   where id = 'ci-test';
--
--   -- ③ ต้องได้ note = 'โน้ตของนักศึกษา' (ไม่ใช่ null) และ status = 'evaluated'
--   select note, status, scores from checkins where id = 'ci-test';
--
--   delete from checkins where id = 'ci-test';
-- ─────────────────────────────────────────────────────────────────────────────
