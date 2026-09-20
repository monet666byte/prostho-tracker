import { Flask } from '@phosphor-icons/react';
import { cloudEnabled } from '../lib/cloud';
import { t } from '../lib/i18n';

/**
 * แถบ "โหมดลองเล่น" — ขึ้นบนสุดของทุกหน้า **เฉพาะเมื่อแอปไม่ได้ต่อเซิร์ฟเวอร์** (เว็บเดโม / รันในเครื่อง)
 *
 * เว็บเดโมคือ sandbox อย่างเป็นทางการของระบบ (แนวเดียวกับ /mc/sandbox/ ของ My Clinic @ DTMU):
 * ข้อมูลทั้งหมดเป็นของสมมติ อยู่ในเบราว์เซอร์ของคนเปิดเท่านั้น คนที่เปิดสองเว็บสลับกันต้องรู้ทันทีว่าอยู่เว็บไหน
 * สีกรมท่าเข้มเลือกเพราะไม่ชนกับสีสถานะใดในแอป (เขียว/แดง/ส้มจองไว้แล้ว · ฟ้าคือสีธีม)
 * ⚠️ ห้ามขึ้นบนเว็บนำร่อง — ที่นั่นเป็นข้อมูลจริง (CLAUDE.md กฎข้อ 1)
 */
export function SandboxStrip() {
  if (cloudEnabled) return null;
  return (
    <div className="sbx noprint" role="note">
      <Flask size={15} weight="bold" aria-hidden />
      <span className="sbx__t"><b>{t('โหมดลองเล่น')}</b> · {t('ข้อมูลสมมติ ไม่ถูกบันทึกที่ไหน')}</span>
    </div>
  );
}
