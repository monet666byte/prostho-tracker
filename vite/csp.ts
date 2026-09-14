import type { Plugin } from 'vite';

/**
 * ใส่ Content-Security-Policy กับ Referrer-Policy ลง index.html ตอน build
 *
 * ทำไมทำที่ตัวแอป ไม่รอฝั่งโฮสต์: แอปนี้เสิร์ฟเป็นไฟล์นิ่ง ๆ (GitHub Pages / โฮสต์ของคณะ)
 * ซึ่งเราตั้ง HTTP header เองไม่ได้ · CSP ผ่าน <meta http-equiv> ทำงานได้จริงเกือบทุกข้อ
 *
 * ⚠️ สองอย่างที่ทำผ่าน meta **ไม่ได้** ต้องเป็น header จริงเท่านั้น:
 *    · `frame-ancestors` (กันคนเอาแอปไปฝังใน iframe ของเว็บอื่น)
 *    · `Permissions-Policy` (ปิดกล้อง/ไมค์/ตำแหน่งที่ไม่ได้ใช้)
 *    ถ้าวันหน้าได้โฮสต์ที่ตั้ง header ได้ ให้ย้ายทั้งชุดไปที่นั่นแล้วเพิ่มสองข้อนี้
 *
 * ⚠️ ข้ามโหมด share: build นั้นรวมทุกอย่างเป็นไฟล์เดียว สคริปต์จึงเป็น inline ล้วน
 *    ถ้าจะให้ผ่าน CSP ต้องเปิด `script-src 'unsafe-inline'` ซึ่งทำให้ CSP เกือบไร้ความหมาย
 *    — ยอมไม่ใส่ในเดโมดีกว่าใส่แบบหลอกตัวเอง (และตัวเดโมถูก sandbox ของ artifact ครอบอยู่แล้ว)
 */
export function cspMeta({ skip = false }: { skip?: boolean } = {}): Plugin {
  /* style-src ต้องมี 'unsafe-inline' เพราะทั้งแอปใช้ style={{…}} ของ React
     ซึ่งเป็น inline style attribute · ความเสี่ยงต่ำกว่า inline script มาก
     img-src ต้องมี blob: (รูปงานที่ถ่ายมาแสดงผ่าน object URL) และ data: (ไอคอนที่ฝังมา)
     และ https://*.supabase.co — เครื่องที่ไม่มีสำเนารูปในเครื่อง (อาจารย์ · นศ. เครื่องที่สอง) แสดงรูปจากลิงก์ที่เซ็นแล้ว
     ของบักเก็ต case-photos (photoStore.resolvePhotoSrc) · เดิมไม่มี = รูปงานไม่ขึ้นเลยบนเว็บจริง
     ทุกเทสต์ในเบราว์เซอร์ใช้ bypassCSP จึงไม่มีใครเห็น (เจอ 14 ก.ย. 69 · test:photos ตรวจแล้ว)
     connect-src เปิดให้ *.supabase.co ทั้ง https และ wss (realtime ใช้ websocket) */
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  return {
    name: 'prostho-csp-meta',
    apply: 'build',
    transformIndexHtml(html: string) {
      if (skip) return html;
      const tags = [
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        '<meta name="referrer" content="strict-origin-when-cross-origin" />',
      ].join('\n    ');
      return html.replace('</head>', `  ${tags}\n  </head>`);
    },
  };
}
