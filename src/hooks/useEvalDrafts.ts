import { useCallback, useEffect, useState } from 'react';

type Drafts = Record<string, Record<string, number>>;

/**
 * คะแนนที่แตะไว้แต่ยังไม่ลงนาม — เดิมอยู่ในหน้าจออย่างเดียว กดกลับ/ปัดย้อนบน iPhone แล้วหายหมดโดยไม่เตือน
 * ตอนนี้เก็บใน sessionStorage ของแท็บนี้ แยกตามอาจารย์ + กลุ่ม (อาจารย์อีกท่านล็อกอินเครื่องเดียวกันไม่เห็นของกัน)
 * เก็บแค่ id คาบกับเลขคะแนน ไม่มีชื่อ/HN · อ่านเขียนไม่ได้ (โหมดส่วนตัว) = ทำงานแบบเดิม ไม่พัง
 * ลงนามแล้ว/คาบถูกประเมินโดยคนอื่น หน้าประเมินลบออกเอง
 */
function read(key: string): Drafts {
  try {
    const raw = sessionStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Drafts) : {};
  } catch {
    return {};
  }
}

export function useEvalDrafts(teacherId: string | undefined, group: string) {
  const key = `pt-eval-drafts:${teacherId ?? 'local'}:${group}`;
  const [state, setState] = useState(() => ({ key, drafts: read(key) }));
  // เปลี่ยนกลุ่ม/อาจารย์ = โหลดชุดของกลุ่มนั้น (รูปแบบ "ตั้ง state ระหว่าง render" ของ React)
  let current = state;
  if (state.key !== key) {
    current = { key, drafts: read(key) };
    setState(current);
  }

  useEffect(() => {
    try {
      if (Object.keys(state.drafts).length) sessionStorage.setItem(state.key, JSON.stringify(state.drafts));
      else sessionStorage.removeItem(state.key);
    } catch { /* เก็บไม่ได้ = ใช้ได้แค่ในหน้านี้ เหมือนเดิม */ }
  }, [state]);

  const setDrafts = useCallback((u: Drafts | ((prev: Drafts) => Drafts)) => {
    setState((s) => ({ ...s, drafts: typeof u === 'function' ? u(s.drafts) : u }));
  }, []);

  return [current.drafts, setDrafts] as const;
}
