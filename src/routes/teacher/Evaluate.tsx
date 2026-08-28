import { CalendarCheck, CheckCircle, Signature } from '@phosphor-icons/react';
import { PhotoSlot } from '../../components/ui/Bits';
import { useMemo, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { Radar } from '../../components/charts/Radar';
import type { ProfileAxis } from '../../domain/analytics';
import { evaluateCheckIn } from '../../data/repo';
import { CRITERIA, MAX_TOTAL, SCORE_OPTIONS, totalScore } from '../../domain/checkin';
import { useAllCheckIns, useAllPatients, useAllStudents, useStepsOnDates, useTeacher } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';
import type { CheckIn } from '../../domain/types';
import { useApp } from '../../store/app';

/** เส้นคะแนนรายคาบของนักศึกษาหนึ่งคน — ใช้ได้ทั้งคะแนนรวม (0–24) และรายหัวข้อ (0–3) */
function ScoreTrend({
  rows,
  getValue = (c) => totalScore(c.scores) ?? 0,
  max = MAX_TOTAL,
  ticks = [8, 16, 24],
  height = 132,
}: {
  rows: CheckIn[];
  getValue?: (c: CheckIn) => number;
  max?: number;
  ticks?: number[];
  height?: number;
}) {
  const pts = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) {
    return <p className="faint" style={{ font: '400 11px var(--font-body)', margin: '20px 0' }}>{t('มีผลประเมินคาบเดียว — เส้นแนวโน้มจะขึ้นเมื่อมีตั้งแต่ 2 คาบ')}</p>;
  }
  const W = 460, H = height, padL = 34, padR = 40, padT = 24, padB = 26;
  const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('คะแนนรายคาบ')}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" style={{ font: '400 9px var(--font-mono)', fill: 'var(--text-faint)' }}>{v}</text>
        </g>
      ))}
      <polyline
        points={pts.map((c, i) => `${x(i)},${y(getValue(c))}`).join(' ')}
        fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
      />
      {pts.map((c, i) => {
        const v = getValue(c);
        return (
          <g key={c.id}>
            <circle cx={x(i)} cy={y(v)} r={4} fill="var(--accent)" stroke="#fff" strokeWidth={2}>
              <title>{`${thaiShort(c.date)} · ${v}/${max} · ${c.activities.join(', ')}`}</title>
            </circle>
            <text x={x(i)} y={y(v) - 9} textAnchor="middle" style={{ font: '600 9.5px var(--font-mono)', fill: 'var(--text-muted)' }}>{v}</text>
            {(pts.length <= 5 || i % 2 === 0 || i === pts.length - 1) && (
              <text x={x(i)} y={H - 8} textAnchor="middle" style={{ font: '400 9px var(--font-body)', fill: 'var(--text-faint)' }}>{thaiShort(c.date)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** หน้าประเมินรายคาบ — แทนการเซ็นสมุด Clinical rotation logbook ทีละแถว */
export default function Evaluate() {
  const { session, showToast } = useApp();
  const teacher = useTeacher(session?.teacherId);
  const students = useAllStudents();
  const patients = useAllPatients();
  const checkins = useAllCheckIns();

  const group = useApp((st) => st.teacherGroup);
  // คะแนนที่กำลังกรอก ต่อ check-in (default 3 ทุกข้อ เหมือนที่อาจารย์ส่วนใหญ่ให้ในสมุดจริง)
  const [drafts, setDrafts] = useState<Record<string, Record<string, number>>>({});
  const [chartStudent, setChartStudent] = useState<string | null>(null);
  // หัวข้อที่กดเลือกบนกราฟแมงมุม — เปิดกราฟเส้นรายหัวข้อฝั่งขวา (คงไว้ตอนสลับคน จะได้เทียบหัวข้อเดิมข้ามคน)
  const [critKey, setCritKey] = useState<string | null>(null);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const patientById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  const inGroup = checkins.filter((c) => studentById.get(c.studentId)?.group === group);
  const groupStudents = useMemo(
    () => students.filter((st) => st.group === group).sort((a, b) => a.code.localeCompare(b.code)),
    [students, group],
  );
  const evaluatedInGroup = useMemo(() => inGroup.filter((c) => c.status === 'evaluated'), [inGroup]);

  // รายหัวข้อ (0–3) ต่อคน และของทั้งกลุ่มไว้เป็นเส้นเทียบ — รูปทรงกราฟใช้ค่าเฉลี่ย
  // แต่ตัวเลขที่โชว์เป็น "จำนวนครั้ง" ที่ได้ 3/1/0 (อาจารย์คอมเมนต์ว่าไม่อยากเห็นเลขเฉลี่ย)
  const criterionAvg = (rows: CheckIn[]): ProfileAxis[] =>
    CRITERIA.map((cr) => {
      const vals = rows.map((c) => c.scores?.[cr.key] ?? 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const count = (n: number) => vals.filter((v) => v === n).length;
      return {
        key: cr.key,
        label: t(cr.short),
        value: Math.round((avg / 3) * 100),
        detail: t('ได้ 3 = {a} คาบ · ได้ 1 = {b} · ได้ 0 = {c}', { a: count(3), b: count(1), c: count(0) }),
        counts: [count(3), count(1), count(0)] as [number, number, number],
      };
    });
  const selectedId = chartStudent ?? groupStudents[0]?.id ?? null;
  const selectedRows = evaluatedInGroup.filter((c) => c.studentId === selectedId);
  const groupProfile = useMemo(() => criterionAvg(evaluatedInGroup), [evaluatedInGroup]);
  const stepsByKey = useStepsOnDates(inGroup.map((c) => ({ studentId: c.studentId, date: c.date })));
  const pending = inGroup.filter((c) => c.status === 'pending');
  const evaluatedAll = inGroup.filter((c) => c.status === 'evaluated');
  // ตารางประวัติยาวมาก — พับไว้ก่อน โชว์ 5 แถวล่าสุดพอ
  const [showAllEvaluated, setShowAllEvaluated] = useState(false);
  const evaluated = showAllEvaluated ? evaluatedAll.slice(0, 40) : evaluatedAll.slice(0, 5);

  const draftFor = (id: string) =>
    drafts[id] ?? Object.fromEntries(CRITERIA.map((c) => [c.key, 3]));

  async function sign(id: string) {
    await evaluateCheckIn(id, draftFor(id), teacher?.name ?? 'อ. ก.');
    showToast({ message: t('บันทึกผลประเมินแล้ว (เทียบเท่าลงนามในสมุด)'), tone: 'success' });
  }

  return (
    <TeacherShell active="evaluate">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('ประเมินรายคาบ')}</h1>
            <p>{t('กลุ่ม')} {group.replace('TH-', '')} · {t('คะแนน 3 / 1 / 0')}</p>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>
            {t('รอประเมิน')} · {t('{n} คน', { n: new Set(pending.map((c) => c.studentId)).size })}
            {pending.length > new Set(pending.map((c) => c.studentId)).size && ` (${t('{n} รายการ', { n: pending.length })})`}
          </h3>
          

          {pending.length === 0 && (
            <div className="dashed" style={{ marginTop: 12, padding: '22px 16px', textAlign: 'center', font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
              {t('ประเมินครบทุกคนแล้ว')}
            </div>
          )}

          <div style={{ display: 'grid', gap: 13, marginTop: 12 }}>
            {pending.map((c) => {
              const student = studentById.get(c.studentId);
              const patient = c.patientId ? patientById.get(c.patientId) : undefined;
              const draft = draftFor(c.id);
              const total = totalScore(draft) ?? 0;
              return (
                <div key={c.id} className="evalcard">
                  <div className="evalcard__info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ font: '600 13.5px var(--font-head)' }}>{t(student?.name ?? '')}</span>
                      <span className="mono" style={{ font: '400 10px var(--font-mono)', color: 'var(--text-faint)' }}>
                        {student?.code}
                      </span>
                      <span className="chip" style={{ background: 'var(--accent-tint)', color: 'var(--accent-hover)' }}>
                        <CalendarCheck size={12} weight="fill" /> {thaiShort(c.date)}{c.checkinAt ? ` · ${t('{time} น.', { time: c.checkinAt })}` : ''}
                      </span>
                      {!c.punctual && (
                        <span className="badge" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)' }}>{t('มาสาย')}</span>
                      )}
                      {c.noPatient && (
                        <span className="badge" style={{ background: 'var(--fill)', color: 'var(--text-muted)' }}>{t('ไม่มีผู้ป่วย')}</span>
                      )}
                    </div>
                    <div style={{ font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-body)', marginTop: 6 }}>
                      {c.activities.map((a) => t(a)).join(' · ')}
                      {patient && <span className="mono" style={{ color: 'var(--text-faint)' }}> · {t(patient.name)} (HN {patient.hn})</span>}
                    </div>
                    {c.note && (
                      <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 3 }}>{t('โน้ต')}: {c.note}</div>
                    )}

                    {/* หลักฐานจริงประกอบการให้คะแนน — step ที่นักศึกษาบันทึกว่าทำเสร็จในวันนั้น */}
                    <div
                      style={{
                        marginTop: 10, borderRadius: 10, padding: '9px 11px',
                        background: (stepsByKey.get(`${c.studentId}|${c.date}`) ?? []).length ? 'var(--success-tint)' : 'var(--fill)',
                      }}
                    >
                      <div style={{ font: '600 10.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 3 }}>
                        {t('step ที่ทำเสร็จวันนั้น (จากในระบบ)')}
                      </div>
                      {(stepsByKey.get(`${c.studentId}|${c.date}`) ?? []).length ? (
                        <div className="mono" style={{ font: '400 10.5px/1.7 var(--font-mono)', color: 'var(--success-dark)' }}>
                          {(stepsByKey.get(`${c.studentId}|${c.date}`) ?? []).join(' · ')}
                        </div>
                      ) : (
                        <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
                          {t('ไม่มีบันทึก step เสร็จ')}
                        </div>
                      )}
                      {!!c.photoCount && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                          {Array.from({ length: c.photoCount }, (_, i) => <PhotoSlot key={i} size={38} filled />)}
                          <span style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)' }}>
                            {t('รูปงานจากนักศึกษา · {n} รูป (เดโม)', { n: c.photoCount })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="evalcard__scores">
                    {CRITERIA.map((cr) => (
                      <div key={cr.key} className="scorerow">
                        <span className="scorerow__label" title={t(cr.th)}>{cr.label}</span>
                        <span className="scorerow__btns">
                          {SCORE_OPTIONS.map((n) => (
                            <button
                              key={n}
                              data-on={draft[cr.key] === n}
                              onClick={() => setDrafts({ ...drafts, [c.id]: { ...draft, [cr.key]: n } })}
                            >
                              {n}
                            </button>
                          ))}
                        </span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                      <span className="mono" style={{ font: '700 14px var(--font-mono)', color: total >= MAX_TOTAL * 0.7 ? 'var(--success)' : 'var(--text-secondary)' }}>
                        {total}/{MAX_TOTAL}
                      </span>
                      <button className="btn" style={{ flex: 1, height: 40, fontSize: 13 }} onClick={() => sign(c.id)}>
                        <Signature size={16} weight="bold" />
                        {t('บันทึกผล · ลงนาม')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h3>{t('ประเมินแล้วล่าสุด')} · {t('กลุ่ม')} {group.replace('TH-', '')}</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('นักศึกษา')}</th>
                <th style={{ width: 76 }}>{t('วันที่')}</th>
                <th>{t('กิจกรรม')}</th>
                <th style={{ width: 66 }}>{t('คะแนน')}</th>
                <th style={{ width: 88 }}>{t('ผู้ประเมิน')}</th>
              </tr>
            </thead>
            <tbody>
              {evaluated.length === 0 && (
                <tr><td colSpan={5} className="faint" style={{ padding: 16 }}>{t('ยังไม่มีคาบที่ประเมินแล้ว')}</td></tr>
              )}
              {evaluated.map((c) => (
                <tr key={c.id}>
                  <td style={{ font: '600 11.5px var(--font-body)' }}>{t(studentById.get(c.studentId)?.name ?? '')}</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>{thaiShort(c.date)}</td>
                  <td style={{ font: '400 11px var(--font-body)', color: 'var(--text-muted)' }}>{c.activities.map((a) => t(a)).join(' · ')}</td>
                  <td>
                    <span className="chip" style={{ background: 'var(--success-tint)', color: 'var(--success-dark)' }}>
                      <CheckCircle size={11} weight="fill" /> {totalScore(c.scores)}/{MAX_TOTAL}
                    </span>
                  </td>
                  <td style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>{t(c.evaluatedBy ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {evaluatedAll.length > 5 && (
            <button
              className="btn btn--sec"
              style={{ height: 34, marginTop: 10, fontSize: 12 }}
              onClick={() => setShowAllEvaluated(!showAllEvaluated)}
            >
              {showAllEvaluated ? t('พับเหลือ 5 แถว') : t('ดูทั้งหมด ({n} รายการ)', { n: evaluatedAll.length })}
            </button>
          )}
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <h3>{t('กราฟคะแนนรายคน')}</h3>
          <p className="sub">{t('ตัวเลข = จำนวนคาบที่ได้ 3 / 1 / 0 ของแต่ละหัวข้อ · เงาเทา = ค่าเฉลี่ยของกลุ่มไว้เทียบ · สเกลแมงมุม: ขอบวง = 3 กลางวง = 1.5')}</p>

          <div className="pickrow" style={{ marginTop: 10 }}>
            {groupStudents.map((st) => (
              <button key={st.id} data-on={st.id === selectedId} onClick={() => setChartStudent(st.id)}>
                {t(st.name)}
                <span className="mono">{st.code}</span>
              </button>
            ))}
          </div>

          {selectedRows.length === 0 ? (
            <div className="dashed" style={{ padding: '22px 16px', textAlign: 'center', font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
              {t('ยังไม่มีคาบที่ประเมินแล้วของคนนี้')}
            </div>
          ) : (
            // flex-wrap + จัดชิดบน: จอแคบ/ตัวหนังสือใหญ่ กราฟขวาจะตกลงมาเต็มแถวแทนที่จะโดนบีบ
            // และความสูงที่เปลี่ยน (เปิดตาราง/เปิดกราฟหัวข้อ) จะไม่ดันของอย่างอื่นขยับ
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 30, alignItems: 'flex-start', marginTop: 4 }}>
              <div style={{ flex: '1 1 400px', minWidth: 300, maxWidth: 560 }}>
                <Radar
                  axes={criterionAvg(selectedRows)}
                  reference={groupProfile}
                  label={t(studentById.get(selectedId ?? '')?.name ?? '')}
                  referenceLabel={`${t('เฉลี่ยกลุ่ม')} ${group.replace('TH-', '')}`}
                  size={250}
                  onAxisClick={(k) => setCritKey(k === critKey ? null : k)}
                  activeKey={critKey}
                  floor={50}
                />
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 270, maxWidth: 500 }}>
                <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 2 }}>{t('คะแนนรวมรายคาบ (เต็ม {n})', { n: MAX_TOTAL })}</div>
                <ScoreTrend rows={selectedRows} />
                {critKey ? (() => {
                  const crit = CRITERIA.find((cr) => cr.key === critKey)!;
                  return (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, font: '600 12.5px var(--font-head)' }}>
                          {t('คะแนน "{s}" รายคาบ (เต็ม 3)', { s: t(crit.short) })} <span className="faint" style={{ font: '400 10.5px var(--font-body)' }}>{crit.label}</span>
                        </div>
                        <button
                          onClick={() => setCritKey(null)}
                          style={{ font: '500 11px var(--font-body)', color: 'var(--text-muted)', background: 'var(--fill)', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
                        >
                          {t('ปิด')}
                        </button>
                      </div>
                      <ScoreTrend
                        rows={selectedRows}
                        getValue={(c) => c.scores?.[critKey] ?? 0}
                        max={3}
                        ticks={[0, 1, 3]}
                        height={104}
                      />
                    </div>
                  );
                })() : (
                  <p className="faint" style={{ font: '400 11px var(--font-body)', marginTop: 10 }}>
                    {t('กดหัวข้อบนกราฟแมงมุม (เช่น Instrument) เพื่อดูกราฟคะแนนหัวข้อนั้นตรงนี้')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </TeacherShell>
  );
}
