/**
 * สมุด portfolio ฝั่งอาจารย์ — Section II และ Section III อยู่หน้าเดียวกัน
 *
 * ทำไมรวมหน้าเดียวแล้วใช้แท็บ (ผู้ใช้ทัก 7 ก.ย. 69 ว่าเห็น "Section III" เดี่ยวๆ แล้วงง):
 * พอวาง Sect II กับ Sect III ไว้ข้างกัน คนเห็นทันทีว่านี่คือของจากสมุดเล่มเดียวกัน
 * และมีที่ให้บอกได้ว่า Section I คือหน้า "ประเมินรายคาบ" ที่มีอยู่แล้ว
 *
 * ทุกใบมีลายเซ็นอาจารย์บนกระดาษ → หน้านี้ทำหน้าที่ "คีย์ครั้งเดียวแล้วพิมพ์ไปเซ็น"
 * ไม่ได้ตั้งใจแทนลายเซ็น
 */
import { Printer, Student as StudentIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { RpdDesignSheet, Sect2ScoreSheet, sect2Status } from '../../components/teacher/Sect2Sheet';
import { Sect3FormGroup, Sect3Sheet, latestByForm } from '../../components/teacher/Sect3Sheet';
import { studentYear } from '../../domain/cohort';
import { firstNameOnly, groupShort } from '../../domain/group';
import { saYearNow } from '../../domain/saFeedback';
import { SECT2_FORMS, sect2Form } from '../../domain/sect2';
import { S3_FULL_SCORE, sect3Form, sect3FormsFor } from '../../domain/sect3';
import { useAllStudents, useSect2, useSect3 } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import type { Student } from '../../domain/types';

type Tab = 'sect2' | 'sect3';

/** ใบทั้งหมดของ Section II — สองใบแรกให้คะแนน ใบที่สามผ่าน/ไม่ผ่าน */
const SECT2_ROWS = [
  { key: 'removable', code: 'Sect II', label: 'Removable prosthesis case · examination and treatment planning' },
  { key: 'fixed', code: 'Sect II', label: 'Fixed prosthesis case · examination and treatment planning' },
  { key: 'rpdDesign', code: 'Design', label: 'RPD Design examination form' },
] as const;

export default function Portfolio() {
  const { teacherGroup, showToast } = useApp();
  const navigate = useNavigate();
  const students = useAllStudents();
  const year = saYearNow();
  /* Section II กับ III เป็นคนละเมนูในแถบซ้ายแล้ว (ผู้ใช้เสนอ 7 ก.ย. 69)
     หน้านี้จึงอ่านว่าเปิดมาจากเมนูไหนแทนการมีแท็บซ้อนข้างใน — เมนูทำหน้าที่นั้นแทน */
  const tab: Tab = useLocation().pathname.endsWith('/sect3') ? 'sect3' : 'sect2';
  const [selId, setSelId] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const roster = useMemo(
    () => students.filter((s) => s.group === teacherGroup).sort((a, b) => a.code.localeCompare(b.code)),
    [students, teacherGroup],
  );
  const student = roster.find((s) => s.id === selId) ?? null;
  const classYear = student ? studentYear(student) : 5;

  const rows2 = useSect2(student?.id, year);
  const rows3 = useSect3(student?.id, year);
  const latest2 = latestByForm(rows2);
  const latest3 = latestByForm(rows3);
  const forms3 = sect3FormsFor(classYear);

  return (
    <TeacherShell active={tab}>
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            {/* ชื่อหัวข้อภาษาอังกฤษตามที่พิมพ์บนหัวกระดาษจริง — อาจารย์เทียบกับเล่มได้ทันที */}
            <h1>
              {tab === 'sect2' ? t('ตรวจและวางแผนการรักษา') : t('ความรู้และทักษะ')} · {groupShort(teacherGroup)}
            </h1>
            <p>
              {tab === 'sect2'
                ? 'Section II: Patient examination and treatment planning assessments'
                : 'Section III: Knowledge and skill assessments in specific prosthodontic procedures'}
              {' · '}
              {t('คีย์ผลที่นี่ แล้วพิมพ์ออกไปลงนามบนกระดาษ')}
            </p>
          </div>
        </div>

        <div className="salayout">
          <div className="panel">
            <h3>{t('กลุ่ม')} {groupShort(teacherGroup)}</h3>
            <p className="sub">{t('ปีการศึกษา')} {year}</p>
            <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
              {roster.map((s) => (
                <RosterRow key={s.id} student={s} year={year} tab={tab} on={s.id === selId}
                  onPick={() => { setSelId(s.id); setOpenKey(null); }} />
              ))}
              {!roster.length && <p className="sub">{t('ยังไม่มีนักศึกษาในกลุ่มนี้')}</p>}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            {!student && (
              <div className="panel"><p className="sub">{t('เลือกนักศึกษาเพื่อดูใบประเมิน')}</p></div>
            )}

            {/* ── Section II ── */}
            {student && tab === 'sect2' && !openKey && (
              <div className="panel">
                <StudentHead
                  student={student}
                  note={`${t('ชั้นปี {n}', { n: classYear })} · ${t('ประเมินแล้ว')} ${latest2.size}/3 ${t('ใบ')}`}
                  canPrint={latest2.size + latest3.size > 0}
                  onPrint={() => navigate(`/teacher/portfolio/${student.id}/print`)}
                />
                <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                  {SECT2_ROWS.map((r) => (
                    <FormRow
                      key={r.key}
                      code={r.code}
                      label={r.label}
                      status={sect2Status(latest2.get(r.key))}
                      at={latest2.get(r.key)?.at}
                      by={latest2.get(r.key)?.by}
                      onOpen={() => setOpenKey(r.key)}
                    />
                  ))}
                </div>
              </div>
            )}

            {student && tab === 'sect2' && openKey === 'rpdDesign' && (
              <RpdDesignSheet
                student={student} classYear={classYear} year={year}
                history={rows2.filter((r) => r.formKey === 'rpdDesign')}
                onClose={() => setOpenKey(null)}
                onSaved={(ok) => showToast({
                  message: ok ? t('บันทึกแล้ว · ผ่านครบทุกข้อ') : t('บันทึกแล้ว · ยังไม่ผ่านครบ'),
                  tone: ok ? 'success' : 'warning',
                })}
                onDeleted={() => showToast({ message: t('ลบผลประเมินแล้ว'), tone: 'success' })}
              />
            )}

            {student && tab === 'sect2' && openKey && openKey !== 'rpdDesign' && sect2Form(openKey) && (
              <Sect2ScoreSheet
                key={openKey}
                form={sect2Form(openKey)!}
                student={student} classYear={classYear} year={year}
                history={rows2.filter((r) => r.formKey === openKey)}
                onClose={() => setOpenKey(null)}
                onSaved={(n) => showToast({
                  message: n === null ? t('บันทึกร่างแล้ว — ยังกาไม่ครบทุกข้อ') : t('บันทึกแล้ว · ได้ {n}/{m}', { n, m: 70 }),
                  tone: 'success',
                })}
                onDeleted={() => showToast({ message: t('ลบผลประเมินแล้ว'), tone: 'success' })}
              />
            )}

            {/* ── Section III ── */}
            {student && tab === 'sect3' && !openKey && (
              <div className="panel">
                <StudentHead
                  student={student}
                  note={`${t('ชั้นปี {n}', { n: classYear })} · ${t('ประเมินแล้ว')} ${latest3.size}/${forms3.length} ${t('ใบ')}`
                    + (classYear < 6 ? ` · ${t('ใบ recall เป็นของปี 6')}` : '')}
                  canPrint={latest2.size + latest3.size > 0}
                  onPrint={() => navigate(`/teacher/portfolio/${student.id}/print`)}
                />
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                  {(['CD', 'RPD', 'FDP'] as const).map((g) => (
                    <Sect3FormGroup key={g} group={g} forms={forms3} latest={latest3} onOpen={setOpenKey} />
                  ))}
                </div>
              </div>
            )}

            {student && tab === 'sect3' && openKey && sect3Form(openKey) && (
              <Sect3Sheet
                key={openKey}
                form={sect3Form(openKey)!}
                student={student} classYear={classYear} year={year}
                history={rows3.filter((r) => r.formKey === openKey)}
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

/** หัวบล็อกของ นศ. ที่เลือก — ปุ่มพิมพ์รวมทุกใบที่ประเมินแล้ว ไม่แยกตามแท็บ
    เพราะเวลาส่งเล่มจริงส่งทั้งเล่ม ไม่ได้ส่งทีละ Section */
function StudentHead({ student, note, canPrint, onPrint }: {
  student: Student; note: string; canPrint: boolean; onPrint: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 'min(150px, 100%)' }}>
        <h3 style={{ margin: 0 }}>{firstNameOnly(t(student.name))} · {student.code}</h3>
        <p className="sub" style={{ margin: '2px 0 0' }}>{note}</p>
      </div>
      <button className="btn btn--sec" style={{ height: 40 }} disabled={!canPrint} onClick={onPrint}>
        <Printer size={15} /> {t('พิมพ์')}
      </button>
    </div>
  );
}

/** แถวใบใน Section II — โครงเดียวกับ Sect3FormGroup แต่ใบน้อยกว่าและสถานะเป็นข้อความ */
function FormRow({ code, label, status, at, by, onOpen }: {
  code: string; label: string; status: { text: string; done: boolean } | null;
  at?: string; by?: string; onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
    >
      <span style={{ font: '700 10px var(--font-mono)', color: 'var(--text-muted)', width: 54, flex: 'none' }}>{code}</span>
      <span style={{ flex: 1, minWidth: 0, font: '500 12px/1.45 var(--font-body)' }}>{label}</span>
      {status ? (
        <span style={{ textAlign: 'right', flex: 'none' }}>
          <span style={{
            display: 'block', font: '700 13px var(--font-mono)',
            color: status.done ? 'var(--success-dark)' : 'var(--warning-dark)',
          }}>{status.text}</span>
          {at && (
            <span style={{ display: 'block', font: '400 9.5px var(--font-body)', color: 'var(--text-faint)' }}>
              {thaiShort(at)}{by ? ` · ${by}` : ''}
            </span>
          )}
        </span>
      ) : (
        <span style={{ font: '500 10.5px var(--font-body)', color: 'var(--text-faint)', flex: 'none' }}>{t('ยังไม่ประเมิน')}</span>
      )}
    </button>
  );
}

function RosterRow({ student, year, tab, on, onPick }: {
  student: Student; year: number; tab: Tab; on: boolean; onPick: () => void;
}) {
  const rows2 = useSect2(student.id, year);
  const rows3 = useSect3(student.id, year);
  const done = tab === 'sect2' ? latestByForm(rows2).size : latestByForm(rows3).size;
  const total = tab === 'sect2' ? SECT2_FORMS.length + 1 : sect3FormsFor(studentYear(student)).length;
  const full = done === total;
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
      <StudentIcon size={16} weight={full ? 'fill' : 'regular'}
        color={full ? 'var(--success-dark)' : 'var(--text-faint)'} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: '600 12px var(--font-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {firstNameOnly(t(student.name))}
        </span>
        <span style={{ display: 'block', font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)' }}>{student.code}</span>
      </span>
      <span style={{ font: '600 11px var(--font-mono)', color: full ? 'var(--success-dark)' : 'var(--text-muted)' }}>
        {done}/{total}
      </span>
    </button>
  );
}
