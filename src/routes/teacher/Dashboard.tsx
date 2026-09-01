import { Archive, BellRinging, Info, Stack, Users, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TeacherShell, type TeacherNav } from '../../components/teacher/TeacherShell';
import { StepInfo } from '../../components/StepInfo';
import { TYPES } from '../../domain/catalog';
import { cohortYearly, countByType, staleRows, summarizeAll, summarizeGroups } from '../../domain/aggregate';
import { bottleneckByStep } from '../../domain/analytics';
import { currentProc, isComplete, procLabel } from '../../domain/rules';
import type { WorkType } from '../../domain/types';
import { useAllCheckIns, useAllStudents, useAllWorkpieces } from '../../hooks/data';
import { useYearView } from '../../hooks/useYearView';
import { YearSeg } from '../../components/teacher/YearSeg';
import { thaiShort } from '../../lib/date';
import { t, tText } from '../../lib/i18n';
import { useApp } from '../../store/app';
import { groupShort, groupYear } from '../../domain/group';
import { cohortLabel, cohortOf, isActiveStudent, isAlumni, studentCohortLabel, studentYear } from '../../domain/cohort';

/** "2569/1" จากวันที่จริง — เทอม 1 มิ.ย.–ต.ค. · เทอม 2 พ.ย.–มี.ค. · ฤดูร้อน เม.ย.–พ.ค. */
function termLabel(d: Date): string {
  const m = d.getMonth(); // 0 = ม.ค.
  const term = m >= 5 && m <= 9 ? 1 : m >= 10 || m <= 2 ? 2 : 3;
  const be = d.getFullYear() + 543 - (m < 5 ? 1 : 0); // ก่อน มิ.ย. ยังเป็นปีการศึกษาก่อนหน้า
  return `${be}/${term}`;
}

export default function Dashboard() {
  const { settings, showToast } = useApp();
  const [params] = useSearchParams();
  const raw = params.get('tab') ?? 'overview';
  const view = 'overview' as TeacherNav; void raw;

  const allStudents = useAllStudents();
  const allWorks = useAllWorkpieces();
  const everyCheckIn = useAllCheckIns();
  // ตัวกรองชั้นปี — กรองที่ต้นทางสามลิสต์นี้ ทุกกราฟ/ตารางข้างล่างได้ผลตามอัตโนมัติ
  const myGroup = useApp((st) => st.myGroup);
  const [yearView, setYearView] = useYearView(String(groupYear(myGroup ?? undefined)) as '5' | '6');
  // รุ่นที่เลือกดูในโหมด "จบแล้ว" (null = ทุกรุ่นที่จบ) — เก็บย้อนหลังหลายรุ่นจึงต้องเลือกได้
  const [cohortPick, setCohortPick] = useState<number | null>(null);
  const students = useMemo(
    () => {
      // 'จบแล้ว' = ชั้นปีเกิน 6 · 'รวมปี' = เฉพาะที่ยังเรียนอยู่ (ไม่ปนรุ่นที่จบไป)
      if (yearView === 'alumni') {
        const grads = allStudents.filter((s) => isAlumni(s));
        // ดูทีละรุ่นเสมอ — ยังไม่ได้เลือก = รุ่นที่เพิ่งจบล่าสุด (ผู้ใช้สั่ง 1 ก.ย.: ไม่เอา "ทุกรุ่น")
        const cohorts = [...new Set(grads.map((s) => cohortOf(s)))].sort((a, b) => b - a);
        const pick = cohortPick ?? cohorts[0];
        return grads.filter((s) => cohortOf(s) === pick);
      }
      if (yearView === 'all') return allStudents.filter((s) => isActiveStudent(s));
      return allStudents.filter((s) => String(studentYear(s)) === yearView);
    },
    [allStudents, yearView, cohortPick],
  );
  const stuIds = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const works = useMemo(() => allWorks.filter((w) => stuIds.has(w.studentId)), [allWorks, stuIds]);
  const allCheckIns = useMemo(() => everyCheckIn.filter((c) => stuIds.has(c.studentId)), [everyCheckIn, stuIds]);

  const group = useApp((st) => st.teacherGroup);
  const setGroup = useApp((st) => st.setTeacherGroup);
  const [stepType, setStepType] = useState<WorkType>('CB');
  // null = ยังไม่ได้เลือกเอง → เปิด step ที่กองมากสุดให้อัตโนมัติ · -1 = ผู้ใช้กดปิด
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [pinged, setPinged] = useState<Record<string, boolean>>({});

  const summaries = useMemo(() => summarizeAll(students, works, settings), [students, works, settings]);
  const groups = useMemo(() => summarizeGroups(summaries), [summaries]);
  const selected = groups.find((g) => g.code === group) ?? groups[0];
  const stale = useMemo(() => staleRows(students, works, settings), [students, works, settings]);
  const typeCounts = useMemo(() => countByType(works), [works]);
  const yearly = useMemo(() => cohortYearly(students, works, settings), [students, works, settings]);

  // รุ่นที่จบแล้วทั้งหมดในระบบ เรียงใหม่→เก่า ใช้ทำปุ่มเลือกรุ่น
  const alumniCohorts = useMemo(
    () => [...new Set(allStudents.filter((s) => isAlumni(s)).map((s) => cohortOf(s)))].sort((a, b) => b - a),
    [allStudents],
  );

  // รุ่นที่กำลังแสดงอยู่ (ตามตัวกรองชั้นปี) — โชว์เป็นป้ายข้างหัวเรื่อง
  const cohortsShown = useMemo(() => {
    const labels = [...new Set(students.map((s) => studentCohortLabel(s)))].sort().reverse();
    return labels.join(' · ');
  }, [students]);

  const activePieces = works.filter((w) => !isComplete(w)).length;
  const pendingEval = new Set(allCheckIns.filter((c) => c.status === 'pending').map((c) => c.studentId)).size;
  const maxTypeCount = Math.max(1, ...typeCounts.map((x) => x.count));
  const stepBuckets = useMemo(() => bottleneckByStep(works, settings, stepType), [works, settings, stepType]);
  const maxStepBucket = Math.max(1, ...stepBuckets.map((b) => b.count));
  const busiest = [...stepBuckets].sort((a, b) => b.count - a.count)[0] ?? { progression: 0, count: 0, label: '' };
  const shownStep = openStep === null ? (busiest.count > 0 ? busiest.progression : -1) : openStep;




  return (
    <TeacherShell active={view}>
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>
              {yearView === 'all' ? t('ภาพรวมทุกชั้นปี')
                : yearView === 'alumni' ? t('ภาพรวมรุ่นที่จบแล้ว')
                  : `${t('ภาพรวมชั้นปีที่')} ${yearView}`}
              {/* เลขรุ่นติดหัวเรื่อง — ภาคคุยกันด้วยเลขรุ่น เห็นได้ทุกโหมด ไม่ใช่แค่ "รวมปี" */}
              {cohortsShown && <span className="cohortchip">{cohortsShown}</span>}
            </h1>
            <p>
              {t('{a} คน · {b} กลุ่ม', { a: students.length, b: groups.length })} · {thaiShort(new Date())} {t('{time} น.', { time: new Date().toTimeString().slice(0, 5) })}
            </p>
          </div>
          {/* เดิมเป็นปุ่มตาย 2 อัน (ไม่มี handler): "ภาคเรียน 2569/1" ฝังปีตายตัว กับ "ส่งออก CSV"
              — ป้ายเทอมเปลี่ยนเป็นข้อความคำนวณจริง · ปุ่ม CSV เอาออกจนกว่าจะทำ export ฝั่งอาจารย์จริง */}
          <YearSeg view={yearView} onChange={setYearView} />
          <span className="chip" style={{ height: 34, padding: '0 14px', font: '600 12px var(--font-body)', background: 'var(--fill)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center' }}>
            {t('ภาคเรียน')} {termLabel(new Date())}
          </span>
        </div>

        {/* ป้ายบอกว่ากำลังดูของเก่า — กันเข้าใจผิดว่าเป็นรุ่นที่ยังเรียนอยู่ */}
        {yearView === 'alumni' && (
          <div className="archivebar">
            <Archive size={15} weight="fill" />
            {t('กำลังดูรุ่นที่เรียนจบไปแล้ว — ดูได้อย่างเดียว แก้ไขไม่ได้')}
          </div>
        )}

        {yearView === 'alumni' && alumniCohorts.length > 0 && (
          <div className="cohortpick">
            <span className="cohortpick__label">{t('เลือกรุ่น')}</span>
            {alumniCohorts.map((c) => (
              <button key={c} data-on={(cohortPick ?? alumniCohorts[0]) === c} onClick={() => setCohortPick(c)}>{cohortLabel(c)}</button>
            ))}
          </div>
        )}

        {view === 'overview' && (
          <>
            <div className="kpis">
              <div className="kpi">
                <div className="kpi__label"><Stack size={14} /> {t('ชิ้นงานที่กำลังทำ')}</div>
                <div className="kpi__value">{activePieces}</div>
                <div className="kpi__hint">{t('จากทั้งหมด {n} ชิ้น', { n: works.length })}</div>
              </div>
              <div className="kpi">
                <div className="kpi__label"><Users size={14} /> {t('จบเคสสะสมปี')} {yearly.year}</div>
                <div className="kpi__value" style={{ color: yearly.piecesDone >= yearly.piecesGoal ? 'var(--success)' : undefined }}>
                  {yearly.piecesDone}
                  <span style={{ font: '500 14px var(--font-body)', color: 'var(--text-faint)' }}> / {yearly.piecesGoal}</span>
                </div>
                <div className="kpi__hint">{t('เป้า {a} คน × {b} ชิ้น/ปี', { a: students.length, b: settings.req.perYear })}</div>
              </div>
              <div className="kpi">
                <div className="kpi__label"><WarningCircle size={14} /> {t('เคสค้าง >')} {settings.stale} {t('วัน')}</div>
                <div className="kpi__value" style={{ color: 'var(--danger-chart)' }}>{stale.length}</div>
                <div className="kpi__hint">{t('กระจายใน {n} กลุ่ม', { n: new Set(stale.map((s) => s.student.group)).size })}</div>
              </div>
              <div className="kpi">
                <div className="kpi__label"><BellRinging size={14} /> {t('นักศึกษารอประเมิน')}</div>
                <div className="kpi__value" style={{ color: pendingEval > 0 ? 'var(--warning)' : undefined }}>{pendingEval}</div>
                <div className="kpi__hint">{t('ดูที่ ประเมินรายคาบ')}</div>
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 16 }}>
              <h3>{t('กลุ่มคลินิก')} · {groups.length} {t('กลุ่ม')}</h3>
              {/* มุมมองรวมเคยแปะป้ายปีทุกใบ 24 ใบ — รกและซ้ำ (ผู้ใช้ทัก 1 ก.ย.)
                  แบ่งเป็นหมวดละปีแทน: หัวข้อบอกครั้งเดียว การ์ดสะอาดเหมือนมุมมองรายปี */}
              {(yearView === 'all' ? [5, 6] : [null]).map((yr) => {
                const list = yr === null ? groups : groups.filter((g) => g.year === yr);
                if (!list.length) return null;
                return (
                  <div key={yr ?? 'one'}>
                    {/* บอกเลขรุ่นคู่ชั้นปี — ภาคเรียกกันด้วยเลขรุ่น (ผู้ใช้ 1 ก.ย.: DTMU55 = ปี 5) */}
                    {yr !== null && (
                      <p className="sub" style={{ margin: '13px 0 0' }}>
                        {t('ชั้นปีที่')} {yr}
                        {list[0]?.students[0] && ` · ${studentCohortLabel(list[0].students[0].student)}`}
                        {' · '}{list.length} {t('กลุ่ม')}
                      </p>
                    )}
                    <div className="groupgrid" style={{ marginTop: yr !== null ? 8 : 13 }}>
                      {list.map((g) => {
                        // เดิมไล่ 3 สี เขียว/น้ำเงิน/ส้ม โดยไม่มี legend — คนดูเดาความหมายไม่ออก (ผู้ใช้ทัก 1 ก.ย.)
                        // เหลือ 2 สถานะพอ: ปกติ = สีเดียวกลางๆ · ต่ำกว่า 55% = ส้มตามภาษาสีเตือนของแอป
                        const lagging = g.percent < 55;
                        return (
                          <button key={g.code} className={`groupcard${g.code === group ? ' on' : ''}`} onClick={() => setGroup(g.code)}>
                            <div className="groupcard__code">{groupShort(g.code)}</div>
                            <div className="groupcard__pct" style={{ color: lagging ? 'var(--warning)' : 'var(--text-secondary)' }}>{g.percent}%</div>
                            <span className="bar" style={{ height: 6, display: 'block', marginTop: 7 }}>
                              <i style={{ width: `${g.percent}%`, background: lagging ? 'var(--warning)' : 'var(--accent)' }} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))', gap: 16 }}>
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <div className="panel">
                <h3>{t('นักศึกษาในกลุ่ม')} {groupShort(selected?.code)}</h3>
                <p className="sub">
                  {selected?.students[0] && `${studentCohortLabel(selected.students[0].student)} · ${selected.year > 6 ? t('จบแล้ว') : `${t('ชั้นปีที่')} ${selected.year}`} · `}
                  {t('{n} คน', { n: selected?.students.length ?? 0 })} · {t('เรียงตามรหัส')}
                </p>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('นักศึกษา')}</th>
                      <th style={{ width: 130 }}>{t('ความคืบหน้า')}</th>
                      <th style={{ width: 56 }}>{t('ชิ้นงาน')}</th>
                      {/* 76px ทำหัวไทยตัดคำห้อยสองบรรทัด (สกรีนช็อตผู้ใช้ 1 ก.ย.) */}
                      <th style={{ width: 94, whiteSpace: 'nowrap' }}>{t('เกณฑ์สะสม 2 ปี')}</th>
                      <th style={{ width: 46 }}>{t('ค้าง')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected?.students.map((s) => (
                      <tr key={s.student.id}>
                        <td>
                          <div style={{ font: '600 12px var(--font-body)' }}>{t(s.student.name)}</div>
                          <div className="mono" style={{ font: '400 9.5px var(--font-mono)', color: 'var(--text-faint)' }}>{s.student.code}</div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span className="bar" style={{ height: 6 }}>
                              <i style={{ width: `${s.percent}%`, background: 'var(--accent)' }} />
                            </span>
                            <span className="mono" style={{ font: '600 10.5px var(--font-mono)', color: 'var(--text-muted)' }}>{s.percent}%</span>
                          </div>
                        </td>
                        <td className="mono">{s.pieces}</td>
                        <td>
                          <span
                            className="chip"
                            style={{
                              background: s.allComplete ? 'var(--success-tint)' : 'var(--fill)',
                              color: s.allComplete ? 'var(--success-dark)' : 'var(--text-muted)',
                            }}
                          >
                            {s.reqDone}/{s.reqTotal}
                          </span>
                        </td>
                        <td>
                          {s.stale > 0 ? (
                            <span className="chip" style={{ background: 'var(--danger-tint)', color: 'var(--danger-dark)' }}>{s.stale}</span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="panel">
                <h3>{t('ชิ้นงานที่ไม่มีความเคลื่อนไหวนานที่สุด')}</h3>
                <p className="sub">{t('ทั้งชั้นปี {n} ชิ้น', { n: stale.length })}</p>
                <table className="tbl">
                  <tbody>
                    {stale.slice(0, 6).map((r) => {
                      const cur = currentProc(r.workpiece);
                      const key = r.workpiece.id;
                      return (
                        <tr key={key}>
                          <td style={{ font: '600 11.5px var(--font-body)', width: 90 }}>
                            {t(r.student.name)}
                            <span className="mono" style={{ display: 'block', font: '400 9px var(--font-mono)', color: 'var(--text-faint)' }}>
                              {groupShort(r.student.group)}
                            </span>
                          </td>
                          <td>
                            <div style={{ font: '500 11px var(--font-body)' }}>{tText(r.workpiece.detail)}</div>
                            <div className="mono" style={{ font: '400 9.5px var(--font-mono)', color: 'var(--text-faint)', marginTop: 1 }}>
                              {cur ? procLabel(r.workpiece.type, cur) : t('ยังไม่เริ่ม')}
                            </div>
                          </td>
                          <td style={{ width: 44 }}>
                            <span className="chip" style={{ background: 'var(--danger-tint)', color: 'var(--danger-dark)' }}>{r.days}</span>
                          </td>
                          <td style={{ width: 72 }}>
                            <button
                              className="btn btn--sec"
                              style={{
                                height: 30, fontSize: 11,
                                background: pinged[key] ? 'var(--success-tint)' : undefined,
                                color: pinged[key] ? 'var(--success-dark)' : undefined,
                              }}
                              onClick={() => {
                                // ยังไม่มีช่องทางแจ้งเตือนจริง (push/LINE รอ phase 2) — toast ต้องไม่โกหก
                                // ว่าส่งแล้ว ไม่งั้นอาจารย์เข้าใจผิดว่าเด็กได้รับ (ตระกูลเดียวกับปุ่มส่งรายงานปลอมที่ตัดไป)
                                setPinged({ ...pinged, [key]: true });
                                showToast({ message: t('จดไว้แล้วว่าจะเตือน {n} — ระบบแจ้งเตือนจริงยังไม่เปิดใช้ ต้องบอกปากเปล่าก่อนนะครับ', { n: t(r.student.name) }), tone: 'warning' });
                              }}
                            >
                              {pinged[key] ? t('เตือนแล้ว') : <><BellRinging size={13} /> {t('เตือน')}</>}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>

              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                <div className="panel">
                  <h3>{t('จำนวนชิ้นงานต่อประเภท (ทั้งชั้นปี)')}</h3>
                  <p className="sub">{t('รวม {n} ชิ้นงาน', { n: works.length })}</p>
                  <div style={{ marginTop: 10 }}>
                    {typeCounts.map((tc) => (
                      <div className="hbar" key={tc.type}>
                        <span className="hbar__label">{TYPES[tc.type].short}</span>
                        <span className="hbar__track">
                          <i style={{ width: `${(tc.count / maxTypeCount) * 100}%`, background: TYPES[tc.type].color }} />
                        </span>
                        <span className="hbar__value">{tc.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="panel">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <h3>{t('ชิ้นงานคงค้าง จำแนกตามขั้นงาน')}</h3>
                      <p className="sub">{t('เปิดรายละเอียด step ที่กองมากสุดไว้ให้ · กดแท่งอื่นเพื่อสลับ')}</p>
                    </div>
                    <div className="seg seg--sm">
                      {(['CD', 'RPD', 'PC', 'CB'] as WorkType[]).map((ty) => (
                        <button key={ty} data-on={stepType === ty} onClick={() => { setStepType(ty); setOpenStep(null); }}>
                          {TYPES[ty].short}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="vbars">
                    {stepBuckets.map((b) => (
                      <div
                        key={b.progression}
                        data-clickable="true"
                        data-on={shownStep === b.progression}
                        onClick={() => setOpenStep(shownStep === b.progression ? -1 : b.progression)}
                        title={t('กดดูขั้นตอนใน step {n}', { n: b.progression })}
                      >
                        <span className="tick">{b.count || ''}</span>
                        <span
                          className="bar-v"
                          style={{
                            height: Math.max(2, (b.count / maxStepBucket) * 92),
                            background: b.count === maxStepBucket && b.count > 0 ? 'var(--danger-chart)' : TYPES[stepType].color,
                          }}
                        />
                        <span className="tick">{b.progression}</span>
                      </div>
                    ))}
                  </div>

                  {shownStep >= 0 && (
                    <div style={{ marginTop: 12 }}>
                      <StepInfo
                        progression={shownStep}
                        type={stepType}
                        meta={t('{n} ชิ้นงานกำลังอยู่ที่ step นี้', { n: stepBuckets[shownStep].count })}
                        onClose={() => setOpenStep(-1)}
                      />
                    </div>
                  )}
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--fill)', borderRadius: 10, padding: '10px 12px' }}>
                    <Info size={15} weight="fill" color="var(--text-faint)" style={{ flex: 'none', marginTop: 1 }} />
                    <span className="pretty" style={{ font: '500 11px/1.55 var(--font-body)', color: 'var(--text-muted)' }}>
                      {busiest.count > 0
                        ? t('งาน {s} กองอยู่ที่ step {p} มากที่สุด ({c} ชิ้น) — {l}', { s: TYPES[stepType].short, p: busiest.progression, c: busiest.count, l: busiest.label })
                        : t('ยังไม่มีชิ้นงานที่กำลังทำในประเภทนี้')}
                      {' · '}{t('ดูวิเคราะห์เชิงลึกได้ที่เมนู “วิเคราะห์”')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

      </main>
    </TeacherShell>
  );
}
