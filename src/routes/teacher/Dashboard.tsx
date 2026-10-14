import { Archive, BellRinging, Check, House, SquaresFour, Users } from '@phosphor-icons/react';
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { ScopeHead } from '../../components/teacher/ScopeHead';
import { LinkRequestsPanel } from '../../components/teacher/LinkRequestsPanel';
import { StepInfo } from '../../components/StepInfo';
import { TodayCard, TodayLines, type TodayLine } from '../../components/teacher/TodayCard';
import { TypeDonut } from '../../components/charts/TypeDonut';
import { TraceDrawer, TraceRow, type TraceContent } from '../../components/teacher/TraceDrawer';
import { DataAge } from '../../components/teacher/DataAge';
import { RequirementSlots } from '../../components/teacher/RequirementSlots';
import { isFollowUpGroup, todaySummary } from '../../domain/today';
import { lastPullAt, pullAll } from '../../data/cloudSync';
import { cloudEnabled } from '../../lib/cloud';
import { typeChipLabel, typeMeta, typesPresent } from '../../domain/catalog';
import { alumniOverview, cohortYearly, countByType, staleRows, summarizeAll, summarizeGroups } from '../../domain/aggregate';
import { bottleneckByStep, riskByGroup, riskRows, worksAtStep } from '../../domain/analytics';
import {
  currentProc, daysSinceUpdate, isReturned, isStale, maxProgression, notCountedPieces, percentParts, procLabel, progression,
  isActiveWork, type NotCountedReason,
} from '../../domain/rules';
import type { WorkType, Workpiece } from '../../domain/types';
import {
  useAllCheckIns, useAllProgressUpdates, useAllStudents, useAllWorkpieces, usePendingPushCount, useSyncProblems, useSyncStatus, useTeacher,
} from '../../hooks/data';
import { defaultYearView, useYearView, type YearView } from '../../hooks/useYearView';
import { YearSeg } from '../../components/teacher/YearSeg';
import { personName, t, tText } from '../../lib/i18n';
import { thaiShort } from '../../lib/date';
import { waitReasonLabel } from '../../lib/waitReason';
import { alumniReady, ensureAlumniSeeded } from '../../data/seed';
import { signOutToReLogin, useApp } from '../../store/app';
import { onUpdateReady, updateReady } from '../../lib/appUpdate';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import type { Teacher } from '../../domain/types';
import { groupShort, groupYearOf, sortGroupCodes, splitPersonName } from '../../domain/group';
import { cohortLabel, cohortOf, isActiveStudent, isAlumni, studentCohortLabel, studentYear } from '../../domain/cohort';

/* อ้างอิงเดิมทุกเรนเดอร์ — `?? []` สร้างอาร์เรย์ใหม่ทุกครั้ง ทำให้ useMemo ที่พึ่งมันไม่ memo จริง */
const EMPTY_TEACHERS: Teacher[] = [];

export default function Dashboard() {
  const { settings, showToast } = useApp();
  const navigate = useNavigate();
  const link = useSyncStatus();
  const unsentCount = usePendingPushCount();
  const syncProblemList = useSyncProblems();
  const hasUpdate = useSyncExternalStore(onUpdateReady, updateReady);

  const allStudents = useAllStudents();
  const allWorks = useAllWorkpieces();
  const everyCheckIn = useAllCheckIns();
  const everyUpdate = useAllProgressUpdates();
  // ตัวกรองชั้นปี — กรองที่ต้นทางสามลิสต์นี้ ทุกกราฟ/ตารางข้างล่างได้ผลตามอัตโนมัติ
  const myGroup = useApp((st) => st.myGroup);
  // ป้าย "กลุ่มคุณ" บนช่องกลุ่ม — กลุ่มที่ผูกกับบัญชี ถ้ายังไม่รู้ (เดโม/บัญชียังไม่ผูก) ใช้กลุ่มที่เลือกไว้ในแถบซ้าย "กลุ่มที่ดูแล"
  const teacherGroup = useApp((st) => st.teacherGroup);
  const ownGroup = myGroup ?? teacherGroup;
  // เข้าทางเมนู "รุ่นที่จบแล้ว" = ล็อกโหมดนี้ไว้ ไม่ปนกับตัวกรองชั้นปีที่จำไว้ในเครื่อง
  const alumniPage = useLocation().pathname.endsWith('/alumni');
  /* รุ่นที่จบแล้วโหลดตอนกด ไม่ได้โหลดตอนเปิดแอป (ดู ensureAlumniSeeded ใน seed.ts)
     ต้องมีสถานะ "กำลังโหลด" ให้เห็น ไม่งั้นกดเข้ามาจะเจอหน้าว่างแล้วนึกว่าไม่มีข้อมูล */
  const [alumniLoading, setAlumniLoading] = useState(false);
  /* revision ขยับตอนกด "รีเซ็ตข้อมูลเดโม" — ต้องอยู่ใน deps ด้วย
     ไม่งั้นรีเซ็ตขณะเปิดหน้ารุ่นจบค้างไว้ ข้อมูลจะหายแล้วไม่มีอะไรสั่งโหลดกลับ */
  const revision = useApp((st) => st.revision);
  useEffect(() => {
    if (!alumniPage) return;
    let alive = true;
    void (async () => {
      if (await alumniReady()) return;
      if (alive) setAlumniLoading(true);
      await ensureAlumniSeeded();
      if (alive) setAlumniLoading(false);
    })();
    return () => { alive = false; };
  }, [alumniPage, revision]);
  const [savedYearView, setYearView] = useYearView(
    // ปีเริ่มต้น = ปีของกลุ่มที่ตัวเองดูแล นับจากสมาชิกจริง ไม่ใช่แกะจากรหัสกลุ่ม
    // ยังโหลดนักศึกษาไม่เสร็จ · กลุ่มว่าง · กลุ่มที่จบไปแล้ว → 'รวมปี' ไว้ก่อน
    // ต้องรับเฉพาะ 5 กับ 6 เท่านั้น ค่าอื่นไม่มีแท็บรองรับ = เปิดมาเจอหน้าว่าง
    defaultYearView(groupYearOf(myGroup ?? undefined, allStudents)),
  );
  const yearView: YearView = alumniPage ? 'alumni' : savedYearView === 'alumni' ? 'all' : savedYearView;
  // รุ่นที่เลือกดูในโหมด "จบแล้ว" (null = ทุกรุ่นที่จบ) — เก็บย้อนหลังหลายรุ่นจึงต้องเลือกได้
  const [cohortPick, setCohortPick] = useState<number | null>(null);
  // ค้นหานักศึกษาข้ามกลุ่มภายในรุ่นที่กำลังดู
  const [query, setQuery] = useState('');
  const students = useMemo(
    () => {
      // 'จบแล้ว' = ชั้นปีเกิน 6 · 'รวมปี' = เฉพาะที่ยังเรียนอยู่ (ไม่ปนรุ่นที่จบไป)
      if (yearView === 'alumni') {
        const grads = allStudents.filter((s) => isAlumni(s));
        // ดูทีละรุ่นเสมอ — ยังไม่ได้เลือก = รุ่นที่เพิ่งจบล่าสุด (ไม่เอา "ทุกรุ่น")
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

  const group = useApp((st) => st.teacherGroup);
  const setGroup = useApp((st) => st.setTeacherGroup);
  const [stepType, setStepType] = useState<WorkType>('CB');
  // null = ยังไม่ได้เลือกเอง → เปิด step ที่กองมากสุดให้อัตโนมัติ · -1 = ผู้ใช้กดปิด
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [pinged, setPinged] = useState<Record<string, boolean>>({});
  /* กล่องตัวเลขของช่องกลุ่มที่เพิ่งจิ้ม (ไอแพดไม่มี hover) — แตะที่อื่นแล้วปิด */
  const [peek, setPeek] = useState<string | null>(null);
  /* นาฬิกาเดินทุกนาที — ให้บรรทัด "ข้อมูลเก่า" โผล่เองโดยไม่ต้องรอให้หน้าวาดใหม่ด้วยเหตุอื่น */
  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const studentsRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  /** เลื่อนไปการ์ดแล้วกะพริบหนึ่งครั้ง — ใช้ร่วมกันระหว่างปุ่มในการ์ดกลุ่มกับบรรทัดในสรุปวันนี้ */
  const scrollFlash = (el: HTMLElement | null, block: ScrollLogicalPosition = 'start') => {
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block });
    el.classList.remove('panel--flash');
    void el.offsetWidth;
    el.classList.add('panel--flash');
  };
  const goToStudents = (code: string) => {
    setGroup(code);
    setQuery('');
    setPeek(null);
    scrollFlash(studentsRef.current);
  };
  useEffect(() => {
    if (!peek) return;
    const close = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.groupcell')) setPeek(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [peek]);

  const summaries = useMemo(() => summarizeAll(students, works, settings), [students, works, settings]);
  /* จุดคนในกล่องตัวเลขของช่องกลุ่ม — สีเสี่ยงตัวเดียวกับหน้าสรุปกลุ่ม (riskRows) ตัวเลขสองหน้าจึงตรงกัน */
  const activeStudents = useMemo(() => allStudents.filter((s) => isActiveStudent(s)), [allStudents]);
  /* คิดสีเสี่ยงครั้งเดียวจากทุกคนที่ยังเรียน — การ์ดกลุ่มกรองตามชั้นปีที่ดู · สรุปวันนี้ของที่ปรึกษาใช้กลุ่มตัวเองเสมอ (ไม่ขึ้นกับแท็บปี) */
  const riskAll = useMemo(
    () => riskRows(activeStudents, allWorks, settings, everyCheckIn, everyUpdate),
    [activeStudents, allWorks, settings, everyCheckIn, everyUpdate],
  );
  const groupRisk = useMemo(() => riskByGroup(riskAll.filter((r) => stuIds.has(r.student.id))), [riskAll, stuIds]);
  const groups = useMemo(() => summarizeGroups(summaries), [summaries]);
  const selected = groups.find((g) => g.code === group) ?? groups[0];
  const stale = useMemo(() => staleRows(students, works, settings), [students, works, settings]);
  const yearly = useMemo(() => cohortYearly(students, works, settings), [students, works, settings]);

  /* โซน "กลุ่มของฉัน" บนหน้าแรก ไม่ขึ้นกับแท็บชั้นปี (แท็บปีอยู่ในโซนทั้งชั้นปี)
     จึงสรุปจากทุกคนที่ยังเรียนอยู่ ไม่ใช่จาก students ที่กรองตามแท็บแล้ว */
  const activeSummaries = useMemo(() => summarizeAll(activeStudents, allWorks, settings), [activeStudents, allWorks, settings]);
  const activeGroups = useMemo(() => summarizeGroups(activeSummaries), [activeSummaries]);
  const zoneGroup = activeGroups.find((g) => g.code === group) ?? activeGroups.find((g) => g.code === ownGroup) ?? activeGroups[0];
  const zoneGroupCodes = useMemo(() => sortGroupCodes(activeGroups.map((g) => g.code), activeStudents), [activeGroups, activeStudents]);

  // แถวที่แสดงในตาราง: พิมพ์ค้นหา = มองข้ามกลุ่ม หาทั้งรุ่น · ไม่พิมพ์ = เฉพาะกลุ่มที่เลือก
  // หน้าแรกค้นในรุ่นเดียวกับกลุ่มที่ดูอยู่ · หน้ารุ่นที่จบแล้วค้นในรุ่นที่เลือก (summaries)
  const shownStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = alumniPage ? selected : zoneGroup;
    if (!q) return base?.students ?? [];
    const pool = alumniPage
      ? summaries
      : activeSummaries.filter((s) => !base?.students[0] || cohortOf(s.student) === cohortOf(base.students[0].student));
    return pool.filter((s) => `${s.student.name} ${s.student.nameEn ?? ''} ${s.student.code}`.toLowerCase().includes(q));
  }, [query, selected, summaries, alumniPage, zoneGroup, activeSummaries]);

  // รุ่นที่จบแล้วทั้งหมดในระบบ เรียงใหม่→เก่า ใช้ทำปุ่มเลือกรุ่น
  const alumniCohorts = useMemo(
    () => [...new Set(allStudents.filter((s) => isAlumni(s)).map((s) => cohortOf(s)))].sort((a, b) => b - a),
    [allStudents],
  );


  /* ชื่อที่ปรึกษาต่อกลุ่ม — อ่านจาก advisorIds ของนักศึกษาในกลุ่มนั้น */
  const teachersAll = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const advisorsOf = useMemo(() => {
    const byId = new Map(teachersAll.map((tc) => [tc.id, personName(tc)]));
    return (code: string) => {
      const ids = allStudents.find((st) => st.group === code)?.advisorIds ?? [];
      return [...new Set(ids)].map((id) => t(byId.get(id) ?? '')).filter(Boolean).join(' / ');
    };
  }, [teachersAll, allStudents]);

  const isAlumniView = yearView === 'alumni';
  const alumni = useMemo(() => alumniOverview(summaries, works), [summaries, works]);
  const activeByType = useMemo(() => countByType(works.filter(isActiveWork)), [works]);

  /* สรุปวันนี้ (โซนกลุ่ม) — นับเฉพาะกลุ่มที่โซนซ้ายแสดงอยู่เสมอ · ไม่มีกลุ่มให้แสดง = สรุปทั้งชั้นปีแทน
     เรื่องระดับชั้นปี (กลุ่มที่ต้องตามเยอะ · งานค้างกองที่ step ไหน) อยู่กล่อง "ต้องดูในชั้นปี" ในโซนขวา (yearToday) */
  const groupScope = !!zoneGroup;
  const session = useApp((st) => st.session);
  const me = useTeacher(session?.teacherId);
  const riskInput = useMemo(() => riskAll.map((r) => ({ studentId: r.student.id, risk: r.risk, reason: r.reason })), [riskAll]);
  const today = useMemo(() => todaySummary({
    students: zoneGroup ? activeStudents.filter((s) => s.group === zoneGroup.code) : students,
    works: allWorks,
    checkins: everyCheckIn,
    settings,
    risk: riskInput,
    groups: zoneGroup ? undefined : groups,
  }), [zoneGroup, activeStudents, students, allWorks, everyCheckIn, settings, riskInput, groups]);
  /* ทั้งชั้นปีตามแท็บปีในโซนขวา — ใช้แค่บรรทัดระดับชั้นปี */
  const yearToday = useMemo(() => todaySummary({
    students, works: allWorks, checkins: everyCheckIn, settings, risk: riskInput, groups,
  }), [students, allWorks, everyCheckIn, settings, riskInput, groups]);
  const groupName = (code: string, year: number) => (yearView === 'all' ? `${groupShort(code)} ${t('ปี {n}', { n: year })}` : groupShort(code));
  /** บรรทัดระดับชั้นปี — คนต้องตามรวม + กลุ่มที่ต้องตามเยอะสุด (isFollowUpGroup) · งานค้างกองที่ step ไหน */
  const yearLevelLines = (sum: typeof today): TodayLine[] => {
    const out: TodayLine[] = [];
    if (sum.followUp > 0) {
      const top = sum.followUpGroups;
      out.push({
        key: 'follow', tone: 'warn', icon: 'warn',
        text: (
          <>
            {t('ต้องตาม')} <b>{t('{n} คน', { n: sum.followUp })}</b>
            {top.length > 0 && (
              <>
                {' · '}{t('เยอะสุด')}{' '}
                {top.slice(0, 3).map((g, i) => (
                  <Fragment key={g.code}>{i > 0 && ' · '}<b>{groupName(g.code, g.year)}</b> ({g.followUp})</Fragment>
                ))}
                {top.length > 3 && <span className="yearalert__more"> +{top.length - 3}</span>}
              </>
            )}
          </>
        ),
        go: top.length > 0
          ? { label: t('ดูกลุ่ม'), onClick: () => { scrollFlash(stripRef.current, 'center'); setGroup(top[0].code); setPeek(top[0].code); } }
          : undefined,
      });
    }
    if (sum.stale > 0 && sum.staleTop) {
      const top = sum.staleTop;
      out.push({
        key: 'stale', tone: 'warn', icon: 'stale',
        text: <>{t('งานค้างเกิน {d} วัน', { d: settings.stale })} <b>{t('{n} ชิ้น', { n: sum.stale })}</b> · {t('ส่วนใหญ่ติด step {n}', { n: top.progression })}</>,
        go: { label: t('ดูในกราฟ'), onClick: () => { setStepType(top.type); setOpenStep(top.progression); scrollFlash(stepsRef.current, 'center'); } },
      });
    }
    return out;
  };
  const yearAlertLines = groupScope ? yearLevelLines(yearToday) : [];
  const todayLines: TodayLine[] = [];
  if (today.pendingPeople > 0) {
    todayLines.push({
      key: 'eval', tone: 'do', icon: 'eval',
      text: <>{t('รอประเมิน')} <b>{t('{n} คน', { n: today.pendingPeople })}</b> · {today.oldestPendingDays > 0 ? t('เก่าสุด {d} วันก่อน', { d: today.oldestPendingDays }) : t('วันนี้')}</>,
      go: { label: t('ไปประเมิน'), onClick: () => navigate('/teacher/evaluate') },
    });
  }
  if (groupScope) {
    if (today.followUp > 0 || today.stale > 0) {
      todayLines.push({
        key: 'risk', tone: 'warn', icon: today.followUp > 0 ? 'warn' : 'stale',
        text: today.followUp > 0
          ? <>{t('ต้องตาม')} <b>{t('{n} คน', { n: today.followUp })}</b>{today.stale > 0 && <> · {t('งานค้างเกิน {d} วัน', { d: settings.stale })} {t('{n} ชิ้น', { n: today.stale })}</>}</>
          : <>{t('งานค้างเกิน {d} วัน', { d: settings.stale })} <b>{t('{n} ชิ้น', { n: today.stale })}</b></>,
        go: { label: t('ดูรายชื่อ'), onClick: () => goToStudents(zoneGroup!.code) },
      });
    }
    /* เคสที่นักศึกษาบอกว่าหยุดเพราะคนไข้ — สีเทา รู้ไว้ ไม่นับในต้องตาม/ค้าง (isWaitingForPatient) */
    if (today.waitingList.length > 0) {
      todayLines.push({
        key: 'wait', tone: 'muted', icon: 'wait',
        text: <>{t('รอคนไข้')} <b>{t('{n} เคส', { n: today.waitingList.length })}</b></>,
      });
    }
  } else {
    todayLines.push(...yearLevelLines(today));
  }
  /* ข้อมูลบนจอเก่าแล้ว = เตือนก่อนทุกบรรทัด — ไม่งั้นอาจารย์อ่าน "ไม่มีอะไรน่าห่วง" จากข้อมูลเมื่อวาน
     นับจากรอบที่ดึงครบทุกตารางจริงเท่านั้น (cloudSync.lastPullAt) · โหมดเดโมไม่มีเซิร์ฟเวอร์ จึงไม่เตือน */
  void minuteTick;
  const pulledAt = cloudEnabled ? lastPullAt() : Date.now();
  const staleHours = pulledAt === null ? Infinity : (Date.now() - pulledAt) / 3_600_000;
  if (staleHours >= 12) {
    todayLines.unshift({
      key: 'old', tone: 'warn', icon: 'sync',
      text: pulledAt === null
        ? <>{t('ยังซิงก์ข้อมูลไม่สำเร็จตั้งแต่เปิดแอป')} · {t('ตัวเลขอาจไม่ใช่ล่าสุด')}</>
        : <>{t('ข้อมูลล่าสุดเมื่อ')} <b>{staleHours >= 48 ? t('{n} วันก่อน', { n: Math.floor(staleHours / 24) }) : t('{n} ชม. ก่อน', { n: Math.floor(staleHours) })}</b> · {t('ตัวเลขอาจไม่ใช่ล่าสุด')}</>,
      go: {
        label: t('ซิงก์เลย'),
        onClick: () => {
          showToast({ message: t('กำลังดึงข้อมูลล่าสุด…'), tone: 'default' });
          void pullAll().then(() => {
            const ok = lastPullAt() !== null && Date.now() - (lastPullAt() as number) < 60_000;
            setMinuteTick((n) => n + 1);
            showToast(ok
              ? { message: t('ข้อมูลล่าสุดแล้ว'), tone: 'success' }
              : { message: t('ยังดึงข้อมูลไม่ครบ — ลองใหม่เมื่อเน็ตกลับมา'), tone: 'warning' });
          });
        },
      },
    });
  }
  /* งานของอาจารย์เองที่ยังไม่ถึงเซิร์ฟเวอร์ — เดิมไม่มีหน้าไหนบอก: คะแนนที่ถูกปฏิเสธ หรือค้างเพราะต่อไม่ติด
     หายจากสายตาไปเลย ทั้งที่นักศึกษายังไม่เห็น · ของที่กำลังส่งตามปกติ (ค้างแค่ชั่วอึดใจ) ไม่นับ
     นับเฉพาะ "เซิร์ฟเวอร์ปฏิเสธ" กับ "ค้างเพราะต่อไม่ได้/หมดเวลาเข้าสู่ระบบ" · อยู่บนสุดเสมอ */
  const stuck = syncProblemList.length + (link.link === 'ok' ? 0 : unsentCount);
  if (cloudEnabled && (stuck > 0 || link.link === 'auth')) {
    todayLines.unshift(link.link === 'auth'
      ? {
          key: 'auth', tone: 'warn', icon: 'offline',
          text: <>{t('ต้องเข้าสู่ระบบใหม่')}{unsentCount > 0 && <> · {t('งาน')} <b>{t('{n} รายการ', { n: unsentCount })}</b> {t('รอส่งอยู่ในเครื่องนี้')}</>}</>,
          go: { label: t('เข้าสู่ระบบ'), onClick: () => { void signOutToReLogin().then(() => navigate('/login')); } },
        }
      : {
          key: 'unsent', tone: 'warn', icon: 'offline',
          text: <>{t('งาน')} <b>{t('{n} รายการ', { n: stuck })}</b> {t('ยังไม่ถึงเซิร์ฟเวอร์')} · {t('คนอื่นยังไม่เห็น')}</>,
          go: { label: t('ดูรายการ'), onClick: () => navigate('/teacher/settings') },
        });
  }
  /* แอปรุ่นที่เปิดค้างอยู่เก่ากว่าที่ขึ้นเว็บแล้ว — เครื่องอาจารย์มักเปิดแท็บค้างทั้งวัน · ไม่บังคับโหลดใหม่เอง (อาจกำลังกรอกใบประเมินค้าง)
     อยู่ใต้เรื่องการส่งข้อมูล (เร่งน้อยกว่า) · ฝั่งนักศึกษาคือแถบสีฟ้าบนหน้าแรก (components/student/SyncBanner) */
  if (hasUpdate) {
    const line: TodayLine = {
      key: 'update', tone: 'do', icon: 'sync',
      text: <>{t('มีแอปรุ่นใหม่')} · {t('งานที่ค้างไม่หาย')}</>,
      go: { label: t('อัปเดตเลย'), onClick: () => window.location.reload() },
    };
    const at = todayLines.findIndex((l) => l.key !== 'unsent' && l.key !== 'auth');
    todayLines.splice(at === -1 ? todayLines.length : at, 0, line);
  }
  if (!today.needsAttention && !todayLines.some((l) => l.key === 'unsent' || l.key === 'auth' || l.key === 'update')) {
    todayLines.unshift({ key: 'calm', tone: 'good', icon: 'good', text: t('วันนี้ไม่มีอะไรน่าห่วง') });
  }
  if (today.doneThisWeek > 0 && todayLines.length < 3) {
    todayLines.push({ key: 'done', tone: 'good', icon: 'good', text: <>{t('สัปดาห์นี้จบเคส')} <b>{t('{n} ชิ้น', { n: today.doneThisWeek })}</b></> });
  }
  /* ยังไม่มีช่องทางแจ้งเตือนจริง (push/LINE รอ phase 2) — toast ต้องไม่โกหก
     ว่าส่งแล้ว ไม่งั้นอาจารย์เข้าใจผิดว่าเด็กได้รับ (ตระกูลเดียวกับปุ่มส่งรายงานปลอมที่ตัดไป) */
  const ping = (key: string, name: string) => {
    setPinged((p) => ({ ...p, [key]: true }));
    showToast({ message: t('จดไว้แล้วว่าจะเตือน {n} — ระบบแจ้งเตือนจริงยังไม่เปิดใช้ ต้องบอกปากเปล่าก่อนนะครับ', { n: name }), tone: 'warning' });
  };
  const openStudent = (st: { id: string; group: string }) => { setGroup(st.group); navigate(`/teacher/review?student=${st.id}`); };

  /* รายคนใต้บรรทัด "รอประเมิน" / "ต้องตาม" — มาจาก pendingList / followUpList ตัวเดียวกับตัวเลขบนบรรทัด
     โชว์ไม่เกิน QUEUE_MAX คน ที่เหลือเป็นแถว "อีก N คน" */
  const QUEUE_MAX = 5;
  const studentById = new Map(allStudents.map((s) => [s.id, s]));
  const initialOf = (name: string) => (splitPersonName(name)[0].replace(/^(นศ|อ)\.\s*/, '').trim()[0] ?? '?');
  const moreRow = (n: number, onClick: () => void) => n > 0 && (
    <button className="todaykid todaykid--more" onClick={onClick}>{t('อีก {n} คน', { n })} ›</button>
  );
  const evalLine = todayLines.find((l) => l.key === 'eval');
  if (evalLine && today.pendingList.length) {
    evalLine.items = (
      <>
        {today.pendingList.slice(0, QUEUE_MAX).map((p) => {
          const st = studentById.get(p.studentId);
          if (!st) return null;
          const name = personName(st);
          return (
            <div key={p.studentId} className="todaykid">
              <span className="todaykid__av" aria-hidden>{initialOf(name)}</span>
              <div className="todaykid__who">
                <button className="todaykid__name" onClick={() => openStudent(st)}>{name}</button>
                <div className="todaykid__meta">
                  {!groupScope && `${groupShort(st.group)} · `}
                  {/* กิจกรรมเช็คอินเก็บตามที่เขียนไว้ ไม่ผ่าน t() (ดู domain/checkin.ts) */}
                  {p.activities.length ? p.activities.join(' · ') : t('{n} คาบ', { n: p.count })}
                </div>
              </div>
              <span className="todaykid__age">{p.oldestDays > 0 ? t('{n} วันก่อน', { n: p.oldestDays }) : t('วันนี้')}</span>
              <button className="todaykid__btn" onClick={() => navigate('/teacher/evaluate')}>{t('ประเมิน')}</button>
            </div>
          );
        })}
        {moreRow(today.pendingList.length - QUEUE_MAX, () => navigate('/teacher/evaluate'))}
      </>
    );
  }
  const riskLine = todayLines.find((l) => l.key === 'risk');
  if (riskLine && today.followUpList.length) {
    riskLine.items = (
      <>
        {today.followUpList.slice(0, QUEUE_MAX).map((f) => {
          const st = studentById.get(f.studentId);
          if (!st) return null;
          const name = personName(st);
          const top = f.stale[0];
          const key = top?.workId ?? f.studentId;
          return (
            <div key={f.studentId} className="todaykid">
              <span className="todaykid__av todaykid__av--warn" aria-hidden>{initialOf(name)}</span>
              <div className="todaykid__who">
                <button className="todaykid__name" onClick={() => openStudent(st)}>{name}</button>
                <div className="todaykid__meta">
                  {f.stale.length
                    ? f.stale.slice(0, 2).map((w) => (
                      <span key={w.workId} className="stalepill">
                        <i style={{ background: typeMeta(w.type).color }} />
                        {typeChipLabel(w.type)} · step {w.progression}
                      </span>
                    ))
                    : f.reason}
                </div>
              </div>
              {top && <span className="staledays staledays--pill">{top.days}<small>{t('วัน')}</small></span>}
              <button
                className="textbtn textbtn--icon"
                style={{ color: pinged[key] ? 'var(--success-dark)' : undefined }}
                title={pinged[key] ? t('เตือนแล้ว') : t('เตือน')}
                aria-label={pinged[key] ? t('เตือนแล้ว') : t('เตือน')}
                onClick={() => ping(key, name)}
              >
                {pinged[key] ? <Check size={15} weight="bold" /> : <BellRinging size={15} />}
              </button>
            </div>
          );
        })}
        {moreRow(today.followUpList.length - QUEUE_MAX, () => goToStudents(zoneGroup!.code))}
      </>
    );
  }

  const waitLine = todayLines.find((l) => l.key === 'wait');
  if (waitLine) {
    waitLine.items = (
      <>
        {today.waitingList.slice(0, QUEUE_MAX).map((w) => {
          const st = studentById.get(w.studentId);
          if (!st) return null;
          const name = personName(st);
          return (
            <div key={w.workId} className="todaykid todaykid--muted">
              <span className="todaykid__av todaykid__av--muted" aria-hidden>{initialOf(name)}</span>
              <div className="todaykid__who">
                <button className="todaykid__name" onClick={() => openStudent(st)}>{name}</button>
                <div className="todaykid__meta">
                  <span className="stalepill"><i style={{ background: typeMeta(w.type).color }} />{typeChipLabel(w.type)}</span>
                  {' '}{waitReasonLabel(w.reason)}
                </div>
              </div>
              <span className="todaykid__age">{w.until ? t('นัด {d}', { d: thaiShort(w.until) }) : t('ยังไม่มีนัด')}</span>
            </div>
          );
        })}
        {moreRow(today.waitingList.length - QUEUE_MAX, () => goToStudents(zoneGroup!.code))}
      </>
    );
  }

  const stepBuckets = useMemo(() => bottleneckByStep(works, settings, stepType), [works, settings, stepType]);
  const maxStepBucket = Math.max(1, ...stepBuckets.map((b) => b.count));
  const busiest = [...stepBuckets].sort((a, b) => b.count - a.count)[0] ?? { progression: 0, count: 0, label: '' };
  const shownStep = openStep === null ? (busiest.count > 0 ? busiest.progression : -1) : openStep;

  /* ── ลิ้นชัก "ตัวเลขนี้มาจากไหน" — เก็บแค่ว่าเปิดตัวเลขไหน แล้วสร้างเนื้อหาใหม่ทุกเรนเดอร์ (ข้อมูล sync เข้ามาระหว่างเปิดก็ตามทัน)
     ทุกรายการมาจาก domain/ ชุดเดียวกับตัวเลขบนหน้า (test:invariants "ลิ้นชักที่มาของตัวเลข") ── */
  type TraceKey =
    | { kind: 'group'; code: string }
    | { kind: 'pct' | 'req'; studentId: string }
    | { kind: 'step'; type: WorkType; step: number }
    | { kind: 'stale' };
  const [traceKey, setTraceKey] = useState<TraceKey | null>(null);
  const yearScopeLabel = yearView === 'all' ? t('ทั้งชั้นปี · รวมปี') : t('ทั้งชั้นปี · ปี {n}', { n: yearView });
  const stepText = (w: Workpiece) => (progression(w) < 0 ? t('ยังไม่เริ่ม') : `step ${progression(w)}/${maxProgression(w)}`);
  const reasonText: Record<NotCountedReason, string> = {
    off: t('ปิดสวิตช์นับเข้าเกณฑ์'),
    pending: t('รออาจารย์ตรวจรับว่าเข้าเกณฑ์'),
    type: t('ประเภทนี้ไม่เข้าเกณฑ์'),
  };
  const traceContent = ((): TraceContent | null => {
    if (!traceKey) return null;
    if (traceKey.kind === 'group') {
      const g = activeGroups.find((x) => x.code === traceKey.code) ?? groups.find((x) => x.code === traceKey.code);
      if (!g) return null;
      const list = [...g.students].sort((a, b) => a.percent - b.percent);
      return {
        eyebrow: t('กลุ่ม {g} · ปี {y}', { g: groupShort(g.code), y: g.year }),
        title: t('ความคืบหน้า {p}% มาจาก {n} คน', { p: g.percent, n: list.length }),
        body: (
          <>
            <div className="trace__rows">
              {list.map((x) => (
                <TraceRow
                  key={x.student.id}
                  color="var(--accent)"
                  main={personName(x.student)}
                  sub={x.student.code}
                  value={`${x.percent}%`}
                  onClick={() => setTraceKey({ kind: 'pct', studentId: x.student.id })}
                />
              ))}
            </div>
            <div className="trace__sum"><span>{t('เฉลี่ย {n} คน', { n: list.length })}</span><b>{g.percent}%</b></div>
          </>
        ),
        how: (
          <>
            <p>{t('เอา % ความคืบหน้าของแต่ละคน (แบบในตาราง) มาเฉลี่ย ทุกคนน้ำหนักเท่ากัน ไม่ว่าจะมีชิ้นงานกี่ชิ้น')}</p>
            <p>{t('กดชื่อเพื่อดูว่า % ของคนนั้นมาจากชิ้นงานไหน')}</p>
          </>
        ),
      };
    }
    if (traceKey.kind === 'pct' || traceKey.kind === 'req') {
      const st = studentById.get(traceKey.studentId);
      if (!st) return null;
      const mine = allWorks.filter((w) => w.studentId === st.id);
      const who = `${personName(st)} · ${st.code}`;
      if (traceKey.kind === 'pct') {
        const parts = percentParts(mine);
        return {
          eyebrow: `${who} · ${t('ความคืบหน้า')}`,
          title: t('{p}% มาจาก {n} ชิ้นงาน', { p: parts.average, n: parts.rows.length }),
          body: parts.rows.length ? (
            <>
              <div className="trace__rows">
                {parts.rows.map(({ workpiece: w, percent }) => (
                  <TraceRow
                    key={w.id}
                    color={typeMeta(w.type).color}
                    main={tText(w.detail)}
                    sub={`${typeChipLabel(w.type)} · ${stepText(w)}${isReturned(w) ? ` · ${t('คืนเคส')}` : ''}`}
                    value={`${percent}%`}
                    muted={isReturned(w)}
                  />
                ))}
              </div>
              <div className="trace__sum"><span>{t('เฉลี่ย {n} ชิ้น', { n: parts.rows.length })}</span><b>{parts.average}%</b></div>
            </>
          ) : <p className="trace__empty">{t('ยังไม่มีชิ้นงาน')}</p>,
          how: (
            <>
              <p>{t('แต่ละชิ้นคิดตามสูตรในชีตเดิม แล้วเฉลี่ยทุกชิ้นที่มี รวมชิ้นที่จบแล้วและที่คืนเคสแล้ว')}</p>
              <div className="trace__formula">{t('(ขั้นที่ถึง + 1) ÷ (ขั้นทั้งหมด + 1)')}</div>
              <ul>
                <li>{t('ชิ้นที่ยังไม่เริ่มนับเป็น 0%')}</li>
                <li>{t('ชิ้นที่อยู่ step 0 ได้มากกว่า 0% เพราะสูตรบวก 1')}</li>
              </ul>
            </>
          ),
        };
      }
      const s0 = activeSummaries.find((x) => x.student.id === st.id) ?? summaries.find((x) => x.student.id === st.id);
      const excluded = notCountedPieces(mine).filter((x) => !isReturned(x.workpiece));
      return {
        eyebrow: `${who} · ${t('เกณฑ์สะสม 2 ปี')}`,
        title: s0 ? t('{a} จาก {b} ช่อง', { a: s0.reqDone, b: s0.reqTotal }) : t('เกณฑ์สะสม 2 ปี'),
        body: (
          <>
            <RequirementSlots works={mine} settings={settings} />
            {excluded.length > 0 && (
              <div>
                <h4 className="trace__h4">{t('ชิ้นงานที่ไม่นับ · {n}', { n: excluded.length })}</h4>
                <div className="trace__rows">
                  {excluded.map(({ workpiece: w, reason }) => (
                    <TraceRow
                      key={w.id}
                      color={typeMeta(w.type).color}
                      main={tText(w.detail)}
                      sub={`${typeChipLabel(w.type)} · ${stepText(w)}`}
                      value={reasonText[reason]}
                      tone="warn"
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        ),
        how: (
          <ul>
            <li>{t('นับเฉพาะชิ้นที่จบขั้นสุดท้ายแล้ว')}</li>
            <li>{settings.pairCountsAsOne ? t('CD/RPD คู่บน-ล่างนับเป็น 1 เคส เมื่อจบทั้งคู่') : t('CD/RPD นับต่อ arch')}</li>
            <li>{t('ทำเกินช่องไม่ล้นไปเติมช่องอื่น')}</li>
            <li>{t('Crown/Bridge ต้องเป็น Post-core อย่างน้อย {n} ชิ้น', { n: settings.req.postCoreMin })}</li>
            <li>{t('ไม่นับ: ปิดสวิตช์นับเข้าเกณฑ์ · Simple APD · เคสที่คืนแล้ว')}</li>
            <li>{t('เคสที่ไม่นับเกณฑ์สะสม ก็ไม่นับเกณฑ์รายปี')}</li>
          </ul>
        ),
      };
    }
    if (traceKey.kind === 'step') {
      const list = worksAtStep(works, traceKey.type, traceKey.step);
      return {
        eyebrow: `${yearScopeLabel} · ${typeChipLabel(traceKey.type)}`,
        title: t('{n} ชิ้นงานอยู่ที่ step {s}', { n: list.length, s: traceKey.step }),
        body: (
          <div className="trace__rows">
            {list.map((w) => {
              const st = studentById.get(w.studentId);
              return (
                <TraceRow
                  key={w.id}
                  color={typeMeta(w.type).color}
                  main={st ? `${personName(st)} · ${groupShort(st.group)}` : w.studentId}
                  sub={tText(w.detail)}
                  value={t('{n} วัน', { n: daysSinceUpdate(w) })}
                  tone={isStale(w, settings) ? 'warn' : undefined}
                  onClick={st ? () => openStudent(st) : undefined}
                />
              );
            })}
          </div>
        ),
        how: (
          <>
            <p>{t('ชิ้นงานที่ยังทำอยู่ แยกตาม step ล่าสุดที่บันทึก · ตัวเลขขวาคือจำนวนวันที่ไม่มีการบันทึกใหม่')}</p>
            <p>{t('ไม่นับ: ชิ้นที่จบแล้ว · เคสที่คืนแล้ว')}</p>
          </>
        ),
      };
    }
    return {
      eyebrow: yearScopeLabel,
      title: t('{n} ชิ้นงานไม่ขยับ {d} วันขึ้นไป', { n: stale.length, d: settings.stale }),
      body: (
        <div className="trace__rows">
          {stale.map((r) => (
            <TraceRow
              key={r.workpiece.id}
              color={typeMeta(r.workpiece.type).color}
              main={`${personName(r.student)} · ${groupShort(r.student.group)}`}
              sub={`${tText(r.workpiece.detail)} · ${stepText(r.workpiece)}`}
              value={t('{n} วัน', { n: r.days })}
              tone="warn"
              onClick={() => openStudent(r.student)}
            />
          ))}
        </div>
      ),
      how: (
        <>
          <p>{t('ชิ้นงานที่ยังทำอยู่ และไม่มีการบันทึก step ใหม่ {d} วันขึ้นไป (ตั้งได้ในหน้าตั้งค่า)', { d: settings.stale })}</p>
          <p>{t('ไม่นับ: ชิ้นที่จบแล้ว · เคสที่คืนแล้ว')}</p>
        </>
      ),
    };
  })();

  /* หน้าแรกโชว์ 4 คนที่ความคืบหน้าน้อยสุด (ตารางเต็มอยู่หน้าสรุปกลุ่ม) · พิมพ์ค้นหา = ผลค้นหาทั้งหมด */
  const HOME_TABLE_ROWS = 4;
  const homeRows = query ? shownStudents : [...shownStudents].sort((a, b) => a.percent - b.percent).slice(0, HOME_TABLE_ROWS);

  /** ตารางนักศึกษา — ใช้ทั้งโซนกลุ่มบนหน้าแรกและหน้ารุ่นที่จบแล้ว */
  const renderStudentTable = (rows = shownStudents) => (
    <table className="tbl">
      <thead>
        <tr>
          <th>{t('นักศึกษา')}</th>
          {!isAlumniView && <th style={{ width: 130 }}>{t('ความคืบหน้า')}</th>}
          {/* 76px ทำหัวไทยตัดคำห้อยสองบรรทัด */}
          <th style={{ width: 94, whiteSpace: 'nowrap' }}>{t('เกณฑ์สะสม 2 ปี')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const [fn, ln] = splitPersonName(personName(s.student));
          return (
            <tr key={s.student.id}>
              <td>
                {/* ชื่อบรรทัดบน นามสกุลล่าง + กดแล้วไปหน้าตรวจงานรายคน */}
                <button
                  onClick={() => openStudent(s.student)}
                  title={t('ดูงานรายคน + คอมเมนต์')}
                  className="cellbtn"
                  style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                >
                  <div style={{ font: '600 12px/1.35 var(--font-body)', color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                    {fn}
                    {ln && <div style={{ fontWeight: 500 }}>{ln}</div>}
                  </div>
                </button>
                <div className="mono" style={{ font: '400 9.5px var(--font-mono)', color: 'var(--text-faint)' }}>
                  {s.student.code}
                  {/* งานค้างเหลือจุดแดงท้ายรหัส · ตัดคอลัมน์ "ชิ้นงาน" กับ "ค้าง" */}
                  {!isAlumniView && s.stale > 0 && (
                    <span className="staledot" title={t('งานค้างเกิน {d} วัน {n} ชิ้น', { d: settings.stale, n: s.stale })} aria-label={t('งานค้างเกิน {d} วัน {n} ชิ้น', { d: settings.stale, n: s.stale })} />
                  )}
                  {/* ผลค้นหามาจากหลายกลุ่ม — ต้องบอกว่าใครอยู่กลุ่มไหน ไม่งั้นกดต่อไม่ถูก */}
                  {query && ` · ${groupShort(s.student.group)}`}
                </div>
              </td>
              {!isAlumniView && (
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="bar" style={{ height: 6 }}>
                      <i style={{ width: `${s.percent}%`, background: 'var(--accent)' }} />
                    </span>
                    <button className="tracenum mono" style={{ font: '600 10.5px var(--font-mono)', color: 'var(--text-muted)' }} onClick={() => setTraceKey({ kind: 'pct', studentId: s.student.id })} aria-label={t('ที่มาของ {p}%', { p: s.percent })}>{s.percent}%</button>
                  </div>
                </td>
              )}
              <td>
                {isAlumniView ? (
                  /* รุ่นเก่าดูแค่เกณฑ์สะสม — ตรงกับตัวนับ "ครบเกณฑ์สะสม" ด้านบน (alumniOverview) */
                  <button className="tracenum mono" style={{ color: s.reqDone >= s.reqTotal ? 'var(--success-dark)' : 'var(--warning-dark)', fontWeight: 600 }} onClick={() => setTraceKey({ kind: 'req', studentId: s.student.id })}>
                    {s.reqDone >= s.reqTotal ? `${t('ครบ')} ` : ''}{s.reqDone}/{s.reqTotal}
                  </button>
                ) : (
                  <button className="tracenum mono" style={{ color: s.allComplete ? 'var(--success-dark)' : 'var(--text-secondary)', fontWeight: s.allComplete ? 600 : 500 }} onClick={() => setTraceKey({ kind: 'req', studentId: s.student.id })}>
                    {s.reqDone}/{s.reqTotal}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <TeacherShell active={alumniPage ? 'alumni' : 'overview'}>
      <main className="main">
        {isAlumniView ? (
          <ScopeHead
            scope="year"
            icon={Archive}
            title={t('รุ่นที่จบแล้ว')}
            /* บรรทัดเตือนของรุ่นที่จบแล้ว กันเข้าใจผิดว่าเป็นรุ่นที่ยังเรียนอยู่ */
            sub={t('ดูได้อย่างเดียว แก้ไขไม่ได้ · {a} คน · {b} กลุ่ม', { a: students.length, b: groups.length })}
            right={!alumniLoading && alumniCohorts.length > 0 && (
              <div className="seg seg--sm seg--tight" aria-label={t('เลือกรุ่น')}>
                {alumniCohorts.map((c) => (
                  <button key={c} data-on={(cohortPick ?? alumniCohorts[0]) === c} onClick={() => setCohortPick(c)}>{cohortLabel(c)}</button>
                ))}
              </div>
            )}
          />
        ) : (
          /* หน้าแรกเหลือชื่อหน้า — แท็บชั้นปีอยู่หัวโซน "ทั้งชั้นปี" เพราะมันคุมแค่ของในโซนนั้น */
          <ScopeHead scope="setup" icon={House} title={t('หน้าแรก')} />
        )}

        {yearView === 'alumni' && alumniLoading && (
          <div className="panel" style={{ display: 'grid', gap: 8, placeItems: 'center', padding: 26 }}>
            <div className="skel" style={{ width: 190, height: 13, borderRadius: 7 }} />
            <div className="skel" style={{ width: 250, height: 10, borderRadius: 5 }} />
            <span style={{ font: '500 11.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 4 }}>
              {t('กำลังเปิดข้อมูลรุ่นที่จบแล้ว…')}
            </span>
            <span style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
              {t('เปิดครั้งแรกครั้งเดียว ครั้งต่อไปเข้าได้ทันที')}
            </span>
          </div>
        )}

        {isAlumniView ? (
          <>
            {/* รุ่นที่จบแล้ว: ตัวเลขที่มีความหมายกับรุ่นเก่า
                เดิมใช้ชุดของรุ่นที่ยังเรียน → กำลังทำ/ค้าง/รอประเมิน เป็น 0 ทั้งแถว */}
            <div className="kpis kpis--strip">
              <div className="kpi">
                <div className="kpi__value">{alumni.students}</div>
                <div className="kpi__label">{t('นักศึกษา · {n} กลุ่ม', { n: groups.length })}</div>
              </div>
              <div className="kpi">
                <div className="kpi__value" style={{ color: alumni.students && alumni.reqComplete === alumni.students ? 'var(--success)' : undefined }}>
                  {alumni.reqComplete}<span className="kpi__of"> / {alumni.students}</span>
                </div>
                <div className="kpi__label">{t('ครบเกณฑ์สะสม')}</div>
              </div>
              <div className="kpi">
                <div className="kpi__value">{alumni.done}<span className="kpi__of"> / {alumni.total}</span></div>
                <div className="kpi__label">{t('ชิ้นงานที่จบ')}</div>
              </div>
              <div className="kpi">
                <div className="kpi__value" style={{ color: alumni.unfinished ? 'var(--warning)' : undefined }}>{alumni.unfinished}</div>
                <div className="kpi__label">{t('ชิ้นงานที่ไม่จบ (ไม่นับคืนเคส)')}</div>
              </div>
            </div>
            <div className="panel" ref={studentsRef} style={{ scrollMarginTop: 16 }}>
              <div className="tblhead">
                <h3>{t('นักศึกษา')}</h3>
                <select
                  className="tblhead__group"
                  value={selected?.code ?? ''}
                  onChange={(e) => { setGroup(e.target.value); setQuery(''); }}
                  aria-label={t('เลือกกลุ่ม')}
                >
                  {groups.map((g) => (
                    <option key={g.code} value={g.code}>{groupShort(g.code)}</option>
                  ))}
                </select>
                <input
                  className="tblhead__search"
                  type="search"
                  value={query}
                  placeholder={t('ค้นชื่อ/รหัส ทั้งรุ่น')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {query && <p className="sub">{t('ผลค้นหาทั้งรุ่น · {n} คน', { n: shownStudents.length })}</p>}
              {renderStudentTable()}
            </div>
          </>
        ) : (
          /* หน้าแรกแบ่งสองโซน — ซ้าย: กลุ่มที่ดูอยู่ (งานที่ต้องทำวันนี้ + ตารางนักศึกษา) · ขวา: ทั้งชั้นปี
             พื้นสองโซนใช้สีเดียวกับสองหมวดในแถบเมนูซ้าย ให้รู้ว่ากล่องไหนนับจากใคร */
          <div className="homezones">
            <section className="zone zone--group" aria-label={zoneGroup ? t('กลุ่ม {g}', { g: groupShort(zoneGroup.code) }) : t('กลุ่มที่ดูแล')}>
              <div className="zone__head">
                <span className="zone__ic" aria-hidden><Users size={18} weight="bold" /></span>
                <div className="zone__title">
                  <h2>
                    {zoneGroup
                      ? (zoneGroup.code === ownGroup ? t('กลุ่มของฉัน · {g}', { g: groupShort(zoneGroup.code) }) : t('กลุ่ม {g}', { g: groupShort(zoneGroup.code) }))
                      : t('กลุ่มที่ดูแล')}
                  </h2>
                  {zoneGroup && (
                    <small>
                      {t('ปี {y} · {n} คน · ความคืบหน้า', { y: zoneGroup.year, n: zoneGroup.students.length })}{' '}
                      <button className="tracenum" onClick={() => setTraceKey({ kind: 'group', code: zoneGroup.code })}>{zoneGroup.percent}%</button>
                    </small>
                  )}
                  <DataAge />
                </div>
                {/* ตัวเดียวกับตัวเลือกกลุ่มในแถบซ้าย (teacherGroup) — เดิมอยู่หัวตารางนักศึกษา */}
                <select
                  className="zone__select"
                  value={zoneGroup?.code ?? ''}
                  onChange={(e) => { setGroup(e.target.value); setQuery(''); }}
                  aria-label={t('เลือกกลุ่มที่ดู')}
                >
                  {zoneGroupCodes.map((code) => (
                    <option key={code} value={code}>
                      {groupShort(code)} · {t('ปี {n}', { n: activeGroups.find((g) => g.code === code)?.year ?? '' })}
                    </option>
                  ))}
                </select>
              </div>

              {/* นักศึกษาขอผูกบัญชี (0023) — ไม่มีคำขอ = ไม่แสดง · อยู่หน้าแรกเพราะอาจารย์ที่ปรึกษาเปิดหน้านี้ก่อนเสมอ */}
              <LinkRequestsPanel />

              <TodayCard
                name={me ? personName(me) : ''}
                summary={today}
                /* ยังไม่มีรายชื่อในเครื่อง (เครื่องใหม่กำลังซิงก์) = ยังไม่รู้ ห้ามขึ้น "ไม่มีอะไรน่าห่วง" */
                lines={activeStudents.length ? todayLines.slice(0, 3) : []}
              />

              <div className="panel" ref={studentsRef} style={{ scrollMarginTop: 16 }}>
                <div className="tblhead">
                  <h3>{zoneGroup ? t('นักศึกษาใน {g}', { g: groupShort(zoneGroup.code) }) : t('นักศึกษา')}</h3>
                  {!query && <span className="tblhead__hint">{t('เรียงจากช้าสุด')}</span>}
                  <input
                    className="tblhead__search"
                    type="search"
                    value={query}
                    placeholder={t('ค้นชื่อ/รหัส ทั้งรุ่น')}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {query && <p className="sub">{t('ผลค้นหาทั้งรุ่น · {n} คน', { n: shownStudents.length })}</p>}
                {renderStudentTable(homeRows)}
                {!query && zoneGroup && zoneGroup.students.length > HOME_TABLE_ROWS && (
                  <button className="homemore" onClick={() => { setGroup(zoneGroup.code); navigate('/teacher/group'); }}>
                    {t('ดูครบ {n} คนในสรุปกลุ่ม', { n: zoneGroup.students.length })} ›
                  </button>
                )}
              </div>
            </section>

            <section className="zone zone--year" aria-label={t('ทั้งชั้นปี')}>
              <div className="zone__head">
                <span className="zone__ic" aria-hidden><SquaresFour size={18} weight="fill" /></span>
                <div className="zone__title">
                  <h2>{t('ทั้งชั้นปี')}</h2>
                  <small>{t('{g} กลุ่ม · {n} คน', { g: groups.length, n: students.length })}</small>
                  <DataAge />
                </div>
                <YearSeg view={yearView} onChange={setYearView} />
              </div>

              {/* เรื่องระดับชั้นปีที่เคยอยู่ในกล่องวันนี้ (ตอนกด "ทั้งหมด") — ย้ายมาอยู่ในโซนของมัน */}
              {yearAlertLines.length > 0 && (
                <section className="panel yearalert" aria-label={t('ต้องดูในชั้นปี')}>
                  <h3>{t('ต้องดูในชั้นปี')}</h3>
                  <TodayLines lines={yearAlertLines} />
                </section>
              )}

              <div className="panel groupstrip" ref={stripRef}>
                {/* ช่องไม่มีกรอบ แถวละปี · ต่ำกว่า 55% เป็นช่องสีส้ม
                    กลุ่มที่อาจารย์ดูแลมีป้าย "กลุ่มคุณ" · กลุ่มที่เลือกดูอยู่มีกรอบบาง */}
                {(yearView === 'all' ? [5, 6] : [null]).map((yr) => {
                  const list = yr === null ? groups : groups.filter((g) => g.year === yr);
                  if (!list.length) return null;
                  return (
                    <div key={yr ?? 'one'} className={`grouprow${yr === null ? ' grouprow--single' : ''}`}>
                      {yr !== null && (
                        <div className="grouprow__label">
                          {t('ปี {n}', { n: yr })}
                          {list[0]?.students[0] && <small>{studentCohortLabel(list[0].students[0].student)}</small>}
                        </div>
                      )}
                      {list.map((g, gi) => {
                        const mine = g.code === ownGroup;
                        const advisors = advisorsOf(g.code);
                        const risk = groupRisk.get(g.code);
                        const follow = risk ? risk.high + risk.medium : 0;
                        const flagged = isFollowUpGroup(follow, g.students.length);
                        /* ตัวเลขอยู่ในกล่องเล็กตอนชี้เมาส์/จิ้ม · ช่องเหลือชื่อกลุ่ม + หลอด (% เคสในมือ)
                           กลุ่มที่ต้องตามตั้งแต่ ⅓ เป็นช่องแดงอิฐให้เห็นโดยไม่ต้องชี้ */
                        return (
                          /* ห่อด้วย div — ปุ่ม "ดูรายชื่อ" ในการ์ดต้องไม่อยู่ในปุ่มช่อง (ปุ่มซ้อนปุ่มใช้ไม่ได้) */
                          <div
                            key={g.code}
                            className={`groupcell groupcell--bar${flagged ? ' groupcell--follow' : ''}${mine ? ' groupcell--mine' : ''}${g.code === zoneGroup?.code ? ' groupcell--on' : ''}${peek === g.code ? ' groupcell--peek' : ''}`}
                            style={{ '--gi': gi, '--gr': yr === 6 ? 1 : 0 } as React.CSSProperties}
                          >
                            <button
                              className="groupcell__hit"
                              aria-pressed={g.code === zoneGroup?.code}
                              aria-label={`${groupShort(g.code)} · ${t('ต้องตาม {n}', { n: follow })} · ${t('เคสในมือไปได้เฉลี่ย {n}%', { n: g.percent })}`}
                              onClick={() => { setGroup(g.code); setPeek(g.code); }}
                            >
                              {mine && <span className="groupcell__mine">{t('กลุ่มคุณ')}</span>}
                              <span className="groupcell__code">{groupShort(g.code)}</span>
                              {/* ช่องสูงเผื่อหลอดตอนขยายไว้แล้ว — ชี้เมาส์แล้วแถว/การ์ดไม่ยืดหด */}
                              <span className="groupcell__slot" aria-hidden>
                                <span className="groupcell__bar"><i style={{ width: `${Math.max(0, Math.min(100, g.percent))}%` }} /><em>{g.percent}%</em></span>
                              </span>
                            </button>
                            <span className="groupcell__tip" role="tooltip">
                              <b>{groupShort(g.code)}</b>
                              {t('{n} คน', { n: g.students.length })}
                              {risk && risk.levels.length > 0 && (
                                <>
                                  <span className="groupcell__ppl">
                                    {risk.levels.map((lv, i) => <i key={i} data-risk={lv} style={{ '--k': i } as React.CSSProperties} />)}
                                  </span>
                                  <small>
                                    {t('ทัน {a}/{b}', { a: risk.ok, b: risk.levels.length })}
                                    {/* สองสี: แดง = ต้องตาม (เสี่ยงสูง + จับตา) */}
                                    {risk.high + risk.medium > 0 && ` · ${t('ต้องตาม {n}', { n: risk.high + risk.medium })}`}
                                  </small>
                                </>
                              )}
                              <small>{t('เคสในมือไปได้เฉลี่ย {n}%', { n: g.percent })}</small>
                              {advisors && <small>{advisors}</small>}
                              {/* จิ้ม/กดแล้วเท่านั้น (ชี้เมาส์เฉยๆ การ์ดดูอย่างเดียว) — พาไปตารางนักศึกษาของกลุ่มนี้ในโซนซ้าย */}
                              {peek === g.code && (
                                <>
                                  <button className="groupcell__go" onClick={() => goToStudents(g.code)}>{t('ดูรายชื่อ')} ›</button>
                                  <button className="groupcell__go" onClick={() => setTraceKey({ kind: 'group', code: g.code })}>{t('ที่มาของ {p}%', { p: g.percent })} ›</button>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* วงงานที่กำลังทำ · เลขจบเคสสะสมเป็นบรรทัดเล็กใต้วง */}
              <section className="panel donutpanel" aria-label={t('งานที่กำลังทำ')}>
                <TypeDonut
                  items={activeByType}
                  foot={t('จบแล้วปี {y} · {a} จาก {b} ชิ้น', { y: yearly.year, a: yearly.piecesDone, b: yearly.piecesGoal })}
                />
              </section>

              <div className="panel" ref={stepsRef} style={{ scrollMarginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <h3>{t('ชิ้นงานคงค้าง จำแนกตามขั้นงาน')}</h3>
                  </div>
                  <div className="seg seg--sm">
                    {typesPresent(works).map((ty) => (
                      <button key={ty} data-on={stepType === ty} onClick={() => { setStepType(ty); setOpenStep(null); }}>
                        {typeChipLabel(ty)}
                        {/* จำนวนชิ้นงานต่อประเภทอยู่ในแท็บเลย — ไม่ต้องมีการ์ดแยกอีกใบ */}
                        {/* นับเฉพาะงานที่ยังทำอยู่ ตรงกับผลรวมแท่งในกราฟ — เดิมนับรวมที่จบ/คืนแล้ว (132 กับแท่งรวม 75) */}
                        <b className="seg__count">{activeByType.find((x) => x.type === ty)?.count ?? 0}</b>
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
                          background: b.count === maxStepBucket && b.count > 0 ? 'var(--danger-chart)' : typeMeta(stepType).color,
                        }}
                      />
                      <span className="tick">{b.progression}</span>
                    </div>
                  ))}
                </div>

                {openStep !== null && openStep >= 0 && (
                  <div style={{ marginTop: 12 }}>
                    <StepInfo
                      progression={shownStep}
                      type={stepType}
                      meta={t('{n} ชิ้นงานกำลังอยู่ที่ step นี้', { n: stepBuckets[shownStep].count })}
                      onClose={() => setOpenStep(-1)}
                    />
                    {stepBuckets[shownStep].count > 0 && (
                      <button className="tracego" onClick={() => setTraceKey({ kind: 'step', type: stepType, step: shownStep })}>
                        {t('ดู {n} ชิ้นงานที่อยู่ step นี้', { n: stepBuckets[shownStep].count })} ›
                      </button>
                    )}
                  </div>
                )}
                <p className="pretty" style={{ margin: '12px 0 0', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-secondary)' }}>
                  <span>
                    {busiest.count > 0
                      ? t('กองมากสุด step {p} · {c} ชิ้น', { p: busiest.progression, c: busiest.count })
                      : t('ยังไม่มีชิ้นงานที่กำลังทำในประเภทนี้')}
                  </span>
                </p>
              </div>

              <div className="panel">
                <h3>{t('ชิ้นงานที่ไม่มีความเคลื่อนไหวนานที่สุด')}<span className="h3count"> · <button className="tracenum" onClick={() => setTraceKey({ kind: 'stale' })} aria-label={t('ดูทั้ง {n} ชิ้น', { n: stale.length })}>{stale.length}</button></span></h3>
                <table className="tbl">
                  <tbody>
                    {stale.slice(0, 5).map((r) => {
                      const cur = currentProc(r.workpiece);
                      const key = r.workpiece.id;
                      return (
                        <tr key={key}>
                          <td style={{ font: '600 11.5px var(--font-body)', width: 90 }}>
                            {personName(r.student)}
                            <span className="mono" style={{ display: 'block', font: '400 9px var(--font-mono)', color: 'var(--text-faint)' }}>
                              {groupShort(r.student.group)}
                            </span>
                          </td>
                          <td>
                            {/* ชื่องานยาวเหลือบรรทัดเดียว … ชื่อเต็มชี้ดูได้ */}
                            <div className="staledetail" title={tText(r.workpiece.detail)}>{tText(r.workpiece.detail)}</div>
                            {/* ป้ายสั้น "● Post-core · step 6" · ชื่อขั้นเต็มอยู่ใน title */}
                            <span className="stalepill" title={cur ? procLabel(r.workpiece.type, cur) : undefined}>
                              <i style={{ background: typeMeta(r.workpiece.type).color }} />
                              {typeChipLabel(r.workpiece.type)} · {cur ? `step ${cur.progression}` : t('ยังไม่เริ่ม')}
                            </span>
                          </td>
                          <td style={{ width: 64 }}>
                            <span className="staledays staledays--pill">{r.days}<small>{t('วัน')}</small></span>
                          </td>
                          <td style={{ width: 44 }}>
                            <button
                              className="textbtn textbtn--icon"
                              style={{ color: pinged[key] ? 'var(--success-dark)' : undefined }}
                              title={pinged[key] ? t('เตือนแล้ว') : t('เตือน')}
                              aria-label={pinged[key] ? t('เตือนแล้ว') : t('เตือน')}
                              onClick={() => ping(key, personName(r.student))}
                            >
                              {/* ไอคอนอย่างเดียว — คำว่า "เตือน" ซ้ำทุกแถว และจอแคบโดนตัดเหลือ "เตือ" */}
                              {pinged[key] ? <Check size={15} weight="bold" /> : <BellRinging size={15} />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        <TraceDrawer content={traceContent} onClose={() => setTraceKey(null)} />
      </main>
    </TeacherShell>
  );
}

/** ปีของกลุ่มอาจารย์ → แท็บเริ่มต้น · รับแค่ 5/6 นอกนั้นเป็น 'รวมปี' (ดู useYearView) */
