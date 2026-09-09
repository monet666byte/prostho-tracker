/**
 * ปิดบังตัวตนผู้ป่วย (PDPA) — เครื่องมือกลาง ยังไม่ได้ต่อเข้าหน้าจอไหน
 *
 * ⚠️ สถานะ 9 ก.ย. 69: ไฟล์นี้ถูกใช้แล้วเฉพาะฝั่ง "ส่งออก" (lib/export.ts)
 *    ส่วนการปิดบังในหน้าจอยังรอผู้ใช้เคาะว่าหน้าไหนควรเห็นอะไร (ดู README หัวข้อ PDPA)
 *    ตั้งใจแยกไฟล์ไว้ก่อน เพราะพอเคาะแล้วจะได้แก้ที่หน้าจออย่างเดียว ไม่ต้องคิดกติกาใหม่
 *
 * หลักที่ยึด
 *   · "รหัสเคส" ต้องคงที่ตลอดอายุข้อมูล — อาจารย์ต้องจับคู่แถวข้ามหน้าได้โดยไม่ต้องเห็นชื่อ
 *   · รหัสคำนวณจาก id ภายในของผู้ป่วย ไม่ใช่จาก HN — ถ้าคำนวณจาก HN
 *     คนที่รู้ HN ของคนไข้คนหนึ่งจะเดาได้ว่าแถวไหนคือคนนั้น (rainbow table ทำง่ายมาก
 *     เพราะ HN เป็นเลขไม่กี่หลัก) การใช้ id ภายในตัดทางนั้นทิ้ง
 *   · รหัสเคส "ไม่ใช่" ข้อมูลนิรนาม — มันคือนามแฝง ยังนับเป็นข้อมูลส่วนบุคคลตาม PDPA
 *     ประโยชน์คือลดคนที่เห็นชื่อจริงลงเหลือเท่าที่จำเป็น ไม่ใช่ทำให้ข้อมูลหลุดกรอบกฎหมาย
 */

/** ตัวอักษรที่อ่านออกเสียงแล้วไม่กำกวม — ตัด I, L, O, U ทิ้ง (สับสนกับ 1, 0, V) */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * รหัสเคสที่ใช้แทนชื่อ/HN ในหน้าที่ไม่จำเป็นต้องรู้ว่าเป็นใคร
 * รูปแบบ "PT-XXXXX" — 5 ตัวจาก 32 ตัวอักษร = 33 ล้านค่า
 * ทั้งภาคมีผู้ป่วยหลักพัน โอกาสชนกันจึงต่ำกว่าหนึ่งในหมื่น (birthday bound)
 */
export function caseCode(patientId: string): string {
  let h = fnv1a(patientId);
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += ALPHABET[h % ALPHABET.length];
    h = Math.floor(h / ALPHABET.length) + fnv1a(out) % 97;
  }
  return `PT-${out}`;
}

/**
 * ชื่อแบบย่อ — เก็บอักษรตัวแรกของแต่ละคำ เช่น "สมชาย ใจดี" → "ส. ใ."
 * ใช้ในหน้าที่ต้องแยกคนสองคนที่รหัสเคสอยู่ติดกัน แต่ยังไม่ควรเห็นชื่อเต็ม
 */
export function maskedName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return parts.map((w) => `${[...w][0]}.`).join(' ');
}

/**
 * HN แบบปิดบัง — ปิดทั้งหมด ไม่โชว์ท้าย 4 ตัว
 * เหตุผล: ในคลินิกเดียว HN ท้าย 4 ตัวแทบจะระบุตัวคนได้แล้ว การโชว์บางส่วน
 * ให้ความรู้สึกปลอดภัยโดยไม่ได้ปลอดภัยจริง — ถ้าต้องเห็น ให้เห็นทั้งหมดไปเลย
 */
export function maskedHn(hn: string): string {
  return hn ? '••••••' : '';
}

/** ระดับที่หน้าจอ/ไฟล์หนึ่งได้เห็น */
export type IdentityLevel =
  | 'code'      // เห็นแค่รหัสเคส — หน้าภาพรวม / วิเคราะห์ / สรุปกลุ่ม
  | 'initials'  // รหัสเคส + อักษรย่อชื่อ — หน้าที่ต้องแยกคนแต่ยังไม่ต้องรู้ว่าใคร
  | 'full';     // ชื่อเต็ม + HN — หน้าที่ทำงานกับเคสตรงๆ

export interface PatientLike {
  id: string;
  name: string;
  hn: string;
}

/** ป้ายชื่อผู้ป่วยตามระดับสิทธิ์ของหน้านั้น — จุดเดียวที่ตัดสินว่าจะโชว์อะไร */
export function patientLabel(p: PatientLike, level: IdentityLevel): { name: string; hn: string } {
  if (level === 'full') return { name: p.name, hn: p.hn };
  if (level === 'initials') return { name: `${caseCode(p.id)} · ${maskedName(p.name)}`, hn: maskedHn(p.hn) };
  return { name: caseCode(p.id), hn: maskedHn(p.hn) };
}
