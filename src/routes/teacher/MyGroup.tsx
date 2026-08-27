import { CalendarCheck, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { DivergingBars } from '../../components/charts/Diverging';
import { Heatmap } from '../../components/charts/Heatmap';
import { averageProfile, heatmapRows, riskRows } from '../../domain/analytics';
import { TYPES } from '../../domain/catalog';
import {
  useAllCheckIns, useAllProgressUpdates, useAllStudents, useAllWorkpieces,
} from '../../hooks/data';
import { useApp } from '../../store/app';

/** หน้า "กลุ่มของฉัน" — งานประจำวันของอาจารย์ที่ปรึกษา ทุกอย่างในหน้านี้เป็นของกลุ่มเดียว */
export default function MyGroup() {
  const { settings } = useApp();
  const group = useApp((st) => st.teacherGroup);
  const students = useAllStudents();
  const works = useAllWorkpieces();
  const checkinsAll = useAllCheckIns();
  const updatesAll = useAllProgressUpdates();
  const navigate = useNavigate();
  const [openRow, setOpenRow] = useState<string | null>(null);

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
  const gSilent = groupRisks.filter((r) => r.silentDays >= settings.stale && r.stuckPeriods < 2).length;

  const studentGroupById = useMemo(() => new Map(students.map((st) => [st.id, st.group])), [students]);
  const pendingList = checkinsAll.filter(
    (c) => c.status === 'pending' && studentGroupById.get(c.studentId) === group,
  );
  const pendingEval = pendingList.length;
  const pendingPeople = new Set(pendingList.map((c) => c.studentId)).size;

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
            <h1>กลุ่ม {group.replace('TH-', '')}</h1>
            <p>{groupStudents.length} คน · <b>step</b> = ขั้นงานของแต่ละเคส (0 พิมพ์ปากครั้งแรก → 10 ปิดเคส)</p>
          </div>
        </div>

        <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {/* ยุบการ์ด "ติด step/เงียบหาย" มาเป็นบรรทัดสาเหตุของ "ต้องตาม" — สองการ์ดเดิมชี้คนกลุ่มเดียวกัน */}
          <div className="kpi" style={{ borderColor: gHigh ? 'var(--danger-border)' : undefined }}>
            <div className="kpi__label"><WarningCircle size={14} /> ต้องตาม</div>
            <div className="kpi__value" style={{ color: gHigh ? 'var(--danger-chart)' : 'var(--success)' }}>
              {gHigh + gWatch}
              <span style={{ font: '500 13px var(--font-body)', color: 'var(--text-faint)' }}> / {groupRisks.length} คน</span>
            </div>
            <div className="kpi__hint">
              ติด step เดิม {gStuck} · เงียบเกิน {settings.stale} วัน {gSilent} · ช้ากว่าแผน {Math.max(0, gHigh + gWatch - gStuck - gSilent)}
            </div>
          </div>
          {/* รอประเมินอยู่กลาง — งานที่ต้องทำวันนี้สำคัญสุด มีจุดแดงเตือนแบบ noti เมื่อมีคิวค้าง */}
          <button
            className="kpi"
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: pendingPeople ? 'var(--accent-ring)' : undefined }}
            onClick={() => navigate('/teacher/evaluate')}
          >
            <div className="kpi__label" style={{ position: 'relative' }}>
              <CalendarCheck size={14} /> รอประเมิน
              {pendingPeople > 0 && (
                <span
                  style={{
                    marginLeft: 4, background: 'var(--danger)', color: '#fff', borderRadius: 99,
                    padding: '1px 6px', font: '600 9.5px var(--font-mono)', animation: 'pulseRing 2s infinite',
                  }}
                >
                  {pendingPeople}
                </span>
              )}
            </div>
            <div className="kpi__value" style={{ color: pendingPeople ? 'var(--accent)' : undefined }}>
              {pendingPeople}
              <span style={{ font: '500 13px var(--font-body)', color: 'var(--text-faint)' }}> คน</span>
            </div>
            <div className="kpi__hint">
              {pendingEval > pendingPeople ? `${pendingEval} รายการ · ` : ''}เช็คอินแล้ว รออาจารย์ให้คะแนน ›
            </div>
          </button>
          <div className="kpi">
            <div className="kpi__label"><CheckCircle size={14} /> จบเคสปีนี้</div>
            {/* สีเขียว = สำเร็จ — ใช้เมื่อถึงเป้าเท่านั้น ระหว่างทางเป็นสีตัวเลขปกติ */}
            <div className="kpi__value" style={{ color: groupRisks.reduce((sum, r) => sum + r.completedThisYear, 0) >= groupRisks.length * settings.req.perYear ? 'var(--success)' : undefined }}>
              {groupRisks.reduce((sum, r) => sum + r.completedThisYear, 0)}
              <span style={{ font: '500 13px var(--font-body)', color: 'var(--text-faint)' }}> / เป้า {groupRisks.length * settings.req.perYear} ชิ้น</span>
            </div>
            <div className="kpi__hint">เกณฑ์รายปี คนละ {settings.req.perYear} ชิ้น</div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>นักศึกษาในกลุ่ม</h3>
          <p className="sub">🔴 = ควรเข้าไปตาม · เรียงคนที่น่าห่วงไว้บน · กดชื่อเพื่อดูงานรายคน</p>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 14 }} />
                <th style={{ width: 120 }}>นักศึกษา</th>
                <th style={{ width: 66 }}>ชิ้นงานรวม</th>
                <th>งานที่กำลังทำ</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={4} className="faint" style={{ padding: 18 }}>ทุกคนอยู่ในแผน 🎉</td></tr>
              )}
              {shown.map((r) => {
                const main = r.pieces[0];
                const open = openRow === r.student.id;
                return (
                  <Fragment key={r.student.id}>
                    <tr
                      title={r.reason}
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
                          aria-label={r.risk === 'high' ? 'เสี่ยงสูง' : r.risk === 'medium' ? 'จับตา' : 'ตามแผน'}
                          title={r.risk === 'high' ? 'เสี่ยงสูง' : r.risk === 'medium' ? 'จับตา' : 'ตามแผน'}
                          style={{
                            display: 'block', width: 8, height: 8, borderRadius: 99,
                            background: r.risk === 'high' ? 'var(--danger-chart)' : r.risk === 'medium' ? 'var(--warning)' : 'var(--success)',
                          }}
                        />
                      </td>
                      <td>
                        <button
                          onClick={() => navigate(`/teacher/review?student=${r.student.id}`)}
                          title="ดูงานรายคน + คอมเมนต์"
                          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
                        >
                          <div style={{ font: '600 12px var(--font-body)', color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3 }}>{r.student.name}</div>
                          <div className="mono" style={{ font: '400 9.5px var(--font-mono)', color: 'var(--text-faint)' }}>{r.student.code}</div>
                        </button>
                      </td>
                      <td>
                        <span
                          className="mono"
                          title={`จบแล้ว ${r.piecesDone} จากทั้งหมด ${r.piecesTotal} ชิ้นในมือ`}
                          style={{ font: '600 11.5px var(--font-mono)', color: r.piecesDone > 0 ? 'var(--success)' : 'var(--text-muted)' }}
                        >
                          {r.piecesDone}/{r.piecesTotal}
                        </span>
                      </td>
                      <td>
                        {main ? (
                          <div className="worknow">
                            <span className="bar" style={{ height: 6, width: 90, flex: 'none' }}>
                              <i style={{ width: `${(main.progression / 10) * 100}%`, background: 'var(--accent)' }} />
                            </span>
                            <span className="mono faint" style={{ fontSize: 10, flex: 'none' }}>{main.progression}/10</span>
                            <span className="badge" style={{ background: TYPES[main.type].tint, color: TYPES[main.type].color, flex: 'none' }}>
                              {main.code}
                            </span>
                            <span className="worknow__name">{main.name}</span>
                            {r.stuckPeriods >= 2 ? (
                              <span className="chip" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)', flex: 'none' }}>
                                ติดมา {r.stuckPeriods} คาบ
                              </span>
                            ) : r.silentDays >= settings.stale ? (
                              <span className="chip" style={{ background: 'var(--danger-tint)', color: 'var(--danger-dark)', flex: 'none' }}>
                                เงียบ {r.silentDays} วัน
                              </span>
                            ) : (
                              <span className="faint" style={{ font: '400 10px var(--font-body)', flex: 'none' }}>{main.days} วันก่อน</span>
                            )}
                            {(r.pieces.length > 1 || r.donePieces.length > 0) && (
                              <span className="worknow__more">
                                {open
                                  ? 'ซ่อน ▴'
                                  : [
                                      r.pieces.length > 1 ? `+${r.pieces.length - 1} งาน` : '',
                                      r.donePieces.length ? `จบแล้ว ${r.donePieces.length}` : '',
                                    ].filter(Boolean).join(' · ') + ' ▾'}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="faint" style={{ font: '400 11px var(--font-body)' }}>ไม่มีเคสในมือ</span>
                        )}
                      </td>
                    </tr>

                    {open &&
                      r.pieces.slice(1).map((pc) => (
                        <tr key={pc.id} className="subrow">
                          <td /><td /><td />
                          <td>
                            <div className="worknow">
                              <span className="bar" style={{ height: 6, width: 90, flex: 'none' }}>
                                <i style={{ width: `${(pc.progression / 10) * 100}%`, background: 'var(--accent)' }} />
                              </span>
                              <span className="mono faint" style={{ fontSize: 10, flex: 'none' }}>{pc.progression}/10</span>
                              <span className="badge" style={{ background: TYPES[pc.type].tint, color: TYPES[pc.type].color, flex: 'none' }}>
                                {pc.code}
                              </span>
                              <span className="worknow__name" style={{ fontWeight: 400 }}>{pc.name}</span>
                              <span className="faint" style={{ font: '400 10px var(--font-body)', flex: 'none' }}>{pc.days} วันก่อน</span>
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
                              <span className="bar" style={{ height: 6, width: 90, flex: 'none' }}>
                                <i style={{ width: '100%', background: 'var(--success)' }} />
                              </span>
                              <span className="mono" style={{ fontSize: 10, flex: 'none', color: 'var(--success)' }}>10/10</span>
                              <span className="badge" style={{ background: TYPES[pc.type].tint, color: TYPES[pc.type].color, flex: 'none' }}>
                                {TYPES[pc.type].prefix}
                              </span>
                              <span className="worknow__name" style={{ fontWeight: 400, color: 'var(--text-muted)' }}>จบเคสแล้ว ✓</span>
                              <span className="faint" style={{ font: '400 10px var(--font-body)', flex: 'none' }}>{pc.days} วันก่อน</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <h3>เปรียบเทียบกลุ่มกับค่าเฉลี่ยชั้นปี</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1px 1fr', gap: 26, alignItems: 'start', marginTop: 8 }}>
            <DivergingBars
              axes={groupProfile}
              reference={cohortProfile}
              label={`กลุ่ม ${group.replace('TH-', '')}`}
              referenceLabel="ค่าเฉลี่ยทั้งชั้นปี"
            />
            <span style={{ background: 'var(--divider)', alignSelf: 'stretch' }} />
            <div>
              <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 2 }}>รายคนในกลุ่ม</div>
              <p className="sub" style={{ marginBottom: 12 }}>% ของเป้าหมายแต่ละด้าน</p>
              <Heatmap rows={heat} />
            </div>
          </div>
        </div>
      </main>
    </TeacherShell>
  );
}
