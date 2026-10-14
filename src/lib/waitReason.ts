import type { WaitReason } from '../domain/types';
import { t } from './i18n';

/** ป้ายเหตุผล "รอคนไข้" บนจอ (ผ่าน t()) — ของที่เก็บลง audit ใช้ป้ายไทยใน repo.ts */
export function waitReasonLabel(r: WaitReason): string {
  switch (r) {
    case 'busy': return t('คนไข้ไม่ว่าง');
    case 'preprosth': return t('รอ pre-prosth');
    case 'refer': return t('refer ไปภาคอื่น');
    default: return t('อื่นๆ');
  }
}
