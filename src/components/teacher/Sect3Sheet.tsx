/**
 * ใบประเมิน Section III — ส่วนที่วาดใบและรับคะแนน
 * แยกจากหน้า Portfolio เพื่อให้ไฟล์หน้าไม่บวม (Section II มีใบของตัวเองอีกชุด)
 */
import { ArrowLeft, CheckCircle, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useAdoptOwnRow, useOwnRow, useOwnRowDraft } from './useOwnRowDraft';
import { firstNameOnly } from '../../domain/group';
import {
  S3_FULL_SCORE, s3Points, sect3Total,
  type S3Form, type S3Grade,
} from '../../domain/sect3';
import { deleteSect3, saveSect3 } from '../../data/repo';
import { thaiShort, toISODate } from '../../lib/date';
import { personName, t } from '../../lib/i18n';
import { usePatientNamesOn } from '../../hooks/data';
import { CasePicker } from './CasePicker';
import { currentActor } from '../../store/app';
import type { Sect3Record, Student } from '../../domain/types';

const GRADES: Array<{ v: S3Grade; label: string }> = [
  { v: 'O', label: 'Outstanding' },
  { v: 'S', label: 'Satisfactory' },
  { v: 'U', label: 'Unsatisfactory' },
];

/** ใบล่าสุดของแต่ละ formKey — listSect3 เรียงล่าสุดก่อนแล้ว */
export function latestByForm<T extends { formKey: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(r.formKey)) m.set(r.formKey, r);
  return m;
}

export function Sect3FormGroup({ group, forms, latest, onOpen }: {
  group: 'CD' | 'RPD' | 'FDP';
  forms: S3Form[];
  latest: Map<string, Sect3Record>;
  onOpen: (k: string) => void;
}) {
  const mine = forms.filter((f) => f.group === group);
  if (!mine.length) return null;
  return (
    <>
      <div className="frows__group">
        {group === 'CD' ? 'Complete dentures (CD)' : group === 'RPD' ? 'Removable partial dentures (RPD)' : 'Fixed prosthesis (FDP)'}
      </div>
      {mine.map((f) => {
        const r = latest.get(f.key);
        return (
          <button key={f.key} onClick={() => onOpen(f.key)} className="frow">
            <span className="frow__code" style={{ width: 74 }}>{f.code}</span>
            <span className="frow__t">{f.title.replace(/^.*? – /, '')}</span>
            {r ? (
              <span className="frow__s">
                {/* กาค้างไว้ต้องดูออกทันทีว่ายังไม่เสร็จ — ขีดเฉยๆ อ่านเหมือนประเมินจบแล้ว */}
                <b style={{ color: r.total === null ? 'var(--warning-dark)' : 'var(--success-dark)' }}>
                  {r.total === null
                    ? `${t('ร่าง')} ${Object.keys(r.grades ?? {}).length}/${f.topics.length}`
                    : `${r.total}/${S3_FULL_SCORE}`}
                </b>
                <small>{thaiShort(r.at)}{r.by ? ` · ${r.by}` : ''}</small>
              </span>
            ) : (
              <span className="frow__none">{t('ยังไม่ประเมิน')}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

/* ── ใบประเมินหนึ่งใบ ───────────────────────────────────────────────────── */
export function Sect3Sheet({ form, student, classYear, year, history, onClose, onSaved, onDeleted }: {
  form: S3Form;
  student: Student;
  classYear: number;
  year: number;
  history: Sect3Record[];
  onClose: () => void;
  onSaved: (total: number | null) => void;
  onDeleted: () => void;
}) {
  const own = useOwnRow(history);
  const { editing, editingRef, everSaved, skipDraft } = own;
  const cur = history.find((r) => r.id === editing);
  const [grades, setGrades] = useState<Record<string, S3Grade>>(cur?.grades ?? {});
  const [patientName, setPatientName] = useState(cur?.patientName ?? '');
  const namesOn = usePatientNamesOn();
  const [hn, setHn] = useState(cur?.hn ?? '');
  const [at, setAt] = useState(cur?.at ?? toISODate(new Date()));
  const [busy, setBusy] = useState(false);

  const total = sect3Total(form, grades);
  const answered = form.topics.filter((x) => grades[x.key]).length;

  const { touch, cancel } = useOwnRowDraft(own, (id) => saveSect3({
    id, studentId: student.id, formKey: form.key,
    academicYear: year, classYear,
    patientName, hn, grades, total, at, silent: true,
  }, currentActor()));

  useEffect(() => {
    if (skipDraft()) return;
    // ยังไม่ได้กาอะไรเลย = อย่าเพิ่งสร้างแถวเปล่าไว้ในฐานข้อมูล
    if (!Object.keys(grades).length) return;
    touch();
  }, [grades, patientName, hn, at, touch, skipDraft]);
  useAdoptOwnRow(own, history, !Object.keys(grades).length, reset);

  function reset(row?: Sect3Record) {
    own.switchTo(row);
    setGrades(row?.grades ?? {});
    setPatientName(row?.patientName ?? '');
    setHn(row?.hn ?? '');
    setAt(row?.at ?? toISODate(new Date()));
  }

  /* กันกดบันทึกรัว — ต้องเป็น ref เพราะ disabled={busy} มีผลหลัง re-render
     กดสองทีเร็วๆ บนเครื่องช้าจะสร้างแถวซ้ำ */
  const saving = useRef(false);
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      cancel();
      await saveSect3({
        id: editingRef.current, studentId: student.id, formKey: form.key, academicYear: year, classYear,
        patientName, hn, grades, total, at, edited: everSaved.current,
      }, currentActor());
      everSaved.current = true;
      onSaved(total);
      onClose();
    } finally { saving.current = false; setBusy(false); }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    try { await deleteSect3(editing, currentActor()); onDeleted(); onClose(); }
    finally { setBusy(false); }
  }

  let n = 0;
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button className="iconbtn" onClick={onClose} aria-label={t('ย้อนกลับ')}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>{form.title}</h3>
          <p className="sub" style={{ margin: '2px 0 0' }}>
            {form.code} · {firstNameOnly(personName(student))} {student.code}
            {form.yearOnly ? ` · YEAR ${form.yearOnly}` : ''}
          </p>
        </div>
      </div>

      {history.length > 0 && (
        <div className="seg" style={{ marginTop: 11, flexWrap: 'wrap' }}>
          {history.map((r, i) => (
            <button key={r.id} data-on={r.id === editing} onClick={() => { own.setWantNew(false); reset(r); }}>
              {history.length === 1 ? t('ใบที่ทำไว้') : i === 0 ? t('ครั้งล่าสุด') : t('ครั้งที่ {n}', { n: history.length - i })} · {thaiShort(r.at)}
            </button>
          ))}
          <button data-on={editing === undefined} onClick={() => { own.setWantNew(true); reset(undefined); }}>+ {t('ประเมินใหม่')}</button>
        </div>
      )}

      <CasePicker
        studentId={student.id}
        scope={form.group}
        patientName={patientName}
        hn={hn}
        onPick={(c) => { setPatientName(c.name); setHn(c.hn); }}
      />

      <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', marginTop: 10 }}>
        {/* ไม่ใช้ชื่อผู้ป่วย (นำร่อง · 0026) = ไม่มีช่องให้พิมพ์ */}
        {namesOn && <label className="field">
          <span>{t('ชื่อผู้ป่วย')}</span>
          <input className="input" value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder={t('ตามที่เขียนในฟอร์ม')} />
        </label>}
        <label className="field">
          <span>H.N.</span>
          <input className="input mono" value={hn} onChange={(e) => setHn(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('วันที่ประเมิน')}</span>
          <input className="input mono" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {form.topics.map((topic) => {
          n++;
          return (
            <div key={topic.key}>
              {topic.sub && (
                <div style={{ font: '700 11px var(--font-head)', color: 'var(--text-secondary)', margin: '6px 0 5px 2px' }}>
                  {topic.sub}
                </div>
              )}
              <div className="card" style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
                <span style={{ font: '500 12px/1.5 var(--font-body)' }}>
                  <b style={{ font: '700 11px var(--font-mono)', color: 'var(--text-faint)' }}>{n}. </b>
                  {topic.label}{' '}
                  <b style={{ font: '700 11px var(--font-mono)', color: 'var(--text-muted)' }}>({topic.max})</b>
                </span>
                <div className="seg" style={{ gap: 7 }}>
                  {GRADES.map((g) => {
                    const on = grades[topic.key] === g.v;
                    return (
                      <button
                        key={g.v}
                        data-on={on}
                        onClick={() => setGrades((p) => {
                          const next = { ...p };
                          if (on) delete next[topic.key]; else next[topic.key] = g.v;
                          return next;
                        })}
                        title={g.label}
                        style={{ flex: '1 1 0', minWidth: 0, maxWidth: 132, height: 44, display: 'grid', placeItems: 'center', lineHeight: 1.15 }}
                      >
                        <span style={{ font: '700 13px var(--font-mono)' }}>{g.v}</span>
                        <span style={{ font: '400 9px var(--font-body)', opacity: 0.75 }}>
                          {s3Points(topic, g.v)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {form.note && (
        <p style={{ margin: '12px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
          <b>Remark:</b> {form.note}
        </p>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--divider)',
      }}>
        <span style={{ flex: 1, minWidth: 130 }}>
          <span style={{ display: 'block', font: '700 20px var(--font-mono)', color: total === null ? 'var(--text-faint)' : 'var(--success-dark)' }}>
            {total === null ? '—' : total} <span style={{ font: '500 12px var(--font-mono)', color: 'var(--text-muted)' }}>/ {S3_FULL_SCORE}</span>
          </span>
          <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
            {t('กาแล้ว {a}/{b} ข้อ', { a: answered, b: form.topics.length })}
          </span>
        </span>
        {editing && (
          <button className="btn btn--ghost" onClick={remove} disabled={busy} style={{ height: 44 }}>
            <Trash size={15} /> {t('ลบใบนี้')}
          </button>
        )}
        <button className="btn btn--primary" onClick={save} disabled={busy || !answered} style={{ height: 44 }}>
          <CheckCircle size={16} /> {t('บันทึก')}
        </button>
      </div>
    </div>
  );
}
