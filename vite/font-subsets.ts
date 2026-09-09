import type { Plugin } from 'vite';

/**
 * ตัดชุดอักขระที่แอปไม่มีทางแสดงถึงออกจาก CSS ของ fontsource
 *
 * เบราว์เซอร์ไม่โหลดไฟล์พวกนี้อยู่แล้วเพราะติด unicode-range แต่ไฟล์ยังถูกสร้าง
 * ตามไปครบ (154 KB) แล้ว service worker แคชล่วงหน้าตาม glob (**\/*.woff2)
 * — กลายเป็นเน็ตของการเปิดครั้งแรกที่เสียไปฟรี ๆ · โหมด share ยิ่งหนัก เพราะฝังเป็น base64
 *
 * ⚠️ ทำที่ไฟล์รวม (400.css) ไม่ใช่เรียก latin-400.css รายชุดแทน —
 * ไฟล์รายชุดของ fontsource **ไม่มี unicode-range** ทำให้ face ครอบทุกอักขระ
 * แล้ว face ที่ประกาศทีหลังชนะทั้งหมด ตัวอักษรละตินเลยไปหยิบจากไฟล์ไทย
 * (เคยลองแล้วภาพเพี้ยนจริง วัดได้ 41 พิกเซลในหน้าคนไข้)
 * วิธีนี้เก็บทั้ง unicode-range และลำดับการประกาศไว้เหมือนเดิมเป๊ะ
 */
const DROP = ['cyrillic', 'cyrillic-ext', 'vietnamese'];

export function fontSubsets(): Plugin {
  return {
    name: 'prostho:font-subsets',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      let dropped = 0;
      const next = code.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
        const file = block.match(/url\([^)]*\/([a-z0-9-]+)-(\d+)-normal\.woff2?\)/i)?.[1];
        if (!file) return block;
        // ชื่อไฟล์คือ <ตระกูล>-<ชุดอักขระ> — ตัดเฉพาะที่ลงท้ายด้วยชุดที่ไม่ใช้
        if (!DROP.some((s) => file.endsWith('-' + s))) return block;
        dropped++;
        return '';
      });
      return dropped ? { code: next, map: null } : null;
    },
  };
}
