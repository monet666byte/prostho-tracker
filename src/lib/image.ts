/**
 * บีบอัดรูปฝั่งเครื่องก่อนเก็บ
 *
 * ทำไมต้องบีบ: รูปจากกล้องมือถือใบละ 3–8 MB ถ้าเก็บดิบๆ จะกินพื้นที่เครื่อง
 * และตอน sync ขึ้นเซิร์ฟเวอร์จะช้ามาก (แผนฟรีมีพื้นที่จำกัด) รูปงานทันตกรรม
 * ใช้ดูความคืบหน้า ไม่ต้องละเอียดระดับวินิจฉัย ด้านยาว 1280 px ก็เกินพอ
 *
 * คืนเป็น Blob ไม่ใช่ data URL: ปลายทางคือ Supabase Storage ซึ่งรับ Blob ตรงๆ
 * ถ้าแปลงเป็น base64 ก่อนจะพองขึ้น 33% แล้วต้องแปลงกลับตอนอัป เสียเปล่าสองต่อ
 * (ของเดิมเก็บ data URL ในแถวเดียวกับ metadata ทำให้ base64 วิ่งขึ้น-ลง Postgres ทุกรอบ sync)
 */

/** ด้านยาวสุดที่ยอมให้ (px) */
const MAX_EDGE = 1280;
/** ถ้าบีบแล้วยังใหญ่กว่านี้ ลดคุณภาพลงอีกเป็นขั้นๆ */
const TARGET_BYTES = 320 * 1024;
/** เพดานแข็ง — ใหญ่กว่านี้ไม่รับ กัน sync พัง */
export const HARD_LIMIT_BYTES = 900 * 1024;

export interface CompressedImage {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
}

/**
 * ขนาดไฟล์โดยประมาณจากความยาว data URL (base64 พองขึ้น ~4/3)
 * ยังต้องมีอยู่ — ใช้กับรูปเก่าที่ยังเป็น data URL ตอนย้ายขึ้น storage (ดู photoStore.ts)
 */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function loadBitmap(file: File): Promise<{ w: number; h: number; draw: (c: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  // createImageBitmap เร็วกว่าและหมุนรูปตาม EXIF ให้เอง (รูปแนวตั้งจากมือถือจะไม่ตะแคง)
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    return {
      w: bmp.width, h: bmp.height,
      draw: (c, w, h) => c.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close(),
    };
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = () => rej(new Error('เปิดไฟล์รูปไม่ได้'));
    el.src = url;
  });
  return {
    w: img.naturalWidth, h: img.naturalHeight,
    draw: (c, w, h) => c.drawImage(img, 0, 0, w, h),
    close: () => URL.revokeObjectURL(url),
  };
}

/** canvas.toBlob เป็น callback — ห่อเป็น promise · คืน null ถ้าเบราว์เซอร์เข้ารหัสไม่ได้ */
function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
}

/**
 * บีบรูปให้เล็กลงจนอยู่ในงบ — คืน null ถ้าไฟล์ไม่ใช่รูปหรือบีบไม่ลง
 */
export async function compressImage(file: File): Promise<CompressedImage | null> {
  if (!file.type.startsWith('image/')) return null;

  const src = await loadBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(src.w, src.h));
    const w = Math.max(1, Math.round(src.w * scale));
    const h = Math.max(1, Math.round(src.h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // รูปงานมักถ่ายในปาก พื้นหลังขาวช่วยให้ JPEG ไม่มีขอบดำถ้าไฟล์ต้นทางโปร่งใส
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    src.draw(ctx, w, h);

    let quality = 0.72;
    let blob = await toBlob(canvas, quality);
    // ลดคุณภาพทีละขั้นจนพอดีงบ (อย่างมาก 4 รอบ กันวนนาน)
    for (let i = 0; i < 4 && blob && blob.size > TARGET_BYTES && quality > 0.35; i++) {
      quality -= 0.1;
      blob = await toBlob(canvas, quality);
    }
    if (!blob || blob.size > HARD_LIMIT_BYTES) return null;
    return { blob, bytes: blob.size, width: w, height: h };
  } finally {
    src.close();
  }
}

/** แปลง data URL เก่าเป็น Blob — ใช้ตอนย้ายรูปที่ค้างอยู่ในเครื่องผู้ใช้ขึ้น storage */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const mime = /data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
  try {
    const bin = atob(dataUrl.slice(comma + 1));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  } catch {
    // base64 เสีย (ถูกตัดกลางทางตอน sync สมัยที่ยังส่งทั้งก้อน) — คืน null ให้ผู้เรียกกักไว้
    return null;
  }
}
