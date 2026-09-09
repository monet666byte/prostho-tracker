import { TYPES } from '../domain/catalog';
import { currentProc, maxProgression, percentCompleted, procLabel, progression } from '../domain/rules';
import type { WorkpieceView } from '../domain/types';
import { toSheetDate } from './date';
import { caseCode, maskedHn, maskedName } from './privacy';
import { pdpaPolicy, type PdpaRole } from '../data/pdpaSync';
import { cloudEnabled, supabase } from './cloud';
import { logAudit } from '../data/repo';

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

/**
 * ไฟล์ที่ส่งออกมีชื่อ+HN จริงไหม
 *  identified = true  → เหมือนชีตเดิมทุกช่อง (ใช้ได้เฉพาะบทบาทที่ภาคเปิดสิทธิ์ให้)
 *  identified = false → ช่องชื่อกลายเป็นรหัสเคส · ช่อง HN ถูกปิดบัง
 * ชื่อคอลัมน์คงเดิมทั้งสองแบบ เพราะไฟล์ต้องเปิดในชีตของภาคได้เหมือนกัน
 */
export interface CsvOptions {
  identified: boolean;
}

export function toCsvRows(works: WorkpieceView[], opt: CsvOptions): string[][] {
  return works.map((w, i) => {
    const cur = currentProc(w);
    const note = [
      w.patient.note ?? '',
    ].filter(Boolean).join(' · ');

    return [
      String(i + 1),
      opt.identified ? w.patient.name : `${caseCode(w.patient.id)} (${maskedName(w.patient.name)})`,
      opt.identified ? w.patient.hn : maskedHn(w.patient.hn),
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

/**
 * เซลล์ที่ Excel/Google Sheets จะตีความเป็น "สูตร" ไม่ใช่ข้อความ
 *
 * ไฟล์นี้ทำมาให้เปิดใน Excel โดยตรง (ใส่ BOM ไว้เพื่อการนั้นเลย) และช่อง
 * "หมายเหตุ / สถานะผู้ป่วย" มาจากที่นักศึกษาพิมพ์เอง — พิมพ์อะไรลงไปก็ได้
 * ถ้าปล่อยผ่าน อาจารย์เปิดไฟล์แล้วสูตรทำงานทันทีโดยไม่ได้กดอะไรเลย
 * (=HYPERLINK ทำลิงก์หลอก · สูตรแบบ DDE เรียกโปรแกรมภายนอกได้ในบางเวอร์ชัน)
 *
 * `-` ต้องระวังเป็นพิเศษ: ป้ายชิ้นงานจริงในชีตขึ้นต้นด้วย "-/" อยู่แล้ว
 * (เช่น "-/Complicated RPD (Lower เหลือไม่เกิน 4 ซี่)") ซึ่งเป็นข้อความล้วน
 * จึงกันเฉพาะ `-` ที่ตามด้วยอย่างอื่นที่อาจกลายเป็นสูตรได้จริง
 */
const FORMULA_LEAD = /^(?:[=+@\t\r]|-(?![/\s]))/;

function escapeCell(v: string): string {
  /* นำหน้าด้วย ' = วิธีมาตรฐานที่บอก Excel ว่า "อันนี้เป็นข้อความ" — ตัวโปรแกรมไม่แสดง ' ให้เห็น
     ตัวอ่านชีตของเราเองก็ตัด ' นำหน้าทิ้งตอนนำเข้า (lib/sheetImport.ts) ค่าจึงวิ่งกลับมาเท่าเดิม */
  const safe = FORMULA_LEAD.test(v) ? `'${v}` : v;
  // \r ต้องอยู่ในลิสต์ด้วย ไม่งั้นไฟล์ที่มี CRLF ในเซลล์จะแตกแถวตอนเปิด
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCsv(works: WorkpieceView[], opt: CsvOptions): string {
  const rows = [CSV_COLUMNS, ...toCsvRows(works, opt)];
  // BOM เพื่อให้ Excel อ่านภาษาไทยถูก
  return '﻿' + rows.map((r) => r.map(escapeCell).join(',')).join('\n');
}

function downloadCsv(works: WorkpieceView[], filename: string, opt: CsvOptions): void {
  const blob = new Blob([buildCsv(works, opt)], { type: 'text/csv;charset=utf-8' });
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

/* ══════════════════════════════════════════════════════════════════
   สิทธิ์ส่งออก + audit  (PDPA · 9 ก.ย. 69)

   เดิมปุ่มส่งออกใครกดก็ได้ และไม่มีร่องรอยว่าใครดึงอะไรออกไปเมื่อไหร่
   ตอนนี้ทุกการส่งออกต้องผ่าน exportCsv() ตัวเดียว ซึ่งทำสามอย่างตามลำดับ
     ① ถามนโยบายของภาค (pdpa_policy) ว่าบทบาทนี้ส่งออกได้ไหม และได้แบบมีชื่อไหม
     ② จดลง audit ที่ฝั่งเซิร์ฟเวอร์ก่อน (log_export) — เวลาและตัวตนมาจากเซิร์ฟเวอร์
     ③ จดผ่านแล้วค่อยสร้างไฟล์ · จดไม่ผ่าน = ไม่มีไฟล์

   ⚠️ ขอบเขตที่ทำได้จริง — เขียนไว้ตรงนี้กันเข้าใจผิด:
   นี่คือการคุม "ปุ่มในแอป" ไม่ใช่การคุม "การเอาข้อมูลออก" ทั้งหมด
   คนที่เขียนสคริปต์ยิง REST API อ่านแถวเองแล้วประกอบไฟล์เองยังทำได้อยู่
   ตัวคุมของกรณีนั้นคือ RLS (migration 0004–0012) ว่าบัญชีนั้นอ่านแถวไหนได้บ้าง
   ══════════════════════════════════════════════════════════════════ */

export type ExportScope = 'own-progress' | 'group' | 'cohort';

export interface ExportRequest {
  scope: ExportScope;
  works: WorkpieceView[];
  filename: string;
  /** ขอไฟล์ที่มีชื่อ+HN จริง — ไม่มีสิทธิ์จะถูกลดเป็นไฟล์ปิดบังให้เอง ไม่ใช่ปฏิเสธทิ้ง */
  wantIdentified: boolean;
  role: PdpaRole;
  /** ส่งออกของนักศึกษาคนไหน (ถ้าเป็นรายคน) — เซิร์ฟเวอร์ใช้ตรวจว่า นศ. ดึงของตัวเองจริง */
  studentId?: string;
  groupCode?: string;
  /** ชื่อคนกด — ใช้ตอนไม่มีเซิร์ฟเวอร์ (โหมด local) เท่านั้น */
  actor: string;
}

export type ExportResult =
  | { ok: true; identified: boolean; downgraded: boolean }
  | { ok: false; reason: string };

/** ตรวจสิทธิ์ล้วนๆ ไม่ยิงเน็ต — หน้าจอใช้ตัดสินว่าปุ่มควรกดได้ไหม และควรเขียนป้ายว่าอะไร */
export function exportPermission(role: PdpaRole): { allowed: boolean; identified: boolean } {
  const pol = pdpaPolicy();
  return {
    allowed: pol.exportRoles.includes(role),
    identified: pol.exportIdentifiedRoles.includes(role),
  };
}

/**
 * ส่งออก CSV — ประตูเดียวของทั้งแอป
 * คืน ok:false พร้อมเหตุผลเป็นภาษาคน เอาไปโชว์ toast ได้เลย (ยังไม่ต้องแปลซ้ำ)
 */
export async function exportCsv(req: ExportRequest): Promise<ExportResult> {
  const perm = exportPermission(req.role);
  if (!perm.allowed) {
    return { ok: false, reason: 'ภาควิชายังไม่ได้เปิดสิทธิ์ส่งออกให้บทบาทนี้' };
  }
  const identified = req.wantIdentified && perm.identified;
  const downgraded = req.wantIdentified && !perm.identified;

  // ① จด audit ก่อนสร้างไฟล์เสมอ — ไฟล์ที่ออกไปแล้วเรียกคืนไม่ได้ แต่แถว audit ที่ยังไม่ได้จดเติมทีหลังไม่ได้เหมือนกัน
  if (cloudEnabled && supabase) {
    const { error } = await supabase.rpc('log_export', {
      p_scope: req.scope,
      p_row_count: req.works.length,
      p_identified: identified,
      p_student_id: req.studentId ?? null,
      p_group_code: req.groupCode ?? null,
      p_note: req.filename,
    });
    // เซิร์ฟเวอร์เป็นคนตัดสินคนสุดท้าย — ฝั่งแอปเช็คไปแล้วก็จริง แต่ค่าในเครื่องอาจเก่ากว่าของจริง
    if (error) return { ok: false, reason: error.message };
  } else {
    // โหมด local/เดโม: ไม่มีเซิร์ฟเวอร์ให้จด ก็จดในเครื่อง (ข้อมูลเป็นของสมมติทั้งหมด)
    await logAudit(
      `ส่งออกข้อมูล (${req.scope}) ${req.works.length} แถว${identified ? ' · มีชื่อและ HN' : ' · ปิดบังชื่อและ HN'}`,
      req.actor,
      { studentId: req.studentId },
    );
  }

  // ② จดผ่านแล้วค่อยสร้างไฟล์
  downloadCsv(req.works, req.filename, { identified });
  return { ok: true, identified, downgraded };
}
