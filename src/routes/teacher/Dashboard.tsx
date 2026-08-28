import { BellRinging, Export, Info, Stack, Users, WarningCircle } from '@phosphor-icons/react';
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
import { thaiShort } from '../../lib/date';
import { t, tText } from '../../lib/i18n';
import { useApp } from '../../store/app';

const TITLES: Record<string, { title: string; sub: string }> = {
  overview: { title: t('ภาพรวมชั้นปีที่ 5'), sub: '' },
};

export default function Dashboard() {
  const { settings, showToast } = useApp();
  const [params] = useSearchParams();
  const raw = params.get('tab') ?? 'overview';
  const view = (raw in TITLES ? raw : 'overview') as TeacherNav;

  const students = useAllStudents();
  const works = useAllWorkpieces();
  const allCheckIns = useAllCheckIns();

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

  const activePieces = works.filter((w) => !isComplete(w)).length;
  const pendingEval = new Set(allCheckIns.filter((c) => c.status === 'pending').map((c) => c.studentId)).size;
  const maxTypeCount = Math.max(1, ...typeCounts.map((x) => x.count));
  const stepBuckets = useMemo(() => bottleneckByStep(works, settings, stepType), [works, settings, stepType]);
  const maxStepBucket = Math.max(1, ...stepBuckets.map((b) => b.count));
  const busiest = [...stepBuckets].sort((a, b) => b.count - a.count)[0] ?? { progression: 0, count: 0, label: '' };
  const shownStep = openStep === null ? (busiest.count > 0 ? busiest.progression : -1) : openStep;



  const meta = TITLES[view] ?? TITLES.overview;

  return (
    <TeacherShell active={view}>
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{meta.title}</h1>
            <p>
              {t('{a} คน · {b} กลุ่ม', { a: students.length, b: groups.length })} · {thaiShort(new Date())} {t('{time} น.', { time: new Date().toTimeString().slice(0, 5) })}
            </p>
          </div>
          <button className="btn btn--sec" style={{ width: 'auto', padding: '0 14px' }}>{t('ภาคเรียน 2569/1')}</button>
          <button className="btn btn--sec" style={{ width: 'auto', padding: '0 14px' }}>
            <Export size={16} /> {t('ส่งออก CSV')}
          </button>
        </div>

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
              <h3>{t('กลุ่มคลินิก PT1–PT12')}</h3>
              <div className="groupgrid" style={{ marginTop: 13 }}>
                {groups.map((g) => {
                  const color = g.percent >= 70 ? 'var(--success)' : g.percent >= 55 ? 'var(--accent)' : 'var(--warning)';
                  return (
                    <button key={g.code} className={`groupcard${g.code === group ? ' on' : ''}`} onClick={() => setGroup(g.code)}>
                      <div className="groupcard__code">{g.code.replace('TH-', '')}</div>
                      <div className="groupcard__pct" style={{ color }}>{g.percent}%</div>
                      <span className="bar" style={{ height: 6, display: 'block', marginTop: 7 }}>
                        <i style={{ width: `${g.percent}%`, background: color }} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 16 }}>
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <div className="panel">
                <h3>{t('นักศึกษาในกลุ่ม')} {selected?.code.replace('TH-', '')}</h3>
                <p className="sub">{t('{n} คน', { n: selected?.students.length ?? 0 })} · {t('เรียงตามรหัส')}</p>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('นักศึกษา')}</th>
                      <th style={{ width: 130 }}>{t('ความคืบหน้า')}</th>
                      <th style={{ width: 56 }}>{t('ชิ้นงาน')}</th>
                      <th style={{ width: 76 }}>{t('เกณฑ์สะสม 2 ปี')}</th>
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
                              {r.student.group.replace('TH-', '')}
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
                                setPinged({ ...pinged, [key]: true });
                                showToast({ message: t('เตือน {n} แล้ว', { n: t(r.student.name) }), tone: 'success' });
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
