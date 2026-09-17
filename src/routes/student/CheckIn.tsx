import { CalendarCheck, CheckCircle, Clock, NotePencil, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty } from '../../components/ui/Bits';
import { Shell } from '../../components/student/Shell';
import { addCheckIn, deleteCheckIn, updateCheckIn } from '../../data/repo';
import { ACTIVITY_GROUPS, CRITERIA, MAX_SCORE, MAX_TOTAL, NO_PATIENT_ACTIVITY, checkInStamp, totalScore } from '../../domain/checkin';
import { useCheckIns, usePatientNamesOn, useStepsOnDates, useWorkpieces } from '../../hooks/data';
import { patientWithHn } from '../../lib/privacy';
import { thaiShort, toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
import { isComplete } from '../../domain/rules';
import { currentActor, useApp } from '../../store/app';

export default function CheckInPage() {
  const { session, showToast } = useApp();
  const checkins = useCheckIns(session?.studentId);
  const works = useWorkpieces(session?.studentId);
  const namesOn = usePatientNamesOn();
  const [formOpen, setFormOpen] = useState(false);
  // เช็คอินด่วนจากหน้าแรกยังไม่มีกิจกรรม — เปิดฟอร์มโหมดเติมรายละเอียดให้คาบเดิมแทนการสร้างใหม่
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // ลบคาบ: กดครั้งแรกเปลี่ยนเป็น "ยืนยันลบ?" กันมือลั่น — เปลี่ยนคาบ/พับแถวเมื่อไหร่รีเซ็ต
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const navigate = useNavigate();

  // form state
  const [date, setDate] = useState(toISODate(new Date()));
  const [activities, setActivities] = useState<string[]>([]);
  const [patientId, setPatientId] = useState('');
  const [note, setNote] = useState('');

  const today = toISODate(new Date());
  const todayEntry = checkins.find((c) => c.date === today);
  const editingEntry = editingId ? checkins.find((c) => c.id === editingId) : undefined;
  const doneToday = !!todayEntry;
  const todayNeedsDetail = !!todayEntry && todayEntry.activities.length === 0;

  function openFillForm() {
    if (todayEntry) openEditForm(todayEntry);
  }

  /** เปิดฟอร์มแก้คาบใดๆ ที่ยังไม่ถูกประเมิน — กดผิด/ลืมติ๊ก แก้เองได้ไม่ต้องรออาจารย์ */
  function openEditForm(entry: (typeof checkins)[number]) {
    if (entry.status === 'evaluated') return;
    setEditingId(entry.id);
    setDate(entry.date);
    setActivities([...entry.activities]);
    setPatientId(entry.patientId ?? '');
    setNote(entry.note ?? '');
    setFormOpen(true);
  }
  const noPatient = activities.includes(NO_PATIENT_ACTIVITY);
  const patients = useMemo(() => {
    const seen = new Map<string, string>();
    works.forEach((w) => seen.set(w.patient.id, patientWithHn(w.patient, namesOn, t)));
    return [...seen.entries()];
  }, [works]);

  const evaluated = checkins.filter((c) => c.status === 'evaluated');
  const stepsByDate = useStepsOnDates(
    session ? checkins.map((c) => ({ studentId: session.studentId, date: c.date })) : [],
  );
  const noPatientCount = checkins.filter((c) => c.noPatient).length;

  async function submit() {
    if (!session) return;
    if (editingId) {
      // โหมดเติมรายละเอียด — เวลากับความตรงเวลาถูกล็อกไว้ตั้งแต่ตอนเช็คอินด่วนแล้ว
      await updateCheckIn(editingId, { activities, patientId: patientId || undefined, noPatient, note }, currentActor());
    } else {
      // เวลาเช็คอิน = เวลาระบบตอนกด แก้เองไม่ได้ — เกณฑ์ตรงเวลา/สายอยู่ที่ domain/checkin.ts ที่เดียว
      const { checkinAt, punctual } = checkInStamp();
      await addCheckIn({
        studentId: session.studentId,
        date,
        punctual,
        checkinAt,
        noPatient,
        patientId: patientId || undefined,
        activities,
        note,
        actor: currentActor(),
      });
    }
    const wasEditing = !!editingId;
    setFormOpen(false);
    setEditingId(null);
    setActivities([]);
    setNote('');
    // เช็คอินคือจุดเริ่มของคาบ — ถ้าบอกแล้วว่าทำกับผู้ป่วยคนไหน พาไปเคสนั้นต่อเลย ไม่ต้องไปหาเอง
    const target = patientId
      ? works
          .filter((w) => w.patientId === patientId && !isComplete(w))
          .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0]
      : undefined;
    showToast({
      message: wasEditing
        ? t('บันทึกการแก้ไขแล้ว — คาบนี้ยังรออาจารย์ประเมินตามปกติ')
        : target
          ? t('เช็คอินแล้ว — ไปที่เคส {d} ต่อเลย', { d: target.detail })
          : t('เช็คอินคาบ {d} แล้ว · รออาจารย์ประเมิน', { d: thaiShort(date) }),
      tone: 'success',
    });
    // เด้งไปหน้าเคสเฉพาะเช็คอินใหม่ (จุดเริ่มคาบ) — แก้คาบย้อนหลังต้องอยู่หน้าลิสต์เดิม ไม่งั้นงง
    if (target && !wasEditing) navigate(`/app/work/${target.id}`);
  }

  const overlay = formOpen ? (
    <div className="backdrop" onClick={() => { setFormOpen(false); setEditingId(null); }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <h3 className="h3">{editingId ? t('แก้ไขคาบ {d}', { d: thaiShort(editingEntry?.date ?? date) }) : t('เช็คอินคาบคลินิก')}</h3>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>{t('วันที่คาบ')}</span>
            <input className="input mono" type="date" value={date} max={today} disabled={!!editingId} onChange={(e) => setDate(e.target.value)} />
          </label>
          <span
            style={{
              marginTop: 22, height: 44, borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '0 13px', background: 'var(--fill)', font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)',
              flex: 'none',
            }}
          >
            <Clock size={15} weight="fill" style={{ color: 'var(--text-muted)' }} />
            {t('{time} น.', { time: editingId ? (editingEntry?.checkinAt ?? '') : new Date().toTimeString().slice(0, 5) })}
          </span>
        </div>
        <p style={{ margin: '6px 0 0', font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
          {editingId
            ? t('เวลาถูกบันทึกไว้ตั้งแต่ตอนเช็คอินแล้ว — ตรงนี้แค่เติมว่าทำอะไรบ้าง')
            : t('เช็คอินล่วงหน้าก่อนเริ่มคาบได้เลย · เวลาเช็คอินระบบบันทึกให้เอง แก้ไม่ได้ (นับตรงเวลาเมื่อก่อน 9:15 เช้า / 13:15 บ่าย)')}
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <label>{t('กิจกรรมในคาบ')}</label>
          {ACTIVITY_GROUPS.map((g) => (
                <div key={g.label} className="actgroup">
                  <div className="actgroup__label">{t(g.label)}</div>
                  <div className="actgrid">
                    {g.items.map((a) => (
                      <button key={a} data-on={activities.includes(a)} onClick={() => setActivities(activities.includes(a) ? activities.filter((x) => x !== a) : [...activities, a])}>
                        {t(a)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
        </div>

        {!noPatient && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>{t('ผู้ป่วยที่นัด')}</span>
            <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">{t('— ไม่ระบุ —')}</option>
              {patients.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
        )}

        <label className="field" style={{ marginTop: 12 }}>
          <span>{t('โน้ตเพิ่มเติม (ไม่บังคับ)')}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('โน้ตถึงอาจารย์')} />
        </label>

        <button className="btn" style={{ height: 54, marginTop: 15 }} disabled={activities.length === 0} onClick={submit}>
          <CalendarCheck size={19} weight="fill" />
          {editingId ? t('บันทึกกิจกรรม') : t('เช็คอิน')}
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={() => { setFormOpen(false); setEditingId(null); }}>{t('ยกเลิก')}</button>
      </div>
    </div>
  ) : undefined;

  return (
    <Shell overlay={overlay}>
      <header className="s-header">
        <h1 className="h2">{t('คาบคลินิก')}</h1>
        <p style={{ margin: '3px 0 0', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('{n} คาบ · ประเมินแล้ว {e} · ไม่มีผู้ป่วย {p}', { n: checkins.length, e: evaluated.length, p: noPatientCount })}
        </p>
      </header>

      {/* minmax(0,1fr): กันแถวที่มีชิป nowrap ดันคอลัมน์ grid กว้างทะลุ padding ขวา (เห็นชัดใน Safari) */}
      <div style={{ padding: '14px 16px 0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 11 }}>
        {todayNeedsDetail ? (
          <button
            className="card"
            style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', borderColor: 'var(--accent-ring)' }}
            onClick={openFillForm}
          >
            <NotePencil size={20} color="var(--accent)" style={{ flex: 'none' }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', font: '600 12.5px var(--font-head)' }}>{t('เช็คอินแล้ว {time} น. ✓', { time: todayEntry?.checkinAt ?? '' })}</span>
              <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 1 }}>
                {t('ว่างเมื่อไหร่ แตะตรงนี้เพื่อเติมว่าคาบนี้ทำอะไรบ้าง')}
              </span>
            </span>
          </button>
        ) : doneToday ? (
          <div
            className="card"
            style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--success-tint)', borderColor: '#CDEEDF' }}
          >
            <CheckCircle size={20} weight="fill" color="var(--success)" style={{ flex: 'none' }} />
            <span style={{ font: '500 12.5px var(--font-body)', color: 'var(--success-dark)' }}>
              {t('เช็คอินคาบวันนี้แล้ว — รออาจารย์ประเมิน')}
            </span>
          </div>
        ) : (
          <button className="btn" style={{ height: 54 }} onClick={() => setFormOpen(true)}>
            <Plus size={19} weight="bold" />
            {t('เช็คอินคาบวันนี้')}
          </button>
        )}

        {checkins.length === 0 && (
          <Empty icon={<CalendarCheck size={26} />} title={t('ยังไม่มีคาบที่บันทึก')} />
        )}

        {/* หน้าคาบแบบ "ตัดของซ้ำ": การ์ด 8 ใบ → การ์ดเดียวแถวละคาบ
            ตัดเลขลำดับในกล่องเทา · ชิปคะแนน/รอประเมิน → ตัวอักษร (เต็ม = เขียว · รอ = ส้ม) */}
        {checkins.length > 0 && (
          <div className="homelabel" style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 4px -3px' }}>
            <span>{t('คาบที่ผ่านมา')}</span><span className="mono" style={{ fontSize: 12 }}>{checkins.length}</span>
          </div>
        )}
        {checkins.length > 0 && <div className="card checklist">
        {checkins.map((c) => {
          const total = totalScore(c.scores);
          const open = expanded === c.id;
          return (
            /* div ไม่ใช่ button: ข้างในมีปุ่มแก้/ลบ และ HTML ห้าม button ซ้อน button
 */
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className="checkrow"
              onClick={() => { setExpanded(open ? null : c.id); setConfirmDelete(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(open ? null : c.id); setConfirmDelete(null); } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', font: '600 14.5px/1.35 var(--font-head)' }}>{thaiShort(c.date)}</span>
                  <span
                    style={{
                      display: 'block', font: '400 12.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {c.activities.length ? c.activities.map((a) => t(a)).join(' · ') : t('ยังไม่ระบุกิจกรรม')}
                  </span>
                </span>
                {!c.punctual && (
                  <span className="checkrow__tag" style={{ color: 'var(--warning-dark)' }}>{t('สาย')}</span>
                )}
                {c.editedAt && c.status !== 'evaluated' && (
                  <span className="checkrow__tag" title={t('แก้ไขล่าสุด')}>
                    {t('แก้ไข')} {thaiShort(c.editedAt)}
                  </span>
                )}
                {c.status === 'evaluated' ? (
                  <span className="checkrow__score" style={{ color: total === MAX_TOTAL ? 'var(--success-dark)' : undefined }}>
                    {total}/{MAX_TOTAL}
                  </span>
                ) : (
                  <span className="checkrow__wait">{t('รอประเมิน')}</span>
                )}
              </div>

              {open && c.scores && (
                <div style={{ marginTop: 11, borderTop: '1px solid var(--divider)', paddingTop: 10, display: 'grid', gap: 5 }}>
                  {CRITERIA.map((cr) => (
                    <div key={cr.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, font: '400 11px var(--font-body)', color: 'var(--text-muted)' }}>{cr.label}</span>
                      <span className="bar" style={{ height: 7, width: 60, flex: 'none' }}>
                        <i style={{ width: `${((c.scores?.[cr.key] ?? 0) / MAX_SCORE) * 100}%`, background: (c.scores?.[cr.key] ?? 0) >= MAX_SCORE ? 'var(--accent)' : 'var(--warning)' }} />
                      </span>
                      <span className="mono" style={{ width: 14, textAlign: 'right', font: '600 10.5px var(--font-mono)' }}>
                        {c.scores?.[cr.key] ?? '—'}
                      </span>
                    </div>
                  ))}
                  <span style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 3 }}>
                    {t('ประเมินโดย')} {t(c.evaluatedBy ?? '')} · {c.evaluatedAt ? thaiShort(c.evaluatedAt) : ''}
                  </span>
                </div>
              )}
              {open && c.status !== 'evaluated' && (
                <div
                  style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: '1px solid var(--divider)', paddingTop: 10 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="btn btn--sec"
                    style={{ height: 40, flex: 1, font: '600 11.5px var(--font-body)' }}
                    onClick={() => openEditForm(c)}
                  >
                    <PencilSimple size={14} /> {t('แก้ไขคาบนี้')}
                  </button>
                  <button
                    className="btn btn--sec"
                    style={{ height: 40, flex: 1, font: '600 11.5px var(--font-body)', color: 'var(--danger)' }}
                    onClick={async () => {
                      // เผลอเช็คอินผิดวัน (เปิดแอปเล่นแล้วกด) — ลบคาบทิ้งได้ตราบที่ยังไม่ถูกประเมิน
                      if (confirmDelete !== c.id) { setConfirmDelete(c.id); return; }
                      await deleteCheckIn(c.id, currentActor());
                      setConfirmDelete(null);
                      setExpanded(null);
                      showToast({ message: t('ลบคาบ {d} แล้ว', { d: thaiShort(c.date) }), tone: 'success' });
                    }}
                  >
                    <Trash size={14} /> {confirmDelete === c.id ? t('ยืนยันลบ?') : t('ลบคาบนี้')}
                  </button>
                </div>
              )}
              {open && (
                <div style={{ marginTop: 9, borderTop: c.scores ? undefined : '1px solid var(--divider)', paddingTop: c.scores ? 0 : 9 }}>
                  <div style={{ font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                    {t('step ที่ผ่านในวันนั้น')}:{' '}
                    {(stepsByDate.get(`${c.studentId}|${c.date}`) ?? []).length > 0 ? (
                      <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                        {(stepsByDate.get(`${c.studentId}|${c.date}`) ?? []).join(' · ')}
                      </span>
                    ) : (
                      <span className="faint">{t('ยังไม่มีบันทึก')}</span>
                    )}
                  </div>
                  {c.note && (
                    <div style={{ marginTop: 5, font: '400 11px var(--font-body)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{t('โน้ต')}: {c.note}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        </div>}

        <Link
          to="/app/export"
          style={{ display: 'block', textAlign: 'center', padding: '8px 0', font: '600 13px var(--font-head)', color: 'var(--accent)' }}
        >
          {t('ส่งออกข้อมูลชิ้นงาน (PDF / CSV)')} ›
        </Link>
      </div>
    </Shell>
  );
}
