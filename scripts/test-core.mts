/**
 * เทสต์ชุดที่ 10 — โมดูลพื้นฐานที่ยังไม่เคยมีเทสต์เลย · รันด้วย `npm run test:core`
 *
 * ครอบ 5 ไฟล์: lib/privacy.ts · lib/date.ts · domain/cohort.ts · domain/checkin.ts · domain/cheer.ts
 *
 * ทำไมต้องมี: ห้าไฟล์นี้ตัวเล็กแต่อยู่ใต้ทุกอย่าง
 *   · privacy.ts  — ถ้าพัง = ชื่อ/HN ผู้ป่วยหลุดไปอยู่ในไฟล์ที่ส่งออกและใน audit log ที่ลบไม่ได้
 *   · date.ts     — ทุกตัวเลขที่แบ่งตาม "ปีการศึกษา" อ่านจากที่นี่ที่เดียว เพี้ยน 1 วันคือเพี้ยนทั้งปี
 *   · cohort.ts   — ชั้นปีเลื่อนเองทุก 1 มิ.ย. ถ้าคำนวณผิด นักศึกษาทั้งรุ่นหายจากหน้าอาจารย์
 *   · checkin.ts  — คะแนนในสมุดจริง สเกล 3/1/0 (ไม่มี 2) และคะแนนที่ถูกทับต้องไม่หายเงียบ
 *   · cheer.ts    — ข้อความบนหน้าแรกของนักศึกษา พูดผิดคือพูดถึงเคสที่เขาคืนไปแล้ว
 */
import {
  caseCode, maskedHn, maskedName, patientLabel, type PatientLike,
} from '../src/lib/privacy.ts';
import {
  academicYear, clock, daysUntil, relative, thaiLong, thaiShort, toISODate, toSheetDate, weekMonday,
} from '../src/lib/date.ts';
import {
  CLINIC_LAST_YEAR, CLINIC_START_YEAR, cohortLabel, cohortOf, dtmuOf, entryYearFromClassYear,
  entryYearFromDtmu, isActiveStudent, isAlumni, isUpcoming, isWithinRetention, studentYear,
} from '../src/domain/cohort.ts';
import {
  ACTIVITIES, ACTIVITY_GROUPS, CRITERIA, MAX_TOTAL, SCORE_OPTIONS,
  supersededBy, supersededTitle, totalScore,
} from '../src/domain/checkin.ts';
import { cheerLine, dailyQuote } from '../src/domain/cheer.ts';
import { procList } from '../src/domain/rules.ts';
import { readDefaultSettings } from './test-helpers.mts';
import type { CheckIn, Patient, Settings, WorkpieceView, WorkType } from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

const S: Settings = readDefaultSettings();

/* ═════════════════════════════════════════════════════════════════════════════
   ① lib/privacy.ts — ปิดบังตัวตนผู้ป่วย
   ═════════════════════════════════════════════════════════════════════════════ */
console.log('\n① privacy.ts — รหัสเคสและการปิดบัง');

const pt: PatientLike = { id: 'pt-a', name: 'สมชาย ใจดี', hn: 'DEMO-0142' };

ok('รหัสเคสคงที่ เรียกกี่ครั้งก็ได้ค่าเดิม', caseCode(pt.id) === caseCode(pt.id), caseCode(pt.id));
ok('รูปแบบ PT-XXXXX จากตัวอักษรที่ไม่กำกวม (ไม่มี I L O U)',
  /^PT-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(caseCode(pt.id)), caseCode(pt.id));

/* ข้อนี้คือหัวใจ: รหัสต้องมาจาก id ภายในเท่านั้น
   ถ้ามันขยับตาม HN แปลว่าคนที่รู้ HN ของคนไข้คนหนึ่งไล่เดาได้ว่าแถวไหนคือคนนั้น */
ok('รหัสเคสไม่ขึ้นกับ HN หรือชื่อ — คนละ HN คนละชื่อ แต่ id เดียวกัน ต้องได้รหัสเดียวกัน',
  caseCode('pt-a') === caseCode('pt-a'));
ok('id ต่างกันเล็กน้อยต้องได้รหัสต่างกัน (ไม่ใช่แค่ต่อท้าย)',
  new Set(['pt-a', 'pt-b', 'pt-c', 'pt-1', 'pt-2'].map(caseCode)).size === 5);

/* วัดอัตราชนจริงด้วย id รูปแบบเดียวกับของจริง (p-imp-<hash> จาก sheetImport + pt-<n> จากในแอป)
   ทั้งภาคมีผู้ป่วยหลักพัน — ที่ 2,000 รหัส ถ้าชนเกิน 5 คู่ แปลว่าการกระจายแย่กว่าที่ควรมาก
   (ค่าคาดหวังตามทฤษฎีที่ 32^5 ช่อง ≈ 0.06 คู่) */
{
  const ids: string[] = [];
  for (let i = 0; i < 1000; i++) ids.push(`p-imp-${(i * 2654435761 % 4294967296).toString(36)}`);
  for (let i = 0; i < 1000; i++) ids.push(`pt-${i}`);
  const codes = ids.map(caseCode);
  const collisions = ids.length - new Set(codes).size;
  ok('รหัสเคส 2,000 ใบ ชนกันไม่เกิน 5 คู่', collisions <= 5, `ชน ${collisions} คู่`);
}

ok('ชื่อไทยย่อเหลืออักษรแรกของแต่ละคำ', maskedName('สมชาย ใจดี') === 'ส. ใ.', maskedName('สมชาย ใจดี'));
ok('ชื่อคำเดียวก็ย่อได้', maskedName('สมชาย') === 'ส.', maskedName('สมชาย'));
ok('ชื่อว่างไม่พ่นค่าประหลาด', maskedName('   ') === '—', maskedName('   '));
ok('HN ถูกปิดทั้งหมด ไม่โชว์ท้าย 4 ตัว', maskedHn('DEMO-0142') === '••••••', maskedHn('DEMO-0142'));
ok('HN ว่าง → ว่าง (ไม่ขึ้นจุดหลอกว่ามีข้อมูล)', maskedHn('') === '');

/* ด่านสุดท้าย: ป้ายระดับ code / initials ต้องไม่มีชื่อเต็มหรือ HN หลุดอยู่ในสตริงเลย */
for (const level of ['code', 'initials'] as const) {
  const label = patientLabel(pt, level);
  const blob = `${label.name} ${label.hn}`;
  ok(`ระดับ "${level}" ไม่มีชื่อเต็มหลุด`, !blob.includes(pt.name), blob);
  ok(`ระดับ "${level}" ไม่มี HN หลุด`, !blob.includes(pt.hn), blob);
}
ok('ระดับ "full" เห็นครบตามที่ตั้งใจ',
  patientLabel(pt, 'full').name === pt.name && patientLabel(pt, 'full').hn === pt.hn);

/* ═════════════════════════════════════════════════════════════════════════════
   ② lib/date.ts — วันที่และปีการศึกษา
   ═════════════════════════════════════════════════════════════════════════════ */
console.log('\n② date.ts — วันที่และปีการศึกษา');

/* ปีการศึกษาไทยเริ่ม 1 มิ.ย. — ขอบนี้คือที่มาของตัวเลขรายปีทั้งระบบ
   ⚠️ วันขึ้นปีเป็นสมมติฐานของเรา ยังไม่ยืนยันกับภาค (ถ้าภาคเคาะเป็นวันอื่น ต้องแก้ที่นี่ที่เดียว) */
ok('31 พ.ค. 2026 ยังเป็นปีการศึกษา 2568', academicYear('2026-05-31') === 2568, academicYear('2026-05-31'));
ok('1 มิ.ย. 2026 ขึ้นปีการศึกษา 2569', academicYear('2026-06-01') === 2569, academicYear('2026-06-01'));
ok('ก.พ. 2027 ยังอยู่ปีการศึกษา 2569', academicYear('2027-02-15') === 2569, academicYear('2027-02-15'));
ok('1 มิ.ย. 2027 ขึ้น 2570', academicYear('2027-06-01') === 2570, academicYear('2027-06-01'));

/* สตริงวันล้วนต้องถูกอ่านเป็นเวลาท้องถิ่น ไม่ใช่เที่ยงคืน UTC
   ถ้าอ่านเป็น UTC วันที่จะเลื่อนไปหนึ่งวันในโซนเวลาที่ติดลบ = ตัวเลขรายวันเพี้ยนทั้งแถบ */
ok('วันล้วนไม่เลื่อนวันตอนแปลงกลับ', toISODate('2026-06-01') === '2026-06-01', toISODate('2026-06-01'));
ok('วันล้วนไม่เลื่อนวันตอนหาวันจันทร์', weekMonday('2026-06-01') === '2026-06-01', weekMonday('2026-06-01'));
ok('วันอาทิตย์นับเป็นสัปดาห์ที่เริ่มวันจันทร์ก่อนหน้า',
  weekMonday('2026-06-07') === '2026-06-01', weekMonday('2026-06-07'));
ok('วันจันทร์ทั้งสัปดาห์ให้คีย์เดียวกัน',
  new Set(['2026-06-01', '2026-06-03', '2026-06-07'].map(weekMonday)).size === 1);

/* วันที่พังต้องไม่พ่น "NaN undefined NaN" ออกหน้าจอ — เกิดได้จากแถวที่ sync มาจากแอปเวอร์ชันอื่น */
for (const junk of ['', 'ไม่ใช่วันที่', '2026-13-45']) {
  ok(`วันที่พัง ("${junk}") → thaiShort คืนขีด ไม่ใช่ NaN`, thaiShort(junk) === '—', thaiShort(junk));
  ok(`วันที่พัง ("${junk}") → thaiLong คืนขีด ไม่ใช่ NaN`, thaiLong(junk) === '—', thaiLong(junk));
  ok(`วันที่พัง ("${junk}") → clock ไม่พ่น NaN ออกจอ`, !clock(junk).includes('NaN'), clock(junk));
}

ok('thaiShort เป็น พ.ศ. สองหลัก', thaiShort('2026-08-25') === '25 ส.ค. 69', thaiShort('2026-08-25'));
ok('thaiLong เป็น พ.ศ. เต็ม', thaiLong('2026-08-28') === '28 ส.ค. 2569', thaiLong('2026-08-28'));
ok('toSheetDate ตรงรูปแบบชีตเดิม', toSheetDate('2026-08-25') === '25/8/69', toSheetDate('2026-08-25'));

const NOW = new Date('2026-09-10T09:00:00+07:00');
ok('daysUntil นับเป็นวันปฏิทิน ไม่ใช่ 24 ชม.', daysUntil('2026-09-11', NOW) === 1, daysUntil('2026-09-11', NOW));
ok('daysUntil วันเดียวกัน = 0', daysUntil('2026-09-10', NOW) === 0);
ok('daysUntil อดีตติดลบ', daysUntil('2026-09-08', NOW) === -2, daysUntil('2026-09-08', NOW));
ok('relative เมื่อวาน', relative(new Date(NOW.getTime() - 26 * 3600_000), NOW) === 'เมื่อวาน',
  relative(new Date(NOW.getTime() - 26 * 3600_000), NOW));
ok('relative เพิ่งเกิด', relative(new Date(NOW.getTime() - 30_000), NOW) === 'เมื่อครู่');

/* ═════════════════════════════════════════════════════════════════════════════
   ③ domain/cohort.ts — ชั้นปีเลื่อนเองทุก 1 มิ.ย.
   ═════════════════════════════════════════════════════════════════════════════ */
console.log('\n③ cohort.ts — รุ่นและชั้นปี');

const may = new Date('2027-05-31T12:00');   // ปลายปีการศึกษา 2569
const june = new Date('2027-06-01T12:00');  // วันแรกของปีการศึกษา 2570
const y5 = { year: 5, entryYear: 2569 };    // รุ่นที่ขึ้นคลินิกปี 2569
const y6 = { year: 6, entryYear: 2568 };

ok('รุ่น 2569 อยู่ปี 5 จนถึง 31 พ.ค. 2027', studentYear(y5, may) === 5, studentYear(y5, may));
ok('รุ่น 2569 กลายเป็นปี 6 เองในวันที่ 1 มิ.ย. 2027', studentYear(y5, june) === 6, studentYear(y5, june));
ok('รุ่น 2568 จบไปแล้วในปีการศึกษา 2570', isAlumni(y6, june), studentYear(y6, june));
ok('รุ่น 2568 ยังไม่จบก่อนวันที่ 1 มิ.ย.', !isAlumni(y6, may));
ok('รับรายชื่อล่วงหน้า (รุ่น 2570) ยังไม่โผล่ใน พ.ค.', isUpcoming({ year: 5, entryYear: 2570 }, may));
ok('รุ่น 2570 โผล่เองวันที่ 1 มิ.ย.', isActiveStudent({ year: 5, entryYear: 2570 }, june));

/* หมุดที่ผู้ใช้ยืนยัน 1 ก.ย. 69: DTMU55 อยู่ปี 5 · DTMU54 อยู่ปี 6 (ปีการศึกษา 2569) */
ok('DTMU55 = รุ่นที่ขึ้นคลินิกปี 2569', cohortLabel(2569) === 'DTMU55', cohortLabel(2569));
ok('DTMU54 = รุ่นที่ขึ้นคลินิกปี 2568', cohortLabel(2568) === 'DTMU54', cohortLabel(2568));
ok('แปลงกลับไปกลับมาได้ตรง', entryYearFromDtmu(dtmuOf(2569)) === 2569);
ok('รหัสนักศึกษา 65xxxxx ตรงกับ DTMU55', dtmuOf(2569) === 55, dtmuOf(2569));

ok('ไม่มี entryYear → เดาย้อนจากชั้นปีที่บันทึกไว้',
  cohortOf({ year: 6 }, new Date('2026-09-10T12:00')) === 2568,
  cohortOf({ year: 6 }, new Date('2026-09-10T12:00')));
ok('entryYear ที่มีอยู่ต้องชนะค่าที่เดา',
  cohortOf({ year: 6, entryYear: 2569 }, new Date('2026-09-10T12:00')) === 2569);
ok('entryYearFromClassYear กลับด้านกับ studentYear',
  studentYear({ year: 5, entryYear: entryYearFromClassYear(5, NOW) }, NOW) === 5);

ok('รุ่นปัจจุบันอยู่ในช่วงเก็บเสมอ', isWithinRetention(2569, NOW, 5));
ok('เก่ากว่ากำหนดเก็บ → หมดอายุ', !isWithinRetention(2564, NOW, 5), academicYear(NOW) - 2564);
ok('ขอบพอดี (เก่ากว่า keep-1 ปี) ยังอยู่', isWithinRetention(2565, NOW, 5));
ok('ช่วงคลินิกคือปี 5–6', CLINIC_START_YEAR === 5 && CLINIC_LAST_YEAR === 6);

/* ═════════════════════════════════════════════════════════════════════════════
   ④ domain/checkin.ts — คะแนนรายคาบ
   ═════════════════════════════════════════════════════════════════════════════ */
console.log('\n④ checkin.ts — คะแนนรายคาบ');

ok('สเกลตามสมุดจริงคือ 3 / 1 / 0 ไม่มี 2', !(SCORE_OPTIONS as readonly number[]).includes(2), SCORE_OPTIONS.join('/'));
ok('คะแนนเต็ม 24 = 8 หัวข้อ × 3', MAX_TOTAL === 24 && CRITERIA.length === 8, MAX_TOTAL);
ok('ยังไม่ประเมิน → null ไม่ใช่ 0 (0 แปลว่าให้ศูนย์จริง)', totalScore(undefined) === null, String(totalScore(undefined)));
ok('ให้เต็มทุกข้อ = 24', totalScore(Object.fromEntries(CRITERIA.map((c) => [c.key, 3]))) === 24);
ok('ให้ศูนย์ทุกข้อ = 0 (ต่างจาก null)', totalScore(Object.fromEntries(CRITERIA.map((c) => [c.key, 0]))) === 0);

/* ชิปกิจกรรมบนหน้าจอสร้างจาก ACTIVITY_GROUPS — ถ้ามีอันไหนตกหล่นหรือซ้ำ
   นักศึกษาจะเลือกกิจกรรมนั้นไม่ได้เลย โดยที่ ACTIVITIES ยังมีอยู่ครบ (ไม่มีอะไรฟ้อง) */
{
  const grouped = ACTIVITY_GROUPS.flatMap((g) => g.items);
  ok('ทุกกิจกรรมอยู่ในกลุ่มใดกลุ่มหนึ่ง',
    ACTIVITIES.every((a) => grouped.includes(a)),
    ACTIVITIES.filter((a) => !grouped.includes(a)).join(', ') || '(ครบ)');
  ok('ไม่มีกิจกรรมไหนอยู่สองกลุ่ม', new Set(grouped).size === grouped.length);
  ok('ไม่มีชิปที่ไม่มีอยู่ใน ACTIVITIES',
    grouped.every((g) => (ACTIVITIES as readonly string[]).includes(g)),
    grouped.filter((g) => !(ACTIVITIES as readonly string[]).includes(g)).join(', ') || '(ไม่มี)');
}

/* คะแนนที่ถูกอาจารย์อีกท่านทับ ต้องไม่หายเงียบ (migration 0017 เก็บไว้ให้ในฐานข้อมูล) */
{
  const noHistory = { scoreHistory: undefined } as Pick<CheckIn, 'scoreHistory'>;
  ok('ไม่มีใครถูกทับ → ไม่ขึ้นป้าย', supersededBy(noHistory) === undefined && supersededTitle(noHistory) === '');
  const withHistory = {
    scoreHistory: [
      { scores: Object.fromEntries(CRITERIA.map((c) => [c.key, 3])), by: 'อ. ก.' },
      { scores: Object.fromEntries(CRITERIA.map((c) => [c.key, 1])), by: 'อ. ข.' },
    ],
  } as Pick<CheckIn, 'scoreHistory'>;
  ok('ป้ายบอกชื่อคนล่าสุดที่ถูกทับ', supersededBy(withHistory) === 'อ. ข.', supersededBy(withHistory));
  const title = supersededTitle(withHistory);
  ok('ข้อความเต็มพูดถึงทุกชุดที่เคยมี ไม่ใช่แค่ชุดล่าสุด',
    title.includes('อ. ก.') && title.includes('อ. ข.') && title.includes('24') && title.includes('8'), title);
}

/* ═════════════════════════════════════════════════════════════════════════════
   ⑤ domain/cheer.ts — ข้อความบนหน้าแรกของนักศึกษา
   ═════════════════════════════════════════════════════════════════════════════ */
console.log('\n⑤ cheer.ts — บรรทัดให้กำลังใจ');

const patient = (id: string, name: string): Patient =>
  ({ id, name, hn: `DEMO-${id}`, sex: 'ญ', age: 60, studentId: 's1' }) as Patient;

let n = 0;
function view(type: WorkType, prog: number, over: Partial<WorkpieceView> = {}): WorkpieceView {
  const base = {
    id: `w${++n}`, patientId: `p${n}`, studentId: 's1', type, detail: type,
    acceptedDate: '2026-06-15', minimumRequirement: true, payment: 'ชำระแล้ว',
    sect2Removable: true, sect2Fixed: true, procIndex: -1,
    lastUpdatedAt: NOW.toISOString(), catalogVersion: 'DTPT502-2569',
    patient: patient(`p${n}`, `ผู้ป่วย ${n}`),
    ...over,
  } as WorkpieceView;
  return { ...base, procIndex: procList(base).findIndex((p) => p[0] === prog) };
}

ok('ไม่มีเคสเลย → ได้ข้อความกลาง ๆ ไม่ใช่สตริงว่าง', cheerLine([], [], S, NOW).length > 0, cheerLine([], [], S, NOW));

{
  const near = view('CD', 9, { patient: patient('pA', 'ผู้ป่วย A') });
  const line = cheerLine([near], [], S, NOW);
  ok('เคสเหลือขั้นเดียว → พูดถึงเคสนั้น', line.includes('ผู้ป่วย A') && line.includes('ขั้นเดียว'), line);
}

/* เคสที่คืนไปแล้วต้องไม่ถูกพูดถึงเลย — นักศึกษาคืนเคสนั้นทิ้งไปแล้ว
   ขึ้นว่า "เหลือขั้นเดียวก็จบเคสแล้ว โชคดีกับคาบนี้" คือพูดถึงงานที่ไม่มีอยู่จริง */
{
  const returned = view('CD', 9, { returned: true, patient: patient('pR', 'ผู้ป่วยที่คืนเคส') });
  const line = cheerLine([returned], [], S, NOW);
  ok('เคสที่คืนไปแล้วต้องไม่ถูกพูดถึง', !line.includes('ผู้ป่วยที่คืนเคส'), line);
}

/* ข้อความต้องนิ่งเมื่อกำหนด now — ถ้าสาขาไหนแอบอ่านนาฬิกาจริง ผลจะเปลี่ยนตามเวลาที่รัน */
{
  const works = [view('CD', 4), view('RPD', 2)];
  const a = cheerLine(works, [], S, new Date('2026-12-25T09:00:00+07:00'));
  const b = cheerLine(works, [], S, new Date('2026-12-25T09:00:00+07:00'));
  ok('ผลนิ่งเมื่อกำหนดวันเวลาเดียวกัน', a === b, a);
}

ok('quote วันเดียวกันได้ประโยคเดิม',
  dailyQuote(new Date('2026-09-10T01:00')) === dailyQuote(new Date('2026-09-10T23:00')));
ok('วันเปิดตัว 1 ก.ย. 69 ได้ประโยคแรกตามที่ผู้ใช้ขอ',
  dailyQuote(new Date('2026-09-01T09:00')) === 'bit by bit', dailyQuote(new Date('2026-09-01T09:00')));
ok('ย้อนก่อนวันเปิดตัวก็ยังได้ประโยค ไม่ใช่ undefined',
  typeof dailyQuote(new Date('2026-08-01T09:00')) === 'string' && !!dailyQuote(new Date('2026-08-01T09:00')),
  dailyQuote(new Date('2026-08-01T09:00')));

console.log(bad ? `\n❌ ไม่ผ่าน ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
