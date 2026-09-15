import { Fragment, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { DivergingBars } from '../../components/charts/Diverging';
import { Heatmap } from '../../components/charts/Heatmap';
import { averageProfile, heatmapRows, riskRows } from '../../domain/analytics';
import { typeMeta } from '../../domain/catalog';
import {
  useAllCheckIns, useAllProgressUpdates, useAllStudents, useAllWorkpieces,
} from '../../hooks/data';
import { personName, t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import type { Teacher } from '../../domain/types';
import { groupShort, splitPersonName } from '../../domain/group';

/** หน้า "กลุ่มของฉัน" — งานประจำวันของอาจารย์ที่ปรึกษา ทุกอย่างในหน้านี้เป็นของกลุ่มเดียว */
/* อ้างอิงเดิมทุกเรนเดอร์ — `?? []` สร้างอาร์เรย์ใหม่ทุกครั้ง ทำให้ useMemo ที่พึ่งมันไม่ memo จริง */
const EMPTY_TEACHERS: Teacher[] = [];

export default function MyGroup() {
  const { settings } = useApp();
  const group = useApp((st) => st.teacherGroup);
  const students = useAllStudents();
  const works = useAllWorkpieces();
  const checkinsAll = useAllCheckIns();
  const updatesAll = useAllProgressUpdates();
  const navigate = useNavigate();
  const [openRow, setOpenRow] = useState<string | null>(null);
  /* การ์ดงานในมือตอนชี้แถว (ผู้ใช้เลือก mock 15 ก.ย. 69) — แถวไม่ขยับ มีแค่พื้นขาว + การ์ดโผล่
     จอสัมผัสไม่มี hover จึงไม่ขึ้นการ์ด — ใช้ ▾ กางแถวแทนเหมือนเดิม */
  const panelRef = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<{ id: string; x: number; y: number; ax: number } | null>(null);
  const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;
  const peekRow = (id: string, cell: HTMLElement | null) => {
    const panel = panelRef.current;
    if (!canHover || !panel || !cell) return;
    const pb = panel.getBoundingClientRect();
    const cb = cell.getBoundingClientRect();
    const W = 240;
    const want = cb.left - pb.left + 12;
    const x = Math.max(8, Math.min(pb.width - W - 8, want));
    setPeek({ id, x, y: cb.top - pb.top - 8, ax: want - x + 24 });
  };

  const risks = useMemo(
    () => riskRows(students, works, settings, checkinsAll, updatesAll),
    [students, works, settings, checkinsAll, updatesAll],
  );
  const groupRisks = useMemo(() => risks.filter((r) => r.student.group === group), [risks, group]);
  const flagged = groupRisks.filter((r) => r.risk !== 'ok');
  const shown = groupRisks; // กลุ่มละ 8 คน — โชว์หมด ไม่ต้องพับ

  const gHigh = flagged.filter((r) => r.risk === 'high').length;
  const gWatch = flagged.filter((r) => r.risk === 'medium').length;
  const gStuck = groupRisks.filter((r) => r.stuckPeriods >= 2).length;
  /* คนที่ยังไม่มีเคสเลยต้องแยกเป็นสาเหตุของตัวเอง
     silentDays ของคนที่ไม่มีเคสและไม่เคยเช็คอินคือค่าตั้งต้น 999 จึงเข้าช่อง "เงียบเกิน N วัน"
     ทั้งที่ยังไม่เคยเริ่ม — อาจารย์อ่านว่า "หายไป" แล้วไปตามผิดเรื่อง (เจอ 10 ก.ย. 69) */
  const gNoCase = flagged.filter((r) => r.piecesTotal === 0).length;
  const gSilent = groupRisks.filter(
    (r) => r.piecesTotal > 0 && r.silentDays >= settings.stale && r.stuckPeriods < 2,
  ).length;

  const studentGroupById = useMemo(() => new Map(students.map((st) => [st.id, st.group])), [students]);
  const pendingList = checkinsAll.filter(
    (c) => c.status === 'pending' && studentGroupById.get(c.studentId) === group,
  );
  const pendingEval = pendingList.length;
  const pendingPeople = new Set(pendingList.map((c) => c.studentId)).size;

  const teachersAll = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const advisors = useMemo(() => {
    const byId = new Map(teachersAll.map((tc) => [tc.id, personName(tc)]));
    const ids = students.find((st) => st.group === group)?.advisorIds ?? [];
    return [...new Set(ids)].map((id) => t(byId.get(id) ?? '')).filter(Boolean).join(' / ');
  }, [teachersAll, students, group]);

  const groupStudents = useMemo(
    () => students.filter((st) => st.group === group).sort((a, b) => a.code.localeCompare(b.code)),
    [students, group],
  );
  const groupProfile = useMemo(() => averageProfile(groupStudents, works, settings), [groupStudents, works, settings]);
  const cohortProfile = useMemo(() => averageProfile(students, works, settings), [students, works, settings]);
  const heat = useMemo(() => heatmapRows(groupStudents, works, settings), [groupStudents, works, settings]);

  return (
    <TeacherShell active="mygroup">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('กลุ่ม')} {groupShort(group)}</h1>
            {/* เหลือชื่อที่ปรึกษา (เคยหาไม่เจอ — ผู้ใช้ถาม 2 ก.ย.) · ตัดจำนวนคนและคำอธิบาย step (ตัดตัวเทา 16 ก.ย. 69) */}
            {advisors && <p>{t('อาจารย์ที่ปรึกษา')} {advisors}</p>}
          </div>
        </div>

        {/* หน้าสรุปกลุ่มแบบ "ตัดของซ้ำ" (ผู้ใช้เลือก mock 14 ก.ย. 69) — ตัวเลข 3 กล่องมีกรอบสี → การ์ดเดียวคั่นเส้น แบบหน้าภาพรวม */}
        <div className="kpis kpis--strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {/* ยุบการ์ด "ติด step/เงียบหาย" มาเป็นบรรทัดสาเหตุของ "ต้องตาม" — สองการ์ดเดิมชี้คนกลุ่มเดียวกัน */}
          <div className="kpi">
            <div className="kpi__value" style={{ color: gHigh ? 'var(--danger)' : 'var(--success)' }}>
              {gHigh + gWatch}
              <span className="kpi__of"> / {t('{n} คน', { n: groupRisks.length })}</span>
            </div>
            <div className="kpi__label">
              {/* ขึ้นเฉพาะสาเหตุที่มีคน — เดิมเรียงครบ 4 สาเหตุแม้เป็น 0 ("เงียบเกิน 14 วัน 0 · ยังไม่มีเคส 0") ยาวจนตัดสองบรรทัด (16 ก.ย. 69) */}
              {[t('ต้องตาม'), ...[
                [gStuck, t('ติด step เดิม {n}', { n: gStuck })],
                [gSilent, t('เงียบเกิน {b} วัน {n}', { b: settings.stale, n: gSilent })],
                [gNoCase, t('ยังไม่มีเคส {n}', { n: gNoCase })],
                [Math.max(0, gHigh + gWatch - gStuck - gSilent - gNoCase), t('ช้ากว่าแผน {n}', { n: Math.max(0, gHigh + gWatch - gStuck - gSilent - gNoCase) })],
              ].filter(([n]) => (n as number) > 0).map(([, label]) => label)].join(' · ')}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ color: pendingPeople ? 'var(--warning)' : 'var(--success-dark)' }}>
              {pendingPeople}
              <span className="kpi__of"> {t('คน')}</span>
            </div>
            <div className="kpi__label">
              {t('รอประเมิน')}{pendingEval > pendingPeople ? ` · ${t('{n} รายการ · ', { n: pendingEval }).replace(/ · $/, '')}` : ''}
              {pendingPeople > 0 && <> · <button className="kpi__link" onClick={() => navigate('/teacher/evaluate')}>{t('ไปประเมิน')} ›</button></>}
            </div>
          </div>
          <div className="kpi">
            {/* สีเขียว = สำเร็จ — ใช้เมื่อถึงเป้าเท่านั้น ระหว่างทางเป็นสีตัวเลขปกติ */}
            <div className="kpi__value" style={{ color: groupRisks.reduce((sum, r) => sum + r.completedThisYear, 0) >= groupRisks.length * settings.req.perYear ? 'var(--success)' : undefined }}>
              {groupRisks.reduce((sum, r) => sum + r.completedThisYear, 0)}
              <span className="kpi__of"> / {t('เป้า {n} ชิ้น', { n: groupRisks.length * settings.req.perYear })}</span>
            </div>
            <div className="kpi__label">{t('จบเคสปีนี้')} · {t('เกณฑ์รายปี คนละ {n} ชิ้น', { n: settings.req.perYear })}</div>
          </div>
        </div>

        <div className="panel grppanel" ref={panelRef} style={{ marginTop: 18 }} onMouseLeave={() => setPeek(null)}>
          <h3>{t('นักศึกษาในกลุ่ม')}</h3>
          {/* ไม่มีบรรทัดอธิบายแล้ว — ชื่อขีดเส้นใต้สีฟ้าบอกว่ากดได้อยู่แล้ว และลำดับการเรียง
             เห็นได้จากจุดสีในตาราง · รายละเอียดสีอยู่หลังปุ่ม ⓘ (ผู้ใช้ขอลดความรก 2 ก.ย.) */}
          <p className="sub">{t('สีจุด: เขียว = ตามแผน · แดง = ต้องตาม')}</p>
          <table className={`tbl grptable${peek ? ' grptable--peek' : ''}`}>
            <thead>
              <tr>
                <th style={{ width: 14 }} />
                <th style={{ width: 120 }}>{t('นักศึกษา')}</th>
                <th style={{ width: 66 }}>{t('ชิ้นงานรวม')}</th>
                <th>{t('งานที่กำลังทำ')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={4} className="faint" style={{ padding: 18 }}>{t('ทุกคนอยู่ในแผน')} 🎉</td></tr>
              )}
              {shown.map((r) => {
                const main = r.pieces[0];
                const open = openRow === r.student.id;
                return (
                  <Fragment key={r.student.id}>
                    <tr
                      className={peek?.id === r.student.id ? 'grprow--focus' : undefined}
                      onMouseEnter={(e) => peekRow(r.student.id, e.currentTarget.querySelector<HTMLElement>('.worknow'))}
                      onClick={() => (r.pieces.length > 1 || r.donePieces.length > 0) && setOpenRow(open ? null : r.student.id)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && (r.pieces.length > 1 || r.donePieces.length > 0)) {
                          e.preventDefault();
                          setOpenRow(open ? null : r.student.id);
                        }
                      }}
                      tabIndex={r.pieces.length > 1 || r.donePieces.length > 0 ? 0 : undefined}
                      aria-expanded={r.pieces.length > 1 || r.donePieces.length > 0 ? open : undefined}
                      style={{ cursor: r.pieces.length > 1 || r.donePieces.length > 0 ? 'pointer' : undefined }}
                    >
                      <td>
                        <span
                          role="img"
                          /* สองสี (ผู้ใช้เลือก 16 ก.ย. 69): แดง = ต้องตาม (เสี่ยงสูง + จับตา) ตรงกับเลข "ต้องตาม" ด้านบน · title ยังบอกระดับละเอียด */
                          aria-label={r.risk === 'ok' ? t('ตามแผน') : t('ต้องตาม')}
                          title={r.risk === 'high' ? t('ต้องตาม · เสี่ยงสูง') : r.risk === 'medium' ? t('ต้องตาม · เหลือเผื่อน้อย') : t('ตามแผน')}
                          style={{
                            display: 'block', width: 8, height: 8, borderRadius: 99,
                            background: r.risk === 'ok' ? 'var(--success)' : 'var(--danger-chart)',
                          }}
                        />
                      </td>
                      <td>
                        <button
                          onClick={() => navigate(`/teacher/review?student=${r.student.id}`)}
                          title={t('ดูงานรายคน + คอมเมนต์')}
                          className="cellbtn"
                          style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                        >
                          {(() => {
                            const [fn, ln] = splitPersonName(personName(r.student));
                            return (
                              <div className="grpname">
                                {fn}
                                {ln && <div style={{ fontWeight: 500 }}>{ln}</div>}
                              </div>
                            );
                          })()}
                          <div className="mono" style={{ font: '400 9.5px var(--font-mono)', color: 'var(--text-faint)' }}>{r.student.code}</div>
                        </button>
                      </td>
                      <td>
                        <span
                          className="mono"
                          title={t('จบแล้ว {a} จากทั้งหมด {b} ชิ้นในมือ', { a: r.piecesDone, b: r.piecesTotal })}
                          style={{ font: '600 11.5px var(--font-mono)', color: r.piecesDone > 0 ? 'var(--success)' : 'var(--text-muted)' }}
                        >
                          {r.piecesDone}/{r.piecesTotal}
                        </span>
                      </td>
                      <td>
                        {main ? (
                          <div className="worknow">
                            {/* เลขเดียวพอ: แถบ = ผ่านแล้วกี่ขั้น (มี tooltip) · ข้อความ = กำลังทำขั้นไหน
                               เดิมมี "3/10" คู่กับ "CD-4" คนอ่านเห็นเลขชนกัน (ผู้ใช้งง 2 ก.ย.) */}
                            <span className="worknow__type" style={{ color: typeMeta(main.type).ink }}>{typeMeta(main.type).prefix}</span>
                            <span className="worknow__name">
                              {t('กำลังทำขั้น {n}', { n: Math.min(10, main.progression + 1) })} · {main.name}
                            </span>
                            {r.stuckPeriods >= 2 ? (
                              <span className="worknow__flag" style={{ color: 'var(--warning)' }}>{t('ติดมา {n} คาบ', { n: r.stuckPeriods })}</span>
                            ) : r.silentDays >= settings.stale ? (
                              <span className="worknow__flag" style={{ color: 'var(--danger)' }}>{t('เงียบ {n} วัน', { n: r.silentDays })}</span>
                            ) : (
                              <span className="worknow__ago">{main.days === 0 ? t('วันนี้') : t('{n} วันก่อน', { n: main.days })}</span>
                            )}
                            {(r.pieces.length > 1 || r.donePieces.length > 0) && (
                              /* หลอดจิ๋วชิ้นละหลอดแทน "+2 งาน · จบแล้ว 1" — ตัวเลขอยู่ในการ์ดตอนชี้ */
                              <span className="worknow__more worknow__minis" aria-label={[
                                r.pieces.length > 1 ? t('+{n} งาน', { n: r.pieces.length - 1 }) : '',
                                r.donePieces.length ? t('จบแล้ว {n}', { n: r.donePieces.length }) : '',
                              ].filter(Boolean).join(' · ')}>
                                {/* วงเล็กชิ้นละวงแทนหลอดจิ๋วที่อ่านยาก (ผู้ใช้เลือก 16 ก.ย. 69) · วงเต็มแค่ไหน = ใกล้จบแค่ไหน · ติ๊กเขียว = จบแล้ว */}
                                {r.pieces.map((pc) => {
                                  const C = 2 * Math.PI * 7;
                                  const f = Math.max(0, Math.min(1, pc.progression / Math.max(1, pc.max)));
                                  return (
                                    <svg key={pc.id} viewBox="0 0 20 20" className="minring">
                                      <circle cx="10" cy="10" r="7" className="minring__track" />
                                      <circle cx="10" cy="10" r="7" className="minring__fill" stroke={typeMeta(pc.type).color} strokeDasharray={`${C * f} ${C}`} transform="rotate(-90 10 10)" />
                                    </svg>
                                  );
                                })}
                                {r.donePieces.map((pc) => (
                                  <svg key={pc.id} viewBox="0 0 20 20" className="minring">
                                    <circle cx="10" cy="10" r="8" fill="var(--success-tint)" />
                                    <path d="M6.5 10.2l2.3 2.3 4.7-4.8" fill="none" stroke="var(--success-dark)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ))}
                                <span>{open ? '▴' : '▾'}</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="faint" style={{ font: '400 11px var(--font-body)' }}>{t('ไม่มีเคสในมือ')}</span>
                        )}
                      </td>
                    </tr>

                    {open &&
                      r.pieces.slice(1).map((pc) => (
                        <tr key={pc.id} className="subrow">
                          <td /><td /><td />
                          <td>
                            <div className="worknow">
                              <span className="worknow__type" style={{ color: typeMeta(pc.type).ink }}>{typeMeta(pc.type).prefix}</span>
                              <span className="worknow__name" style={{ fontWeight: 400 }}>
                                {t('กำลังทำขั้น {n}', { n: Math.min(10, pc.progression + 1) })} · {pc.name}
                              </span>
                              <span className="worknow__ago">{pc.days === 0 ? t('วันนี้') : t('{n} วันก่อน', { n: pc.days })}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {open &&
                      r.donePieces.map((pc) => (
                        <tr key={pc.id} className="subrow">
                          <td /><td /><td />
                          <td>
                            <div className="worknow">
                              <span className="worknow__type" style={{ color: typeMeta(pc.type).ink }}>{typeMeta(pc.type).prefix}</span>
                              <span className="worknow__name" style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('จบเคสแล้ว')} ✓</span>
                              <span className="worknow__ago">{pc.days === 0 ? t('วันนี้') : t('{n} วันก่อน', { n: pc.days })}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {(() => {
            const r = peek && groupRisks.find((x) => x.student.id === peek.id);
            if (!peek || !r) return null;
            return (
              <div className="grpcard" role="tooltip" style={{ left: peek.x, top: peek.y, '--ax': `${peek.ax}px` } as React.CSSProperties}>
                <b>{personName(r.student)}</b>
                <small>{t('งานในมือ {a} ชิ้น · จบแล้ว {b}', { a: r.pieces.length, b: r.donePieces.length })}</small>
                {r.pieces.map((pc, i) => (
                  <span className="grpcard__pc" key={pc.id} style={{ '--k': i } as React.CSSProperties}>
                    <span style={{ color: '#9db4ff' }}>{typeMeta(pc.type).prefix}</span>
                    <span className="grpcard__tr"><i style={{ width: `${Math.round((pc.progression / Math.max(1, pc.max)) * 100)}%` }} /></span>
                    <span className="grpcard__d">{pc.days === 0 ? t('วันนี้') : t('{n} วัน', { n: pc.days })}</span>
                  </span>
                ))}
                {r.donePieces.map((pc, i) => (
                  <span className="grpcard__pc" key={pc.id} style={{ '--k': r.pieces.length + i } as React.CSSProperties}>
                    <span style={{ color: '#6ce9a6' }}>{typeMeta(pc.type).prefix}</span>
                    <span className="grpcard__tr"><i style={{ width: '100%', background: '#12b76a' }} /></span>
                    <span className="grpcard__d">{t('จบเคสแล้ว')}</span>
                  </span>
                ))}
                {r.stuckPeriods >= 2 && <small className="grpcard__warn">{t('ติดมา {n} คาบ', { n: r.stuckPeriods })}</small>}
                {r.risk !== 'ok' && <small>{t(r.reason)}</small>}
              </div>
            );
          })()}
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <h3>{t('เปรียบเทียบกลุ่มกับค่าเฉลี่ยชั้นปี')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(290px, 100%), 1fr))', gap: 26, alignItems: 'start', marginTop: 8 }}>
            <DivergingBars
              axes={groupProfile}
              reference={cohortProfile}
              label={`${t('กลุ่ม')} ${groupShort(group)}`}
              referenceLabel={t('ค่าเฉลี่ยทั้งชั้นปี')}
            />
            <div>
              <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 2 }}>{t('รายคนในกลุ่ม')}</div>
              <Heatmap rows={heat} />
            </div>
          </div>
        </div>
      </main>
    </TeacherShell>
  );
}
