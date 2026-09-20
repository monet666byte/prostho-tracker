-- ═══════════════════════════════════════════════════════════════════════════
-- ใครเห็นข้อมูลผู้ป่วยได้บ้าง — อ่านอย่างเดียว · statement เดียว · รันซ้ำได้ทุกเมื่อ
--
-- ทำไม: บัญชีที่มีสิทธิ์อาจารย์เห็นผู้ป่วยของนักศึกษาทุกคน · docs/status.md เคยจดว่าบัญชีสาธิต (demo@…)
--   ยังมีสิทธิ์นี้ค้างอยู่ แต่ remove-test-accounts.sql กับ 0027 ลบบัญชี @example.com ไปแล้ว — ไฟล์นี้ตอบว่าตอนนี้เหลือจริงไหม
--   โดยไม่ต้องเดา (โปรเจกต์รัน SQL ด้วยมือ ห้ามเชื่อความจำ — CLAUDE.md กฎข้อ 4)
--
-- อ่านผล: แถวที่ "ควรดู" ขึ้น ⚠️ = บัญชีที่ไม่ใช่โดเมนมหาวิทยาลัย หรือชื่อขึ้นต้นด้วย demo / test / ajarn-test
--   ไม่ได้แปลว่าผิดเสมอ (บัญชี Gmail ของหัวหน้ารายวิชาที่ตั้งใจเชิญไว้ก็ขึ้น ⚠️) — ให้คนดูว่ารู้จักทุกแถวไหม
--   เจอบัญชีที่ไม่ควรมีสิทธิ์: ลบด้วยแบบเดียวกับ remove-test-accounts.sql (แก้รายชื่ออีเมลในไฟล์นั้น) หลัง `npm run backup`
-- ═══════════════════════════════════════════════════════════════════════════
select y.kind as "ที่มา", y.email as "อีเมล", y.role as "บทบาท",
       case when y.is_admin then 'หัวหน้ารายวิชา' else '' end as "สิทธิ์พิเศษ",
       coalesce(y.teacher_id, '') as "teacher_id", coalesce(y.student_id, '') as "student_id",
       case when y.odd then '⚠️ ควรดู' else '' end as "ควรดู"
from (select x.*, (x.email !~* '@(student\.)?mahidol\.(edu|ac\.th)$' or x.email ~* '^(demo|test|ajarn-test|nak-test)') as odd from (
  select 'ล็อกอินได้แล้ว (app_users)' as kind, lower(u.email) as email, u.role, coalesce(u.is_admin, false) as is_admin, u.teacher_id, u.student_id
    from app_users u where u.role = 'teacher' or coalesce(u.is_admin, false) or u.teacher_id is not null
  union all
  select 'ถูกเชิญไว้ ยังไม่ล็อกอิน (invites)', lower(i.email), i.role, coalesce(i.is_admin, false), i.teacher_id, i.student_id
    from invites i
    where (i.role = 'teacher' or coalesce(i.is_admin, false) or i.teacher_id is not null)
      and not exists (select 1 from app_users u where lower(u.email) = lower(i.email))
) x) y
order by y.odd desc, y.kind, y.email;
