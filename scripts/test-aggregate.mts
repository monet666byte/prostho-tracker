/**
 * ทดสอบ src/domain/aggregate.ts — รันด้วย `npm run test:aggregate`
 *
 * ทำไมต้องมี: ทุกการ์ดบนหน้าภาพรวมของอาจารย์ (ทั้งชั้นปี · รายกลุ่ม · รายคน)
 * มาจากไฟล์นี้ไฟล์เดียว มันเป็นชั้นที่ "ยุบข้อมูลหลายร้อยแถวเหลือเลขเดียว"
 * เลขที่ยุบผิดจะไม่มีทางดูออกด้วยตา — ต้องเทียบกับผลรวมที่คำนวณอีกทางถึงจะเห็น
 *
 * เน้นเทสต์ 3 กลุ่ม:
 *   1. ผลรวมต้องบวกกลับได้ — แต่ละคนลงถังเดียวเท่านั้น (complete/oneShort/twoPlus)
 *   2. ลิสต์ว่างและคนที่ไม่มีงานเลย ต้องได้ 0 ไม่ใช่ NaN หรือหายไปจากตาราง
 *   3. ข้อมูลที่ "ไม่ควรถูกนับ" ต้องไม่ถูกนับ — เคสคืนแล้ว, งานของคนที่ไม่อยู่ในลิสต์
 */
import {
  cohortPercent, cohortRequirement, cohortYearly, countByType,
  staleRows, summarizeAll, summarizeGroups, summarizeStudent,
} from '../src/domain/aggregate.ts';
import { procList } from '../src/domain/rules.ts';
import { readDefaultSettings } from './test-helpers.mts';
import type { Student, WorkType, Workpiece } from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

const S = readDefaultSettings();

/* summarizeStudent / staleRows เรียก new Date() เองข้างใน (ไม่รับ now)
   วันที่ในเทสต์ชุดนี้จึงต้องอิงเวลาจริง ไม่ใช่วันที่ตรึงไว้ */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
/** ปีการศึกษาปัจจุบันตามเวลาจริง — ใช้ตั้งวันจบเคสให้ตกในปีนี้เสมอ */
const thisAcademicYearISO = (() => {
  const now = new Date();
  // เดือน มิ.ย. เป็นต้นไป = ปีการศึกษาที่เริ่มปีนี้ · ก่อนนั้นคือปีการศึกษาที่เริ่มปีที่แล้ว
  const startCal = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startCal}-07-01`;
})();

let seq = 0;
function wp(type: WorkType, over: Partial<Workpiece> = {}): Workpiece {
  return {
    id: `w${++seq}`, patientId: `p${seq}`, studentId: 's1', type,
    detail: type, acceptedDate: thisAcademicYearISO, minimumRequirement: true,
    payment: 'ชำระแล้ว', sect2Removable: true, sect2Fixed: true,
    procIndex: -1, lastUpdatedAt: daysAgo(0), catalogVersion: '2569',
    ...over,
  };
}
function done(w: Workpiece): Workpiece {
  return { ...w, procIndex: procList(w).length - 1, completedAt: w.completedAt ?? thisAcademicYearISO };
}
const finished = (type: WorkType, over: Partial<Workpiece> = {}) => done(wp(type, over));

let sseq = 0;
const student = (over: Partial<Student> = {}): Student => {
  const n = ++sseq;
  return { id: `s${n}`, code: `650400${n}`, name: `นศ. ${n}`, group: 'TH-PT7', year: 5, entryYear: 2569, advisorIds: ['t1', 't2'], ...over };
};
/** ชุดชิ้นงานที่ครบเกณฑ์สะสมพอดี ของนักศึกษาคนที่ระบุ */
const fullSet = (studentId: string) =>
  (['CD', 'CD', 'RPD', 'RPD', 'CB', 'PC'] as WorkType[]).map((t) => finished(t, { studentId }));

/* ── 1. summarizeStudent — คนที่ยังไม่มีงานเลย ───────────────────────────── */
console.log('\nsummarizeStudent — นักศึกษาที่ยังไม่มีงานสักชิ้น');
{
  const st = student();
  const s = summarizeStudent(st, [], S);
  ok('% รวม = 0 ไม่ใช่ NaN', s.percent === 0);
  ok('ทุกตัวนับเป็น 0', s.pieces === 0 && s.active === 0 && s.stale === 0 && s.reqDone === 0);
  ok('ยอดเกณฑ์ที่ต้องทำยังโชว์เต็มจำนวน (ไม่ใช่ 0/0)',
    s.reqTotal === S.req.cd + S.req.rpd + S.req.crown, s.reqTotal);
  ok('ยังไม่ครบเกณฑ์จบ', !s.allComplete);
  ok('ไม่มีข้อมูลด่านสอบเลย → gatesDone = null ไม่ใช่ 0 (คนละความหมาย)',
    s.gatesDone === null, String(s.gatesDone));
  ok('จำนวนด่านทั้งหมดยังบอกได้', s.gatesTotal > 0, s.gatesTotal);
}
{
  const st = student({ gates: { sect2Removable: true, sect2Fixed: false } });
  const s = summarizeStudent(st, [], S);
  ok('มีข้อมูลด่านบางข้อ → นับเฉพาะข้อที่ผ่าน', s.gatesDone === 1, String(s.gatesDone));
}
{
  const st = student();
  const list = [...fullSet(st.id), wp('CD', { studentId: st.id, returned: true, lastUpdatedAt: daysAgo(90) })];
  const s = summarizeStudent(st, list, S);
  /* เคสที่คืนไปแล้วไม่มีใครอัปเดตอีกตลอดกาล ถ้านับเป็นเคสค้าง ตัวเลขบนการ์ด
     จะพองขึ้นเรื่อยๆ และไม่มีวันลดลง (กติกาเดียวกับ isStale ใน rules.ts) */
  ok('เคสที่คืนแล้วไม่นับเป็นเคสค้าง', s.stale === 0, s.stale);
  ok('เคสที่คืนแล้วไม่นับเป็นงานที่ทำอยู่', s.active === 0, s.active);
  ok('แต่ยังนับอยู่ในจำนวนชิ้นงานทั้งหมด', s.pieces === 7, s.pieces);
  ok('ทำครบเกณฑ์สะสม+รายปี → ครบเกณฑ์', s.allComplete);
  ok('เกณฑ์ที่ทำได้ไม่เกินเพดาน (การ์ดต้องไม่ขึ้น 8/6)', s.reqDone <= s.reqTotal, `${s.reqDone}/${s.reqTotal}`);
}
{
  const st = student();
  const s = summarizeStudent(st, [wp('CD', { studentId: st.id, lastUpdatedAt: daysAgo(S.stale + 1) })], S);
  ok(`ไม่อัปเดตเกิน ${S.stale} วัน → นับเป็นเคสค้าง`, s.stale === 1, s.stale);
}

/* ── 2. summarizeAll / summarizeGroups ───────────────────────────────────── */
console.log('\nsummarizeAll / summarizeGroups');
ok('ไม่มีนักศึกษาเลย → ลิสต์ว่าง ไม่พัง', summarizeAll([], [], S).length === 0);
ok('ไม่มีสรุปรายคน → ไม่มีกลุ่ม', summarizeGroups([]).length === 0);
{
  const a = student({ id: 'a', group: 'TH-PT7' });
  const b = student({ id: 'b', group: 'TH-PT7' });
  const rows = summarizeAll([a, b], fullSet('a'), S);
  ok('นักศึกษาทุกคนต้องมีแถว แม้คนที่ไม่มีงานเลย', rows.length === 2, rows.length);
  ok('คนที่ไม่มีงาน = 0% ไม่ใช่หายไปจากตาราง',
    rows.find((r) => r.student.id === 'b')!.percent === 0);
  const g = summarizeGroups(rows);
  ok('รวมเป็นกลุ่มเดียว', g.length === 1 && g[0].code === 'TH-PT7');
  ok('% ของกลุ่ม = เฉลี่ยของสมาชิกทุกคน (คนที่ยังไม่เริ่มก็ถ่วงค่าลง)',
    g[0].percent === Math.round((rows[0].percent + rows[1].percent) / 2), g[0].percent);
  ok('เคสค้างของกลุ่ม = ผลรวมของสมาชิก', g[0].stale === rows.reduce((s, r) => s + r.stale, 0));
  ok('สมาชิกทุกคนติดมากับกลุ่ม', g[0].students.length === 2);
}
{
  /* ชั้นปีต้องมาจากสมาชิกจริง ไม่ใช่ตัวเลขในรหัสกลุ่ม — 'TH-PT7' อาจมีสมาชิกเป็นปี 6
     ทั้งกลุ่มเมื่อขึ้นปีใหม่ (เหตุผลเดียวกับที่ groupYear() ถูกถอดออก ดู test-group-year) */
  const y6 = [student({ id: 'x', group: 'TH-PT7', year: 6, entryYear: 2568 })];
  const g = summarizeGroups(summarizeAll(y6, [], S));
  ok('ชั้นปีของกลุ่มอ่านจากสมาชิก ไม่ใช่จากรหัสกลุ่ม', g[0].year === 6, g[0].year);
}
{
  const rows = summarizeAll(
    ['TH-PT10', 'TH-PT2', 'TH-PT9'].map((grp, i) => student({ id: `g${i}`, group: grp })), [], S);
  ok('เรียงกลุ่มด้วยเลข ไม่ใช่ตัวอักษร (PT9 ต้องมาก่อน PT10)',
    summarizeGroups(rows).map((g) => g.code).join(',') === 'TH-PT2,TH-PT9,TH-PT10',
    summarizeGroups(rows).map((g) => g.code).join(','));
}
{
  const rows = summarizeAll([student({ id: 'a' })], [
    ...fullSet('a'),
    finished('CD', { studentId: 'ไม่มีคนนี้ในระบบ' }), // งานกำพร้า เช่น นศ. ถูกลบไปแล้ว
  ], S);
  ok('งานของคนที่ไม่อยู่ในลิสต์ ไม่ไปบวกให้คนอื่น', rows[0].pieces === 6, rows[0].pieces);
}

/* ── 3. cohortRequirement — แท่ง stacked ต้องบวกกลับได้ ──────────────────── */
console.log('\ncohortRequirement — แต่ละคนต้องลงถังเดียวเท่านั้น');
ok('ไม่มีนักศึกษา → ลิสต์ว่าง ไม่ใช่แถวที่หารศูนย์', cohortRequirement([], [], S).length === 0);
{
  const st = [student({ id: 'a' }), student({ id: 'b' }), student({ id: 'c' })];
  const works = [
    ...fullSet('a'),                                    // ครบทุกกลุ่ม
    finished('CD', { studentId: 'b' }),                 // CD ขาด 1
    // c ไม่มีงานเลย
  ];
  const rows = cohortRequirement(st, works, S);
  ok('ได้ครบ 3 กลุ่มเกณฑ์', rows.length === 3, rows.map((r) => r.group).join(','));
  ok('ทุกแถว complete + oneShort + twoPlus = จำนวนคนทั้งหมด',
    rows.every((r) => r.complete + r.oneShort + r.twoPlus === r.total && r.total === st.length),
    rows.map((r) => `${r.group}:${r.complete}/${r.oneShort}/${r.twoPlus}`).join(' '));
  const cd = rows.find((r) => r.group === 'CD')!;
  ok('CD: ครบ 1 คน · ขาด 1 ชิ้น 1 คน · ขาด 2+ 1 คน',
    cd.complete === 1 && cd.oneShort === 1 && cd.twoPlus === 1);
  ok('นับคนที่ไม่มีงานเลยด้วย (ไม่หายไปจากแท่ง)', rows.every((r) => r.twoPlus >= 1));
}
{
  /* กลุ่ม Crown ครบจำนวนแล้วแต่ไม่มี Post-core = ยังไม่ครบ และต้องนับเป็น "ขาด 1"
     ไม่ใช่ "ครบ" — ถ้าคิดจาก required - done อย่างเดียวจะได้ 0 แล้วตกไปอยู่ถัง oneShort
     ทั้งที่ควรถูกจัดว่ายังขาดจริง (เลข gap มาจาก postCoreComplete) */
  const st = [student({ id: 'a' })];
  const rows = cohortRequirement(st, [finished('CB', { studentId: 'a' }), finished('CB', { studentId: 'a' })], S);
  const crown = rows.find((r) => r.group === 'CROWN')!;
  ok('Crown ครบจำนวนแต่ไม่มี Post-core → ไม่นับว่าครบ', crown.complete === 0);
  ok('Crown ที่ขาดแค่ Post-core → อยู่ถัง "ขาด 1"', crown.oneShort === 1, `${crown.oneShort}/${crown.twoPlus}`);
}

/* ── 4. cohortYearly ─────────────────────────────────────────────────────── */
console.log('\ncohortYearly — เกณฑ์รายปีทั้งชั้น');
{
  const c = cohortYearly([], [], S);
  ok('ไม่มีนักศึกษา → ทุกค่าเป็น 0 ไม่ใช่ NaN',
    c.passed === 0 && c.total === 0 && c.piecesDone === 0 && c.piecesGoal === 0, JSON.stringify(c));
}
{
  const st = [student({ id: 'a' }), student({ id: 'b' })];
  const works = [
    ...(['CD', 'RPD', 'CB'] as WorkType[]).map((t) => finished(t, { studentId: 'a' })),
    finished('CD', { studentId: 'b' }),
  ];
  const c = cohortYearly(st, works, S);
  ok('นับคนที่ถึงเกณฑ์รายปีแล้ว', c.passed === 1, c.passed);
  ok('เป้ารวม = จำนวนคน × เกณฑ์ต่อคน', c.piecesGoal === 2 * S.req.perYear, c.piecesGoal);
  ok('จำนวนชิ้นที่จบรวมทั้งชั้น นับได้ตั้งแต่ต้นปี (ต่างจากจำนวนคนที่ผ่าน)',
    c.piecesDone === 4, c.piecesDone);
}
{
  /* งานที่นำเข้าจากชีตซึ่งระบุว่านับเข้าปีก่อน ต้องไม่ทำให้ทั้งชั้นดูเหมือนผ่านแล้ว
     (ชีตมีวันจบ = วันนำเข้า ถ้าเชื่อวันจบจะไหลมากองในปีปัจจุบันทั้งหมด) */
  const st = [student({ id: 'a' })];
  const imported = (['CD', 'RPD', 'CB'] as WorkType[]).map((t) =>
    finished(t, { studentId: 'a', fromSheet: true, countsForYear: 2500 }));
  ok('งานที่ชีตระบุว่านับเข้าปีอื่น ไม่นับเป็นผลงานปีนี้',
    cohortYearly(st, imported, S).piecesDone === 0);
}

/* ── 5. staleRows ────────────────────────────────────────────────────────── */
console.log('\nstaleRows — ตารางเคสค้างของอาจารย์');
{
  const st = [student({ id: 'a' })];
  const rows = staleRows(st, [
    wp('CD', { studentId: 'a', lastUpdatedAt: daysAgo(S.stale + 10) }),
    wp('RPD', { studentId: 'a', lastUpdatedAt: daysAgo(S.stale + 1) }),
    wp('CB', { studentId: 'a', lastUpdatedAt: daysAgo(0) }),                    // ยังไม่ค้าง
    wp('PC', { studentId: 'a', lastUpdatedAt: daysAgo(99), returned: true }),    // คืนแล้ว
    finished('CD', { studentId: 'a', lastUpdatedAt: daysAgo(99) }),              // จบแล้ว
  ], S);
  ok('เอาเฉพาะเคสที่ค้างจริง', rows.length === 2, rows.map((r) => r.workpiece.type).join(','));
  ok('เรียงค้างนานสุดขึ้นก่อน', rows[0].days > rows[1].days, `${rows[0].days} > ${rows[1].days}`);
  ok('ทุกแถวมีชื่อนักศึกษาแนบมา', rows.every((r) => r.student.id === 'a'));
}
{
  /* ⚠️ พฤติกรรมสำคัญ: งานของนักศึกษาที่ไม่อยู่ในลิสต์จะถูกตัดทิ้งเงียบๆ
     เป็นเรื่องถูกต้องเวลากรองดูเฉพาะกลุ่ม แต่แปลว่าถ้าส่งลิสต์ว่างมา
     ตารางจะขึ้น "ไม่มีเคสค้าง" ทั้งที่มีจริง — หน้าจอต้องรอโหลดรายชื่อให้เสร็จก่อน */
  const orphan = [wp('CD', { studentId: 'ไม่มีคนนี้', lastUpdatedAt: daysAgo(99) })];
  ok('[บันทึกพฤติกรรม] ลิสต์นักศึกษาว่าง → ไม่มีแถวค้าง แม้งานจะค้างจริง',
    staleRows([], orphan, S).length === 0);
  ok('งานกำพร้าไม่ถูกยัดให้นักศึกษาคนอื่น',
    staleRows([student({ id: 'a' })], orphan, S).length === 0);
}

/* ── 6. countByType / cohortPercent ──────────────────────────────────────── */
console.log('\ncountByType / cohortPercent');
ok('ไม่มีงาน → ลิสต์ว่าง', countByType([]).length === 0);
{
  const rows = countByType([wp('CB'), wp('CD'), wp('CD'), wp('RRM')]);
  ok('นับต่อประเภทถูกต้อง', rows.find((r) => r.type === 'CD')!.count === 2);
  ok('เรียงตามลำดับในชีต (CD → CB → Recall)',
    rows.map((r) => r.type).join(',') === 'CD,CB,RRM', rows.map((r) => r.type).join(','));
}
ok('cohortPercent ของลิสต์ว่าง = 0 ไม่ใช่ NaN', cohortPercent([]) === 0);
ok('cohortPercent ของงานที่จบหมด = 100', cohortPercent([finished('CD'), finished('RRM')]) === 100);

console.log(bad ? `\n❌ ตก ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
