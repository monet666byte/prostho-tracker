-- ═══════════════════════════════════════════════════════════════════════════
-- 0034 · อาจารย์ "ขอให้แก้" คาบ แทนการให้คะแนนทั้งที่ข้อมูลผิด
--
-- ที่มา: แอป REXX ของภาคศัลยฯ มีปุ่มตีกลับงานให้นักศึกษาแก้ · ของเราเดิมอาจารย์มีทางเดียวคือ
-- ลงคะแนนไปทั้งที่ผู้ป่วย/กิจกรรมในคาบไม่ตรง แล้วไปบอกปากเปล่า (ไม่มีร่องรอย นักศึกษาลืม)
--
-- ช่องใหม่ในตาราง checkins — **ของอาจารย์ทั้งหมด** นักศึกษาเขียนไม่ได้
--   return_reasons  เหตุผลแบบชิป (patient · activity · time · step · other) เลือกได้หลายข้อ
--   return_note     ข้อความเพิ่มเติม (ไม่บังคับ)
--   returned_by     ชื่ออาจารย์ที่ขอ
--   returned_at     เวลาที่ขอ (text ISO แบบเดียวกับ edited_at)
-- คาบยังเป็น 'pending' เหมือนเดิม — "แก้แล้ว" คือนักศึกษาแก้คาบหลังเวลาที่ขอ (edited_at > returned_at)
-- แอปคิดที่ returnOpen() ใน src/domain/checkin.ts · ไม่มีสถานะใหม่ให้ตัวนับเดิมทุกตัวต้องรู้จัก
--
-- ไฟล์นี้ replace ฟังก์ชัน guard_checkin_scoring() ของ 0020 ทั้งตัว (trigger ชื่อเดิม ไม่ต้องสร้างใหม่)
-- ต่างจาก 0020 แค่: ① ด่านนักศึกษาคงสี่ช่องใหม่ไว้ (ลบคำขอของอาจารย์เองไม่ได้)
--                   ② นักศึกษาสร้างคาบใหม่ที่มีคำขอติดมาไม่ได้ (ล้างเป็น null เงียบๆ)
-- ฝั่งอาจารย์ไม่เปลี่ยน — ช่องใหม่ไม่ได้อยู่ในรายการที่อาจารย์ทับไม่ได้ จึงเขียนได้ตามปกติ
-- **แก้ไฟล์นี้แล้วต้องแก้ตู้กลางปลอมใน scripts/test-conflict.mts และ scripts/test-clinic-day.mts ด้วย**
--
-- แอปรุ่นนี้เช็คก่อนว่ามีคอลัมน์แล้วค่อยโชว์ปุ่ม (src/data/returnFeature.ts) — ยังไม่รันไฟล์นี้ = ปุ่มไม่ขึ้น
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run · รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════════

alter table checkins add column if not exists return_reasons text[];
alter table checkins add column if not exists return_note text;
alter table checkins add column if not exists returned_by text;
alter table checkins add column if not exists returned_at text; -- ISO จากเครื่อง เหมือน edited_at / evaluated_at

alter table checkins drop constraint if exists checkins_return_reasons_check;
alter table checkins add constraint checkins_return_reasons_check
  check (return_reasons is null
         or return_reasons <@ array['patient', 'activity', 'time', 'step', 'other']::text[]);

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
