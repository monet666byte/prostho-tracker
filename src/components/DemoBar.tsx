import { ArrowCounterClockwise, ChalkboardTeacher, Globe, Palette, SignOut, Sparkle, Student } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useApp, useCanSwitchRole } from '../store/app';
import type { Role } from '../domain/types';
import { applyTheme, currentTheme, THEMES } from '../lib/theme';
import { lang, setLang, t } from '../lib/i18n';

/**
 * แถบสลับมุมมองสำหรับตอนนำเสนอ — ขึ้นเฉพาะจอกว้าง (ที่แสดงเป็นกรอบมือถือ)
 * เวลาใช้งานจริงบนมือถือจะไม่เห็นแถบนี้
 */
export function DemoBar() {
  const { session, switchRole, resetDemo, showToast, signOut } = useApp();
  const canSwitch = useCanSwitchRole();
  const navigate = useNavigate();
  if (!session) return null;

  const go = async (role: Role) => {
    if (session.role === role) return;
    await switchRole();
    navigate(role === 'student' ? '/app' : '/teacher');
  };

  return (
    <div className="demobar">
      <span className="demobar__stage" title={t('ตัวเลขคร่าวๆ ไว้สื่อสารว่ายังอยู่ช่วงเริ่มต้น')}>
        {t('DEMO · งาน ~10%')}
      </span>
      {canSwitch && <span className="demobar__label">{t('มุมมอง')}</span>}
      {canSwitch && (
      <div className="demobar__seg">
        <button data-on={session.role === 'student'} onClick={() => go('student')}>
          <Student size={15} weight={session.role === 'student' ? 'fill' : 'regular'} />
          {t('นักศึกษา')}
        </button>
        <button data-on={session.role === 'teacher'} onClick={() => go('teacher')}>
          <ChalkboardTeacher size={15} weight={session.role === 'teacher' ? 'fill' : 'regular'} />
          {t('อาจารย์')}
        </button>
      </div>
      )}
      {(canSwitch || session.role === 'student') && (
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
      )}
      <label className="demobar__reset" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
        <Globe size={13} weight="fill" />
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as 'th' | 'en')}
          style={{ font: 'inherit', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}
          aria-label={t('ภาษา')}
        >
          <option value="th">ไทย</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="demobar__reset" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
        <Palette size={13} weight="fill" />
        <select
          defaultValue={currentTheme()}
          onChange={(e) => applyTheme(e.target.value)}
          style={{ font: 'inherit', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}
          aria-label={t('ธีมสี')}
        >
          {THEMES.map((th) => (
            <option key={th.cls} value={th.cls}>{t(th.label)}</option>
          ))}
        </select>
      </label>
      <button
        className="demobar__reset"
        onClick={async () => {
          await resetDemo();
          showToast({ message: t('รีเซ็ตข้อมูลเดโมแล้ว'), tone: 'success' });
        }}
      >
        <ArrowCounterClockwise size={13} />
        {t('รีเซ็ตข้อมูล')}
      </button>
      <button
        className="demobar__reset"
        onClick={async () => {
          await signOut();
          navigate('/login');
        }}
      >
        <SignOut size={13} />
        {t('หน้า login')}
      </button>
    </div>
  );
}
