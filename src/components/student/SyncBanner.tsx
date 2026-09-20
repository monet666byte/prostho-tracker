import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeSyncNotice } from '../../domain/syncNotice';
import { usePendingPushCount, useSyncStatus } from '../../hooks/data';
import { onUpdateReady, updateReady } from '../../lib/appUpdate';
import { cloudEnabled } from '../../lib/cloud';
import { t } from '../../lib/i18n';
import { signOutToReLogin } from '../../store/app';

/**
 * แถบเตือนเหนือการ์ดเช็คอินหน้าแรก — **ครั้งละแถบเดียว และวันปกติไม่มีเลย**
 *
 * เรื่องไหนขึ้น/ไม่ขึ้น ตัดสินที่ `domain/syncNotice.ts` ที่เดียว (มีเทสต์) — ตรงนี้แค่วาด
 * รายละเอียดทั้งหมดอยู่ในหน้าตั้งค่า แถบนี้แค่พาไป
 */
export function SyncBanner() {
  const navigate = useNavigate();
  const link = useSyncStatus();
  const unsent = usePendingPushCount();
  const hasUpdate = useSyncExternalStore(onUpdateReady, updateReady);

  const notice = homeSyncNotice({
    cloud: cloudEnabled, link: link.link, unsent, pendingSince: link.pendingSince, hasUpdate, now: Date.now(),
  });

  if (notice === 'auth') {
    return (
      <button className="homebanner homebanner--danger" onClick={async () => { await signOutToReLogin(); navigate('/login'); }}>
        <span className="homebanner__main">
          <b>{t('ต้องเข้าสู่ระบบใหม่')}</b>
          {unsent > 0 && <small>{t('งาน {n} รายการรอส่งอยู่ในเครื่อง', { n: unsent })}</small>}
        </span>
        <span className="homebanner__go">{t('เข้าสู่ระบบ')} ›</span>
      </button>
    );
  }
  if (notice === 'stuck') {
    return (
      <button className="homebanner homebanner--warn" onClick={() => navigate('/app/sync')}>
        <span className="homebanner__main">
          <b>{t('งาน {n} รายการยังไม่ถึงเซิร์ฟเวอร์', { n: unsent })}</b>
          <small>{t('ค้างเกิน 1 วันแล้ว — ลองต่อเน็ตอื่น')}</small>
        </span>
        <span className="homebanner__go">{t('ดู')} ›</span>
      </button>
    );
  }
  if (notice === 'update') {
    return (
      <button className="homebanner homebanner--info" onClick={() => window.location.reload()}>
        <span className="homebanner__main">
          <b>{t('มีแอปรุ่นใหม่')}</b>
          <small>{t('งานที่ค้างไม่หาย')}</small>
        </span>
        <span className="homebanner__go">{t('อัปเดตเลย')} ›</span>
      </button>
    );
  }
  return null;
}
