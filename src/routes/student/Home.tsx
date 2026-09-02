import { Bell, CaretRight, Check, CheckCircle, CheckSquare, HandTap, MagnifyingGlass, Medal, Square } from '@phosphor-icons/react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArchBadge, Bar, PendingBadge, SelfBadge, StaleBadge, TypeBadge } from '../../components/ui/Bits';
import { ConfirmSheet } from '../../components/student/ConfirmSheet';
import { addCheckIn } from '../../data/repo';
import { Shell } from '../../components/student/Shell';
import { useCheckIns, usePending, useStepsOnDates, useStudent, useWorkpieces } from '../../hooks/data';
import { relative, toISODate, weekMonday } from '../../lib/date';
import { firstNameOnly } from '../../domain/group';
import { t } from '../../lib/i18n';
import { BetaBadge } from '../../components/BetaBadge';
import { TYPES } from '../../domain/catalog';
import { cheerLine, dailyQuote } from '../../domain/cheer';
import {
  caseCountTotals, currentProc, daysSinceUpdate, isComplete, isStale, maxProgression, nextProc, procAt, procLabel, progression,
} from '../../domain/rules';
import { currentActor, useApp } from '../../store/app';
import { tapFeedback } from '../../lib/haptic';
import { ACTIVITY_GROUPS, NO_PATIENT_ACTIVITY } from '../../domain/checkin';
import { FIRSTS } from './Achievements';
import { groupShort } from '../../domain/group';

// การ์ดความสำเร็จท้ายหน้าแรก — ซ่อนรอเสนอภาคก่อน (ผู้ใช้ขอ 1 ก.ย.)
const SHOW_ACHIEVEMENT_CARD = false;

/** วงแหวนความคืบหน้ารวมของเคส — ผู้ใช้ขอคืนมาคู่กับเส้นทางด่าน (1 ก.ย.) เลยย่อไซซ์ลงไปอยู่มุมหัวการ์ด */
function Ring({ value, max }: { value: number; max: number }) {
  const R = 25;
  const C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, value / max));
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" style={{ flex: 'none' }} aria-hidden>
      <circle cx="32" cy="32" r={R} fill="none" stroke="var(--accent-ring)" strokeWidth="6.5" />
      <circle
        cx="32" cy="32" r={R} fill="none" stroke="var(--accent)" strokeWidth="6.5" strokeLinecap="round"
        strokeDasharray={`${C * f} ${C}`} transform="rotate(-90 32 32)"
      />
      <text x="32" y="31" textAnchor="middle" style={{ font: '700 14px var(--font-head)', fill: 'var(--text)' }}>{value}</text>
      <text x="32" y="43" textAnchor="middle" style={{ font: '400 9px var(--font-mono)', fill: 'var(--text-faint)' }}>/ {max}</text>
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
  const cur = currentProc(w);
  const next = nextProc(w);
  const prog = Math.max(progression(w), 0);
  const max = maxProgression(w);
  // เส้นทางด่านหน้าต่างแคบ "หน้า 1 หลัง 1" (ผู้ใช้ขอ 1 ก.ย. รอบสอง — ทั้งกลุ่ม active ยังแน่นไป):
  // ขั้นล่าสุดที่เสร็จ = cur อยู่แล้ว · ขั้นถัดจากปัจจุบันดึงตรงๆ ข้ามขอบกลุ่มได้เลย
  const upcoming = next ? procAt(w, w.procIndex + 2) : undefined;
  // step หนึ่งมีขั้นย่อยได้หลายอัน (Post-core step 3 มีถึง 9) — ไม่กางหมดแต่บอกตำแหน่งใน caption แทน
  let sibTotal = 0;
  let subPos = 0;
  if (next) {
    for (let i = 0; ; i++) {
      const pa = procAt(w, i);
      if (!pa) break;
      if (pa.progression === next.progression) {
        sibTotal++;
        if (pa.index === next.index) subPos = sibTotal;
      }
    }
  }
  return (
    <article className={`herocase t-${w.type}`}>
      <div className="herocase__top">
        <TypeBadge type={w.type} />
        <ArchBadge arch={w.arch} />
        {pending && <PendingBadge />}
        {stale && <StaleBadge days={daysSinceUpdate(w)} />}
        <span className="herocase__meta">{relative(w.lastUpdatedAt)}</span>
      </div>

      {/* โซนหัว: ชื่อคนไข้+caption ชิดซ้าย วงแหวนรวมทั้งเคสชิดขวา — เส้นทางด่านล่างได้เต็มความกว้าง */}
      <div className="herocase__lead">
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ตัดวงเล็บอธิบายท้ายชื่อเคส (เช่น "ไม่เหลือฟันแม้แต่ซี่เดียว") — คนใช้รู้อยู่แล้วว่า CD คืออะไร */}
          <Link to={`/app/work/${w.id}`} className="herocase__patient">
            {t(w.patient.name)} · HN {w.patient.hn} · {w.detail.replace(/\s*\(.*\)\s*$/, '')}
          </Link>
          {next && (
            <div className="herocase__caption" style={{ marginTop: 8 }}>
              {t('ขั้นตอนที่กำลังทำ')} · Step {next.progression}{sibTotal > 1 ? ` · ${t('ขั้นย่อย')} ${subPos}/${sibTotal}` : ''}
            </div>
          )}
        </div>
        {next && (
          <div className="herocase__ringwrap">
            <Ring value={prog} max={max} />
            {/* กันอ่านเป็น "คะแนน 5/10" — คำเดียวพอ และเป็นอังกฤษทั้งสองภาษาแบบหัวข้อ radar (ผู้ใช้เลือก 1 ก.ย.) */}
            <span className="herocase__ringlabel">steps</span>
          </div>
        )}
      </div>

      {next ? (
        <>
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
                {next.name} <CaretRight size={13} weight="bold" className="herocase__steparrow" />
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
  const student = useStudent(session?.studentId);
  const works = useWorkpieces(session?.studentId);
  const pending = usePending();
  const navigate = useNavigate();

  const active = works.filter((w) => !isComplete(w));
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
    works.forEach((w) => seen.set(w.patient.id, `${t(w.patient.name)} · HN ${w.patient.hn}`));
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
            <p style={{ margin: '5px 0 12px', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
              {t('เลือกได้เลยว่าวันนี้ทำอะไรกับคนไข้คนไหน — หรือยังไม่รู้ก็เช็คอินก่อนได้')}
            </p>

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
                <div style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 7 }}>{t('ผู้ป่วยที่นัด')}</div>
                <select className="input" value={askPatient} onChange={(e) => setAskPatient(e.target.value)} style={{ marginBottom: 14 }}>
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
          <div style={{ font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>{greeting()}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {/* ชื่อจริงเต็มยาวจนขึ้นสองบรรทัด — หน้านี้เอาแค่ "นศ. <ชื่อต้น>" (ผู้ใช้ขอ 2 ก.ย.)
                ชื่อเต็มยังอยู่ครบทุกที่ฝั่งอาจารย์และหน้าอื่น */}
            <span style={{ font: '700 19px var(--font-head)' }}>
              {t('นศ.')} {firstNameOnly(t(student?.name ?? 'นศ. Liv'))}
            </span>
            <span className="groupchip">{groupShort((student?.group ?? '')) || '—'}</span>
            <BetaBadge compact />
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

      <div className="sectiontitle" style={{ padding: '12px 16px 7px' }}>
        <h4>{t('วันนี้')}</h4>
      </div>

      {/* ทุกกล่องอยู่ในกองเดียว ระยะเท่ากันหมด — ต่อเนื่องแบบ mock ที่ผู้ใช้เลือก */}
      <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
      {(() => {
        const inner = (
          <>
            {checkedInToday ? (
              <CheckSquare size={26} weight="fill" color="var(--success)" style={{ flex: 'none' }} />
            ) : (
              <Square size={26} color="var(--warning)" style={{ flex: 'none' }} />
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: '600 13px/1.4 var(--font-head)' }}>{t('เช็คอินคาบวันนี้')}</span>
              <span style={{ display: 'block', font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                {checkedInToday
                  ? (todayCheckIn?.activities.length ?? 0) > 0
                    ? `${t(todayCheckIn?.activities[0] ?? '')}${todayStepCount > 0 ? ` · ${t('เสร็จแล้ว {n} ขั้น', { n: todayStepCount })}` : ''} · ${todayCheckIn?.status === 'evaluated' ? t('ประเมินแล้ว') : t('รอประเมิน')}`
                    : t('เช็คอินแล้ว {time} น. · แตะเพื่อเติมกิจกรรมตอนว่าง', { time: todayCheckIn?.checkinAt ?? '' })
                  : t('ยังไม่เช็คอิน — แตะครั้งเดียว เช็คอินเลย')}
              </span>
              {/* บรรทัดให้กำลังใจรายวัน — โผล่หลังเช็คอินแล้วเท่านั้น (อวยพรก่อนเช็คอินมันแปลก ผู้ใช้ทัก 555) */}
              {checkedInToday && (
                <span style={{ display: 'block', font: '500 10.5px/1.5 var(--font-body)', color: 'var(--accent-hover)', marginTop: 3 }}>
                  {cheerLine(works, checkins, settings)}
                </span>
              )}
            </span>
            <CaretRight size={15} color="var(--text-disabled)" style={{ flex: 'none' }} />
          </>
        );
        const cardStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px', borderRadius: 16, width: '100%', textAlign: 'left' };
        // ยังไม่เช็คอิน = แตะเดียวเช็คอินทันที · เช็คอินแล้ว = พาไปหน้าคาบ (เติมกิจกรรม/ดูประวัติ)
        return checkedInToday ? (
          <Link to="/app/checkin" className="card" style={cardStyle}>{inner}</Link>
        ) : (
          <button className="card" style={cardStyle} onClick={quickCheckIn}>{inner}</button>
        );
      })()}

      {hero && <HeroCard w={hero} pending={pending.has(hero.id)} stale={isStale(hero, settings)} onPass={() => openSheet(hero.id)} />}

      {rest.map((w) => {
        const next = nextProc(w);
        const meta = TYPES[w.type];
        return (
          <div key={w.id} className="minirow">
            <Link to={`/app/work/${w.id}`} className="minirow__body">
              <span className="minirow__top">
                <TypeBadge type={w.type} />
                <span className="minirow__name">{t(w.patient.name)}</span>
                {w.arch && <span className="minirow__arch">{w.arch === 'upper' ? 'Upper' : 'Lower'}</span>}
                {w.tooth && <span className="minirow__arch">{t('ซี่')} {w.tooth}</span>}
                {isStale(w, settings) && <StaleBadge days={daysSinceUpdate(w)} />}
                {pending.has(w.id) && <PendingBadge />}
              </span>
              {/* ชื่อขั้นถัดไป — เดิมแถวย่อบอกแค่ตัวเลข ต้องกดเข้าไปถึงจะรู้ว่าต้องทำอะไร
                  ผู้ใช้ขอให้เคสอื่นเด่นขึ้น (1 ก.ย.) — งานวันนี้ของทุกเคสควรอ่านได้จากหน้าแรก */}
              {next && <span className="minirow__step">{next.name}</span>}
              <span className="minirow__meta">
                <Bar value={(Math.max(progression(w), 0) / maxProgression(w)) * 100} color={meta.color} height={5} />
                <span className="mono">{Math.max(progression(w), 0)}/{maxProgression(w)}</span>
              </span>
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
          เลยนับแบบสะสมอย่างเดียว มีแต่เพิ่ม ไม่มีรีเซ็ต ไม่มีคำว่า "ขาด" */}
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
    </Shell>
  );
}

const statBox: React.CSSProperties = {
  flex: 1, padding: '13px 14px', display: 'grid', gap: 3, textAlign: 'left', borderRadius: 14,
};
const statNum: React.CSSProperties = { font: '700 22px var(--font-head)', color: 'var(--accent)' };
const statLabel: React.CSSProperties = { font: '400 11px var(--font-body)', color: 'var(--text-muted)' };
