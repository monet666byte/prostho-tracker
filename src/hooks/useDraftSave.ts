/**
 * บันทึกร่างอัตโนมัติแบบหน่วงเวลา + บังคับเซฟตอนออกจากหน้า
 *
 * ที่มา: ตอนทำแบบประเมินตนเองเคยเจอว่า debounce อย่างเดียวไม่พอ —
 * ผู้ใช้พิมพ์แล้วกดออกภายในไม่ถึงวินาที ของที่ค้างใน timer หายไปทั้งก้อน
 * ต้อง flush ตอน unmount / pagehide / สลับแท็บด้วยเสมอ
 *
 * ใช้กับใบประเมินสมุด portfolio: อาจารย์กาไป 4 จาก 6 ข้อแล้วมีคนไข้เรียก
 * กดออกจากใบ ของต้องยังอยู่
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export function useDraftSave(save: () => void | Promise<void>, delay = 700) {
  /* เก็บ closure ล่าสุดไว้ใน ref — ไม่งั้น flush ตอน unmount จะเซฟค่าเก่า
     เขียนใน layout effect ไม่ใช่ตอน render: การเขียน ref ระหว่าง render ไม่บริสุทธิ์
     ถ้า React ทิ้ง render นั้นไป (concurrent) ref จะค้างค่าที่ไม่เคยถูก commit
     layout effect ทำงานหลัง commit และก่อน cleanup ของรอบเดียวกัน ค่าจึงตรงเสมอ */
  const saveRef = useRef(save);
  useLayoutEffect(() => { saveRef.current = save; });
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current) return;
    dirty.current = false;
    void saveRef.current();
  }, []);

  const touch = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [flush, delay]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  /** ทิ้งร่างที่ค้างอยู่โดยไม่เซฟ — ใช้ตอนกด "บันทึก" จริง
      ถ้าปล่อยให้ flush ทำงานคู่กับ save จริง จะแข่งกันสร้างแถวซ้ำ
      เพราะ flush ไม่ได้ await ตัว save จริงจึงอ่าน id ที่ยังไม่ทันถูกตั้ง */
  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    dirty.current = false;
  }, []);

  return { touch, flush, cancel };
}
