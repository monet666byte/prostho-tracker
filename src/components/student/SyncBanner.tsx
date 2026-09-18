import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePendingPushCount, useSyncStatus } from '../../hooks/data';
import { onUpdateReady, updateReady } from '../../lib/appUpdate';
import { cloudEnabled } from '../../lib/cloud';
import { t } from '../../lib/i18n';
import { signOutToReLogin } from '../../store/app';

/** ของค้างส่งนานเท่านี้แล้วยังต่อเซิร์ฟเวอร์ไม่ได้ = ไม่ใช่ไวไฟสะดุดแล้ว ต้องให้เจ้าตัวรู้ */
const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * แถบเตือนเหนือการ์ดเช็คอินหน้าแรก — **ครั้งละแถบเดียว และวันปกติไม่มีเลย**
 *
 * ขึ้นเฉพาะเรื่องที่ระบบแก้เองไม่ได้ ต้องให้นักศึกษาลงมือ (เรียงตามความเร่ง):
 *   ① หมดเวลาเข้าสู่ระบบ — งานส่งต่อไม่ได้จนกว่าจะล็อกอินใหม่
 *   ② ของค้างส่งเกิน 1 วันและยังต่อเซิร์ฟเวอร์ไม่ได้ — ไวไฟคลินิกหลุดสั้นๆ ไม่นับ (ขึ้นบ่อย = เลิกอ่าน)
 *   ③ มีแอปรุ่นใหม่
 * รายละเอียดทั้งหมดอยู่ในหน้าตั้งค่า — ตรงนี้แค่พาไป
 */
export function SyncBanner() {
  const navigate = useNavigate();
  const link = useSyncStatus();
  const unsent = usePendingPushCount();
  const hasUpdate = useSyncExternalStore(onUpdateReady, updateReady);

  if (cloudEnabled && link.link === 'auth') {
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
  const stuck = cloudEnabled && link.link === 'down' && unsent > 0
    && link.pendingSince !== null && Date.now() - link.pendingSince >= STUCK_AFTER_MS;
  if (stuck) {
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
  if (hasUpdate) {
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
