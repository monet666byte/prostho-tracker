/**
 * ใบประเมิน Section II — ตรวจแผนการรักษา (Removable / Fixed) และใบ RPD design
 *
 * ต่างจาก Section III ตรงที่มี 4 ระดับ และแต่ละระดับมีคำบรรยายยาว
 * ปัญหาที่ต้องแก้: ถ้าโชว์คำบรรยายทั้ง 4 ช่องพร้อมกัน หน้าจะยาวมากจนใช้ไม่ไหว
 * ทางที่เลือก — ปกติโชว์แค่ปุ่ม 4 ปุ่มกับคะแนน · กาแล้วโชว์คำบรรยายของระดับที่กา
 * · กด "ดูเกณฑ์ทั้ง 4 ระดับ" ถึงจะกางออกมาเทียบกัน
 */
import { ArrowLeft, CaretDown, CaretUp, CheckCircle, Trash, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useDraftSave } from '../../hooks/useDraftSave';
import { firstNameOnly } from '../../domain/group';
import { studentYear } from '../../domain/cohort';
import {
  RPD_DESIGN_GROUPS, RPD_DESIGN_REMARK, RPD_DESIGN_TOPICS, S2_FULL_SCORE, S2_GRADES,
  rpdDesignPassed, s2Points, sect2Form, sect2Total, type S2Form, type S2Grade,
} from '../../domain/sect2';
import { deleteSect2, saveSect2 } from '../../data/repo';
import { CasePicker } from './CasePicker';
import { thaiShort, toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
import { currentActor } from '../../store/app';
import type { Sect2Record, Student } from '../../domain/types';

/* ── หัวใบ: ชื่อผู้ป่วย HN ประเภทงาน วันที่ ─────────────────────────────── */
function SheetHead({ student, title, code, onClose }: {
  student: Student; title: string; code: string; onClose: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <button className="iconbtn" onClick={onClose} aria-label={t('ย้อนกลับ')}><ArrowLeft size={16} /></button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <p className="sub" style={{ margin: '2px 0 0' }}>
          {code} · {firstNameOnly(t(student.name))} {student.code} · {t('ปี {n}', { n: studentYear(student) })}
        </p>
      </div>
    </div>
  );
}

/** ช่องหัวฟอร์ม (ชื่อผู้ป่วย · H.N. · ประเภทงาน · วันที่) — มีตัวเลือกเคสอยู่ข้างบน */
function CaseFields({ studentId, patientName, hn, typeOfWorks, at, set }: {
  studentId: string;
  patientName: string; hn: string; typeOfWorks: string; at: string;
  set: (k: 'patientName' | 'hn' | 'typeOfWorks' | 'at', v: string) => void;
}) {
  return (
    <>
      <CasePicker
        studentId={studentId}
        patientName={patientName}
        hn={hn}
        onPick={(c) => { set('patientName', c.name); set('hn', c.hn); set('typeOfWorks', c.works.join(', ')); }}
      />
    <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', marginTop: 10 }}>
      <label className="field">
        <span>{t('ชื่อผู้ป่วย')}</span>
        <input className="input" value={patientName} onChange={(e) => set('patientName', e.target.value)} placeholder={t('ตามที่เขียนในฟอร์ม')} />
      </label>
      <label className="field">
        <span>H.N.</span>
        <input className="input mono" value={hn} onChange={(e) => set('hn', e.target.value)} />
      </label>
      <label className="field">
        <span>{t('ประเภทงาน')}</span>
        <input className="input" value={typeOfWorks} onChange={(e) => set('typeOfWorks', e.target.value)} placeholder="Type of works" />
      </label>
      <label className="field">
        <span>{t('วันที่ประเมิน')}</span>
        <input className="input mono" type="date" value={at} onChange={(e) => set('at', e.target.value)} />
      </label>
    </div>
    </>
  );
}

/* ── ① ใบให้คะแนน (Removable / Fixed) ───────────────────────────────────── */
export function Sect2ScoreSheet({ form, student, classYear, year, history, onClose, onSaved, onDeleted }: {
  form: S2Form;
  student: Student;
  classYear: number;
  year: number;
  history: Sect2Record[];
  onClose: () => void;
  onSaved: (total: number | null) => void;
  onDeleted: () => void;
}) {
  const prev = history[0];
  const [editing, setEditing] = useState<string | undefined>(prev?.id);
  const cur = history.find((r) => r.id === editing);
  const [grades, setGrades] = useState<Record<string, S2Grade>>((cur?.grades ?? {}) as Record<string, S2Grade>);
  const [f, setF] = useState({
    patientName: cur?.patientName ?? '', hn: cur?.hn ?? '',
    typeOfWorks: cur?.typeOfWorks ?? '', at: cur?.at ?? toISODate(new Date()),
  });
  const [openRubric, setOpenRubric] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = sect2Total(form, grades);
  const done = form.criteria.filter((c) => grades[c.key]).length;

  /* ร่างอัตโนมัติ — เหตุผลเดียวกับ Sect3Sheet (กาครึ่งใบแล้วถูกขัดจังหวะ ของต้องไม่หาย) */
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const skipNext = useRef(false);
  const { touch, cancel } = useDraftSave(async () => {
    const row = await saveSect2({
      id: editingRef.current, studentId: student.id, formKey: form.key,
      academicYear: year, classYear, ...f, grades, total, silent: true,
    }, currentActor());
    if (!editingRef.current) { editingRef.current = row.id; setEditing(row.id); }
  });
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (skipNext.current) { skipNext.current = false; return; }
    if (!Object.keys(grades).length) return;
    touch();
  }, [grades, f, touch]);


  /* สองเครื่องของ "คนเดียวกัน" (มือถือ+iPad) → รับแถวที่มีอยู่มาแก้ต่อ
     ไม่งั้นต่างคนต่างสร้างแถวใหม่ กลายเป็นสองใบที่ไม่รู้จักกัน
     (แถวมาช้ากว่าตอน mount ด้วย เพราะ liveQuery ยิงข้อมูลรอบสอง)

     ⚠️ แต่ต้องเป็นใบของตัวเองเท่านั้น — อาจารย์สองท่านเปิดใบเดียวกันคือคนละเรื่อง
     เดิมรับใบของท่านอื่นมาแก้ต่อด้วย บวกกับร่างอัตโนมัติที่ยิงทุกครั้งที่กา
     = คะแนนของอีกท่านถูกทับรัวๆ ตลอดเวลาที่เปิดใบค้างไว้ และนี่คือคะแนนเงื่อนไขจบ
     เจอใบของท่านอื่น → เริ่มใบใหม่ ทั้งสองใบอยู่ครบ (repo.saveSect2/3 แตกใบให้อีกชั้น) */
  const wantNew = useRef(false);
  useEffect(() => {
    if (editingRef.current || wantNew.current) return;
    if (Object.keys(grades).length) return;
    const latest = history.find((r) => r.by === currentActor());
    if (latest) reset(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  function reset(row?: Sect2Record) {
    skipNext.current = true;
    setEditing(row?.id);
    editingRef.current = row?.id;
    setGrades((row?.grades ?? {}) as Record<string, S2Grade>);
    setF({
      patientName: row?.patientName ?? '', hn: row?.hn ?? '',
      typeOfWorks: row?.typeOfWorks ?? '', at: row?.at ?? toISODate(new Date()),
    });
  }

  const saving = useRef(false);
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      cancel();
      await saveSect2({
        id: editingRef.current, studentId: student.id, formKey: form.key, academicYear: year, classYear,
        ...f, grades, total,
      }, currentActor());
      onSaved(total);
      onClose();
    } finally { saving.current = false; setBusy(false); }
  }

  return (
    <div className="panel">
      <SheetHead student={student} title={form.title} code={form.key === 'removable' ? 'Sect II · Removable' : 'Sect II · Fixed'} onClose={onClose} />

      {history.length > 0 && (
        <div className="seg" style={{ marginTop: 11, flexWrap: 'wrap' }}>
          {history.map((r, i) => (
            <button key={r.id} data-on={r.id === editing} onClick={() => { wantNew.current = false; reset(r); }}>
              {history.length === 1 ? t('ใบที่ทำไว้') : i === 0 ? t('ครั้งล่าสุด') : t('ครั้งที่ {n}', { n: history.length - i })} · {thaiShort(r.at)}
            </button>
          ))}
          <button data-on={editing === undefined} onClick={() => { wantNew.current = true; reset(undefined); }}>+ {t('ประเมินใหม่')}</button>
        </div>
      )}

      <CaseFields studentId={student.id} {...f} set={(k, v) => setF((p) => ({ ...p, [k]: v }))} />

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {form.criteria.map((c, i) => {
          const picked = grades[c.key];
          const shown = openRubric === c.key;
          return (
            <div key={c.key} className="card" style={{ padding: '11px 13px', display: 'grid', gap: 9 }}>
              <div>
                <span style={{ font: '700 12.5px/1.45 var(--font-head)' }}>
                  <span style={{ font: '700 11px var(--font-mono)', color: 'var(--text-faint)' }}>{i + 1}. </span>
                  {c.title}{' '}
                  <span style={{ font: '700 11px var(--font-mono)', color: 'var(--text-muted)' }}>({c.max})</span>
                </span>
                {c.detail && (
                  <span style={{ display: 'block', font: '400 10.5px/1.55 var(--font-body)', color: 'var(--text-faint)', marginTop: 3 }}>
                    {c.detail}
                  </span>
                )}
              </div>

              <div className="seg" style={{ gap: 6, flexWrap: 'wrap' }}>
                {S2_GRADES.map((g) => {
                  const on = picked === g.v;
                  return (
                    <button
                      key={g.v}
                      data-on={on}
                      title={g.label}
                      onClick={() => setGrades((p) => {
                        const next = { ...p };
                        if (on) delete next[c.key]; else next[c.key] = g.v;
                        return next;
                      })}
                      style={{ flex: '1 1 0', minWidth: 76, maxWidth: 150, height: 44, display: 'grid', placeItems: 'center', lineHeight: 1.15, padding: '0 6px' }}
                    >
                      <span style={{ font: '700 12px var(--font-mono)' }}>{g.v}</span>
                      <span style={{ font: '400 9px var(--font-body)', opacity: 0.75 }}>{c.max * g.ratio}</span>
                    </button>
                  );
                })}
              </div>

              {/* กาแล้วอ่านทวนได้ทันทีว่าระดับนั้นแปลว่าอะไร — ไม่ต้องเปิดสมุดเทียบ */}
              {picked && !shown && (
                <p style={{ margin: 0, font: '400 11px/1.6 var(--font-body)', color: 'var(--text-secondary)', background: 'var(--fill)', padding: '8px 10px', borderRadius: 8 }}>
                  <b>{S2_GRADES.find((g) => g.v === picked)?.label}</b> · {c.rubric[picked]}
                </p>
              )}

              {shown && (
                <div style={{ display: 'grid', gap: 6 }}>
                  {S2_GRADES.map((g) => (
                    <p key={g.v} style={{
                      margin: 0, font: '400 11px/1.6 var(--font-body)',
                      color: picked === g.v ? 'var(--text-primary)' : 'var(--text-muted)',
                      background: picked === g.v ? 'var(--accent-tint)' : 'var(--fill)',
                      padding: '8px 10px', borderRadius: 8,
                    }}>
                      <b>{g.v} · {g.label} ({c.max * g.ratio})</b><br />{c.rubric[g.v]}
                    </p>
                  ))}
                </div>
              )}

              <button
                onClick={() => setOpenRubric(shown ? null : c.key)}
                style={{
                  justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 5, minHeight: 32,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  font: '600 10.5px var(--font-body)', color: 'var(--accent)',
                }}
              >
                {shown ? <CaretUp size={12} /> : <CaretDown size={12} />}
                {shown ? t('ย่อเกณฑ์') : t('ดูเกณฑ์ทั้ง 4 ระดับ')}
              </button>
            </div>
          );
        })}
      </div>

      <SheetFooter
        left={
          <>
            <span style={{ display: 'block', font: '700 20px var(--font-mono)', color: total === null ? 'var(--text-faint)' : 'var(--success-dark)' }}>
              {total === null ? '—' : total} <span style={{ font: '500 12px var(--font-mono)', color: 'var(--text-muted)' }}>/ {S2_FULL_SCORE}</span>
            </span>
            <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
              {t('กาแล้ว {a}/{b} ข้อ', { a: done, b: form.criteria.length })}
            </span>
          </>
        }
        canSave={done > 0}
        busy={busy}
        editing={editing}
        onSave={save}
        onDelete={async () => {
          if (!editing) return;
          setBusy(true);
          try { await deleteSect2(editing, currentActor()); onDeleted(); onClose(); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

/* ── ② ใบ RPD design (ผ่าน/ไม่ผ่าน 17 ข้อ) ──────────────────────────────── */
export function RpdDesignSheet({ student, classYear, year, history, onClose, onSaved, onDeleted }: {
  student: Student;
  classYear: number;
  year: number;
  history: Sect2Record[];
  onClose: () => void;
  onSaved: (passed: boolean) => void;
  onDeleted: () => void;
}) {
  const prev = history[0];
  const [editing, setEditing] = useState<string | undefined>(prev?.id);
  const cur = history.find((r) => r.id === editing);
  const [marks, setMarks] = useState<Record<string, boolean>>(cur?.marks ?? {});
  const [f, setF] = useState({
    patientName: cur?.patientName ?? '', hn: cur?.hn ?? '',
    typeOfWorks: cur?.typeOfWorks ?? '', at: cur?.at ?? toISODate(new Date()),
  });
  const [busy, setBusy] = useState(false);

  /* ผู้ใช้ขอ 7 ก.ย. 69: ปกติแค่ติ๊กว่าสอบแล้วและอาจารย์กดอนุมัติก็พอ ไม่ต้องกาทีละ 17 ข้อ
     แต่ยังเก็บทางกาแบบละเอียดไว้ (พับไว้) เพราะกระดาษจริงมี 17 ข้อ
     ถ้าใครกาไว้แล้ว ผลจะคิดจากรายข้อเหมือนเดิม — ของที่บันทึกไปแล้วไม่เพี้ยน */
  /* ⚠️ ต้องมีสถานะ "ยังไม่ตัดสิน" (undefined) แยกจาก "ไม่ผ่าน" (false)
     ไม่งั้นแค่แตะเลือกเคสแล้ว autosave จะบันทึกว่าไม่ผ่าน และไปตั้งธงเงื่อนไขจบให้เลย
     ทั้งที่อาจารย์ยังไม่ได้ตัดสินอะไร (วัดจริงตอนไล่เช็ค 8 ก.ย. 69) */
  const [approved, setApproved] = useState<boolean | undefined>(cur?.passed ?? undefined);
  const [showItems, setShowItems] = useState(Object.keys(cur?.marks ?? {}).length > 0);

  const marked = RPD_DESIGN_TOPICS.filter((x) => marks[x.key] !== undefined).length;
  const complete = marked === RPD_DESIGN_TOPICS.length;
  /** กาแบบรายข้อไว้หรือยัง — ถ้ายัง ใช้ธงอนุมัติแทน */
  const detailed = marked > 0;
  const passed = detailed ? rpdDesignPassed(marks) : approved;
  const canSave = detailed ? complete : approved !== undefined;

  const editingRef = useRef(editing);
  editingRef.current = editing;
  const skipNext = useRef(false);
  const { touch, cancel } = useDraftSave(async () => {
    const row = await saveSect2({
      id: editingRef.current, studentId: student.id, formKey: 'rpdDesign',
      academicYear: year, classYear, ...f, marks,
      passed: detailed ? (complete && passed) : approved, silent: true,
    }, currentActor());
    if (!editingRef.current) { editingRef.current = row.id; setEditing(row.id); }
  });
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (skipNext.current) { skipNext.current = false; return; }
    touch();
  }, [marks, f, approved, touch]);


  /* สองเครื่องของ "คนเดียวกัน" (มือถือ+iPad) → รับแถวที่มีอยู่มาแก้ต่อ
     ไม่งั้นต่างคนต่างสร้างแถวใหม่ กลายเป็นสองใบที่ไม่รู้จักกัน
     (แถวมาช้ากว่าตอน mount ด้วย เพราะ liveQuery ยิงข้อมูลรอบสอง)

     ⚠️ แต่ต้องเป็นใบของตัวเองเท่านั้น — อาจารย์สองท่านเปิดใบเดียวกันคือคนละเรื่อง
     เดิมรับใบของท่านอื่นมาแก้ต่อด้วย บวกกับร่างอัตโนมัติที่ยิงทุกครั้งที่กา
     = คะแนนของอีกท่านถูกทับรัวๆ ตลอดเวลาที่เปิดใบค้างไว้ และนี่คือคะแนนเงื่อนไขจบ
     เจอใบของท่านอื่น → เริ่มใบใหม่ ทั้งสองใบอยู่ครบ (repo.saveSect2/3 แตกใบให้อีกชั้น) */
  const wantNew = useRef(false);
  useEffect(() => {
    if (editingRef.current || wantNew.current) return;
    if (Object.keys(marks).length) return;
    const latest = history.find((r) => r.by === currentActor());
    if (latest) reset(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  function reset(row?: Sect2Record) {
    skipNext.current = true;
    setEditing(row?.id);
    editingRef.current = row?.id;
    setMarks(row?.marks ?? {});
    setF({
      patientName: row?.patientName ?? '', hn: row?.hn ?? '',
      typeOfWorks: row?.typeOfWorks ?? '', at: row?.at ?? toISODate(new Date()),
    });
    setApproved(row?.passed ?? undefined);
    setShowItems(Object.keys(row?.marks ?? {}).length > 0);
  }

  const saving = useRef(false);
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      cancel();
      // ปุ่มบันทึกถูกปิดอยู่แล้วเมื่อยังไม่ตัดสิน — เช็คซ้ำเพื่อให้ชนิดข้อมูลชัดและกันทางลัด
      const verdict = detailed ? (complete && rpdDesignPassed(marks)) : approved;
      if (verdict === undefined) return;
      await saveSect2({
        id: editingRef.current, studentId: student.id, formKey: 'rpdDesign', academicYear: year, classYear,
        ...f, marks, passed: verdict,
      }, currentActor());
      onSaved(verdict);
      onClose();
    } finally { saving.current = false; setBusy(false); }
  }

  return (
    <div className="panel">
      <SheetHead student={student} title="RPD Design Examination Form" code="Sect II · Design RPD" onClose={onClose} />

      {history.length > 0 && (
        <div className="seg" style={{ marginTop: 11, flexWrap: 'wrap' }}>
          {history.map((r, i) => (
            <button key={r.id} data-on={r.id === editing} onClick={() => { wantNew.current = false; reset(r); }}>
              {history.length === 1 ? t('ใบที่ทำไว้') : i === 0 ? t('ครั้งล่าสุด') : t('ครั้งที่ {n}', { n: history.length - i })} · {thaiShort(r.at)}
            </button>
          ))}
          <button data-on={editing === undefined} onClick={() => { wantNew.current = true; reset(undefined); }}>+ {t('ประเมินใหม่')}</button>
        </div>
      )}

      <CaseFields studentId={student.id} {...f} set={(k, v) => setF((p) => ({ ...p, [k]: v }))} />

      {/* ทางหลัก: ติ๊กว่าสอบแล้ว แล้วอาจารย์กดอนุมัติ — พอสำหรับการใช้งานปกติ (ผู้ใช้ขอ 7 ก.ย. 69) */}
      <div className="card" style={{ padding: 14, marginTop: 14, display: 'grid', gap: 10 }}>
        <div>
          <span style={{ font: '700 12.5px var(--font-head)' }}>{t('ผลการสอบ')}</span>
          <span style={{ display: 'block', font: '400 10.5px/1.55 var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
            {detailed
              ? t('มีการบันทึกผลรายข้อไว้แล้ว — ผลคิดจากรายการข้างล่าง')
              : t('นักศึกษาสอบและอาจารย์ตรวจแล้ว กดอนุมัติได้เลย ไม่ต้องกาทีละข้อ')}
          </span>
        </div>
        <div className="seg" style={{ gap: 7, maxWidth: 340 }}>
          <button
            data-on={!detailed && approved === true}
            disabled={detailed}
            onClick={() => setApproved(true)}
            style={{ flex: '1 1 0', height: 46, display: 'grid', placeItems: 'center' }}
          >
            <span style={{ font: '600 12.5px var(--font-body)' }}>{t('สอบผ่านแล้ว')}</span>
          </button>
          <button
            data-on={!detailed && approved === false}
            disabled={detailed}
            onClick={() => setApproved(false)}
            style={{ flex: '1 1 0', height: 46, display: 'grid', placeItems: 'center' }}
          >
            <span style={{ font: '600 12.5px var(--font-body)' }}>{t('ยังไม่ผ่าน')}</span>
          </button>
        </div>
      </div>

      {/* ทางละเอียด: 17 ข้อตามกระดาษ — พับไว้ ใครอยากบันทึกรายข้อค่อยกาง
          ถ้ากาไว้แล้ว ผลจะคิดจากตรงนี้แทนปุ่มอนุมัติข้างบน */}
      <button
        onClick={() => setShowItems((v) => !v)}
        style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, minHeight: 34,
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          font: '600 11px var(--font-body)', color: 'var(--accent)',
        }}
      >
        {showItems ? <CaretUp size={12} /> : <CaretDown size={12} />}
        {showItems ? t('ซ่อนรายการ 17 ข้อ') : t('บันทึกผลรายข้อ (17 ข้อตามกระดาษ)')}
      </button>

      <div style={{ display: showItems ? 'grid' : 'none', gap: 12, marginTop: 12 }}>
        {RPD_DESIGN_GROUPS.map((g) => (
          <div key={g.no}>
            <div style={{ font: '700 11.5px/1.5 var(--font-head)', color: 'var(--text-secondary)', margin: '0 0 6px 2px' }}>
              {g.no}. {g.title}
            </div>
            <div className="card" style={{ padding: '4px 12px 10px', display: 'grid' }}>
              {g.topics.map((topic, k) => {
                const v = marks[topic.key];
                return (
                  <div
                    key={topic.key}
                    className="scalerow"
                    style={{ display: 'grid', gap: 6, padding: '10px 0 0', borderTop: k ? '1px solid var(--divider)' : undefined, marginTop: k ? 3 : 6 }}
                  >
                    <span style={{ font: '500 12px/1.45 var(--font-body)' }}>
                      <b style={{ font: '600 11px var(--font-mono)', color: 'var(--text-faint)' }}>{topic.no} </b>
                      {topic.label}
                    </span>
                    <div className="seg" style={{ gap: 7, maxWidth: 220 }}>
                      {[true, false].map((val) => (
                        <button
                          key={String(val)}
                          data-on={v === val}
                          onClick={() => setMarks((p) => {
                            const next = { ...p };
                            if (v === val) delete next[topic.key]; else next[topic.key] = val;
                            return next;
                          })}
                          style={{ flex: '1 1 0', minWidth: 0, height: 44, display: 'grid', placeItems: 'center', padding: '0 8px' }}
                        >
                          <span style={{ font: '600 12px var(--font-body)' }}>{val ? 'Pass' : 'Fail'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p style={{ margin: '12px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
        <b>Remark:</b> {RPD_DESIGN_REMARK}
      </p>

      <SheetFooter
        left={
          <>
            {/* กาแบบรายข้อ = สรุปจากรายการ · ไม่ได้กา = ผลมาจากปุ่มอนุมัติข้างบน */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              font: '700 15px var(--font-head)',
              color: (detailed && !complete) || passed === undefined ? 'var(--text-faint)'
                : passed ? 'var(--success-dark)' : 'var(--danger-dark)',
            }}>
              {passed !== undefined && (!detailed || complete)
                ? (passed ? <CheckCircle size={18} weight="fill" /> : <X size={16} weight="bold" />) : null}
              {passed === undefined ? t('ยังไม่ตัดสิน')
                : detailed && !complete ? t('ยังกาไม่ครบ') : passed ? 'PASS' : t('ยังไม่ผ่าน')}
            </span>
            <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
              {detailed
                ? t('กาแล้ว {a}/{b} ข้อ', { a: marked, b: RPD_DESIGN_TOPICS.length })
                : approved === undefined
                  ? t('เลือกผลก่อนจึงจะบันทึกได้')
                  : t('อาจารย์อนุมัติ (ไม่ได้บันทึกรายข้อ)')}
              {detailed && complete && !passed && ` · ${t('ตกอยู่ {n} ข้อ', { n: RPD_DESIGN_TOPICS.filter((x) => marks[x.key] === false).length })}`}
            </span>
          </>
        }
        canSave={canSave}
        busy={busy}
        editing={editing}
        onSave={save}
        onDelete={async () => {
          if (!editing) return;
          setBusy(true);
          try { await deleteSect2(editing, currentActor()); onDeleted(); onClose(); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

function SheetFooter({ left, canSave, busy, editing, onSave, onDelete }: {
  left: React.ReactNode; canSave: boolean; busy: boolean; editing?: string;
  onSave: () => void; onDelete: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--divider)',
    }}>
      <span style={{ flex: 1, minWidth: 140 }}>{left}</span>
      {editing && (
        <button className="btn btn--ghost" onClick={onDelete} disabled={busy} style={{ height: 44 }}>
          <Trash size={15} /> {t('ลบใบนี้')}
        </button>
      )}
      <button className="btn btn--primary" onClick={onSave} disabled={busy || !canSave} style={{ height: 44 }}>
        <CheckCircle size={16} /> {t('บันทึก')}
      </button>
    </div>
  );
}

/** ค่าที่ใช้โชว์ในรายการใบของ Section II — ใบที่กาค้างต้องดูออกว่ายังไม่เสร็จ */
export function sect2Status(row: Sect2Record | undefined): { text: string; done: boolean } | null {
  if (!row) return null;
  if (row.formKey === 'rpdDesign') {
    const marked = RPD_DESIGN_TOPICS.filter((x) => row.marks?.[x.key] !== undefined).length;
    /* ไม่ได้กาสักข้อ = ใช้ทางอนุมัติอย่างเดียว ซึ่งเป็นทางปกติ ไม่ใช่ร่าง
       (ถ้าไม่แยกกรณีนี้ ใบที่อนุมัติแล้วจะขึ้นว่า "ร่าง 0/17" ทั้งที่เสร็จแล้ว) */
    if (marked === 0) {
      return row.passed === undefined || row.passed === null
        ? { text: t('ร่าง'), done: false }
        : { text: row.passed ? 'PASS' : t('ยังไม่ผ่าน'), done: true };
    }
    if (marked < RPD_DESIGN_TOPICS.length) {
      return { text: `${t('ร่าง')} ${marked}/${RPD_DESIGN_TOPICS.length}`, done: false };
    }
    return { text: row.passed ? 'PASS' : t('ยังไม่ผ่าน'), done: true };
  }
  const form = sect2Form(row.formKey);
  if (row.total === null || row.total === undefined) {
    const marked = Object.keys(row.grades ?? {}).length;
    return { text: `${t('ร่าง')} ${marked}/${form?.criteria.length ?? 6}`, done: false };
  }
  return { text: `${row.total}/${S2_FULL_SCORE}`, done: true };
}

export { s2Points };
