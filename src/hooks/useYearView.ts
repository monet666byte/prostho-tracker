/**
 * ตัวกรองชั้นปีบนหน้าภาพรวมอาจารย์ (สรุปกลุ่ม + วิเคราะห์รวม)
 *
 * ทำไมต้องมี: หลักสูตร 2 ปี — ในคลินิกมีปี 5 กับปี 6 ปนกัน คำถามของอาจารย์
 * ต่างกันตามชั้นปี (ปี 6 ใกล้จบต้องเร่งใคร vs ปี 5 ใครสตาร์ทช้า)
 * เอาตัวเลขมาปนกันค่าเฉลี่ยจะหลอกตา — ฟีดแบคจากผู้ทดลองใช้ 1 ก.ย. 69
 *
 * ชั้นปีอ่านจาก studentYear() ของนักศึกษา (เลื่อนเองตามปีการศึกษา) ไม่ใช่จากรหัสกลุ่ม
 * จำตัวเลือกไว้ในเครื่อง ใช้ร่วมกันทั้งสองหน้า
 */
import { useState } from 'react';

/** 'alumni' = รุ่นที่เรียนจบไปแล้ว — ดูย้อนหลังได้ แก้ไม่ได้ (ภาคขอเก็บ ~5 ปี) */
export type YearView = '5' | '6' | 'all' | 'alumni';
const KEY = 'pt-yearview';

/**
 * @param fallback ค่าเริ่มต้นเมื่อยังไม่เคยเลือก — ปกติส่งปีของกลุ่มที่อาจารย์ดูแล
 *  (อาจารย์ที่ปรึกษาเปิดมาเจอปีตัวเองพอดี · "ทุกปี" เก็บไว้ให้หัวหน้าภาคกดเอง)
 *
 * ⚠️ fallback ต้อง "มีชีวิต" คืออ่านใหม่ทุกรอบ render ไม่ใช่จำค่าตอน mount
 * เพราะปีของกลุ่มต้องนับจากสมาชิก ซึ่งมาจาก useLiveQuery — รอบแรกลิสต์ยังว่าง
 * ถ้าไปแช่ค่าไว้ใน useState initializer จะได้ค่าจากลิสต์ว่างแล้วไม่มีวันแก้
 * เก็บเฉพาะ "ตัวที่ผู้ใช้กดเอง" เป็น state · ยังไม่กด = เดินตาม fallback ไปเรื่อยๆ
 */
export function useYearView(fallback: YearView = 'all'): [YearView, (v: YearView) => void] {
  const [picked, setPicked] = useState<YearView | null>(() => {
    try {
      const s = localStorage.getItem(KEY);
      return s === '5' || s === '6' || s === 'all' || s === 'alumni' ? s : null;
    } catch {
      return null;
    }
  });
  return [picked ?? fallback, (v) => {
    setPicked(v);
    try { localStorage.setItem(KEY, v); } catch { /* private mode — ไม่จำก็ไม่เป็นไร */ }
  }];
}
