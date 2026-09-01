/**
 * ตัวกรองชั้นปีบนหน้าภาพรวมอาจารย์ (สรุปกลุ่ม + วิเคราะห์รวม)
 *
 * ทำไมต้องมี: หลักสูตร 2 ปี — ในคลินิกมีปี 5 กับปี 6 ปนกัน คำถามของอาจารย์
 * ต่างกันตามชั้นปี (ปี 6 ใกล้จบต้องเร่งใคร vs ปี 5 ใครสตาร์ทช้า)
 * เอาตัวเลขมาปนกันค่าเฉลี่ยจะหลอกตา — ฟีดแบคจากผู้ทดลองใช้ 1 ก.ย. 69
 *
 * ชั้นปีอ่านจาก student.year (มาจาก roster — แหล่งความจริงตามที่ตกลง)
 * จำตัวเลือกไว้ในเครื่อง ใช้ร่วมกันทั้งสองหน้า
 */
import { useState } from 'react';

export type YearView = '5' | '6' | 'all';
const KEY = 'pt-yearview';

export function useYearView(): [YearView, (v: YearView) => void] {
  const [view, setView] = useState<YearView>(() => {
    try {
      const s = localStorage.getItem(KEY);
      return s === '5' || s === '6' || s === 'all' ? s : 'all';
    } catch {
      return 'all';
    }
  });
  return [view, (v) => {
    setView(v);
    try { localStorage.setItem(KEY, v); } catch { /* private mode — ไม่จำก็ไม่เป็นไร */ }
  }];
}
