/**
 * ใบประเมิน Section III — ส่วนที่วาดใบและรับคะแนน
 * แยกจากหน้า Portfolio เพื่อให้ไฟล์หน้าไม่บวม (Section II มีใบของตัวเองอีกชุด)
 */
import { ArrowLeft, CheckCircle, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useDraftSave } from '../../hooks/useDraftSave';
import { firstNameOnly } from '../../domain/group';
import {
  S3_FULL_SCORE, s3Points, sect3Total,
  type S3Form, type S3Grade,
} from '../../domain/sect3';
import { deleteSect3, saveSect3 } from '../../data/repo';
import { thaiShort, toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
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
    <div>
      <div style={{ font: '700 11px var(--font-head)', color: 'var(--text-secondary)', margin: '2px 0 6px' }}>
        {group === 'CD' ? 'Complete dentures (CD)' : group === 'RPD' ? 'Removable partial dentures (RPD)' : 'Fixed prosthesis (FDP)'}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {mine.map((f) => {
          const r = latest.get(f.key);
          return (
            <button
              key={f.key}
              onClick={() => onOpen(f.key)}
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
            >
              <span style={{ font: '700 10.5px var(--font-mono)', color: 'var(--text-muted)', width: 74, flex: 'none' }}>
                {f.code}
              </span>
              <span style={{ flex: 1, minWidth: 0, font: '500 12px/1.4 var(--font-body)' }}>
                {f.title.replace(/^.*? – /, '')}
              </span>
              {r ? (
                <span style={{ textAlign: 'right', flex: 'none' }}>
                  {/* กาค้างไว้ต้องดูออกทันทีว่ายังไม่เสร็จ — ขีดเฉยๆ อ่านเหมือนประเมินจบแล้ว */}
                  <span style={{
                    display: 'block', font: '700 13px var(--font-mono)',
                    color: r.total === null ? 'var(--warning-dark)' : 'var(--success-dark)',
                  }}>
                    {r.total === null
                      ? `${t('ร่าง')} ${Object.keys(r.grades ?? {}).length}/${f.topics.length}`
                      : `${r.total}/${S3_FULL_SCORE}`}
                  </span>
                  <span style={{ display: 'block', font: '400 9.5px var(--font-body)', color: 'var(--text-faint)' }}>
                    {thaiShort(r.at)}{r.by ? ` · ${r.by}` : ''}
                  </span>
                </span>
              ) : (
                <span style={{ font: '500 10.5px var(--font-body)', color: 'var(--text-faint)', flex: 'none' }}>
                  {t('ยังไม่ประเมิน')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
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
  /* แก้ครั้งล่าสุดเป็นค่าตั้งต้น — อาจารย์มักเปิดมาแก้ ไม่ใช่เพิ่มใบใหม่ */
  const prev = history[0];
  const [editing, setEditing] = useState<string | undefined>(prev?.id);
  const cur = history.find((r) => r.id === editing);
  const [grades, setGrades] = useState<Record<string, S3Grade>>(cur?.grades ?? {});
  const [patientName, setPatientName] = useState(cur?.patientName ?? '');
  const [hn, setHn] = useState(cur?.hn ?? '');
  const [at, setAt] = useState(cur?.at ?? toISODate(new Date()));
  const [busy, setBusy] = useState(false);

  const total = sect3Total(form, grades);
  const answered = form.topics.filter((x) => grades[x.key]).length;

  /* ── ร่างอัตโนมัติ ──────────────────────────────────────────────────────
     อาจารย์กาไปครึ่งใบแล้วมีคนไข้เรียก กดออกจากใบ ของต้องยังอยู่
     แถวแรกที่สร้างจากร่างต้องจำ id ไว้ ไม่งั้นเซฟรอบถัดไปจะสร้างแถวใหม่ซ้ำเรื่อยๆ */
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const skipNext = useRef(false);

  const { touch, cancel } = useDraftSave(async () => {
    const row = await saveSect3({
      id: editingRef.current, studentId: student.id, formKey: form.key,
      academicYear: year, classYear,
      patientName, hn, grades, total, at, silent: true,
    }, currentActor());
    if (!editingRef.current) { editingRef.current = row.id; setEditing(row.id); }
  });

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (skipNext.current) { skipNext.current = false; return; }
    // ยังไม่ได้กาอะไรเลย = อย่าเพิ่งสร้างแถวเปล่าไว้ในฐานข้อมูล
    if (!Object.keys(grades).length) return;
    touch();
  }, [grades, patientName, hn, at, touch]);

  function reset(row?: Sect3Record) {
    skipNext.current = true; // สลับดูครั้งเก่า ไม่ใช่การแก้ ไม่ต้องเซฟทับ
    setEditing(row?.id);
    editingRef.current = row?.id;
    setGrades(row?.grades ?? {});
    setPatientName(row?.patientName ?? '');
    setHn(row?.hn ?? '');
    setAt(row?.at ?? toISODate(new Date()));
  }

  async function save() {
    setBusy(true);
    try {
      cancel();
      await saveSect3({
        id: editingRef.current, studentId: student.id, formKey: form.key, academicYear: year, classYear,
        patientName, hn, grades, total, at,
      }, currentActor());
      onSaved(total);
      onClose();
    } finally { setBusy(false); }
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
            {form.code} · {firstNameOnly(student.name)} {student.code}
            {form.yearOnly ? ` · YEAR ${form.yearOnly}` : ''}
          </p>
        </div>
      </div>

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

      <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', marginTop: 12 }}>
        <label className="field">
          <span>{t('ชื่อผู้ป่วย')}</span>
          <input className="input" value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder={t('ตามที่เขียนในฟอร์ม')} />
        </label>
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
