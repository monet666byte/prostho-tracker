/**
 * รหัสกลุ่มคลินิก — แต่ละชั้นปีมี PT1–PT12 ของตัวเอง (ผู้ใช้ยืนยัน 1 ก.ย. 69)
 * ชื่อกลุ่มซ้ำกันข้ามรุ่นได้ รหัสในระบบจึงมี prefix กำกับ และตอนนี้มีสองแบบปนกัน:
 *   ข้อมูลตัวอย่าง/ของเดิม → 'TH-PT7' (ปี 5), 'TH6-PT7' (ปี 6), 'TH7-…' (จบแล้ว)  = ตัวเลขคือ "ชั้นปี"
 *   รายชื่อที่นำเข้าจริง    → 'TH55-PT7'                                          = ตัวเลขคือ "เลขรุ่น DTMU"
 *
 * ⚠️ ห้ามอ่านชั้นปีจากรหัสกลุ่มเด็ดขาด — ตัวเลขในสองแบบนี้คนละความหมายกัน
 * เคยมี groupYear() ที่ทำแบบนั้น พอนำเข้ารายชื่อจริงมันอ่าน 'TH55-' ได้ว่า "ชั้นปีที่ 55"
 * แล้วส่งค่านั้นไปตั้งแท็บเริ่มต้นของหน้าอาจารย์ ซึ่งไม่มีแท็บไหนตรง = เปิดมาเจอหน้าว่าง
 *
 * ชั้นปีมาจาก studentYear() ของสมาชิกเสมอ (ดู domain/cohort.ts) ซึ่งเลื่อนเองตามปีการศึกษา
 * ต่างจากรหัสกลุ่มที่แช่แข็งอยู่กับที่ตอนสร้าง — กลุ่มเดิมจะมีสมาชิกเป็นปี 6 ทั้งกลุ่มเมื่อขึ้นปีใหม่
 */
import type { Student } from './types';
import { studentYear } from './cohort';

/** 'TH-PT7' / 'TH6-PT7' / 'TH55-PT7' → 'PT7' — ใช้ทุกจุดที่โชว์ชื่อกลุ่ม (ครอบทั้งสองแบบ) */
export function groupShort(code: string | undefined): string {
  return (code ?? '').replace(/^TH\d*-/, '');
}

/**
 * ชั้นปีของกลุ่ม = ชั้นปีที่พบมากสุดของสมาชิก · ไม่มีสมาชิก/ไม่รู้จักกลุ่ม = undefined
 *
 * ใช้ตอนอยากรู้ว่า "กลุ่มที่อาจารย์คนนี้ดูแล ตอนนี้เป็นปีอะไร" เช่นตั้งแท็บเริ่มต้น
 * นับเสียงข้างมากเพราะกลุ่มหนึ่งอาจมีคนซ้ำชั้นปนอยู่ (เหตุผลเดียวกับ modeYear ใน aggregate.ts)
 */
export function groupYearOf(
  code: string | undefined,
  students: ReadonlyArray<Pick<Student, 'group' | 'year' | 'entryYear'>>,
  asOf: Date = new Date(),
): number | undefined {
  if (!code) return undefined;
  const tally = new Map<number, number>();
  for (const s of students) {
    if (s.group !== code) continue;
    const y = studentYear(s, asOf);
    tally.set(y, (tally.get(y) ?? 0) + 1);
  }
  let best: number | undefined;
  let most = 0;
  for (const [y, n] of tally) if (n > most) { most = n; best = y; }
  return best;
}

/** แยก "นายสมชาย ใจดี" → ["นายสมชาย", "ใจดี"] (ตัดที่ช่องว่างแรก)
 *  ชื่อเดโมสั้นๆ ("นศ. ก") หรือไม่มีช่องว่าง → นามสกุลเป็นค่าว่าง ผู้เรียกไม่ต้องเช็คเอง */
export function splitPersonName(name: string): [string, string] {
  const v = name.replace(/\s+/g, ' ').trim();
  const i = v.indexOf(' ');
  // "นศ. ก" / "อ. ข." — จุดหลังคำนำหน้าแปลว่าเป็นชื่อเดโมแบบสั้น ไม่ต้องแยก
  if (i < 0 || /^(นศ|อ|ผู้ป่วย)\.?$/.test(v.slice(0, i))) return [v, ''];
  return [v.slice(0, i), v.slice(i + 1)];
}

/** ชื่อต้นแบบไม่มีคำนำหน้า — "นางสาวสมหญิง ใจดี" → "สมหญิง" · "นศ. Liv" → "Liv"
 *  ใช้ทักทายบนหน้านักศึกษา (ชื่อเต็มยาวจนขึ้นบรรทัดที่สอง — ผู้ใช้ขอ 2 ก.ย.) */
export function firstNameOnly(name: string): string {
  const [first] = splitPersonName(name);
  const stripped = first.replace(/^(นางสาว|น\.ส\.|นส\.|นาย|นาง|นศ\.|อ\.)\s*/, '').trim();
  return stripped || first;
}
