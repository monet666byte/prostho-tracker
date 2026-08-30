/**
 * แถบแจ้งผลหลังกดปุ่ม — ใช้ร่วมกันทั้งฝั่งนักศึกษาและฝั่งอาจารย์
 *
 * เดิมตัวนี้ซ่อนอยู่ใน Shell ของฝั่งนักศึกษาไฟล์เดียว ฝั่งอาจารย์จึงไม่เคยเรนเดอร์เลย
 * — showToast ฝั่งอาจารย์ 15 จุดเงียบหายหมด รวมถึงคำเตือน "คาบนี้มีคนประเมินไปแล้ว"
 * ซึ่งเป็นชั้นกันประเมินซ้ำที่ตั้งใจให้อาจารย์เห็น (ตัวตรรกะทำงาน แต่ไม่มีอะไรขึ้นจอ)
 */
import { ArrowUUpLeft, CheckCircle } from '@phosphor-icons/react';
import { undoStep } from '../data/repo';
import { t } from '../lib/i18n';
import { currentActor, useApp } from '../store/app';

export function ToastView({ variant = 'phone' }: { variant?: 'phone' | 'desk' }) {
  const { toast, hideToast, touch } = useApp();
  if (!toast) return null;
  return (
    <div className={`toast${variant === 'desk' ? ' toast--desk' : ''}`} role="status">
      <CheckCircle size={18} weight="fill" color={toast.tone === 'warning' ? '#FDBA5E' : '#5AE0A8'} />
      <span>{toast.message}</span>
      {toast.undoWorkpieceId && (
        <button
          onClick={async () => {
            await undoStep(toast.undoWorkpieceId!, currentActor());
            hideToast();
            touch();
          }}
        >
          <ArrowUUpLeft size={14} weight="bold" style={{ verticalAlign: -2, marginRight: 3 }} />
          {t('เลิกทำ')}
        </button>
      )}
    </div>
  );
}
