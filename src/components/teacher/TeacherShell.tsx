import { Archive, ArrowUUpLeft, ChartLineUp, Eye, GearSix, IdentificationCard, SquaresFour, Table, Users } from '@phosphor-icons/react';
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
import { groupShort, groupYear } from '../../domain/group';

/** คีย์เมนู — ต้องตรงกันทุกหน้าเพื่อไม่ให้เมนูซ้ายเปลี่ยนไปมา */
export type TeacherNav = 'overview' | 'mygroup' | 'cohort' | 'evaluate' | 'settings' | 'roster' | 'import' | 'alumni';

type NavItem = { key: TeacherNav; label: string; short?: string; to: string; Icon: typeof SquaresFour };

/** งานประจำกลุ่ม — เกาะอยู่ใต้ตัวเลือกกลุ่ม */
const GROUP_NAV: NavItem[] = [
  // ตรวจงานรายคนยุบเป็นหน้าลูกของสรุปกลุ่ม (กดชื่อนักศึกษาในตาราง) — ไม่มีเมนูของตัวเอง
  { key: 'mygroup', label: t('สรุปกลุ่ม'), to: '/teacher/group', Icon: Users },
  { key: 'evaluate', label: t('ประเมินรายคาบ'), short: t('ประเมิน'), to: '/teacher/evaluate', Icon: Table },
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
  const groupCodes = [...new Set(students.map((s) => s.group))].sort(
    (a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10),
  );

  return (
    <div className="deskwrap">
      <DemoBar />
      <div className="window">
        <aside className="side">
          <div className="side__logo">
            {/* ใช้ไอคอนแอปตัวจริง (อันเดียวกับที่ขึ้นหน้าจอโฮมมือถือ) — เดิมเป็นไอคอนกระดานดำคนละตัว */}
            <img
              src={`${import.meta.env.BASE_URL}icon.svg`}
              alt=""
              width={30}
              height={30}
              style={{ borderRadius: 9, flex: 'none', boxShadow: '0 0 0 1px var(--border)' }}
            />
            {/* ชื่อฝั่งอาจารย์ตามที่ผู้ใช้เคาะ 2 ก.ย. (แก้ได้ทีเดียวที่นี่ถ้าภาคขอเปลี่ยนภายหลัง) */}
            <b>Prosth MU</b>
          </div>

          <label className="mygroup">
            <span className="mygroup__label">{t('กลุ่มที่ดูแล')}</span>
            <select value={teacherGroup} onChange={(e) => setTeacherGroup(e.target.value)}>
              {groupCodes.map((code) => (
                /* ชั้นปีเกิน 6 = รุ่นที่เรียนจบไปแล้ว — เขียน "จบแล้ว" ไม่ใช่ "ปี 7" ซึ่งไม่มีจริง */
                <option key={code} value={code}>
                  {`${groupShort(code)} · ${groupYear(code) > 6 ? t('จบแล้ว') : `${t('ปี')} ${groupYear(code)}`}`}
                </option>
              ))}
            </select>
          </label>

          <div className="side__cluster">
            {GROUP_NAV.map(({ key, label, short, to, Icon }) => (
              <NavLink key={key} to={to} className={key === active ? 'on' : undefined}>
                <Icon size={17} weight={key === active ? 'fill' : 'regular'} />
                <span className="navlabel">{label}</span>
                <span className="navlabel--short">{short ?? label}</span>
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
                style={{ marginTop: 8, font: '500 10.5px var(--font-body)', color: 'var(--text-faint)' }}
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
