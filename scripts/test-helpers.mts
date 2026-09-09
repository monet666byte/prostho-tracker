/**
 * ของใช้ร่วมของเทสต์ทุกชุด — ไม่ใช่เทสต์เอง ไม่มี script ใน package.json
 *
 * เดิม readDefaultSettings() อยู่ใน test-rules.mts ไฟล์เดียว พอมีเทสต์ชุดที่ 4-7
 * ถ้าก๊อปไปไว้ทุกไฟล์ วันที่ภาคเปลี่ยนรูปแบบ seed.ts จะต้องไล่แก้ 5 ที่
 * แล้วที่ลืมแก้จะยังผ่านอยู่ทั้งที่อ่านค่าจริงไม่ได้แล้ว — ย้ายมาไว้ที่เดียว
 */
import { readFileSync } from 'node:fs';
import type { Settings } from '../src/domain/types.ts';

/**
 * ค่าตั้งต้นจริงจาก data/seed.ts — อ่านเป็นข้อความแล้ว eval แทนการ import
 *
 * import ตรงๆ ไม่ได้เพราะ seed.ts ลาก lib/cloud.ts กับ data/db.ts (Dexie/IndexedDB)
 * ซึ่งเป็นของฝั่งเบราว์เซอร์ล้วน รันใน node ไม่ได้
 * แต่ก็ไม่ยอมพิมพ์ค่าซ้ำไว้ในเทสต์ — ถ้าภาคเปลี่ยนเกณฑ์แล้วเทสต์ยังยึดเลขเก่า
 * เทสต์จะผ่านทั้งที่ไม่ตรงของจริง ซึ่งแย่กว่าไม่มีเทสต์
 */
export function readDefaultSettings(): Settings {
  const src = readFileSync(new URL('../src/data/seed.ts', import.meta.url), 'utf8');
  const start = src.indexOf('export const DEFAULT_SETTINGS');
  const open = src.indexOf('{', start);
  if (start < 0 || open < 0) throw new Error('หา DEFAULT_SETTINGS ใน seed.ts ไม่เจอ — แก้ readDefaultSettings()');
  let depth = 0, end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  // ปลอดภัยพอ: อ่านไฟล์ในรีโปตัวเอง และสคริปต์นี้รันมือในเครื่อง dev เท่านั้น
  // (ใช้ JSON.parse ไม่ได้ — ในลิเทอรัลมีคอมเมนต์ คีย์ไม่มีเครื่องหมายคำพูด และ trailing comma)
  // oxlint-disable-next-line no-eval
  return (0, eval)('(' + src.slice(open, end + 1) + ')') as Settings;
}
