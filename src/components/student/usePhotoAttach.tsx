/**
 * แนบรูปงาน — ใช้ร่วมกันทุกที่ที่มีปุ่มแนบรูป (หน้ารูปต่อ step และหน้ารายละเอียดชิ้นงาน)
 *
 * รวมไว้ที่เดียวเพราะมี 3 จุดที่แนบรูปได้ ถ้าก๊อปโค้ดไปวางจะหลุดไม่พร้อมกันแน่นอน
 * — บทเรียนจาก ToastView ที่อยู่แค่ฝั่งนักศึกษาไฟล์เดียว ฝั่งอาจารย์เลยไม่มี
 *
 * ⚠️ ข้อความที่ขึ้นตอนจบต้องอิงผลจริงของการอัปโหลด ไม่ใช่ "แนบสำเร็จ = ขึ้นแล้ว"
 *    ระบบนี้เคยขึ้นว่าอัปโหลดแล้วทั้งที่ไม่มีรูปอยู่จริงมาสองรอบ จึงนับจาก
 *    countUploadedPhotos() ซึ่งอ่าน storagePath (หลักฐาน) ไม่ใช่ status (คำอ้าง)
 */
import { useRef, useState } from 'react';
import { addPhoto, countUploadedPhotos } from '../../data/repo';
import { uploadPendingPhotos } from '../../data/photoStore';
import { compressImage } from '../../lib/image';
import { cloudEnabled } from '../../lib/cloud';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

interface Options {
  /** true = เปิดกล้องเลย (มือถือ) · false = เลือกจากคลังรูป เลือกหลายใบได้ */
  camera?: boolean;
}

export function usePhotoAttach(workpieceId: string | undefined, opts: Options = {}) {
  const { offline, showToast, touch } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  /** แยกจาก busy เพื่อให้ปุ่มบอกได้ว่ากำลังทำอะไรอยู่ — ย่อรูปเร็ว แต่ส่งขึ้นเน็ตคลินิกช้า */
  const [uploading, setUploading] = useState(false);

  async function handle(files: FileList | null) {
    if (!workpieceId) {
      showToast({ message: t('ยังไม่มีชิ้นงานที่กำลังทำ — สร้างชิ้นงานก่อนแนบรูป'), tone: 'warning' });
      return;
    }
    if (!files?.length) return;
    setBusy(true);
    const made: string[] = [];
    let bad = 0;
    try {
      for (const file of Array.from(files)) {
        // ไฟล์เสีย/รูปแบบแปลก ทำให้ทั้งชุดล้มได้ — ให้ล้มทีละใบแล้วไปต่อ
        try {
          const img = await compressImage(file);
          if (!img) { bad++; continue; }
          const photo = await addPhoto(workpieceId, img);
          if (photo) made.push(photo.id);
          else bad++;
        } catch (e) {
          console.error('แนบรูปไม่สำเร็จ', file.name, e);
          bad++;
        }
      }

      /* ไบต์ลงเครื่องครบแล้วตั้งแต่ addPhoto — ถึงตรงนี้ล้มยังไงรูปก็ไม่หาย
         ส่งขึ้นเลยตอนออนไลน์ เพื่อให้ข้อความที่ขึ้นบอกความจริง ณ วินาทีนั้น
         (ออฟไลน์ไม่ต้องรอ — คิวจะพาขึ้นเองตอนเน็ตกลับมา) */
      if (made.length && !offline && cloudEnabled) {
        setUploading(true);
        try {
          await uploadPendingPhotos();
        } finally {
          setUploading(false);
        }
      }
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';   // เลือกไฟล์เดิมซ้ำได้
    }
    touch();

    const ok = made.length;
    if (bad && !ok) {
      showToast({ message: t('ใช้ไฟล์นี้ไม่ได้ — ต้องเป็นไฟล์รูป และไม่ใหญ่เกินไป'), tone: 'warning' });
      return;
    }
    if (!ok) return;

    const tail = bad ? t(' · อีก {b} รูปใช้ไม่ได้', { b: bad }) : '';
    if (!cloudEnabled) {
      // เดโม/แชร์/GitHub Pages — ไม่มีเซิร์ฟเวอร์ให้ส่ง พูดตามนั้น
      showToast({ message: t('เก็บรูปในเครื่องนี้แล้ว {n} รูป', { n: ok }) + tail, tone: bad ? 'warning' : 'default' });
      return;
    }
    if (offline) {
      showToast({ message: t('เก็บรูปในเครื่องแล้ว {n} รูป · จะส่งขึ้นเองเมื่อเน็ตกลับมา', { n: ok }) + tail, tone: 'warning' });
      return;
    }
    const up = await countUploadedPhotos(made);
    if (up === ok) {
      showToast({ message: t('ส่งรูปขึ้นเซิร์ฟเวอร์แล้ว {n} รูป', { n: ok }) + tail, tone: bad ? 'warning' : 'success' });
    } else {
      // ส่งไม่ครบต้องบอก ไม่ใช่ปัดเป็นสำเร็จ — รายละเอียดว่าทำไมอยู่ที่หน้า sync
      showToast({
        message: t('เก็บรูปในเครื่องแล้ว {n} รูป · ยังส่งขึ้นเซิร์ฟเวอร์ไม่ได้ {q} รูป', { n: ok, q: ok - up }),
        tone: 'warning',
      });
    }
  }

  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      {...(opts.camera ? { capture: 'environment' as const } : { multiple: true })}
      hidden
      onChange={(e) => void handle(e.target.files)}
    />
  );

  return { input, open: () => ref.current?.click(), busy, uploading };
}
