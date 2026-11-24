-- ═══════════════════════════════════════════════════════════════════════════
-- 0035 · คาบเก็บ "ทำแล้ว ยังไม่เสร็จ" ของแต่ละเคส
--
-- ที่มา: เดิมนักศึกษากรอกสองที่ — ชิปกิจกรรมของคาบ กับปุ่ม ✓ ที่เคส (ชื่อซ้อนกัน เช่น Final impression)
-- และทำ step ไม่เสร็จก็ไม่มีที่ให้บอก · แบบใหม่: สแกน QR แค่ลงเวลา ส่วนกิจกรรมของคาบมาจากเคสที่บันทึกวันนั้น
--   step ที่ "เสร็จ"     → อ่านจากแถว updates เหมือนเดิม (ไม่เก็บซ้ำในคาบ)
--   step ที่ "ยังไม่เสร็จ" → ช่องใหม่ checkins.wip (jsonb array) · หนึ่งรายการต่อเคส
--     [{ "workpieceId": "...", "procIndex": 7, "step": "CD-5 Posterior teeth : Set up", "note": "..." }]
--
-- ช่อง wip เป็น **ของนักศึกษา** แบบเดียวกับ activities / note — อาจารย์เขียนทับไม่ได้
-- ไฟล์นี้ replace ฟังก์ชัน guard_checkin_scoring() ของ 0034 ทั้งตัว ต่างกันบรรทัดเดียว (new.wip := old.wip ฝั่งอาจารย์)
-- **แก้ไฟล์นี้แล้วต้องแก้ตู้กลางปลอมใน scripts/test-conflict.mts และ scripts/test-clinic-day.mts ด้วย**
--
-- แอปเช็คก่อนว่ามีคอลัมน์แล้วค่อยโชว์ปุ่ม "ยังไม่เสร็จ" (src/data/wipFeature.ts) — ยังไม่รันไฟล์นี้ = ปุ่มไม่ขึ้น ที่เหลือใช้ได้ปกติ
-- ต้องรัน 0034 มาก่อน · วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run · รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════════

alter table checkins add column if not exists wip jsonb;

alter table checkins drop constraint if exists checkins_wip_check;
alter table checkins add constraint checkins_wip_check
  check (wip is null or (jsonb_typeof(wip) = 'array' and jsonb_array_length(wip) <= 50));

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
    -- ใหม่ใน 0034: คำขอให้แก้เป็นของอาจารย์ — สร้างมาพร้อมคาบไม่ได้ ล้างทิ้งเงียบๆ
    new.return_reasons := null;
    new.return_note    := null;
    new.returned_by    := null;
    new.returned_at    := null;
    return new;
  end if;

  -- ── UPDATE ──
  -- ย้ายคาบไปเป็นของคนอื่น / เปลี่ยนวันคาบ = ปลอมตัวตน ไม่ใช่เรื่อง sync ชนกัน
  if not is_teacher() and (new.student_id is distinct from old.student_id
                           or new.date is distinct from old.date) then
    raise exception 'นักศึกษาแก้เจ้าของ/วันที่ของคาบไม่ได้';
  end if;

  if not is_teacher() then
    -- ช่องคะแนน · เวลาที่ระบบจับให้ · คำขอให้แก้ของอาจารย์: คงของเดิมไว้เงียบๆ ไม่ raise
    -- (raise = ทั้งก้อน upsert ตก = คาบอื่นที่ไม่เกี่ยวหายไปด้วย)
    new.status         := old.status;
    new.scores         := old.scores;
    new.evaluated_by   := old.evaluated_by;
    new.evaluated_at   := old.evaluated_at;
    new.punctual       := old.punctual;
    new.checkin_at     := old.checkin_at;
    new.score_history  := old.score_history;
    new.return_reasons := old.return_reasons;
    new.return_note    := old.return_note;
    new.returned_by    := old.returned_by;
    new.returned_at    := old.returned_at;
    return new;
  end if;

  -- ── ใหม่ใน 0020: ทิศกลับ — ช่องของนักศึกษา อาจารย์เขียนทับไม่ได้ ──────────
  -- หน้าอาจารย์ไม่มีช่องให้แก้ของพวกนี้เลย ค่าที่ส่งมาจึงเป็น "ฉบับที่เครื่องอาจารย์เผอิญถืออยู่"
  new.note        := old.note;
  new.activities  := old.activities;
  new.patient_id  := old.patient_id;
  new.no_patient  := old.no_patient;
  new.photo_count := old.photo_count;
  new.wip         := old.wip;          -- ใหม่ใน 0035
  new.created_at  := old.created_at;
  new.edited_at   := old.edited_at;
  new.student_id  := old.student_id;
  new.date        := old.date;

  -- ── อาจารย์แก้คะแนนทับของอาจารย์อีกท่าน — ไม่ห้าม แต่ของเดิมต้องถูกเก็บไว้เสมอ ──
  new.score_history := coalesce(old.score_history, '[]'::jsonb);
  if old.status = 'evaluated'
     and old.scores is not null
     and new.scores is distinct from old.scores then
    new.score_history := new.score_history || jsonb_build_object(
      'scores', old.scores,
      'by',     old.evaluated_by,
      'at',     old.evaluated_at,
      'replacedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  end if;
  return new;
end $$;
