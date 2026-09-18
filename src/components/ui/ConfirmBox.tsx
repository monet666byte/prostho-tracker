import type { CSSProperties, ReactNode } from 'react';
import { t } from '../../lib/i18n';

/**
 * โครงกล่องยืนยันที่ทุกหน้าของอาจารย์ใช้ร่วมกัน — ฉากหลังมืด + กล่องกลางจอ
 * เนื้อในต่างกันทุกกล่อง (บางกล่องมีช่องกรอก บางกล่องมีตารางคะแนน) จึงรับเป็น children
 *
 * ตั้งใจไม่ใส่ปุ่ม Esc / ย้าย focus — กล่องเดิมทุกใบไม่มี เพิ่มที่นี่ = เปลี่ยนพฤติกรรมทุกหน้าพร้อมกัน
 * `role` / `ariaLabel` ใส่เฉพาะกล่องที่ส่งมา เพื่อให้ DOM ของกล่องเดิมไม่ขยับ
 */
export function ConfirmBox({ onBackdrop, wide = false, role, ariaLabel, style, children }: {
  /** กดพื้นที่มืดนอกกล่อง · ไม่ส่ง = กดนอกกล่องแล้วไม่ปิด (กล่องที่บังคับให้ตอบ) */
  onBackdrop?: () => void;
  wide?: boolean;
  role?: 'dialog';
  ariaLabel?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="confirmwrap" onClick={onBackdrop}>
      <div
        className={wide ? 'confirmbox confirmbox--wide' : 'confirmbox'}
        role={role}
        aria-label={ariaLabel}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** แถวปุ่มมาตรฐาน: "ยกเลิก" ซ้าย · ปุ่มลงมือขวา (ไอคอน+ข้อความส่งเป็น children) */
export function ConfirmActions({ onCancel, onConfirm, disabled, children }: {
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="confirmbox__actions">
      <button className="btn btn--sec" onClick={onCancel}>{t('ยกเลิก')}</button>
      <button className="btn" disabled={disabled} onClick={onConfirm}>{children}</button>
    </div>
  );
}
