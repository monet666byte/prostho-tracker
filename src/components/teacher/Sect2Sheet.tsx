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
import {
  RPD_DESIGN_GROUPS, RPD_DESIGN_REMARK, RPD_DESIGN_TOPICS, S2_FULL_SCORE, S2_GRADES,
  rpdDesignPassed, s2Points, sect2Form, sect2Total, type S2Form, type S2Grade,
} from '../../domain/sect2';
import { deleteSect2, saveSect2 } from '../../data/repo';
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
          {code} · {firstNameOnly(student.name)} {student.code} · YEAR 5
        </p>
      </div>
    </div>
  );
}

function CaseFields({ patientName, hn, typeOfWorks, at, set }: {
  patientName: string; hn: string; typeOfWorks: string; at: string;
  set: (k: 'patientName' | 'hn' | 'typeOfWorks' | 'at', v: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', marginTop: 12 }}>
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

  async function save() {
    setBusy(true);
    try {
      cancel();
      await saveSect2({
        id: editingRef.current, studentId: student.id, formKey: form.key, academicYear: year, classYear,
        ...f, grades, total,
      }, currentActor());
      onSaved(total);
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <SheetHead student={student} title={form.title} code={form.key === 'removable' ? 'Sect II · Removable' : 'Sect II · Fixed'} onClose={onClose} />

      {history.length > 1 && (
        <div className="seg" style={{ marginTop: 11, flexWrap: 'wrap' }}>
          {history.map((r, i) => (
            <button key={r.id} data-on={r.id === editing} onClick={() => reset(r)}>
              {i === 0 ? t('ครั้งล่าสุด') : t('ครั้งที่ {n}', { n: history.length - i })} · {thaiShort(r.at)}
            </button>
          ))}
          <button data-on={editing === undefined} onClick={() => reset(undefined)}>+ {t('ประเมินใหม่')}</button>
        </div>
      )}

      <CaseFields {...f} set={(k, v) => setF((p) => ({ ...p, [k]: v }))} />

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

  const marked = RPD_DESIGN_TOPICS.filter((x) => marks[x.key] !== undefined).length;
  const complete = marked === RPD_DESIGN_TOPICS.length;
  const passed = rpdDesignPassed(marks);

  const editingRef = useRef(editing);
  editingRef.current = editing;
  const skipNext = useRef(false);
  const { touch, cancel } = useDraftSave(async () => {
    const row = await saveSect2({
      id: editingRef.current, studentId: student.id, formKey: 'rpdDesign',
      academicYear: year, classYear, ...f, marks, passed: complete && passed, silent: true,
    }, currentActor());
    if (!editingRef.current) { editingRef.current = row.id; setEditing(row.id); }
  });
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (skipNext.current) { skipNext.current = false; return; }
    if (!Object.keys(marks).length) return;
    touch();
  }, [marks, f, touch]);

  function reset(row?: Sect2Record) {
    skipNext.current = true;
    setEditing(row?.id);
    editingRef.current = row?.id;
    setMarks(row?.marks ?? {});
    setF({
      patientName: row?.patientName ?? '', hn: row?.hn ?? '',
      typeOfWorks: row?.typeOfWorks ?? '', at: row?.at ?? toISODate(new Date()),
    });
  }

  async function save() {
    setBusy(true);
    try {
      cancel();
      await saveSect2({
        id: editingRef.current, studentId: student.id, formKey: 'rpdDesign', academicYear: year, classYear,
        ...f, marks, passed: complete && passed,
      }, currentActor());
      onSaved(complete && passed);
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <SheetHead student={student} title="RPD Design Examination Form" code="Sect II · Design RPD" onClose={onClose} />

      {history.length > 1 && (
        <div className="seg" style={{ marginTop: 11, flexWrap: 'wrap' }}>
          {history.map((r, i) => (
            <button key={r.id} data-on={r.id === editing} onClick={() => reset(r)}>
              {i === 0 ? t('ครั้งล่าสุด') : t('ครั้งที่ {n}', { n: history.length - i })} · {thaiShort(r.at)}
            </button>
          ))}
          <button data-on={editing === undefined} onClick={() => reset(undefined)}>+ {t('ประเมินใหม่')}</button>
        </div>
      )}

      <CaseFields {...f} set={(k, v) => setF((p) => ({ ...p, [k]: v }))} />

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
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
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              font: '700 15px var(--font-head)',
              color: !complete ? 'var(--text-faint)' : passed ? 'var(--success-dark)' : 'var(--danger-dark)',
            }}>
              {complete ? (passed ? <CheckCircle size={18} weight="fill" /> : <X size={16} weight="bold" />) : null}
              {!complete ? t('ยังกาไม่ครบ') : passed ? 'PASS' : t('ยังไม่ผ่าน')}
            </span>
            <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
              {t('กาแล้ว {a}/{b} ข้อ', { a: marked, b: RPD_DESIGN_TOPICS.length })}
              {complete && !passed && ` · ${t('ตกอยู่ {n} ข้อ', { n: RPD_DESIGN_TOPICS.filter((x) => marks[x.key] === false).length })}`}
            </span>
          </>
        }
        canSave={marked > 0}
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
