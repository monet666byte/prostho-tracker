/**
 * ตัวนำเข้าข้อมูลตั้งต้นจาก Google Sheets ของภาค (tab PTn export เป็น CSV)
 *
 * ปรัชญา: ชีตไม่มีวินัย — ตัวนำเข้าจึงต้อง (1) ใจกว้างกับรูปแบบที่เพี้ยนเท่าที่เดาได้อย่างปลอดภัย
 * และ (2) แถวไหนเดาไม่ได้ ให้บันทึกลง "รายงานปัญหา" พร้อมเหตุผล ไม่เดามั่วเด็ดขาด
 *
 * v1 รองรับคอลัมน์ตามรูปแบบ CSV_COLUMNS (ตรงกับ tab PTn) — เจอชีตจริงแล้วค่อยเติมกติกา
 */
import { PROCS } from '../domain/catalog';
import type { Patient, Payment, Workpiece, WorkType } from '../domain/types';

export interface ImportIssue {
  row: number; // เลขแถวในไฟล์ (เริ่ม 1 = แถวข้อมูลแรกใต้หัวตาราง)
  column: string;
  value: string;
  problem: string;
}

export interface ImportResult {
  patients: Patient[];
  workpieces: Workpiece[];
  report: {
    totalRows: number;
    imported: number;
    skipped: number;
    issues: ImportIssue[];
  };
}

/* ── CSV parser แบบทนไม้ทนมือ (รองรับ quote, ลูกน้ำในช่อง, BOM) ── */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuote) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') inQuote = false;
      else cell += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* ── ตัวแปลงย่อย ── */

/**
 * ประกอบเป็น ISO เฉพาะเมื่อเป็นวันที่ที่มีอยู่จริงในปฏิทิน
 *
 * เดิมไม่เช็คช่วงเลย — "25/13/69" ผ่านเป็น 2026-13-25 และ "31/2/69" ผ่านเป็น 2026-02-31
 * ทั้งที่หน้านำเข้าประกาศว่า "ไม่เดามั่ว แถวที่อ่านไม่ออกจะขึ้นรายงาน"
 * เคสจริงที่เจอบ่อย: ชีตที่พิมพ์แบบอเมริกัน (เดือน/วัน/ปี) จะกลายเป็นเดือน 13-25
 */
function isoIfReal(year: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(year, mo - 1, d));
  // round-trip: 31 ก.พ. จะเด้งไปเป็น 3 มี.ค. → ค่าไม่ตรง = ไม่มีวันนี้จริง
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** วันที่จากชีต: "25/8/69" (พ.ศ. 2 หลัก) · "25/8/2569" · "2026-08-25" → ISO */
function parseSheetDate(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoIfReal(+iso[1], +iso[2], +iso[3]);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year = 2500 + year - 543; // พ.ศ. 2 หลัก → ค.ศ.
  else if (year > 2400) year -= 543; // พ.ศ. 4 หลัก → ค.ศ.
  if (year < 2000 || year > 2100) return null;
  return isoIfReal(year, parseInt(m[2], 10), parseInt(m[1], 10));
}

/** ช่องติ๊ก: ✓ / 1 / x / yes ฯลฯ = ติ๊ก · ช่องที่มีข้อความอื่น = "ติ๊กแบบมีเงื่อนไข" ให้รายงาน */
function parseTick(s: string): 'yes' | 'no' | 'odd' {
  const v = s.trim().toLowerCase();
  if (v === '') return 'no';
  if (['✓', '✔', 'x', '/', '1', 'y', 'yes', 'ใช่'].includes(v)) return 'yes';
  return 'odd';
}

/** เดาประเภทงานจากช่อง "Prosthodontic work" — เดาไม่ได้ = null (ไปลงรายงาน) */
export function detectType(label: string): WorkType | null {
  const v = label.toLowerCase();
  if (/recall.*(fix|crown|bridge)/.test(v)) return 'RFX';
  if (/recall/.test(v)) return 'RRM';
  if (/post\s*-?\s*core|postcore/.test(v)) return 'PC';
  if (/crown|bridge|cr\s*,?\s*br|\bpfm\b/.test(v)) return 'CB';
  if (/rpd|co-?cr/.test(v)) return 'RPD';
  if (/complicated\s*apd/.test(v)) return 'CD';
  if (/apd/.test(v)) return 'APD';
  if (/\bcd\b|complete\s*denture/.test(v)) return 'CD';
  return null;
}

function detectArch(label: string): 'upper' | 'lower' | undefined {
  const v = label.toLowerCase();
  if (/upper|บน/.test(v)) return 'upper';
  if (/lower|ล่าง/.test(v)) return 'lower';
  return undefined;
}

function detectTooth(label: string): string | undefined {
  const m = label.match(/(?:ซี่|tooth|#)\s*([\d]{1,2}(?:\s*[-–,]\s*\d{1,2})*)/i) ?? label.match(/^(\d{2})\s/);
  return m?.[1]?.replace(/\s+/g, '');
}

function parsePayment(s: string): Payment {
  const v = s.trim();
  if (/ชำระแล้ว|paid/i.test(v)) return 'ชำระแล้ว';
  if (/ยกเว้น|waiv/i.test(v)) return 'ยกเว้น';
  return 'ยังไม่ชำระ';
}

/** progression สูงสุดที่ติ๊ก → procIndex (ชีตติ๊กเป็นราย step ไม่มีขั้นย่อย = ถือว่าจบ step นั้นทั้งก้อน) */
function progressionToProcIndex(type: WorkType, maxProgression: number): number {
  const list = PROCS[type] ?? [];
  let idx = -1;
  list.forEach((p, i) => {
    if (p[0] <= maxProgression) idx = i;
  });
  return idx;
}

let seq = 0;
const uid = (p: string) => `${p}-imp-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/* ── ตัวนำเข้าหลัก ── */

export function importSheetCsv(csvText: string, studentId: string): ImportResult {
  const rows = parseCsv(csvText);
  const issues: ImportIssue[] = [];
  const patients = new Map<string, Patient>(); // key = HN
  const workpieces: Workpiece[] = [];

  if (!rows.length) {
    return { patients: [], workpieces: [], report: { totalRows: 0, imported: 0, skipped: 0, issues } };
  }

  // หาแถวหัวตาราง (แถวที่มีคำว่า HN) — บางชีตมีหัวเรื่อง/แถวว่างนำหน้า
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim().toUpperCase() === 'HN'));
  if (headerIdx === -1) {
    issues.push({ row: 0, column: '-', value: '-', problem: 'หาแถวหัวตารางไม่เจอ (ต้องมีคอลัมน์ชื่อ HN)' });
    return { patients: [], workpieces: [], report: { totalRows: rows.length, imported: 0, skipped: rows.length, issues } };
  }
  const header = rows[headerIdx].map((c) => c.trim());
  const col = (name: RegExp): number => header.findIndex((h) => name.test(h));

  const cName = col(/name|ชื่อ/i);
  const cHn = col(/^HN$/i);
  const cWork = col(/prosthodontic|work/i);
  const cAccepted = col(/accepted/i);
  const cMin = col(/min/i);
  const cPayment = col(/payment/i);
  const cNote = col(/หมายเหตุ|สถานะ/i);
  const cTick0 = header.findIndex((h) => h === '0'); // ช่อง 0–10 เรียงติดกัน

  const dataRows = rows.slice(headerIdx + 1);
  let imported = 0;
  let skipped = 0;

  dataRows.forEach((r, i) => {
    const rowNo = i + 1;
    const get = (idx: number) => (idx >= 0 && idx < r.length ? r[idx].trim() : '');

    const workLabel = get(cWork);
    if (!workLabel) {
      skipped++;
      return; // แถวว่าง/แถวสรุป — ข้ามเงียบๆ
    }

    const type = detectType(workLabel);
    if (!type) {
      issues.push({ row: rowNo, column: 'Prosthodontic work', value: workLabel, problem: 'เดาประเภทงานไม่ได้ (CD/RPD/APD/Post-core/Crown/Recall)' });
      skipped++;
      return;
    }

    const hn = get(cHn);
    const name = get(cName) || `ผู้ป่วย HN ${hn || '?'}`;
    if (!hn) {
      issues.push({ row: rowNo, column: 'HN', value: '(ว่าง)', problem: 'ไม่มี HN — ใช้แยกผู้ป่วยไม่ได้' });
      skipped++;
      return;
    }

    const accepted = parseSheetDate(get(cAccepted));
    if (get(cAccepted) && !accepted) {
      issues.push({ row: rowNo, column: 'Accepted date', value: get(cAccepted), problem: 'อ่านรูปแบบวันที่ไม่ออก (รองรับ d/m/yy พ.ศ. · d/m/yyyy · ISO)' });
    }

    // ช่องติ๊ก 0–10
    let maxTick = -1;
    let gap = false;
    if (cTick0 >= 0) {
      for (let p = 0; p <= 10; p++) {
        const tick = parseTick(get(cTick0 + p));
        if (tick === 'odd') {
          issues.push({ row: rowNo, column: `ช่อง ${p}`, value: get(cTick0 + p), problem: 'ช่องติ๊กมีข้อความแปลก — นับเป็นติ๊กไว้ก่อน โปรดตรวจ' });
        }
        if (tick !== 'no') {
          if (maxTick < p - 1 && maxTick >= 0) gap = true;
          maxTick = p;
        }
      }
      if (gap) {
        issues.push({ row: rowNo, column: 'ช่อง 0–10', value: '-', problem: 'ติ๊กแบบข้ามช่อง (มีรูโหว่กลางทาง) — ใช้ช่องสูงสุดที่ติ๊ก โปรดตรวจ' });
      }
    }

    const patient: Patient = patients.get(hn) ?? {
      id: uid('p'),
      name,
      hn,
      sexAge: '',
      note: get(cNote) || undefined,
      ownerStudentId: studentId,
    };
    patients.set(hn, patient);

    const now = new Date().toISOString();
    workpieces.push({
      id: uid('w'),
      patientId: patient.id,
      studentId,
      type,
      arch: detectArch(workLabel),
      tooth: detectTooth(workLabel),
      detail: workLabel,
      acceptedDate: accepted ?? now.slice(0, 10),
      minimumRequirement: !/no|ไม่/i.test(get(cMin)),
      pendingQualification: false,
      payment: parsePayment(get(cPayment)),
      sect2Removable: type === 'CD' || type === 'RPD' || type === 'APD',
      sect2Fixed: !(type === 'CD' || type === 'RPD' || type === 'APD'),
      procIndex: progressionToProcIndex(type, maxTick),
      lastUpdatedAt: now,
      completedAt: maxTick >= 10 ? now : undefined,
      catalogVersion: 'DTPT502-2569',
    });
    imported++;
  });

  return {
    patients: [...patients.values()],
    workpieces,
    report: { totalRows: dataRows.length, imported, skipped, issues },
  };
}
