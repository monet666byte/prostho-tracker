/**
 * Section III ฝั่งอาจารย์ — Knowledge & skill assessments (สมุด portfolio)
 *
 * โครงเดียวกับกระดาษ: เลือกนักศึกษา → เลือกใบ → กา O/S/U ทีละข้อ → รวมคะแนน /10
 * นิยามใบทั้ง 15 อยู่ที่ domain/sect3.ts (ถอดจากสมุดจริง Edited: 3 May 2024)
 *
 * ⚠️ เก็บได้หลายครั้งต่อใบ — ยังไม่ยืนยันกับภาคว่าประเมินซ้ำได้ไหม (ค้างถาม 7 ก.ย. 69)
 *    ถ้าภาคตอบว่าครั้งเดียว ล็อกที่หน้าจอนี้พอ ไม่ต้องแตะฐานข้อมูล
 */
import { ArrowLeft, CheckCircle, Trash, Student as StudentIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { studentYear } from '../../domain/cohort';
import { firstNameOnly, groupShort } from '../../domain/group';
import { saYearNow } from '../../domain/saFeedback';
import {
  S3_FULL_SCORE, SECT3_FORMS, s3Points, sect3Form, sect3FormsFor, sect3Total,
  type S3Form, type S3Grade,
} from '../../domain/sect3';
import { deleteSect3, saveSect3 } from '../../data/repo';
import { useAllStudents, useSect3 } from '../../hooks/data';
import { thaiShort, toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';
import type { Sect3Record, Student } from '../../domain/types';

const GRADES: Array<{ v: S3Grade; label: string; th: string }> = [
  { v: 'O', label: 'Outstanding', th: 'ดีมาก' },
  { v: 'S', label: 'Satisfactory', th: 'พอใช้' },
  { v: 'U', label: 'Unsatisfactory', th: 'ต้องแก้ไข' },
];

/** ใบล่าสุดของแต่ละ formKey — ตารางสรุปโชว์ครั้งหลังสุด ส่วนครั้งก่อนดูได้ในใบ */
function latestByForm(rows: Sect3Record[]): Map<string, Sect3Record> {
  const m = new Map<string, Sect3Record>();
  for (const r of rows) if (!m.has(r.formKey)) m.set(r.formKey, r); // listSect3 เรียงล่าสุดก่อนแล้ว
  return m;
}

export default function Sect3Page() {
  const { teacherGroup, showToast } = useApp();
  const students = useAllStudents();
  const year = saYearNow();
  const [selId, setSelId] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const roster = useMemo(
    () => students.filter((s) => s.group === teacherGroup).sort((a, b) => a.code.localeCompare(b.code)),
    [students, teacherGroup],
  );
  const student = roster.find((s) => s.id === selId) ?? null;
  const rows = useSect3(student?.id, year);
  const latest = latestByForm(rows);
  const classYear = student ? studentYear(student) : 5;
  const forms = sect3FormsFor(classYear);
  const openForm = openKey ? sect3Form(openKey) : undefined;

  return (
    <TeacherShell active="sect3">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('ความรู้และทักษะ')} · {groupShort(teacherGroup)}</h1>
            <p>
              {t('Section III ของสมุด Clinical Performance Portfolio — กาผลแล้วพิมพ์ออกไปลงนามบนกระดาษ')}
              {' · '}
              {t('Section I คือหน้า “ประเมินรายคาบ”')}
            </p>
          </div>
        </div>

        <div className="salayout">
          {/* ── รายชื่อในกลุ่ม ── */}
          <div className="panel">
          <h3>{t('กลุ่ม')} {groupShort(teacherGroup)}</h3>
          <p className="sub">{t('ปีการศึกษา')} {year}</p>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {roster.map((s) => (
              <RosterRow key={s.id} student={s} year={year} on={s.id === selId}
                onPick={() => { setSelId(s.id); setOpenKey(null); }} />
            ))}
            {!roster.length && <p className="sub">{t('ยังไม่มีนักศึกษาในกลุ่มนี้')}</p>}
          </div>
          </div>

          {/* ── ใบประเมิน ── */}
          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          {!student && (
            <div className="panel"><p className="sub">{t('เลือกนักศึกษาเพื่อดูใบประเมิน')}</p></div>
          )}

          {student && !openForm && (
            <div className="panel">
              <h3>{firstNameOnly(student.name)} · {student.code}</h3>
              <p className="sub">
                {t('ชั้นปี {n}', { n: classYear })} · {t('ประเมินแล้ว')} <b>{latest.size}</b>/{forms.length} {t('ใบ')}
                {classYear < 6 && ` · ${t('ใบ recall เป็นของปี 6')}`}
              </p>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {(['CD', 'RPD', 'FDP'] as const).map((g) => (
                  <FormGroup key={g} group={g} forms={forms} latest={latest} onOpen={setOpenKey} />
                ))}
              </div>
            </div>
          )}

          {student && openForm && (
            <GradeSheet
              key={openForm.key}
              form={openForm}
              student={student}
              classYear={classYear}
              year={year}
              history={rows.filter((r) => r.formKey === openForm.key)}
              onClose={() => setOpenKey(null)}
              onSaved={(n) => showToast({
                message: n === null ? t('บันทึกร่างแล้ว — ยังกาไม่ครบทุกข้อ') : t('บันทึกแล้ว · ได้ {n}/{m}', { n, m: S3_FULL_SCORE }),
                tone: 'success',
              })}
              onDeleted={() => showToast({ message: t('ลบผลประเมินแล้ว'), tone: 'success' })}
            />
            )}
          </div>
        </div>
      </main>
    </TeacherShell>
  );
}

/* ── รายชื่อหนึ่งแถว — โชว์ว่าประเมินไปกี่ใบแล้ว ─────────────────────────── */
function RosterRow({ student, year, on, onPick }: {
  student: Student; year: number; on: boolean; onPick: () => void;
}) {
  const rows = useSect3(student.id, year);
  const done = latestByForm(rows).size;
  const total = sect3FormsFor(studentYear(student)).length;
  return (
    <button
      onClick={onPick}
      data-on={on}
      className="card"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', textAlign: 'left',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
        background: on ? 'var(--accent-tint)' : 'transparent', cursor: 'pointer',
      }}
    >
      <StudentIcon size={16} weight={done === total ? 'fill' : 'regular'}
        color={done === total ? 'var(--success-dark)' : 'var(--text-faint)'} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: '600 12px var(--font-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {firstNameOnly(student.name)}
        </span>
        <span style={{ display: 'block', font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)' }}>
          {student.code}
        </span>
      </span>
      <span style={{ font: '600 11px var(--font-mono)', color: done === total ? 'var(--success-dark)' : 'var(--text-muted)' }}>
        {done}/{total}
      </span>
    </button>
  );
}

/* ── ใบทั้งหมดของหนึ่งประเภทงาน ─────────────────────────────────────────── */
function FormGroup({ group, forms, latest, onOpen }: {
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
                  <span style={{ display: 'block', font: '700 13px var(--font-mono)', color: 'var(--success-dark)' }}>
                    {r.total === null ? '—' : `${r.total}/${S3_FULL_SCORE}`}
                  </span>
                  <span style={{ display: 'block', font: '400 9.5px var(--font-body)', color: 'var(--text-faint)' }}>
                    {thaiShort(r.at)}
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
function GradeSheet({ form, student, classYear, year, history, onClose, onSaved, onDeleted }: {
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

  function reset(row?: Sect3Record) {
    setEditing(row?.id);
    setGrades(row?.grades ?? {});
    setPatientName(row?.patientName ?? '');
    setHn(row?.hn ?? '');
    setAt(row?.at ?? toISODate(new Date()));
  }

  async function save() {
    setBusy(true);
    try {
      await saveSect3({
        id: editing, studentId: student.id, formKey: form.key, academicYear: year, classYear,
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

/** ใช้ที่หน้าอื่นได้ — รวมคะแนน Section III ของ นศ. คนหนึ่ง แยกตามประเภทงานและ K/S */
export function sect3Summary(rows: Sect3Record[]) {
  const latest = latestByForm(rows);
  const out: Record<string, { k: number[]; s: number[] }> = {};
  for (const [key, r] of latest) {
    const f = SECT3_FORMS.find((x) => x.key === key);
    if (!f || f.part !== 'A' || r.total === null) continue;
    const bucket = (out[f.group] ??= { k: [], s: [] });
    (f.kind === 'K' ? bucket.k : bucket.s).push(r.total);
  }
  return out;
}
