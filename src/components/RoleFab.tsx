import { ChalkboardTeacher, Student } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { useApp, useCanSwitchRole } from '../store/app';

/**
 * ปุ่มลอยสลับมุมมอง นศ. ↔ อาจารย์ — สำหรับ iPad/มือถือ ที่แถบเดโมด้านบนถูกซ่อน
 * (CSS แสดงเฉพาะ media query เดียวกับที่ซ่อน .demobar)
 */
export function RoleFab({ low = false }: { low?: boolean }) {
  const { session, switchRole } = useApp();
  const canSwitch = useCanSwitchRole();
  const navigate = useNavigate();
  if (!session || !canSwitch) return null;
  const toTeacher = session.role === 'student';
  return (
    <button
      className={`rolefab noprint${low ? ' rolefab--low' : ''}`}
      aria-label={t('สลับมุมมอง')}
      onClick={async () => {
        await switchRole();
        navigate(toTeacher ? '/teacher' : '/app');
      }}
    >
      {toTeacher ? <ChalkboardTeacher size={16} weight="fill" /> : <Student size={16} weight="fill" />}
      {toTeacher ? t('อาจารย์') : t('นักศึกษา')}
    </button>
  );
}
