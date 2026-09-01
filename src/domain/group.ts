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
