-- ═══════════════════════════════════════════════════════════════════════════
-- 0026 · สวิตช์ "ใช้ชื่อผู้ป่วย" — ช่วงนำร่องใช้แค่ HN (ผู้ใช้เลือกแบบ A · 15 ก.ย. 69)
--
-- ตกลงกับภาค: นำร่องเก็บแค่ HN ยังไม่เก็บชื่อผู้ป่วย · ใช้จริงเมื่อไหร่ค่อยเปิดใช้ชื่อเต็ม
-- แบบ A = "ไม่เก็บเลย" ไม่ใช่ "เก็บแต่ซ่อน" — ชื่อที่ไม่เคยลงฐานข้อมูล รั่วไม่ได้
--
-- ① pdpa_policy.patient_names — ค่าเริ่มต้น false (ไม่เก็บ) · แก้ได้เฉพาะหัวหน้ารายวิชา (กฎเดิมของตาราง 0016)
-- ② trigger ล้างชื่อทุกครั้งที่เขียน ขณะสวิตช์ปิด — กันแอปรุ่นเก่า/เครื่องที่ยังไม่อัปเดต/การยิง API ตรง
--    patients.name → ''  (คอลัมน์ not null)  ·  sect2_records / sect3_records.patient_name → null
--    ตั้งชื่อ zz_zz_ ให้ยิงหลัง zz_touch_updated_at (0017) และ guard อื่นทุกตัว — ไม่มีใครเขียนชื่อกลับได้หลังตัวนี้
--
-- ไม่ลบชื่อที่มีอยู่แล้วในไฟล์นี้ (migration ไม่ควรลบข้อมูลเงียบๆ) — ใช้ supabase/clear-patient-names.sql
-- เปิดสวิตช์ทีหลัง = trigger หยุดล้าง ชื่อที่กรอกใหม่เก็บได้ตามปกติ
--
-- รันซ้ำได้ · วิธีติดตั้ง: SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

alter table pdpa_policy add column if not exists patient_names boolean not null default false;

-- ไม่มีแถว/อ่านไม่ได้ = ถือว่าปิด (ฝั่งปลอดภัย)
create or replace function patient_names_enabled()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select patient_names from pdpa_policy where id = 'app'), false) $$;
revoke all on function patient_names_enabled() from public, anon;
grant execute on function patient_names_enabled() to authenticated;

create or replace function strip_patient_name()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not patient_names_enabled() then
    if tg_table_name = 'patients' then
      new.name := '';
    else
      new.patient_name := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function strip_patient_name() from public, anon;

drop trigger if exists zz_zz_strip_patient_name on patients;
create trigger zz_zz_strip_patient_name before insert or update on patients
  for each row execute function strip_patient_name();

do $$
declare t text;
begin
  foreach t in array array['sect2_records', 'sect3_records'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists zz_zz_strip_patient_name on %I', t);
    execute format('create trigger zz_zz_strip_patient_name before insert or update on %I
                      for each row execute function strip_patient_name()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
