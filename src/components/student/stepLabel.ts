import { t } from '../../lib/i18n';

/**
 * ป้ายปุ่มบันทึกขั้น: "Anterior teeth : Try in" → "บันทึก Try in เสร็จ"
 * ชื่อยาวเกินปุ่มจะใช้ข้อความกลาง — หน้าแรกกับหน้ารายละเอียดเคสใช้ตัวเดียวกัน ปุ่มจะได้พูดเหมือนกัน
 */
export function recordStepLabel(name: string): string {
  const short = name.includes(':') ? name.split(':').pop()!.trim() : name;
  return short && short.length <= 22 ? t('บันทึก {name} เสร็จ', { name: short }) : t('ทำขั้นนี้เสร็จแล้ว');
}
