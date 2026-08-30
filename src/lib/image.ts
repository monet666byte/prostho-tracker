/**
 * บีบอัดรูปฝั่งเครื่องก่อนเก็บ
 *
 * ทำไมต้องบีบ: รูปจากกล้องมือถือใบละ 3–8 MB ถ้าเก็บดิบๆ จะกินพื้นที่เครื่อง
 * และตอน sync ขึ้นเซิร์ฟเวอร์จะช้ามาก (แผนฟรีมีพื้นที่จำกัด) รูปงานทันตกรรม
 * ใช้ดูความคืบหน้า ไม่ต้องละเอียดระดับวินิจฉัย ด้านยาว 1280 px ก็เกินพอ
 *
 * หมายเหตุสำหรับอนาคต: ตอนนี้เก็บเป็น data URL ในตารางเดียวกับข้อมูลอื่น
 * ซึ่งพอสำหรับกลุ่มทดลอง แต่ถ้าขยายเป็น 96 คนควรย้ายไป Supabase Storage
 * (เก็บไฟล์แยก เหลือแค่ลิงก์ในตาราง) — ดู TODO ใน repo.addPhoto
 */

/** ด้านยาวสุดที่ยอมให้ (px) */
const MAX_EDGE = 1280;
/** ถ้าบีบแล้วยังใหญ่กว่านี้ ลดคุณภาพลงอีกเป็นขั้นๆ */
const TARGET_BYTES = 320 * 1024;
/** เพดานแข็ง — ใหญ่กว่านี้ไม่รับ กัน sync พัง */
export const HARD_LIMIT_BYTES = 900 * 1024;

export interface CompressedImage {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
}

/** ขนาดไฟล์โดยประมาณจากความยาว data URL (base64 พองขึ้น ~4/3) */
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
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let bytes = dataUrlBytes(dataUrl);
    // ลดคุณภาพทีละขั้นจนพอดีงบ (อย่างมาก 4 รอบ กันวนนาน)
    for (let i = 0; i < 4 && bytes > TARGET_BYTES && quality > 0.35; i++) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      bytes = dataUrlBytes(dataUrl);
    }
    if (bytes > HARD_LIMIT_BYTES) return null;
    return { dataUrl, bytes, width: w, height: h };
  } finally {
    src.close();
  }
}
