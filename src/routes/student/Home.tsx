import { Bell, BookOpen, Camera, CaretRight, Check, CheckCircle, HandTap, Hourglass, Lock, MagnifyingGlass, MapPin, Medal, PencilSimple, Plus } from '@phosphor-icons/react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PendingBadge, SelfBadge, StaleBadge, TypeBadge } from '../../components/ui/Bits';
import { ActivityChips, PatientSelect, NoPatientWait, applyNoPatientWait, EMPTY_NO_PATIENT_WAIT, type NoPatientWaitValue } from '../../components/student/CheckInFields';
import { checkInNow } from '../../components/student/checkInNow';
import { useScanCheckIn } from '../../components/student/ScanCheckIn';
import { ConfirmSheet } from '../../components/student/ConfirmSheet';
import { recordStepLabel } from '../../components/student/stepLabel';
import { Shell } from '../../components/student/Shell';
import { SyncBanner } from '../../components/student/SyncBanner';
import { WaitSheet } from '../../components/student/WaitSheet';
import { useWaitFeature } from '../../data/waitFeature';
import { useCheckInPatients } from '../../components/student/useCheckInPatients';
import { useCheckIns, usePatientNamesOn, usePending, useSect2, useSect3, useSelfAssessment, useStepsOnDates, useStudent, useWorkpieces } from '../../hooks/data';
import { daysUntil, toISODate, weekMonday } from '../../lib/date';
import { firstNameOnly } from '../../domain/group';
import { personName, t, tSexAge, tText } from '../../lib/i18n';
import { patientTitle } from '../../lib/privacy';
import { workLabel, workMeta } from '../../domain/catalog';
import type { Settings, WorkpieceView } from '../../domain/types';
import { cheerLine, dailyQuote } from '../../domain/cheer';
import { activeStepGroup, caseCountTotals, groupByReqRow, currentProc, daysSinceUpdate, isStale, maxProgression, needsWaitNudge, nextProc, procLabel, progression, isActiveWork, stepFraction, stepGroups, stepsPassed } from '../../domain/rules';
import { currentActor, useApp } from '../../store/app';
import { tapFeedback } from '../../lib/haptic';
import { NO_PATIENT_ACTIVITY } from '../../domain/checkin';
import { isSect2Evaluated } from '../../domain/sect2';
import { isSect3Evaluated } from '../../domain/sect3';
import { FIRSTS } from './Achievements';
import { groupShort } from '../../domain/group';
import { saYearNow } from '../../domain/saFeedback';
import { saOpenFor, saProgress, type SAValue } from '../../domain/selfAssessment';
import { studentYear } from '../../domain/cohort';

// การ์ดความสำเร็จท้ายหน้าแรก — ซ่อนรอเสนอภาคก่อน
const SHOW_ACHIEVEMENT_CARD = false;

/** ตัวเลขนับขึ้นจาก 0 ตอนเปิดแอป (แผงงานถัดไป) — ไม่เล่นเมื่อ run = false */
function useCountUp(target: number, run: boolean, ms = 850, delay = 150) {
  const [v, setV] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) { setV(target); return; }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / ms));
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, run]);
  return v;
}

/**
 * วงแหวนขั้นย่อยที่เสร็จ — เป็นปุ่มกาง/พับรายการขั้นย่อยในตัว (แทนแถบกางแยกที่ทำให้แผงสูงและรก)
 * ตัวเลขวางซ้อนเป็น HTML ไม่ใส่ใน <text> ของ svg ให้ฟอนต์ตรงกับทั้งหน้า
 */
function SubRing({ done, total, open, onToggle, intro }: { done: number; total: number; open: boolean; onToggle: () => void; intro: boolean }) {
  const R = 24;
  const C = 2 * Math.PI * R;
  const shown = useCountUp(done, intro, 700, 350);
  return (
    <button className="hp__ring" onClick={onToggle} aria-expanded={open} aria-label={t('ขั้นย่อยที่เสร็จ {a} จาก {b} · แตะเพื่อดูทั้งหมด', { a: done, b: total })}>
      <span className="hp__ringbox">
        <svg width="52" height="52" viewBox="0 0 60 60" aria-hidden>
          <circle cx="30" cy="30" r={R} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="6" />
          <circle
            className="hp__ringarc"
            cx="30" cy="30" r={R} fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${(C * done) / Math.max(1, total)} ${C}`} transform="rotate(-90 30 30)"
            style={{ transition: 'stroke-dasharray .45s cubic-bezier(.2,.8,.2,1)' }}
          />
        </svg>
        <span className="hp__ringnum">{shown}/{total}</span>
      </span>
      <span className="hp__ringcap">
        {t('ขั้นย่อย')}
        <CaretRight size={12} weight="bold" className="hp__chev" data-open={open} />
      </span>
    </button>
  );
}

/**
 * แผง "งานถัดไป" หนึ่งเคส (หนึ่งหน้าในแผงที่ปัดได้)
 * เส้น step มีหมุดแค่สามตัว: เริ่ม · ตอนนี้ · ปิดเคส — แตะหมุดหัว/ท้ายเพื่อดูว่าขั้นนั้นคืออะไร
 * ส่วนกลาง: "กำลังทำ" + ชื่อขั้น + วงแหวนขั้นย่อย · แถบกางรายการขั้นย่อยทั้ง step · ปุ่มบอกชื่องานที่จะบันทึก
 */
function PanelSlide({
  w, pending, stale, onPass, intro,
}: {
  w: WorkpieceView;
  pending: boolean;
  stale: boolean;
  onPass: () => void;
  /** เล่นแอนิเมชันเปิดแอป (เฉพาะหน้าแรกของแผง ครั้งแรกที่เปิดแอป) */
  intro: boolean;
}) {
  const namesOn = usePatientNamesOn();
  const [peek, setPeek] = useState<'start' | 'end' | null>(null);
  const [open, setOpen] = useState(false);
  const next = nextProc(w);
  const max = maxProgression(w);
  const groups = stepGroups(w);
  const active = activeStepGroup(w);
  const startG = groups[0];
  const endG = groups[groups.length - 1];
  const nowProg = active ? active.progression : Math.max(progression(w), 0);
  const at = (prog: number) => `${(prog / Math.max(1, max)) * 100}%`;
  // หมุดหัว/ท้ายอยู่ชิดหมุด "ตอนนี้" เกินไป ป้ายจะทับกัน → ซ่อนแค่ป้าย หมุดยังแตะได้
  const tight = (prog: number) => Math.abs(prog - nowProg) / Math.max(1, max) < 0.2;
  const where = w.tooth ? ` · ${t('ซี่')} ${w.tooth}` : w.arch ? ` · ${w.arch === 'upper' ? t('บน') : t('ล่าง')}` : '';
  const btnLabel = next ? recordStepLabel(next.name) : '';
  const stepShown = useCountUp(nowProg, intro);

  return (
    <div className={`hp__slide t-${w.type}`}>
      <div className="hp__top">
        <span className="hp__who">
          <b>{patientTitle(w.patient, namesOn, t)}</b>{' '}
          {/* ชื่อชนิดงานจริง (Complicated APD / Co-Cr RPD …) แทนป้ายแถวเกณฑ์ "CD/APD" */}
          <span className="hp__chip"><i style={{ background: workMeta(w).color }} />{workLabel(w)}</span>
          {where}
          {/* ไม่ใช้ชื่อ (นำร่อง) = HN เป็นหัวเรื่อง · เพศ/อายุช่วยแยกคนไข้ที่ HN คล้ายกัน */}
          {!namesOn && w.patient.sexAge ? ` · ${tSexAge(w.patient.sexAge)}` : ''}
        </span>
        <span className="hp__step">Step {stepShown} <span className="hp__of">/ {max}</span></span>
        <Link to={`/app/work/${w.id}`} className="hp__open" aria-label={t('เปิดรายละเอียดเคส')}>
          <CaretRight size={18} weight="bold" />
        </Link>
      </div>
      {(pending || stale) && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {pending && <PendingBadge />}
          {stale && <StaleBadge days={daysSinceUpdate(w)} />}
        </div>
      )}

      <div className="hp__track">
        <span className="hp__rail" />
        <span className="hp__fill" style={{ width: `${stepFraction(w) * 100}%` }} />
        {startG && startG.progression !== nowProg && (
          <button
            className={`hp__node hp__node--done${peek === 'start' ? ' is-sel' : ''}${tight(startG.progression) ? ' is-tight' : ''}`}
            style={{ left: at(startG.progression) }}
            onClick={() => setPeek(peek === 'start' ? null : 'start')}
            aria-label={t('ดู step {n}', { n: startG.progression })}
          >
            <span className="hp__dot" /><span className="hp__lbl">{t('เริ่ม')}</span>
          </button>
        )}
        <button
          className={`hp__node hp__node--now${peek === null ? ' is-sel' : ''}`}
          style={{ left: at(nowProg) }}
          onClick={() => setPeek(null)}
          aria-label={t('ดู step ที่กำลังทำ')}
        >
          <span className="hp__dot" /><span className="hp__lbl">{t('ตอนนี้')}</span>
        </button>
        {endG && endG.progression !== nowProg && (
          <button
            className={`hp__node hp__node--todo${peek === 'end' ? ' is-sel' : ''}${tight(endG.progression) ? ' is-tight' : ''}`}
            style={{ left: at(endG.progression) }}
            onClick={() => setPeek(peek === 'end' ? null : 'end')}
            aria-label={t('ดู step {n}', { n: endG.progression })}
          >
            <span className="hp__dot" /><span className="hp__lbl">{t('ปิดเคส')}</span>
          </button>
        )}
      </div>

      {peek === 'start' && startG && (
        <div className="hp__info">
          <div className="hp__kicker">Step {startG.progression} · {t('ผ่านแล้ว')} ✓</div>
          <div className="hp__name">{startG.procs.map((p) => p.name).join(' · ')}</div>
          <button className="hp__ghost" onClick={() => setPeek(null)}>{t('กลับไป step ปัจจุบัน')}</button>
        </div>
      )}
      {peek === 'end' && endG && (
        <div className="hp__info">
          <div className="hp__kicker">Step {endG.progression} · {t('ยังไม่ถึง')}</div>
          <div className="hp__name">{endG.procs.map((p) => p.name).join(' · ')}</div>
          <div className="hp__lock">
            <Lock size={15} weight="bold" />
            {t('อีก {n} step จะถึงขั้นนี้', { n: endG.progression - nowProg })}
          </div>
        </div>
      )}
      {peek === null && (next && active ? (
        <div className="hp__info">
          <div className="hp__now">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hp__kicker hp__kicker--hi">{t('กำลังทำ')}</div>
              <Link to={`/app/work/${w.id}`} className="hp__name">{next.name}</Link>
            </div>
            {active.procs.length > 1 && (
              <SubRing done={active.done} total={active.procs.length} open={open} onToggle={() => setOpen(!open)} intro={intro} />
            )}
          </div>
          {next.selfPerformed && (
            <div className="hp__self">
              <HandTap size={15} weight="fill" />
              {t('step นี้ต้องทำเอง (self-performed)')}
            </div>
          )}
          {active.procs.length > 1 && (
            <>
              {/* กางด้วยการแตะวงแหวน — แถบกางแยกเดิมทำให้แผงสูงและรก */}
              <div className="hp__subs" data-open={open} aria-label={t('ขั้นย่อยทั้งหมดใน step {n}', { n: active.progression })}>
                <div>
                  <ol className="hp__sublist">
                    {active.procs.map((p, k) => {
                      const state = p.index <= w.procIndex ? 'done' : p.index === next.index ? 'now' : 'todo';
                      return (
                        <li key={p.index} className={`hp__sub hp__sub--${state}`}>
                          <span className="hp__subnum">{state === 'done' ? <Check size={12} weight="bold" /> : k + 1}</span>
                          <span className="hp__subname">{p.name}</span>
                          {p.selfPerformed && <SelfBadge compact />}
                          {state === 'now' && <span className="hp__subtag">{t('กำลังทำ')}</span>}
                          {state === 'todo' && p.index === next.index + 1 && <span className="hp__subtag">{t('ถัดไป')}</span>}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </>
          )}
          <button className="hp__btn" onClick={onPass}>{btnLabel}</button>
        </div>
      ) : (
        <div className="hp__info">
          <div className="hp__kicker">{t('สถานะ')}</div>
          <div className="hp__name">{currentProc(w) ? procLabel(w.type, currentProc(w)!) : t('ยังไม่เริ่ม')}</div>
        </div>
      ))}
    </div>
  );
}

/** แผงงานถัดไปแบบปัดซ้าย-ขวาเปลี่ยนเคส (จุดใต้แผงกดได้) */
function CasePanel({
  cases, index, onIndex, pending, settings, onPass, intro,
}: {
  cases: WorkpieceView[];
  index: number;
  onIndex: (i: number) => void;
  pending: Set<string>;
  settings: Settings;
  onPass: (id: string) => void;
  intro: boolean;
}) {
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; moved: boolean; horizontal: boolean | null } | null>(null);
  const last = cases.length - 1;
  // แผงสูงเท่าเคสที่โชว์อยู่ — ไม่งั้นเคสสั้นเหลือที่ว่างเท่าเคสที่สูงที่สุด (กางรายการขั้นย่อยแล้วสูงขึ้นตาม)
  const pages = useRef<(HTMLDivElement | null)[]>([]);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = pages.current[index];
    if (!el) return;
    const fit = () => setHeight(el.offsetHeight);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, cases.length]);

  function down(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, moved: false, horizontal: null };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.horizontal === null && Math.abs(mx) + Math.abs(my) > 8) d.horizontal = Math.abs(mx) > Math.abs(my);
    if (!d.horizontal) return;
    d.moved = true;
    // ขอบซ้ายสุด/ขวาสุดลากได้หนืดๆ ให้รู้ว่าสุดแล้ว
    setDx((index === 0 && mx > 0) || (index === last && mx < 0) ? mx / 3 : mx);
  }
  function up() {
    const d = drag.current;
    if (d?.moved) {
      if (dx < -50 && index < last) onIndex(index + 1);
      else if (dx > 50 && index > 0) onIndex(index - 1);
    }
    setDx(0);
    // ปล่อยนิ้วหลังลาก = ห้ามนับเป็นการแตะลิงก์/ปุ่มในแผง (onClickCapture ด้านล่างอ่านค่านี้)
    setTimeout(() => { drag.current = null; }, 0);
  }

  return (
    <>
    <section className={`hp${intro ? ' hp--intro' : ''}`} aria-roledescription="carousel" aria-label={t('งานถัดไป')}>
      <div
        className="hp__viewport"
        style={{ height }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => drag.current && up()}
        onClickCapture={(e) => { if (drag.current?.moved) { e.preventDefault(); e.stopPropagation(); } }}
        // ตาข่ายสำหรับเบราว์เซอร์ที่ไม่รู้จัก overflow: clip — โฟกัสปุ่มในแผงห้ามเลื่อนแผงเอง
        onScroll={(e) => { e.currentTarget.scrollLeft = 0; }}
      >
        <div
          className="hp__row"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${dx}px))`,
            transition: dx ? 'none' : undefined,
          }}
        >
          {cases.map((w, i) => (
            <div
              key={w.id} ref={(el) => { pages.current[i] = el; }}
              className="hp__page" aria-hidden={i !== index} inert={i !== index ? true : undefined}
            >
              <PanelSlide w={w} pending={pending.has(w.id)} stale={isStale(w, settings)} onPass={() => onPass(w.id)} intro={intro && i === index} />
            </div>
          ))}
        </div>
      </div>
    </section>
      {/* จุดบอกหน้าอยู่ใต้แผง (บนพื้นเทา) — แผงเตี้ยลง */}
      {cases.length > 1 && (
        <div className="hp__dots">
          {cases.map((w, i) => (
            <button
              key={w.id}
              className="hp__pager"
              data-on={i === index}
              onClick={() => onIndex(i)}
              aria-label={t('ดูเคสที่ {n} จาก {m}', { n: i + 1, m: cases.length })}
              aria-current={i === index}
            >
              <span />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** แอนิเมชันเปิดแอปเล่นครั้งเดียวต่อการเปิดแอป — กลับมาหน้าแรกซ้ำไม่เล่นอีก */
let introPlayed = false;

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
  const waitReady = useWaitFeature();
  /* การ์ดถาม "คนไข้ไม่ว่างไหม" — เคสที่เงียบนานสุด (needsWaitNudge) · กด "ยังทำอยู่" แล้วไม่ถามเคสนั้นซ้ำ
     จนกว่าจะมีการอัปเดตใหม่ (จำคู่ id + เวลาอัปเดตล่าสุดไว้ในเครื่อง) */
  const [nudgeSkip, setNudgeSkip] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('pt-wait-nudge') ?? '{}') as Record<string, string>; } catch { return {}; }
  });
  const nudge = waitReady
    ? [...works].filter((w) => needsWaitNudge(w) && nudgeSkip[w.id] !== w.lastUpdatedAt)
      .sort((a, b) => a.lastUpdatedAt.localeCompare(b.lastUpdatedAt))[0]
    : undefined;
  const [waitFor, setWaitFor] = useState<WorkpieceView | null>(null);
  function skipNudge(w: WorkpieceView) {
    const next = { ...nudgeSkip, [w.id]: w.lastUpdatedAt };
    setNudgeSkip(next);
    try { localStorage.setItem('pt-wait-nudge', JSON.stringify(next)); } catch { /* โหมดส่วนตัว — จำไม่ได้ก็ถามใหม่ */ }
  }
  /* แบบประเมินตนเองของปีการศึกษานี้ — การ์ดบนหน้าแรกทำหน้าที่แจ้งเตือนไปในตัว
     3 สถานะ: เปิดแล้วยังไม่เริ่ม (จุดแดง) · กรอกค้าง (บอกความคืบหน้า) · ส่งแล้ว (เงียบ) */
  const selfAssessment = useSelfAssessment(session?.studentId, saYearNow());
  /* จำนวนใบที่ "ประเมินเสร็จแล้ว" บนการ์ดสมุดของฉัน — นับใบเดียวกับที่หน้าสมุดโชว์
     ใบร่างที่อาจารย์กรอกค้างไม่นับ ไม่งั้นเลขบนการ์ดกับในเล่มจะไม่ตรงกัน */
  const pf2 = useSect2(session?.studentId, saYearNow());
  const pf3 = useSect3(session?.studentId, saYearNow());
  const portfolioDone = useMemo(() => {
    const keys = new Set<string>();
    for (const r of pf2) if (isSect2Evaluated(r)) keys.add(`2:${r.formKey}`);
    for (const r of pf3) if (isSect3Evaluated(r)) keys.add(`3:${r.formKey}`);
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
  // แผงงานถัดไปปัดดูได้ทีละเคส (5 เคสล่าสุด) · เคสที่ไม่ได้อยู่บนแผงตอนนี้เป็นแถวย่อด้านล่าง กดปุ่มขวาผ่าน step ได้เลย
  const panelCases = recent.slice(0, 5);
  const [slideAt, setSlideAt] = useState(0);
  const [intro, setIntro] = useState(() => {
    if (introPlayed) return false;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* เบราว์เซอร์เก่า */ }
    return !reduce;
  });
  // ต้องรอให้มีเคสก่อนค่อยนับว่าเล่นแล้ว (เปิดแอปครั้งแรก รายการเคสยังโหลดไม่ทัน)
  const hasCases = recent.length > 0;
  useEffect(() => {
    if (!intro || !hasCases) return;
    introPlayed = true;
    const id = setTimeout(() => setIntro(false), 2600);
    return () => clearTimeout(id);
  }, [intro, hasCases]);
  const slide = Math.min(slideAt, Math.max(0, panelCases.length - 1));
  const rest = panelCases.filter((_, i) => i !== slide);
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
   * แผ่นถามเช็คอินตอนเปิดแอป
   * เหตุผล: ทำงานอย่างอื่นเพลินแล้วลืมว่ายังไม่ได้เช็คอิน — เด้งถามก่อนเลย
   * กติกา: ถามเฉพาะยังไม่เช็คอินวันนี้ · กด "ไว้ก่อน" แล้ววันนั้นไม่กวนซ้ำ
   * (จำการข้ามไว้ในเครื่อง — พรุ่งนี้ค่อยถามใหม่)
   */
  const [askCheckIn, setAskCheckIn] = useState(false);
  const scan = useScanCheckIn();
  // ฟอร์มในแผ่นถาม — เลือกกิจกรรม/คนไข้ได้เลยตั้งแต่ตอนเด้ง
  const [askActs, setAskActs] = useState<string[]>([]);
  const [askPatient, setAskPatient] = useState('');
  const askNoPatient = askActs.includes(NO_PATIENT_ACTIVITY);
  const [askWait, setAskWait] = useState<NoPatientWaitValue>(EMPTY_NO_PATIENT_WAIT);
  const askPatients = useCheckInPatients(works, namesOn);

  async function submitAskCheckIn() {
    if (!session || checkingIn.current) return;
    checkingIn.current = true;
    tapFeedback();
    try {
      const res = await scan.checkIn(() => checkInNow({
        studentId: session.studentId, date: today,
        noPatient: askNoPatient,
        patientId: askNoPatient ? undefined : (askPatient || undefined),
        activities: askActs, note: '', actor: currentActor(),
      }));
      if (!res) return; // ปิดกล้องเอง — แผ่นถามยังเปิดอยู่ให้ลองใหม่
      if (askNoPatient && askWait.ids.length) await applyNoPatientWait(askWait, currentActor());
      setAskWait(EMPTY_NO_PATIENT_WAIT);
      setAskCheckIn(false);
      touch();
      if (!res.scanned) showToast({ message: t('เช็คอินแล้ว {time} น. — โชคดีกับคาบนี้ครับ', { time: res.stamp.checkinAt }), tone: 'success' });
    } finally {
      checkingIn.current = false;
    }
  }
  useEffect(() => {
    // ภาคเปิดสแกน QR แล้วไม่เด้งถาม — เช็คอินต้องเกิดที่หน้าห้อง กดปุ่มเช็คอินเองตอนถึง
    if (!session || checkedInToday || scan.required) return;
    let skipped = '';
    try { skipped = localStorage.getItem('pt-checkin-ask') ?? ''; } catch { /* private mode */ }
    if (skipped !== today) setAskCheckIn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedInToday, today, scan.required]);

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
      const res = await scan.checkIn(() => checkInNow({
        studentId: session.studentId, date: today,
        noPatient: false, activities: [], note: '', actor: currentActor(),
      }), { fillLink: true });
      if (!res) return;
      touch();
      if (!res.scanned) showToast({ message: t('เช็คอินแล้ว {time} น. — กิจกรรมมาเติมทีหลังได้เลย', { time: res.stamp.checkinAt }), tone: 'success' });
    } finally {
      checkingIn.current = false;
    }
  }

  return (
    <Shell overlay={<>
      {askCheckIn && !checkedInToday && !scan.required && (
        <div className="backdrop" onClick={skipCheckInAsk}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '82%', overflowY: 'auto' }}>
            <h3 style={{ margin: 0, font: '700 17px var(--font-head)' }}>{t('เช็คอินคาบวันนี้')}</h3>
            {/* คำอธิบายวิธีใช้ตัดออก — ปุ่ม "ไว้ก่อน" ข้างล่างบอกอยู่แล้วว่าไม่กรอกก็ได้ */}

            <div style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 7 }}>{t('กิจกรรมในคาบ')}</div>
            <ActivityChips selected={askActs} onChange={setAskActs} />

            {!askNoPatient && (
              <>
                {/* ป้ายเป็น div ที่ไม่ได้ผูกกับ select — โปรแกรมอ่านหน้าจอจะอ่านแค่ "กล่องรายการ"
                    ไม่บอกว่ากล่องนี้คือช่องอะไร (WCAG 1.3.1 · 3.3.2) */}
                <div style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 7 }}>{t('ผู้ป่วยที่นัด')}</div>
                <PatientSelect value={askPatient} onChange={setAskPatient} patients={askPatients} ariaLabel={t('ผู้ป่วยที่นัด')} style={{ marginBottom: 14 }} />
              </>
            )}
            {askNoPatient && waitReady && (
              <div style={{ marginBottom: 14 }}><NoPatientWait works={works} namesOn={namesOn} value={askWait} onChange={setAskWait} /></div>
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
      {scan.overlay}
      {waitFor && (
        <WaitSheet
          patientId={waitFor.patientId}
          title={patientTitle(waitFor.patient, namesOn, t)}
          works={works.filter((w) => w.patientId === waitFor.patientId)}
          note={waitFor.patient.note}
          onClose={() => setWaitFor(null)}
        />
      )}
    </>}>
      <header className="s-header">
        <div className="s-header--row">
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* หัวเรื่องของหน้าแรก = คำทักทาย + ชื่อต้น ตัวใหญ่บรรทัดเดียว · ต้องเป็น h1 หนึ่งตัวต่อหน้า (WCAG 1.3.1)
              ชื่อจริงเต็มยาวจนขึ้นสองบรรทัด — ชื่อเต็มยังอยู่ครบทุกที่ฝั่งอาจารย์และหน้าอื่น */}
          <h1 className="homehello">
            {greeting()}, {firstNameOnly(personName(student, 'นักศึกษา'))}
          </h1>
          {student?.group && <div className="homehello__group">{groupShort(student.group)}</div>}
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
 */}
      <div className="homegrid" style={{ padding: '6px 16px 0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
      <div className="homecol">
      <SyncBanner />
      {(() => {
        const inner = (
          <>
            {checkedInToday ? (
              <span className="homecheck__ok"><Check size={13} weight="bold" /></span>
            ) : (
              <MapPin size={21} color="var(--text-secondary)" style={{ flex: 'none' }} />
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="homecheck__title">
                {checkedInToday ? t('เช็คอินคาบวันนี้') : t('ยังไม่เช็คอินคาบวันนี้')}
              </span>
              {checkedInToday && (
                <span className="homecheck__sub">
                  {(todayCheckIn?.activities.length ?? 0) > 0
                    ? `${t(todayCheckIn?.activities[0] ?? '')}${todayStepCount > 0 ? ` · ${t('เสร็จแล้ว {n} ขั้น', { n: todayStepCount })}` : ''} · ${todayCheckIn?.status === 'evaluated' ? t('ประเมินแล้ว') : t('รอประเมิน')}`
                    : t('เช็คอินแล้ว {time} น. · แตะเพื่อเติมกิจกรรมตอนว่าง', { time: todayCheckIn?.checkinAt ?? '' })}
                </span>
              )}
              {/* บรรทัดให้กำลังใจรายวัน — โผล่หลังเช็คอินแล้วเท่านั้น (อวยพรก่อนเช็คอินมันแปลก) */}
              {checkedInToday && (
                <span className="homecheck__cheer">{cheerLine(works, checkins, settings, undefined, namesOn)}</span>
              )}
            </span>
            {checkedInToday
              ? <CaretRight size={15} color="var(--text-disabled)" style={{ flex: 'none' }} />
              : <span className="homecheck__go">{t('เช็คอิน')}</span>}
          </>
        );
        // ยังไม่เช็คอิน = แตะเดียวเช็คอินทันที · เช็คอินแล้ว = พาไปหน้าคาบ (เติมกิจกรรม/ดูประวัติ)
        return checkedInToday ? (
          <Link to="/app/checkin" className="homecheck">{inner}</Link>
        ) : (
          <button className="homecheck" onClick={quickCheckIn}>{inner}</button>
        );
      })()}

      {/* ทางลัด 4 วง — แบบประเมินตนเองโผล่เฉพาะช่วงที่ภาคเปิด (เหมือนแถวในกล่อง "ของฉัน") */}
      <nav className={`homeqa${intro ? ' homeqa--intro' : ''}`} aria-label={t('ทางลัด')}>
        <Link to="/app/new" className="homeqa__item">
          <span className="homeqa__ic"><Plus size={24} /></span>{t('เพิ่มชิ้นงาน')}
        </Link>
        <Link to="/app/photos" className="homeqa__item">
          <span className="homeqa__ic"><Camera size={24} /></span>{t('คลังรูปงาน')}
        </Link>
        <Link to="/app/portfolio" className="homeqa__item">
          <span className="homeqa__ic"><BookOpen size={24} /></span>{t('สมุดของฉัน')}
        </Link>
        {(saOpen || saDone) && (
          <Link to="/app/self-assessment" className="homeqa__item">
            <span className="homeqa__ic">
              <PencilSimple size={24} />
              {saNew && <span className="homeqa__new" aria-label={t('ใหม่')} />}
            </span>
            {t('ประเมินตนเอง')}
          </Link>
        )}
      </nav>

      {panelCases.length > 0 && (
        <CasePanel
          cases={panelCases} index={slide} onIndex={setSlideAt}
          pending={pending} settings={settings} onPass={(id) => openSheet(id)} intro={intro}
        />
      )}

      {nudge && (
        <section className="waitnudge" aria-label={t('เคสที่ไม่ขยับนาน')}>
          <span className="waitnudge__title">
            <Hourglass size={17} weight="fill" color="var(--warning)" />
            {t('{p} ไม่ขยับมา {n} วัน', { p: patientTitle(nudge.patient, namesOn, t), n: daysSinceUpdate(nudge) })}
          </span>
          <p className="waitnudge__sub">
            {tText(nudge.detail)} · {t('ขั้น {n}', { n: Math.max(progression(nudge), 0) })} — {t('ถ้าคนไข้ไม่ว่าง บอกแอปไว้ อาจารย์จะได้ไม่เข้าใจว่าเคสค้าง')}
          </p>
          <div className="waitnudge__btns">
            <button className="btn" onClick={() => setWaitFor(nudge)}>{t('คนไข้ไม่ว่าง / รอ')}</button>
            <button className="btn btn--sec" onClick={() => skipNudge(nudge)}>{t('ยังทำอยู่')}</button>
          </div>
        </section>
      )}

      {/* เคสอื่นจัดกลุ่มตามแถวเกณฑ์ — ชื่อชนิดงานจริงบนทุกแถว หัวกลุ่มบอกว่าแถวนั้นจบไปกี่ชิ้นแล้ว
          (เดิมมีแค่จุดสี ต้องจำเองว่าสีไหนคืออะไร และ CD กับ Complicated APD สีเดียวกัน) */}
      {rest.length > 0 && (
        <div className="homelabel actlabel">
          <span>{t('งานที่กำลังทำ')}</span>
          <span>{t('{n} ชิ้น', { n: active.length })}</span>
        </div>
      )}
      {groupByReqRow(rest, totals.rows).map((g) => (
        <Fragment key={g.row?.group ?? 'other'}>
          <div className="actgroup">
            <span className="dot" style={{ background: g.row?.color ?? 'var(--text-faint)' }} />
            <span className="actgroup__name">{g.row ? t(g.row.label) : t('อื่นๆ')}</span>
            {g.row && <span className="actgroup__count">{t('จบ {a}/{b}', { a: g.row.done, b: g.row.required })}</span>}
          </div>
          {g.items.map((w) => {
            const next = nextProc(w);
            return (
              // ปุ่มผ่าน step อยู่ในการ์ดแล้ว — เดิมลอยนอกการ์ด ขอบขวาของการ์ดนี้เลยสั้นกว่าใบอื่น ดูเบี้ยว
              <div key={w.id} className="minirow">
                <Link to={`/app/work/${w.id}`} className="minirow__body">
                  <span className="minirow__top">
                    <TypeBadge work={w} />
                    <span className="minirow__name">
                      {patientTitle(w.patient, namesOn, t)}
                      {w.tooth ? ` · ${t('ซี่')} ${w.tooth}` : w.arch ? ` · ${w.arch === 'upper' ? t('บน') : t('ล่าง')}` : ''}
                      {' · '}<span className="mono">{Math.max(progression(w), 0)}/{maxProgression(w)}</span>
                    </span>
                    {isStale(w, settings) && <StaleBadge days={daysSinceUpdate(w)} />}
                    {pending.has(w.id) && <PendingBadge />}
                  </span>
                  {/* ชื่อขั้นถัดไป — เดิมแถวย่อบอกแค่ตัวเลข ต้องกดเข้าไปถึงจะรู้ว่าต้องทำอะไร
                      ผู้ใช้ขอให้เคสอื่นเด่นขึ้น — งานวันนี้ของทุกเคสควรอ่านได้จากหน้าแรก */}
                  {next && <span className="minirow__step">{next.name}</span>}
                </Link>
                {/* วงกลมลอยกลางแถว — เดิมเป็นแท่งสูงเต็มแถวมีเช็ค+เลขซ้อนกัน ดูแปลก
                    เลข step ตัดออกเพราะซ้ำกับ 9/10 ที่อยู่ข้างๆ อยู่แล้ว — เหลือเครื่องหมายถูกอย่างเดียว */}
                {next && (
                  <button className="minirow__pass" onClick={() => openSheet(w.id)} aria-label={t('บันทึกทำ step {n} เสร็จ', { n: next.progression })}>
                    <Check size={19} weight="bold" />
                  </button>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
      </div>

      <div className="homecol">
      <div className="homelabel">{t('สะสมมาแล้ว')}</div>
      <div style={{ display: 'flex', gap: 11 }}>
        <button className="card" style={statBox} onClick={() => navigate('/app/patients')}>
          <span style={statNum}>{active.length}</span>
          <span style={statLabel}>{t('ชิ้นงานที่กำลังทำ')}</span>
        </button>
        <button className="card" style={statBox} onClick={() => navigate('/app/criteria')}>
          <span style={{ ...statNum, color: totals.allComplete ? 'var(--success)' : 'var(--panel)' }}>
            {totals.done}/{totals.required}
          </span>
          <span style={statLabel}>{t('เกณฑ์สะสม 2 ปี')}</span>
        </button>
      </div>

      {/* แถบกำลังใจแบบสะสม — streak รายสัปดาห์ไม่เข้ากับตารางคลินิก (บางสัปดาห์ไม่มีคาบ)
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
            <b>{works.reduce((a, w) => a + Math.max(0, stepsPassed(w)), 0)}</b>{t('ขั้นที่ผ่านมือคุณ')}
          </span>
        </div>
        <span className="growcard__sub growcard__sub--quote">“{dailyQuote()}”</span>
      </div>

      {/* แบบประเมินตนเอง — ปีละครั้งตอนจบเทอม 1 ซ่อนไว้ตลอดปีจนกว่าภาคจะเปิด
          (การ์ดถาวรที่กดไม่ได้ = ขยะบนหน้าแรก)

          การ์ดนี้ทำหน้าที่ "แจ้งเตือน" ด้วย ให้ผูกการเปิดฟอร์มกับ noti
          วินาทีที่อาจารย์กดสวิตช์เปิด นักศึกษาที่ยังไม่เริ่มจะเห็นจุดแดงบนหน้าแรกทันที
          (ทำงานออฟไลน์ ไม่ต้องขอสิทธิ์ ไม่ต้องมีเซิร์ฟเวอร์ — push จริงยังไม่มีในระบบ) */}
      {/* ประเมินตนเอง + สมุดของฉัน อยู่ในการ์ดใบเดียวคั่นเส้น — เดิมแยกสองใบขอบหนา ดูเป็นกองกล่อง */}
      <div className="homelabel">{t('ของฉัน')}</div>
      <div className="card linkgroup">
      {(saOpen || saDone) && (
        <Link
          to="/app/self-assessment"
          className={`linkgroup__row${saNew ? ' linkgroup__row--new' : ''}`}
        >
          {/* แถวเดียวไม่มีไอคอน · สถานะสั้นชิดขวา — ใกล้กำหนดยังเป็นสีเตือนเหมือนเดิม */}
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

      {/* การ์ดความสำเร็จ — พับไว้ก่อน (รอเสนอภาคก่อนค่อยเปิด)
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
const statNum: React.CSSProperties = { font: '700 22px var(--font-head)', color: 'var(--panel)' };
const statLabel: React.CSSProperties = { font: '400 11px var(--font-body)', color: 'var(--text-muted)' };
