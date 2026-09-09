-- ─────────────────────────────────────────────────────────────────────────────
-- Prostho Tracker — ย้ายไฟล์รูปออกจากตาราง ไปอยู่ Supabase Storage · migration ที่ 18
--
-- ที่มา: photos.data_url เก็บรูปเป็น base64 อยู่ในแถวเดียวกับ metadata
-- และตาราง photos อยู่ใน TABLES ของ cloudSync.ts ด้วย แปลว่ารูปทั้งก้อน
-- วิ่งขึ้น-ลง Postgres ทุกรอบ sync (ทุก 15 วิ) ที่กลุ่มทดลอง 8 คนยังไหว
-- ที่ 96 คนจะช้าจนใช้ไม่ได้ และไปเบียดโควตาฐานข้อมูลซึ่งเป็นแผนฟรี
--
-- ที่ร้ายกว่าเรื่องพื้นที่: รูปมีสำเนาเดียวอยู่ในเครื่องคนถ่าย เปลี่ยนเครื่องหรือ
-- ล้าง cache = หายถาวร และมันคือรูปที่ถ่ายจากปากคนไข้จริง ถ่ายซ้ำไม่ได้
--
-- ไฟล์นี้เพิ่ม 4 อย่าง
--   ① บักเก็ต case-photos แบบ private (ไม่มี URL สาธารณะ ต้องขอลิงก์ที่เซ็นทุกครั้ง)
--   ② RLS ของบักเก็ต — นศ. อัป/เห็นเฉพาะโฟลเดอร์ตัวเอง · อาจารย์อ่านได้ทั้งบักเก็ต
--   ③ photos.storage_path — ที่อยู่ไฟล์ (แอปใช้ช่องนี้เป็น "หลักฐานว่าขึ้นแล้ว" ไม่ใช่ status)
--   ④ trigger เก็บกวาดไฟล์เมื่อแถว photos ถูกลบ — ตาข่ายกันไฟล์ค้างในบักเก็ต
--
-- ⚠️ ไฟล์นี้ไม่แตะ policy/ตาราง/ฟังก์ชันของ 0016 หรือ 0017 เลยแม้แต่บรรทัดเดียว
--    รันได้โดยไม่สนว่าสองไฟล์นั้นรันแล้วหรือยัง (ตรวจ 10 ก.ย. 69: เซิร์ฟเวอร์มี 0017 แล้ว
--    ส่วน 0016 ยังลงไม่สำเร็จเพราะ students.entry_year หายไป ซึ่งเป็นของ 0009)
--
-- ⚠️ ไม่ลบ photos.data_url ทิ้งในไฟล์นี้ — ตั้งใจ
--    แอปจะย้ายรูปเก่าขึ้นบักเก็ตทีละใบแล้วเซ็ต data_url = null เอง (photoStore.migrateLegacyPhotos)
--    ถ้า drop column ที่นี่ รูปเก่าของทุกคนที่ยังไม่ทันย้ายจะหายพร้อมกันทันที กู้ไม่ได้
--    วันที่ทุกเครื่องย้ายครบแล้ว ค่อยเขียน migration แยกมาเก็บกวาดคอลัมน์นี้
--
-- วิธีติดตั้ง: ก๊อปทั้งไฟล์ → Supabase Dashboard → SQL Editor → Run
--             ต้องรัน 0001–0004 มาก่อน (ใช้ my_student_id() / is_teacher() จาก 0004)
--             รันซ้ำได้ ไม่พัง
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ ① บักเก็ต ════════════════════════════════════════════════════════════
--
-- private เท่านั้น — public bucket แปลว่าใครก็ตามที่เดา URL ถูกจะเปิดรูปในปากคนไข้ได้
-- โดยไม่ต้องล็อกอิน ซึ่งเป็นข้อมูลอ่อนไหวที่สุดในระบบนี้ ไม่มีเหตุผลใดที่จะยอมแลก
--
-- file_size_limit 1 MB — ฝั่งแอปบีบรูปให้ไม่เกิน 900 KB อยู่แล้ว (HARD_LIMIT_BYTES
-- ใน src/lib/image.ts) ด่านนี้เป็นตัวกันเครื่องที่รันแอปเวอร์ชันเก่า/ถูกแก้
-- allowed_mime_types เหลือ jpeg ตัวเดียว: compressImage() เข้ารหัสเป็น JPEG เสมอ
-- ถ้ามีอย่างอื่นโผล่มาแปลว่ามีคนยิง API ตรง ไม่ใช่ผู้ใช้ปกติ

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-photos', 'case-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ═══ ② RLS ของบักเก็ต ═════════════════════════════════════════════════════
--
-- โครงชื่อไฟล์:  {student_id}/{case_code}/{workpiece_id}/{photo_id}.jpg
--
-- ทำไม student_id ต้องเป็นโฟลเดอร์แรก: storage.foldername(name) คืน array ของโฟลเดอร์
-- policy อ่านได้แค่ตำแหน่งที่รู้ล่วงหน้า ถ้าสลับลำดับ กติกา "นศ. เห็นเฉพาะของตัวเอง"
-- จะเขียนไม่ได้เลย ต้องเปิดกว้างแทน
--
-- ⚠️ ไม่มีชื่อคนไข้และไม่มี HN ในชื่อไฟล์เด็ดขาด — ชื่อไฟล์รั่วง่ายกว่าเนื้อข้อมูลมาก
--    (โผล่ใน log, ใน URL ที่เซ็น, ในหน้า Storage ของ dashboard ที่อาจารย์เปิดดูได้)
--    case_code มาจาก caseCode() ใน src/lib/privacy.ts ซึ่งแฮชจาก id ภายในของผู้ป่วย
--    ไม่ใช่จาก HN — คนที่รู้ HN ของคนไข้คนหนึ่งจึงเดาไม่ได้ว่าโฟลเดอร์ไหนคือคนนั้น
--
-- เรียกฟังก์ชันแบบมี public. นำหน้าเสมอ — policy บน storage.objects ถูกประเมิน
-- ด้วย search_path ของ schema storage ถ้าไม่ระบุจะหาฟังก์ชันไม่เจอแล้ว policy พังเงียบ

-- นักศึกษา: ทำได้ทุกอย่างเฉพาะในโฟลเดอร์ของตัวเอง
-- (my_student_id() คืน null สำหรับบัญชีที่ไม่ใช่ นศ. → เทียบแล้วได้ null → ไม่ผ่าน ซึ่งถูกแล้ว)
drop policy if exists case_photos_own on storage.objects;
create policy case_photos_own on storage.objects for all to authenticated
  using (
    bucket_id = 'case-photos'
    and (storage.foldername(name))[1] = public.my_student_id()
  )
  with check (
    bucket_id = 'case-photos'
    and (storage.foldername(name))[1] = public.my_student_id()
  );

-- อาจารย์: อ่านได้ทั้งบักเก็ต — ต้องเห็นรูปงานของ นศ. ทุกคนตอนตรวจ
-- แต่ "อ่าน" อย่างเดียว ไม่มีสิทธิ์เขียนทับรูปของใคร (รูปเป็นหลักฐานงาน อาจารย์แก้ไม่ได้)
drop policy if exists case_photos_teacher_read on storage.objects;
create policy case_photos_teacher_read on storage.objects for select to authenticated
  using (bucket_id = 'case-photos' and public.is_teacher());

-- ลบ: ให้อาจารย์ด้วย เพราะการลบนักศึกษา/ลบตามกำหนดเก็บ (retention ใน 0016)
-- เป็นงานฝั่งอาจารย์/หัวหน้าภาค ถ้าไม่ให้สิทธิ์ ไฟล์จะค้างในบักเก็ตหลังลบข้อมูลไปแล้ว
-- ซึ่งขัดกับ PDPA โดยตรง (ลบแล้วต้องลบจริง ไม่ใช่ลบแค่แถวที่ชี้ไปหา)
drop policy if exists case_photos_teacher_delete on storage.objects;
create policy case_photos_teacher_delete on storage.objects for delete to authenticated
  using (bucket_id = 'case-photos' and public.is_teacher());


-- ═══ ③ ที่อยู่ไฟล์ในตาราง ══════════════════════════════════════════════════
--
-- แอปถือว่า "storage_path มีค่า = ไบต์ขึ้นคลาวด์แล้วแน่นอน" และเขียนช่องนี้
-- หลังจาก Storage ตอบรับเท่านั้น (ดู uploadOne ใน src/data/photoStore.ts)
-- ห้ามมีโค้ดไหนเซ็ตช่องนี้ล่วงหน้า ไม่งั้นจะกลายเป็นป้ายหลอกแบบเดียวกับที่
-- status เคยเป็น (หน้าจอขึ้น "อัปโหลดแล้ว" ทั้งที่ไม่มีรูปอยู่จริง — เจอมาสองรอบ)

alter table photos add column if not exists storage_path text;

comment on column photos.storage_path is
  'ที่อยู่ไฟล์ในบักเก็ต case-photos · มีค่า = ยืนยันแล้วว่าไบต์ขึ้นคลาวด์
   เป็นตัวชี้ขาด ไม่ใช่ photos.status (status เป็นแค่ป้ายที่สะท้อนตามหลัง)';

-- ใช้ตอนหาไฟล์กำพร้า และตอนแอปเช็คว่าใบไหนยังไม่ขึ้น
create index if not exists photos_storage_path_idx on photos (storage_path);


-- ═══ ④ ลบแถวแล้วไฟล์ต้องไม่ค้าง ════════════════════════════════════════════
--
-- ทางลบมีหลายทางและเพิ่มได้อีกในอนาคต: ลบชิ้นงาน · ลบนักศึกษา ·
-- purge_expired_cohorts() ของ 0016 (ซึ่ง delete from photos ตรงๆ)
-- ถ้าให้แต่ละทางจำเองว่าต้องลบไฟล์ด้วย จะมีทางที่ลืมแน่นอน — เคยเกิดมาแล้วกับ
-- reviews/submissions/issues ที่ตกหล่นตอนลบนักศึกษา (แก้ไปรอบก่อน)
-- จึงดักที่จุดเดียวคือ "แถว photos หายเมื่อไหร่" แล้วเก็บกวาดตามอัตโนมัติ
--
-- ⚠️ ข้อจำกัดที่ต้องรู้: ลบแถวใน storage.objects ด้วย SQL ทำให้ metadata สะอาด
--    (ไม่มีใครเห็น ไม่มีใครโหลดได้) แต่ไบต์จริงใน S3 อาจยังค้างอยู่
--    ตัวลบไบต์จริงคือฝั่งแอปที่เรียก Storage API (removePhotoFiles ใน photoStore.ts)
--    ซึ่งทำงานทุกครั้งที่ผู้ใช้ลบผ่านหน้าจอ — trigger นี้เป็นตาข่ายรองสำหรับทางที่
--    ลบฝั่งเซิร์ฟเวอร์ล้วน (retention) หรือกรณีแอปเรียกไม่สำเร็จเพราะเน็ตหลุด

create or replace function cleanup_photo_object()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.storage_path is not null then
    delete from storage.objects
     where bucket_id = 'case-photos' and name = old.storage_path;
  end if;
  return old;
end $$;

drop trigger if exists photos_cleanup_object on photos;
create trigger photos_cleanup_object after delete on photos
  for each row execute function cleanup_photo_object();
-- AFTER DELETE ไม่ชนกับ zz_touch_updated_at ของ 0017 (นั่นเป็น BEFORE INSERT OR UPDATE)


-- ─────────────────────────────────────────────────────────────────────────────
-- ตรวจหลังรัน
-- ─────────────────────────────────────────────────────────────────────────────
-- ① บักเก็ตต้องเป็น private และจำกัดขนาด/ชนิดไฟล์
--    select id, public, file_size_limit, allowed_mime_types
--      from storage.buckets where id = 'case-photos';
--    → case-photos | false | 1048576 | {image/jpeg}
--
-- ② ต้องมี 3 policy
--    select policyname, cmd from pg_policies
--     where schemaname = 'storage' and tablename = 'objects'
--       and policyname like 'case_photos%' order by policyname;
--
-- ③ คอลัมน์ + trigger
--    select count(*) from information_schema.columns
--     where table_name = 'photos' and column_name = 'storage_path';   → 1
--    select count(*) from pg_trigger where tgname = 'photos_cleanup_object';  → 1
--
-- ④ ความคืบหน้าการย้ายรูปเก่า (รันซ้ำได้เรื่อยๆ จนกว่า legacy จะเป็น 0)
--    select count(*) filter (where storage_path is not null) as moved,
--           count(*) filter (where data_url is not null and storage_path is null) as legacy,
--           count(*) filter (where data_url is null and storage_path is null) as no_file
--      from photos;
--
-- ⑤ ไฟล์กำพร้าในบักเก็ต (ไม่มีแถว photos ชี้ถึง) — ควรได้ 0 แถว
--    select o.name from storage.objects o
--     where o.bucket_id = 'case-photos'
--       and not exists (select 1 from photos p where p.storage_path = o.name);
--
-- ⑥ ชื่อไฟล์ต้องไม่มี HN โผล่ — ควรได้ 0 แถว
--    select o.name from storage.objects o join patients pt on o.name like '%' || pt.hn || '%'
--     where o.bucket_id = 'case-photos' and coalesce(pt.hn, '') <> '';
-- ─────────────────────────────────────────────────────────────────────────────
