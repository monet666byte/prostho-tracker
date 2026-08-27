# Prostho Tracker

PWA ติดตามความคืบหน้าเคสงานทันตกรรมประดิษฐ์ รายวิชา **DTPT502 — Dental clinic practice: Clinic Prosthodontics II**
สร้างตาม design handoff ในโฟลเดอร์ `../design_handoff_prostho_tracker/`

- **ฝั่งนักศึกษา** — mobile-first, ออฟไลน์ได้, บันทึกผ่าน step ได้ใน 1–2 แตะ
- **ฝั่งอาจารย์** — dashboard ทั้งชั้นปี, ตรวจงานรายคน, ตั้งค่าเกณฑ์

> ข้อมูลในระบบตอนนี้เป็น **ข้อมูลสมมติทั้งหมด** (ผู้ป่วย A–I, HN `DEMO-xxxx`, นศ. ก–ซ, อ. ก./อ. ข.)

---

## รันโปรเจกต์

Node.js ติดตั้งไว้ที่ `~/.local/node` แล้ว และเพิ่ม PATH ใน `~/.zshrc` ให้เรียบร้อย
(ถ้าเปิด terminal ใหม่แล้วเจอ `command not found: npm` ให้รัน `source ~/.zshrc` ก่อน)

```bash
npm run dev
```

เปิด http://localhost:5173 — จอกว้างจะเห็นเป็นกรอบมือถือ (ใช้ตอนนำเสนอ), จอแคบกว่า 780px จะเต็มจอเหมือนใช้จริง

คำสั่งอื่น:

```bash
npm run build
```

```bash
npm run preview
```

---

## เดโมสำหรับนำเสนอ

**เข้าระบบ**: หน้าแรกเลือกบทบาท (นักศึกษา / อาจารย์) แล้วกด "เข้าสู่ระบบด้วย Google" — ตอนนี้เป็น mock ยังไม่ได้ต่อ SSO จริง

**สลับบทบาทระหว่างเดโมโดยไม่ต้อง logout**
- ฝั่งนักศึกษา → แตะกระดิ่งมุมขวาบน (หน้า sync) → การ์ด "เครื่องมือสำหรับการนำเสนอ" → **มุมมองอาจารย์**
- ฝั่งอาจารย์ → การ์ดชื่ออาจารย์มุมซ้ายล่าง → **ดูมุมมองนักศึกษา**

**รีเซ็ตข้อมูลกลับสถานะเริ่มต้น** (ก่อนเริ่มเดโมรอบใหม่): หน้า sync → **รีเซ็ตข้อมูล**

**ลำดับที่แนะนำสำหรับ 5 นาที**
1. หน้าแรก → กด "ผ่าน Step" → bottom sheet → ยืนยัน → toast + ปุ่มเลิกทำ (แสดงว่ากดผิดแก้ได้)
2. หน้า sync → เปิดโหมดออฟไลน์ → กลับหน้าแรก → กดผ่าน step อีกครั้ง → ยังสำเร็จทันที + ป้าย "รอ sync"
3. กลับหน้า sync → เห็นคิว → ปิดออฟไลน์ → กด sync ทันที
4. คนไข้ → เปิดเคส → timeline 0–10 พร้อม checklist และ badge "ทำเอง"
5. เกณฑ์ → เกณฑ์สะสม 2 ปี (CD/RPD/Crown+Post-core) และเกณฑ์รายปีแยกกันคนละการ์ด
6. ส่งออก → หน้ารายงาน A4 มีช่องลงนาม → ปุ่มสร้าง PDF (สั่งพิมพ์จริง) / CSV (ดาวน์โหลดจริง)
7. สลับเป็นอาจารย์ (แถบบนสุด) → เมนูซ้ายมี 7 หน้า: ภาพรวม · วิเคราะห์ · ตรวจงานรายคน · ตารางส่งรายงาน · Case CD · เคสค้าง · ตั้งค่าเกณฑ์
8. อาจารย์ → ตรวจงานรายคน (อนุมัติ/ตีกลับ/ตรวจรับเข้าเกณฑ์) → ตั้งค่าเกณฑ์ แล้วกลับไปดูหน้านักศึกษา ตัวเลขเปลี่ยนตามทันที

---

## โครงสร้างโค้ด

```
src/
  domain/          กติกาของระบบ — ไม่มีโค้ด UI เลย
    types.ts       entity ตาม handoff (Student, Patient, Workpiece, ProgressUpdate, …)
    catalog.ts     PROCS / RECALL / TYPES / ORDER — คัดลอกจากไฟล์ดีไซน์ = source of truth
    rules.ts       % completed, ลำดับการแสดงผล, เคสค้าง, case count, step timeline
    rounds.ts      รอบส่งรายงานปฏิทิน 2569
    aggregate.ts   สรุประดับกลุ่ม/ชั้นปีสำหรับ dashboard
  data/            ชั้นเก็บข้อมูล — "จุดสลับ" ไปเซิร์ฟเวอร์
    db.ts          schema IndexedDB (Dexie)
    seed.ts        fixture ข้อมูลสมมติ
    repo.ts        API เดียวที่ UI เรียก (advanceStep, undoStep, syncNow, setReview, …)
  store/app.ts     UI state (session, offline, toast, bottom sheet, settings)
  hooks/data.ts    live query — หน้าจออัปเดตเองเมื่อข้อมูลเปลี่ยน
  components/      shell มือถือ, bottom sheet ยืนยัน, ชิ้นส่วน UI ที่ใช้ซ้ำ
  routes/          หน้าจอทั้งหมด (student/ = S1–S11, teacher/ = 1b, 1c)
  styles/          tokens.css = ค่าสี/ฟอนต์จาก handoff ตรงตัว
```

### แผนที่หน้าจอ ↔ handoff

| handoff | ไฟล์ |
| --- | --- |
| S1 หน้าแรก | `routes/student/Home.tsx` |
| S2 คนไข้ + ชิ้นงาน | `routes/student/Patients.tsx` |
| S3 รายละเอียดชิ้นงาน | `routes/student/WorkpieceDetail.tsx` |
| Confirm sheet | `components/student/ConfirmSheet.tsx` |
| S4 เกณฑ์ขั้นต่ำ | `routes/student/Criteria.tsx` |
| S5 รายงานตามรอบ | **ถอดออกแล้ว** (บรีฟ 26 ส.ค. 2026 — แอปแทนการส่งรายงาน) แทนด้วยเช็คอินรายคาบ `routes/student/CheckIn.tsx` |
| S6 เข้าใช้งาน + PWA install | `routes/Login.tsx` |
| S7 เปิดชิ้นงานใหม่ | `routes/student/NewWorkpiece.tsx` |
| S8 ค้นหา / กรอง | `routes/student/Search.tsx` |
| S9 รูปต่อ step | `routes/student/Photos.tsx` |
| S10 การเชื่อมต่อ & sync | `routes/student/Sync.tsx` |
| S11 ส่งออก | `routes/student/Export.tsx` |
| 1b Dashboard อาจารย์ (ภาพรวม / เคสค้าง / Case CD) | `routes/teacher/Dashboard.tsx` |
| ประเมินรายคาบ (แทนสมุด Clinical rotation logbook) | `routes/teacher/Evaluate.tsx` + `domain/checkin.ts` |
| 1c ตรวจงานรายคน | `routes/teacher/Review.tsx` |
| วิเคราะห์ (เพิ่มเติมจาก handoff) | `routes/teacher/Analytics.tsx` + `domain/analytics.ts` |
| ตั้งค่าเกณฑ์ | `routes/teacher/Settings.tsx` |
| เมนูซ้ายที่ใช้ร่วมกันทุกหน้าฝั่งอาจารย์ | `components/teacher/TeacherShell.tsx` |

---

## กติกาที่ implement ไว้แล้ว

1. **Upper/lower เป็นคู่** — `pairId` + `acceptedDate` เดียวกัน แต่ `procIndex` แยกกันเด็ดขาด
2. **% completed** = `(progression + 1) / (maxProgression + 1)` ตรงกับคอลัมน์ `% Completed` ในชีต
3. **เกณฑ์ขั้นต่ำ (แก้ล่าสุด 25 ส.ค. 2026)** — สะสม 2 ปี: CD 1 · RPD 2 · Crown/Bridge 2 โดยในนั้นต้องเป็น Post-core อย่างน้อย 1
   (Post-core นับรวมอยู่ในโควตา Crown ไม่ได้แยก) **บวกเงื่อนไขรายปี**: ทุกปีการศึกษาต้องจบอย่างน้อย 3 ชิ้นงาน
   นับเมื่อ `progression === 10` และ `minimumRequirement === true`; Simple APD และ Recall ไม่นับ
   อาจารย์แก้ค่าทั้งหมดได้จาก rail ขวาของหน้าตรวจงาน
4. **ลำดับการแสดงรายการ** — minimum requirement ก่อน → CD → RPD → APD → Post-core → Crown/Bridge → Recall Rem. → Recall Fixed และผู้ป่วยคนเดียวกันอยู่ติดกัน
5. **เคสค้าง** — ไม่อัปเดตเกิน N วัน (ตั้งได้ 7/14/21/30) flag ทั้งสองฝั่ง
6. **รอบส่งรายงาน** ปฏิทินจริง 2569 พร้อมเตือนล่วงหน้า
7. **Export** — PDF ที่มีช่องลงนาม (`window.print()`) และ CSV ตามคอลัมน์ชีตเดิม
8. **Self-performed (`*`)** — เก็บลง `ProgressUpdate.selfPerformed` และมี badge "ทำเอง" ใน UI
9. **Offline-first** — เขียนลง IndexedDB ทันที เข้าคิว แล้ว sync เมื่อออนไลน์
10. **เลิกทำ** — บันทึกเป็น reversal ใน `ProgressUpdate` ไม่ลบประวัติ
11. **Audit log** — ทุกการเปลี่ยน step / อนุมัติ / สร้างชิ้นงาน
12. **Catalog versioning** — ทุกชิ้นงานเก็บ `catalogVersion` (`DTPT502-2569`)
13. **ชนิดชิ้นงานถอดได้ตามชีต** — CD / Complicated APD / Complicated RPD / Simple RPD / Simple APD พร้อมวงเล็บบอกจำนวนฟันที่เหลือ (`domain/catalog.ts → DENTURE_CLASSES`)
14. **Count CDA** — คำนวณอัตโนมัติจากจำนวน arch ที่เป็น CD หรืองาน Complicated แสดงในแท็บ Case CD ของ dashboard
15. **สถานะ “ยังไม่เข้าเกณฑ์ · รอตรวจ”** — ชิ้นงานที่อาจารย์ยังไม่ตรวจรับ จะไม่ถูกนับเข้าเกณฑ์ อาจารย์กดตรวจรับได้จากหน้าตรวจงาน
16. **รายงาน A4 มีช่องติ๊ก 0–10** ครบ 11 ช่องเหมือนชีต · CSV เรียงคอลัมน์ตรงกับ tab PTn รวม Sect II (แยก Removable/Fixed) และวันที่บันทึกข้อมูล
17. **ตารางส่งรายงานครบ 7 รอบ** พร้อมคอลัมน์ Advisors และ Report issues
18. **กดเลข step 0–10 ที่ไหนก็ได้เพื่อดูว่าข้างในมี procedure อะไร** — กราฟคอขวด (ทั้งหน้าภาพรวมและหน้าวิเคราะห์)
    และ timeline ของนักศึกษา · เลือก "ทุกประเภท" จะเทียบให้เห็นว่า step เดียวกันหมายถึงคนละขั้นตอนในแต่ละประเภทงาน
    (`components/StepInfo.tsx`)
19. **การแสดงผลเลือกตามขนาดข้อมูลจริง** — เกณฑ์เป็นหลักหน่วย (CD 1 · RPD 2 · Crown 2 · ปีละ 3)
    นักศึกษาหนึ่งคนมีเคสไม่ถึงสิบชิ้น จึงตั้งใจ**ไม่**ใช้กราฟที่ทำให้ดูเหมือนมีข้อมูลละเอียดกว่าความจริง:
    - **รายคน** → `RequirementSlots` ช่องทีละเคส (ทึบ = จบแล้ว · อ่อนพร้อมเลข = เคสที่กำลังทำจะมาลงช่องนี้ · ประ = ยังไม่มี)
    - **รายกลุ่ม** → `DivergingBars` ต่างจากค่าเฉลี่ยทั้งชั้นปีกี่จุด + `Heatmap` แท่งเล็กรายคน × เป้าหมาย
    - **คอขวด** → `CaseMap` หนึ่งจุด = ชิ้นงานจริงหนึ่งชิ้น เรียงเป็นกองตาม step (unit chart ไม่ต้องเฉลี่ยอะไรเลย)
    - **ระดับ cohort** (n หลักร้อย) → กราฟปกติใช้ได้: ระยะเวลาต่อประเภท · จบเคสต่อเดือน · funnel
    - `charts/Radar.tsx` เก็บไว้แต่ยังไม่ได้ใช้ — เหตุผลอยู่ในหัวไฟล์
20. **หน้าวิเคราะห์** — คนที่เสี่ยงไม่ทันเกณฑ์ (ประเมินจาก**เคสที่มีอยู่ในมือเดินมาถึงไหน** ไม่ใช่อัตราการจบต่อเดือน
    ซึ่งไม่มีความหมายที่ n หลักหน่วย), จบเคสต่อเดือนตลอดปีการศึกษา, ระยะเวลารับเคส→จบเคสต่อประเภท,
    คอขวดว่าชิ้นงานกองอยู่ที่ step ไหน, funnel อัตราจบเคสต่อประเภท, และ lab step ที่ต้องทำเอง
    ทุกตัวเลขคำนวณสดจากข้อมูลในระบบ ไม่มีค่า hard-code

---

## ยังไม่ได้ทำ — ต้องคุยกับภาควิชาก่อน

ตรงกับหัวข้อ "ที่ยังไม่ได้ออกแบบ" ใน handoff:

1. **Auth จริง** — ตอนนี้เป็น mock; ต้องต่อ SSO มหาวิทยาลัย / Google Workspace จำกัดโดเมน และแยก role นักศึกษา / อาจารย์ที่ปรึกษา / ภาควิชา / แอดมิน
2. **เซิร์ฟเวอร์กลาง** — ตอนนี้ข้อมูลอยู่ในเครื่องผู้ใช้แต่ละคน (IndexedDB) อาจารย์ยังไม่เห็นข้อมูลจริงข้ามเครื่อง ต้องมี backend ก่อนใช้งานจริง (แก้เฉพาะ `src/data/repo.ts`)
3. **PDPA** — retention, การ mask ชื่อ/HN ในหน้ารวม, สิทธิ์ export, audit log ที่แก้ไม่ได้
4. **Conflict resolution** เมื่อ sync ทับกัน
5. **2 ข้อที่รอภาควิชายืนยัน** (มี toggle ให้สลับในหน้าตรวจงาน → กล่องสีเหลือง "รอภาควิชายืนยัน")
   - "CD 1" นับ 1 เคส (upper+lower) หรือ 1 แถวต่อ arch — ค่าเริ่มต้นตอนนี้คือ **นับรายแถว** ตามคอลัมน์ `Count CDA` ในชีต
   - "3 ชิ้นงาน/ปี" นับเฉพาะ 4 ประเภทหลัก หรือรวม Simple APD/Recall — ค่าเริ่มต้นคือ **เฉพาะ 4 ประเภทหลัก**
6. **Migration จาก Google Sheets เดิม** — export CSV ตรงคอลัมน์ชีตแล้ว แต่ยังไม่มีหน้า import
   - **สูตร Count CDA ยังไม่ยืนยัน** — ตอนนี้ตีความว่า “จำนวน arch ที่เป็น CD หรือ Complicated (APD/RPD)” จากข้อมูลในชีต
     แต่มีบางแถวในชีตที่ไม่เข้าสูตรนี้ ถ้าภาควิชายืนยันสูตรจริงแล้วแก้ที่ `domain/rules.ts → countCDA()`
7. **การเชื่อมกับ** `dtmyclinic.mahidol.ac.th`
8. **รูปจริง** — ตอนนี้ช่องรูปเป็น placeholder ทั้งหมด ยังไม่ได้ต่อกล้อง/คลังภาพ

### หนี้ทางเทคนิคที่รู้ตัว

- bundle 635 KB (gzip 179 KB) — ส่วนใหญ่มาจากชุดไอคอน Phosphor ที่ tree-shake ได้ไม่ดี ควรเปลี่ยนไป import รายไอคอนหรือใช้ SVG sprite
- ยังไม่มี unit test ของ `domain/rules.ts` ซึ่งเป็นจุดที่ควรมีมากที่สุด


---

## ระบบเช็คอินรายคาบ (เพิ่ม 26 ส.ค. 2026 — แทนระบบรายงานเดิม)

ถอดจากสมุดจริง "Clinical Performance Portfolio · Clinical rotation assessment logbook":

- **นักศึกษา** (แท็บ "คาบ"): เช็คอินต่อคาบ — วันที่ · ตรงเวลา/สาย · กิจกรรม (เลือกจากรายการแทนเขียนมือ:
  Oral examination, Primary impression, Bite registration, Try in/Delivery, ส่งงาน, Lab work, ผู้ช่วย, ไม่มีผู้ป่วย) ·
  ผู้ป่วยที่นัด · โน้ต — หน้าแรกมีแบนเนอร์เตือนถ้าวันนี้ยังไม่เช็คอิน
- **อาจารย์** (เมนู "ประเมินรายคาบ"): คิวคาบที่รอประเมิน แยกกลุ่ม — ให้คะแนน 0–3 ทั้ง 8 หัวข้อตาม Part B ของสมุด
  (Knowledge, Skill, Universal Precaution, Instrument Prep, Time Management, Chart Recording, Communication,
  General Conduct) → "บันทึกผล · ลงนาม" เทียบเท่าเซ็นสมุด นักศึกษาเห็นคะแนนทันที
- ระบบรายงาน (S5 + ตารางส่งรายงาน + การ์ดรอบ deadline) ถูกถอดออกทั้งหมด · หน้า export PDF/CSV ยังอยู่ (ลิงก์ท้ายแท็บ "คาบ")
- **รอทำต่อ**: แบบประเมินรวมต่อเคสแยกตามประเภทงาน (Assessment form for Removable prosthesis case ฯลฯ) — ผู้ใช้จะส่งฟอร์มของประเภทอื่นมาให้ครบก่อน


## กลุ่มที่ดูแล (context กลางฝั่งอาจารย์ — 26 ส.ค. 2026)

- Sidebar มี dropdown "กลุ่มที่ดูแล" ตั้งครั้งเดียว ทุกหน้า (ตรวจงาน/ประเมินรายคาบ/วิเคราะห์) ใช้กลุ่มเดียวกันหมด · จำค่าใน localStorage
- คลิกการ์ดกลุ่มในหน้าภาพรวม = เปลี่ยนกลุ่มที่ดูแลด้วย
- **ตัดสินใจร่วมกับผู้ใช้แล้ว**: อาจารย์ดูข้ามกลุ่มได้ ไม่ใช่การจำกัดสิทธิ์ — ตัวเลือกมีไว้เพื่อความสะดวก
  ตอนต่อ login จริงแค่ตั้ง default เป็นกลุ่มที่ตัวเองเป็น advisor ก็พอ ไม่ต้องล็อก
