/**
 * รหัสกลุ่มคลินิก — แต่ละชั้นปีมี PT1–PT12 ของตัวเอง (ผู้ใช้ยืนยัน 1 ก.ย. 69)
 * ชื่อกลุ่มเลยซ้ำกันข้ามปีได้ รหัสในระบบจึงติด tag ปี:
 *   ปี 5 → 'TH-PT7' (รูปแบบเดิม — ข้อมูล/ลิงก์เก่าไม่พัง)
 *   ปี 6 → 'TH6-PT7'
 * ของจริงชั้นปีของนักศึกษามาจาก roster (student.year) — tag ในรหัสกลุ่ม
 * ใช้แยกกลุ่มชื่อซ้ำและบอกปีของ "กลุ่ม" เท่านั้น
 */

/** 'TH-PT7' / 'TH6-PT7' → 'PT7' — ใช้ทุกจุดที่โชว์ชื่อกลุ่ม แทน .replace('TH-','') เดิม */
export function groupShort(code: string | undefined): string {
  return (code ?? '').replace(/^TH\d*-/, '');
}

/** ปีของกลุ่มจากรหัส — 'TH6-' = ปี 6 · รูปแบบเดิม = ปี 5 */
export function groupYear(code: string | undefined): number {
  const m = (code ?? '').match(/^TH(\d+)-/);
  return m ? Number(m[1]) : 5;
}

/** ป้ายสั้นสำหรับ chip/ตัวเลือกที่เห็นสองปีปนกัน — ปี 5 คงเดิม 'PT7' · ปี 6 = 'PT7·6' */
export function groupLabel(code: string | undefined): string {
  const y = groupYear(code);
  return y === 5 ? groupShort(code) : `${groupShort(code)}·${y}`;
}

/** แยก "นายธนาเดช สินส่งเสริม" → ["นายธนาเดช", "สินส่งเสริม"] (ตัดที่ช่องว่างแรก)
 *  ชื่อเดโมสั้นๆ ("นศ. ก") หรือไม่มีช่องว่าง → นามสกุลเป็นค่าว่าง ผู้เรียกไม่ต้องเช็คเอง */
export function splitPersonName(name: string): [string, string] {
  const v = name.replace(/\s+/g, ' ').trim();
  const i = v.indexOf(' ');
  // "นศ. ก" / "อ. ข." — จุดหลังคำนำหน้าแปลว่าเป็นชื่อเดโมแบบสั้น ไม่ต้องแยก
  if (i < 0 || /^(นศ|อ|ผู้ป่วย)\.?$/.test(v.slice(0, i))) return [v, ''];
  return [v.slice(0, i), v.slice(i + 1)];
}

/** ชื่อต้นแบบไม่มีคำนำหน้า — "นางสาวนิสรีน เจะกา" → "นิสรีน" · "นศ. Liv" → "Liv"
 *  ใช้ทักทายบนหน้านักศึกษา (ชื่อเต็มยาวจนขึ้นบรรทัดที่สอง — ผู้ใช้ขอ 2 ก.ย.) */
export function firstNameOnly(name: string): string {
  const [first] = splitPersonName(name);
  const stripped = first.replace(/^(นางสาว|น\.ส\.|นส\.|นาย|นาง|นศ\.|อ\.)\s*/, '').trim();
  return stripped || first;
}
