import { Bell, CaretRight, Check, CheckCircle, CheckSquare, HandTap, MagnifyingGlass, Medal, Square } from '@phosphor-icons/react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PendingBadge, SelfBadge, StaleBadge } from '../../components/ui/Bits';
import { ConfirmSheet } from '../../components/student/ConfirmSheet';
import { addCheckIn } from '../../data/repo';
import { Shell } from '../../components/student/Shell';
import { useCheckIns, usePatientNamesOn, usePending, useSect2, useSect3, useSelfAssessment, useStepsOnDates, useStudent, useWorkpieces } from '../../hooks/data';
import { daysUntil, relative, toISODate, weekMonday } from '../../lib/date';
import { firstNameOnly } from '../../domain/group';
import { personName, t, tSexAge } from '../../lib/i18n';
import { patientTitle, patientWithHn } from '../../lib/privacy';
import { typeMeta } from '../../domain/catalog';
import { cheerLine, dailyQuote } from '../../domain/cheer';
import { caseCountTotals, currentProc, daysSinceUpdate, isStale, maxProgression, nextProc, procAt, procLabel, progression, isActiveWork } from '../../domain/rules';
import { currentActor, useApp } from '../../store/app';
import { tapFeedback } from '../../lib/haptic';
import { ACTIVITY_GROUPS, NO_PATIENT_ACTIVITY } from '../../domain/checkin';
import { FIRSTS } from './Achievements';
import { groupShort } from '../../domain/group';
import { saYearNow } from '../../domain/saFeedback';
import { saOpenFor, saProgress, type SAValue } from '../../domain/selfAssessment';
import { studentYear } from '../../domain/cohort';

// การ์ดความสำเร็จท้ายหน้าแรก — ซ่อนรอเสนอภาคก่อน (ผู้ใช้ขอ 1 ก.ย.)
const SHOW_ACHIEVEMENT_CARD = false;

/** วงแหวนความคืบหน้ารวมของเคส — ผู้ใช้ขอคืนมาคู่กับเส้นทางด่าน (1 ก.ย.) เลยย่อไซซ์ลงไปอยู่มุมหัวการ์ด */
function Ring({ value, max }: { value: number; max: number }) {
  const R = 22;
  const C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, value / max));
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" style={{ flex: 'none' }} aria-hidden>
      <circle cx="28" cy="28" r={R} fill="none" stroke="var(--accent-ring)" strokeWidth="6" />
      <circle
        cx="28" cy="28" r={R} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${C * f} ${C}`} transform="rotate(-90 28 28)"
      />
      <text x="28" y="27" textAnchor="middle" style={{ font: '700 15px var(--font-head)', fill: 'var(--text)' }}>{value}</text>
      <text x="28" y="38.5" textAnchor="middle" style={{ font: '400 9px var(--font-mono)', fill: 'var(--text-faint)' }}>/ {max}</text>
    </svg>
  );
}

function HeroCard({
  w, pending, stale, onPass,
}: {
  w: ReturnType<typeof useWorkpieces>[number];
  pending: boolean;
  stale: boolean;
  onPass: () => void;
}) {
  const namesOn = usePatientNamesOn();
  const cur = currentProc(w);
  const next = nextProc(w);
  const prog = Math.max(progression(w), 0);
  const max = maxProgression(w);
  // เส้นทางด่านหน้าต่างแคบ "หน้า 1 หลัง 1" (ผู้ใช้ขอ 1 ก.ย. รอบสอง — ทั้งกลุ่ม active ยังแน่นไป):
  // ขั้นล่าสุดที่เสร็จ = cur อยู่แล้ว · ขั้นถัดจากปัจจุบันดึงตรงๆ ข้ามขอบกลุ่มได้เลย
  const upcoming = next ? procAt(w, w.procIndex + 2) : undefined;
  return (
    <article className={`herocase t-${w.type}`}>
      {/* บรรทัดเทาบรรทัดเดียวแทนชิป (ผู้ใช้เลือก 14 ก.ย.) · HN กึ่งหนาตัวอ้วน อ่านเจอเร็วแต่ไม่แย่งชื่อผู้ป่วย */}
      <div className="herocase__top">
        <span className="dot" style={{ background: typeMeta(w.type).color }} />
        <span className="herocase__line">
          {typeMeta(w.type).short}{w.arch ? ` · ${w.arch === 'upper' ? 'Upper' : 'Lower'}` : ''} · {namesOn
            ? <b className="herocase__hn">HN {w.patient.hn}</b>
            /* ไม่ใช้ชื่อ (นำร่อง) = HN ขึ้นเป็นหัวเรื่องแล้ว บรรทัดนี้บอกเพศ/อายุแทน ช่วยแยกคนไข้ */
            : tSexAge(w.patient.sexAge)}
        </span>
        <span className="herocase__meta">{relative(w.lastUpdatedAt)}</span>
      </div>
      {(pending || stale) && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {pending && <PendingBadge />}
          {stale && <StaleBadge days={daysSinceUpdate(w)} />}
        </div>
      )}

      {/* โซนหัว "เคสไหน": ชื่อคนไข้เป็นหัวเรื่อง + บรรทัดรอง ชิดซ้าย · วงแหวนรวมทั้งเคสชิดขวา
          เดิมซ้ายมีบรรทัด mono จางบรรทัดเดียว สูงไม่ถึงครึ่งวงแหวน เลยเหลือช่องโหวงข้างวงแหวน (ผู้ใช้ทัก 2 ก.ย.)
          บรรทัดรองทำสองหน้าที่: บอก HN และกำกับว่าเลขในวงแหวนคือ "ขั้นที่ n จาก m" ไม่ใช่คะแนน
          (จึงไม่ต้องมีป้าย steps ใต้วงแหวนอีก) */}
      <div className="herocase__lead">
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ป้ายประเภทงาน (CD/APD) กับ Upper/Lower อยู่บนชิปด้านบนแล้ว ไม่ต้องซ้ำในบรรทัดนี้ */}
          <Link to={`/app/work/${w.id}`} className="herocase__name">{patientTitle(w.patient, namesOn, t)}</Link>
        </div>
        {next && <Ring value={prog} max={max} />}
      </div>

      {next ? (
        <>
          {/* เส้นคั่นแบ่งโซน "เคสไหน" ออกจากโซน "ต้องทำอะไรต่อ" — ไม่งั้นทุกแถวลอยกองรวมกัน */}
          {/* เส้นทางวิ่งต่อเนื่องไม่มีปุ่มคั่น — ปุ่มเดียวรออยู่ท้ายการ์ด (ผู้ใช้ทักว่าปุ่มกลางทางรก, 1 ก.ย.) */}
          <div className="heropath">
            {cur && (
              <div className="heropath__row">
                <span className="heropath__node heropath__node--done"><Check size={12} weight="bold" /></span>
                <span className="heropath__name heropath__name--done">{cur.name}</span>
              </div>
            )}
            <div className="heropath__row heropath__row--now">
              <span className="heropath__node heropath__node--now">{next.progression}</span>
              {/* กดชื่อขั้นเพื่อเปิดหน้าขั้นตอนเต็ม (แทนลิงก์ฟ้าเล็กเดิม — ธรรมเนียมตั้งแต่ 31 ส.ค.) */}
              <Link to={`/app/work/${w.id}`} className="heropath__name heropath__name--now">
                {next.name}
              </Link>
            </div>
            {upcoming && (
              <div className="heropath__row">
                <span className="heropath__node heropath__node--todo"></span>
                <span className="heropath__name">{upcoming.name}</span>
                {upcoming.selfPerformed && <SelfBadge compact />}
              </div>
            )}
          </div>
          <button className="herocase__btn" onClick={onPass}>
            <CheckCircle size={19} weight="fill" />
            {t('ทำขั้นนี้เสร็จแล้ว')}
          </button>
        </>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="herocase__caption">{t('สถานะ')}</div>
          <div className="herocase__step">{cur ? procLabel(w.type, cur) : t('ยังไม่เริ่ม')}</div>
        </div>
      )}
      {next?.selfPerformed && (
        <div className="selfrow">
          <HandTap size={15} weight="fill" />
          {t('step นี้ต้องทำเอง (self-performed)')}
        </div>
      )}
    </article>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return t('สวัสดีตอนเช้า');
  if (h < 17) return t('สวัสดีตอนบ่าย');
  return t('สวัสดีตอนเย็น');
}

export default function Home() {
  const { session, settings, openSheet, showToast, touch } = useApp();
  const namesOn = usePatientNamesOn();
  const student = useStudent(session?.studentId);
  const works = useWorkpieces(session?.studentId);
  const pending = usePending();
  const navigate = useNavigate();
  /* แบบประเมินตนเองของปีการศึกษานี้ — การ์ดบนหน้าแรกทำหน้าที่แจ้งเตือนไปในตัว
     3 สถานะ: เปิดแล้วยังไม่เริ่ม (จุดแดง) · กรอกค้าง (บอกความคืบหน้า) · ส่งแล้ว (เงียบ) */
  const selfAssessment = useSelfAssessment(session?.studentId, saYearNow());
  /* จำนวนใบที่ "ประเมินเสร็จแล้ว" บนการ์ดสมุดของฉัน — นับใบเดียวกับที่หน้าสมุดโชว์
     ใบร่างที่อาจารย์กรอกค้างไม่นับ ไม่งั้นเลขบนการ์ดกับในเล่มจะไม่ตรงกัน */
  const pf2 = useSect2(session?.studentId, saYearNow());
  const pf3 = useSect3(session?.studentId, saYearNow());
  const portfolioDone = useMemo(() => {
    const keys = new Set<string>();
    for (const r of pf2) if (r.formKey === 'rpdDesign' ? r.passed != null : r.total != null) keys.add(`2:${r.formKey}`);
    for (const r of pf3) if (r.total != null) keys.add(`3:${r.formKey}`);
    return keys.size;
  }, [pf2, pf3]);
  const saDone = selfAssessment?.status === 'submitted';
  /* ภาคเปิดทีละชั้นปีได้ — ปี 6 ต้องไม่เห็นการ์ดนี้ถ้าภาคเปิดแค่ปี 5 */
  const saOpen = saOpenFor(settings, student ? studentYear(student) : null);
  const saNew = saOpen && !selfAssessment;
  const saDueLeft = settings.saDue ? daysUntil(settings.saDue) : null;
  const saDueSoon = !saDone && saDueLeft !== null && saDueLeft <= settings.remindDays;
  const saProg = selfAssessment && !saDone && student
    ? saProgress(selfAssessment.answers as Record<string, SAValue>, studentYear(student))
    : null;
  const saNote = saDone
    ? t('ส่งแล้ว — อาจารย์อ่านก่อนนัดคุย')
    : saDueSoon
      ? (saDueLeft! < 0
          ? t('เลยกำหนดส่งมาแล้ว {n} วัน', { n: -saDueLeft! })
          : t('เหลืออีก {n} วันถึงกำหนดส่ง', { n: saDueLeft! }))
      : saProg
        ? t('กรอกค้างไว้ · ตอบแล้ว {a}/{b} ข้อ', { a: saProg.done, b: saProg.total })
        : t('ภาคเปิดให้ทำแล้ว · แตะเพื่อเริ่ม');

  const active = works.filter(isActiveWork);
  const recent = [...active].sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  // การ์ดเต็มเฉพาะเคสที่แตะล่าสุด — ที่เหลือเป็นแถวย่อ กดชื่อเข้าไปดูเต็ม กดปุ่มขวาเพื่อผ่าน step ได้เลย
  const hero = recent[0];
  const rest = recent.slice(1, 5);
  const totals = caseCountTotals(works, settings);
  const checkins = useCheckIns(session?.studentId);
  const today = toISODate(new Date());
  const todayCheckIn = checkins.find((c) => c.date === today);
  const checkedInToday = !!todayCheckIn;
  const todaySteps = useStepsOnDates(session ? [{ studentId: session.studentId, date: today }] : []);
  const todayStepCount = (todaySteps.get(`${session?.studentId}|${today}`) ?? []).length;

  // เตือนเติมกิจกรรมแบบสุภาพ: เปิดแอปช่วงบ่ายแล้วคาบวันนี้ยังว่างอยู่ → toast ครั้งเดียวต่อวัน
  // (ผู้ใช้ขอให้มีตัวตาม แต่ต้องไม่จิกจนรำคาญ — โนติเด้งนอกแอปรอ backend phase 2)
  const todayNeedsDetail = !!todayCheckIn && todayCheckIn.activities.length === 0;
  useEffect(() => {
    if (!todayNeedsDetail || new Date().getHours() < 12) return;
    try {
      if (localStorage.getItem('pt-fill-nudge') === today) return;
      localStorage.setItem('pt-fill-nudge', today);
    } catch { /* private mode — เตือนซ้ำได้ ไม่เป็นไร */ }
    showToast({ message: t('คาบวันนี้ยังไม่ได้เติมกิจกรรม — ว่างแล้วแวะเติมนิดนึงนะครับ'), tone: 'default' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayNeedsDetail]);

  const checkingIn = useRef(false);

  /**
   * แผ่นถามเช็คอินตอนเปิดแอป (ผู้ใช้ขอ 31 ส.ค.)
   * เหตุผล: ทำงานอย่างอื่นเพลินแล้วลืมว่ายังไม่ได้เช็คอิน — เด้งถามก่อนเลย
   * กติกา: ถามเฉพาะยังไม่เช็คอินวันนี้ · กด "ไว้ก่อน" แล้ววันนั้นไม่กวนซ้ำ
   * (จำการข้ามไว้ในเครื่อง — พรุ่งนี้ค่อยถามใหม่)
   */
  const [askCheckIn, setAskCheckIn] = useState(false);
  // ฟอร์มในแผ่นถาม — เลือกกิจกรรม/คนไข้ได้เลยตั้งแต่ตอนเด้ง (ผู้ใช้ขอ)
  const [askActs, setAskActs] = useState<string[]>([]);
  const [askPatient, setAskPatient] = useState('');
  const askNoPatient = askActs.includes(NO_PATIENT_ACTIVITY);
  const askPatients = useMemo(() => {
    const seen = new Map<string, string>();
    works.forEach((w) => seen.set(w.patient.id, patientWithHn(w.patient, namesOn, t)));
    return [...seen.entries()];
  }, [works]);

  async function submitAskCheckIn() {
    if (!session || checkingIn.current) return;
    checkingIn.current = true;
    tapFeedback();
    try {
      const now = new Date();
      const checkinAt = now.toTimeString().slice(0, 5);
      const punctual = now.getHours() < 12 ? checkinAt <= '09:15' : checkinAt <= '13:15';
      await addCheckIn({
        studentId: session.studentId, date: today, punctual, checkinAt,
        noPatient: askNoPatient,
        patientId: askNoPatient ? undefined : (askPatient || undefined),
        activities: askActs, note: '', actor: currentActor(),
      });
      setAskCheckIn(false);
      touch();
      showToast({ message: t('เช็คอินแล้ว {time} น. — โชคดีกับคาบนี้ครับ', { time: checkinAt }), tone: 'success' });
    } finally {
      checkingIn.current = false;
    }
  }
  useEffect(() => {
    if (!session || checkedInToday) return;
    let skipped = '';
    try { skipped = localStorage.getItem('pt-checkin-ask') ?? ''; } catch { /* private mode */ }
    if (skipped !== today) setAskCheckIn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedInToday, today]);

  function skipCheckInAsk() {
    try { localStorage.setItem('pt-checkin-ask', today); } catch { /* private mode */ }
    setAskCheckIn(false);
  }

  // เช็คอินด่วน: แตะการ์ดครั้งเดียวจบ ประทับเวลาทันที — กิจกรรมมาเติมทีหลังได้
  // (ผู้ใช้ขอ: 9 โมงต้องรีบทำงาน ไม่มีเวลาวุ่นวายกับมือถือ · กดล่วงหน้าก่อนเริ่มคาบได้)
  async function quickCheckIn() {
    // ref กันแตะรัว — checkedInToday มาจาก liveQuery กว่าจะอัปเดตทันก็แตะไปหลายทีแล้ว
    // (ชั้นข้อมูลใน addCheckIn กันไว้อีกชั้น อันนี้ไว้ให้ปุ่มไม่ยิงซ้ำเปล่าๆ)
    if (!session || checkedInToday || checkingIn.current) return;
    checkingIn.current = true;
    tapFeedback();
    try {
      const now = new Date();
      const checkinAt = now.toTimeString().slice(0, 5);
      const punctual = now.getHours() < 12 ? checkinAt <= '09:15' : checkinAt <= '13:15';
      await addCheckIn({
        studentId: session.studentId, date: today, punctual, checkinAt,
        noPatient: false, activities: [], note: '', actor: currentActor(),
      });
      touch();
      showToast({ message: t('เช็คอินแล้ว {time} น. — กิจกรรมมาเติมทีหลังได้เลย', { time: checkinAt }), tone: 'success' });
    } finally {
      checkingIn.current = false;
    }
  }

  return (
    <Shell overlay={<>
      {askCheckIn && !checkedInToday && (
        <div className="backdrop" onClick={skipCheckInAsk}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '82%', overflowY: 'auto' }}>
            <h3 style={{ margin: 0, font: '700 17px var(--font-head)' }}>{t('เช็คอินคาบวันนี้')}</h3>
            {/* คำอธิบายวิธีใช้ตัดออก — ปุ่ม "ไว้ก่อน" ข้างล่างบอกอยู่แล้วว่าไม่กรอกก็ได้ (16 ก.ย. 69) */}

            <div style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 7 }}>{t('กิจกรรมในคาบ')}</div>
            {ACTIVITY_GROUPS.map((g) => (
                <div key={g.label} className="actgroup">
                  <div className="actgroup__label">{t(g.label)}</div>
                  <div className="actgrid">
                    {g.items.map((a) => (
                      <button key={a} data-on={askActs.includes(a)} onClick={() => setAskActs(askActs.includes(a) ? askActs.filter((x) => x !== a) : [...askActs, a])}>
                        {t(a)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

            {!askNoPatient && (
              <>
                {/* ป้ายเป็น div ที่ไม่ได้ผูกกับ select — โปรแกรมอ่านหน้าจอจะอ่านแค่ "กล่องรายการ"
                    ไม่บอกว่ากล่องนี้คือช่องอะไร (WCAG 1.3.1 · 3.3.2) */}
                <div style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 7 }}>{t('ผู้ป่วยที่นัด')}</div>
                <select className="input" aria-label={t('ผู้ป่วยที่นัด')} value={askPatient} onChange={(e) => setAskPatient(e.target.value)} style={{ marginBottom: 14 }}>
                  <option value="">{t('— ไม่ระบุ —')}</option>
                  {askPatients.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </>
            )}

            <button className="btn" style={{ height: 50 }} onClick={submitAskCheckIn}>
              <CheckCircle size={18} weight="fill" />
              {t('เช็คอินเลย')}
            </button>
            <button className="btn btn--sec" style={{ height: 44, marginTop: 8 }} onClick={skipCheckInAsk}>
              {t('ไว้ก่อน — วันนี้ไม่ต้องถามอีก')}
            </button>
          </div>
        </div>
      )}
      <ConfirmSheet />
    </>}>
      <header className="s-header">
        <div className="s-header--row">
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* หน้าแรกแบบ "ตัดของซ้ำ" (ผู้ใช้เลือก mock A+B 14 ก.ย.): ชิปกลุ่ม + ป้าย BETA ข้างชื่อ → กลุ่มอยู่ในบรรทัดทักทาย */}
          <div style={{ font: '400 12px var(--font-body)', color: 'var(--text-faint)' }}>
            {greeting()}{student?.group ? ` · ${groupShort(student.group)}` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {/* ชื่อจริงเต็มยาวจนขึ้นสองบรรทัด — หน้านี้เอาแค่ "นศ. <ชื่อต้น>" (ผู้ใช้ขอ 2 ก.ย.)
                ชื่อเต็มยังอยู่ครบทุกที่ฝั่งอาจารย์และหน้าอื่น */}
            {/* หัวเรื่องของหน้าแรก = ชื่อเจ้าของหน้า · ต้องเป็น h1 หนึ่งตัวต่อหน้า (WCAG 1.3.1) */}
            <h1 style={{ margin: 0, font: '700 19px var(--font-head)' }}>
              {t('นศ.')} {firstNameOnly(personName(student, 'นศ. Liv'))}
            </h1>
          </div>
        </div>
        <Link to="/app/search" className="iconbtn iconbtn--plain" aria-label={t('ค้นหา')}>
          <MagnifyingGlass size={18} />
        </Link>
        <Link to="/app/sync" className="iconbtn" aria-label={t('แจ้งเตือน')}>
          <Bell size={18} weight="fill" />
        </Link>
        </div>
      </header>


      {/* ทุกกล่องอยู่ในกองเดียว ระยะเท่ากันหมด — ต่อเนื่องแบบ mock ที่ผู้ใช้เลือก */}
      {/* homegrid/homecol: มือถือซ้อนเป็นกองเดียวเหมือนเดิม · iPad แนวนอนแยกซ้าย "งานถัดไป" ขวา "สะสม + ของฉัน"
          (ผู้ใช้เลือก mock B 15 ก.ย. 69 · กฎอยู่ใน student-tablet.css) */}
      <div className="homegrid" style={{ padding: '6px 16px 0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
      <div className="homecol">
      {(() => {
        const inner = (
          <>
            {checkedInToday ? (
              <CheckSquare size={26} weight="fill" color="var(--success)" style={{ flex: 'none' }} />
            ) : (
              <Square size={24} weight="bold" color="var(--accent)" style={{ flex: 'none' }} />
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: '600 14px/1.4 var(--font-head)' }}>
                {checkedInToday ? t('เช็คอินคาบวันนี้') : t('ยังไม่เช็คอินคาบวันนี้')}
              </span>
              {checkedInToday && (
                <span style={{ display: 'block', font: '400 11.5px/1.5 var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {(todayCheckIn?.activities.length ?? 0) > 0
                    ? `${t(todayCheckIn?.activities[0] ?? '')}${todayStepCount > 0 ? ` · ${t('เสร็จแล้ว {n} ขั้น', { n: todayStepCount })}` : ''} · ${todayCheckIn?.status === 'evaluated' ? t('ประเมินแล้ว') : t('รอประเมิน')}`
                    : t('เช็คอินแล้ว {time} น. · แตะเพื่อเติมกิจกรรมตอนว่าง', { time: todayCheckIn?.checkinAt ?? '' })}
                </span>
              )}
              {/* บรรทัดให้กำลังใจรายวัน — โผล่หลังเช็คอินแล้วเท่านั้น (อวยพรก่อนเช็คอินมันแปลก ผู้ใช้ทัก 555) */}
              {checkedInToday && (
                <span style={{ display: 'block', font: '500 10.5px/1.5 var(--font-body)', color: 'var(--accent-hover)', marginTop: 3 }}>
                  {cheerLine(works, checkins, settings, undefined, namesOn)}
                </span>
              )}
            </span>
            {checkedInToday
              ? <CaretRight size={15} color="var(--text-disabled)" style={{ flex: 'none' }} />
              : <span className="homecheckin__go">{t('เช็คอิน')}</span>}
          </>
        );
        const cardStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px 11px 14px', borderRadius: 16, width: '100%', textAlign: 'left' };
        // ยังไม่เช็คอิน = แตะเดียวเช็คอินทันที · เช็คอินแล้ว = พาไปหน้าคาบ (เติมกิจกรรม/ดูประวัติ)
        return checkedInToday ? (
          <Link to="/app/checkin" className="card" style={cardStyle}>{inner}</Link>
        ) : (
          <button className="card" style={cardStyle} onClick={quickCheckIn}>{inner}</button>
        );
      })()}

      {hero && <div className="homelabel">{t('งานถัดไป')}</div>}
      {hero && <HeroCard w={hero} pending={pending.has(hero.id)} stale={isStale(hero, settings)} onPass={() => openSheet(hero.id)} />}

      {rest.map((w) => {
        const next = nextProc(w);
        const meta = typeMeta(w.type);
        return (
          // ปุ่มผ่าน step อยู่ในการ์ดแล้ว — เดิมลอยนอกการ์ด ขอบขวาของการ์ดนี้เลยสั้นกว่าใบอื่น ดูเบี้ยว (14 ก.ย.)
          <div key={w.id} className="minirow">
            <Link to={`/app/work/${w.id}`} className="minirow__body">
              <span className="minirow__top">
                <span className="dot" style={{ background: meta.color }} />
                <span className="minirow__name">
                  {patientTitle(w.patient, namesOn, t)}
                  {w.tooth ? ` · ${t('ซี่')} ${w.tooth}` : w.arch ? ` · ${w.arch === 'upper' ? 'Upper' : 'Lower'}` : ''}
                  {' · '}<span className="mono">{Math.max(progression(w), 0)}/{maxProgression(w)}</span>
                </span>
                {isStale(w, settings) && <StaleBadge days={daysSinceUpdate(w)} />}
                {pending.has(w.id) && <PendingBadge />}
              </span>
              {/* ชื่อขั้นถัดไป — เดิมแถวย่อบอกแค่ตัวเลข ต้องกดเข้าไปถึงจะรู้ว่าต้องทำอะไร
                  ผู้ใช้ขอให้เคสอื่นเด่นขึ้น (1 ก.ย.) — งานวันนี้ของทุกเคสควรอ่านได้จากหน้าแรก */}
              {next && <span className="minirow__step">{next.name}</span>}
            </Link>
            {/* วงกลมลอยกลางแถว — เดิมเป็นแท่งสูงเต็มแถวมีเช็ค+เลขซ้อนกัน ดูแปลก (ผู้ใช้ทัก 1 ก.ย.)
                เลข step ตัดออกเพราะซ้ำกับ 9/10 ที่อยู่ข้างๆ อยู่แล้ว — เหลือเครื่องหมายถูกอย่างเดียว */}
            {next && (
              <button className="minirow__pass" onClick={() => openSheet(w.id)} aria-label={t('บันทึกทำ step {n} เสร็จ', { n: next.progression })}>
                <Check size={19} weight="bold" />
              </button>
            )}
          </div>
        );
      })}
      </div>

      <div className="homecol">
      <div className="homelabel">{t('สะสมมาแล้ว')}</div>
      <div style={{ display: 'flex', gap: 11 }}>
        <button className="card" style={statBox} onClick={() => navigate('/app/patients')}>
          <span style={statNum}>{active.length}</span>
          <span style={statLabel}>{t('ชิ้นงานที่กำลังทำ')}</span>
        </button>
        <button className="card" style={statBox} onClick={() => navigate('/app/criteria')}>
          <span style={{ ...statNum, color: totals.allComplete ? 'var(--success)' : 'var(--accent)' }}>
            {totals.done}/{totals.required}
          </span>
          <span style={statLabel}>{t('เกณฑ์สะสม 2 ปี')}</span>
        </button>
      </div>

      {/* แถบกำลังใจแบบสะสม — ผู้ใช้ 1 ก.ย.: streak รายสัปดาห์ไม่เข้ากับตารางคลินิก (บางสัปดาห์ไม่มีคาบ)
          เลยนับแบบสะสมอย่างเดียว มีแต่เพิ่ม ไม่มีรีเซ็ต ไม่มีคำว่า "ขาด" · ผู้ใช้ยืนยันเก็บไว้ 14 ก.ย. */}
      <div className="card growcard">
        <span className="growcard__head">🔥 {t('เก็บสะสมมาเรื่อยๆ')}</span>
        <div className="growcard__row">
          <span className="growcard__stat">
            <b>{checkins.length}</b>{t('ครั้งที่มาคลินิก')}
          </span>
          <span className="growcard__stat">
            <b>{new Set(checkins.map((c) => weekMonday(c.date))).size}</b>{t('สัปดาห์ที่ได้ลงมือ')}
          </span>
          <span className="growcard__stat">
            <b>{works.reduce((a, w) => a + Math.max(0, w.procIndex + 1), 0)}</b>{t('ขั้นที่ผ่านมือคุณ')}
          </span>
        </div>
        <span className="growcard__sub growcard__sub--quote">“{dailyQuote()}”</span>
      </div>

      {/* แบบประเมินตนเอง — ปีละครั้งตอนจบเทอม 1 ซ่อนไว้ตลอดปีจนกว่าภาคจะเปิด
          (การ์ดถาวรที่กดไม่ได้ = ขยะบนหน้าแรก)

          การ์ดนี้ทำหน้าที่ "แจ้งเตือน" ด้วย — ผู้ใช้ขอ 5 ก.ย. 69 ให้ผูกการเปิดฟอร์มกับ noti
          วินาทีที่อาจารย์กดสวิตช์เปิด นักศึกษาที่ยังไม่เริ่มจะเห็นจุดแดงบนหน้าแรกทันที
          (ทำงานออฟไลน์ ไม่ต้องขอสิทธิ์ ไม่ต้องมีเซิร์ฟเวอร์ — push จริงยังไม่มีในระบบ) */}
      {/* ประเมินตนเอง + สมุดของฉัน อยู่ในการ์ดใบเดียวคั่นเส้น — เดิมแยกสองใบขอบหนา ดูเป็นกองกล่อง (ผู้ใช้บอกรก 14 ก.ย.) */}
      <div className="homelabel">{t('ของฉัน')}</div>
      <div className="card linkgroup">
      {(saOpen || saDone) && (
        <Link
          to="/app/self-assessment"
          className={`linkgroup__row${saNew ? ' linkgroup__row--new' : ''}`}
        >
          {/* แถวเดียวไม่มีไอคอน · สถานะสั้นชิดขวา (ผู้ใช้เลือก 14 ก.ย.) — ใกล้กำหนดยังเป็นสีเตือนเหมือนเดิม */}
          <span className="linkgroup__title">
            {t('ประเมินตนเอง')}
            {saNew && <span className="linkgroup__new" aria-label={t('ใหม่')} />}
          </span>
          <span className="linkgroup__note" style={saDueSoon ? { color: 'var(--warning-dark)' } : undefined}>
            {saDone ? t('ส่งแล้ว') : saDueSoon || !saProg ? saNote : `${saProg.done}/${saProg.total}`}
          </span>
          <CaretRight size={14} color="var(--text-disabled)" style={{ flex: 'none' }} />
        </Link>
      )}

      {/* สมุดของฉัน — portfolio ทั้งเล่มที่อาจารย์ประเมินไว้ (Section I/II/III)
          อยู่ต่อจากแบบประเมินตนเองเพราะเป็นเรื่องเดียวกัน: ของที่ "คนอื่นกรอกให้เรา"
          การ์ดถาวร ไม่ซ่อนตอนยังไม่มีใบไหนถูกประเมิน — สมุดเปล่าก็ยังเป็นสมุดของเขา
          และเป็นที่เดียวที่บอกได้ว่าเล่มนี้มีอะไรรออยู่บ้าง */}
      <Link to="/app/portfolio" className="linkgroup__row">
        <span className="linkgroup__title">{t('สมุดของฉัน')}</span>
        <span className="linkgroup__note">{t('ประเมินแล้ว {n} ใบ', { n: portfolioDone })}</span>
        <CaretRight size={14} color="var(--text-disabled)" style={{ flex: 'none' }} />
      </Link>
      </div>

      {/* การ์ดความสำเร็จ — พับไว้ก่อน (ผู้ใช้ 1 ก.ย.: ขอเอาไปเสนอภาคก่อนค่อยเปิด)
          เปิดกลับ: เปลี่ยน SHOW_ACHIEVEMENT_CARD เป็น true */}
      {SHOW_ACHIEVEMENT_CARD && (
      <Link to="/app/achievements" className="card achhome">
        <span className="achhome__head">
          <Medal size={16} weight="fill" color="var(--accent)" />
          <span className="achhome__title">{t('ความสำเร็จ')}</span>
          <span className="achhome__count">
            {FIRSTS.filter((f) => f.got).length}/{FIRSTS.length} · mock
          </span>
          <CaretRight size={14} color="var(--text-disabled)" />
        </span>
        <span className="achhome__row" aria-hidden>
          {FIRSTS.map((f) => (
            <span key={f.title} className={`achhome__badge${f.got ? '' : ' achhome__badge--locked'}`} title={f.title}>
              {f.icon}
            </span>
          ))}
        </span>
        <span className="achhome__sub">
          {t('ล่าสุด')}: {FIRSTS.filter((f) => f.got).slice(-1)[0]?.title ?? '—'}
        </span>
      </Link>
      )}
      </div>
      </div>
    </Shell>
  );
}

const statBox: React.CSSProperties = {
  flex: 1, padding: '13px 14px', display: 'grid', gap: 3, textAlign: 'left', borderRadius: 14,
};
const statNum: React.CSSProperties = { font: '700 22px var(--font-head)', color: 'var(--accent)' };
const statLabel: React.CSSProperties = { font: '400 11px var(--font-body)', color: 'var(--text-muted)' };
