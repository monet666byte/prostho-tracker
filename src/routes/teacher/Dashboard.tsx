import { BellRinging, Check } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { TeacherShell, type TeacherNav } from '../../components/teacher/TeacherShell';
import { LinkRequestsPanel } from '../../components/teacher/LinkRequestsPanel';
import { StepInfo } from '../../components/StepInfo';
import { TodayCard, type TodayLine } from '../../components/teacher/TodayCard';
import { TypeDonut } from '../../components/charts/TypeDonut';
import { todaySummary } from '../../domain/today';
import { typeChipLabel, typeMeta, typesPresent } from '../../domain/catalog';
import { alumniOverview, cohortYearly, countByType, staleRows, summarizeAll, summarizeGroups } from '../../domain/aggregate';
import { bottleneckByStep, riskByGroup, riskRows } from '../../domain/analytics';
import { currentProc, procLabel, isActiveWork } from '../../domain/rules';
import type { WorkType } from '../../domain/types';
import { useAllCheckIns, useAllProgressUpdates, useAllStudents, useAllWorkpieces, useTeacher } from '../../hooks/data';
import { useYearView, type YearView } from '../../hooks/useYearView';
import { YearSeg } from '../../components/teacher/YearSeg';
import { personName, t, tText } from '../../lib/i18n';
import { alumniReady, ensureAlumniSeeded } from '../../data/seed';
import { useApp } from '../../store/app';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import type { Teacher } from '../../domain/types';
import { groupShort, groupYearOf, splitPersonName } from '../../domain/group';
import { cohortLabel, cohortOf, isActiveStudent, isAlumni, studentCohortLabel, studentYear } from '../../domain/cohort';

/* อ้างอิงเดิมทุกเรนเดอร์ — `?? []` สร้างอาร์เรย์ใหม่ทุกครั้ง ทำให้ useMemo ที่พึ่งมันไม่ memo จริง */
const EMPTY_TEACHERS: Teacher[] = [];

export default function Dashboard() {
  const { settings, showToast } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get('tab') ?? 'overview';
  const view = 'overview' as TeacherNav; void raw;

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
        // ดูทีละรุ่นเสมอ — ยังไม่ได้เลือก = รุ่นที่เพิ่งจบล่าสุด (ผู้ใช้สั่ง 1 ก.ย.: ไม่เอา "ทุกรุ่น")
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
  const studentsRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const isAdmin = useApp((st) => !!st.cloudUser?.isAdmin);
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
  const typeCounts = useMemo(() => countByType(works), [works]);
  const yearly = useMemo(() => cohortYearly(students, works, settings), [students, works, settings]);

  // แถวที่แสดงในตาราง: พิมพ์ค้นหา = มองข้ามกลุ่ม หาทั้งรุ่น · ไม่พิมพ์ = เฉพาะกลุ่มที่เลือก
  const shownStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return selected?.students ?? [];
    return summaries.filter((s) => `${s.student.name} ${s.student.nameEn ?? ''} ${s.student.code}`.toLowerCase().includes(q));
  }, [query, selected, summaries]);

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

  /* สรุปวันนี้ (ผู้ใช้เลือก 15 ก.ย. 69) — หัวหน้ารายวิชา/ยังไม่มีกลุ่ม = ทั้งชั้นปีที่ดูอยู่ · ที่ปรึกษา = กลุ่มตัวเอง */
  /* ปุ่มสลับในกล่อง: [กลุ่ม PT7] [ทั้งชั้นปี/ปี 5/ปี 6] (ผู้ใช้เลือก A2 15 ก.ย. 69 — เดิมกดแท็บ "รวมปี" แล้วกล่องยังเป็น PT7 งง)
     ปุ่มกลุ่มมีเฉพาะเมื่อมีกลุ่มของตัวเอง · ค่าเริ่ม: ที่ปรึกษา = กลุ่ม · หัวหน้ารายวิชา = ทั้งชั้นปี */
  const hasOwnGroup = !!ownGroup && activeStudents.some((s) => s.group === ownGroup);
  const [scopePick, setScopePick] = useState<'group' | 'year' | null>(null);
  const groupScope = hasOwnGroup && (scopePick ?? (isAdmin ? 'year' : 'group')) === 'group';
  const session = useApp((st) => st.session);
  const me = useTeacher(session?.teacherId);
  const today = useMemo(() => {
    const scopeStudents = groupScope ? activeStudents.filter((s) => s.group === ownGroup) : students;
    return todaySummary({
      students: scopeStudents,
      works: allWorks,
      checkins: everyCheckIn,
      settings,
      risk: riskAll.map((r) => ({ studentId: r.student.id, risk: r.risk })),
      groups: groupScope ? undefined : groups,
    });
  }, [groupScope, activeStudents, ownGroup, students, allWorks, everyCheckIn, settings, riskAll, groups]);
  const groupName = (code: string, year: number) => (yearView === 'all' ? `${groupShort(code)} ${t('ปี {n}', { n: year })}` : groupShort(code));
  const todayLines: TodayLine[] = [];
  if (today.pendingPeople > 0) {
    todayLines.push({
      key: 'eval', tone: 'do', icon: 'eval',
      text: <>{t('รอประเมิน')} <b>{t('{n} คน', { n: today.pendingPeople })}</b> · {today.oldestPendingDays > 0 ? t('เก่าสุด {d} วันก่อน', { d: today.oldestPendingDays }) : t('วันนี้')}</>,
      go: { label: t('ไปประเมิน'), onClick: () => navigate('/teacher/evaluate') },
    });
  }
  if (groupScope) {
    if (today.highRisk > 0 || today.stale > 0) {
      todayLines.push({
        key: 'risk', tone: 'warn', icon: today.highRisk > 0 ? 'warn' : 'stale',
        text: today.highRisk > 0
          ? <>{t('เสี่ยงไม่ทันเกณฑ์')} <b>{t('{n} คน', { n: today.highRisk })}</b>{today.stale > 0 && <> · {t('งานค้างเกิน {d} วัน', { d: settings.stale })} {t('{n} ชิ้น', { n: today.stale })}</>}</>
          : <>{t('งานค้างเกิน {d} วัน', { d: settings.stale })} <b>{t('{n} ชิ้น', { n: today.stale })}</b></>,
        go: { label: t('ดูรายชื่อ'), onClick: () => goToStudents(ownGroup!) },
      });
    }
  } else {
    if (today.lowGroups.length > 0 || today.highRisk > 0) {
      const low = today.lowGroups;
      todayLines.push({
        key: 'low', tone: 'warn', icon: 'warn',
        text: low.length > 0
          ? <>{t('ต่ำกว่า 55%')}: <b>{low.slice(0, 3).map((g) => groupName(g.code, g.year)).join(' · ')}{low.length > 3 ? ` +${low.length - 3}` : ''}</b>{today.highRisk > 0 && <> · {t('เสี่ยงรวม {n} คน', { n: today.highRisk })}</>}</>
          : <>{t('เสี่ยงไม่ทันเกณฑ์')} <b>{t('{n} คน', { n: today.highRisk })}</b></>,
        go: low.length > 0
          ? { label: t('ดูกลุ่ม'), onClick: () => { scrollFlash(stripRef.current, 'center'); setGroup(low[0].code); setPeek(low[0].code); } }
          : undefined,
      });
    }
    if (today.stale > 0 && today.staleTop) {
      const top = today.staleTop;
      todayLines.push({
        key: 'stale', tone: 'warn', icon: 'stale',
        text: <>{t('งานค้างเกิน {d} วัน', { d: settings.stale })} <b>{t('{n} ชิ้น', { n: today.stale })}</b> · {t('ส่วนใหญ่ติด step {n}', { n: top.progression })}</>,
        go: { label: t('ดูในกราฟ'), onClick: () => { setStepType(top.type); setOpenStep(top.progression); scrollFlash(stepsRef.current, 'center'); } },
      });
    }
  }
  if (!today.needsAttention) {
    todayLines.unshift({ key: 'calm', tone: 'good', icon: 'good', text: t('วันนี้ไม่มีอะไรน่าห่วง') });
  }
  if (today.doneThisWeek > 0 && todayLines.length < 3) {
    todayLines.push({ key: 'done', tone: 'good', icon: 'good', text: <>{t('สัปดาห์นี้จบเคส')} <b>{t('{n} ชิ้น', { n: today.doneThisWeek })}</b></> });
  }
  // "ทั้งหมด" ไม่ใช่ "ปี 5" — ไม่ซ้ำกับแท็บปีด้านบน (ผู้ใช้เลือกข้อ 3) · ขอบเขตจริงยังตามแท็บปีเหมือนเดิม
  const yearScopeLabel = t('ทั้งหมด');
  const stepBuckets = useMemo(() => bottleneckByStep(works, settings, stepType), [works, settings, stepType]);
  const maxStepBucket = Math.max(1, ...stepBuckets.map((b) => b.count));
  const busiest = [...stepBuckets].sort((a, b) => b.count - a.count)[0] ?? { progression: 0, count: 0, label: '' };
  const shownStep = openStep === null ? (busiest.count > 0 ? busiest.progression : -1) : openStep;




  return (
    <TeacherShell active={alumniPage ? 'alumni' : view}>
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>
              {yearView === 'all' ? t('ภาพรวมทุกชั้นปี')
                : yearView === 'alumni' ? t('รุ่นที่จบแล้ว')
                  : `${t('ภาพรวมชั้นปีที่')} ${yearView}`}
              {/* เลขรุ่นติดหัวเรื่อง — ภาคคุยกันด้วยเลขรุ่น เห็นได้ทุกโหมด ไม่ใช่แค่ "รวมปี" */}
              {/* ตัวคั่นที่มองไม่เห็น — ช่องว่างบนจอมาจาก margin ของชิป แต่โปรแกรมอ่านหน้าจออ่านข้อความติดกัน
                  เป็น "ภาพรวมทุกชั้นปีDTMU55" (เจอตอนไล่ใช้จริง 13 ก.ย. 69) · หน้าตาบนจอไม่เปลี่ยน */}
            </h1>
            {/* หัวหน้าเหลือชื่อหน้า + แท็บปี (ผู้ใช้เลือกข้อ 2 · 15 ก.ย. 69 — ตัดเลขรุ่น · จำนวนคน/กลุ่ม · เวลา · ภาคเรียน)
                เหลือบรรทัดเตือนของรุ่นที่จบแล้วอย่างเดียว กันเข้าใจผิดว่าเป็นรุ่นที่ยังเรียนอยู่ */}
            {isAlumniView && <p>{t('ดูได้อย่างเดียว แก้ไขไม่ได้ · {a} คน · {b} กลุ่ม', { a: students.length, b: groups.length })}</p>}
          </div>
          {/* เดิมเป็นปุ่มตาย 2 อัน (ไม่มี handler): "ภาคเรียน 2569/1" ฝังปีตายตัว กับ "ส่งออก CSV"
              — ป้ายเทอมเปลี่ยนเป็นข้อความคำนวณจริง · ปุ่ม CSV เอาออกจนกว่าจะทำ export ฝั่งอาจารย์จริง */}
          {!alumniPage && <YearSeg view={yearView} onChange={setYearView} />}
          {isAlumniView && !alumniLoading && alumniCohorts.length > 0 && (
            <div className="seg seg--sm seg--tight" aria-label={t('เลือกรุ่น')}>
              {alumniCohorts.map((c) => (
                <button key={c} data-on={(cohortPick ?? alumniCohorts[0]) === c} onClick={() => setCohortPick(c)}>{cohortLabel(c)}</button>
              ))}
            </div>
          )}
        </div>

        {/* นักศึกษาขอผูกบัญชี (0023) — ไม่มีคำขอ = ไม่แสดง · อยู่หน้าแรกเพราะอาจารย์ที่ปรึกษาเปิดหน้านี้ก่อนเสมอ */}
        {!alumniPage && <LinkRequestsPanel />}

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

        {view === 'overview' && (
          <>
            {/* หน้าภาพรวมแบบ "ตัดของซ้ำ" (ผู้ใช้เลือก mock 14 ก.ย. 69) — ตัวเลขใหญ่ 4 ตัวอยู่การ์ดเดียวคั่นเส้น ตัดไอคอน */}
            {isAlumniView ? (
              /* รุ่นที่จบแล้ว: ตัวเลขที่มีความหมายกับรุ่นเก่า (ผู้ใช้เลือก mock 14 ก.ย. 69)
                 เดิมใช้ชุดของรุ่นที่ยังเรียน → กำลังทำ/ค้าง/รอประเมิน เป็น 0 ทั้งแถว */
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
            ) : (
            <div className="todayrow">
              <TodayCard
                name={me ? personName(me) : ''}
                summary={today}
                /* ยังไม่มีรายชื่อในเครื่อง (เครื่องใหม่กำลังซิงก์) = ยังไม่รู้ ห้ามขึ้น "ไม่มีอะไรน่าห่วง" */
                lines={activeStudents.length ? todayLines.slice(0, 3) : []}
                scopes={hasOwnGroup ? [
                  { key: 'group', label: groupShort(ownGroup!), on: groupScope, onPick: () => setScopePick('group') },
                  { key: 'year', label: yearScopeLabel, on: !groupScope, onPick: () => setScopePick('year') },
                ] : [{ key: 'year', label: yearScopeLabel, on: true }]}
              />
              {/* วงงานที่กำลังทำแทนกล่องตัวเลข 4 ตัวเดิม · เลขจบเคสสะสมย้ายมาเป็นบรรทัดเล็กใต้วง (ผู้ใช้ตกลง 15 ก.ย. 69) */}
              {/* ไม่มีหัวข้อแยก — ชื่ออยู่กลางวง · วงเล็กลงให้สูงเท่ากล่องสรุป ไม่เหลือที่โล่ง (ผู้ใช้หงุดหงิดช่องว่าง 15 ก.ย. 69) */}
              <section className="panel donutpanel" aria-label={t('งานที่กำลังทำ')}>
                <TypeDonut
                  items={activeByType}
                  foot={t('จบแล้วปี {y} · {a} จาก {b} ชิ้น', { y: yearly.year, a: yearly.piecesDone, b: yearly.piecesGoal })}
                />
              </section>
            </div>
            )}

            {!isAlumniView && (<>
            <div className="panel groupstrip" ref={stripRef}>
              {/* เดิม 24 กล่องขอบหนา มีหลอดทุกใบ → ช่องไม่มีกรอบ แถวละปี · ต่ำกว่า 55% เป็นช่องสีส้ม (เดิมแค่เปลี่ยนสีตัวเลข ตามองข้าม)
                  กลุ่มที่อาจารย์ดูแลมีป้าย "กลุ่มคุณ" (ผู้ใช้ขอให้ชัด 14 ก.ย.) · กลุ่มที่เลือกดูอยู่มีกรอบบาง */}
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
                      const lagging = g.percent < 55;
                      const mine = g.code === ownGroup;
                      const advisors = advisorsOf(g.code);
                      const risk = groupRisk.get(g.code);
                      /* ตัวเลข % อยู่ในกล่องเล็กตอนชี้เมาส์/จิ้ม (ผู้ใช้เลือก 15 ก.ย. 69 — "ตัวเลขเต็มไปหมด")
                         ช่องเหลือชื่อกลุ่ม + หลอด · ต่ำกว่า 55% ยังเป็นช่องส้มให้เห็นโดยไม่ต้องชี้ */
                      return (
                        /* ห่อด้วย div — ปุ่ม "ดูรายชื่อ" ในการ์ดต้องไม่อยู่ในปุ่มช่อง (ปุ่มซ้อนปุ่มใช้ไม่ได้) */
                        <div
                          key={g.code}
                          className={`groupcell groupcell--bar${lagging ? ' groupcell--low' : ''}${mine ? ' groupcell--mine' : ''}${g.code === group ? ' groupcell--on' : ''}${peek === g.code ? ' groupcell--peek' : ''}`}
                          style={{ '--gi': gi, '--gr': yr === 6 ? 1 : 0 } as React.CSSProperties}
                        >
                          <button
                            className="groupcell__hit"
                            aria-pressed={g.code === group}
                            aria-label={`${groupShort(g.code)} ${g.percent}%`}
                            onClick={() => { setGroup(g.code); setPeek(g.code); }}
                          >
                            {mine && <span className="groupcell__mine">{t('กลุ่มคุณ')}</span>}
                            <span className="groupcell__code">{groupShort(g.code)}</span>
                            {/* ช่องสูงเผื่อหลอดตอนขยายไว้แล้ว — ชี้เมาส์แล้วแถว/การ์ดไม่ยืดหด (ผู้ใช้ขอ 15 ก.ย. 69) */}
                            <span className="groupcell__slot" aria-hidden>
                              <span className="groupcell__bar"><i style={{ width: `${Math.max(0, Math.min(100, g.percent))}%` }} /><em>{g.percent}%</em></span>
                            </span>
                          </button>
                          <span className="groupcell__tip" role="tooltip">
                            <b>{g.percent}%</b>
                            {groupShort(g.code)} · {t('{n} คน', { n: g.students.length })}
                            {lagging && <em>{t('ต่ำกว่า 55%')}</em>}
                            {risk && risk.levels.length > 0 && (
                              <>
                                <span className="groupcell__ppl">
                                  {risk.levels.map((lv, i) => <i key={i} data-risk={lv} style={{ '--k': i } as React.CSSProperties} />)}
                                </span>
                                <small>
                                  {t('ทัน {a}/{b}', { a: risk.ok, b: risk.levels.length })}
                                  {risk.high > 0 && ` · ${t('เสี่ยง {n}', { n: risk.high })}`}
                                  {risk.medium > 0 && ` · ${t('จับตา {n}', { n: risk.medium })}`}
                                </small>
                              </>
                            )}
                            {advisors && <small>{advisors}</small>}
                            {/* จิ้ม/กดแล้วเท่านั้น (ชี้เมาส์เฉยๆ การ์ดดูอย่างเดียว) — พาลงไปตารางนักศึกษาของกลุ่มนี้ (ผู้ใช้เลือก 15 ก.ย. 69) */}
                            {peek === g.code && (
                              <button className="groupcell__go" onClick={() => goToStudents(g.code)}>{t('ดูรายชื่อ')} ›</button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            </>)}

            <div style={{ display: 'grid', gridTemplateColumns: isAlumniView ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))', gap: 16 }}>
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <div className="panel" ref={studentsRef} style={{ scrollMarginTop: 16 }}>
                {/* เลือกกลุ่มได้จากในการ์ดนี้เลย ไม่ต้องเลื่อนขึ้นไปกดการ์ดกลุ่มด้านบน
                    + ค้นหาข้ามทุกกลุ่มในรุ่น (ผู้ใช้ขอ 1 ก.ย.: หาคนที่อยู่กลุ่มอื่นไม่เจอ) */}
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
                {/* ชื่อที่ปรึกษาใต้หัวตารางตัดออก — ชี้การ์ดกลุ่มก็เห็น (ผู้ใช้ขอตัดตัวเทา 15 ก.ย. 69) · เหลือบอกผลค้นหาทั้งรุ่น */}
                {query && <p className="sub">{t('ผลค้นหาทั้งรุ่น · {n} คน', { n: shownStudents.length })}</p>}
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('นักศึกษา')}</th>
                      {!isAlumniView && <th style={{ width: 130 }}>{t('ความคืบหน้า')}</th>}
                      <th style={{ width: 56 }}>{t('ชิ้นงาน')}</th>
                      {/* 76px ทำหัวไทยตัดคำห้อยสองบรรทัด (สกรีนช็อตผู้ใช้ 1 ก.ย.) */}
                      <th style={{ width: 94, whiteSpace: 'nowrap' }}>{t('เกณฑ์สะสม 2 ปี')}</th>
                      {!isAlumniView && <th style={{ width: 46 }}>{t('ค้าง')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shownStudents.map((s) => (
                      <tr key={s.student.id}>
                        <td>
                          {/* ชื่อบรรทัดบน นามสกุลล่าง + กดแล้วไปหน้าตรวจงานรายคน (ผู้ใช้ขอ 2 ก.ย.) */}
                          {(() => {
                            const [fn, ln] = splitPersonName(personName(s.student));
                            return (
                              <button
                                onClick={() => { setGroup(s.student.group); navigate(`/teacher/review?student=${s.student.id}`); }}
                                title={t('ดูงานรายคน + คอมเมนต์')}
                                className="cellbtn"
                          style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                              >
                                <div style={{ font: '600 12px/1.35 var(--font-body)', color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                                  {fn}
                                  {ln && <div style={{ fontWeight: 500 }}>{ln}</div>}
                                </div>
                              </button>
                            );
                          })()}
                          <div className="mono" style={{ font: '400 9.5px var(--font-mono)', color: 'var(--text-faint)' }}>
                            {s.student.code}
                            {/* ผลค้นหามาจากหลายกลุ่ม — ต้องบอกว่าใครอยู่กลุ่มไหน ไม่งั้นกดต่อไม่ถูก */}
                            {query && ` · ${groupShort(s.student.group)}`}
                          </div>
                        </td>
                        {!isAlumniView && <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span className="bar" style={{ height: 6 }}>
                              <i style={{ width: `${s.percent}%`, background: 'var(--accent)' }} />
                            </span>
                            <span className="mono" style={{ font: '600 10.5px var(--font-mono)', color: 'var(--text-muted)' }}>{s.percent}%</span>
                          </div>
                        </td>}
                        <td className="mono">{s.pieces}</td>
                        <td>
                          {isAlumniView ? (
                            /* รุ่นเก่าดูแค่เกณฑ์สะสม — ตรงกับตัวนับ "ครบเกณฑ์สะสม" ด้านบน (alumniOverview) */
                            <span className="mono" style={{ color: s.reqDone >= s.reqTotal ? 'var(--success-dark)' : 'var(--warning-dark)', fontWeight: 600 }}>
                              {s.reqDone >= s.reqTotal ? `${t('ครบ')} ` : ''}{s.reqDone}/{s.reqTotal}
                            </span>
                          ) : (
                          <span className="mono" style={{ color: s.allComplete ? 'var(--success-dark)' : 'var(--text-secondary)', fontWeight: s.allComplete ? 600 : 500 }}>
                            {s.reqDone}/{s.reqTotal}
                          </span>
                          )}
                        </td>
                        {!isAlumniView && <td>
                          {s.stale > 0 ? (
                            <span className="mono" style={{ color: 'var(--danger)', fontWeight: 600 }}>{s.stale}</span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              </div>

              {/* รุ่นที่จบไม่มีงานค้าง/คอขวด — สองการ์ดนี้ว่างทุกครั้ง จึงไม่แสดง (14 ก.ย. 69) */}
              {!isAlumniView && (
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <div className="panel">
                <h3>{t('ชิ้นงานที่ไม่มีความเคลื่อนไหวนานที่สุด')}<span className="h3count"> · {stale.length}</span></h3>
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
                            {/* ชื่องานยาวเหลือบรรทัดเดียว … ชื่อเต็มชี้ดูได้ (ผู้ใช้เลือกข้อ 7) */}
                            <div className="staledetail" title={tText(r.workpiece.detail)}>{tText(r.workpiece.detail)}</div>
                            {/* รหัสขั้นยาวตัวพิมพ์ดีดเหลือป้ายสั้น "● Post-core · step 6" · ชื่อขั้นเต็มอยู่ใน title (ผู้ใช้เลือก B2 15 ก.ย. 69) */}
                            <span className="stalepill" title={cur ? procLabel(r.workpiece.type, cur) : undefined}>
                              <i style={{ background: typeMeta(r.workpiece.type).color }} />
                              {typeChipLabel(r.workpiece.type)} · {cur ? `step ${cur.progression}` : t('ยังไม่เริ่ม')}
                            </span>
                          </td>
                          <td style={{ width: 64 }}>
                            <span className="staledays staledays--pill">{r.days}<small>{t('วัน')}</small></span>
                          </td>
                          <td style={{ width: 72 }}>
                            <button
                              className="textbtn"
                              style={{ color: pinged[key] ? 'var(--success-dark)' : undefined }}
                              onClick={() => {
                                // ยังไม่มีช่องทางแจ้งเตือนจริง (push/LINE รอ phase 2) — toast ต้องไม่โกหก
                                // ว่าส่งแล้ว ไม่งั้นอาจารย์เข้าใจผิดว่าเด็กได้รับ (ตระกูลเดียวกับปุ่มส่งรายงานปลอมที่ตัดไป)
                                setPinged({ ...pinged, [key]: true });
                                showToast({ message: t('จดไว้แล้วว่าจะเตือน {n} — ระบบแจ้งเตือนจริงยังไม่เปิดใช้ ต้องบอกปากเปล่าก่อนนะครับ', { n: personName(r.student) }), tone: 'warning' });
                              }}
                            >
                              {/* จอแคบเหลือแต่ไอคอน — วัดจริงบน iPhone แล้วคำว่า "เตือน" ถูกตัดเหลือ "เตือ"
                                  เพราะตารางกว้างเกินกรอบไป 2px แล้วคอลัมน์สุดท้ายโดนเบียด */}
                              {pinged[key]
                                ? <><Check size={13} weight="bold" /> <span className="hidenarrow">{t('เตือนแล้ว')}</span></>
                                : <><BellRinging size={13} /> <span className="hidenarrow">{t('เตือน')}</span></>}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
                <div className="panel" ref={stepsRef} style={{ scrollMarginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <h3>{t('ชิ้นงานคงค้าง จำแนกตามขั้นงาน')}</h3>
                    </div>
                    <div className="seg seg--sm">
                      {typesPresent(works).map((ty) => (
                        <button key={ty} data-on={stepType === ty} onClick={() => { setStepType(ty); setOpenStep(null); }}>
                          {typeChipLabel(ty)}
                          {/* จำนวนชิ้นงานต่อประเภทอยู่ในแท็บเลย — ไม่ต้องมีการ์ดแยกอีกใบ */}
                          <b className="seg__count">{typeCounts.find((x) => x.type === ty)?.count ?? 0}</b>
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
                    </div>
                  )}
                  <p className="pretty" style={{ margin: '12px 0 0', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-secondary)' }}>
                    {/* ประโยคยาวเหลือบรรทัดสั้น (ตัดตัวเทา 16 ก.ย. 69) */}
                    <span>
                      {busiest.count > 0
                        ? t('กองมากสุด step {p} · {c} ชิ้น', { p: busiest.progression, c: busiest.count })
                        : t('ยังไม่มีชิ้นงานที่กำลังทำในประเภทนี้')}
                    </span>
                  </p>
                </div>
              </div>
              )}
            </div>
          </>
        )}

      </main>
    </TeacherShell>
  );
}

/** ปีของกลุ่มอาจารย์ → แท็บเริ่มต้น · รับแค่ 5/6 นอกนั้นเป็น 'รวมปี' (ดู useYearView) */
function defaultYearView(year: number | undefined): YearView {
  return year === 5 ? '5' : year === 6 ? '6' : 'all';
}
