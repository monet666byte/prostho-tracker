import { Archive, ArrowUUpLeft, ChartLineUp, ClipboardText, Eye, GearSix, IdentificationCard, ListChecks, SquaresFour, Table, Users, SealCheck} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { DemoBar } from '../DemoBar';
import { RoleFab } from '../RoleFab';
import { ToastView } from '../ToastView';
import { TextSizeControl } from '../TextSize';
import { useAllCheckIns, useAllStudents, useTeacher } from '../../hooks/data';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import { BetaBadge } from '../BetaBadge';
import { groupShort } from '../../domain/group';
/* โลโก้ต้อง import ผ่าน bundler ไม่ใช่อ่านจาก public/ ตอนรัน
   เดิมเป็น `${BASE_URL}logo-mark.svg` = ไฟล์แยกที่ต้องวางข้าง index.html
   แต่ build:share ส่งออกไฟล์เดียว และ artifact host รับแค่ index.html
   รูปเลยขึ้นเป็น "?" ในลิงก์เดโมทุกครั้ง (ผู้ใช้ทัก 8 ก.ย. 69) — ในเครื่อง dev ไม่เจอเพราะ public/ ถูกเสิร์ฟอยู่
   พอ import แบบนี้ assetsInlineLimit ของโหมด share จะฝังเป็น data URI ให้เอง ไม่ว่าไฟล์จะใหญ่แค่ไหน */
import logoMark from '../../assets/logo-mark.svg';
import { studentYear } from '../../domain/cohort';

/** คีย์เมนู — ต้องตรงกันทุกหน้าเพื่อไม่ให้เมนูซ้ายเปลี่ยนไปมา */
export type TeacherNav = 'overview' | 'mygroup' | 'cohort' | 'evaluate' | 'sa' | 'sect2' | 'sect3' | 'exams' | 'settings' | 'roster' | 'import' | 'alumni';

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
  /* Section II กับ III แยกเป็นคนละเมนู (ผู้ใช้เสนอ 7 ก.ย. 69)
     เดิมรวมหน้าเดียวใช้แท็บ เพราะกลัวว่าเห็น "Section III" ลอยมาแล้วงงว่าเลขอื่นหายไปไหน
     พอติดเลขครบทั้งสามหัวข้อ เมนูก็เล่าตัวเองได้ว่าไม่มีเลขไหนหาย และไม่ต้องมีแท็บซ้อนข้างใน
     ชื่อย่อภาษาไทยตามหัวข้อจริงในสมุด (Patient examination and treatment planning /
     Knowledge and skill assessments) ซึ่งยาวเกินกว่าจะใส่เต็มในแถบ 214px */
  { key: 'sect2', label: t('ตรวจและวางแผนการรักษา'), short: t('แผนรักษา'), to: '/teacher/sect2', Icon: ClipboardText, sect: 'II' },
  { key: 'sect3', label: t('ความรู้และทักษะ'), short: t('ความรู้'), to: '/teacher/sect3', Icon: ListChecks, sect: 'III' },
  /* OSCE + สอบ RPD design — ผู้ใช้เคาะ 8 ก.ย. 69 ว่าทำเป็นแค่ช่องติ๊กพอ ไม่ต้องมีฟอร์ม
     ไม่ติดเลข section เพราะ OSCE อยู่หน้าแรกสุดของเล่ม ส่วนใบสอบ design อยู่ใน Section II
     ติดเลขจะยิ่งงงกว่าเดิม — ตรงนี้จึงเป็นหมวดของตัวเองว่า "การสอบ" */
  { key: 'exams', label: t('การสอบ'), short: t('สอบ'), to: '/teacher/exams', Icon: SealCheck },
  /* แบบประเมินตนเอง — อยู่ล่างสุดเพราะทำปีละครั้งตอนจบเทอม 1 (ผู้ใช้ขอ 7 ก.ย. 69)
     ไม่ใช่งานประจำเหมือนสามอันบน · ผลพลอยได้คือ Section I กับ II–III ได้อยู่ติดกันตามลำดับเล่ม */
  { key: 'sa', label: t('ประเมินตนเอง'), short: t('SA'), to: '/teacher/sa', Icon: ClipboardText },
];

/** ระดับชั้นปี */
const COHORT_NAV: NavItem[] = [
  { key: 'overview', label: t('ภาพรวม'), to: '/teacher?tab=overview', Icon: SquaresFour },
  { key: 'cohort', label: t('วิเคราะห์รวม'), short: t('วิเคราะห์'), to: '/teacher/analytics', Icon: ChartLineUp },
  { key: 'alumni', label: t('รุ่นที่จบแล้ว'), short: t('จบแล้ว'), to: '/teacher/alumni', Icon: Archive },
  { key: 'settings', label: t('ตั้งค่าเกณฑ์'), short: t('ตั้งค่า'), to: '/teacher/settings', Icon: GearSix },
  /* รายชื่อ+นำเข้า: อาจารย์ทุกคนใช้ได้ (ทุกการกระทำมี audit log) — การให้สิทธิ์เข้าระบบข้างในยังเป็นของหัวหน้าภาค */
  { key: 'roster', label: t('รายชื่อ & นำเข้า'), short: t('รายชื่อ'), to: '/teacher/roster', Icon: IdentificationCard },
];

/** เมนูเฉพาะหัวหน้าภาค */


export function TeacherShell({ active, children }: { active: TeacherNav; children: ReactNode }) {
  const navigate = useNavigate();
  const { session, signOut, teacherGroup, setTeacherGroup, myGroup } = useApp();
  // เปิดดูกลุ่มที่ไม่ใช่ของตัวเอง — ไม่ห้าม (อาจารย์เวรต้องข้ามกลุ่มได้) แต่ต้องรู้ตัวตลอดเวลา
  const offGroup = !!myGroup && teacherGroup !== myGroup;
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
     (ผู้ใช้เจอ 2 ก.ย. หลังนำเข้าชีตรุ่น 54) */
  const yearOfGroup = (code: string): string => {
    const st = students.find((s) => s.group === code);
    if (!st) return '—';
    const y = studentYear(st);
    return y > 6 ? t('จบแล้ว') : `${t('ปี')} ${y}`;
  };

  const groupCodes = [...new Set(students.map((s) => s.group))].sort(
    (a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10),
  );

  return (
    <div className="deskwrap">
      <DemoBar />
      <div className="window">
        <aside className="side">
          <div className="side__logo">
            {/* logo-mark = ไอคอนแอปเวอร์ชันสำหรับขนาดเล็ก (พื้นน้ำเงิน เส้นขาวหนา)
                ตัวเต็ม icon.svg เส้นบางบนพื้นขาว พอย่อเหลือ 30px แทบมองไม่เห็น (ผู้ใช้แจ้ง 2 ก.ย.) */}
            <img
              src={logoMark}
              alt=""
              width={30}
              height={30}
              style={{ borderRadius: 9, flex: 'none' }}
            />
            {/* ชื่อฝั่งอาจารย์ตามที่ผู้ใช้เคาะ 2 ก.ย. (แก้ได้ทีเดียวที่นี่ถ้าภาคขอเปลี่ยนภายหลัง) */}
            <b>Prosth Mahidol</b>
          </div>

          <label className="mygroup">
            <span className="mygroup__label">{t('กลุ่มที่ดูแล')}</span>
            <select value={teacherGroup} onChange={(e) => setTeacherGroup(e.target.value)}>
              {groupCodes.map((code) => (
                /* ชั้นปีเกิน 6 = รุ่นที่เรียนจบไปแล้ว — เขียน "จบแล้ว" ไม่ใช่ "ปี 7" ซึ่งไม่มีจริง */
                <option key={code} value={code}>
                  {`${groupShort(code)} · ${yearOfGroup(code)}`}
                </option>
              ))}
            </select>
          </label>

          <div className="side__cluster">
            {GROUP_NAV.map(({ key, label, short, to, Icon, sect }) => (
              <NavLink key={key} to={to} className={key === active ? 'on' : undefined}>
                <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
                <span className="navlabel">{label}</span>
                <span className="navlabel--short">{short ?? label}</span>
                {/* เลขหัวข้อในเล่ม — ไม่แปลภาษา เพราะเป็นชื่อเฉพาะบนสมุดที่เป็นภาษาอังกฤษอยู่แล้ว */}
                {sect && <span className="navsect" title={`Section ${sect}`}>{sect}</span>}
                {key === 'evaluate' && pendingEval > 0 && (
                  <span className="count" title={t('นักศึกษา {n} คนรอประเมิน', { n: pendingEval })}>{pendingEval}</span>
                )}
              </NavLink>
            ))}
          </div>

          <div className="side__section">{t('ทั้งชั้นปี')}</div>
          {COHORT_NAV.map(({ key, label, short, to, Icon }) => (
            <NavLink key={key} to={to} className={key === active ? 'on' : undefined}>
              <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
              <span className="navlabel">{label}</span>
              <span className="navlabel--short">{short ?? label}</span>
            </NavLink>
          ))}

          <div className="side__foot" style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
            <TextSizeControl />
            <div className="card" style={{ padding: 12, boxShadow: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ font: '600 12.5px var(--font-head)' }}>{t(teacher?.name ?? 'อ. Liv')}</span>
                <BetaBadge compact />
              </div>
              <div style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
                {t(teacher?.title ?? 'อาจารย์ที่ปรึกษากลุ่ม')} · TH-PT7
              </div>
              <button
                onClick={async () => {
                  await signOut();
                  navigate('/login');
                }}
                className="linkbtn"
                style={{ marginTop: 4, font: '500 10.5px var(--font-body)', color: 'var(--text-faint)' }}
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
              mine: groupShort(myGroup!),
            })}
            <b>{t(' · การเข้าดูถูกบันทึกไว้')}</b>
          </span>
          <button onClick={() => setTeacherGroup(myGroup!)}>
            <ArrowUUpLeft size={13} weight="bold" />
            {t('กลับกลุ่มฉัน')}
          </button>
        </div>
      )}
      <ToastView variant="desk" />
      <RoleFab low />
    </div>
  );
}
