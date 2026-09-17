/**
 * อ่านรายชื่อนักศึกษาจากข้อความที่วางมา — CSV / TSV / วางตรงจาก Excel
 *
 * แยกออกมาจาก data/repo.ts เพราะเป็นการแปลงข้อความล้วน ไม่แตะฐานข้อมูลเลย
 * (repo.ts import Dexie จึงรันนอกเบราว์เซอร์ไม่ได้ — ตัวอ่านที่สำคัญที่สุด
 *  ของงานตั้งต้นข้อมูลต้นปีจึงเทสต์ตรงๆ ไม่ได้ทั้งที่ควรเทสต์)
 *
 * หน้าที่ของไฟล์นี้คือ "บอกให้ครบว่าบรรทัดไหนเข้าไม่ได้เพราะอะไร"
 * ภาคจะวางรายชื่อ 96 คนทีเดียว ถ้าตกไปเงียบๆ ไม่มีใครรู้ว่าใครหาย
 */

export interface RosterRow {
  code: string;   // รหัสนักศึกษา เช่น 6604001
  name: string;   // ชื่อไทย (หลัก)
  /** ชื่ออังกฤษ — ไม่บังคับ (0025) */
  nameEn?: string;
  /** อีเมลมหาวิทยาลัย — ไม่บังคับ · มี = หน้ารายชื่อให้สิทธิ์เข้าระบบให้ทันที */
  email?: string;
  group: string;  // PT1–PT12 (ใส่มาแบบสั้นก็ได้)
  /** เลขรุ่น DTMU เช่น 56 — ไม่ใส่ก็ใช้ค่าที่เลือกไว้ตอนนำเข้า */
  dtmu?: number;
}

export interface RosterParseResult {
  rows: RosterRow[];
  /** บรรทัดที่อ่านไม่ออก พร้อมเหตุผล — โชว์ให้เห็นก่อนกดนำเข้า */
  errors: Array<{ line: number; text: string; reason: string }>;
}

/**
 * อ่านรายชื่อจากข้อความที่วางมา — รองรับทั้ง CSV, TSV และวางจาก Excel
 * รูปแบบ: รหัส, ชื่อ, กลุ่ม[, เลขรุ่น]  ·  บรรทัดหัวตารางข้ามให้อัตโนมัติ
 * มีหัวตาราง (ก๊อปทั้งตารางจากแบบฟอร์มขอรายชื่อ) = อ่านตามตำแหน่งคอลัมน์ ได้ชื่ออังกฤษ + อีเมลด้วย
 */
/** จำนวนกลุ่มคลินิกของภาค */
const CLINIC_GROUP_COUNT = 12;
/** รุ่นที่เป็นไปได้ (DTMU) — ใช้แยก "เลขรุ่น" ออกจาก "เลขลำดับ" ตอนไม่มีหัวตาราง */
const DTMU_MIN = 40;
const DTMU_MAX = 99;
/** ชื่อ-นามสกุลไทยเต็มยศยังไม่เกินนี้ — ยาวกว่านี้คือแถวที่อ่านผิด */
const MAX_NAME_LENGTH = 120;

/** ช่องกลุ่มที่มีอยู่จริง — ไม่ใช่ "PT ตามด้วยเลขอะไรก็ได้" (เหตุผลอยู่ใน checkRow) */
function isGroupCell(c: string): boolean {
  const m = /^(?:TH\d*-)?PT(\d{1,2})$/i.exec(c);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= CLINIC_GROUP_COUNT;
}
const isDtmuCell = (c: string) => /^(DTMU)?\d{2}$/i.test(c);
const isEmailCell = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
/** ชื่ออังกฤษ = ตัวอักษรละตินล้วน (มีจุด/ขีด/เว้นวรรคได้) */
const isLatinName = (c: string) => /^[A-Za-z][A-Za-z .'\-]*$/.test(c) && !isGroupCell(c) && !/^DTMU\d*$/i.test(c);
const isThaiPrefix = (c: string) => /^(นาย|นางสาว|นาง|น\.ส\.)$/.test(c);

/**
 * แถวตัวอย่างในแบบฟอร์มขอรายชื่อ (public/prostho-roster-request-template.xlsx)
 * ภาคอาจลืมลบ — ถ้าหลุดเข้าไปจะได้นักศึกษาปลอมชื่อ "สมมติ ตัวอย่าง" ในรายชื่อจริง
 */
const TEMPLATE_EXAMPLE = { code: '6604999', name: 'สมมติ ตัวอย่าง' };

type Col = 'code' | 'name' | 'nameEn' | 'email' | 'dtmu' | 'group' | 'skip';

/**
 * อ่านหัวตารางของแบบฟอร์ม — คืนตำแหน่งคอลัมน์ ถ้าหัวตารางมีครบ รหัส · ชื่อ · กลุ่ม
 * ต้องอ่านตามตำแหน่ง เพราะแบบฟอร์มมีช่องที่ว่างได้ (คำนำหน้า · ชื่ออังกฤษ · อีเมล)
 * เดาจากหน้าตาเซลล์ทีละช่องจะหยิบ "นาย" มาเป็นชื่อ
 */
function headerColumns(cells: string[]): Col[] | null {
  const cols = cells.map((raw): Col => {
    const c = raw.replace(/\*/g, '').trim().toLowerCase();
    if (!c) return 'skip';
    if (/คำนำหน้า|prefix|title/.test(c)) return 'skip';
    if (/รหัส|student.?id|code/.test(c)) return 'code';
    if (/อังกฤษ|english|name.?en/.test(c)) return 'nameEn';
    if (/อีเมล|e-?mail/.test(c)) return 'email';
    if (/รุ่น|dtmu|cohort/.test(c)) return 'dtmu';
    if (/กลุ่ม|group/.test(c)) return 'group';
    if (/ชื่อ|name/.test(c)) return 'name';
    return 'skip';
  });
  const has = (k: Col) => cols.includes(k);
  return has('code') && has('name') && has('group') ? cols : null;
}

/** ข้อความที่วางมามีหัวตารางแบบแท็บ "นักศึกษา" ไหม — ตอนอ่านไฟล์ Excel ใช้แยกแผ่นรายชื่อออกจากแผ่นคำอธิบาย */
export function looksLikeStudentRoster(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim());
  if (!first) return false;
  return headerColumns(first.includes('\t') ? first.split('\t') : first.split(',')) !== null;
}

export function parseRoster(text: string): RosterParseResult {
  const rows: RosterRow[] = [];
  const errors: RosterParseResult['errors'] = [];
  const seen = new Set<string>();
  const seenEmail = new Set<string>();

  const lines = text.split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim());
  const splitKeep = (line: string) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
  const header = firstIdx >= 0 ? headerColumns(splitKeep(lines[firstIdx])) : null;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const fail = (reason: string) => errors.push({ line: i + 1, text: line.slice(0, 40), reason });

    let code: string | undefined;
    let name = '';
    let nameEn: string | undefined;
    let email: string | undefined;
    let group: string | undefined;
    let dtmuCell: string | undefined;

    if (header) {
      if (i === firstIdx) return;
      /* แบบมีหัวตาราง: อ่านตามตำแหน่งคอลัมน์ · Excel ตัดแท็บท้ายแถวที่ว่างทิ้งได้ จึงเติมช่องว่างให้ */
      const cells = raw.includes('\t') ? raw.split('\t').map((c) => c.trim()) : splitKeep(raw);
      const get = (k: Col) => cells[header.indexOf(k)] ?? '';
      /* แถวที่มีแค่ช่องว่าง (ช่องสีเหลืองที่ยังไม่กรอก) ไม่ใช่ข้อผิดพลาด */
      if (cells.every((c) => !c)) return;
      code = /^\d{7}$/.test(get('code')) ? get('code') : undefined;
      if (!code) return void fail('ไม่พบรหัสนักศึกษา 7 หลัก');
      name = get('name');
      nameEn = get('nameEn') || undefined;
      email = get('email') || undefined;
      group = isGroupCell(get('group')) ? get('group') : undefined;
      dtmuCell = get('dtmu') || undefined;
      if (dtmuCell && (!isDtmuCell(dtmuCell) || Number(dtmuCell.replace(/\D/g, '')) < DTMU_MIN)) {
        return void fail('รุ่น DTMU ต้องเป็นเลข 2 หลัก เช่น 56');
      }
    } else {
      const cells = line.split(/\t|,|\s{2,}/).map((c) => c.trim()).filter(Boolean);
      // ข้ามหัวตาราง: ไม่มีเซลล์ไหนขึ้นต้นด้วยตัวเลข 7 หลัก
      code = cells.find((c) => /^\d{7}$/.test(c));
      if (!code) {
        // หัวตารางต้องอยู่บรรทัดแรกเท่านั้น — บรรทัดอื่นที่ไม่มีรหัสถือว่าผิดจริง
        if (i === firstIdx && /รหัส|code|ชื่อ|name|กลุ่ม|group/i.test(line)) return;
        return void fail('ไม่พบรหัสนักศึกษา 7 หลัก');
      }
      /* ต้องเป็นกลุ่มที่มีอยู่จริง ไม่ใช่ "PT ตามด้วยเลขอะไรก็ได้"
         เดิม /PT\d{1,2}/ ผ่านทั้ง PT0 และ PT99 — พิมพ์ผิดหนึ่งตัวได้กลุ่มใหม่ที่ไม่มีในภาค
         แล้วกลุ่มนั้นไปโผล่ในตัวเลือก "กลุ่มที่ดูแล" ของอาจารย์ทุกคนถาวร
         ถ้าวันหน้าภาคเพิ่มกลุ่ม แก้ CLINIC_GROUP_COUNT ที่เดียว — บรรทัดที่ตกจะมีเหตุผลบอกในรายงาน */
      group = cells.find(isGroupCell);
      /* ไม่มีหัวตาราง = เดาจากหน้าตาเซลล์ — เลข 2 หลักอาจเป็น "ลำดับที่" (10, 11…) ไม่ใช่รุ่น
         รับเฉพาะ DTMU นำหน้า หรือเลขในช่วงรุ่นที่เป็นไปได้ · ไม่งั้นแถวที่ 10 ได้รุ่น DTMU10 เงียบๆ */
      dtmuCell = cells.find((c) => c !== code && isDtmuCell(c) && (/^DTMU/i.test(c) || (Number(c) >= DTMU_MIN && Number(c) <= DTMU_MAX)));
      const isNumberOnly = (c: string) => /^\d+$/.test(c);
      email = cells.find(isEmailCell);
      const rest = cells.filter((c) => c !== code && c !== group && c !== dtmuCell && c !== email && !isThaiPrefix(c) && !isNumberOnly(c));
      /* ไม่มีหัวตาราง: ช่องตัวอักษรละตินคือชื่ออังกฤษ — แต่ถ้าไม่มีช่องอื่นเลย ถือว่าเป็นชื่อหลัก (รายชื่อเก่าที่พิมพ์อังกฤษ) */
      const latin = rest.find(isLatinName);
      const other = rest.find((c) => c !== latin);
      name = other ?? latin ?? '';
      nameEn = other && latin ? latin : undefined;
    }

    if (seen.has(code)) return void fail('รหัสซ้ำกับบรรทัดก่อนหน้า');
    if (!group) return void fail(`ไม่พบกลุ่ม (PT1–PT${CLINIC_GROUP_COUNT})`);
    if (!name) return void fail('ไม่พบชื่อ');
    /* ชื่อยาวเกินคนจริง = แถวที่ตัวคั่นเพี้ยน (ทั้งบรรทัดมากองในช่องชื่อ)
       ปล่อยเข้าไปแล้วมันจะไปยืดตารางทุกหน้าที่แสดงชื่อ และไม่มีใครรู้ว่ามาจากไหน */
    if (name.length > MAX_NAME_LENGTH || (nameEn?.length ?? 0) > MAX_NAME_LENGTH) {
      return void fail(`ชื่อยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร — ตรวจตัวคั่นในบรรทัดนี้`);
    }
    if (email && !isEmailCell(email)) return void fail('อีเมลไม่ถูกต้อง');
    /* อีเมลเดียวผูกได้คนเดียว — ปล่อยผ่าน รายชื่อเชิญจะเก็บแค่คนแรก แล้วคนที่สองเข้าระบบไม่ได้โดยไม่มีใครรู้ */
    if (email && seenEmail.has(email.toLowerCase())) return void fail('อีเมลซ้ำกับบรรทัดก่อนหน้า');
    if (code === TEMPLATE_EXAMPLE.code && name === TEMPLATE_EXAMPLE.name) {
      return void fail('แถวตัวอย่างในแบบฟอร์ม — ข้ามให้แล้ว');
    }
    seen.add(code);
    if (email) seenEmail.add(email.toLowerCase());
    rows.push({
      code,
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(email ? { email: email.toLowerCase() } : {}),
      /* PT01 → PT1 — ไม่งั้นได้กลุ่มใหม่ TH56-PT01 คู่กับ TH56-PT1 */
      group: `PT${Number(/PT(\d{1,2})$/i.exec(group)![1])}`,
      dtmu: dtmuCell ? Number(dtmuCell.replace(/\D/g, '')) : undefined,
    });
  });
  return { rows, errors };
}

/* ══ แท็บ "อาจารย์" ของแบบฟอร์มขอรายชื่อ ══
   หัวตาราง: คำนำหน้า / ตำแหน่ง · ชื่อ-นามสกุล (ไทย) * · ชื่อ-นามสกุล (อังกฤษ) · อีเมล * · บทบาท * · กลุ่มที่ปรึกษา
   กลุ่มที่ปรึกษาไม่อ่าน — อาจารย์เลือกเองในแอป และระบบล้างทุกปีการศึกษา (0024) */

export interface TeacherRosterRow {
  /** อีเมลตัวเล็กทั้งหมด — ใช้ให้สิทธิ์เข้าระบบ */
  email: string;
  /** ชื่อที่แสดง = คำนำหน้า + ชื่อไทย (แบบเดียวกับชื่ออาจารย์เดิมในระบบ "อ. …") */
  name: string;
  title?: string;
  nameEn?: string;
  /** บทบาท "หัวหน้ารายวิชา" */
  isAdmin: boolean;
}

export interface TeacherRosterParseResult {
  rows: TeacherRosterRow[];
  errors: Array<{ line: number; text: string; reason: string }>;
}

/** แถวตัวอย่างในแท็บอาจารย์ของแบบฟอร์ม — ภาคอาจลืมลบ */
const TEACHER_TEMPLATE_EXAMPLE = { email: 'sommut.jai@mahidol.edu', name: 'สมมติ ใจดี' };

type TCol = 'title' | 'name' | 'nameEn' | 'email' | 'role' | 'skip';

function teacherHeaderColumns(cells: string[]): TCol[] | null {
  const cols = cells.map((raw): TCol => {
    const c = raw.replace(/\*/g, '').trim().toLowerCase();
    if (!c) return 'skip';
    if (/กลุ่ม|group/.test(c)) return 'skip';
    if (/คำนำหน้า|ตำแหน่ง|prefix|title/.test(c)) return 'title';
    if (/บทบาท|role/.test(c)) return 'role';
    if (/อังกฤษ|english|name.?en/.test(c)) return 'nameEn';
    if (/อีเมล|e-?mail/.test(c)) return 'email';
    if (/ชื่อ|name/.test(c)) return 'name';
    return 'skip';
  });
  const has = (k: TCol) => cols.includes(k);
  return has('name') && has('email') && has('role') ? cols : null;
}

/** ข้อความที่วางมาเป็นแท็บอาจารย์ไหม — หน้ารายชื่อใช้เลือกว่าจะอ่านแบบไหน (ช่องวางช่องเดียวกับนักศึกษา) */
export function looksLikeTeacherRoster(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim());
  if (!first) return false;
  const cells = first.includes('\t') ? first.split('\t') : first.split(',');
  return teacherHeaderColumns(cells) !== null;
}

export function parseTeacherRoster(text: string): TeacherRosterParseResult {
  const rows: TeacherRosterRow[] = [];
  const errors: TeacherRosterParseResult['errors'] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim());
  const split = (line: string) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
  const header = firstIdx >= 0 ? teacherHeaderColumns(split(lines[firstIdx])) : null;
  if (!header) {
    if (firstIdx >= 0) errors.push({ line: firstIdx + 1, text: lines[firstIdx].trim().slice(0, 40), reason: 'ต้องก๊อปหัวตารางของแท็บ "อาจารย์" มาด้วย' });
    return { rows, errors };
  }

  lines.forEach((raw, i) => {
    if (i <= firstIdx || !raw.trim()) return;
    const cells = split(raw);
    if (cells.every((c) => !c)) return;
    const line = raw.trim();
    const fail = (reason: string) => errors.push({ line: i + 1, text: line.slice(0, 40), reason });
    const get = (k: TCol) => cells[header.indexOf(k)] ?? '';

    const thai = get('name');
    const email = get('email').toLowerCase();
    const role = get('role');
    const title = get('title');
    const nameEn = get('nameEn');

    if (!thai) return void fail('ไม่พบชื่อไทย');
    if (!email) return void fail('ไม่พบอีเมล');
    if (!isEmailCell(email)) return void fail('อีเมลไม่ถูกต้อง');
    /* บทบาทว่างหรือพิมพ์เอง = ไม่เดา — "หัวหน้ารายวิชา" คือสิทธิ์เพิ่มคน/สำรองข้อมูลทั้งระบบ
       เดาผิดทาง "ให้" แพงกว่าเดาผิดทาง "ไม่ให้" มาก จึงให้แก้ในไฟล์แล้ววางใหม่ */
    if (role !== 'อาจารย์' && role !== 'หัวหน้ารายวิชา') return void fail('บทบาทต้องเป็น "อาจารย์" หรือ "หัวหน้ารายวิชา"');
    if (seen.has(email)) return void fail('อีเมลซ้ำกับบรรทัดก่อนหน้า');
    const name = [title, thai].filter(Boolean).join(' ');
    if (name.length > MAX_NAME_LENGTH || nameEn.length > MAX_NAME_LENGTH) {
      return void fail(`ชื่อยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร — ตรวจตัวคั่นในบรรทัดนี้`);
    }
    if (email === TEACHER_TEMPLATE_EXAMPLE.email && thai === TEACHER_TEMPLATE_EXAMPLE.name) {
      return void fail('แถวตัวอย่างในแบบฟอร์ม — ข้ามให้แล้ว');
    }
    seen.add(email);
    rows.push({
      email,
      name,
      ...(title ? { title } : {}),
      ...(nameEn ? { nameEn } : {}),
      isAdmin: role === 'หัวหน้ารายวิชา',
    });
  });
  return { rows, errors };
}

/**
 * id อาจารย์ที่สร้างจากอีเมล — ต้องตรงกับ supabase/add-teacher.sql
 * (`'tc-' || substr(encode(sha256(convert_to(email,'UTF8')),'hex'),1,10)`)
 * เพิ่มคนเดียวกันจากสองทางต้องได้แถวเดียวกัน ไม่ใช่อาจารย์ซ้ำสองคน
 * ไม่มีชื่อคนอยู่ใน id — id ไหลลง audit และ URL
 */
export async function teacherIdFromEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `tc-${hex.slice(0, 10)}`;
}
