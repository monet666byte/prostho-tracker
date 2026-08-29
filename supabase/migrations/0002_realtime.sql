-- เปิด realtime broadcast ให้ทุกตาราง — Supabase ไม่เปิดให้เอง ต้องสมัครเข้า publication
-- (ไม่รันไฟล์นี้ แอปก็ยัง sync ได้ผ่าน polling ทุก 15 วิ — อันนี้ทำให้เห็นกัน "ทันที" แทน)
alter publication supabase_realtime add table
  teachers, students, groups, patients, workpieces, updates,
  photos, checkins, reviews, submissions, issues, audit;
