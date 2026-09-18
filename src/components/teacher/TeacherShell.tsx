import { Archive, ArrowUUpLeft, CaretDoubleLeft, ChartLineUp, ClipboardText, Eye, GearSix, IdentificationCard, ListChecks, SquaresFour, Table, Users, SealCheck} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { DemoBar } from '../DemoBar';
import { RoleFab } from '../RoleFab';
import { ToastView } from '../ToastView';
import { useAllCheckIns, useAllStudents, useGroups, useTeacher } from '../../hooks/data';
import { personName, t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import { noteSignOutOutcome, wipeLocalDataOnSignOut } from '../../data/localWipe';
import { cloudEnabled } from '../../lib/cloud';
import { AdvisorGroupsDialog, useAdvisorPrompt } from './AdvisorGroups';
import { resetAdvisorsIfNewYear } from '../../lib/advisors';
import { currentAdvisorIds } from '../../domain/group';
import { groupShort, sortGroupCodes } from '../../domain/group';
/* โลโก้ต้อง import ผ่าน bundler ไม่ใช่อ่านจาก public/ ตอนรัน
   เดิมเป็น `${BASE_URL}logo-mark.svg` = ไฟล์แยกที่ต้องวางข้าง index.html
   แต่ build:share ส่งออกไฟล์เดียว และ artifact host รับแค่ index.html
   รูปเลยขึ้นเป็น "?" ในลิงก์เดโมทุกครั้ง — ในเครื่อง dev ไม่เจอเพราะ public/ ถูกเสิร์ฟอยู่
   พอ import แบบนี้ assetsInlineLimit ของโหมด share จะฝังเป็น data URI ให้เอง ไม่ว่าไฟล์จะใหญ่แค่ไหน */
import logoMark from '../../assets/logo-mark.svg';
import { CLINIC_LAST_YEAR, CLINIC_START_YEAR, studentCohortLabel, studentYear } from '../../domain/cohort';

/** คีย์เมนู — ต้องตรงกันทุกหน้าเพื่อไม่ให้เมนูซ้ายเปลี่ยนไปมา */
export type TeacherNav = 'overview' | 'mygroup' | 'cohort' | 'evaluate' | 'sa' | 'sect2' | 'sect3' | 'exams' | 'settings' | 'roster' | 'alumni';

type NavItem = {
  key: TeacherNav; label: string; short?: string; to: string; Icon: typeof SquaresFour;
  /** เลขหัวข้อในสมุด portfolio เล่มจริง — ต่อท้ายชื่อเมนูเป็นตัวอ้างอิงกลับไปที่เล่ม */
  sect?: string;
};

/** งานประจำกลุ่ม — เกาะอยู่ใต้ตัวเลือกกลุ่ม */
const GROUP_NAV: NavItem[] = [
  // ตรวจงานรายคนยุบเป็นหน้าลูกของสรุปกลุ่ม (กดชื่อนักศึกษาในตาราง) — ไม่มีเมนูของตัวเอง
  { key: 'mygroup', label: t('สรุปกลุ่ม'), to: '/teacher/group', Icon: Users },
  { key: 'evaluate', label: t('ประเมินรายคาบ'), short: t('ประเมิน'), to: '/teacher/evaluate', Icon: Table, sect: 'I' },
  /* Section II กับ III แยกเป็นคนละเมนู
     เดิมรวมหน้าเดียวใช้แท็บ เพราะกลัวว่าเห็น "Section III" ลอยมาแล้วงงว่าเลขอื่นหายไปไหน
     พอติดเลขครบทั้งสามหัวข้อ เมนูก็เล่าตัวเองได้ว่าไม่มีเลขไหนหาย และไม่ต้องมีแท็บซ้อนข้างใน
     ชื่อย่อภาษาไทยตามหัวข้อจริงในสมุด (Patient examination and treatment planning /
     Knowledge and skill assessments) ซึ่งยาวเกินกว่าจะใส่เต็มในแถบ 214px */
  { key: 'sect2', label: t('แผนการรักษา'), short: t('แผนรักษา'), to: '/teacher/sect2', Icon: ClipboardText, sect: 'II' },
  { key: 'sect3', label: t('ความรู้และทักษะ'), short: t('ความรู้'), to: '/teacher/sect3', Icon: ListChecks, sect: 'III' },
  /* OSCE + สอบ RPD design ว่าทำเป็นแค่ช่องติ๊กพอ ไม่ต้องมีฟอร์ม
     ไม่ติดเลข section เพราะ OSCE อยู่หน้าแรกสุดของเล่ม ส่วนใบสอบ design อยู่ใน Section II
     ติดเลขจะยิ่งงงกว่าเดิม — ตรงนี้จึงเป็นหมวดของตัวเองว่า "การสอบ" */
  { key: 'exams', label: t('การสอบ'), short: t('สอบ'), to: '/teacher/exams', Icon: SealCheck },
  /* แบบประเมินตนเอง — อยู่ล่างสุดเพราะทำปีละครั้งตอนจบเทอม 1
     ไม่ใช่งานประจำเหมือนสามอันบน · ผลพลอยได้คือ Section I กับ II–III ได้อยู่ติดกันตามลำดับเล่ม */
  { key: 'sa', label: t('ประเมินตนเอง'), short: t('SA'), to: '/teacher/sa', Icon: ClipboardText },
];

/** เมนูตั้งค่าและจัดการข้อมูล — แยกหมวดของตัวเองในแถบซ้าย (ไม่ปนกับงานดูข้อมูลทั้งชั้นปี) */
const SETUP_KEYS: TeacherNav[] = ['settings', 'roster'];

/** ระดับชั้นปี */
const COHORT_NAV: NavItem[] = [
  { key: 'overview', label: t('ภาพรวม'), to: '/teacher', Icon: SquaresFour },
  { key: 'cohort', label: t('วิเคราะห์รวม'), short: t('วิเคราะห์'), to: '/teacher/analytics', Icon: ChartLineUp },
  { key: 'alumni', label: t('รุ่นที่จบแล้ว'), short: t('จบแล้ว'), to: '/teacher/alumni', Icon: Archive },
  /* ชื่อเมนู/หัวหน้าเป็น "ตั้งค่า" — หน้านี้มีทั้งเกณฑ์ · ระบบ · สำรองข้อมูล · PDPA แล้ว */
  { key: 'settings', label: t('ตั้งค่า'), short: t('ตั้งค่า'), to: '/teacher/settings', Icon: GearSix },
  /* รายชื่อ+นำเข้า: เฉพาะหัวหน้ารายวิชา — เมนูถูกซ่อนจากคนอื่น (canSeeRoster) และ Roster.tsx ตรวจซ้ำอีกชั้น */
  { key: 'roster', label: t('รายชื่อ & นำเข้า'), short: t('รายชื่อ'), to: '/teacher/roster', Icon: IdentificationCard },
];

/** ถามเรื่องกลุ่มที่ปรึกษาไปแล้วในการเปิดแอปครั้งนี้ — อยู่นอกคอมโพเนนต์เพราะเชลล์ถูกสร้างใหม่ทุกครั้งที่เปลี่ยนหน้า */
let advisorPromptShown = false;

/* แถบซ้ายพับเหลือไอคอน — จำไว้ในเครื่อง · ค่าเริ่มต้นกางไว้ (อ่านชื่อเมนูได้ทันที) */
const RAIL_KEY = 'pt-side-rail';
function readRail(): boolean {
  try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
}
let advisorResetTried = false;

export function TeacherShell({ active, children }: { active: TeacherNav; children: ReactNode }) {
  const navigate = useNavigate();
  const { session, signOut, teacherGroup, setTeacherGroup, myGroup, cloudUser } = useApp();
  // หน้า "รายชื่อ & นำเข้า" เปิดให้เฉพาะหัวหน้ารายวิชา — ไม่โชว์เมนูที่กดแล้วเจอทางตัน (โหมดเดโมเห็นได้ทุกคน)
  const canSeeRoster = !cloudEnabled || !!cloudUser?.isAdmin;
  // เปิดดูกลุ่มที่ไม่ใช่ของตัวเอง — ไม่ห้าม (อาจารย์เวรต้องข้ามกลุ่มได้) แต่ต้องรู้ตัวตลอดเวลา
  /* อาจารย์ดูแลได้หลายกลุ่ม — "กำลังดูกลุ่มอื่น" = ไม่อยู่ในกลุ่มไหนเลยที่ดูแล
     อ่านสดจากตาราง groups (ตัวที่กฎบนเซิร์ฟเวอร์ใช้) จึงอัปเดตทันทีหลังเลือก/ถอนตัว */
  const groupsAll = useGroups();
  const myGroups = session?.teacherId
    ? groupsAll.filter((g) => currentAdvisorIds(g).includes(session.teacherId)).map((g) => g.code)
    : [];
  const homeGroup = myGroup && myGroups.includes(myGroup) ? myGroup : myGroups[0] ?? myGroup;
  const offGroup = !!homeGroup && !myGroups.includes(teacherGroup) && teacherGroup !== homeGroup;
  /* อาจารย์ที่ปรึกษา (0024) — มีรุ่นที่กลุ่มยังไม่มีที่ปรึกษา และเรายังไม่ได้ดูแลกลุ่มไหนในรุ่นนั้น → ถามเอง
     เปิดครั้งเดียวต่อการเปิดแอป (ปิดแล้วไม่เด้งซ้ำตอนเปลี่ยนหน้า) · ตอบ "ไม่ได้เป็นที่ปรึกษา" = ไม่ถามรุ่นนั้นอีก */
  const needAdvisorPrompt = useAdvisorPrompt();
  const [advisorDialog, setAdvisorDialog] = useState<null | 'prompt' | 'manage'>(null);
  const [rail, setRail] = useState(readRail);
  const toggleRail = () => setRail((r) => {
    try { localStorage.setItem(RAIL_KEY, r ? '0' : '1'); } catch { /* โหมดส่วนตัว — จำไม่ได้ก็ไม่เป็นไร */ }
    return !r;
  });
  useEffect(() => {
    if (needAdvisorPrompt && !advisorPromptShown) {
      advisorPromptShown = true;
      setAdvisorDialog('prompt');
    }
  }, [needAdvisorPrompt]);
  // ขึ้นปีการศึกษาใหม่ → ล้างที่ปรึกษาของปีก่อน (ครั้งเดียวต่อการเปิดแอป · เซิร์ฟเวอร์ไม่ทำซ้ำถ้าล้างแล้ว)
  useEffect(() => {
    if (cloudEnabled && session?.teacherId && !advisorResetTried) {
      advisorResetTried = true;
      void resetAdvisorsIfNewYear();
    }
  }, [session?.teacherId]);
  const teacher = useTeacher(session?.teacherId);
  const students = useAllStudents();
  const checkins = useAllCheckIns();
  const groupById = new Map(students.map((st) => [st.id, st.group]));
  // งานค้างของอาจารย์ = นักศึกษาที่เช็คอินแล้วยังไม่ได้ประเมิน (นับเป็นคน — หน่วยที่อาจารย์คิด)
  const pendingEval = new Set(
    checkins
      .filter((c) => c.status === 'pending' && groupById.get(c.studentId) === teacherGroup)
      .map((c) => c.studentId),
  ).size;
  /* ปีของกลุ่ม = ชั้นปีของนักศึกษาในกลุ่มนั้น (คำนวณจากรุ่น) — ห้ามอ่านจากเลขในรหัสกลุ่ม
     เพราะรหัสใหม่คือ TH54-PT1 ที่ 54 = เลขรุ่น เดิมแปลเป็น "ปี 54" แล้วโชว์ "จบแล้ว" ทุกกลุ่ม
 */
  /**
   * ป้ายกลุ่มในตัวเลือก — ต้องแยกออกจากกันได้ทุกบรรทัด
   *
   * เดิมเขียนแค่ "PT1 · จบแล้ว" ทุกรุ่นที่จบ ผลคือในเดโมมี 27 บรรทัดที่ข้อความเหมือนกันเป๊ะ
   * (TH7-PT1 / TH8-PT1 / TH9-PT1 …) อาจารย์เลือกไม่ได้ว่าอันไหนรุ่นไหน
   * → รุ่นที่จบแล้วและรุ่นที่ยังไม่เริ่มต้องมีเลขรุ่นกำกับ
   *
   * และรุ่นที่รับรายชื่อไว้ล่วงหน้า (ยังไม่ถึง 1 มิ.ย.) ห้ามเขียน "ปี 4"
   * — หลักสูตรนี้ไม่มีปี 4 คนอ่านจะคิดว่าระบบคิดชั้นปีผิด
   */
  const labelOfGroup = (code: string): string => {
    const st = students.find((s) => s.group === code);
    if (!st) return '—';
    const y = studentYear(st);
    if (y > CLINIC_LAST_YEAR) return `${t('จบแล้ว')} ${studentCohortLabel(st)}`;
    if (y < CLINIC_START_YEAR) return `${t('ยังไม่เริ่ม')} ${studentCohortLabel(st)}`;
    return `${t('ปี')} ${y}`;
  };

  /* ตัวเรียงอยู่ใน domain/group.ts (sortGroupCodes) เพราะเป็นกฎ ไม่ใช่การจัดหน้า —
     และเทสต์ได้ตรง ๆ · เหตุผลว่าเรียงแบบนี้ทำไม อยู่ที่นั่น */
  const groupCodes = sortGroupCodes([...new Set(students.map((s) => s.group))], students);

  return (
    <div className="deskwrap">
      <DemoBar />
      <div className="window">
        <aside className={`side${rail ? ' side--rail' : ''}`}>
          <div className="side__logo">
            {/* logo-mark = ไอคอนแอปเวอร์ชันสำหรับขนาดเล็ก (พื้นน้ำเงิน เส้นขาวหนา)
                ตัวเต็ม icon.svg เส้นบางบนพื้นขาว พอย่อเหลือ 30px แทบมองไม่เห็น */}
            <img
              src={logoMark}
              alt=""
              width={30}
              height={30}
              style={{ borderRadius: 9, flex: 'none' }}
            />
            {/* ชื่อแอปฝั่งอาจารย์ — แก้ได้ทีเดียวที่นี่ถ้าภาคขอเปลี่ยน */}
            <b>Prosth Mahidol</b>
            <button
              className="side__railbtn"
              onClick={toggleRail}
              aria-expanded={!rail}
              aria-label={rail ? t('กางแถบเมนู') : t('พับแถบเมนู')}
              title={rail ? t('กางแถบเมนู') : t('พับแถบเมนู')}
            >
              <CaretDoubleLeft size={14} weight="bold" />
            </button>
          </div>

          {/* แถบซ้ายแบบ B
              กล่องขาวสองใบบนพื้นเทา: งานของกลุ่ม (หัวกล่องคือตัวเลือกกลุ่ม) · ดูทั้งชั้นปี
              ตั้งค่า & ข้อมูล แยกออกมาเป็นหมวดของตัวเอง ไม่ปนกับงานดูข้อมูล */}
          <div className="sidebox sidebox--group">
          <label className="mygroup">
            {/* ป้าย "กลุ่มที่ดูแล" ซ่อนจากจอ แต่โปรแกรมอ่านหน้าจอยังอ่านเป็นชื่อช่องเลือก */}
            <span className="mygroup__label sronly">{t('กลุ่มที่ดูแล')}</span>
            <select value={teacherGroup} onChange={(e) => setTeacherGroup(e.target.value)}>
              {groupCodes.map((code) => (
                /* ชั้นปีเกิน 6 = รุ่นที่เรียนจบไปแล้ว — เขียน "จบแล้ว" ไม่ใช่ "ปี 7" ซึ่งไม่มีจริง */
                <option key={code} value={code}>
                  {`${groupShort(code)} · ${labelOfGroup(code)}`}
                </option>
              ))}
            </select>
          </label>
          {/* พับแถบแล้วเหลือรหัสกลุ่ม · กดแล้วกางออกให้เลือกกลุ่ม */}
          <button className="side__railgroup" onClick={toggleRail} title={t('กลุ่มที่ดูแล')}>{groupShort(teacherGroup)}</button>
          {cloudEnabled && session?.teacherId && (
            <button className="linkbtn" onClick={() => setAdvisorDialog('manage')}
              style={{ margin: '-4px 0 8px 12px', font: '500 10.5px var(--font-body)', color: 'var(--accent)', textAlign: 'left' }}>
              {t('เลือกกลุ่มที่ปรึกษาของฉัน')}
            </button>
          )}

          <div className="side__cluster">
            {GROUP_NAV.map(({ key, label, short, to, Icon }) => (
              <NavLink key={key} to={to} className={key === active ? 'on' : undefined} title={rail ? label : undefined}>
                <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
                <span className="navlabel">{label}</span>
                <span className="navlabel--short">{short ?? label}</span>
                {/* เลข I / II / III ข้างเมนูตัดออก — ชื่อเมนูบอกอยู่แล้ว */}
                {key === 'evaluate' && pendingEval > 0 && (
                  <span className="count" title={t('นักศึกษา {n} คนรอประเมิน', { n: pendingEval })}>{pendingEval}</span>
                )}
              </NavLink>
            ))}
          </div>

          </div>

          <div className="sidebox">
            <div className="side__section">{t('ทั้งชั้นปี')}</div>
            {COHORT_NAV.filter((n) => !SETUP_KEYS.includes(n.key)).map(({ key, label, short, to, Icon }) => (
              <NavLink key={key} to={to} className={key === active ? 'on' : undefined} title={rail ? label : undefined}>
                <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
                <span className="navlabel">{label}</span>
                <span className="navlabel--short">{short ?? label}</span>
              </NavLink>
            ))}
          </div>
          <div className="side__section side__section--loose">{t('ตั้งค่า & ข้อมูล')}</div>
          {COHORT_NAV.filter((n) => SETUP_KEYS.includes(n.key) && (n.key !== 'roster' || canSeeRoster)).map(({ key, label, short, to, Icon }) => (
            <NavLink key={key} to={to} className={key === active ? 'on' : undefined} title={rail ? label : undefined}>
              <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
              <span className="navlabel">{label}</span>
              <span className="navlabel--short">{short ?? label}</span>
            </NavLink>
          ))}

          {/* กล่อง "ขนาดตัวหนังสือ" กับป้าย BETA ย้ายไปหน้าตั้งค่าแล้ว — แถบซ้ายเหลือชื่อ + ออกจากระบบ */}
          <div className="side__foot" style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
            <div className="card" style={{ padding: 12, boxShadow: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ font: '600 12.5px var(--font-head)' }}>{personName(teacher, 'อาจารย์')}</span>
              </div>
              {/* บรรทัด "อาจารย์ที่ปรึกษากลุ่ม · PT7" ตัดออก — ซ้ำกับกล่องกลุ่มด้านบน */}
              {/* เครื่องอาจารย์ถือข้อมูลทั้งชั้นปี 96 คน — ข้อนี้สำคัญกว่าฝั่งนักศึกษา
                  ล้างเฉพาะตอน sync ครบ · "ปิดแอป" ไม่เข้าทางนี้ (ASVS V14.3.1) */}
              <button
                onClick={async () => {
                  const res = await wipeLocalDataOnSignOut();
                  await signOut();
                  /* ห้ามใช้ showToast ที่นี่ — ToastView อยู่ข้างใน TeacherShell ตัวนี้เอง
                     พอ navigate ไป /login เชลล์ถูกถอด toast ตายไปพร้อมกัน
                     ข้อความจึงไม่มีทางถึงตาผู้ใช้ */
                  noteSignOutOutcome(res);
                  navigate('/login');
                }}
                className="linkbtn"
                style={{ marginTop: 4, font: '500 10.5px var(--font-body)', color: 'var(--text-faint)' }}
                title={cloudEnabled ? t('ล้างข้อมูลออกจากเครื่องนี้ด้วย (ถ้า sync ครบแล้ว) · ปิดแอปเฉย ๆ ไม่ล้าง') : undefined}
              >
                {t('ออกจากระบบ')}
              </button>
            </div>
          </div>
        </aside>

        {children}
      </div>
      {offGroup && (
        <div className="offgroup" role="status">
          <Eye size={15} weight="fill" style={{ flex: 'none' }} />
          <span>
            {t('กำลังดูกลุ่ม {other} — ไม่ใช่กลุ่มที่ปรึกษาของคุณ ({mine})', {
              other:groupShort(teacherGroup),
              mine: groupShort(homeGroup!),
            })}
            <b>{t(' · การเข้าดูถูกบันทึกไว้')}</b>
          </span>
          <button onClick={() => setTeacherGroup(homeGroup!)}>
            <ArrowUUpLeft size={13} weight="bold" />
            {t('กลับกลุ่มฉัน')}
          </button>
        </div>
      )}
      {advisorDialog && (
        <AdvisorGroupsDialog mode={advisorDialog} onClose={() => setAdvisorDialog(null)} />
      )}
      <ToastView variant="desk" />
      <RoleFab low />
    </div>
  );
}
