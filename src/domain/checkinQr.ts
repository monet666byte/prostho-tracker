/**
 * ตรวจสิ่งที่นักศึกษาสแกน (หรือพิมพ์) ตอนเช็คอินคาบ เมื่อภาคเปิดสวิตช์ "เช็คอินต้องสแกน QR"
 *
 * ⚠️ ยังไม่รู้ว่า QR หน้าห้องจะออกโดยระบบของคณะหรือโดยแอปนี้ — ตอนนี้จึงตรวจแค่รูปแบบ:
 *    QR อะไรก็ได้ที่อ่านออก · รหัสที่พิมพ์ต้องเป็นตัวเลข 6 หลัก
 *    ยังกันการสแกน QR อื่นที่ไม่ใช่ของหน้าห้องไม่ได้
 * ได้คำตอบเรื่องผู้ออก QR แล้วเปลี่ยนที่ฟังก์ชันนี้ที่เดียว — หน้าจอสแกนเรียกตัวนี้ตัวเดียว
 */

export type CheckinCodeVerdict = { ok: true; code: string } | { ok: false; reason: 'empty' | 'format' };

/** รหัสที่พิมพ์เอง — ตัวเลข 6 หลัก (ยอมให้มีช่องว่าง/ขีดคั่น เพราะจอแสดงเป็น "482 917") */
export const TYPED_CODE_LENGTH = 6;

export function checkCheckinCode(raw: string, via: 'qr' | 'typed'): CheckinCodeVerdict {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (via === 'typed') {
    const digits = text.replace(/[\s-]/g, '');
    if (!new RegExp(`^\\d{${TYPED_CODE_LENGTH}}$`).test(digits)) return { ok: false, reason: 'format' };
    return { ok: true, code: digits };
  }
  return { ok: true, code: text };
}
