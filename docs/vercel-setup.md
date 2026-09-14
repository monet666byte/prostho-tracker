# ขึ้นเวอร์ชันที่ต่อฐานข้อมูลจริงบน Vercel (ทำครั้งเดียว · ~15 นาที)

ตัวนี้แยกจากเดโมบน GitHub Pages — เดโมยังอยู่ที่เดิม ไม่ต่อเซิร์ฟเวอร์เหมือนเดิม
ค่าตั้งของ Vercel อยู่ใน `vercel.json` แล้ว (คำสั่ง build · header ความปลอดภัย · กันแอปค้างรุ่นเก่า)

> ⚠️ ช่วงนี้**อย่าชวนใครติดตั้งแอปลงหน้าจอโฮม** จนกว่าจะได้ที่อยู่ของคณะ — ย้ายที่อยู่แล้วต้องติดตั้งใหม่

## ขั้น 1 · เอาค่าเชื่อม Supabase

Supabase → ⚙️ **Project Settings** → **API** (หรือ **Data API** / **API Keys**)
ก๊อปสองค่า: **Project URL** กับ **anon public** key
(anon key ออกแบบให้อยู่ในหน้าเว็บได้ — สิทธิ์จริงคุมด้วยกฎบนฐานข้อมูล · **ห้ามใช้ `service_role`** เด็ดขาด)

## ขั้น 2 · สร้างโปรเจกต์ใน Vercel

1. **vercel.com** → **Sign Up** → **Continue with GitHub** (บัญชี monet666byte)
2. **Add New… → Project** → เลือก repo **prostho-tracker** → **Import**
3. หน้าตั้งค่า **อย่าเพิ่งกด Deploy** — เปิดหัวข้อ **Environment Variables** ใส่สองแถว:
   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL จากขั้น 1 |
   | `VITE_SUPABASE_ANON_KEY` | anon public key จากขั้น 1 |
4. กด **Deploy** → รอ 1–2 นาที → ได้ที่อยู่แบบ `https://prostho-tracker-xxxx.vercel.app`

⚠️ ถ้าลืมใส่ข้อ 3 แล้ว Deploy ไปก่อน: เว็บจะขึ้นหน้าเลือกบทบาทแบบเดโม (ไม่ต่อเซิร์ฟเวอร์)
→ ไปใส่ที่ **Settings → Environment Variables** แล้ว **Deployments → ⋯ → Redeploy**

## ขั้น 3 · เช็คว่าต่อจริง

เปิดที่อยู่ `.vercel.app` → ต้องเห็นหน้า **"เข้าสู่ระบบด้วย Google" + ช่องอีเมล/รหัสผ่าน**
(ถ้าเห็นปุ่ม "นักศึกษา / อาจารย์" ให้เลือก = ยังไม่ต่อ ย้อนไปขั้น 2 ข้อ 3)

## ขั้น 4 · ต่อกับการตั้งค่า Google

ทำตาม `docs/google-login-setup.md` แล้วในขั้น 5 ของไฟล์นั้นใส่:
- **Redirect URLs**: `https://prostho-tracker-xxxx.vercel.app/**`
- **Site URL**: `https://prostho-tracker-xxxx.vercel.app`

---

## วันที่ IT คณะให้ subdomain (เช่น prostho.dt.mahidol.ac.th)

ไม่ต้องย้ายเว็บ — แอปยังอยู่ที่ Vercel
1. Vercel → โปรเจกต์ → **Settings → Domains** → **Add** → ใส่ชื่อที่ได้
2. Vercel จะบอกค่า DNS (มักเป็น **CNAME** ชี้ไป `cname.vercel-dns.com`) → ส่งค่านั้นให้ IT ตั้ง
3. รอ IT ตั้งเสร็จ Vercel ขึ้น ✓ Valid Configuration (มีใบรับรอง https ให้เอง)
4. Supabase → URL Configuration: **เพิ่ม** `https://prostho.dt.mahidol.ac.th/**` และเปลี่ยน **Site URL** เป็นที่อยู่ใหม่
5. ใน Vercel → Domains ตั้งให้ที่อยู่ `.vercel.app` **Redirect** ไปที่อยู่ใหม่
6. บอกทุกคนให้เปิดแอปตอนมีเน็ตหนึ่งครั้งก่อนย้าย (ให้ sync ครบ) · ใครติดตั้งไว้แล้ว ลบไอคอนเก่าแล้วติดตั้งใหม่ · ล็อกอินใหม่หนึ่งครั้ง

ข้อมูลที่ขึ้นเซิร์ฟเวอร์แล้วไม่หาย — เซิร์ฟเวอร์ตัวเดิม · Vercel เก็บแค่ไฟล์หน้าเว็บ ข้อมูลผู้ป่วยอยู่ที่ Supabase เสมอ
