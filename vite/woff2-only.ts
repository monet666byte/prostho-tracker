import type { Plugin } from 'vite';

/**
 * CSS ของ fontsource ประกาศ src เป็น woff2 ก่อนแล้วมี woff สำรอง
 * เบราว์เซอร์ที่รองรับ woff2 จะไม่แตะตัวสำรองเลย แต่ตัวสำรองยังถูกสร้างเป็นไฟล์
 * ตามไปด้วยทุกใบ (372 KB) และในโหมด share ถูกฝังเป็น base64 ลง index.html
 *
 * ตัดตัวสำรองทิ้งได้เพราะเบราว์เซอร์ที่ไม่รู้จัก woff2 (IE11, Safari 9, Android 4)
 * รันแอปนี้ไม่ได้อยู่แล้ว — บันเดิลมี await ระดับบนสุด ซึ่งต้อง Safari 15+ / Chrome 89+
 * ถ้าวันหน้าต้องรองรับเบราว์เซอร์เก่าจริง ให้ถอดปลั๊กอินนี้ออกก่อนเป็นอย่างแรก
 */
export function woff2Only(): Plugin {
  return {
    name: 'prostho:woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      // ตัดเฉพาะท่อน ", url(...) format('woff')" ที่ต่อท้าย woff2 — ไม่แตะบรรทัดที่มีแต่ woff
      const next = code.replace(/,\s*url\([^)]*\.woff\)\s*format\((['"])woff\1\)/g, '');
      return next === code ? null : { code: next, map: null };
    },
  };
}
