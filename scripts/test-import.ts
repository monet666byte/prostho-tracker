/** ทดสอบตัวนำเข้าชีต — รัน: npx tsx scripts/test-import.ts */
import { importSheetCsv } from '../src/lib/sheetImport';

const csv = `DTPT502 กลุ่ม PT7 (หัวเรื่องเกะกะที่ชีตชอบมี)
No.,Patient's Name-Surname,HN,Prosthodontic work (one piece per row),Accepted date,Minimum Req (Yes/No),Step งานที่ผ่านแล้ว,0,1,2,3,4,5,6,7,8,9,10,% Completed,Payment,หมายเหตุ / สถานะผู้ป่วย,Sect II Removable,Sect II Fixed,Design RPD,วันที่บันทึกข้อมูล dd/mm/yy
1,นาย สมมติ ใจดี,66-01234,CD/- (Upper),5/6/67,Yes,CD-5,✓,✓,✓,✓,✓,✓,,,,,,55%,ชำระแล้ว,,Yes,No,,19/6/67
2,นาย สมมติ ใจดี,66-01234,CD/- (Lower),5/6/67,Yes,CD-5,✓,✓,✓,✓,✓,✓,,,,,,55%,ชำระแล้ว,,Yes,No,,19/6/67
3,นาง ทดสอบ ระบบ,66-05678,46 Crown (PFM),12/6/2567,Yes,,✓,✓,✓,✓,✓,✓,✓,✓,✓,✓,✓,100%,ยังไม่ชำระ,นัด recall 6 เดือน,No,Yes,,30/8/67
4,นาย ขาดตก บกพร่อง,,RPD/- (Lower) Kennedy class II,,No,,✓,✓,,,,,,,,,,20%,,รอ pre-prosth,Yes,No,ยังไม่ออกแบบ,
5,นส. ข้อมูล เพี้ยน,66-09999,งานอะไรไม่รู้อ่านไม่ออก,ไม่ใช่วันที่,Yes,,✓,,,,,,,,,,,10%,,,No,No,,
6,นาย ติ๊กแปลก มาก,66-11111,Post-core ซี่ 21,24/7/67,Yes,,✓,✓,✓,5 (รอเช็ค),,,,,,,,30%,ยกเว้น,,No,Yes,,
7,นส. วันที่ เพี้ยน,66-22222,RPD/- (Upper) Kennedy class III,ประมาณกลางเดือน,Yes,,✓,✓,,,,,,,,,,15%,,,Yes,No,,
,,,,,,,,,,,,,,,,,,,,,,,,
รวม,6 ชิ้น,,,,,,,,,,,,,,,,,,,,,,,`;

const r = importSheetCsv(csv, 'st-demo-1');
console.log('=== รายงานการนำเข้า ===');
console.log(`แถวข้อมูล: ${r.report.totalRows} · นำเข้าได้: ${r.report.imported} · ข้าม: ${r.report.skipped}`);
console.log(`ผู้ป่วย: ${r.patients.length} คน · ชิ้นงาน: ${r.workpieces.length} ชิ้น`);
console.log('\n--- ปัญหาที่ต้องให้คนดู ---');
r.report.issues.forEach((i) => console.log(`แถว ${i.row} [${i.column}] "${i.value}" → ${i.problem}`));
console.log('\n--- ชิ้นงานที่ได้ ---');
r.workpieces.forEach((w) => {
  const p = r.patients.find((x) => x.id === w.patientId)!;
  console.log(`${p.name} (HN ${p.hn}) · ${w.type} · ${w.detail} · procIndex=${w.procIndex} · รับเคส ${w.acceptedDate}${w.completedAt ? ' · จบเคสแล้ว' : ''}${w.tooth ? ' · ซี่ ' + w.tooth : ''}`);
});

// assertions แบบบ้านๆ
const fail = (msg: string) => { console.error('❌ ' + msg); process.exit(1); };
if (r.report.imported !== 5) fail(`imported ควรเป็น 5 ได้ ${r.report.imported}`); // 5 = แถวดี 4 + แถววันที่เพี้ยน (นำเข้าได้แต่ติดรายงาน)
if (r.patients.length !== 4) fail(`patients ควรเป็น 4 ได้ ${r.patients.length}`);
if (!r.workpieces.some((w) => w.type === 'CB' && w.completedAt)) fail('Crown ติ๊กครบ 10 ต้องนับจบเคส');
if (!r.report.issues.some((i) => i.problem.includes('HN'))) fail('แถวไม่มี HN ต้องลงรายงาน');
if (!r.report.issues.some((i) => i.problem.includes('ประเภทงาน'))) fail('งานอ่านไม่ออกต้องลงรายงาน');
if (!r.report.issues.some((i) => i.column === 'ช่อง 3')) fail('"5 (รอเช็ค)" ในช่องติ๊กต้องลงรายงาน');
if (!r.report.issues.some((i) => i.problem.includes('วันที่'))) fail('วันที่อ่านไม่ออกต้องลงรายงาน');
const cd = r.workpieces.find((w) => w.type === 'CD');
if (!cd || cd.acceptedDate !== '2024-06-05') fail(`วันที่ พ.ศ. 2 หลักต้องแปลงเป็น 2024-06-05 ได้ ${cd?.acceptedDate}`);
console.log('\n✅ ผ่านทุกข้อ');
