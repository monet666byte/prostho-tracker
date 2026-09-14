import { BellRinging, Check } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { TeacherShell, type TeacherNav } from '../../components/teacher/TeacherShell';
import { LinkRequestsPanel } from '../../components/teacher/LinkRequestsPanel';
import { StepInfo } from '../../components/StepInfo';
import { typeChipLabel, typeMeta, typesPresent } from '../../domain/catalog';
import { alumniOverview, cohortYearly, countByType, staleRows, summarizeAll, summarizeGroups } from '../../domain/aggregate';
import { bottleneckByStep } from '../../domain/analytics';
import { currentProc, procLabel, isActiveWork } from '../../domain/rules';
import type { WorkType } from '../../domain/types';
import { useAllCheckIns, useAllStudents, useAllWorkpieces } from '../../hooks/data';
import { useYearView, type YearView } from '../../hooks/useYearView';
import { YearSeg } from '../../components/teacher/YearSeg';
import { thaiShort } from '../../lib/date';
import { t, tText } from '../../lib/i18n';
import { alumniReady, ensureAlumniSeeded } from '../../data/seed';
import { useApp } from '../../store/app';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import type { Teacher } from '../../domain/types';
import { groupShort, groupYearOf, splitPersonName } from '../../domain/group';
import { cohortLabel, cohortOf, isActiveStudent, isAlumni, studentCohortLabel, studentYear } from '../../domain/cohort';

/** "2569/1" จากวันที่จริง — เทอม 1 มิ.ย.–ต.ค. · เทอม 2 พ.ย.–มี.ค. · ฤดูร้อน เม.ย.–พ.ค. */
function termLabel(d: Date): string {
  const m = d.getMonth(); // 0 = ม.ค.
  const term = m >= 5 && m <= 9 ? 1 : m >= 10 || m <= 2 ? 2 : 3;
  const be = d.getFullYear() + 543 - (m < 5 ? 1 : 0); // ก่อน มิ.ย. ยังเป็นปีการศึกษาก่อนหน้า
  return `${be}/${term}`;
}

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
  const allCheckIns = useMemo(() => everyCheckIn.filter((c) => stuIds.has(c.studentId)), [everyCheckIn, stuIds]);

  const group = useApp((st) => st.teacherGroup);
  const setGroup = useApp((st) => st.setTeacherGroup);
  const [stepType, setStepType] = useState<WorkType>('CB');
  // null = ยังไม่ได้เลือกเอง → เปิด step ที่กองมากสุดให้อัตโนมัติ · -1 = ผู้ใช้กดปิด
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [pinged, setPinged] = useState<Record<string, boolean>>({});

  const summaries = useMemo(() => summarizeAll(students, works, settings), [students, works, settings]);
  const groups = useMemo(() => summarizeGroups(summaries), [summaries]);
  const selected = groups.find((g) => g.code === group) ?? groups[0];
  const stale = useMemo(() => staleRows(students, works, settings), [students, works, settings]);
  const typeCounts = useMemo(() => countByType(works), [works]);
  const yearly = useMemo(() => cohortYearly(students, works, settings), [students, works, settings]);

  // แถวที่แสดงในตาราง: พิมพ์ค้นหา = มองข้ามกลุ่ม หาทั้งรุ่น · ไม่พิมพ์ = เฉพาะกลุ่มที่เลือก
  const shownStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return selected?.students ?? [];
    return summaries.filter((s) => `${s.student.name} ${s.student.code}`.toLowerCase().includes(q));
  }, [query, selected, summaries]);

  // รุ่นที่จบแล้วทั้งหมดในระบบ เรียงใหม่→เก่า ใช้ทำปุ่มเลือกรุ่น
  const alumniCohorts = useMemo(
    () => [...new Set(allStudents.filter((s) => isAlumni(s)).map((s) => cohortOf(s)))].sort((a, b) => b - a),
    [allStudents],
  );

  // รุ่นที่กำลังแสดงอยู่ (ตามตัวกรองชั้นปี) — โชว์เป็นป้ายข้างหัวเรื่อง
  const cohortsShown = useMemo(() => {
    const labels = [...new Set(students.map((s) => studentCohortLabel(s)))].sort().reverse();
    return labels.join(' · ');
  }, [students]);

  /* ชื่อที่ปรึกษาต่อกลุ่ม — อ่านจาก advisorIds ของนักศึกษาในกลุ่มนั้น */
  const teachersAll = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const advisorsOf = useMemo(() => {
    const byId = new Map(teachersAll.map((tc) => [tc.id, tc.name]));
    return (code: string) => {
      const ids = allStudents.find((st) => st.group === code)?.advisorIds ?? [];
      return [...new Set(ids)].map((id) => t(byId.get(id) ?? '')).filter(Boolean).join(' / ');
    };
  }, [teachersAll, allStudents]);

  const activePieces = works.filter(isActiveWork).length;
  const isAlumniView = yearView === 'alumni';
  const alumni = useMemo(() => alumniOverview(summaries, works), [summaries, works]);
  const pendingEval = new Set(allCheckIns.filter((c) => c.status === 'pending').map((c) => c.studentId)).size;
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
              {cohortsShown && !isAlumniView && <><span className="sronly"> · </span><span className="cohortchip">{cohortsShown}</span></>}
            </h1>
            <p>
              {/* ป้ายบอกว่ากำลังดูของเก่า — กันเข้าใจผิดว่าเป็นรุ่นที่ยังเรียนอยู่ · เดิมเป็นกล่องเหลือง ย้ายมาบรรทัดใต้หัวข้อ (14 ก.ย. 69) */}
              {isAlumniView
                ? t('ดูได้อย่างเดียว แก้ไขไม่ได้ · {a} คน · {b} กลุ่ม', { a: students.length, b: groups.length })
                : <>{t('{a} คน · {b} กลุ่ม', { a: students.length, b: groups.length })} · {thaiShort(new Date())} {t('{time} น.', { time: new Date().toTimeString().slice(0, 5) })}</>}
            </p>
          </div>
          {/* เดิมเป็นปุ่มตาย 2 อัน (ไม่มี handler): "ภาคเรียน 2569/1" ฝังปีตายตัว กับ "ส่งออก CSV"
              — ป้ายเทอมเปลี่ยนเป็นข้อความคำนวณจริง · ปุ่ม CSV เอาออกจนกว่าจะทำ export ฝั่งอาจารย์จริง */}
          {!alumniPage && <YearSeg view={yearView} onChange={setYearView} />}
          {isAlumniView ? (
            !alumniLoading && alumniCohorts.length > 0 && (
              <div className="seg seg--sm seg--tight" aria-label={t('เลือกรุ่น')}>
                {alumniCohorts.map((c) => (
                  <button key={c} data-on={(cohortPick ?? alumniCohorts[0]) === c} onClick={() => setCohortPick(c)}>{cohortLabel(c)}</button>
                ))}
              </div>
            )
          ) : (
            <span className="chip" style={{ height: 34, padding: '0 14px', font: '600 12px var(--font-body)', background: 'var(--fill)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center' }}>
              {t('ภาคเรียน')} {termLabel(new Date())}
            </span>
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
            <div className="kpis kpis--strip">
              <div className="kpi">
                <div className="kpi__value">
                  {activePieces}
                  <span className="kpi__of"> / {works.length}</span>
                </div>
                <div className="kpi__label">{t('ชิ้นงานที่กำลังทำ')}</div>
              </div>
              <div className="kpi">
                <div className="kpi__value" style={{ color: yearly.piecesDone >= yearly.piecesGoal ? 'var(--success)' : undefined }}>
                  {yearly.piecesDone}
                  <span className="kpi__of"> / {yearly.piecesGoal}</span>
                </div>
                <div className="kpi__label">{t('จบเคสสะสมปี')} {yearly.year}</div>
              </div>
              <div className="kpi">
                <div className="kpi__value" style={{ color: stale.length > 0 ? 'var(--danger)' : undefined }}>{stale.length}</div>
                <div className="kpi__label">
                  {t('เคสค้าง >')} {settings.stale} {t('วัน')} · {t('กระจายใน {n} กลุ่ม', { n: new Set(stale.map((s) => s.student.group)).size })}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi__value" style={{ color: pendingEval > 0 ? 'var(--warning)' : 'var(--success-dark)' }}>{pendingEval}</div>
                <div className="kpi__label">
                  {t('นักศึกษารอประเมิน')}
                  {pendingEval > 0 && <> · <button className="kpi__link" onClick={() => navigate('/teacher/evaluate')}>{t('ไปประเมิน')} ›</button></>}
                </div>
              </div>
            </div>
            )}

            {!isAlumniView && (<>
            <div className="homelabel tlabel">{t('กลุ่มคลินิก')} · {groups.length} {t('กลุ่ม')}</div>
            <div className="panel groupstrip">
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
                    {list.map((g) => {
                      const lagging = g.percent < 55;
                      const mine = g.code === ownGroup;
                      return (
                        <button
                          key={g.code}
                          className={`groupcell${lagging ? ' groupcell--low' : ''}${mine ? ' groupcell--mine' : ''}${g.code === group ? ' groupcell--on' : ''}`}
                          title={advisorsOf(g.code) ? `${t('อาจารย์ที่ปรึกษา')} ${advisorsOf(g.code)}` : undefined}
                          aria-pressed={g.code === group}
                          onClick={() => setGroup(g.code)}
                        >
                          {mine && <span className="groupcell__mine">{t('กลุ่มคุณ')}</span>}
                          <span className="groupcell__code">{groupShort(g.code)}</span>
                          <span className="groupcell__pct">{g.percent}%</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="grouplegend">
              <span><i className="groupcell--low" />{t('ต่ำกว่า 55%')}</span>
              {ownGroup && <span><i className="groupcell--mine" />{t('กลุ่มที่คุณดูแล')}</span>}
            </div>
            </>)}

            <div style={{ display: 'grid', gridTemplateColumns: isAlumniView ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))', gap: 16 }}>
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <div className="panel">
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
                <p className="sub">
                  {query
                    ? t('ผลค้นหาทั้งรุ่น · {n} คน', { n: shownStudents.length })
                    : <>
                        {/* เหลือแค่ที่ปรึกษา — รุ่น/ชั้นปี/จำนวนคน ซ้ำกับหัวเรื่องและ dropdown อยู่แล้ว
                            (ผู้ใช้ขอตัดออก 2 ก.ย.) */}
                        {advisorsOf(selected?.code ?? '')
                          ? <>{t('อาจารย์ที่ปรึกษา')} <b>{advisorsOf(selected?.code ?? '')}</b></>
                          : t('{n} คน', { n: selected?.students.length ?? 0 })}
                      </>}
                </p>
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
                            const [fn, ln] = splitPersonName(t(s.student.name));
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
                <h3>{t('ชิ้นงานที่ไม่มีความเคลื่อนไหวนานที่สุด')}</h3>
                <p className="sub">{t('ทั้งชั้นปี {n} ชิ้น', { n: stale.length })}{stale.length > 5 ? ` · ${t('แสดง 5 ชิ้นที่ค้างนานสุด')}` : ''}</p>
                <table className="tbl">
                  <tbody>
                    {stale.slice(0, 5).map((r) => {
                      const cur = currentProc(r.workpiece);
                      const key = r.workpiece.id;
                      return (
                        <tr key={key}>
                          <td style={{ font: '600 11.5px var(--font-body)', width: 90 }}>
                            {t(r.student.name)}
                            <span className="mono" style={{ display: 'block', font: '400 9px var(--font-mono)', color: 'var(--text-faint)' }}>
                              {groupShort(r.student.group)}
                            </span>
                          </td>
                          <td>
                            <div style={{ font: '500 11px var(--font-body)' }}>{tText(r.workpiece.detail)}</div>
                            <div className="mono" style={{ font: '400 9.5px var(--font-mono)', color: 'var(--text-faint)', marginTop: 1 }}>
                              {cur ? procLabel(r.workpiece.type, cur) : t('ยังไม่เริ่ม')}
                            </div>
                          </td>
                          <td style={{ width: 64 }}>
                            <span className="staledays">{r.days}<small>{t('วัน')}</small></span>
                          </td>
                          <td style={{ width: 72 }}>
                            <button
                              className="textbtn"
                              style={{ color: pinged[key] ? 'var(--success-dark)' : undefined }}
                              onClick={() => {
                                // ยังไม่มีช่องทางแจ้งเตือนจริง (push/LINE รอ phase 2) — toast ต้องไม่โกหก
                                // ว่าส่งแล้ว ไม่งั้นอาจารย์เข้าใจผิดว่าเด็กได้รับ (ตระกูลเดียวกับปุ่มส่งรายงานปลอมที่ตัดไป)
                                setPinged({ ...pinged, [key]: true });
                                showToast({ message: t('จดไว้แล้วว่าจะเตือน {n} — ระบบแจ้งเตือนจริงยังไม่เปิดใช้ ต้องบอกปากเปล่าก่อนนะครับ', { n: t(r.student.name) }), tone: 'warning' });
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
                <div className="panel">
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
                    <span>
                      {busiest.count > 0
                        ? t('งาน {s} กองอยู่ที่ step {p} มากที่สุด ({c} ชิ้น) — {l}', { s: typeMeta(stepType).short, p: busiest.progression, c: busiest.count, l: busiest.label })
                        : t('ยังไม่มีชิ้นงานที่กำลังทำในประเภทนี้')}
                      {' · '}{t('ดูวิเคราะห์เชิงลึกได้ที่เมนู “วิเคราะห์”')}
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
