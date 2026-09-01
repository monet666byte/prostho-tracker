import { Info } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { StepInfo } from '../../components/StepInfo';
import { CaseMap } from '../../components/charts/CaseMap';
import { Burnup } from '../../components/charts/Burnup';
import { TYPES } from '../../domain/catalog';
import {
  bottleneckByStep, burnup, caseDots, durationByType, funnelByType, headline, selfPerformedRows,
} from '../../domain/analytics';
import { cohortRequirement, cohortYearly } from '../../domain/aggregate';
import type { WorkType } from '../../domain/types';
import { useAllCheckIns, useAllProgressUpdates, useAllStudents, useAllWorkpieces } from '../../hooks/data';
import { useYearView } from '../../hooks/useYearView';
import { YearSeg } from '../../components/teacher/YearSeg';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import { groupShort, groupYear } from '../../domain/group';
import { isActiveStudent, isAlumni, studentYear } from '../../domain/cohort';

/** วิเคราะห์รวมทั้งชั้นปี — มุมมองภาควิชา (ของรายกลุ่มอยู่หน้า "กลุ่มของฉัน") */
export default function Analytics() {
  const { settings } = useApp();
  const allStudents = useAllStudents();
  const allWorks = useAllWorkpieces();
  const everyCheckIn = useAllCheckIns();
  const updatesAll = useAllProgressUpdates();
  // ตัวกรองชั้นปีเดียวกับหน้าสรุปกลุ่ม (จำค่าร่วมกัน) — กรองต้นทาง ทุกกราฟได้ผลตาม
  const myGroup = useApp((st) => st.myGroup);
  const [yearView, setYearView] = useYearView(String(groupYear(myGroup ?? undefined)) as '5' | '6');
  const students = useMemo(
    () => {
      // 'จบแล้ว' = ชั้นปีเกิน 6 · 'รวมปี' = เฉพาะที่ยังเรียนอยู่ (ไม่ปนรุ่นที่จบไป)
      if (yearView === 'alumni') return allStudents.filter((s) => isAlumni(s));
      if (yearView === 'all') return allStudents.filter((s) => isActiveStudent(s));
      return allStudents.filter((s) => String(studentYear(s)) === yearView);
    },
    [allStudents, yearView],
  );
  const stuIds = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const works = useMemo(() => allWorks.filter((w) => stuIds.has(w.studentId)), [allWorks, stuIds]);
  const checkinsAll = useMemo(() => everyCheckIn.filter((c) => stuIds.has(c.studentId)), [everyCheckIn, stuIds]);
  const [stepType, setStepType] = useState<WorkType | 'all'>('all');
  // null = ยังไม่ได้เลือกเอง → เปิด step ที่กองมากสุดให้ · -1 = ผู้ใช้กดปิด
  const [openStep, setOpenStep] = useState<number | null>(null);
  const burn = useMemo(() => burnup(students, works, settings), [students, works, settings]);
  const cohortReq = useMemo(() => cohortRequirement(students, works, settings), [students, works, settings]);
  const yearly = useMemo(() => cohortYearly(students, works, settings), [students, works, settings]);
  const durations = useMemo(() => durationByType(works), [works]);
  const funnel = useMemo(() => funnelByType(works, settings), [works, settings]);
  const selfRows = useMemo(() => selfPerformedRows(students, works), [students, works]);
  const head = useMemo(
    () => headline(students, works, settings, checkinsAll, updatesAll),
    [students, works, settings, checkinsAll, updatesAll],
  );
  const buckets = useMemo(
    () => bottleneckByStep(works, settings, stepType === 'all' ? undefined : stepType),
    [works, settings, stepType],
  );
  const busiestStep = [...buckets].sort((a, b) => b.count - a.count)[0];
  const shownStep = openStep === null ? (busiestStep && busiestStep.count > 0 ? busiestStep.progression : -1) : openStep;
  const allDots = useMemo(() => caseDots(works, students, settings), [works, students, settings]);
  const dotCount = (ty: WorkType | 'all') => (ty === 'all' ? allDots.length : allDots.filter((d) => d.type === ty).length);
  const dots = useMemo(
    () => caseDots(works, students, settings, stepType === 'all' ? undefined : stepType),
    [works, students, settings, stepType],
  );

  const maxDuration = Math.max(1, ...durations.map((d) => d.maxWeeks));
  return (
    <TeacherShell active="cohort">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{yearView === 'all' ? t('วิเคราะห์รวมทุกชั้นปี') : `${t('วิเคราะห์รวมชั้นปีที่')} ${yearView}`}</h1>
            <p>
              {t('เหลือ {n} เดือนก่อนจบปีการศึกษา', { n: head.monthsLeft })} · <b>step</b> {t('= ขั้นงานของแต่ละเคส (0 พิมพ์ปากครั้งแรก → 10 ปิดเคส)')}
            </p>
          </div>
          <YearSeg view={yearView} onChange={setYearView} />
        </div>

        {/* สรุปสิ่งที่ต้องทำอะไรต่อ */}
        {/* 4. แผนที่เคสทั้งชั้นปี */}
        <div className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <h3>{t('การกระจายชิ้นงานตามขั้นงาน (ทั้งชั้นปี)')}</h3>
              <p className="sub">{t('หนึ่งจุด = หนึ่งชิ้นงาน วางตาม step ที่ทำถึง (0 เริ่ม → 10 ปิดเคส) · เปิดขั้นตอนของ step ที่กองมากสุดไว้ให้ กดเลขใต้กราฟเพื่อสลับ')}</p>
            </div>
          </div>

          {/* ปุ่มประเภท = ตัวกรอง + legend สี + จำนวนชิ้น ในตัวเดียว (แทน legend ใต้กราฟที่ซ้ำ) */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '10px 0 4px' }}>
            {(['all', 'CD', 'RPD', 'PC', 'CB'] as Array<WorkType | 'all'>).map((ty) => {
              const on = stepType === ty;
              return (
                <button
                  key={ty}
                  onClick={() => { setStepType(ty); setOpenStep(null); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    font: `600 12px var(--font-body)`, padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`,
                    background: on ? 'var(--accent)' : '#fff',
                    color: on ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {ty !== 'all' && (
                    <i style={{ width: 9, height: 9, borderRadius: 99, background: TYPES[ty].color, flex: 'none' }} />
                  )}
                  {ty === 'all' ? t('ทุกประเภท') : TYPES[ty].short}
                  <span className="mono" style={{ fontWeight: 400, opacity: 0.75 }}>{dotCount(ty)}</span>
                </button>
              );
            })}
          </div>

          <CaseMap
            dots={dots}
            staleDays={settings.stale}
            showTypeLegend={false}
            stepNames={stepType === 'all' ? undefined : buckets.map((b) => b.label)}
            onStepClick={(n) => setOpenStep(shownStep === n ? -1 : n)}
            activeStep={shownStep}
          />

          {shownStep >= 0 && (
            <div style={{ marginTop: 12 }}>
              <StepInfo
                progression={shownStep}
                type={stepType === 'all' ? undefined : stepType}
                meta={t('{n} ชิ้นงานกำลังอยู่ที่ step นี้', { n: buckets[shownStep].count }) + (
                  buckets[shownStep].stale ? t(' · ค้างเกิน {d} วัน {c} ชิ้น', { d: settings.stale, c: buckets[shownStep].stale }) : ''
                )}
                onClose={() => setOpenStep(-1)}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))', gap: 16, marginTop: 16 }}>
            {/* 2. เส้นสะสมเทียบเป้า */}
            <div className="panel">
              <h3>{t('ชิ้นงานเสร็จสะสม เทียบเป้าหมาย')}</h3>
              <p className="sub">{t('ต้นปีต่ำกว่าเป้าเป็นปกติ — เคสแรกใช้เวลา 2–4 เดือน')}</p>
              <div style={{ marginTop: 8 }}>
                <Burnup points={burn} />
              </div>
            </div>
            {/* 3. รับเคสแล้วใช้เวลากี่สัปดาห์ */}
            <div className="panel">
              <h3>{t('ระยะเวลาทำชิ้นงานจนเสร็จ (มัธยฐาน)')}</h3>
              <p className="sub">{t('ค่ามัธยฐาน นับจากวันรับเคส')}</p>
              <div style={{ marginTop: 10 }}>
                {durations.map((d) => (
                  <div className="hbar" key={d.type}>
                    <span className="hbar__label">{TYPES[d.type].short}</span>
                    <span className="hbar__track">
                      <i style={{ width: `${(d.medianWeeks / maxDuration) * 100}%`, background: TYPES[d.type].color }} />
                    </span>
                    <span className="hbar__value" style={{ width: 52, whiteSpace: 'nowrap' }}>{d.medianWeeks} wk.</span>
                  </div>
                ))}
              </div>
              <p style={{ margin: '10px 0 0', font: '400 10px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                {t('ช่วงที่พบ')}: {durations.map((d) => `${TYPES[d.type].short} ${d.minWeeks}–${d.maxWeeks} wk. (${d.samples} ${t('เคส')})`).join(' · ')}
              </p>
            </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 16, marginTop: 16 }}>
            <div className="panel">
              <h3>{t('ความคืบหน้าตามเกณฑ์ขั้นต่ำ (ทั้งชั้นปี)')}</h3>
              <p className="sub">{t('เกณฑ์สะสมครอบปี 5–6')}</p>
              <div style={{ marginTop: 12, display: 'grid', gap: 13 }}>
                {cohortReq.map((r) => (
                  <div key={r.group}>
                    <div style={{ display: 'flex', marginBottom: 6 }}>
                      <span style={{ flex: 1, font: '600 11.5px var(--font-body)' }}>{t(r.label)}</span>
                      <span className="mono" style={{ font: '600 10.5px var(--font-mono)', color: 'var(--text-muted)' }}>{t('เกณฑ์')} {r.required}</span>
                    </div>
                    <div className="stacked">
                      <i style={{ width: `${(r.complete / r.total) * 100}%`, background: 'var(--success)' }} />
                      <i style={{ width: `${(r.oneShort / r.total) * 100}%`, background: 'var(--success-mid)' }} />
                      <i style={{ width: `${(r.twoPlus / r.total) * 100}%`, background: 'var(--danger-light)' }} />
                    </div>
                  </div>
                ))}
                <div>
                  <div style={{ display: 'flex', marginBottom: 6 }}>
                    <span style={{ flex: 1, font: '600 11.5px var(--font-body)' }}>{t('เกณฑ์รายปี')} · {yearly.year}</span>
                    <span className="mono" style={{ font: '600 10.5px var(--font-mono)', color: 'var(--text-muted)' }}>{t('ปีละ')} {yearly.required}</span>
                  </div>
                  <div className="stacked">
                    <i style={{ width: `${(yearly.passed / Math.max(1, yearly.total)) * 100}%`, background: 'var(--success)' }} />
                    <i style={{ width: `${((yearly.total - yearly.passed) / Math.max(1, yearly.total)) * 100}%`, background: 'var(--danger-light)' }} />
                  </div>
                </div>
              </div>
              <div className="legend">
                <span><i style={{ background: 'var(--success)' }} /> {t('ครบ')}</span>
                <span><i style={{ background: 'var(--success-mid)' }} /> {t('เหลือ 1 ชิ้น')}</span>
                <span><i style={{ background: 'var(--danger-light)' }} /> {t('เหลือ ≥2')}</span>
              </div>
            </div>
          {/* 5. funnel */}
          <div className="panel">
            <h3>{t('สถานะชิ้นงาน จำแนกตามประเภท')}</h3>
            <p className="sub">{t('สัดส่วนต่อประเภท')}</p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('ประเภท')}</th>
                  <th style={{ width: 46 }}>{t('รับมา')}</th>
                  <th style={{ width: 56 }}>{t('ยังไม่เริ่ม')}</th>
                  <th style={{ width: 56 }}>{t('กำลังทำ')}</th>
                  <th style={{ width: 52 }}>{t('จบเคส')}</th>
                  <th style={{ width: 130 }}>{t('อัตราจบเคส')}</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((f) => (
                  <tr key={f.type}>
                    <td style={{ font: '600 11.5px var(--font-body)' }}>{TYPES[f.type].short}</td>
                    <td className="mono">{f.total}</td>
                    <td className="mono faint">{f.notStarted}</td>
                    <td className="mono">{f.inProgress}</td>
                    <td className="mono" style={{ color: 'var(--success)', fontWeight: 600 }}>{f.completed}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span className="bar" style={{ height: 7 }}>
                          <i style={{ width: `${f.completionRate}%`, background: TYPES[f.type].color }} />
                        </span>
                        <span className="mono" style={{ font: '600 10.5px var(--font-mono)', color: 'var(--text-muted)' }}>
                          {f.completionRate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 6. lab step ที่ต้องทำเอง */}
          <div className="panel">
            <h3>{t('ขั้นตอน lab ที่นักศึกษาทำด้วยตนเอง')}</h3>
            <p className="sub">{t('procedure ติดดาว (*) ที่ต้องทำเอง')}</p>
            <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 4 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t('นักศึกษา')}</th>
                    <th style={{ width: 52 }}>{t('กลุ่ม')}</th>
                    <th style={{ width: 150 }}>{t('ทำเองไปแล้ว')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selfRows.slice(0, 12).map((r) => (
                    <tr key={r.student.id}>
                      <td style={{ font: '600 11.5px var(--font-body)' }}>{t(r.student.name)}</td>
                      <td className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                        {groupShort(r.student.group)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span className="bar" style={{ height: 7 }}>
                            <i style={{ width: `${r.available ? (r.done / r.available) * 100 : 0}%`, background: 'var(--self)' }} />
                          </span>
                          <span className="mono" style={{ font: '600 10.5px var(--font-mono)', color: 'var(--text-muted)' }}>
                            {r.done}/{r.available}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 16, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 10,
            background: 'var(--warning-tint)', border: '1px solid var(--warning-border)',
          }}
        >
          <Info size={16} weight="fill" color="var(--warning)" style={{ flex: 'none', marginTop: 1 }} />
          <span className="pretty" style={{ font: '400 11px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
            {t('คำนวณสดจากข้อมูลในระบบ — ตอนนี้ยังเป็นข้อมูลสมมติ')}
          </span>
        </div>
      </main>
    </TeacherShell>
  );
}
