import { ArrowCounterClockwise, ChalkboardTeacher, Palette, SignOut, Sparkle, Student } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/app';
import type { Role } from '../domain/types';
import { applyTheme, currentTheme, THEMES } from '../lib/theme';

/**
 * แถบสลับมุมมองสำหรับตอนนำเสนอ — ขึ้นเฉพาะจอกว้าง (ที่แสดงเป็นกรอบมือถือ)
 * เวลาใช้งานจริงบนมือถือจะไม่เห็นแถบนี้
 */
export function DemoBar() {
  const { session, switchRole, resetDemo, showToast, signOut } = useApp();
  const navigate = useNavigate();
  if (!session) return null;

  const go = async (role: Role) => {
    if (session.role === role) return;
    await switchRole();
    navigate(role === 'student' ? '/app' : '/teacher');
  };

  return (
    <div className="demobar">
      <span className="demobar__stage" title="ตัวเลขคร่าวๆ ไว้สื่อสารว่ายังอยู่ช่วงเริ่มต้น">
        DEMO · งาน ~10%
      </span>
      <span className="demobar__label">มุมมอง</span>
      <div className="demobar__seg">
        <button data-on={session.role === 'student'} onClick={() => go('student')}>
          <Student size={15} weight={session.role === 'student' ? 'fill' : 'regular'} />
          นักศึกษา
        </button>
        <button data-on={session.role === 'teacher'} onClick={() => go('teacher')}>
          <ChalkboardTeacher size={15} weight={session.role === 'teacher' ? 'fill' : 'regular'} />
          อาจารย์
        </button>
      </div>
      <button
        className="demobar__reset"
        onClick={async () => {
          if (session.role !== 'student') await switchRole();
          navigate('/app/achievements');
        }}
      >
        <Sparkle size={13} weight="fill" />
        Achievement (mock)
      </button>
      <label className="demobar__reset" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
        <Palette size={13} weight="fill" />
        <select
          defaultValue={currentTheme()}
          onChange={(e) => applyTheme(e.target.value)}
          style={{ font: 'inherit', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}
          aria-label="ธีมสี"
        >
          {THEMES.map((t) => (
            <option key={t.cls} value={t.cls}>{t.label}</option>
          ))}
        </select>
      </label>
      <button
        className="demobar__reset"
        onClick={async () => {
          await resetDemo();
          showToast({ message: 'รีเซ็ตข้อมูลเดโมแล้ว', tone: 'success' });
        }}
      >
        <ArrowCounterClockwise size={13} />
        รีเซ็ตข้อมูล
      </button>
      <button
        className="demobar__reset"
        onClick={async () => {
          await signOut();
          navigate('/login');
        }}
      >
        <SignOut size={13} />
        หน้า login
      </button>
    </div>
  );
}
