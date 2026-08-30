import { TYPES } from '../domain/catalog';
import { currentProc, maxProgression, percentCompleted, procLabel, progression } from '../domain/rules';
import type { WorkpieceView } from '../domain/types';
import { toSheetDate } from './date';

/** ช่องติ๊ก progression 0–10 เหมือนในชีต */
export const PROGRESSION_COLUMNS = Array.from({ length: 11 }, (_, i) => String(i));

/** คอลัมน์ต้องเรียงตรงกับ tab PTn ของชีตเดิม */
/**
 * ชื่อคอลัมน์ตามชีตจริงของภาค — ห้ามแปล
 * ไฟล์ที่ export ต้องเปิดในชีตเดิมได้ และตัวนำเข้าก็มองหาชื่อพวกนี้ตรงๆ
 * (บางคอลัมน์เป็นไทยเพราะชีตต้นฉบับเขียนไว้แบบนั้น)
 */
export const CSV_COLUMNS = [
  'No.',
  "Patient's Name-Surname",
  'HN',
  'Prosthodontic work (one piece per row)',
  'Accepted date',
  'Minimum Req (Yes/No)',
  'Step งานที่ผ่านแล้ว',
  ...PROGRESSION_COLUMNS,
  '% Completed',
  'Payment',
  'หมายเหตุ / สถานะผู้ป่วย',
  'Sect II Removable',
  'Sect II Fixed',
  'Design RPD',
  'วันที่บันทึกข้อมูล dd/mm/yy',
];

/** progression ที่ผ่านแล้วของชิ้นงาน — ใช้ทั้งใน CSV และตารางรายงาน A4 */
export function passedProgressions(w: WorkpieceView): boolean[] {
  const prog = progression(w);
  const max = maxProgression(w);
  return PROGRESSION_COLUMNS.map((_, i) => i <= max && i <= prog);
}

export function toCsvRows(works: WorkpieceView[]): string[][] {
  return works.map((w, i) => {
    const cur = currentProc(w);
    const note = [
      w.patient.note ?? '',
    ].filter(Boolean).join(' · ');

    return [
      String(i + 1),
      w.patient.name,
      w.patient.hn,
      w.detail,
      toSheetDate(w.acceptedDate),
      w.minimumRequirement ? 'Yes' : 'No',
      cur ? procLabel(w.type, cur) : '',
      ...passedProgressions(w).map((on) => (on ? '✓' : '')),
      `${percentCompleted(w)}%`,
      w.payment,
      note,
      w.sect2Removable ? 'Yes' : 'No',
      w.sect2Fixed ? 'Yes' : 'No',
      w.designRpd ?? '',
      toSheetDate(w.lastUpdatedAt),
    ];
  });
}

function escapeCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildCsv(works: WorkpieceView[]): string {
  const rows = [CSV_COLUMNS, ...toCsvRows(works)];
  // BOM เพื่อให้ Excel อ่านภาษาไทยถูก
  return '﻿' + rows.map((r) => r.map(escapeCell).join(',')).join('\n');
}

export function downloadCsv(works: WorkpieceView[], filename: string): void {
  const blob = new Blob([buildCsv(works)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function typeLabel(w: WorkpieceView): string {
  return TYPES[w.type].full;
}
