/**
 * ตัวนำเข้าข้อมูลตั้งต้นจาก Google Sheets ของภาค (tab PTn export เป็น CSV)
 *
 * ปรัชญา: ชีตไม่มีวินัย — ตัวนำเข้าจึงต้อง (1) ใจกว้างกับรูปแบบที่เพี้ยนเท่าที่เดาได้อย่างปลอดภัย
 * และ (2) แถวไหนเดาไม่ได้ ให้บันทึกลง "รายงานปัญหา" พร้อมเหตุผล ไม่เดามั่วเด็ดขาด
 *
 * v1 รองรับคอลัมน์ตามรูปแบบ CSV_COLUMNS (ตรงกับ tab PTn) — เจอชีตจริงแล้วค่อยเติมกติกา
 */
import { PROCS, RECALL } from '../domain/catalog';
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
  // ชีตบางปีใช้ช่อง checkbox ของ Google Sheets → ค่าออกมาเป็น TRUE/FALSE (เจอในชีตรุ่น 54)
  if (v === '' || v === 'false' || v === '0') return 'no';
  if (['✓', '✔', 'x', '/', '1', 'y', 'yes', 'ใช่', 'true'].includes(v)) return 'yes';
  return 'odd';
}

/** เดาประเภทงานจากช่อง "Prosthodontic work" — เดาไม่ได้ = null (ไปลงรายงาน) */
export function detectType(label: string): WorkType | null {
  const v = label.toLowerCase();
  if (/recall.*(fix|crown|bridge)/.test(v)) return 'RFX';
  if (/recall/.test(v)) return 'RRM';
  // ตัวย่อที่เจอในชีตจริงรุ่น 55: ComA = Complicated APD (นับ CD) · PCC = Post-core crown
  if (/\bcom\.?\s*a(pd)?\b/.test(v)) return 'CD';
  if (/\bpcc\b/.test(v)) return 'PC';
  if (/post\s*-?\s*core|postcore/.test(v)) return 'PC';
  // FMC = full metal crown · "Cr 14" = crown ซี่ 14 (เจอในชีตรุ่น 54 — ผู้ใช้ส่งมา 2 ก.ย.)
  if (/crown|bridge|cr\s*,?\s*br|\bpfm\b|\bfmc\b|\bcr\b/.test(v)) return 'CB';
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
  // สัญกรณ์ของชีตจริง: ตำแหน่งรอบเครื่องหมาย / คือ บน/ล่าง — "CD/-" = CD บน · "-/RPD" = RPD ล่าง
  const m = label.match(/^\s*([^/]*)\/([^/]*)\s*$/);
  if (m) {
    const upper = m[1].trim() && m[1].trim() !== '-';
    const lower = m[2].trim() && m[2].trim() !== '-';
    if (upper && !lower) return 'upper';
    if (lower && !upper) return 'lower';
  }
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
  // Recall ใช้ลิสต์ 4 ขั้นของตัวเอง — เดิมไปเปิด PROCS แล้วได้ลิสต์ว่าง procIndex ค้าง -1 เสมอ
  const list = type === 'RRM' || type === 'RFX' ? RECALL : PROCS[type === 'APD' ? 'CD' : type] ?? [];
  let idx = -1;
  list.forEach((p, i) => {
    if (p[0] <= maxProgression) idx = i;
  });
  return idx;
}

/**
 * id ต้องคงที่จากเนื้อหาแถว ไม่ใช่จากเวลาที่กดนำเข้า
 *
 * เดิมใช้ Date.now() → นำเข้าไฟล์เดิมซ้ำได้ผู้ป่วยและชิ้นงานชุดใหม่ทั้งชุด
 * อันตรายตรงที่ชิ้นงานที่จบแล้วถูกนับซ้ำเข้าเกณฑ์ → ระบบบอกนักศึกษาว่าทำครบ
 * ทั้งที่ทำชิ้นเดียว  ตอนนี้ id มาจากเนื้อหา นำเข้าซ้ำจึงทับของเดิมแทนที่จะเพิ่ม
 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
const patientId = (studentId: string, hn: string) => `p-imp-${hash(`${studentId}|${hn}`)}`;
/** nth = ลำดับของแถวที่ให้กุญแจซ้ำกันในไฟล์เดียว (ไฟล์เรียงคงที่ ค่าจึงคงที่ด้วย) */
const workpieceId = (studentId: string, hn: string, label: string, accepted: string, nth: number) =>
  `w-imp-${hash(`${studentId}|${hn}|${label}|${accepted}|${nth}`)}`;

/* ── ตัวนำเข้าหลัก ── */

export function importSheetCsv(csvText: string, studentId: string): ImportResult {
  const rows = parseCsv(csvText);
  const issues: ImportIssue[] = [];
  const patients = new Map<string, Patient>(); // key = HN
  const workpieces: Workpiece[] = [];
  const seenRow = new Map<string, number>(); // กันแถวที่เหมือนกันเป๊ะในไฟล์เดียวทับกันเอง

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

  // ชีตจริงมีสองคอลัมน์ที่มีคำว่า name — ของนักศึกษา (คอลัมน์แรก) กับของผู้ป่วย ต้องเจาะจงผู้ป่วยก่อน
  const cPatientName = col(/patient/i);
  const cName = cPatientName >= 0 ? cPatientName : col(/name|ชื่อ/i);
  const cHn = col(/^HN$/i);
  const cWork = col(/prosthodontic|work/i);
  const cAccepted = col(/accepted/i);
  const cMin = col(/min/i);
  /* ชีตรุ่น 54 ไม่มีคอลัมน์ "Minimum Req" แต่ใช้คอลัมน์ "การนับชิ้นงาน PT602 = Yr6 · PT502 = Yr5"
     แทน โดยเขียน "for PT602" / "for PT502" = ชิ้นนี้นับเข้าเกณฑ์ของปีนั้น และ "คืนเคส" = คืนไปแล้ว
     ถ้าไม่อ่านคอลัมน์นี้ ทุกชิ้นจะไม่นับเข้าเกณฑ์เลย (ผู้ใช้เจอ 3 ก.ย.: แถบเกณฑ์แดงทั้งแถว
     ทั้งที่จบเคสไปหลายร้อยชิ้น) */
  const cCount = col(/การนับชิ้นงาน|PT\s?60|PT\s?50/i);
  const cPayment = col(/payment/i);
  const cNote = col(/หมายเหตุ|สถานะ/i);
  const cStep = col(/step.*ผ่าน|ผ่านแล้ว/i); // คอลัมน์ droplist เช่น "CD-3 Final impression"
  /* ช่องติ๊ก 0–10 เรียงติดกัน — ปกติหัวคอลัมน์เขียนเลข 0..10 ไว้
     แต่ชีตบางปีปล่อยหัวว่างแล้วใช้ checkbox แทน (รุ่น 54 — ผู้ใช้เจอ 2 ก.ย. ทำให้ทุกคน 0%)
     จึงหาโดยดูข้อมูลจริง: 11 คอลัมน์ถัดจาก Step ที่มีค่าแบบติ๊ก */
  const looksTick = (v: string) => ['/', '✓', '✔', 'x', '1', 'true', 'false', ''].includes(v.trim().toLowerCase());
  let cTick0 = header.findIndex((h) => h === '0');
  if (cTick0 < 0 && cStep >= 0) {
    const cand = cStep + 1;
    const sample = rows.slice(headerIdx + 1, headerIdx + 40);
    const filled = sample.filter((r) => Array.from({ length: 11 }, (_, k) => (r[cand + k] ?? '')).some((v) => ['/', '✓', '✔', 'true', 'x'].includes(v.trim().toLowerCase())));
    const allTickish = sample.every((r) => Array.from({ length: 11 }, (_, k) => (r[cand + k] ?? '')).every(looksTick));
    if (filled.length > 0 && allTickish) cTick0 = cand;
  }
  if (cTick0 < 0) {
    issues.push({ row: 0, column: 'ช่อง 0–10', value: '-', problem: 'หาช่องติ๊กขั้นตอนไม่เจอ — ความคืบหน้าจะเป็น 0 ทุกแถว โปรดตรวจหัวตารางในชีต' });
  }

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

    let type = detectType(workLabel);
    if (!type) {
      // typo ที่เดาได้อย่างปลอดภัย (ตัวอักษรสลับ/เกิน) — นำเข้าให้ แต่ติดธงให้คนตรวจเสมอ
      const typo: Array<[RegExp, WorkType]> = [[/\bprd\b/i, 'RPD'], [/\brdp\b/i, 'RPD']];
      const hit = typo.find(([re]) => re.test(workLabel));
      if (hit) {
        type = hit[1];
        issues.push({ row: rowNo, column: 'Prosthodontic work', value: workLabel, problem: `สะกดไม่ตรงแบบ — สันนิษฐานว่าเป็น ${hit[1]} โปรดตรวจ` });
      }
    }
    if (!type) {
      issues.push({ row: rowNo, column: 'Prosthodontic work', value: workLabel, problem: 'เดาประเภทงานไม่ได้ (CD/RPD/APD/Post-core/Crown/Recall)' });
      skipped++;
      return;
    }

    const hn = get(cHn);
    const rawName = get(cName).replace(/\s+/g, ' ').trim();
    const name = rawName || (hn ? `ผู้ป่วย HN ${hn}` : '(ไม่ระบุชื่อในชีต)');
    /* ⚠️ แถวที่มีงานจริง (ติ๊กครบ ระบุ Completion) แต่ไม่กรอกทั้ง HN และชื่อ — เจอในชีตรุ่น 54
       เป็นเคส Recall ที่ต่อจากผู้ป่วยแถวก่อน เดิมถูกทิ้งเงียบๆ (ผู้ใช้ขอ 2 ก.ย.: ห้ามมีอะไรหาย)
       ตอนนี้นำเข้าโดยตั้งผู้ป่วยชั่วคราวแยกรายแถว แล้วติดธงให้กลับไปเติมในชีต */
    if (!hn && !rawName) {
      issues.push({
        row: rowNo, column: 'HN', value: workLabel.slice(0, 26),
        problem: 'ไม่มีทั้ง HN และชื่อผู้ป่วย — นำเข้าโดยตั้งผู้ป่วยชั่วคราว โปรดเติมในชีตแล้วนำเข้าซ้ำ',
      });
    }
    if (!hn) {
      // ชีตจริงมีเคสคืบหน้าแล้วแต่ยังไม่กรอก HN เยอะ — ทิ้งไม่ได้ ใช้ชื่อจัดกลุ่มแทนไปก่อน
      issues.push({ row: rowNo, column: 'HN', value: rawName.slice(0, 30), problem: 'ไม่มี HN — จัดกลุ่มผู้ป่วยตามชื่อแทน โปรดเติม HN ในชีตแล้วนำเข้าซ้ำ' });
    }
    const pkey = hn || (rawName ? `ชื่อ:${rawName}` : `แถว:${rowNo}`);

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
      // ชีตจริงมีขัดกันเองบ่อย: droplist บอกขั้นหนึ่ง ช่องติ๊กบอกอีกขั้น — เชื่อช่องติ๊ก แต่ต้องบอกให้คนตรวจ
      const stepLabel = get(cStep);
      const dm = stepLabel.match(/-(\d{1,2})\s/);
      if (dm && maxTick >= 0 && Number(dm[1]) !== maxTick) {
        issues.push({
          row: rowNo, column: 'Step งานที่ผ่านแล้ว', value: stepLabel.slice(0, 30),
          problem: `droplist บอกขั้น ${dm[1]} แต่ช่องติ๊กถึงขั้น ${maxTick} — ใช้ช่องติ๊ก โปรดตรวจในชีต`,
        });
      }
    }

    const patient: Patient = patients.get(pkey) ?? {
      id: patientId(studentId, pkey),
      name,
      hn,
      sexAge: '',
      note: get(cNote) || undefined,
      ownerStudentId: studentId,
    };
    patients.set(pkey, patient);

    /* คืนเคส/ยกเลิก — ชีตเขียนไว้ในคอลัมน์หมายเหตุ (รุ่น 54 มี 89 แถว, รุ่น 55 มี 19)
       ถ้าไม่แยกออก งานที่คืนไปแล้วจะถูกนับเป็นภาระค้างของนักศึกษาตลอดไป */
    const rowNote = get(cNote);
    const countCell = get(cCount);
    // "คืนเคส" เขียนได้ทั้งช่องหมายเหตุ และช่องการนับชิ้นงาน (รุ่น 54 ใช้ช่องหลัง 123 แถว)
    const returned = /คืนเคส|คืนงาน|ยกเลิก(การรักษา)?|ไม่ได้ทำต่อ/.test(rowNote)
      || /คืนเคส|คืนงาน/.test(countCell);
    /* นับเข้าเกณฑ์ไหม — รองรับสองแบบที่ภาคใช้จริง:
       รุ่น 55: คอลัมน์ Minimum Req เขียน Yes/No · รุ่น 54: คอลัมน์การนับชิ้นงานเขียน "for PT602/PT502" */
    const countsToward = /yes|ใช่|✓|✔|y\b/i.test(get(cMin)) || /for\s*PT\s?\d{3}/i.test(countCell);
    const now = new Date().toISOString();
    // แถวที่ซ้ำกันทุกช่องในไฟล์เดียว (เกิดได้จริงเวลาคนก๊อปแถว) ต้องไม่ทับกันเอง
    const wkey = `${pkey}|${workLabel}|${accepted ?? ''}`;
    const nth = (seenRow.get(wkey) ?? 0);
    seenRow.set(wkey, nth + 1);
    workpieces.push({
      id: workpieceId(studentId, pkey, workLabel, accepted ?? '', nth),
      patientId: patient.id,
      studentId,
      type,
      arch: detectArch(workLabel),
      tooth: detectTooth(workLabel),
      detail: workLabel,
      acceptedDate: accepted ?? now.slice(0, 10),
      minimumRequirement: countsToward,
      pendingQualification: false,
      payment: parsePayment(get(cPayment)),
      sect2Removable: type === 'CD' || type === 'RPD' || type === 'APD',
      sect2Fixed: !(type === 'CD' || type === 'RPD' || type === 'APD'),
      procIndex: progressionToProcIndex(type, maxTick),
      lastUpdatedAt: now,
      completedAt: maxTick >= 10 ? now : undefined,
      fromSheet: true,
      returned: returned || undefined,
      returnNote: returned ? rowNote : undefined,
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


/* ── นำเข้าทั้ง tab กลุ่ม (PT1–PT12 ของชีตจริง — 1 tab มีนักศึกษาหลายคน) ──
   คอลัมน์แรกของแถวแรกในบล็อกแต่ละคน = "6504001\nชื่อ\nนามสกุล" แถวถัดๆ ไปว่าง
   จึงไล่จับบล็อกจากรหัส 7 หลักในคอลัมน์แรก แล้วส่งแถวของแต่ละคนเข้าตัวนำเข้าเดิม */

export interface GroupBlock {
  studentCode: string;
  studentName: string;
  studentId: string | null; // จับคู่กับ roster ไม่ได้ = null (ลงรายงาน ไม่นำเข้า)
  result: ImportResult;
}

export interface GroupImportResult {
  blocks: GroupBlock[];
  fileIssues: ImportIssue[];
}

export function importGroupCsv(
  csvText: string,
  resolveStudent: (code: string, name: string) => string | null,
): GroupImportResult {
  const rows = parseCsv(csvText);
  const fileIssues: ImportIssue[] = [];
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim().toUpperCase() === 'HN'));
  if (headerIdx === -1) {
    fileIssues.push({ row: 0, column: '-', value: '-', problem: 'หาแถวหัวตารางไม่เจอ (ต้องมีคอลัมน์ชื่อ HN)' });
    return { blocks: [], fileIssues };
  }
  const header = rows[headerIdx];

  // แบ่งบล็อกรายคนจากคอลัมน์แรก
  const dataRows = rows.slice(headerIdx + 1);
  type Block = { code: string; name: string; rows: string[][]; startRow: number };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  dataRows.forEach((r, i) => {
    const first = (r[0] ?? '').trim();
    const m = first.match(/(\d{7})/);
    if (m) {
      cur = { code: m[1], name: first.replace(m[1], '').replace(/\s+/g, ' ').trim(), rows: [], startRow: i + 1 };
      blocks.push(cur);
    }
    if (cur) cur.rows.push(r);
  });
  if (!blocks.length) {
    fileIssues.push({ row: 0, column: 'คอลัมน์แรก', value: '-', problem: 'ไม่พบรหัสนักศึกษา 7 หลักในคอลัมน์แรก — แบ่งบล็อกรายคนไม่ได้' });
    return { blocks: [], fileIssues };
  }

  const out: GroupBlock[] = blocks.map((b) => {
    const sid = resolveStudent(b.code, b.name);
    if (!sid) {
      return {
        studentCode: b.code,
        studentName: b.name,
        studentId: null,
        result: {
          patients: [], workpieces: [],
          report: {
            totalRows: b.rows.length, imported: 0, skipped: b.rows.length,
            issues: [{ row: b.startRow, column: 'คอลัมน์แรก', value: `${b.code} ${b.name}`, problem: 'ไม่พบนักศึกษารหัสนี้ในระบบ — นำเข้ารายชื่อ (Student list) ก่อน' }],
          },
        },
      };
    }
    // ประกอบ CSV ย่อยของคนนี้ = หัวตารางเดิม + แถวในบล็อก แล้วส่งเข้าตัวนำเข้าเดิม
    const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    const mini = [header, ...b.rows].map((r) => r.map(esc).join(',')).join('\n');
    return { studentCode: b.code, studentName: b.name, studentId: sid, result: importSheetCsv(mini, sid) };
  });
  return { blocks: out, fileIssues };
}

/* ── รายชื่อรุ่นจาก tab "Student list" — ใช้สร้างนักศึกษา+กลุ่มจริงก่อนนำเข้างาน ── */

export interface RosterEntry {
  code: string; // 6504001
  name: string; // ชื่อ นามสกุล (คำนำหน้าตามชีต)
  group: string; // TH-PT1
  advisor: string; // "สมชาย/พจมาน"
}

export function parseStudentList(csvText: string): { entries: RosterEntry[]; issues: ImportIssue[] } {
  const rows = parseCsv(csvText);
  const issues: ImportIssue[] = [];
  const headerIdx = rows.findIndex((r) => r.some((c) => /^group$/i.test(c.trim())));
  if (headerIdx === -1) {
    issues.push({ row: 0, column: '-', value: '-', problem: 'หาแถวหัวตารางไม่เจอ (ต้องมีคอลัมน์ Group)' });
    return { entries: [], issues };
  }
  const header = rows[headerIdx].map((c) => c.trim());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cGroup = col(/^group$/i);
  const cAdvisor = col(/advisor/i);
  const cId = col(/^id$/i);
  const cFirst = col(/first/i);
  const cLast = col(/last/i);
  const entries: RosterEntry[] = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const get = (idx: number) => (idx >= 0 && idx < r.length ? r[idx].trim() : '');
    const idRaw = get(cId);
    const code = (idRaw.match(/(\d{7})/) ?? [])[1];
    if (!code) {
      if (r.some((c) => c.trim())) issues.push({ row: i + 1, column: 'ID', value: idRaw || '(ว่าง)', problem: 'อ่านรหัสนักศึกษา 7 หลักไม่ได้ — ข้ามแถวนี้' });
      return;
    }
    const group = get(cGroup);
    if (!/^TH-?/i.test(group)) {
      issues.push({ row: i + 1, column: 'Group', value: group || '(ว่าง)', problem: 'รูปแบบกลุ่มไม่ตรง TH-PTn — ข้ามแถวนี้' });
      return;
    }
    entries.push({
      code,
      name: `${get(cFirst)} ${get(cLast)}`.trim() || `นศ. ${code}`,
      group,
      advisor: get(cAdvisor),
    });
  });
  return { entries, issues };
}

/* ── ดึงข้อมูลจากลิงก์ Google Sheet โดยตรง (ฝั่งเบราว์เซอร์) ──────────────
   ทำไมสำคัญ: อาจารย์เปิดเว็บสาธารณะแล้ววางลิงก์ชีตของภาค ข้อมูลจริงไหลเข้า
   เครื่องอาจารย์เท่านั้น — ไม่มีข้อมูลผู้ป่วยถูกอัปขึ้นเว็บหรือเข้า repo แม้แต่แถวเดียว
   สิทธิ์เข้าถึงยังเป็นของชีตเอง (ใครเปิดชีตไม่ได้ก็ดึงไม่ได้) */

/** ดึง sheet id จากลิงก์เต็ม หรือรับ id ตรงๆ ก็ได้ */
export function sheetIdFromUrl(input: string): string | null {
  const v = input.trim();
  const m = v.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(v) ? v : null;
}

const gvizUrl = (id: string, tab: string) =>
  `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

export interface FetchedTab {
  tab: string;
  csv: string;
}

/**
 * ดึงทุกแท็บที่ต้องใช้: รายชื่อ + กลุ่ม PT1–PT12
 * แท็บไหนไม่มีก็ข้าม (ชีตบางปีอาจมีไม่ครบ) — คืนเฉพาะที่ดึงได้จริง
 */
export async function fetchCohortTabs(
  sheetId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ roster: string | null; groups: FetchedTab[]; failed: string[] }> {
  const rosterNames = ['Student list', 'Student List', 'รายชื่อ'];
  const groupNames = Array.from({ length: 12 }, (_, i) => `PT${i + 1}`);
  const total = 1 + groupNames.length;
  let done = 0;

  const grab = async (tab: string): Promise<string | null> => {
    try {
      const res = await fetch(gvizUrl(sheetId, tab));
      if (!res.ok) return null;
      const text = await res.text();
      // ชีตที่เข้าไม่ได้จะคืนหน้า HTML ไม่ใช่ CSV
      if (/^\s*</.test(text)) return null;
      return text;
    } catch {
      return null;
    }
  };

  let roster: string | null = null;
  for (const name of rosterNames) {
    roster = await grab(name);
    if (roster) break;
  }
  done++;
  onProgress?.(done, total);

  const groups: FetchedTab[] = [];
  const failed: string[] = [];
  for (const tab of groupNames) {
    const csv = await grab(tab);
    if (csv && /(^|,)"?HN"?(,|$)/im.test(csv.split('\n').slice(0, 6).join('\n'))) groups.push({ tab, csv });
    else failed.push(tab);
    done++;
    onProgress?.(done, total);
  }
  return { roster, groups, failed };
}
