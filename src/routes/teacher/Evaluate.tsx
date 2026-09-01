import { ArrowClockwise, CalendarCheck, CheckCircle, PencilSimple, Signature, WarningCircle } from '@phosphor-icons/react';
import { PhotoSlot } from '../../components/ui/Bits';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { Radar } from '../../components/charts/Radar';
import type { ProfileAxis } from '../../domain/analytics';
import { evaluateCheckIn, reviseCheckIn } from '../../data/repo';
import { CRITERIA, MAX_TOTAL, SCORE_OPTIONS, totalScore } from '../../domain/checkin';
import { useAllCheckIns, useAllPatients, useAllStudents, useStepsOnDates, useTeacher } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';
import type { CheckIn } from '../../domain/types';
import { currentActor, useApp } from '../../store/app';
import { groupShort } from '../../domain/group';

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
  // ชั้นที่ 3 — ยืนยันโดยระบุชื่อ: ต่อให้หน้าจอขยับ ก่อนบันทึกจะมีกล่องบอกชื่อ นศ. เสมอ
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const signing = useRef(false);
  // แก้คะแนนที่ลงไปแล้ว — คาบที่กำลังแก้ และคะแนนชุดใหม่ที่กำลังกรอก
  const [reviseId, setReviseId] = useState<string | null>(null);
  const [reviseDraft, setReviseDraft] = useState<Record<string, number>>({});

  /**
   * ⚠️ ความปลอดภัย: กันอาจารย์ "ประเมินผิดคน"
   *
   * ชั้นที่ 1 — ลำดับคงที่: เรียงตามรหัสนักศึกษาเหมือนใบรายชื่อ (เดิมเรียงใหม่สุดขึ้นบน
   *   ทำให้การ์ดกระโดดเวลามีคนเช็คอินเข้ามาระหว่างอาจารย์กำลังกด)
   * ชั้นที่ 2 — ของใหม่ไม่แทรก: คนที่เช็คอินระหว่างนี้ไปรออยู่หลังแถบ "มีเช็คอินใหม่"
   *   อาจารย์กดเองเมื่อพร้อม รายการที่กำลังทำอยู่จึงไม่ขยับใต้นิ้ว
   */
  const pendingAll = useMemo(() => {
    const rows = inGroup.filter((c) => c.status === 'pending');
    return rows.sort((a, b) => {
      const ca = studentById.get(a.studentId)?.code ?? '';
      const cb = studentById.get(b.studentId)?.code ?? '';
      return ca.localeCompare(cb) || a.date.localeCompare(b.date);
    });
  }, [inGroup, studentById]);

  const pendingKey = pendingAll.map((c) => c.id).join(',');
  const [snapshot, setSnapshot] = useState<string[]>([]);
  // "กำลังทำงานอยู่" = แตะปุ่มคะแนนของใครไปแล้ว หรือเปิดกล่องยืนยันค้างไว้
  // ตอนนี้เท่านั้นที่ล็อกรายการ — ถ้ายังไม่ได้แตะอะไร ของใหม่ไหลเข้ามาได้ตามปกติ
  const busyScoring = Object.keys(drafts).length > 0 || confirmId !== null;
  /**
   * การล็อกรายการมีไว้กันการ์ดขยับใต้นิ้ว "ภายในกลุ่มเดียวกัน" เท่านั้น
   *
   * บั๊กที่เจอ: ถ้าแตะคะแนนค้างไว้แล้วสลับไปกลุ่มอื่น snapshot ของกลุ่มเดิมยังถูกใช้อยู่
   * ทุกคนในกลุ่มใหม่จึงถูกนับเป็น "ของใหม่" ไปกองหลังแถบสีฟ้า และหัวข้อขึ้นว่า
   * "รอประเมิน · 0 คน" ทั้งที่มีคนรอจริง — อาจารย์เวรที่สลับมาเซ็นให้กลุ่มอื่น
   * จะเข้าใจว่าไม่มีใครรอแล้วเดินจากไป
   * เปลี่ยนกลุ่ม = เริ่มงานชุดใหม่ ต้องล้างทั้ง snapshot และคะแนนที่ค้างของกลุ่มเดิม
   */
  const snapGroup = useRef(group);
  useEffect(() => {
    const switchedGroup = snapGroup.current !== group;
    if (switchedGroup) {
      snapGroup.current = group;
      setDrafts({});
      setConfirmId(null);
      setSnapshot(pendingAll.map((c) => c.id));
      return;
    }
    if (!busyScoring) setSnapshot(pendingAll.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyScoring, pendingKey, group]);

  const confirmRow = confirmId ? pendingAll.find((c) => c.id === confirmId) ?? null : null;
  const confirmStudent = confirmRow ? studentById.get(confirmRow.studentId) : undefined;
  const shown = new Set(snapshot);
  const pending = pendingAll.filter((c) => shown.has(c.id));
  const incoming = pendingAll.filter((c) => !shown.has(c.id));
  const showIncoming = () => setSnapshot(pendingAll.map((c) => c.id));
  const evaluatedAll = inGroup.filter((c) => c.status === 'evaluated');
  // ตารางประวัติยาวมาก — พับไว้ก่อน โชว์ 5 แถวล่าสุดพอ
  const [showAllEvaluated, setShowAllEvaluated] = useState(false);
  const evaluated = showAllEvaluated ? evaluatedAll.slice(0, 40) : evaluatedAll.slice(0, 5);

  const draftFor = (id: string) =>
    drafts[id] ?? Object.fromEntries(CRITERIA.map((c) => [c.key, 3]));

  async function sign(id: string) {
    if (signing.current) return;
    signing.current = true;
    try {
      const res = await evaluateCheckIn(id, draftFor(id), teacher?.name ?? currentActor());
      setConfirmId(null);
      if (res.ok) {
        // ปล่อย draft ของคาบที่เซ็นแล้ว — ถ้าไม่เหลือใครค้าง รายการจะกลับมาอัปเดตเองตามปกติ
        setDrafts((d) => {
          const next = { ...d };
          delete next[id];
          return next;
        });
        showToast({ message: t('บันทึกผลประเมินแล้ว (เทียบเท่าลงนามในสมุด)'), tone: 'success' });
      } else if (res.reason === 'already') {
        // ชั้นที่ 4 — อาจารย์อีกท่านลงคะแนนคาบนี้ไปแล้ว ระบบไม่เขียนทับให้
        showToast({ message: t('คาบนี้ {who} ประเมินไปแล้ว — ระบบไม่บันทึกทับ', { who: res.by || t('อาจารย์ท่านอื่น') }), tone: 'warning' });
      } else {
        showToast({ message: t('ไม่พบคาบนี้แล้ว (อาจถูกลบไป)'), tone: 'warning' });
      }
    } finally {
      signing.current = false;
    }
  }

  // ── แก้คะแนนที่ลงไปแล้ว ────────────────────────────────────────────────
  const reviseRow = reviseId ? evaluatedAll.find((c) => c.id === reviseId) ?? null : null;
  const reviseStudent = reviseRow ? studentById.get(reviseRow.studentId) : undefined;
  const reviseBefore = reviseRow?.scores ?? {};
  const reviseDiffs = CRITERIA.filter((cr) => (reviseBefore[cr.key] ?? 0) !== (reviseDraft[cr.key] ?? 0));

  function openRevise(c: CheckIn) {
    setReviseId(c.id);
    setReviseDraft(Object.fromEntries(CRITERIA.map((cr) => [cr.key, c.scores?.[cr.key] ?? 0])));
  }
  function closeRevise() {
    setReviseId(null);
    setReviseDraft({});
  }

  async function saveRevise() {
    if (!reviseRow || signing.current) return;
    signing.current = true;
    try {
      const res = await reviseCheckIn(reviseRow.id, reviseDraft, teacher?.name ?? currentActor());
      if (res.ok) {
        closeRevise();
        showToast({
          message: t('แก้คะแนนแล้ว {n} หัวข้อ — บันทึกไว้ในประวัติเรียบร้อย', { n: res.changed }),
          tone: 'success',
        });
      } else if (res.reason === 'nochange') {
        closeRevise();
      } else {
        showToast({ message: t('แก้ไม่สำเร็จ — คาบนี้อาจถูกลบหรือเปลี่ยนสถานะไปแล้ว'), tone: 'warning' });
      }
    } finally {
      signing.current = false;
    }
  }

  return (
    <TeacherShell active="evaluate">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('ประเมินรายคาบ')}</h1>
            <p>{t('กลุ่ม')} {groupShort(group)} · {t('คะแนน 3 / 1 / 0')}</p>
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

          {incoming.length > 0 && (
            <button
              onClick={showIncoming}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 12,
                background: 'var(--accent-tint)', border: '1px solid var(--accent-ring)', borderRadius: 12,
                padding: '10px 14px', cursor: 'pointer', font: '600 12px var(--font-body)', color: 'var(--accent-hover)',
              }}
            >
              <ArrowClockwise size={15} weight="bold" />
              {t('มีเช็คอินใหม่ {n} รายการ — แตะเพื่อแสดง', { n: incoming.length })}
              <span style={{ marginLeft: 'auto', font: '400 10.5px var(--font-body)', color: 'var(--text-muted)' }}>
                {t('รายการที่กำลังให้คะแนนจะไม่ขยับ')}
              </span>
            </button>
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
                      {/* นักศึกษาแก้บันทึกหลังเช็คอิน — โชว์ให้อาจารย์เห็นตรงๆ ว่ามีการแก้และเมื่อไหร่ (รายละเอียดเต็มอยู่ audit log) */}
                      {c.editedAt && (
                        <span className="badge" style={{ background: 'var(--fill)', color: 'var(--text-muted)' }}>
                          {t('นศ. แก้ไข')} {thaiShort(c.editedAt)}
                        </span>
                      )}
                    </div>
                    <div style={{ font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-body)', marginTop: 6 }}>
                      {c.activities.length ? c.activities.map((a) => t(a)).join(' · ') : <i style={{ color: 'var(--text-faint)' }}>{t('ยังไม่ระบุกิจกรรม')}</i>}
                      {patient && <span className="mono" style={{ color: 'var(--text-faint)' }}> · {t(patient.name)} (HN {patient.hn})</span>}
                    </div>
                    {c.note && (
                      <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 3, overflowWrap: 'anywhere' }}>{t('โน้ต')}: {c.note}</div>
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
                      <button className="btn" style={{ flex: 1, height: 40, fontSize: 13 }} onClick={() => setConfirmId(c.id)}>
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
          <h3>{t('ประเมินแล้วล่าสุด')} · {t('กลุ่ม')} {groupShort(group)}</h3>
          <p className="sub">{t('ให้คะแนนผิดแก้ได้ — กดปุ่มแก้ท้ายแถว · ทุกการแก้ถูกบันทึกในประวัติ ลบไม่ได้')}</p>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('นักศึกษา')}</th>
                <th style={{ width: 76 }}>{t('วันที่')}</th>
                <th>{t('กิจกรรม')}</th>
                <th style={{ width: 66 }}>{t('คะแนน')}</th>
                <th style={{ width: 88 }}>{t('ผู้ประเมิน')}</th>
                <th style={{ width: 46 }} />
              </tr>
            </thead>
            <tbody>
              {evaluated.length === 0 && (
                <tr><td colSpan={6} className="faint" style={{ padding: 16 }}>{t('ยังไม่มีคาบที่ประเมินแล้ว')}</td></tr>
              )}
              {evaluated.map((c) => (
                <tr key={c.id}>
                  <td style={{ font: '600 11.5px var(--font-body)' }}>{t(studentById.get(c.studentId)?.name ?? '')}</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>{thaiShort(c.date)}</td>
                  <td style={{ font: '400 11px var(--font-body)', color: 'var(--text-muted)' }}>{c.activities.length ? c.activities.map((a) => t(a)).join(' · ') : t('ยังไม่ระบุกิจกรรม')}</td>
                  <td>
                    <span className="chip" style={{ background: 'var(--success-tint)', color: 'var(--success-dark)' }}>
                      <CheckCircle size={11} weight="fill" /> {totalScore(c.scores)}/{MAX_TOTAL}
                    </span>
                  </td>
                  <td style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>{t(c.evaluatedBy ?? '')}</td>
                  <td>
                    <button className="revisebtn" title={t('แก้คะแนนคาบนี้')} onClick={() => openRevise(c)}>
                      <PencilSimple size={14} />
                      {t('แก้')}
                    </button>
                  </td>
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
                  referenceLabel={`${t('เฉลี่ยกลุ่ม')} ${groupShort(group)}`}
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
        {/* กล่องยืนยันก่อนลงนาม — ชั้นสุดท้ายกันประเมินผิดคน โชว์ชื่อ+รหัส+วันที่+คะแนนตัวใหญ่ */}
        {confirmRow && (
          <div className="confirmwrap" onClick={() => setConfirmId(null)}>
            <div className="confirmbox" onClick={(e) => e.stopPropagation()}>
              <div className="confirmbox__q">{t('ยืนยันบันทึกคะแนนของ')}</div>
              <div className="confirmbox__who">{t(confirmStudent?.name ?? '')}</div>
              <div className="confirmbox__meta">
                <span className="mono">{confirmStudent?.code}</span> · {t('คาบ')} {thaiShort(confirmRow.date)}
                {confirmRow.checkinAt ? ` · ${t('{time} น.', { time: confirmRow.checkinAt })}` : ''}
              </div>
              <div className="confirmbox__score">
                {totalScore(draftFor(confirmRow.id)) ?? 0}<span>/{MAX_TOTAL}</span>
              </div>
              <p className="confirmbox__note">
                <WarningCircle size={14} weight="fill" style={{ verticalAlign: -2, marginRight: 4 }} />
                {t('ตรวจชื่อให้ตรงกับนักศึกษาที่อยู่ตรงหน้าก่อนกดยืนยัน')}
              </p>
              <div className="confirmbox__actions">
                <button className="btn btn--sec" onClick={() => setConfirmId(null)}>{t('ยกเลิก')}</button>
                <button className="btn" onClick={() => sign(confirmRow.id)}>
                  <Signature size={17} weight="bold" />
                  {t('ยืนยัน · ลงนาม')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* กล่องแก้คะแนนที่ลงไปแล้ว — โชว์ค่าเดิมคู่ค่าใหม่ทุกหัวข้อ ไม่ให้แก้แบบไม่รู้ตัว */}
        {reviseRow && (
          <div className="confirmwrap" onClick={closeRevise}>
            <div className="confirmbox confirmbox--wide" onClick={(e) => e.stopPropagation()}>
              <div className="confirmbox__q">{t('แก้คะแนนของ')}</div>
              <div className="confirmbox__who">{t(reviseStudent?.name ?? '')}</div>
              <div className="confirmbox__meta">
                <span className="mono">{reviseStudent?.code}</span> · {t('คาบ')} {thaiShort(reviseRow.date)}
                {reviseRow.evaluatedBy ? ` · ${t('ประเมินโดย {who}', { who: t(reviseRow.evaluatedBy) })}` : ''}
              </div>

              <div className="revisegrid">
                {CRITERIA.map((cr) => {
                  const was = reviseBefore[cr.key] ?? 0;
                  const now = reviseDraft[cr.key] ?? 0;
                  return (
                    <div key={cr.key} className="scorerow" data-changed={was !== now}>
                      <span className="scorerow__label" title={t(cr.th)}>{cr.label}</span>
                      {was !== now && <span className="revisewas">{t('เดิม')} {was}</span>}
                      <span className="scorerow__btns">
                        {SCORE_OPTIONS.map((n) => (
                          <button
                            key={n}
                            data-on={now === n}
                            onClick={() => setReviseDraft({ ...reviseDraft, [cr.key]: n })}
                          >
                            {n}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="revisesum">
                {reviseDiffs.length === 0 ? (
                  <span className="faint">{t('ยังไม่ได้แก้อะไร')}</span>
                ) : (
                  <>
                    <b>{t('แก้ {n} หัวข้อ', { n: reviseDiffs.length })}</b>
                    <span className="mono">
                      {totalScore(reviseBefore) ?? 0} → {totalScore(reviseDraft) ?? 0}/{MAX_TOTAL}
                    </span>
                  </>
                )}
              </div>

              <p className="confirmbox__note">
                <WarningCircle size={14} weight="fill" style={{ verticalAlign: -2, marginRight: 4 }} />
                {t('การแก้จะถูกบันทึกในประวัติพร้อมค่าเดิม ลบทิ้งไม่ได้ และชื่อผู้ประเมินจะเปลี่ยนเป็นคุณ')}
              </p>

              <div className="confirmbox__actions">
                <button className="btn btn--sec" onClick={closeRevise}>{t('ยกเลิก')}</button>
                <button className="btn" disabled={reviseDiffs.length === 0} onClick={saveRevise}>
                  <PencilSimple size={17} weight="bold" />
                  {t('ยืนยันการแก้')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </TeacherShell>
  );
}
