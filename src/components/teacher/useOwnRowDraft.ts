/**
 * "ใบของฉัน" + ร่างอัตโนมัติ — ส่วนที่ใบประเมิน Section II (ให้คะแนน · RPD design) และ Section III ใช้เหมือนกันทุกตัวอักษร
 *
 * แยกเป็นสามท่อนเพราะลำดับ effect ต้องคงเดิม: ตัวเซฟร่าง → effect ที่สั่งเซฟ (อยู่ในใบ เพราะแต่ละใบเฝ้าช่องไม่เหมือนกัน)
 * → effect รับใบของตัวเองมาแก้ต่อ · สลับลำดับแล้ว ใบที่เพิ่งรับมาจะถูกเซฟร่างทับตัวเองหนึ่งรอบโดยไม่มีใครแก้อะไร
 *
 *   const own = useOwnRow(history);                       // ก่อน state ของฟอร์ม (ฟอร์มตั้งค่าเริ่มจาก own.editing)
 *   const { touch, cancel } = useOwnRowDraft(own, (id) => saveSectX({ id, …, silent: true }, currentActor()));
 *   useEffect(() => { if (skipDraft()) return; …; touch(); }, [ช่องที่เฝ้า]);
 *   useAdoptOwnRow(own, history, ยังไม่ได้กาอะไร, reset);
 *
 * สิ่งที่ส่งขึ้นไปเซฟต่างกันรายใบ (grades / marks / passed) จึงรับเป็น callback ไม่รวมชนิดข้อมูลเข้าด้วยกัน
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useDraftSave } from '../../hooks/useDraftSave';
import { currentActor } from '../../store/app';

interface OwnedRow { id: string; by: string }

export interface OwnRow {
  /** id ของใบที่กำลังแก้ · undefined = ใบใหม่ที่ยังไม่มีแถว */
  editing: string | undefined;
  /** ค่าเดียวกับ `editing` แต่อ่านได้ทันทีจาก closure เก่า — ร่างที่ flush ตอนออกจากหน้าต้องเห็น id ที่เพิ่งได้มา */
  editingRef: RefObject<string | undefined>;
  setEditing: (id: string | undefined) => void;
  /** ใบนี้เคยถูก "กดบันทึก" มาก่อนแล้วหรือยัง — ร่างอัตโนมัติไม่นับ
      ส่งไปให้ repo ใช้เลือกคำใน audit ("บันทึก" vs "แก้") เพราะดูจากแถวในฐานข้อมูล
      อย่างเดียวไม่ได้: ร่างสร้างแถวไว้ตั้งแต่กาข้อแรก แถวจึงมีอยู่แล้วเสมอตอนกดบันทึกจริง */
  everSaved: RefObject<boolean>;
  /** อาจารย์กด "+ ประเมินใหม่" เอง — ห้ามดึงใบเก่ากลับมาใส่มือ */
  wantNew: RefObject<boolean>;
  setWantNew: (v: boolean) => void;
  /** สลับไปใบอื่น (หรือใบใหม่) · ใบเรียกตัวนี้ก่อน แล้วค่อยตั้งค่าช่องของตัวเอง */
  switchTo: (row: OwnedRow | undefined) => void;
  /** true = รอบนี้ไม่ต้องเซฟร่าง (เพิ่งเปิดใบ หรือเพิ่งสลับใบ — ไม่ใช่การแก้) */
  skipDraft: () => boolean;
}

export function useOwnRow(history: OwnedRow[]): OwnRow {
  /* แก้ครั้งล่าสุดเป็นค่าตั้งต้น — อาจารย์มักเปิดมาแก้ ไม่ใช่เพิ่มใบใหม่ */
  const prev = history[0];
  const [editing, setEditing] = useState<string | undefined>(prev?.id);
  const editingRef = useRef(editing);
  /* เขียน ref ตอน render โดยตั้งใจ — ref ต้องตรงกับ `editing` ของรอบที่วาดเสมอ
     ร่างที่เห็น id เก่า = สร้างแถวซ้ำ · ทุกที่ที่ setEditing เขียน ref คู่กันอยู่แล้ว บรรทัดนี้เป็นตาข่ายชั้นสอง */
  // oxlint-disable-next-line react/refs
  editingRef.current = editing;
  const skipNext = useRef(false);
  const firstRender = useRef(true);
  const wantNew = useRef(false);
  const everSaved = useRef(!!prev);

  const switchTo = useCallback((row: OwnedRow | undefined) => {
    everSaved.current = !!row;
    skipNext.current = true; // สลับดูครั้งเก่า ไม่ใช่การแก้ ไม่ต้องเซฟทับ
    setEditing(row?.id);
    editingRef.current = row?.id;
  }, []);

  const setWantNew = useCallback((v: boolean) => { wantNew.current = v; }, []);

  const skipDraft = useCallback(() => {
    if (firstRender.current) { firstRender.current = false; return true; }
    if (skipNext.current) { skipNext.current = false; return true; }
    return false;
  }, []);

  return { editing, editingRef, setEditing, everSaved, wantNew, setWantNew, switchTo, skipDraft };
}

/**
 * ร่างอัตโนมัติ — อาจารย์กาไปครึ่งใบแล้วมีคนไข้เรียก กดออกจากใบ ของต้องยังอยู่
 * แถวแรกที่สร้างจากร่างต้องจำ id ไว้ ไม่งั้นเซฟรอบถัดไปจะสร้างแถวใหม่ซ้ำเรื่อยๆ
 */
export function useOwnRowDraft(own: OwnRow, saveDraft: (id: string | undefined) => Promise<{ id: string }>) {
  const { editingRef, setEditing } = own;
  return useDraftSave(async () => {
    const row = await saveDraft(editingRef.current);
    if (!editingRef.current) { editingRef.current = row.id; setEditing(row.id); }
  });
}

/* สองเครื่องของ "คนเดียวกัน" (มือถือ+iPad) → รับแถวที่มีอยู่มาแก้ต่อ
   ไม่งั้นต่างคนต่างสร้างแถวใหม่ กลายเป็นสองใบที่ไม่รู้จักกัน
   (แถวมาช้ากว่าตอน mount ด้วย เพราะ liveQuery ยิงข้อมูลรอบสอง)

   ⚠️ แต่ต้องเป็นใบของตัวเองเท่านั้น — อาจารย์สองท่านเปิดใบเดียวกันคือคนละเรื่อง
   เดิมรับใบของท่านอื่นมาแก้ต่อด้วย บวกกับร่างอัตโนมัติที่ยิงทุกครั้งที่กา
   = คะแนนของอีกท่านถูกทับรัวๆ ตลอดเวลาที่เปิดใบค้างไว้ และนี่คือคะแนนเงื่อนไขจบ
   เจอใบของท่านอื่น → เริ่มใบใหม่ ทั้งสองใบอยู่ครบ (repo.saveSect2/3 แตกใบให้อีกชั้น) */
export function useAdoptOwnRow<Row extends OwnedRow>(
  own: OwnRow,
  history: Row[],
  /** ยังไม่ได้กาอะไรในใบที่เปิดอยู่ — กาไปแล้วห้ามเอาใบอื่นมาทับของที่อยู่ในมือ */
  blank: boolean,
  reset: (row: Row) => void,
) {
  const { editingRef, wantNew } = own;
  useEffect(() => {
    if (editingRef.current || wantNew.current) return;
    if (!blank) return;
    const latest = history.find((r) => r.by === currentActor());
    if (latest) reset(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);
}
