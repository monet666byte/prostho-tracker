import { CalendarCheck, CheckCircle, Clock, Exam, Export, HourglassMedium, Plus } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty } from '../../components/ui/Bits';
import { Shell } from '../../components/student/Shell';
import { addCheckIn } from '../../data/repo';
import { ACTIVITIES, CRITERIA, MAX_TOTAL, NO_PATIENT_ACTIVITY, totalScore } from '../../domain/checkin';
import { useCheckIns, useStepsOnDates, useWorkpieces } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { isComplete } from '../../domain/rules';
import { useApp } from '../../store/app';

export default function CheckInPage() {
  const { session, showToast } = useApp();
  const checkins = useCheckIns(session?.studentId);
  const works = useWorkpieces(session?.studentId);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const navigate = useNavigate();

  // form state
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [activities, setActivities] = useState<string[]>([]);
  const [patientId, setPatientId] = useState('');
  const [note, setNote] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const doneToday = checkins.some((c) => c.date === today);
  const noPatient = activities.includes(NO_PATIENT_ACTIVITY);
  const patients = useMemo(() => {
    const seen = new Map<string, string>();
    works.forEach((w) => seen.set(w.patient.id, `${w.patient.name} · HN ${w.patient.hn}`));
    return [...seen.entries()];
  }, [works]);

  // เลขคาบตามลำดับวันที่ เหมือนคอลัมน์ # ในสมุด
  const periodNo = useMemo(() => {
    const asc = [...checkins].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    return new Map(asc.map((c, i) => [c.id, i + 1]));
  }, [checkins]);

  const evaluated = checkins.filter((c) => c.status === 'evaluated');
  const stepsByDate = useStepsOnDates(
    session ? checkins.map((c) => ({ studentId: session.studentId, date: c.date })) : [],
  );
  const noPatientCount = checkins.filter((c) => c.noPatient).length;

  async function submit() {
    if (!session) return;
    // เวลาเช็คอิน = เวลาระบบตอนกด แก้เองไม่ได้ — ตรงเวลา/สายคำนวณจากเวลานี้
    // (สมมติฐานเดโม: คาบเช้าเริ่ม 09:00 บ่าย 13:00 เผื่อสาย 15 นาที — ของจริงผูกกับตารางคาบ)
    const now = new Date();
    const checkinAt = now.toTimeString().slice(0, 5);
    const punctual = now.getHours() < 12 ? checkinAt <= '09:15' : checkinAt <= '13:15';
    await addCheckIn({
      studentId: session.studentId,
      date,
      punctual,
      checkinAt,
      noPatient,
      patientId: patientId || undefined,
      activities,
      note,
      actor: 'นศ. ก',
    });
    setFormOpen(false);
    setActivities([]);
    setNote('');
    // เช็คอินคือจุดเริ่มของคาบ — ถ้าบอกแล้วว่าทำกับผู้ป่วยคนไหน พาไปเคสนั้นต่อเลย ไม่ต้องไปหาเอง
    const target = patientId
      ? works
          .filter((w) => w.patientId === patientId && !isComplete(w))
          .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0]
      : undefined;
    showToast({
      message: target
        ? `เช็คอินแล้ว — ไปที่เคส ${target.detail} ต่อเลย`
        : `เช็คอินคาบ ${thaiShort(date)} แล้ว · รออาจารย์ประเมิน`,
      tone: 'success',
    });
    if (target) navigate(`/app/work/${target.id}`);
  }

  const overlay = formOpen ? (
    <div className="backdrop" onClick={() => setFormOpen(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <h3 className="h3">เช็คอินคาบคลินิก</h3>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>วันที่คาบ</span>
            <input className="input mono" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <span
            style={{
              marginTop: 22, height: 44, borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '0 13px', background: 'var(--fill)', font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)',
              flex: 'none',
            }}
          >
            <Clock size={15} weight="fill" style={{ color: 'var(--text-muted)' }} />
            {new Date().toTimeString().slice(0, 5)} น.
          </span>
        </div>
        <p style={{ margin: '6px 0 0', font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
          เวลาเช็คอินระบบบันทึกให้เอง แก้ไม่ได้ — ตรงเวลา/มาสายตัดสินจากเวลานี้ (เช้า 9:00 / บ่าย 13:00 เผื่อ 15 นาที)
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <label>กิจกรรมในคาบ</label>
          <div className="seg">
            {ACTIVITIES.map((a) => (
              <button
                key={a}
                data-on={activities.includes(a)}
                onClick={() =>
                  setActivities(activities.includes(a) ? activities.filter((x) => x !== a) : [...activities, a])
                }
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {!noPatient && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>ผู้ป่วยที่นัด</span>
            <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {patients.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
        )}

        <label className="field" style={{ marginTop: 12 }}>
          <span>โน้ตเพิ่มเติม (ไม่บังคับ)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="โน้ตถึงอาจารย์" />
        </label>

        <button className="btn" style={{ height: 54, marginTop: 15 }} disabled={activities.length === 0} onClick={submit}>
          <CalendarCheck size={19} weight="fill" />
          เช็คอิน
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={() => setFormOpen(false)}>ยกเลิก</button>
      </div>
    </div>
  ) : undefined;

  return (
    <Shell overlay={overlay}>
      <header className="s-header">
        <h2 className="h2">คาบคลินิก</h2>
        <p style={{ margin: '3px 0 0', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {checkins.length} คาบ · ประเมินแล้ว {evaluated.length} · ไม่มีผู้ป่วย {noPatientCount}
        </p>
      </header>

      <div style={{ padding: '14px 16px 0', display: 'grid', gap: 11 }}>
        {doneToday ? (
          <div
            className="card"
            style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--success-tint)', borderColor: '#CDEEDF' }}
          >
            <CheckCircle size={20} weight="fill" color="var(--success)" style={{ flex: 'none' }} />
            <span style={{ font: '500 12.5px var(--font-body)', color: 'var(--success-dark)' }}>
              เช็คอินคาบวันนี้แล้ว — รออาจารย์ประเมิน
            </span>
          </div>
        ) : (
          <button className="btn" style={{ height: 54 }} onClick={() => setFormOpen(true)}>
            <Plus size={19} weight="bold" />
            เช็คอินคาบวันนี้
          </button>
        )}

        {checkins.length === 0 && (
          <Empty icon={<CalendarCheck size={26} />} title="ยังไม่มีคาบที่บันทึก" hint="" />
        )}

        {checkins.map((c) => {
          const total = totalScore(c.scores);
          const open = expanded === c.id;
          return (
            <button
              key={c.id}
              className="card"
              style={{ padding: '12px 14px', textAlign: 'left' }}
              onClick={() => setExpanded(open ? null : c.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 30, height: 30, borderRadius: 9, flex: 'none', display: 'grid', placeItems: 'center',
                    background: 'var(--fill)', font: '600 11px var(--font-mono)', color: 'var(--text-muted)',
                  }}
                >
                  {periodNo.get(c.id)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', font: '600 12.5px var(--font-head)' }}>{thaiShort(c.date)}</span>
                  <span
                    style={{
                      display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {c.activities.join(' · ')}
                  </span>
                </span>
                {!c.punctual && (
                  <span className="badge" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)' }}>สาย</span>
                )}
                {c.status === 'evaluated' ? (
                  <span className="chip" style={{ background: 'var(--success-tint)', color: 'var(--success-dark)' }}>
                    <Exam size={12} weight="fill" /> {total}/{MAX_TOTAL}
                  </span>
                ) : (
                  <span className="chip" style={{ background: 'var(--accent-tint)', color: 'var(--accent-hover)' }}>
                    <HourglassMedium size={12} /> รอประเมิน
                  </span>
                )}
              </div>

              {open && c.scores && (
                <div style={{ marginTop: 11, borderTop: '1px solid var(--divider)', paddingTop: 10, display: 'grid', gap: 5 }}>
                  {CRITERIA.map((cr) => (
                    <div key={cr.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, font: '400 11px var(--font-body)', color: 'var(--text-muted)' }}>{cr.label}</span>
                      <span className="bar" style={{ height: 7, width: 60, flex: 'none' }}>
                        <i style={{ width: `${((c.scores?.[cr.key] ?? 0) / 3) * 100}%`, background: (c.scores?.[cr.key] ?? 0) >= 3 ? 'var(--accent)' : 'var(--warning)' }} />
                      </span>
                      <span className="mono" style={{ width: 14, textAlign: 'right', font: '600 10.5px var(--font-mono)' }}>
                        {c.scores?.[cr.key] ?? '—'}
                      </span>
                    </div>
                  ))}
                  <span style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 3 }}>
                    ประเมินโดย {c.evaluatedBy} · {c.evaluatedAt ? thaiShort(c.evaluatedAt) : ''}
                  </span>
                </div>
              )}
              {open && (
                <div style={{ marginTop: 9, borderTop: c.scores ? undefined : '1px solid var(--divider)', paddingTop: c.scores ? 0 : 9 }}>
                  <div style={{ font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                    step ที่ผ่านในวันนั้น:{' '}
                    {(stepsByDate.get(`${c.studentId}|${c.date}`) ?? []).length > 0 ? (
                      <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                        {(stepsByDate.get(`${c.studentId}|${c.date}`) ?? []).join(' · ')}
                      </span>
                    ) : (
                      <span className="faint">ยังไม่มีบันทึก</span>
                    )}
                  </div>
                  {c.note && (
                    <div style={{ marginTop: 5, font: '400 11px var(--font-body)', color: 'var(--text-muted)' }}>โน้ต: {c.note}</div>
                  )}
                </div>
              )}
            </button>
          );
        })}

        <Link
          to="/app/export"
          className="dashed"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, font: '600 12.5px var(--font-body)', color: 'var(--text-muted)' }}
        >
          <Export size={16} /> ส่งออกข้อมูลชิ้นงาน (PDF / CSV)
        </Link>
      </div>
    </Shell>
  );
}
