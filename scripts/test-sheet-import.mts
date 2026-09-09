/**
 * ทดสอบ src/lib/sheetImport.ts — รันด้วย `npm run test:import`
 *
 * ทำไมต้องมี: หน้านำเข้าประกาศกับอาจารย์ไว้ตรงๆ ว่า "แถวที่อ่านไม่ออกจะขึ้นรายงาน
 * ให้คนตัดสิน ไม่เดาเอง" — คำสัญญานั้นทั้งหมดอยู่ในไฟล์นี้ ถ้ามันเดาเงียบๆ
 * จะไม่มีใครรู้เลย เพราะผลลัพธ์คือ "นำเข้าสำเร็จ" เหมือนเดิมทุกประการ
 * แค่ตัวเลขข้างในผิด และมันคือข้อมูลของทั้งภาคหลายร้อยแถว
 *
 * เน้นเทสต์ 3 กลุ่ม:
 *   1. แถวที่อ่านไม่ออกต้องอยู่ในรายงาน — และผลรวมต้องบวกกลับได้ (นำเข้า + ข้าม = ทั้งหมด)
 *   2. รูปแบบเพี้ยนของชีตจริงที่เคยทำให้ตัวเลขผิดทั้งชั้น (ปี พ.ศ./ค.ศ., ช่องติ๊กหัวว่าง,
 *      คืนเคส, for PT502/PT602, วันที่บันทึกข้อมูล) — มีคอมเมนต์กำกับว่าเคยพังยังไง
 *   3. นำเข้าไฟล์เดิมซ้ำต้องได้ id เดิม ไม่ใช่ข้อมูลชุดใหม่ทั้งชุด
 *
 * หมายเหตุ: scripts/test-import.ts (ของเดิม) เป็นสคริปต์ "พิมพ์รายงานออกมาดูด้วยตา"
 * ไฟล์นี้คือชุดกันถอยหลังที่ต่อเข้า `npm test` — คนละหน้าที่กัน
 */
import { detectType, importGroupCsv, importSheetCsv, parseCsv, parseIntro, parseStudentList, sheetIdFromUrl } from '../src/lib/sheetImport.ts';
import { isComplete, maxProgression, progression } from '../src/domain/rules.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

/** หัวตารางแบบชีตจริง tab PTn (รุ่น 55) */
const HEADER = "No.,Patient's Name-Surname,HN,Prosthodontic work,Accepted date,Minimum Req,Step งานที่ผ่านแล้ว,0,1,2,3,4,5,6,7,8,9,10,Payment,หมายเหตุ / สถานะผู้ป่วย,วันที่บันทึกข้อมูล";
/** ติ๊กถึงขั้น p (ช่อง 0..10) */
const ticks = (p: number) => Array.from({ length: 11 }, (_, i) => (i <= p ? '/' : '')).join(',');
const sheet = (...rows: string[]) => [HEADER, ...rows].join('\n');

/* ── 1. parseCsv — ชีตที่ export ออกมาไม่เคยสะอาด ────────────────────────── */
console.log('\nparseCsv');
ok('ช่องที่มีลูกน้ำอยู่ในเครื่องหมายคำพูด ไม่ถูกตัดเป็นสองช่อง',
  parseCsv('a,"b,c",d')[0].join('|') === 'a|b,c|d', parseCsv('a,"b,c",d')[0].join('|'));
ok('เครื่องหมายคำพูดซ้อน ("") อ่านเป็นตัวอักษรเดียว',
  parseCsv('a,"พูดว่า ""สวัสดี"""')[0][1] === 'พูดว่า "สวัสดี"', parseCsv('a,"พูดว่า ""สวัสดี"""')[0][1]);
ok('BOM หน้าไฟล์ (Excel ชอบใส่) ไม่ติดมากับช่องแรก', parseCsv('﻿HN,x')[0][0] === 'HN');
ok('ขึ้นบรรทัดแบบ CRLF ไม่ทำให้ได้แถวเปล่าคั่น', parseCsv('a,b\r\nc,d').length === 2);
ok('ขึ้นบรรทัดในช่องที่ครอบด้วยคำพูด ยังเป็นแถวเดียว',
  parseCsv('a,"บรรทัด1\nบรรทัด2",c').length === 1);
ok('แถวว่างล้วน (ชีตมีท้ายไฟล์เสมอ) ถูกตัดทิ้ง', parseCsv('a,b\n,,\n\nc,d').length === 2);
ok('ไฟล์ว่าง → ลิสต์ว่าง ไม่พัง', parseCsv('').length === 0);

/* ── 2. detectType — เดาไม่ได้ต้องคืน null ไม่ใช่เดามั่ว ─────────────────── */
console.log('\ndetectType — ตัวย่อที่เจอในชีตจริง');
{
  const cases: Array<[string, string | null]> = [
    ['CD/- (Upper)', 'CD'],
    ['Complicated APD', 'CD'],       // Complicated APD นับรวมกับ CD
    ['ComA', 'CD'],
    ['-/RPD (Lower) Kennedy class II', 'RPD'],
    ['Co-Cr RPD', 'RPD'],
    ['Post-core ซี่ 21', 'PC'],
    ['PCC 46', 'PC'],
    ['46 Crown (PFM)', 'CB'],
    ['FMC 14', 'CB'],
    ['Cr 14', 'CB'],
    ['Recall Removable', 'RRM'],
    ['Recall crown', 'RFX'],
    ['Simple APD', 'APD'],
  ];
  cases.forEach(([label, want]) => ok(`"${label}" → ${want}`, detectType(label) === want, detectType(label)));
  ok('อ่านไม่ออกจริงๆ → null (ไปลงรายงาน ไม่เดา)', detectType('งานอะไรไม่รู้') === null, detectType('งานอะไรไม่รู้'));
  ok('ช่องว่าง → null', detectType('') === null);

  /* เคยพัง: \bcr\b (เพิ่มมาเพื่อรับ "Cr 14" ของชีตรุ่น 54) ไปจับ "cr" ใน "co-cr"
     ทำให้โครง RPD โคบอลต์-โครเมียมถูกนำเข้าเป็น Crown/Bridge โดยไม่มีข้อความในรายงานเลย
     — เกณฑ์ RPD ขาดไปหนึ่ง เกณฑ์ Crown เกินมาหนึ่ง พร้อมกันในชิ้นเดียว
     สองข้อล่างต้องผ่านพร้อมกัน ห้ามแก้ข้อหนึ่งแล้วทำอีกข้อพัง */
  ok('"Co-Cr" ที่มียัติภังค์ ยังเป็น RPD', detectType('Co-Cr RPD Lower') === 'RPD', detectType('Co-Cr RPD Lower'));
  ok('"CoCr" ที่ไม่มียัติภังค์ ก็เป็น RPD', detectType('CoCr framework') === 'RPD', detectType('CoCr framework'));
  ok('แต่ "Cr 14" ยังต้องเป็น Crown เหมือนเดิม', detectType('Cr 14') === 'CB', detectType('Cr 14'));
  ok('นำเข้าจริงแล้วได้ RPD ไม่ใช่ CB',
    importSheetCsv(sheet(`1,นาย ก,HN001,Co-Cr RPD (Lower),5/6/69,Yes,,${ticks(2)},,,`), 's1')
      .workpieces[0].type === 'RPD');
}

/* ── 3. คำสัญญาหลัก: อ่านไม่ออกต้องขึ้นรายงาน ───────────────────────────── */
console.log('\nแถวที่อ่านไม่ออกต้องขึ้นรายงาน ไม่ใช่หายเงียบ');
{
  const r = importSheetCsv(sheet(
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(3)},ชำระแล้ว,,`,
    `2,นาย ข,HN002,งานอะไรไม่รู้,5/6/69,Yes,,${ticks(1)},,,`,
    `3,นาย ค,HN003,CD/- (Upper),ประมาณกลางเดือน,Yes,,${ticks(1)},,,`,
    `4,,,RPD/- (Lower),5/6/69,Yes,,${ticks(1)},,,`,
    `5,นาย จ,,CD/- (Lower),5/6/69,Yes,,${ticks(1)},,,`,
  ), 's1');
  const has = (frag: string) => r.report.issues.some((i) => i.problem.includes(frag));
  ok('ผลรวมบวกกลับได้: นำเข้า + ข้าม = แถวข้อมูลทั้งหมด',
    r.report.imported + r.report.skipped === r.report.totalRows,
    `${r.report.imported}+${r.report.skipped}=${r.report.totalRows}`);
  ok('งานที่เดาประเภทไม่ได้ → ไม่นำเข้า และขึ้นรายงาน',
    r.report.skipped === 1 && has('เดาประเภทงานไม่ได้'));
  ok('วันที่อ่านไม่ออก → ยังนำเข้าแถวนั้น แต่ขึ้นรายงาน', has('อ่านรูปแบบวันที่ไม่ออก'));
  ok('ไม่มี HN → ขึ้นรายงาน (ไม่เงียบ)', has('ไม่มี HN'));
  ok('ไม่มีทั้ง HN และชื่อ → ขึ้นรายงานอีกข้อว่าตั้งผู้ป่วยชั่วคราวให้',
    has('ไม่มีทั้ง HN และชื่อผู้ป่วย'));
  ok('ทุกข้อในรายงานบอกเลขแถวจริง ให้คนกลับไปเปิดชีตถูกบรรทัด',
    r.report.issues.every((i) => i.row >= 0 && Number.isInteger(i.row)));
  ok('ทุกข้อในรายงานบอกชื่อคอลัมน์', r.report.issues.every((i) => i.column.trim().length > 0));
}
{
  const r = importSheetCsv('ไม่มีหัวตารางอะไรเลย\n1,2,3', 's1');
  ok('หาหัวตารางไม่เจอ → ไม่นำเข้าอะไรเลย และบอกเหตุผล',
    r.workpieces.length === 0 && r.report.issues.some((i) => i.problem.includes('หาแถวหัวตาราง')));
}
{
  const r = importSheetCsv('', 's1');
  ok('ไฟล์ว่าง → รายงานเปล่า ไม่พัง', r.workpieces.length === 0 && r.report.totalRows === 0);
}
{
  const r = importSheetCsv(sheet(`1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,/,/,,5 (รอเช็ค),,,,,,,,,,`), 's1');
  ok('ช่องติ๊กมีข้อความแปลก → นับเป็นติ๊กไว้ก่อน แต่ขึ้นรายงาน',
    r.report.issues.some((i) => i.problem.includes('ช่องติ๊กมีข้อความแปลก')));
  ok('ติ๊กข้ามช่อง (มีรูโหว่) → ขึ้นรายงาน',
    r.report.issues.some((i) => i.problem.includes('ติ๊กแบบข้ามช่อง')));
}
{
  const r = importSheetCsv(sheet(`1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,CD-7 Denture finished,${ticks(3)},,,`), 's1');
  ok('droplist ขัดกับช่องติ๊ก → เชื่อช่องติ๊ก แต่ขึ้นรายงาน',
    r.report.issues.some((i) => i.problem.includes('droplist บอกขั้น 7')) && progression(r.workpieces[0]) === 3,
    progression(r.workpieces[0]));
}
{
  /* ชีตรุ่น 54: งาน recall 28 แถวเขียน "Completion of case" ใน droplist แต่ช่องติ๊กว่างหมด
     ถ้าเชื่อช่องติ๊กอย่างเดียวจะอ่านเป็น "ยังไม่เริ่ม" ทั้งที่จบไปแล้ว (ผู้ใช้ทัก 3 ก.ย.) */
  const r = importSheetCsv(sheet(
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,Completion of case,,,,,,,,,,,,,,`,
    `2,นาย ข,HN002,CD/- (Upper),5/6/69,Yes,CD-6 Waxing,,,,,,,,,,,,,,`,
  ), 's1');
  ok('ไม่ติ๊กเลยแต่ droplist บอกว่าปิดเคส → ใช้ค่า droplist และขึ้นรายงาน',
    progression(r.workpieces[0]) === 10 && r.report.issues.some((i) => i.problem.includes('ไม่ได้ติ๊กช่องขั้นตอนเลย')),
    progression(r.workpieces[0]));
  ok('ไม่ติ๊กเลยแต่ droplist บอกขั้นกลางทาง → ใช้ขั้นนั้น', progression(r.workpieces[1]) === 6, progression(r.workpieces[1]));
}
{
  /* ชีตบางปีปล่อยหัวคอลัมน์ 0–10 ว่างแล้วใช้ checkbox ของ Google Sheets แทน
     (ค่าที่ export ออกมาคือ TRUE/FALSE) — ถ้าหาช่องติ๊กไม่เจอ ทุกคนจะเป็น 0% (ผู้ใช้เจอ 2 ก.ย.) */
  const noNumbers = "No.,Patient,HN,Prosthodontic work,Accepted date,Minimum Req,Step งานที่ผ่านแล้ว,,,,,,,,,,,,Payment";
  const r = importSheetCsv([noNumbers,
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,TRUE,TRUE,TRUE,TRUE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,`,
  ].join('\n'), 's1');
  ok('หัวคอลัมน์ว่าง + ใช้ TRUE/FALSE → ยังหาช่องติ๊กเจอ', progression(r.workpieces[0]) === 3, progression(r.workpieces[0]));
  ok('FALSE = ไม่ติ๊ก (ไม่ใช่ "มีข้อความแปลก")',
    !r.report.issues.some((i) => i.problem.includes('ช่องติ๊กมีข้อความแปลก')));
}
{
  const noTicks = "No.,Patient,HN,Prosthodontic work,Accepted date,Minimum Req,Payment";
  const r = importSheetCsv([noTicks, `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,ชำระแล้ว`].join('\n'), 's1');
  ok('หาช่องติ๊กไม่เจอเลย → เตือนว่าความคืบหน้าจะเป็น 0 ทุกแถว',
    r.report.issues.some((i) => i.problem.includes('หาช่องติ๊กขั้นตอนไม่เจอ')));
}

/* ── 4. วันที่ — ปี 2 หลักในชีตปนกันสองแบบ ──────────────────────────────── */
console.log('\nวันที่ — พ.ศ. กับ ค.ศ. ปนกันในชีตเดียว');
{
  const r = importSheetCsv(sheet(
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(1)},,,`,      // พ.ศ. 2 หลัก
    `2,นาย ข,HN002,CD/- (Upper),5/6/2569,Yes,,${ticks(1)},,,`,    // พ.ศ. 4 หลัก
    `3,นาย ค,HN003,CD/- (Upper),2026-06-05,Yes,,${ticks(1)},,,`,  // ISO
    `4,นาย ง,HN004,CD/- (Upper),9/3/26,Yes,,${ticks(1)},,,`,      // ค.ศ. 2 หลัก (เจอในชีตรุ่น 54)
  ), 's1');
  const dates = r.workpieces.map((w) => w.acceptedDate);
  ok('ทั้งสี่รูปแบบแปลงเป็น ISO ได้ตรงกัน', dates.slice(0, 3).every((d) => d === '2026-06-05'), dates.join(' '));
  ok('ปี 2 หลักต่ำกว่า 60 อ่านเป็น ค.ศ. (9/3/26 → 2026-03-09)', dates[3] === '2026-03-09', dates[3]);
  ok('ไม่มีแถวไหนขึ้นรายงานเรื่องวันที่', !r.report.issues.some((i) => i.problem.includes('วันที่')));
}
{
  /* เดิมไม่เช็คช่วงเลย — "25/13/69" ผ่านเป็นเดือน 13 และ "31/2/69" ผ่านเป็น 31 ก.พ.
     เคสจริงที่เจอบ่อยคือชีตที่พิมพ์แบบอเมริกัน (เดือน/วัน/ปี) */
  const r = importSheetCsv(sheet(
    `1,นาย ก,HN001,CD/- (Upper),25/13/69,Yes,,${ticks(1)},,,`,
    `2,นาย ข,HN002,CD/- (Upper),31/2/69,Yes,,${ticks(1)},,,`,
  ), 's1');
  ok('เดือน 13 → อ่านไม่ออก ขึ้นรายงาน (ไม่ประกอบเป็น 2026-13-25)',
    r.report.issues.filter((i) => i.column === 'Accepted date').length === 2,
    r.workpieces.map((w) => w.acceptedDate).join(' '));
  ok('31 ก.พ. ที่ไม่มีอยู่จริง → อ่านไม่ออก',
    !r.workpieces.some((w) => w.acceptedDate === '2026-02-31'));
}
{
  /* "วันที่บันทึกข้อมูล" = ครั้งสุดท้ายที่มีคนแตะแถวนี้ ถ้าไม่อ่าน ทุกชิ้นจะถูกประทับว่า
     เพิ่งอัปเดตวันนี้ → ตัวนับ "เคสค้างเกิน N วัน" ขึ้น 0 ตลอด ทั้งที่บางเคสไม่ขยับมาเป็นเดือน */
  const r = importSheetCsv(sheet(
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(1)},ชำระแล้ว,,1/7/69`,
    `2,นาย ข,HN002,CD/- (Upper),5/6/69,Yes,,${ticks(1)},ชำระแล้ว,,`,
  ), 's1');
  ok('มีวันที่บันทึกข้อมูล → ใช้เป็นวันอัปเดตล่าสุด ไม่ใช่วันนำเข้า',
    r.workpieces[0].lastUpdatedAt.startsWith('2026-07-01'), r.workpieces[0].lastUpdatedAt);
  ok('ไม่มีวันที่บันทึกข้อมูล → ใช้วันนำเข้า (อธิบายได้ ไม่ใช่ค่าว่าง)',
    r.workpieces[1].lastUpdatedAt.length > 0);
}

/* ── 5. รูปแบบของชีตรุ่น 54 ที่เคยทำให้ทั้งชั้นเป็นแถบแดง ────────────────── */
console.log('\nชีตรุ่น 54 — คอลัมน์ "การนับชิ้นงาน" แทน "Minimum Req"');
{
  /* ไม่มีคอลัมน์ Minimum Req แต่เขียน "for PT602" / "for PT502" แทน ถ้าไม่อ่านคอลัมน์นี้
     ทุกชิ้นจะไม่นับเข้าเกณฑ์เลย (ผู้ใช้เจอ 3 ก.ย.: แถบเกณฑ์แดงทั้งแถว ทั้งที่จบไปหลายร้อยชิ้น) */
  const h54 = "No.,Patient,HN,Prosthodontic work,Accepted date,การนับชิ้นงาน PT602 = Yr6 · PT502 = Yr5,Step งานที่ผ่านแล้ว,0,1,2,3,4,5,6,7,8,9,10,Payment,หมายเหตุ";
  const r = importSheetCsv([h54,
    `1,นาย ก,HN001,CD/- (Upper),5/6/68,for PT502,,${ticks(10)},ชำระแล้ว,`,
    `2,นาย ข,HN002,CD/- (Upper),5/6/69,for PT602,,${ticks(10)},ชำระแล้ว,`,
    `3,นาย ค,HN003,CD/- (Upper),5/6/69,คืนเคส,,${ticks(4)},ชำระแล้ว,`,
    `4,นาย ง,HN004,CD/- (Upper),5/6/69,,,${ticks(4)},ชำระแล้ว,คืนเคสเพราะคนไข้ย้ายจังหวัด`,
  ].join('\n'), 's1', 2569);
  const [a, b, c, d] = r.workpieces;
  ok('"for PT502/PT602" = นับเข้าเกณฑ์ (แทนคอลัมน์ Minimum Req)',
    a.minimumRequirement && b.minimumRequirement);
  ok('"for PT502" (ปี 5) → นับเข้าปีที่รุ่นนี้ขึ้นคลินิก', a.countsForYear === 2569, a.countsForYear);
  ok('"for PT602" (ปี 6) → นับเข้าปีถัดไป', b.countsForYear === 2570, b.countsForYear);
  ok('ไม่ส่งรุ่นมา → ไม่เดาปีให้ (ปล่อยว่างดีกว่าเดาผิด)',
    importSheetCsv([h54, `1,นาย ก,HN001,CD/- (Upper),5/6/68,for PT502,,${ticks(10)},,`].join('\n'), 's1')
      .workpieces[0].countsForYear === undefined);
  /* คืนเคสเขียนได้ทั้งช่องหมายเหตุ (รุ่น 55) และช่องการนับชิ้นงาน (รุ่น 54 ใช้ 123 แถว)
     ถ้าไม่แยกออก งานที่คืนไปแล้วจะเป็นภาระค้างของนักศึกษาตลอดไป */
  ok('"คืนเคส" ในช่องการนับชิ้นงาน → ติดธงคืนเคส', c.returned === true);
  ok('"คืนเคส" ในช่องหมายเหตุ → ติดธงคืนเคส และเก็บข้อความไว้',
    d.returned === true && (d.returnNote ?? '').includes('ย้ายจังหวัด'), d.returnNote);
  ok('แถวที่คืนเคสไม่ถูกนับเข้าเกณฑ์', !c.minimumRequirement);
}

/* ── 6. จบเคสแล้วต้องมีวันจบ — ทุกประเภท ไม่ใช่แค่ที่จบที่ขั้น 10 ────────── */
console.log('\nจบเคสแล้วต้องมี completedAt');
{
  const r = importSheetCsv(sheet(
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(10)},ชำระแล้ว,,`,
    `2,นาย ข,HN002,Recall Removable,5/6/69,Yes,,${ticks(3)},ชำระแล้ว,,`,
    `3,นาย ค,HN003,CD/- (Upper),5/6/69,Yes,,${ticks(6)},ชำระแล้ว,,`,
  ), 's1');
  const [cd, recall, midway] = r.workpieces;
  ok('CD ติ๊กครบ 0–10 → จบเคส และมีวันจบ', isComplete(cd) && !!cd.completedAt);
  ok('CD ที่ยังไม่จบ → ไม่มีวันจบ', !isComplete(midway) && midway.completedAt === undefined);
  /* Recall มีแค่ 4 ขั้น (0–3) ติ๊กครบ 4 ช่องคือจบเคสแล้ว — ตัว import เองก็รู้เรื่องนี้
     (มี topStep = 3 ใช้ตอนอ่าน droplist) แต่เงื่อนไขให้วันจบดัน hard-code ไว้ที่ 10
     ผลคือเคส recall ที่นำเข้ามาจะ "จบแล้วแต่ไม่มีวันจบ" — ทุกที่ที่นับจากวันจบ
     (เกณฑ์รายปีเวลาภาคเปิดให้นับทุกประเภท, กราฟจบเคสต่อเดือน, ระยะเวลาต่อประเภท,
     เส้นสะสม) จะมองไม่เห็นงานพวกนี้เลย ทั้งที่หน้ารายคนขึ้นว่าจบแล้ว */
  ok('Recall ติ๊กครบ 0–3 → นับว่าจบเคส',
    isComplete(recall) && progression(recall) === maxProgression(recall), progression(recall));
  ok('Recall ที่จบแล้ว ต้องมีวันจบเหมือนประเภทอื่น', !!recall.completedAt, String(recall.completedAt));
}

/* ── 7. นำเข้าซ้ำต้องทับของเดิม ไม่ใช่เพิ่มชุดใหม่ ──────────────────────── */
console.log('\nนำเข้าไฟล์เดิมซ้ำ');
{
  /* เดิม id ใช้ Date.now() → นำเข้าไฟล์เดิมซ้ำได้ข้อมูลชุดใหม่ทั้งชุด
     อันตรายตรงที่ชิ้นงานที่จบแล้วถูกนับซ้ำเข้าเกณฑ์ = บอกนักศึกษาว่าทำครบทั้งที่ทำชิ้นเดียว */
  const csv = sheet(
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(10)},ชำระแล้ว,,`,
    `2,นาย ก,HN001,CD/- (Lower),5/6/69,Yes,,${ticks(10)},ชำระแล้ว,,`,
  );
  const a = importSheetCsv(csv, 's1');
  const b = importSheetCsv(csv, 's1');
  ok('นำเข้าซ้ำได้ id ชิ้นงานเดิมทุกชิ้น',
    a.workpieces.map((w) => w.id).join() === b.workpieces.map((w) => w.id).join());
  ok('นำเข้าซ้ำได้ id ผู้ป่วยเดิม', a.patients[0].id === b.patients[0].id);
  ok('ผู้ป่วยคนเดียวกันสองแถว รวมเป็นคนเดียว', a.patients.length === 1 && a.workpieces.length === 2);
  ok('นักศึกษาคนละคน ได้ id ผู้ป่วยคนละตัว แม้ HN เดียวกัน',
    importSheetCsv(csv, 's2').patients[0].id !== a.patients[0].id);
  // แถวที่ก๊อปซ้ำกันเป๊ะในไฟล์เดียว ต้องไม่ทับกันเองจนหายไปหนึ่งแถว
  const dup = sheet(
    `1,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(3)},,,`,
    `2,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(3)},,,`,
  );
  const d = importSheetCsv(dup, 's1');
  ok('แถวที่เหมือนกันเป๊ะสองแถว ยังได้ 2 ชิ้นงาน id ต่างกัน',
    d.workpieces.length === 2 && d.workpieces[0].id !== d.workpieces[1].id);
}

/* ── 8. tab กลุ่ม (PTn) — หนึ่งแท็บมีนักศึกษาหลายคน ─────────────────────── */
console.log('\nimportGroupCsv — แบ่งบล็อกรายคนจากรหัส 7 หลัก');
{
  const h = "ID,Patient,HN,Prosthodontic work,Accepted date,Minimum Req,Step งานที่ผ่านแล้ว,0,1,2,3,4,5,6,7,8,9,10,Payment,หมายเหตุ,Sect II. Pt. exam & tx. plan,,Design RPD";
  const csv = [h,
    `6504001 สมชาย ใจดี,นาย ก,HN001,CD/- (Upper),5/6/69,Yes,,${ticks(10)},ชำระแล้ว,,Yes,No,Yes`,
    `,นาย ก,HN001,CD/- (Lower),5/6/69,Yes,,${ticks(4)},ชำระแล้ว,,,,`,
    `6504002 สมหญิง ดีใจ,นาย ข,HN002,46 Crown,5/6/69,Yes,,${ticks(2)},ชำระแล้ว,,,,`,
    `6509999 คนไม่มีในระบบ,นาย ค,HN003,CD/- (Upper),5/6/69,Yes,,${ticks(1)},ชำระแล้ว,,,,`,
  ].join('\n');
  const roster: Record<string, string> = { '6504001': 'st-a', '6504002': 'st-b' };
  const g = importGroupCsv(csv, (code) => roster[code] ?? null, 2569);
  ok('แบ่งได้ 3 บล็อก', g.blocks.length === 3, g.blocks.length);
  ok('แถวที่ไม่มีรหัสนำหน้า ตกเป็นของคนก่อนหน้า', g.blocks[0].result.workpieces.length === 2,
    g.blocks[0].result.workpieces.length);
  ok('คนที่ไม่มีในระบบ → ไม่นำเข้า และขึ้นรายงานให้ไปนำเข้ารายชื่อก่อน',
    g.blocks[2].studentId === null && g.blocks[2].result.workpieces.length === 0
    && g.blocks[2].result.report.issues.some((i) => i.problem.includes('ไม่พบนักศึกษารหัสนี้')));
  ok('ชิ้นงานผูกกับ id ของนักศึกษาคนนั้น ไม่ปนกัน',
    g.blocks[0].result.workpieces.every((w) => w.studentId === 'st-a')
    && g.blocks[1].result.workpieces.every((w) => w.studentId === 'st-b'));
  /* คอลัมน์รายคน Sect II Removable/Fixed + Design RPD อยู่บรรทัดแรกของบล็อก
     ชีตรุ่น 54 กรอกไว้ 86/88 คน แต่แอปไม่เคยอ่าน (3 ก.ย.) */
  ok('อ่านธง Sect II / Design RPD จากบรรทัดแรกของบล็อก',
    g.blocks[0].gates?.sect2Removable === true && g.blocks[0].gates?.sect2Fixed === false
    && g.blocks[0].gates?.designRpd === true, JSON.stringify(g.blocks[0].gates));
  ok('ช่องที่ไม่ได้กรอก → ไม่มีธง (ไม่เดาว่า "ไม่ผ่าน")', g.blocks[1].gates === undefined,
    JSON.stringify(g.blocks[1].gates));
  ok('"for PT502/PT602" ใช้รุ่นของทั้งชีต ไม่คิดจากรหัสรายคน',
    g.blocks[0].result.workpieces.every((w) => w.countsForYear === undefined || w.countsForYear === 2569));
}
{
  const g = importGroupCsv('HN,Prosthodontic work\n,ไม่มีรหัสนักศึกษาเลย', () => null);
  ok('ไม่มีรหัส 7 หลักในคอลัมน์แรก → ไม่นำเข้า และบอกเหตุผล',
    g.blocks.length === 0 && g.fileIssues.some((i) => i.problem.includes('แบ่งบล็อกรายคนไม่ได้')));
}

/* ── 9. tab Student list + INTRO ─────────────────────────────────────────── */
console.log('\nparseStudentList / parseIntro / sheetIdFromUrl');
{
  const csv = [
    'No.,ID,First name,Last name,Group,Advisor',
    '1,6504001,สมชาย,ใจดี,TH-PT1,สมศรี/สมปอง',
    '2,ไม่ใช่รหัส,สมหญิง,ดีใจ,TH-PT1,สมศรี/สมปอง',
    '3,6504003,สมปอง,ใจงาม,PT1,สมศรี/สมปอง',
  ].join('\n');
  const { entries, issues } = parseStudentList(csv);
  ok('รับเฉพาะแถวที่อ่านรหัส 7 หลักได้', entries.length === 1 && entries[0].code === '6504001', entries.length);
  ok('แถวที่รหัสอ่านไม่ได้ → ขึ้นรายงาน', issues.some((i) => i.problem.includes('อ่านรหัสนักศึกษา 7 หลักไม่ได้')));
  ok('กลุ่มที่รูปแบบไม่ตรง TH-PTn → ขึ้นรายงาน ไม่เดา', issues.some((i) => i.problem.includes('รูปแบบกลุ่มไม่ตรง')));
  ok('ประกอบชื่อ-นามสกุลเข้าด้วยกัน', entries[0].name === 'สมชาย ใจดี', entries[0].name);
  ok('ไม่มีหัวตาราง Group → บอกเหตุผล', parseStudentList('a,b\n1,2').issues.some((i) => i.problem.includes('Group')));
}
{
  /* แท็บ INTRO บอกรุ่นของชีตไว้ตรงๆ — ใช้ยืนยันแทนการเดาจากรหัสนักศึกษา (นศ. ตกรุ่นทำให้เพี้ยน) */
  const intro = parseIntro('รายวิชา,DTPT 602\nนศ.ทพ.ชั้นปีที่,6\nปีการศึกษา,2569');
  ok('อ่านชั้นปี/ปีการศึกษา/รหัสวิชา จาก INTRO ได้',
    intro.studentYear === 6 && intro.academicYear === 2569 && intro.course === 'DTPT 602', JSON.stringify(intro));
  ok('INTRO ที่ไม่มีข้อมูล → ไม่เดาค่าให้', JSON.stringify(parseIntro('อะไรก็ไม่รู้')) === '{}');
}
{
  ok('ดึง sheet id จากลิงก์เต็มได้',
    sheetIdFromUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0')
      === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  ok('วาง id ตรงๆ ก็ได้', sheetIdFromUrl('1AbCdEfGhIjKlMnOpQrStUvWxYz012345') === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  ok('ลิงก์มั่ว → null ไม่ใช่ id เพี้ยน', sheetIdFromUrl('https://example.com/abc') === null);
}

console.log(bad ? `\n❌ ตก ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
