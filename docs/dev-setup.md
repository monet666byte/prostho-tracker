# ตั้งเครื่อง · รัน · ปล่อยรุ่น — สำหรับคนรับช่วง

ชั่วโมงแรกของคนดูแลคนใหม่อยู่ในไฟล์นี้ · กฎที่ห้ามฝ่าฝืนอยู่ใน `CLAUDE.md` · สถานะเซิร์ฟเวอร์และงานค้างอยู่ใน `docs/status.md`

> ไฟล์ `.claude/launch.json` (ค่าสำหรับเปิดเซิร์ฟเวอร์ผ่าน Browser pane ของ Claude Code) เป็นของเครื่องและอยู่ใน `.gitignore`
> — ไฟล์นี้คือคำสั่งชุดเดียวกันในรูปที่รันได้จาก terminal ธรรมดา

---

## 1. ติดตั้ง

- **Node.js ≥ 20.19** (`package.json → engines`) · ตรวจด้วย `node -v`
- `npm install`
- เทสต์ที่ใช้เบราว์เซอร์จริง (`test:upgrade` · `test:first-login` · `test:google-login` · `test:csp-live` · `perf:scale`) ต้องมี Chromium ของ playwright:
  `npx playwright install chromium` (ครั้งเดียว)

## 2. รันในเครื่อง

| คำสั่ง | ได้อะไร |
| --- | --- |
| `npm run dev` | http://localhost:5173 · ถ้ามี `.env.local` ที่ใส่กุญแจ Supabase = ต่อเซิร์ฟเวอร์จริง (**ระวัง: ข้อมูลจริง**) · ถ้าไม่มี = โหมดในเครื่อง ข้อมูลสมมติ เลือกบทบาทเข้าได้เลย |
| `npm run dev:demo` | โหมดเดโม (`VITE_DEMO=1`) — ไม่ต่อเซิร์ฟเวอร์แม้มี `.env.local` · ใช้ลองฟีเจอร์/นำเสนอ |
| `npm test` | เทสต์ทั้ง 22 ชุด (พิมพ์จำนวนข้อเอง · ใช้เวลาหลายนาที เพราะหลายชุดรัน Postgres จริงในเครื่อง) — รันทุกครั้งที่แตะ `src/domain/` หรือ `src/data/cloudSync.ts` |
| `npm run lint` | oxlint |
| `npm run build` | build จริง + `tsc -b` (ตรวจ type แบบไม่ใช้แคช — `npx tsc -b` เฉย ๆ เชื่อไม่ได้) |

จอกว้างจะเห็นเป็นกรอบมือถือ (มีแถบ DEMO ด้านบนสำหรับสลับ นศ./อาจารย์) · แคบกว่า 780px เต็มจอเหมือนใช้จริง · ฝั่งนักศึกษาต้องเช็คที่ 375px ด้วยเสมอ

### `.env.local`

ก๊อป `.env.example` เป็น `.env.local` แล้วใส่ค่า — ไฟล์นี้อยู่ใน `.gitignore` **ห้ามขึ้น GitHub** (repo เป็นสาธารณะ)

| ตัวแปร | เอามาจากไหน |
| --- | --- |
| `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API (Project URL + `anon public`) · anon key อยู่ในหน้าเว็บได้ สิทธิ์จริงคุมด้วย RLS |
| `BACKUP_EMAIL` · `BACKUP_PASSWORD` | บัญชีหัวหน้ารายวิชาที่ล็อกอินด้วยอีเมล+รหัสผ่านได้ (ใช้กับ `npm run backup` / `restore`) |
| `RESTORE_URL` … `RESTORE_PASSWORD` | เฉพาะตอนกู้/ย้ายเข้าเซิร์ฟเวอร์อีกตัว · `restore.ts --yes` **ปฏิเสธ** ถ้าสำเนามาจากคนละโปรเจกต์กับปลายทางแล้วไม่ตั้ง `RESTORE_URL` |
| `RESTORE_STORAGE_SERVICE_KEY` | กุญแจ `service_role` (Project Settings → API) ใช้คืนไฟล์รูปตอนกู้เท่านั้น |

**ห้ามใส่ `service_role` ในแอปหรือใน Vercel** — ใช้ได้เฉพาะสคริปต์ที่รันในเครื่อง

## 3. โหมด build ทั้งสาม

| คำสั่ง | ใช้กับ | ต่างกันตรงไหน |
| --- | --- | --- |
| `npm run build` | **เว็บนำร่องบน Vercel** (`vercel.json` เรียกคำสั่งนี้) | อ่านกุญแจจาก Environment Variables ของ Vercel · มี service worker + CSP ล็อกโฮสต์ Supabase (`vite/csp.ts`) |
| `npm run build:pages` | **เดโมสาธารณะบน GitHub Pages** (`.github/workflows/deploy.yml`) | `base: /prostho-tracker/` · **ปิดการต่อ cloud เสมอ** (`lib/cloud.ts → isPublicBuild`) ข้อมูลอยู่ในเครื่องคนเปิด |
| `npm run build:share` | ไฟล์เดียว `dist-share/index.html` ส่งให้คนเปิดดูโดยไม่ต้องมีเซิร์ฟเวอร์ | รวม JS/CSS/ฟอนต์ลงไฟล์เดียว · **ไม่มี service worker · ไม่มี CSP** · ปิดการต่อ cloud เหมือน pages |

ดูผล build ในเครื่อง: `npm run preview` (dist) หรือ `npx serve -s dist-share`

## 4. ทดสอบหน้าจอจริงในโหมด cloud โดยไม่แตะเซิร์ฟเวอร์จริง

`scripts/local-supabase.mts` คือ Supabase จำลอง — ข้างในเป็น **Postgres ตัวจริง (PGlite) ที่รัน migration ทุกไฟล์** กฎ RLS/trigger/สิทธิ์ของจริงทุกบรรทัด
รับคำขอแบบเดียวกับ Supabase (auth · ตาราง · rpc · storage) · ไม่มี realtime (แอปถอยไปดึงทุก 15 วิเอง) · ข้อมูลอยู่ในหน่วยความจำ รีสตาร์ต = เริ่มใหม่

**Terminal 1** — เปิดเซิร์ฟเวอร์จำลอง (พอร์ต 54321 · เปลี่ยนด้วย `LOCAL_SUPABASE_PORT`):

```bash
npx tsx scripts/local-supabase.mts
```

มันพิมพ์ `VITE_SUPABASE_URL=` / `VITE_SUPABASE_ANON_KEY=` และรายชื่อบัญชีทดสอบออกมาให้ (ค่าคงที่ `ANON_KEY` ในไฟล์ · ไม่ใช่ความลับ ใช้ได้เฉพาะกับตัวจำลองนี้)

**Terminal 2** — เปิดแอปชี้ไปที่ตัวจำลอง (ไม่ต้องสร้าง `.env.local` · ใช้พอร์ตอื่นจะได้ไม่ชนกับ dev ปกติ):

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImxvY2FsLXN1cGFiYXNlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.local npm run dev -- --port 5181
```

**บัญชีทดสอบ** (รหัสผ่านทุกบัญชี `test1234` · รายชื่อจริงอยู่ในฟังก์ชัน `seed()` ของไฟล์):

| อีเมล | บทบาท |
| --- | --- |
| `s1@test.local` · `s2@test.local` | นักศึกษา (มีผู้ป่วยตัวอย่างคนละ 1) |
| `t1@test.local` | อาจารย์ที่ปรึกษากลุ่ม TH-PT7 |
| `head@test.local` | หัวหน้ารายวิชา |
| `owner@test.local` | หัวหน้ารายวิชา + สลับ นศ.↔อาจารย์ ได้ (รูปแบบเดียวกับบัญชีเจ้าของบนเซิร์ฟเวอร์จริง) |
| รหัสนักศึกษา `6604051` | ยังไม่มีบัญชี — ไว้ลอง "ผูกบัญชีเองด้วยรหัสนักศึกษา" (0023) |

ล็อกอินได้ทั้งฟอร์มอีเมล+รหัสผ่าน และปุ่ม Google (ตัวจำลองมีหน้า Google ปลอม) · สำหรับสคริปต์อัตโนมัติมี `/auth/v1/dev-session?email=t1@test.local`
ให้ session โดยไม่ต้องพิมพ์รหัสผ่านลงฟอร์ม

## 5. เทสต์ — ชุดไหนรันเมื่อไหร่

`npm test` รัน 22 ชุด (รายชื่อและสิ่งที่แต่ละชุดคุมอยู่ใน `CLAUDE.md` หัวข้อ "เทสต์") · รันทีละชุดได้ เช่น `npm run test:rules`

เครื่องมือช้าที่ **ไม่อยู่ใน `npm test`** — รันเองก่อนปล่อยรุ่นที่แตะไฟล์ที่ระบุ:

| คำสั่ง | ทำอะไร | รันเมื่อ |
| --- | --- | --- |
| `npm run test:upgrade` | build แอปรุ่นเก่าตัวจริงจาก git แล้วซ้อมอัปเดตบนเครื่องที่มีงานค้างตอนออฟไลน์ (Chromium จริง) | แตะ `data/db.ts` / `cloudSync.ts` / รูปแบบข้อมูลในเครื่อง — **เพิ่มรุ่นใน `RELEASES` ของ `scripts/test-upgrade.mts` ทุกครั้งที่รูปแบบเปลี่ยน** |
| `npm run test:first-login` | เครื่องใหม่ล็อกอินครั้งแรก → เช็คอิน + กด step → ชื่อคนทำที่เซิร์ฟเวอร์ต้องเป็นชื่อจริง | แตะ `store/app.ts` หรือลำดับ init/sync |
| `npm run test:google-login` | ปุ่ม Google ครบวงจรกับหน้า Google จำลอง · เข้าได้/เข้าครั้งแรก/คนนอกรายชื่อ/อาจารย์ · URL สะอาดหลังกลับ | แตะ `lib/cloud.ts` · `lib/auth.ts` · `routes/Login.tsx` |
| `npm run test:csp-live` | แอปจริงที่ CSP ทำงาน (เทสต์อื่นทุกชุด bypass CSP) | แตะ `vite/csp.ts` หรือเพิ่มของที่โหลดจากโดเมนอื่น |
| `npm run perf:scale` | ความเร็ว/เน็ตที่ใช้กับข้อมูลเต็มปี 200 คน บน CPU ช้า 4 เท่า · ตัวเลขล่าสุดอยู่หัวไฟล์ | แตะ `cloudSync.ts` / หน้าอาจารย์ที่โหลดทั้งชั้นปี |
| `npm run mutate:sync` | ใส่บั๊กที่เคยเกิดจริงลง `cloudSync.ts` ทีละจุด (41 จุด) ดูว่าเทสต์จับได้ไหม | แตะ `cloudSync.ts` — หาจุดใส่บั๊กไม่เจอ ให้แก้รายการในไฟล์ ไม่ใช่ลบทิ้ง |

## 6. งานดูแลประจำ

### เพิ่มอาจารย์

- **ทางหลัก:** หน้า "รายชื่อ & นำเข้า" (เฉพาะหัวหน้ารายวิชา) → แท็บอาจารย์ → วางตารางหรือเลือกไฟล์ Excel (`public/prostho-roster-request-template.xlsx`)
  อีเมลที่ใส่ลงรายชื่อเชิญทันที กดปุ่ม Google ด้วยอีเมลนั้นแล้วเข้าได้ · อาจารย์เลือกกลุ่มที่ปรึกษาเองตอนเข้าครั้งแรก
- **ทาง SQL:** `supabase/add-teacher.sql` — ก๊อปทั้งไฟล์ไป SQL Editor แก้บรรทัดใต้ "แก้ตรงนี้" แล้ว Run (รันซ้ำได้ · **ห้ามบันทึกอีเมล/ชื่อจริงกลับลงไฟล์**)

### เพิ่มนักศึกษา

หน้า "รายชื่อ & นำเข้า" → แท็บนักศึกษา → ไฟล์/วางตาราง (รหัส · ชื่อ · กลุ่ม · อีเมลถ้ามี) · นักศึกษาที่ไม่มีอีเมลในรายชื่อ ล็อกอิน Google ด้วย
@student.mahidol.edu แล้วใส่รหัสนักศึกษาผูกเอง → อาจารย์ที่ปรึกษากดยืนยัน (0023)

### ตั้งใครเป็นหัวหน้ารายวิชา

แท็บอาจารย์ในหน้ารายชื่อมีช่องบทบาท "หัวหน้ารายวิชา" · หรือ SQL Editor:

```sql
update invites   set is_admin = true where lower(email) = lower('อีเมล@mahidol.edu');
update app_users set is_admin = true where lower(email) = lower('อีเมล@mahidol.edu');
```

(มีได้หลายคน · สิทธิ์ = ตั้งค่า PDPA · จัดการรายชื่อเชิญ · นำเข้าชีต · ลบตามกำหนดเก็บ · เห็น audit ทั้งระบบ)

### สำรองข้อมูล

```bash
npm run backup            # ดึงทุกตาราง + ไฟล์รูปจากบักเก็ต case-photos ลง backups/<วันที่>/  (ต้องมี .env.local)
npm run restore           # ตรวจว่าสำเนาชุดล่าสุดกู้ได้จริงไหม — ไม่ต่อเน็ต ปลอดภัยเสมอ · ควรรันทุกเดือน
npm run restore -- --dry-run          # เทียบกับเซิร์ฟเวอร์ว่าจะเขียนอะไรทับอะไร (อ่านอย่างเดียว)
npm run restore -- --student=6604048 --yes   # กู้รายคน เติมเฉพาะแถวที่หาย (ใช้บ่อยกว่ากู้ทั้งระบบ)
```

โฟลเดอร์ `backups/` อยู่ใน `.gitignore` — มีข้อมูลผู้ป่วย ห้ามขึ้น GitHub · เก็บไว้ในที่ที่ภาคเข้าถึงได้ ไม่ใช่เครื่องคนเดียว

**สำรองอัตโนมัติบน Mac ของคนดูแล (ตั้งแล้วบนเครื่องเจ้าของ 22 ก.ย. 2569)** — ทุกวันจันทร์ 08:00 (เครื่องปิดอยู่ = รันตอนเปิดครั้งถัดไป)
- ไฟล์ตั้งเวลา: `~/Library/LaunchAgents/th.ac.mahidol.prostho-tracker.backup.plist`
- สคริปต์: `~/Library/Application Support/prostho-tracker/backup-weekly.command` → เปิดหน้าต่าง Terminal แล้วรัน `npm run backup` (ต้องผ่าน Terminal
  เพราะ macOS ไม่ให้งานเบื้องหลังอ่านโฟลเดอร์ Desktop) · ผลต่อท้ายใน `backups/logs/backup.log`
- ย้ายเครื่อง: ก๊อปสองไฟล์นี้ไปที่เดียวกันบนเครื่องใหม่ แก้ path โปรเจกต์ใน `.command` แล้ว `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/th.ac.mahidol.prostho-tracker.backup.plist`
- ยกเลิก: `launchctl bootout gui/$(id -u)/th.ac.mahidol.prostho-tracker.backup` แล้วลบไฟล์ plist
กฎที่ห้ามลืม 6 ข้อ (ห้ามกู้ด้วย service key ฯลฯ) อยู่ใน `CLAUDE.md` หัวข้อ "ข้อมูลหาย" และหัวไฟล์ `scripts/restore.ts`

## 7. ปล่อยรุ่น (release)

**push ขึ้น branch `main` = ปล่อยรุ่นทันทีสองที่พร้อมกัน:**

1. **Vercel** build `npm run build` แล้ว deploy เว็บนำร่อง (ผู้ใช้จริง) — `<ต้องกรอก: ยืนยันว่าโปรเจกต์ Vercel ผูกกับ branch main>`
2. **GitHub Pages** build `npm run build:pages` แล้ว deploy เดโมสาธารณะ (`.github/workflows/deploy.yml` · trigger `push: branches: [main]`)

ก่อน push ขึ้น `main`:
- `npm run build` ผ่าน · `npm test` ผ่าน · ถ้าแตะ `db.ts`/`cloudSync.ts` รัน `test:upgrade` ด้วย
- ถ้ารุ่นนี้ต้องใช้ migration ใหม่ **รัน migration บนเซิร์ฟเวอร์ก่อน push** — แอปรุ่นใหม่ที่เขียนคอลัมน์ที่เซิร์ฟเวอร์ยังไม่มี จะถูกปฏิเสธและกักงานผู้ใช้ไว้
  (แอปรุ่นเก่าอยู่กับ migration ใหม่ได้ · กลับกันไม่ได้)
- ผู้ใช้ที่เปิดแอปค้างอยู่จะได้รุ่นใหม่เมื่อเปิดใหม่ (service worker · `index.html`/`sw.js` เป็น no-cache ตาม `vercel.json`)

## 8. รัน migration บนเซิร์ฟเวอร์จริง — ทีละขั้น

โปรเจกต์นี้รัน SQL ด้วยมือ ไม่มีตารางบันทึกเวอร์ชัน — ต้องถามฐานข้อมูลจริงทุกครั้ง

1. ในเครื่อง: `npm run test:rls` ต้องผ่าน (รัน migration ทุกไฟล์บน Postgres จริงในเครื่อง แล้วลองเจาะสิทธิ์)
2. `npm run backup` ก่อน ถ้า migration แตะข้อมูล (ไม่ใช่แค่กฎ/index)
3. Supabase → SQL Editor → วาง**ทั้งไฟล์** `supabase/migrations/00NN_….sql` → Run
   (SQL Editor ห่อทั้งไฟล์เป็น transaction เดียว บรรทัดไหนล้มก็ย้อนหมด — ดี แต่แปลว่า "ผ่านครึ่งไฟล์" ไม่มี)
4. วาง `supabase/check-migrations.sql` → Run → บรรทัดของไฟล์นั้นต้องขึ้นว่ารันแล้ว
5. วาง `supabase/security-check.sql` → Run → ต้องไม่มีแถว 🔴 (🟠 = ต้องมีคนตัดสิน)
6. ถ้า migration เปลี่ยน "ใครเห็นแถวไหน" ต้อง bump `POLICY_VERSION` ใน `src/data/cloudSync.ts` ในรุ่นแอปที่ปล่อยคู่กัน
7. จดผลลง `docs/status.md`

ห้ามแก้ migration ที่รันไปแล้ว — ต้องแก้ = เขียนไฟล์ใหม่เลขถัดไป และเพิ่มร่องรอยของมันใน `check-migrations.sql` + `audit.sql`

## 9. กุญแจ — อยู่ที่ไหน · เปลี่ยนยังไง

| กุญแจ | อยู่ที่ | เปลี่ยน (rotate) เมื่อ | ทำยังไง |
| --- | --- | --- | --- |
| **anon key** (Supabase) | Vercel → Environment Variables · `.env.local` ของคนรัน backup · ฝังใน build ของเว็บนำร่อง (ตั้งใจ — สิทธิ์คุมด้วย RLS) | สงสัยว่าหลุดพร้อมกับกฎ RLS ที่เปิดกว้าง | Supabase → Project Settings → API → สร้างใหม่ → อัปเดต Vercel → Redeploy → อัปเดต `.env.local` ทุกเครื่อง |
| **service_role** (Supabase) | **ต้องไม่อยู่ที่ไหนถาวร** — ใส่ใน `.env.local` เฉพาะตอนกู้ไฟล์รูป (`RESTORE_STORAGE_SERVICE_KEY`) แล้วลบ | ทุกครั้งที่เคยวางลงไฟล์/แชท | Project Settings → API → Reset |
| **Google OAuth client secret** | Supabase → Authentication → Providers → Google (ที่เดียว) · ห้ามอยู่ใน repo | คนที่เคยเห็นออกจากทีม | Google Cloud → Credentials → client → Reset secret → วางใหม่ใน Supabase |
| **`BACKUP_PASSWORD`** | `.env.local` ของคนที่รัน backup · เป็นรหัสผ่านบัญชีหัวหน้ารายวิชาที่ล็อกอินด้วยอีเมลได้ | คนที่รัน backup เปลี่ยน | Supabase → Authentication → Users → Reset password (หรือในแอปถ้าเปิดไว้) · อัปเดต `.env.local` |
| **Vercel / GitHub / Supabase / Google Cloud — บัญชีเจ้าของ** | ดูตารางข้างล่าง | เจ้าของถอนตัว | โอนโปรเจกต์ (Transfer) ไปบัญชีของภาค ไม่ใช่แชร์รหัสผ่าน |

## 10. ใครเป็นเจ้าของอะไร

| ทรัพยากร | บัญชีเจ้าของ | คนที่มีสิทธิ์เข้าด้วย |
| --- | --- | --- |
| โปรเจกต์ Supabase (ฐานข้อมูล + Storage + Auth) | `<ต้องกรอก: อีเมลบัญชี Supabase>` | `<ต้องกรอก>` |
| โปรเจกต์ Vercel (เว็บนำร่อง) | `<ต้องกรอก: บัญชี Vercel — สมัครด้วย GitHub monet666byte>` | `<ต้องกรอก>` |
| GitHub repo `monet666byte/prostho-tracker` (public) | `<ต้องกรอก: เจ้าของบัญชี GitHub>` | `<ต้องกรอก: collaborators>` |
| Google Cloud project (OAuth consent + client) | `<ต้องกรอก: บัญชี Google ที่สร้างโปรเจกต์>` | `<ต้องกรอก>` |
| บัญชีหัวหน้ารายวิชาคนแรกในระบบ | `<ต้องกรอก: อีเมล>` (ปัจจุบันเป็น Gmail ส่วนตัวของเจ้าของ — ดู `docs/status.md`) | — |
| โดเมนคณะ (เมื่อได้) | IT คณะทันตแพทยศาสตร์ | ทำตามท้าย `docs/vercel-setup.md` |

⚠️ ตาม `LICENSE` ปัจจุบัน การ deploy/แก้ไขให้องค์กรต้องมีหนังสืออนุญาตจากเจ้าของลิขสิทธิ์ — คนรับช่วงควรได้เอกสารนั้นก่อนเริ่มงาน (`docs/status.md` ข้อ 6)
