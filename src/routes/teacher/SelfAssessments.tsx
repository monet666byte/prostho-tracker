/**
 * หน้า "ประเมินตนเอง" ฝั่งอาจารย์ — ปีละครั้ง ตอนจบเทอม 1
 *
 * สามชั้นจากบนลงล่าง:
 *   ① ใครส่งแล้ว/ยังไม่ส่ง ในกลุ่มที่ดูแล
 *   ② สรุปอัตโนมัติที่เทียบคำตอบกับผลงานจริง (กฎอยู่ที่ domain/saFeedback.ts)
 *   ③ คำตอบดิบทุกข้อ เผื่ออาจารย์อยากอ่านเอง
 * ปุ่มสุดท้ายคือ "ปล่อยให้นักศึกษาเห็น" — ก่อนกด นักศึกษาไม่เห็นสรุปเลย
 */
import { ArrowCounterClockwise, CheckCircle, Clock, PaperPlaneTilt, Printer, Sparkle, Student as StudentIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { SaSummary } from '../../components/SaSummary';
import { Radar } from '../../components/charts/Radar';
import { releaseSaFeedback, unreleaseSaFeedback } from '../../data/repo';
import { CRITERIA, MAX_SCORE } from '../../domain/checkin';
import { firstNameOnly, groupShort } from '../../domain/group';
import { saYearNow } from '../../domain/saFeedback';
import {
  SA_APPROPRIATE, saLabel, saOption, saSectionLabel, saSectionsFor, SA_SCALE,
  type SAQuestion, type SAValue,
} from '../../domain/selfAssessment';
import { useAllCheckIns, useAllStudents, useSelfAssessments } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { lang, t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';
import type { ProfileAxis } from '../../domain/analytics';
import type { SelfAssessment, Student } from '../../domain/types';

/** อ่านค่าคำตอบเป็นข้อความ — เหมือนฝั่งนักศึกษา แต่หน้านี้ไม่ได้ import จอ นศ. มาทั้งไฟล์ */
function readable(q: SAQuestion, v: SAValue | undefined): string {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) {
    return v.map((x) => {
      const i = (q.options ?? []).indexOf(x);
      return i >= 0 ? saOption(q, i) : x;
    }).join(' · ');
  }
  if (typeof v === 'number') {
    if (q.kind === 'level') return v === SA_APPROPRIATE ? (lang === 'en' ? 'Appropriate' : 'เหมาะสมแล้ว') : (lang === 'en' ? 'Need improvement' : 'ต้องปรับปรุง');
    if (q.kind === 'yesno') return v === 1 ? (lang === 'en' ? 'Yes' : 'ใช่') : (lang === 'en' ? 'No' : 'ไม่');
    if (v < 0) return 'N/A';
    const s = SA_SCALE.find((x) => x.v === v);
    return s ? `${v} · ${lang === 'en' ? s.label : s.th}` : String(v);
  }
  return String(v);
}

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
  const { showToast } = useApp();
  const year = saYearNow();
  const students = useAllStudents();
  const rows = useSelfAssessments(year);
  const checkins = useAllCheckIns();
  const [openId, setOpenId] = useState<string | null>(null);
  const navigate = useNavigate();
  const [note, setNote] = useState('');

  const groupStudents = useMemo(
    () => students.filter((s) => s.group === group).sort((a, b) => a.code.localeCompare(b.code)),
    [students, group],
  );
  const byStudent = useMemo(() => new Map(rows.map((r) => [r.studentId, r])), [rows]);
  const sent = groupStudents.filter((s) => byStudent.get(s.id)?.status === 'submitted');
  const released = sent.filter((s) => byStudent.get(s.id)?.feedbackReleasedAt);

  const openStudent: Student | undefined = groupStudents.find((s) => s.id === openId);
  const openSa = openId ? byStudent.get(openId) : undefined;

  const openScores = useMemo(
    () => checkins
      .filter((c) => c.studentId === openId && c.status === 'evaluated' && c.scores)
      .map((c) => c.scores as Record<string, number>),
    [checkins, openId],
  );
  const compare = openSa && openSa.status === 'submitted' ? compareAxes(openSa, openScores) : null;

  async function release() {
    if (!openSa) return;
    await releaseSaFeedback(openSa.studentId, year, note, currentActor());
    setNote('');
    showToast({ message: t('ปล่อยสรุปให้นักศึกษาเห็นแล้ว'), tone: 'success' });
  }

  return (
    <TeacherShell active="sa">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('ประเมินตนเอง')} · {groupShort(group)}</h1>
            <p>
              {t('ปีการศึกษา {y} · ส่งแล้ว {a}/{b} คน · ปล่อยสรุปแล้ว {c}', {
                y: year, a: sent.length, b: groupStudents.length, c: released.length,
              })}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          {/* ① ใครส่งแล้ว */}
          <div style={{ display: 'grid', gap: 7 }}>
            {groupStudents.length === 0 && (
              <div className="card" style={{ padding: '12px 14px', font: '400 12px var(--font-body)', color: 'var(--text-muted)' }}>
                {t('กลุ่มนี้ยังไม่มีนักศึกษา')}
              </div>
            )}
            {groupStudents.map((s) => {
              const sa = byStudent.get(s.id);
              const done = sa?.status === 'submitted';
              const on = openId === s.id;
              return (
                <button
                  key={s.id}
                  className="card"
                  onClick={() => { setOpenId(on ? null : s.id); setNote(sa?.advisorNote ?? ''); }}
                  style={{
                    padding: '10px 12px', textAlign: 'left', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', gap: 9, borderColor: on ? 'var(--accent)' : undefined,
                  }}
                >
                  <span
                    style={{
                      width: 26, height: 26, borderRadius: 8, flex: 'none', display: 'grid', placeItems: 'center',
                      background: done ? 'var(--success-tint)' : 'var(--fill)',
                      color: done ? 'var(--success-dark)' : 'var(--text-faint)',
                    }}
                  >
                    {done ? <CheckCircle size={15} weight="fill" /> : <Clock size={15} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: '600 12px var(--font-head)' }}>{firstNameOnly(t(s.name))}</span>
                    <span className="mono" style={{ display: 'block', font: '400 10px var(--font-mono)', color: 'var(--text-faint)' }}>
                      {s.code}
                    </span>
                  </span>
                  {sa?.feedbackReleasedAt && (
                    <span className="badge" style={{ background: 'var(--accent-tint)', color: 'var(--accent-hover)' }}>
                      {t('ปล่อยแล้ว')}
                    </span>
                  )}
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
                {t('{n} ยังไม่ได้เริ่มกรอกแบบประเมินตนเองของปีนี้', { n: firstNameOnly(t(openStudent.name)) })}
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
                  <span style={{ flex: 1, minWidth: 160 }}>
                    <span style={{ display: 'block', font: '600 13px var(--font-head)' }}>{firstNameOnly(t(openStudent.name))}</span>
                    <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
                      {t('ส่งเมื่อ {d} · ชั้นปี {y} · ฟอร์มฉบับ {v}', {
                        d: thaiShort(openSa.submittedAt ?? openSa.updatedAt), y: openSa.classYear, v: openSa.formVersion,
                      })}
                    </span>
                  </span>
                  <button
                    className="btn btn--sec"
                    style={{ height: 38, flex: '0 0 auto', font: '600 11.5px var(--font-body)' }}
                    onClick={() => navigate(`/teacher/sa/${openSa.studentId}/print`)}
                  >
                    <Printer size={14} /> {t('พิมพ์สำหรับลงนาม')}
                  </button>
                  {openSa.feedbackReleasedAt ? (
                    <button
                      className="btn btn--sec"
                      style={{ height: 38, flex: '0 0 auto', font: '600 11.5px var(--font-body)' }}
                      onClick={async () => {
                        await unreleaseSaFeedback(openSa.studentId, year, currentActor());
                        showToast({ message: t('ถอนสรุปกลับแล้ว — นักศึกษาไม่เห็นแล้ว'), tone: 'default' });
                      }}
                    >
                      <ArrowCounterClockwise size={14} /> {t('ถอนกลับ')}
                    </button>
                  ) : null}
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

                {/* กล่องเขียนความเห็น + ปล่อย */}
                <div className="card" style={{ padding: '12px 14px', display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Sparkle size={15} weight="fill" color="var(--accent)" />
                    <span style={{ font: '600 12.5px var(--font-head)' }}>{t('ปล่อยสรุปให้นักศึกษาเห็น')}</span>
                  </div>
                  <p style={{ margin: 0, font: '400 11px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                    {t('นักศึกษาจะยังไม่เห็นสรุปจนกว่าจะกดปุ่มนี้ — เขียนความเห็นของอาจารย์แนบไปด้วยได้')}
                  </p>
                  <textarea
                    className="input"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('ความเห็นถึงนักศึกษา (ไม่บังคับ)')}
                  />
                  <button className="btn" style={{ height: 42 }} onClick={release}>
                    <PaperPlaneTilt size={16} weight="fill" />
                    {openSa.feedbackReleasedAt ? t('อัปเดตสรุปที่ปล่อยไว้') : t('ปล่อยให้นักศึกษาเห็น')}
                  </button>
                  {openSa.feedbackReleasedAt && (
                    <span style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)' }}>
                      {t('ปล่อยเมื่อ {d} โดย {w}', { d: thaiShort(openSa.feedbackReleasedAt), w: t(openSa.feedbackReleasedBy ?? '') })}
                    </span>
                  )}
                </div>

                {/* ③ คำตอบดิบ */}
                {saSectionsFor(openSa.classYear).map((s) => (
                  <div key={s.key} className="card" style={{ padding: '12px 14px' }}>
                    <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 8 }}>{saSectionLabel(s)}</div>
                    <div style={{ display: 'grid', gap: 7 }}>
                      {s.questions.map((q) => (
                        <div key={q.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                          <span style={{ flex: '0 0 210px', font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
                            {saLabel(q)}{q.col ? ` · ${q.col}` : ''}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                            {readable(q, openSa.answers[q.key] as SAValue) || <span className="faint">{t('ไม่ได้ตอบ')}</span>}
                          </span>
                        </div>
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
