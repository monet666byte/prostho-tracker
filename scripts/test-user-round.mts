/**
 * ปักหมุดบั๊กที่เจอจากการ "ไล่ใช้จริงทั้งฝั่ง นศ. และ อจ." 10 ก.ย. 69
 * รันด้วย `npm run test:user-round`
 *
 * ทุกข้อในไฟล์นี้เคยเกิดขึ้นจริงบนหน้าจอ ไม่ใช่กรณีสมมติ:
 *   · วันที่ทำ step ปี 2035 ลงฐานข้อมูลได้ (max ของ <input type=date> กันได้แค่ปฏิทิน)
 *   · ตัวเลือก "กลุ่มที่ดูแล" เรียง PT10–PT12 ไปกองท้ายลิสต์ และมี 27 บรรทัดเขียนเหมือนกันเป๊ะ
 *   · บรรทัดสรุปเกณฑ์ให้อาจารย์อ่านขึ้นเป็นรหัสดิบ "CROWN 0/2 · RRM 0/1 · RFX 1/1"
 *   · ชื่อขั้น Recall เป็นไทย จึงถูก tText() แทนคำทีละท่อน → "ตรวจสภาพPieces / เนื้อเยื่อรองรับ"
 *   · ขั้นที่ 1 ของ Recall เขียน "reline" ซึ่งเป็นงานของฟันเทียมถอดได้ ไม่ใช่งานติดแน่น
 *   · นำเข้ารายชื่อด้วยกลุ่ม PT99 ผ่าน แล้วกลุ่มผีไปโผล่ในตัวเลือกของอาจารย์ทุกคน
 *   · รุ่นที่รับรายชื่อล่วงหน้า (ยังไม่ขึ้นคลินิก) ถูกตีว่าเสี่ยงสูงทั้งกลุ่ม
 *   · (ใบรายงาน A4 ของเคส Recall — เทสต์อยู่ใน test-export.mts ซึ่งเป็นเจ้าของ lib/export.ts)
 */
import { clampPerformedAt, toISODate } from '../src/lib/date.ts';
import { PROCS, RECALL, TYPES } from '../src/domain/catalog.ts';
import { caseCount, maxProgression, procList } from '../src/domain/rules.ts';
import { groupNumberOf, sortGroupCodes } from '../src/domain/group.ts';
import { riskRows } from '../src/domain/analytics.ts';
import { looksLikeStudentRoster, looksLikeTeacherRoster, parseRoster, parseTeacherRoster } from '../src/lib/rosterParse.ts';
import { readXlsx, tableToTsv } from '../src/lib/xlsxRead.ts';
import { readFileSync } from 'node:fs';
import { readDefaultSettings } from './test-helpers.mts';
import type { Settings, Student, WorkType } from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

const S: Settings = readDefaultSettings();
const THAI = /[฀-๿]/;

/* ═════════════════════════════════════════════════════════════════════════════
   ① วันที่ทำ step — ตัวกันชั้นสุดท้าย
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nclampPerformedAt — วันที่ที่เป็นไปไม่ได้ต้องเข้าฐานข้อมูลไม่ได้');
{
  const NOW = new Date('2026-09-10T12:00:00Z');
  const TODAY = toISODate(NOW);

  ok('วันในอนาคต (พิมพ์ปีเองบนเดสก์ท็อป) → หนีบเป็นวันนี้',
    clampPerformedAt('2035-01-01', '2026-06-03', NOW) === TODAY,
    clampPerformedAt('2035-01-01', '2026-06-03', NOW));

  ok('พรุ่งนี้ก็ไม่ได้ (เครื่องตั้งเวลาเกินไปวันเดียว)',
    clampPerformedAt('2026-09-11', '2026-06-03', NOW) === TODAY);

  ok('วันนี้ผ่านตามปกติ',
    clampPerformedAt(TODAY, '2026-06-03', NOW) === TODAY);

  ok('วันในอดีตที่หลังวันรับเคส ผ่านตามปกติ (นักศึกษาย้อนกรอกคาบที่แล้วได้)',
    clampPerformedAt('2026-08-19', '2026-06-03', NOW) === '2026-08-19');

  ok('ก่อนวันรับเคส → ดันขึ้นเป็นวันรับเคส',
    clampPerformedAt('2020-01-01', '2026-06-03', NOW) === '2026-06-03',
    clampPerformedAt('2020-01-01', '2026-06-03', NOW));

  ok('เคสนำเข้าที่ไม่มีวันรับเคส → ไม่มีพื้น แต่เพดานยังอยู่',
    clampPerformedAt('2020-01-01', undefined, NOW) === '2020-01-01'
    && clampPerformedAt('2035-01-01', undefined, NOW) === TODAY);

  ok('ข้อความที่ไม่ใช่วันที่ → ใช้วันนี้ ไม่ใช่ NaN/ค่าว่าง',
    clampPerformedAt('', '2026-06-03', NOW) === TODAY
    && clampPerformedAt('10/09/2569', '2026-06-03', NOW) === TODAY);

  /* พื้นดันวันทะลุเพดานไม่ได้ — acceptedDate เองก็อาจเป็นวันในอนาคต
     (แถวที่ sync ลงมาจากเครื่องที่ตั้งเวลาผิด หรือชีตที่กรอกวันนัดล่วงหน้า) */
  ok('วันรับเคสอยู่ในอนาคต → ผลลัพธ์ยังไม่ทะลุวันนี้',
    clampPerformedAt('2026-09-01', '2030-01-01', NOW) === TODAY,
    clampPerformedAt('2026-09-01', '2030-01-01', NOW));
}

/* ═════════════════════════════════════════════════════════════════════════════
   ② ขั้นตอนของ Recall
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nขั้นตอน Recall — ชื่อขั้นและจำนวนขั้น');
{
  ok('ทุกชื่อขั้นเป็นอังกฤษเหมือนประเภทอื่นในแคตตาล็อก (ไทยจะถูก tText แทนคำทีละท่อน)',
    RECALL.every((p) => !THAI.test(p[1])), RECALL.map((p) => p[1]).join(' · '));

  /* "reline" คือการเสริมฐานฟันเทียมถอดได้ — เคส Recall Fixed (FDP) ไม่มีขั้นนี้
     ลิสต์นี้ใช้ร่วมกันทั้ง RRM และ RFX จึงต้องเป็นคำที่จริงกับทั้งสองแบบ */
  ok('ไม่มีคำที่จริงแค่กับงานถอดได้ ("reline") อยู่ในลิสต์ที่งานติดแน่นใช้ร่วมกัน',
    RECALL.every((p) => !/reline/i.test(p[1])));

  ok('Recall ทั้งสองแบบใช้ลิสต์เดียวกัน',
    procList({ type: 'RRM' }) === procList({ type: 'RFX' }));

  ok('ขั้นสุดท้ายของ Recall = 3 · ของประเภทอื่น = 10',
    maxProgression({ type: 'RRM' }) === 3
    && maxProgression({ type: 'RFX' }) === 3
    && (['CD', 'RPD', 'APD', 'CB'] as WorkType[]).every((tp) => maxProgression({ type: tp }) === 10),
    `RFX ${maxProgression({ type: 'RFX' })} · CD ${maxProgression({ type: 'CD' })}`);

  /* ป้าย "prefix-0 ถึง prefix-N" ในฟอร์มเปิดชิ้นงานอ่านค่านี้ เดิมตรึง 10 ไว้ตายตัว
     คนเปิดเคส Recall จึงถูกบอกว่ามี 11 ขั้น แล้วเจอ 4 ขั้น */
  ok('ทุกประเภทมีขั้นสุดท้ายที่อ่านได้จาก maxProgression (ไม่มีประเภทไหนคืน 0)',
    (Object.keys(TYPES) as WorkType[]).every((tp) => maxProgression({ type: tp }) > 0));

  ok('PC แบบ prefab กับแบบ cast คนละลิสต์ แต่ขั้นสุดท้ายเท่ากัน',
    procList({ type: 'PC', variant: 'prefab' }) === PROCS.PC_PREFAB
    && maxProgression({ type: 'PC', variant: 'prefab' }) === maxProgression({ type: 'PC' }));
}

/* ═════════════════════════════════════════════════════════════════════════════
   ④ บรรทัดสรุปเกณฑ์ที่อาจารย์อ่าน — ห้ามมีรหัสกลุ่มดิบ
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nป้ายชื่อกลุ่มเกณฑ์ — คนนอกโค้ดต้องอ่านออก');
{
  const rows = caseCount([], S);
  const RAW = ['CROWN', 'RRM', 'RFX'];

  ok('มี 5 กลุ่ม (CD · RPD · Crown · Recall ถอดได้ · Recall ติดแน่น)',
    rows.length === 5, rows.map((r) => r.short).join(' · '));

  ok('ทุกกลุ่มมีป้ายสั้น (short) ให้ใช้ในบรรทัดสรุป',
    rows.every((r) => r.short.length > 0));

  /* เจอ 10 ก.ย. 69: หน้าประเมินตนเองฝั่งอาจารย์ใช้ r.group จึงขึ้น
     "CD 0/2 · RPD 1/2 · CROWN 0/2 · RRM 0/1 · RFX 1/1" ให้อาจารย์อ่าน */
  ok('ป้ายสั้นไม่ใช่รหัสกลุ่มดิบ',
    rows.every((r) => !RAW.includes(r.short)), rows.map((r) => r.short).join(','));

  ok('ป้ายสั้นของ Recall ตรงกับชื่อประเภทที่ผู้ใช้เห็นในที่อื่น',
    rows.find((r) => r.group === 'RRM')?.short === TYPES.RRM.short
    && rows.find((r) => r.group === 'RFX')?.short === TYPES.RFX.short);

  ok('ชื่อเต็ม (label) ไม่ว่างเปล่าทุกกลุ่ม — บางหน้าใช้ชื่อเต็ม',
    rows.every((r) => r.label.length > 0));
}

/* ═════════════════════════════════════════════════════════════════════════════
   ⑤ ตัวเลือก "กลุ่มที่ดูแล" — ลำดับที่อาจารย์คาดหวัง
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nลำดับกลุ่มในตัวเลือกของอาจารย์');
{
  ok('เลขกลุ่มอ่านจากท่อน PT ไม่ใช่ตัวเลขทุกตัวในรหัส',
    groupNumberOf('TH6-PT10') === 10
    && groupNumberOf('TH-PT7') === 7
    && groupNumberOf('TH55-PT12') === 12,
    `TH6-PT10 → ${groupNumberOf('TH6-PT10')}`);

  ok('รหัสที่อ่านไม่ออก → 999 (ไปท้ายสุด ไม่ใช่ NaN ที่ทำให้ sort เพี้ยนทั้งลิสต์)',
    groupNumberOf('อะไรก็ไม่รู้') === 999 && !Number.isNaN(groupNumberOf('')));

  // ปีการศึกษา 2569 → รุ่น 2569 = ปี 5 · 2568 = ปี 6 · 2567 ขึ้นไป = จบแล้ว · 2570 = ยังไม่เริ่ม
  const NOW = new Date('2026-09-10T12:00:00Z');
  const st = (group: string, entryYear: number): Student => ({
    id: `st-${group}`, code: '6504001', name: 'n', group, year: 5, entryYear,
    advisorIds: ['', ''],
  } as Student);
  const students = [
    st('TH-PT10', 2569), st('TH-PT2', 2569),
    st('TH6-PT10', 2568), st('TH6-PT1', 2568),
    st('TH7-PT1', 2567), st('TH8-PT1', 2566),
    st('TH56-PT1', 2570),
  ];
  const sorted = sortGroupCodes(students.map((s) => s.group), students, NOW);

  ok('ปี 5 มาก่อนปี 6 · รุ่นที่ยังไม่เริ่มมาก่อนรุ่นที่จบแล้ว',
    sorted.join(' ') === 'TH-PT2 TH-PT10 TH6-PT1 TH6-PT10 TH56-PT1 TH7-PT1 TH8-PT1',
    sorted.join(' '));

  /* เดิม PT10 (เลขรวม 610) ไปอยู่หลัง PT9 ของรุ่นที่จบแล้ว (เลขรวม 99) */
  ok('PT10 อยู่ติดกับ PT2 ในรุ่นเดียวกัน ไม่ใช่ตกไปท้ายลิสต์',
    sorted.indexOf('TH-PT10') === sorted.indexOf('TH-PT2') + 1);

  ok('กองที่จบแล้ว เรียงรุ่นใหม่ก่อน',
    sorted.indexOf('TH7-PT1') < sorted.indexOf('TH8-PT1'));

  ok('รหัสที่ไม่มีสมาชิก ไม่ทำให้ตัวเรียงพัง (ไปท้ายสุด)',
    sortGroupCodes(['TH-PT1', 'ZZ-ไม่มีคน'], students, NOW).at(-1) === 'ZZ-ไม่มีคน');
}

/* ═════════════════════════════════════════════════════════════════════════════
   ⑥ นำเข้ารายชื่อ — บรรทัดที่ตกต้องมีเหตุผล และกลุ่มผีต้องเข้าไม่ได้
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nนำเข้ารายชื่อ — ตัวกรองบรรทัด');
{
  const r1 = parseRoster('6604001, นศ. ก, PT12');
  ok('PT12 (กลุ่มสุดท้ายที่มีจริง) ผ่าน', r1.rows.length === 1 && r1.errors.length === 0);

  /* เจอ 10 ก.ย. 69: PT99 ผ่านตัวกรองเดิม (/PT\d{1,2}/) แล้วกลุ่ม TH56-PT99
     ไปโผล่ในตัวเลือก "กลุ่มที่ดูแล" ของอาจารย์ทุกคน ลบออกจากหน้าจอไม่ได้ */
  const r2 = parseRoster('6604001, นศ. ก, PT99');
  ok('PT99 ไม่ผ่าน และรายงานบอกเหตุผล',
    r2.rows.length === 0 && /PT1–PT12/.test(r2.errors[0]?.reason ?? ''),
    r2.errors[0]?.reason);

  const r3 = parseRoster('6604001, นศ. ก, PT0');
  ok('PT0 ไม่ผ่าน (ไม่มีกลุ่มเลขศูนย์)', r3.rows.length === 0);

  const long = parseRoster(`6604005, ${'ก'.repeat(300)}, PT1`);
  ok('ชื่อยาว 300 ตัว = แถวที่ตัวคั่นเพี้ยน → ตกและมีเหตุผล',
    long.rows.length === 0 && long.errors.length === 1, long.errors[0]?.reason);

  const ok120 = parseRoster(`6604006, ${'ก'.repeat(120)}, PT1`);
  ok('ชื่อยาว 120 ตัวพอดี ยังผ่าน (ไม่ตัดคนชื่อยาวจริงออก)', ok120.rows.length === 1);

  const mixed = parseRoster([
    '6604001, นศ. ก, PT1',
    '6604001, ซ้ำ, PT2',
    '6604002, , PT1',
    'abcxyz, ชื่อ, PT1',
    '6604003, ไม่มีกลุ่ม,',
    '   ',
    '6604004\tนศ. แท็บ\tPT12',
  ].join('\n'));
  ok('ไฟล์ปนทุกแบบ: ได้ 2 แถว · ตก 4 บรรทัด · บรรทัดว่างไม่นับเป็นข้อผิดพลาด',
    mixed.rows.length === 2 && mixed.errors.length === 4,
    `rows ${mixed.rows.length} · errors ${mixed.errors.length}`);
  ok('ทุกบรรทัดที่ตกมีเลขบรรทัดและเหตุผล — ไม่มีของหายเงียบ',
    mixed.errors.every((e) => e.line > 0 && e.reason.length > 0));
  ok('คั่นด้วยแท็บอ่านได้ (คนก๊อปจาก Excel มาตรงๆ)',
    mixed.rows.some((r) => r.code === '6604004' && r.group === 'PT12'));

  /* แบบฟอร์มขอรายชื่อ (public/prostho-roster-request-template.xlsx) ก๊อปทั้งตารางจาก Excel = คั่นแท็บ + หัวตาราง
     มีช่องว่างได้ (คำนำหน้า · ชื่ออังกฤษ · อีเมล) — เดาทีละเซลล์จะหยิบ "นาย" มาเป็นชื่อ */
  const H = 'รหัสนักศึกษา *\tคำนำหน้า\tชื่อ-นามสกุล (ไทย) *\tชื่อ-นามสกุล (อังกฤษ)\tอีเมลมหาวิทยาลัย\tรุ่น DTMU *\tกลุ่มคลินิก *';
  const form = parseRoster([
    H,
    '6604999\tนาย\tสมมติ ตัวอย่าง\tSommut Tuayang\tsommut.tua@student.mahidol.edu\t56\tPT1',
    '6604101\tนางสาว\tกานดา ใจงาม\tKanda Jaingam\tKanda.Jai@student.mahidol.edu\t56\tPT3',
    '6604102\t\tสมชาย ดีมาก\t\t\t56\tPT4',
    '6604103\tนาย\tวีระ กล้าหาญ',
    '\t\t\t\t\t\t',
    '6604104\t\tมานี มีนา\tManee Meena\tไม่ใช่อีเมล\t56\tPT5',
  ].join('\n'));
  const kanda = form.rows.find((r) => r.code === '6604101');
  ok('แบบฟอร์ม: ชื่อไทย/อังกฤษ/อีเมล/รุ่น/กลุ่ม ลงช่องถูก ไม่หยิบคำนำหน้ามาเป็นชื่อ',
    kanda?.name === 'กานดา ใจงาม' && kanda.nameEn === 'Kanda Jaingam' && kanda.email === 'kanda.jai@student.mahidol.edu'
      && kanda.dtmu === 56 && kanda.group === 'PT3', kanda);
  const somchai = form.rows.find((r) => r.code === '6604102');
  ok('แบบฟอร์ม: ช่องไม่บังคับที่ว่าง → ไม่มีชื่ออังกฤษ/อีเมล (ไม่ใช่สตริงว่าง)',
    somchai?.name === 'สมชาย ดีมาก' && !('nameEn' in somchai) && !('email' in somchai), somchai);
  ok('แบบฟอร์ม: แถวตัวอย่างสีเทาไม่หลุดเข้าไป และมีเหตุผลบอก',
    !form.rows.some((r) => r.code === '6604999') && form.errors.some((e) => /ตัวอย่าง/.test(e.reason)), form.errors);
  ok('แบบฟอร์ม: แถวที่ไม่มีกลุ่ม · อีเมลผิดรูป ตกพร้อมเหตุผล · แถวช่องว่างล้วนไม่นับ',
    form.rows.length === 2 && form.errors.length === 3
      && form.errors.some((e) => /กลุ่ม/.test(e.reason)) && form.errors.some((e) => /อีเมล/.test(e.reason)),
    form.errors);

  /* แท็บ "อาจารย์" ของแบบฟอร์มเดียวกัน — วางในช่องเดียวกับนักศึกษา แอปดูจากหัวตาราง (15 ก.ย. 69) */
  const TH = 'คำนำหน้า / ตำแหน่ง\tชื่อ-นามสกุล (ไทย) *\tชื่อ-นามสกุล (อังกฤษ)\tอีเมล *\tบทบาท *\tกลุ่มที่ปรึกษา';
  const tText = [
    TH,
    'อ.ทพ.\tสมมติ ใจดี\tSommut Jaidee\tsommut.jai@mahidol.edu\tอาจารย์\tปี 5 PT1',
    'ผศ.ทพ.\tวิภา รักษ์ฟัน\tWipa Rakfan\tWipa.Rak@Mahidol.edu\tหัวหน้ารายวิชา\t',
    '\tสมศักดิ์ ยิ้มแย้ม\t\tsomsak.yim@gmail.com\tอาจารย์',
    'อ.\tบทบาทว่าง\t\tno.role@mahidol.edu\t\t',
    'อ.\tอีเมลผิด\t\tไม่ใช่อีเมล\tอาจารย์\t',
    'อ.\tซ้ำ\t\twipa.rak@mahidol.edu\tอาจารย์\t',
    '\t\t\t\t\t',
  ].join('\n');
  ok('แท็บอาจารย์: รู้จากหัวตาราง · แท็บนักศึกษาไม่ถูกอ่านเป็นอาจารย์',
    looksLikeTeacherRoster(tText) && !looksLikeTeacherRoster([H, '6604101\tนางสาว\tกานดา ใจงาม\t\t\t56\tPT3'].join('\n')));
  const tf = parseTeacherRoster(tText);
  const wipa = tf.rows.find((r) => r.email === 'wipa.rak@mahidol.edu');
  ok('แท็บอาจารย์: ชื่อที่แสดงมีคำนำหน้า · ชื่ออังกฤษ · อีเมลตัวเล็ก · หัวหน้ารายวิชา',
    wipa?.name === 'ผศ.ทพ. วิภา รักษ์ฟัน' && wipa.nameEn === 'Wipa Rakfan' && wipa.isAdmin && wipa.title === 'ผศ.ทพ.', wipa);
  const somsak = tf.rows.find((r) => r.email === 'somsak.yim@gmail.com');
  ok('แท็บอาจารย์: ไม่มีคำนำหน้า/ชื่ออังกฤษ ก็เข้าได้ · บทบาทอาจารย์ = ไม่ใช่หัวหน้า',
    somsak?.name === 'สมศักดิ์ ยิ้มแย้ม' && !somsak.isAdmin && !('nameEn' in somsak), somsak);
  ok('แท็บอาจารย์: แถวตัวอย่าง · บทบาทว่าง (ไม่เดาสิทธิ์) · อีเมลผิด · อีเมลซ้ำ ตกพร้อมเหตุผล',
    tf.rows.length === 2 && tf.errors.length === 4
      && tf.errors.some((e) => /ตัวอย่าง/.test(e.reason)) && tf.errors.some((e) => /บทบาท/.test(e.reason))
      && tf.errors.some((e) => /อีเมลไม่ถูก/.test(e.reason)) && tf.errors.some((e) => /ซ้ำ/.test(e.reason)), tf.errors);

  const noHeader = parseRoster('6604201, นาย, ปิติ ยินดี, Piti Yindee, piti.yin@student.mahidol.edu, PT2');
  ok('ไม่มีหัวตาราง: ยังแยกชื่ออังกฤษกับอีเมลออกจากชื่อไทยได้',
    noHeader.rows[0]?.name === 'ปิติ ยินดี' && noHeader.rows[0]?.nameEn === 'Piti Yindee' && noHeader.rows[0]?.email === 'piti.yin@student.mahidol.edu',
    noHeader.rows[0]);
  /* ตรวจซ้ำ 15 ก.ย. 69 — สามรูที่ทำให้คนหาย/ข้อมูลเพี้ยนเงียบๆ */
  const dupMail = parseRoster([H, '6604301\t\tก ข\t\ta@student.mahidol.edu\t56\tPT1', '6604302\t\tค ง\t\tA@student.mahidol.edu\t56\tPT1'].join('\n'));
  ok('อีเมลซ้ำสองคน → คนที่สองตกพร้อมเหตุผล (ไม่งั้นรายชื่อเชิญเก็บคนแรก คนที่สองเข้าไม่ได้เงียบๆ)',
    dupMail.rows.length === 1 && dupMail.errors.some((e) => /อีเมลซ้ำ/.test(e.reason)), JSON.stringify(dupMail.errors));
  const numbered = parseRoster(['9\t6604009\tนาย\tสมชาย ใจดี\tPT1', '10\t6604010\tนาง\tมานี มีนา\tPT1'].join('\n'));
  ok('วางแบบมีคอลัมน์ลำดับที่ (ไม่มีหัวตาราง) → ลำดับไม่กลายเป็นชื่อหรือรุ่น DTMU10',
    numbered.rows.length === 2 && numbered.rows[0].name === 'สมชาย ใจดี' && numbered.rows[1].name === 'มานี มีนา' && numbered.rows.every((r) => r.dtmu === undefined),
    JSON.stringify(numbered.rows));
  const pt01 = parseRoster('6604401, นศ. ก, PT01');
  ok('PT01 → PT1 (ไม่เกิดกลุ่มคู่ TH56-PT01)', pt01.rows[0]?.group === 'PT1', pt01.rows[0]?.group);
  const latinOnly = parseRoster('6604202, Liv, PT2');
  ok('ไม่มีหัวตาราง + มีแต่ชื่ออังกฤษ → ใช้เป็นชื่อหลัก (รายชื่อเก่ายังนำเข้าได้)',
    latinOnly.rows[0]?.name === 'Liv' && !latinOnly.rows[0]?.nameEn, latinOnly.rows[0]);
}

/* ═════════════════════════════════════════════════════════════════════════════
   ⑦ รุ่นที่รับรายชื่อไว้ล่วงหน้า — ยังไม่ขึ้นคลินิก ไม่ใช่ความเสี่ยง
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nสีเสี่ยงของรุ่นที่ยังไม่ขึ้นคลินิก');
{
  const NOW = new Date('2026-09-10T12:00:00Z');   // ปีการศึกษา 2569
  const mk = (id: string, entryYear: number): Student => ({
    id, code: '6604001', name: 'n', group: 'TH56-PT1', year: 5, entryYear,
    advisorIds: ['', ''],
  } as Student);

  const upcoming = riskRows([mk('u1', 2570)], [], S, [], [], NOW);
  ok('รุ่นถัดไป (ยังไม่ถึง 1 มิ.ย.) ไม่มีเคส → ไม่ใช่เสี่ยงสูง',
    upcoming[0].risk === 'ok', `${upcoming[0].risk} · ${upcoming[0].reason}`);
  ok('เหตุผลบอกตรงๆ ว่ายังไม่ถึงปีที่ขึ้นคลินิก',
    /ยังไม่ถึงปี|has not started/i.test(upcoming[0].reason), upcoming[0].reason);
  ok('ยังอยู่ในรายการ ไม่ได้ถูกซ่อนไป (อาจารย์ต้องเห็นว่ามีใครอยู่ในกลุ่ม)',
    upcoming.length === 1 && upcoming[0].piecesTotal === 0);

  /* คนละเรื่องกับ "ปี 5 ที่ยังไม่รับเคส" ซึ่งต้องแดงจริง — นี่คือคนที่ควรถูกตามก่อนใคร */
  const current = riskRows([mk('c1', 2569)], [], S, [], [], NOW);
  ok('ปี 5 ปีนี้ที่ยังไม่มีเคสเลย → ยังต้องเป็นเสี่ยงสูงเหมือนเดิม',
    current[0].risk === 'high', `${current[0].risk} · ${current[0].reason}`);
}

/* ═════════════════════════════════════════════════════════════════════════════
   ⑧ ปุ่ม "เลือกไฟล์ Excel" — อ่านแบบฟอร์มจริงที่ส่งให้ภาค (public/prostho-roster-request-template.xlsx)
   ตัวอ่าน .xlsx เขียนเอง (lib/xlsxRead.ts) · แก้แบบฟอร์มเมื่อไหร่ ข้อนี้ต้องยังผ่าน
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nอ่านไฟล์ Excel แบบฟอร์มขอรายชื่อ');
{
  const file = readFileSync(new URL('../public/prostho-roster-request-template.xlsx', import.meta.url));
  const sheets = await readXlsx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  ok('อ่านได้ครบสามแผ่นตามลำดับ', sheets.map((x) => x.name).join(',') === 'คำอธิบาย,นักศึกษา,อาจารย์', sheets.map((x) => x.name).join(','));
  const text = (name: string) => tableToTsv(sheets.find((x) => x.name === name)?.rows ?? []);
  ok('แผ่นคำอธิบายไม่ถูกอ่านเป็นรายชื่อ (ไม่งั้นทุกบรรทัดขึ้นเป็นข้อผิดพลาด)',
    !looksLikeStudentRoster(text('คำอธิบาย')) && !looksLikeTeacherRoster(text('คำอธิบาย')));
  ok('แผ่นนักศึกษา → ตัวอ่านนักศึกษา · แผ่นอาจารย์ → ตัวอ่านอาจารย์',
    looksLikeStudentRoster(text('นักศึกษา')) && !looksLikeTeacherRoster(text('นักศึกษา'))
      && looksLikeTeacherRoster(text('อาจารย์')) && !looksLikeStudentRoster(text('อาจารย์')));
  const st = parseRoster(text('นักศึกษา'));
  ok('แบบฟอร์มเปล่า: นักศึกษา 0 คน · แถวตัวอย่างถูกข้ามพร้อมเหตุผล · 150 แถวสีเหลืองที่ว่างไม่นับเป็นข้อผิดพลาด',
    st.rows.length === 0 && st.errors.length === 1 && /ตัวอย่าง/.test(st.errors[0].reason), JSON.stringify(st.errors));
  const tc = parseTeacherRoster(text('อาจารย์'));
  ok('แบบฟอร์มเปล่า: อาจารย์ 0 ท่าน · แถวตัวอย่างถูกข้าม',
    tc.rows.length === 0 && tc.errors.length === 1 && /ตัวอย่าง/.test(tc.errors[0].reason), JSON.stringify(tc.errors));
  ok('รหัสนักศึกษาในแถวตัวอย่างอ่านเป็นข้อความ 7 หลักตรงตัว',
    sheets[1].rows[1]?.[0] === '6604999', sheets[1].rows[1]?.[0]);

  /* <si/> ปิดตัวเอง (บางโปรแกรมเขียนแบบนี้) ต้องนับเป็นหนึ่งช่อง — ไม่งั้นทุกชื่อหลังจากนั้นเลื่อนไปหยิบของเซลล์อื่น */
  {
    /* ซิปแบบไม่บีบอัด (stored) สร้างเองในเทสต์ — ไม่ต้องพึ่งไลบรารี · ตัวอ่านไม่ตรวจ CRC */
    const enc = new TextEncoder();
    const storedZip = (files: Record<string, string>): ArrayBuffer => {
      const parts: number[] = []; const central: number[] = []; let count = 0;
      const u16 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255);
      const u32 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
      for (const [name, text] of Object.entries(files)) {
        const nb = [...enc.encode(name)]; const db = [...enc.encode(text)]; const off = parts.length;
        u32(parts, 0x04034b50); u16(parts, 20); u16(parts, 0); u16(parts, 0); u16(parts, 0); u16(parts, 0);
        u32(parts, 0); u32(parts, db.length); u32(parts, db.length); u16(parts, nb.length); u16(parts, 0);
        parts.push(...nb, ...db);
        u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0);
        u32(central, 0); u32(central, db.length); u32(central, db.length); u16(central, nb.length); u16(central, 0); u16(central, 0);
        u16(central, 0); u16(central, 0); u32(central, 0); u32(central, off); central.push(...nb);
        count++;
      }
      const cdOff = parts.length; const all = [...parts, ...central];
      u32(all, 0x06054b50); u16(all, 0); u16(all, 0); u16(all, count); u16(all, count); u32(all, central.length); u32(all, cdOff); u16(all, 0);
      return new Uint8Array(all).buffer;
    };
    const zip = storedZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="นักศึกษา" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si/><si><t>6604001</t></si><si><t>สมชาย ใจดี</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>0</v></c></row></sheetData></worksheet>',
    });
    const got = await readXlsx(zip);
    ok('<si/> ว่างไม่ทำให้ลำดับข้อความเลื่อน', JSON.stringify(got[0].rows[0]) === JSON.stringify(['6604001', 'สมชาย ใจดี', '']), JSON.stringify(got[0].rows[0]));
  }

  let broken = '';
  try { await readXlsx(new TextEncoder().encode('ไม่ใช่ไฟล์ excel').buffer as ArrayBuffer); } catch (e) { broken = (e as Error).message; }
  ok('ไฟล์ที่ไม่ใช่ .xlsx → ข้อความไทยบอกว่าต้องทำอะไร ไม่ใช่ error อังกฤษดิบ', /xlsx/.test(broken) && /[\u0E00-\u0E7F]/.test(broken), broken);
}

console.log(bad === 0 ? '\n✅ ผ่านหมด' : `\n❌ ตก ${bad} ข้อ`);
process.exit(bad === 0 ? 0 : 1);
