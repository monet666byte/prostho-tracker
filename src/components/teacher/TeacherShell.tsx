import { ChalkboardTeacher, ChartLineUp, GearSix, SquaresFour, Table, Users } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { DemoBar } from '../DemoBar';
import { RoleFab } from '../RoleFab';
import { TextSizeControl } from '../TextSize';
import { useAllCheckIns, useAllStudents, useTeacher } from '../../hooks/data';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

/** คีย์เมนู — ต้องตรงกันทุกหน้าเพื่อไม่ให้เมนูซ้ายเปลี่ยนไปมา */
export type TeacherNav = 'overview' | 'mygroup' | 'cohort' | 'evaluate' | 'settings';

type NavItem = { key: TeacherNav; label: string; to: string; Icon: typeof SquaresFour };

/** งานประจำกลุ่ม — เกาะอยู่ใต้ตัวเลือกกลุ่ม */
const GROUP_NAV: NavItem[] = [
  // ตรวจงานรายคนยุบเป็นหน้าลูกของสรุปกลุ่ม (กดชื่อนักศึกษาในตาราง) — ไม่มีเมนูของตัวเอง
  { key: 'mygroup', label: t('สรุปกลุ่ม'), to: '/teacher/group', Icon: Users },
  { key: 'evaluate', label: t('ประเมินรายคาบ'), to: '/teacher/evaluate', Icon: Table },
];

/** ระดับชั้นปี */
const COHORT_NAV: NavItem[] = [
  { key: 'overview', label: t('ภาพรวม'), to: '/teacher?tab=overview', Icon: SquaresFour },
  { key: 'cohort', label: t('วิเคราะห์รวม'), to: '/teacher/analytics', Icon: ChartLineUp },
  { key: 'settings', label: t('ตั้งค่าเกณฑ์'), to: '/teacher/settings', Icon: GearSix },
];

export function TeacherShell({ active, children }: { active: TeacherNav; children: ReactNode }) {
  const navigate = useNavigate();
  const { session, signOut, teacherGroup, setTeacherGroup } = useApp();
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
  const groupCodes = [...new Set(students.map((s) => s.group))].sort(
    (a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10),
  );

  return (
    <div className="deskwrap">
      <DemoBar />
      <div className="window">
        <aside className="side">
          <div className="side__logo">
            <span
              style={{
                width: 30, height: 30, borderRadius: 9, background: 'var(--accent)', color: '#fff',
                display: 'grid', placeItems: 'center',
              }}
            >
              <ChalkboardTeacher size={17} weight="fill" />
            </span>
            <b>Prostho Tracker</b>
          </div>

          <label className="mygroup">
            <span className="mygroup__label">{t('กลุ่มที่ดูแล')}</span>
            <select value={teacherGroup} onChange={(e) => setTeacherGroup(e.target.value)}>
              {groupCodes.map((code) => (
                <option key={code} value={code}>{code.replace('TH-', 'PT').replace('PTPT', 'PT')}</option>
              ))}
            </select>
          </label>

          <div className="side__cluster">
            {GROUP_NAV.map(({ key, label, to, Icon }) => (
              <NavLink key={key} to={to} className={key === active ? 'on' : undefined}>
                <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
                {label}
                {key === 'evaluate' && pendingEval > 0 && (
                  <span className="count" title={t('นักศึกษา {n} คนรอประเมิน', { n: pendingEval })}>{pendingEval}</span>
                )}
              </NavLink>
            ))}
          </div>

          <div className="side__section">{t('ทั้งชั้นปี')}</div>
          {COHORT_NAV.map(({ key, label, to, Icon }) => (
            <NavLink key={key} to={to} className={key === active ? 'on' : undefined}>
              <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
              {label}
            </NavLink>
          ))}

          <div className="side__foot" style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
            <TextSizeControl />
            <div className="card" style={{ padding: 12, boxShadow: 'none' }}>
              <div style={{ font: '600 12.5px var(--font-head)' }}>{t(teacher?.name ?? 'อ. ก.')}</div>
              <div style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
                {t(teacher?.title ?? 'อาจารย์ที่ปรึกษากลุ่ม')} · TH-PT7
              </div>
              <button
                onClick={async () => {
                  await signOut();
                  navigate('/login');
                }}
                style={{ marginTop: 8, font: '500 10.5px var(--font-body)', color: 'var(--text-faint)' }}
              >
                {t('ออกจากระบบ')}
              </button>
            </div>
          </div>
        </aside>

        {children}
      </div>
      <RoleFab low />
    </div>
  );
}
