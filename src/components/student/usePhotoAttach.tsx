/**
 * แนบรูปงาน — ใช้ร่วมกันทุกที่ที่มีปุ่มแนบรูป (หน้ารูปต่อ step และหน้ารายละเอียดชิ้นงาน)
 *
 * รวมไว้ที่เดียวเพราะมี 3 จุดที่แนบรูปได้ ถ้าก๊อปโค้ดไปวางจะหลุดไม่พร้อมกันแน่นอน
 * — บทเรียนจาก ToastView ที่อยู่แค่ฝั่งนักศึกษาไฟล์เดียว ฝั่งอาจารย์เลยไม่มี
 */
import { useRef, useState } from 'react';
import { addPhoto } from '../../data/repo';
import { compressImage } from '../../lib/image';
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

  async function handle(files: FileList | null) {
    if (!workpieceId) {
      showToast({ message: t('ยังไม่มีชิ้นงานที่กำลังทำ — สร้างชิ้นงานก่อนแนบรูป'), tone: 'warning' });
      return;
    }
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    let bad = 0;
    try {
      for (const file of Array.from(files)) {
        const img = await compressImage(file);
        if (!img) { bad++; continue; }
        await addPhoto(workpieceId, offline, img);
        ok++;
      }
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';   // เลือกไฟล์เดิมซ้ำได้
    }
    touch();
    if (ok && bad) {
      showToast({ message: t('เก็บรูปแล้ว {n} รูป · อีก {b} รูปใช้ไม่ได้', { n: ok, b: bad }), tone: 'warning' });
    } else if (bad) {
      showToast({ message: t('ใช้ไฟล์นี้ไม่ได้ — ต้องเป็นไฟล์รูป และไม่ใหญ่เกินไป'), tone: 'warning' });
    } else if (ok) {
      showToast({
        message: offline
          ? t('เก็บรูปในเครื่องแล้ว {n} รูป · จะส่งขึ้นเองเมื่อเน็ตกลับมา', { n: ok })
          : t('เก็บรูปแล้ว {n} รูป', { n: ok }),
        tone: offline ? 'warning' : 'default',
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

  return { input, open: () => ref.current?.click(), busy };
}
