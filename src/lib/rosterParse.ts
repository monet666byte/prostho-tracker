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
/** จำนวนกลุ่มคลินิกของภาค (PT1–PT12 · ผู้ใช้ยืนยัน 1 ก.ย. 69) */
const CLINIC_GROUP_COUNT = 12;
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
 * แถวตัวอย่างในแบบฟอร์มขอรายชื่อ (docs/prostho-roster-request-template.xlsx)
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

export function parseRoster(text: string): RosterParseResult {
  const rows: RosterRow[] = [];
  const errors: RosterParseResult['errors'] = [];
  const seen = new Set<string>();

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
      if (dtmuCell && !isDtmuCell(dtmuCell)) return void fail('รุ่น DTMU ต้องเป็นเลข 2 หลัก เช่น 56');
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
         แล้วกลุ่มนั้นไปโผล่ในตัวเลือก "กลุ่มที่ดูแล" ของอาจารย์ทุกคนถาวร (ทดลองแล้ว 10 ก.ย. 69)
         ถ้าวันหน้าภาคเพิ่มกลุ่ม แก้ CLINIC_GROUP_COUNT ที่เดียว — บรรทัดที่ตกจะมีเหตุผลบอกในรายงาน */
      group = cells.find(isGroupCell);
      dtmuCell = cells.find((c) => isDtmuCell(c) && c !== code);
      email = cells.find(isEmailCell);
      const rest = cells.filter((c) => c !== code && c !== group && c !== dtmuCell && c !== email && !isThaiPrefix(c));
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
    if (code === TEMPLATE_EXAMPLE.code && name === TEMPLATE_EXAMPLE.name) {
      return void fail('แถวตัวอย่างในแบบฟอร์ม — ข้ามให้แล้ว');
    }
    seen.add(code);
    rows.push({
      code,
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(email ? { email: email.toLowerCase() } : {}),
      group: group.toUpperCase().replace(/^TH\d*-/, ''),
      dtmu: dtmuCell ? Number(dtmuCell.replace(/\D/g, '')) : undefined,
    });
  });
  return { rows, errors };
}
