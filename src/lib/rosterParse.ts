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
  name: string;
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
 */
/** จำนวนกลุ่มคลินิกของภาค (PT1–PT12 · ผู้ใช้ยืนยัน 1 ก.ย. 69) */
const CLINIC_GROUP_COUNT = 12;
/** ชื่อ-นามสกุลไทยเต็มยศยังไม่เกินนี้ — ยาวกว่านี้คือแถวที่อ่านผิด */
const MAX_NAME_LENGTH = 120;

export function parseRoster(text: string): RosterParseResult {
  const rows: RosterRow[] = [];
  const errors: RosterParseResult['errors'] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(/\t|,|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    // ข้ามหัวตาราง: ไม่มีเซลล์ไหนขึ้นต้นด้วยตัวเลข 7 หลัก
    const code = cells.find((c) => /^\d{7}$/.test(c));
    if (!code) {
      // หัวตารางต้องอยู่บรรทัดแรกเท่านั้น — บรรทัดอื่นที่ไม่มีรหัสถือว่าผิดจริง
      if (i === 0 && /รหัส|code|ชื่อ|name|กลุ่ม|group/i.test(line)) return;
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: 'ไม่พบรหัสนักศึกษา 7 หลัก' });
      return;
    }
    if (seen.has(code)) {
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: 'รหัสซ้ำกับบรรทัดก่อนหน้า' });
      return;
    }
    /* ต้องเป็นกลุ่มที่มีอยู่จริง ไม่ใช่ "PT ตามด้วยเลขอะไรก็ได้"
       เดิม /PT\d{1,2}/ ผ่านทั้ง PT0 และ PT99 — พิมพ์ผิดหนึ่งตัวได้กลุ่มใหม่ที่ไม่มีในภาค
       แล้วกลุ่มนั้นไปโผล่ในตัวเลือก "กลุ่มที่ดูแล" ของอาจารย์ทุกคนถาวร (ทดลองแล้ว 10 ก.ย. 69)
       ถ้าวันหน้าภาคเพิ่มกลุ่ม แก้ CLINIC_GROUP_COUNT ที่เดียว — บรรทัดที่ตกจะมีเหตุผลบอกในรายงาน */
    const group = cells.find((c) => {
      const m = /^(?:TH\d*-)?PT(\d{1,2})$/i.exec(c);
      if (!m) return false;
      const n = Number(m[1]);
      return n >= 1 && n <= CLINIC_GROUP_COUNT;
    });
    if (!group) {
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: `ไม่พบกลุ่ม (PT1–PT${CLINIC_GROUP_COUNT})` });
      return;
    }
    const dtmuCell = cells.find((c) => /^(DTMU)?\d{2}$/i.test(c) && c !== code);
    const name = cells.find((c) => c !== code && c !== group && c !== dtmuCell) ?? '';
    if (!name) {
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: 'ไม่พบชื่อ' });
      return;
    }
    /* ชื่อยาวเกินคนจริง = แถวที่ตัวคั่นเพี้ยน (ทั้งบรรทัดมากองในช่องชื่อ)
       ปล่อยเข้าไปแล้วมันจะไปยืดตารางทุกหน้าที่แสดงชื่อ และไม่มีใครรู้ว่ามาจากไหน */
    if (name.length > MAX_NAME_LENGTH) {
      errors.push({ line: i + 1, text: line.slice(0, 40), reason: `ชื่อยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร — ตรวจตัวคั่นในบรรทัดนี้` });
      return;
    }
    seen.add(code);
    rows.push({
      code,
      name,
      group: group.toUpperCase().replace(/^TH\d*-/, ''),
      dtmu: dtmuCell ? Number(dtmuCell.replace(/\D/g, '')) : undefined,
    });
  });
  return { rows, errors };
}
