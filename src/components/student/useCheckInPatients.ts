import { useMemo } from 'react';
import type { WorkpieceView } from '../../domain/types';
import { t } from '../../lib/i18n';
import { patientWithHn } from '../../lib/privacy';

/**
 * รายชื่อผู้ป่วยให้เลือกในฟอร์มเช็คอิน — คู่ [patientId, ป้ายที่แสดง] ไม่ซ้ำคน เรียงตามลำดับชิ้นงาน
 * ป้ายผ่าน patientWithHn เสมอ (สวิตช์ชื่อผู้ป่วยปิด = เห็นแค่ HN) — ห้ามประกอบชื่อเองในหน้าจอ
 */
export function useCheckInPatients(works: WorkpieceView[], namesOn: boolean): [string, string][] {
  return useMemo(() => {
    const seen = new Map<string, string>();
    works.forEach((w) => seen.set(w.patient.id, patientWithHn(w.patient, namesOn, t)));
    return [...seen.entries()];
  }, [works, namesOn]);
}
