/**
 * หน้า "ประเมินตนเอง" ฝั่งอาจารย์ — ปีละครั้ง ตอนจบเทอม 1
 *
 * สามชั้นจากบนลงล่าง:
 *   ① ใครส่งแล้ว/ยังไม่ส่ง ในกลุ่มที่ดูแล
 *   ② สรุปอัตโนมัติที่เทียบคำตอบกับผลงานจริง (กฎอยู่ที่ domain/saFeedback.ts)
 *   ③ คำตอบดิบทุกข้อ เผื่ออาจารย์อยากอ่านเอง
 *
 * ⚠️ ชั้น ② เห็นเฉพาะที่นี่ ว่านักศึกษาไม่ต้องเห็นสรุป
 *    เป็นเครื่องมือเตรียมตัวของอาจารย์ก่อนนัดคุย ไม่ใช่ผลป้อนกลับที่ส่งถึงนักศึกษา
 */
import { Printer, Student as StudentIcon } from '@phosphor-icons/react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { SaSummary } from '../../components/SaSummary';
import { Radar } from '../../components/charts/Radar';
import { CRITERIA, MAX_SCORE } from '../../domain/checkin';
import { firstNameOnly, groupShort } from '../../domain/group';
import { saYearNow } from '../../domain/saFeedback';
import {
  SA_APPROPRIATE, readableAnswer, saColLabel, saLabel, saSectionLabel, saSectionsFor, saSub,
  type SAValue,
} from '../../domain/selfAssessment';
import { saId } from '../../data/repo';
import { useAllCheckIns, useAllStudents, useSelfAssessments } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { personName, t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import type { ProfileAxis } from '../../domain/analytics';
import type { SelfAssessment, Student } from '../../domain/types';

/**
 * กราฟแมงมุมสองชั้น: นักศึกษาให้ตัวเอง vs อาจารย์ให้จริง
 * แปลงทั้งสองฝั่งเป็น % ของเต็ม จึงอยู่บนรูปเดียวกันได้ (คนละสเกล 0–1 กับ 0–3)
 */
function compareAxes(sa: SelfAssessment, scores: Array<Record<string, number>>): { self: ProfileAxis[]; teacher: ProfileAxis[] } | null {
  const PAIRS: Array<[string, string]> = [
    ['profPrecaution', 'precaution'],
    ['profInstrument', 'instrument'],
    ['profTime', 'time'],
    ['profCommunication', 'communication'],
    ['profDocuments', 'chart'],
    ['profAppearance', 'conduct'],
  ];
  if (!scores.length) return null;
  const self: ProfileAxis[] = [];
  const teacher: ProfileAxis[] = [];
  for (const [saKey, critKey] of PAIRS) {
    const crit = CRITERIA.find((c) => c.key === critKey);
    if (!crit) continue;
    const v = sa.answers[saKey];
    const vals = scores.map((s) => s[critKey]).filter((x): x is number => typeof x === 'number');
    if (typeof v !== 'number' || !vals.length) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    self.push({ key: crit.key, label: crit.short, value: v === SA_APPROPRIATE ? 100 : 40, detail: v === SA_APPROPRIATE ? 'Appropriate' : 'Need improvement' });
    teacher.push({ key: crit.key, label: crit.short, value: (mean / MAX_SCORE) * 100, detail: `${mean.toFixed(1)}/${MAX_SCORE}` });
  }
  return self.length >= 3 ? { self, teacher } : null;
}

export default function SelfAssessments() {
  const group = useApp((s) => s.teacherGroup);
  const thisYear = saYearNow();
  /* ดูปีย้อนหลังได้ — ภาคเก็บ 5 รุ่น ถ้าผูกกับปีปัจจุบันตายตัว พอ 1 มิ.ย. ทุกอย่างของปีก่อนจะหายจากจอ */
  const [year, setYear] = useState(thisYear);
  const students = useAllStudents();
  const allRows = useSelfAssessments();
  const rows = useMemo(() => allRows.filter((r) => r.academicYear === year), [allRows, year]);
  const years = useMemo(
    () => [...new Set([thisYear, ...allRows.map((r) => r.academicYear)])].sort((a, b) => b - a),
    [allRows, thisYear],
  );
  const checkins = useAllCheckIns();
  const [openId, setOpenId] = useState<string | null>(null);
  const navigate = useNavigate();

  const groupStudents = useMemo(
    () => students.filter((s) => s.group === group).sort((a, b) => a.code.localeCompare(b.code)),
    [students, group],
  );
  /* หนึ่งคนควรมีหนึ่งแถวต่อปี — แต่ id ตั้งจากฝั่ง client ถ้ามีใครยิง API สร้างแถวซ้ำ
     ต้องไม่ให้แถวปลอมทับฉบับจริง: เอาแถวที่ id ตรงสูตร (saId) ก่อน แล้วค่อยแถวที่ส่งแล้ว
     (0011 ปิดที่ฐานข้อมูลอีกชั้น — ตรงนี้กันไว้เผื่อยังไม่ได้รัน) */
  const byStudent = useMemo(() => {
    const m = new Map<string, SelfAssessment>();
    for (const r of rows) {
      const cur = m.get(r.studentId);
      const canonical = r.id === saId(r.studentId, r.academicYear);
      const curCanonical = cur && cur.id === saId(cur.studentId, cur.academicYear);
      if (!cur || (canonical && !curCanonical) || (!curCanonical && r.status === 'submitted' && cur.status !== 'submitted')) {
        m.set(r.studentId, r);
      }
    }
    return m;
  }, [rows]);
  const sent = groupStudents.filter((s) => byStudent.get(s.id)?.status === 'submitted');

  const openStudent: Student | undefined = groupStudents.find((s) => s.id === openId);
  const openSa = openId ? byStudent.get(openId) : undefined;

  const openScores = useMemo(
    () => checkins
      .filter((c) => c.studentId === openId && c.status === 'evaluated' && c.scores)
      .map((c) => c.scores as Record<string, number>),
    [checkins, openId],
  );
  const compare = openSa && openSa.status === 'submitted' ? compareAxes(openSa, openScores) : null;

  return (
    <TeacherShell active="sa">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('ประเมินตนเอง')} · {groupShort(group)}</h1>
            <p>
              {t('ปีการศึกษา {y} · ส่งแล้ว {a}/{b} คน', { y: year, a: sent.length, b: groupStudents.length })}
            </p>
          </div>
          {years.length > 1 && (
            <div className="seg seg--sm">
              {years.map((y) => (
                <button key={y} data-on={y === year} onClick={() => { setYear(y); setOpenId(null); }}>
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* สองคอลัมน์บนจอกว้าง · จอแคบ (อาจารย์เปิดจากมือถือ) ซ้อนเป็นคอลัมน์เดียว — กฎอยู่ท้าย teacher.css */}
        <div className="salayout">
          {/* ① ใครส่งแล้ว — รายการเดียวคั่นเส้น แบบหน้า Section II/III */}
          <div className="panel plist">
            <div className="plist__head">{t('นักศึกษา · {n} คน', { n: groupStudents.length })}</div>
            {groupStudents.length === 0 && (
              <p className="sub" style={{ padding: '0 16px 14px' }}>{t('กลุ่มนี้ยังไม่มีนักศึกษา')}</p>
            )}
            {groupStudents.map((s) => {
              const sa = byStudent.get(s.id);
              const done = sa?.status === 'submitted';
              const on = openId === s.id;
              return (
                <button key={s.id} className="plist__row" data-on={on} aria-pressed={on} onClick={() => setOpenId(on ? null : s.id)}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="plist__name">{firstNameOnly(personName(s))}</span>
                    <span className="plist__code">{s.code}</span>
                  </span>
                  <span className="plist__count" style={{ color: done ? 'var(--success-dark)' : 'var(--text-faint)', fontFamily: 'var(--font-body)' }}>
                    {done ? t('ส่งแล้ว') : sa ? t('กรอกค้าง') : t('ยังไม่ส่ง')}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ②③ รายละเอียดคนที่เลือก */}
          <div style={{ display: 'grid', gap: 12 }}>
            {!openStudent && (
              <div className="card" style={{ padding: '26px 18px', display: 'grid', placeItems: 'center', gap: 8, textAlign: 'center' }}>
                <StudentIcon size={26} color="var(--text-disabled)" />
                <span style={{ font: '600 13px var(--font-body)', color: 'var(--text-muted)' }}>{t('เลือกนักศึกษาทางซ้าย')}</span>
                <span style={{ font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-faint)', maxWidth: 420 }}>
                  {t('ระบบจะเทียบคำตอบกับจำนวนชิ้นงาน ความก้าวหน้าของเคส และคะแนนรายคาบให้อัตโนมัติ')}
                </span>
              </div>
            )}

            {openStudent && !openSa && (
              <div className="card" style={{ padding: '18px', font: '400 12px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
                {t('{n} ยังไม่ได้เริ่มกรอกแบบประเมินตนเองของปีนี้', { n: firstNameOnly(personName(openStudent)) })}
              </div>
            )}

            {openStudent && openSa && openSa.status !== 'submitted' && (
              <div className="card" style={{ padding: '18px', font: '400 12px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
                {t('กรอกค้างไว้ ยังไม่ได้กดส่ง — แก้ไขล่าสุด {d}', { d: thaiShort(openSa.updatedAt) })}
              </div>
            )}

            {openStudent && openSa?.status === 'submitted' && (
              <>
                <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 'min(160px, 100%)' }}>
                    <span style={{ display: 'block', font: '600 13px var(--font-head)' }}>{firstNameOnly(personName(openStudent))}</span>
                    <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
                      {t('ส่งเมื่อ {d} · ชั้นปี {y} · ฟอร์มฉบับ {v}', {
                        d: thaiShort(openSa.submittedAt ?? openSa.updatedAt), y: openSa.classYear, v: openSa.formVersion,
                      })}
                    </span>
                  </span>
                  <button
                    className="btn btn--sec"
                    style={{ height: 38, width: 'auto', flex: '0 0 auto', padding: '0 14px', font: '600 11.5px var(--font-body)' }}
                    onClick={() => navigate(`/teacher/sa/${openSa.studentId}/print`)}
                  >
                    <Printer size={14} /> {t('พิมพ์')}
                  </button>
                </div>

                {compare && (
                  <div className="card" style={{ padding: '12px 14px' }}>
                    <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 2 }}>
                      {t('นักศึกษามองตัวเอง เทียบกับคะแนนที่ได้รับจริง')}
                    </div>
                    <div style={{ font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)', marginBottom: 6 }}>
                      {t('เส้นอ้างอิงคือค่าเฉลี่ยจาก {n} คาบที่ประเมินแล้ว', { n: openScores.length })}
                    </div>
                    <div style={{ display: 'grid', placeItems: 'center' }}>
                      <Radar
                        axes={compare.self}
                        reference={compare.teacher}
                        label={t('นักศึกษาประเมินตัวเอง')}
                        referenceLabel={t('คะแนนจากอาจารย์')}
                        size={250}
                      />
                    </div>
                  </div>
                )}

                <SaSummary sa={openSa} />

                {/* ③ คำตอบดิบ */}
                {saSectionsFor(openSa.classYear).map((s) => (
                  <div key={s.key} className="card" style={{ padding: '12px 14px' }}>
                    <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 8 }}>{saSectionLabel(s)}</div>
                    <div style={{ display: 'grid', gap: 7 }}>
                      {s.questions.map((q) => (
                        <Fragment key={q.key}>
                        {saSub(q) && (
                          <div style={{ font: '600 10.5px var(--font-head)', color: 'var(--text-secondary)', marginTop: 3 }}>{saSub(q)}</div>
                        )}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                          <span style={{ flex: '0 0 210px', font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
                            {saLabel(q)}{q.col ? ` · ${saColLabel(q.col)}` : ''}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                            {readableAnswer(q, openSa.answers[q.key] as SAValue, openSa.answers as Record<string, SAValue>) || <span className="faint">{t('ไม่ได้ตอบ')}</span>}
                          </span>
                        </div>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </main>
    </TeacherShell>
  );
}
