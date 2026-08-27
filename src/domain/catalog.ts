/**
 * Procedure catalog — source of truth คัดลอกจาก logic class ของไฟล์ดีไซน์
 * (PROCS / RECALL / TYPES / ORDER) ซึ่งตรงกับ tab "Work step" ของชีตจริง
 *
 * แต่ละ procedure = [progression 0–10, ชื่อ procedure, selfPerformed?]
 * selfPerformed (`*` ในชีต) = lab step ที่นักศึกษาต้องทำเอง
 */

import type { DentureClass, WorkType } from './types';

export const CATALOG_VERSION = 'DTPT502-2569';

export interface TypeMeta {
  short: string;
  full: string;
  prefix: string;
  color: string;
  tint: string;
}

export const TYPES: Record<WorkType, TypeMeta> = {
  CD: { short: 'CD/APD', full: 'CD / Complicated APD', prefix: 'CD', color: '#2B5CE6', tint: '#EDF1FE' },
  RPD: { short: 'RPD', full: 'RPD (Co-Cr or Simple APD)', prefix: 'RPD', color: '#0E9F6E', tint: '#E7F7F1' },
  PC: { short: 'Post-core', full: 'Post-core crown or bridge', prefix: 'Postcore', color: '#7A5AF8', tint: '#F1EEFE' },
  CB: { short: 'Cr,Br', full: 'Crown or Bridge', prefix: 'Cr,Br', color: '#B54708', tint: '#FEF3E7' },
  APD: { short: 'APD', full: 'Simple APD (acrylic)', prefix: 'APD', color: '#0891B2', tint: '#E4F5FA' },
  RRM: { short: 'Recall Rem.', full: 'Recall Removable', prefix: 'Recall-Rem', color: '#64748B', tint: '#F1F3F7' },
  RFX: { short: 'Recall Fixed', full: 'Recall Fixed', prefix: 'Recall-Fix', color: '#475569', tint: '#EEF1F5' },
};

/** ลำดับการแสดงรายการตาม INTRO ของชีต */
export const ORDER: Record<WorkType, number> = { CD: 0, RPD: 1, APD: 2, PC: 3, CB: 4, RRM: 5, RFX: 6 };

/** ประเภทที่นับเข้าเกณฑ์ขั้นต่ำ (จำนวนที่ต้องการอยู่ใน Settings.req) */
export const REQ_TYPES = ['CD', 'RPD', 'PC', 'CB'] as const;
export type ReqType = (typeof REQ_TYPES)[number];

export type Proc = [progression: number, name: string, self?: 1];

export const RECALL: Proc[] = [
  [0, 'ตรวจสภาพชิ้นงาน / เนื้อเยื่อรองรับ'],
  [1, 'ปรับแก้ / reline ตามข้อบ่งชี้'],
  [2, 'บันทึกผลและนัดครั้งถัดไป'],
  [3, 'ปิดเคส recall'],
];

export const PROCS: Record<string, Proc[]> = {
  CD: [
    [0, 'Primary impression'], [0, 'Primary cast'],
    [1, 'Treatment plan AND proposed design'],
    [2, 'Outline of customs trays'], [2, 'Custom trays'],
    [3, 'Final impression'], [3, 'Master cast'], [3, 'Registration blocks'], [3, 'OVD determination'], [3, 'Jaw relation record'],
    [4, 'Mounting on articulator', 1], [4, 'Tooth shade selection'],
    [5, 'Anterior teeth : Set up'], [5, 'Anterior teeth : Try in'], [5, 'Posterior teeth : Set up'], [5, 'Posterior teeth : Try in'],
    [6, 'Posterior palatal seal prepared on cast', 1], [6, 'Waxing, ready for flasking'], [6, 'Remounting', 1],
    [7, 'Occlusal adjustment (Selective grinding)', 1], [7, 'Denture finished'],
    [8, 'Delivery'],
    [9, 'First Adjustment'],
    [10, 'Completion of case'],
  ],
  RPD: [
    [0, 'Primary impression'], [0, 'Study casts (Mounted on articulator)', 1],
    [1, 'Treatment plan AND proposed design'],
    [2, 'Preparation of duplicated cast', 1], [2, 'Custom tray for final impression'],
    [3, 'Abutment tooth preparations'], [3, 'Final impression'], [3, 'Master cast', 1],
    [4, 'Survey and design on master cast', 1], [4, 'Skeleton finished'], [4, 'Try in skeleton'], [4, 'Custom tray for altered cast impression'],
    [5, 'Altered cast impression'], [5, 'Altered master cast'], [5, 'Registration block'], [5, 'Jaw relation record'],
    [6, 'Mounting on articulator', 1], [6, 'Tooth shade selection'], [6, 'Anterior teeth : Set up'], [6, 'Anterior teeth : Try in'], [6, 'Posterior teeth : Set up'], [6, 'Posterior teeth : Try in'],
    [7, 'Remounting', 1], [7, 'Occlusal adjustment (Selective grinding)', 1], [7, 'Denture finished'],
    [8, 'Delivery'],
    [9, 'First Adjustment'],
    [10, 'Completion of case'],
  ],
  PC: [
    [0, 'Primary impression'], [0, 'Study casts (Mounted on articulator)', 1],
    [1, 'Treatment plan AND proposed design'],
    [2, 'Prepared temporary crown / bridge'],
    [3, 'Tooth preparation for post-core'], [3, 'Canal prepared'], [3, 'X-ray checked'], [3, 'Final impression for post-core'], [3, 'Working cast for post-core'], [3, 'Mounting on articulator'], [3, 'Wax pattern of post-core'], [3, 'Casted Post-core'], [3, 'Post-core try in'],
    [4, 'Post & core cementation'],
    [5, 'Abutment preparation for crown / bridge'], [5, 'Final impression and occlusal registration for crown/bridge'], [5, 'Die trimming for crown/bridge substructure', 1], [5, 'Die and working cast for crown/bridge'], [5, 'Working casts mounted on articulator', 1], [5, 'Wax pattern for crown/bridge'],
    [6, 'Survey line and/or rest seat checked', 1], [6, 'Wax pattern cut back for crown/bridge substructure'],
    [7, 'Casted substructure for crown/bridge'], [7, 'Try in crown/bridge substructure (at least one case)', 1],
    [8, 'Crown/Bridge finished'], [8, 'Temporary cementation'],
    [9, 'Permanent cementation'], [9, 'Follow up 1st visit'],
    [10, 'Completion of case'],
  ],
  PC_PREFAB: [
    [0, 'Primary impression'], [0, 'Study casts (Mounted on articulator)', 1],
    [1, 'Treatment plan AND proposed design'],
    [2, 'Prepared temporary crown / bridge'],
    [3, 'Tooth preparation for prefab. post'], [3, 'Canal prepared'], [3, 'X-ray checked'], [3, 'Post try in'],
    [4, 'Post cementation & core built up'],
    [5, 'Abutment preparation for crown / bridge'], [5, 'Final impression and occlusal registration for crown/bridge'], [5, 'Die trimming for crown/bridge substructure', 1], [5, 'Die and working cast for crown/bridge'], [5, 'Working casts mounted on articulator', 1], [5, 'Wax pattern for crown/bridge'],
    [6, 'Survey line and/or rest seat checked', 1], [6, 'Wax pattern cut back for crown/bridge substructure'],
    [7, 'Casted substructure for crown/bridge'], [7, 'Try in crown/bridge substructure (at least one case)', 1],
    [8, 'Crown/Bridge finished'], [8, 'Temporary cementation'],
    [9, 'Permanent cementation'], [9, 'Follow up 1st visit'],
    [10, 'Completion of case'],
  ],
  CB: [
    [0, 'Primary impression'], [0, 'Study casts (Mounted on articulator)', 1],
    [1, 'Treatment plan AND proposed design'],
    [2, 'Prepared temporary crown / bridge'],
    [3, 'Abutment preparation for crown / bridge'],
    [4, 'Final impression and occlusal registration'], [4, 'Die trimming (at least one case)', 1], [4, 'Die and working cast'], [4, 'Working casts mounted on articulator', 1],
    [5, 'Wax pattern fabrication'], [5, 'Survey line and/or rest seat checked', 1], [5, 'Wax pattern cut back for substructure'],
    [6, 'Casted substructure for crown/bridge'],
    [7, 'Try in substructure (at least one case)', 1],
    [8, 'Crown/Bridge finished'], [8, 'Temporary cementation'],
    [9, 'Permanent cementation'], [9, 'Follow up 1st visit'],
    [10, 'Completion of case'],
  ],
};

/**
 * ชนิดชิ้นงานถอดได้ตามชีตจริง — แต่ละชนิดผูกกับ WorkType ที่กำหนดลิสต์ procedure
 * countsCDA = นับเข้าคอลัมน์ "Count CDA" ของ tab Case CD (CD และงาน Complicated)
 */
export interface DentureClassMeta {
  label: string;
  teeth: string;
  type: WorkType;
  countsCDA: boolean;
}

export const DENTURE_CLASSES: Record<DentureClass, DentureClassMeta> = {
  CD: { label: 'CD', teeth: 'ไม่เหลือฟันแม้แต่ซี่เดียว', type: 'CD', countsCDA: true },
  'complicated-APD': { label: 'Complicated APD', teeth: 'เหลือไม่เกิน 4 ซี่', type: 'CD', countsCDA: true },
  'complicated-RPD': { label: 'Complicated RPD', teeth: 'เหลือไม่เกิน 4 ซี่', type: 'RPD', countsCDA: true },
  'simple-RPD': { label: 'Simple RPD', teeth: 'เหลือมากกว่า 4 ซี่', type: 'RPD', countsCDA: false },
  'simple-APD': { label: 'Simple APD', teeth: 'เหลือมากกว่า 4 ซี่', type: 'APD', countsCDA: false },
};

/** ชนิดที่เลือกได้ เมื่อผู้ใช้เลือก WorkType นั้นในฟอร์มเปิดชิ้นงานใหม่ */
export const DENTURE_CLASSES_FOR: Record<string, DentureClass[]> = {
  CD: ['CD', 'complicated-APD'],
  RPD: ['simple-RPD', 'complicated-RPD'],
  APD: ['simple-APD'],
};

/** ป้ายแบบเดียวกับชีต เช่น "CD/- (Upper ไม่เหลือฟันแม้แต่ซี่เดียว)" */
export function dentureLabel(dc: DentureClass, arch: 'upper' | 'lower'): string {
  const meta = DENTURE_CLASSES[dc];
  const side = arch === 'upper' ? 'Upper' : 'Lower';
  const prefix = arch === 'upper' ? `${meta.label}/-` : `-/${meta.label}`;
  return `${prefix} (${side} ${meta.teeth})`;
}
