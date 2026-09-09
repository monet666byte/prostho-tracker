/**
 * ทดสอบ src/domain/analytics.ts — รันด้วย `npm run test:analytics`
 *
 * ทำไมต้องมี: ไฟล์นี้ยาวกว่า rules.ts เท่าตัว และเป็นไฟล์ที่ "พังแล้วไม่มีใครรู้"
 * ที่สุดในระบบ — ทุกฟังก์ชันคืนตัวเลขที่เอาไปวาดกราฟบนหน้าอาจารย์ตรงๆ
 * กราฟไม่มีวันขึ้น error มันจะวาดเลขผิดออกมาสวยๆ แล้วอาจารย์ใช้เลขนั้นตัดสินใจ
 * ว่าจะไปตามนักศึกษาคนไหน
 *
 * เน้นเทสต์ 3 กลุ่ม:
 *   1. ขอบที่ทำให้หารศูนย์/NaN — ลิสต์ว่าง, นักศึกษาไม่มีงาน, ปีที่ไม่มีข้อมูล
 *   2. ข้อมูลที่ "ไม่ใช่ของปีนี้" ต้องไม่ไหลมาปนปีนี้ — งานนำเข้าจากชีต (fromSheet,
 *      countsForYear) และงานที่จบไปตั้งแต่ปีการศึกษาก่อน
 *   3. บั๊กที่เคยเจอมาแล้ว — มีคอมเมนต์กำกับว่าเคยพังยังไง ใครเห็นเลขผิด
 */
import {
  bottleneckByStep, burnup, carriedOverCount, caseDots, durationByType, funnelByType,
  headline, periodsLeftNow, profile, averageProfile, heatmapRows, riskRows,
  selfPerformedRows, throughputByMonth,
} from '../src/domain/analytics.ts';
import { procList } from '../src/domain/rules.ts';
import { readDefaultSettings } from './test-helpers.mts';
import type { CheckIn, ProgressUpdate, Settings, Student, WorkType, Workpiece } from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

/** วันอ้างอิงของทุกเทสต์ — ต.ค. 2026 = ปีการศึกษา 2569 (เดือนที่ 5 จาก 10 ของปีการศึกษา) */
const NOW = new Date('2026-10-15T09:00:00+07:00');
/** วันที่ค้างแน่ๆ เทียบ "เวลาจริง" — สำหรับฟังก์ชันที่เรียก isStale เองโดยไม่รับ now */
const staleByWallClock = new Date(Date.now() - 60 * 86_400_000).toISOString();

const S = readDefaultSettings();
const withReq = (over: Partial<Settings>): Settings => ({ ...S, ...over });

let seq = 0;
/** ชิ้นงานตั้งต้น — ยังไม่เริ่มทำ นับเข้าเกณฑ์ อัปเดตวันนี้ */
function wp(type: WorkType, over: Partial<Workpiece> = {}): Workpiece {
  return {
    id: `w${++seq}`, patientId: `p${seq}`, studentId: 's1', type,
    detail: type, acceptedDate: '2026-06-15', minimumRequirement: true,
    payment: 'ชำระแล้ว', sect2Removable: true, sect2Fixed: true,
    procIndex: -1, lastUpdatedAt: NOW.toISOString(), catalogVersion: '2569',
    ...over,
  };
}
/** ชิ้นงานที่หยุดอยู่ที่ progression ที่ระบุ (procedure แรกของขั้นนั้น) */
function at(type: WorkType, prog: number, over: Partial<Workpiece> = {}): Workpiece {
  const w = wp(type, over);
  return { ...w, procIndex: procList(w).findIndex((p) => p[0] === prog) };
}
/** ทำให้ชิ้นงานจบเคส (procedure สุดท้ายของประเภทนั้น) */
function done(w: Workpiece, completedAt = '2026-09-01'): Workpiece {
  return { ...w, procIndex: procList(w).length - 1, completedAt };
}
const finished = (type: WorkType, over: Partial<Workpiece> = {}) =>
  done(wp(type, over), (over.completedAt as string) ?? '2026-09-01');

let sseq = 0;
const student = (over: Partial<Student> = {}): Student => {
  const n = ++sseq;
  return { id: `s${n}`, code: `650400${n}`, name: `นศ. ${n}`, group: 'TH-PT7', year: 5, entryYear: 2569, advisorIds: ['t1', 't2'], ...over };
};
const S1 = student({ id: 's1' });

const checkin = (studentId: string, date: string): CheckIn => ({
  id: `c-${studentId}-${date}`, studentId, date, punctual: true, noPatient: false,
  activities: [], status: 'pending', createdAt: date,
});
const update = (workpieceId: string, performedAt: string, over: Partial<ProgressUpdate> = {}): ProgressUpdate => ({
  id: `u-${workpieceId}-${performedAt}`, workpieceId, procIndex: 0, progression: 0,
  performedAt, selfPerformed: false, photoIds: [], createdBy: 's1',
  createdAt: performedAt, syncedAt: null, ...over,
});

/* ── 1. riskRows — ขอบที่ทำให้แถวว่างเปล่ากลายเป็นตัวเลข ──────────────────── */
console.log('\nriskRows — นักศึกษาที่ไม่มีข้อมูลต้องไม่ได้ตัวเลขมั่ว');
ok('ไม่มีนักศึกษาเลย → ลิสต์ว่าง ไม่พัง', riskRows([], [], S, [], [], NOW).length === 0);
{
  const [r] = riskRows([S1], [], S, [], [], NOW);
  ok('นศ. ที่ไม่มีงานเลย → เสี่ยงสูง', r.risk === 'high', r.reason);
  ok('นศ. ที่ไม่มีงานเลย → ทุกตัวเลขเป็นเลขจริง ไม่ใช่ NaN',
    [r.completedThisYear, r.piecesTotal, r.piecesDone, r.stepsRemaining, r.periodsNeeded, r.periodsLeft, r.monthsLeft]
      .every((n) => Number.isFinite(n)));
  ok('ยังไม่เคยเช็คอินและไม่มีงาน → silentDays ตัดที่ 99 ไม่ใช่ 999',
    r.silentDays === 99, r.silentDays);
  ok('ไม่มีเคสในมือ → ป้าย step ไม่ว่างเปล่า', r.currentStepLabel.length > 0, r.currentStepLabel);
  ok('yearGap = เกณฑ์รายปีเต็มจำนวน', r.yearGap === S.req.perYear, r.yearGap);
}
{
  /* เคสที่คืนไปแล้วไม่ใช่ "งานในมือ" — ถ้านับ ระบบจะบอกว่า นศ. คนนี้มีเคสทำอยู่
     แล้วประเมินว่ายังทันเกณฑ์ ทั้งที่จริงมือเปล่า (กติกาเดียวกับ isStale ใน rules.ts) */
  const [r] = riskRows([S1], [wp('CD', { returned: true })], S, [], [], NOW);
  ok('มีแต่เคสที่คืนไปแล้ว → ยังนับว่าไม่มีเคสในมือ', r.risk === 'high' && r.piecesCounted === 0, r.reason);
  ok('แต่ยังนับอยู่ในจำนวนงานทั้งหมด (ให้เลขบนการ์ดตรงกับที่กางดู)', r.piecesTotal === 1, r.piecesTotal);
}
{
  const list = ['CD', 'RPD', 'CB'].map((t) => finished(t as WorkType));
  const [r] = riskRows([S1], list, S, [], [], NOW);
  ok('จบครบเกณฑ์รายปีแล้ว → ไม่เสี่ยง', r.risk === 'ok' && r.yearGap === 0, r.reason);
  ok('ครบแล้วไม่ต้องเดิน step ต่อ', r.stepsRemaining === 0, r.stepsRemaining);
}
{
  /* งานที่นำเข้าจากชีตมีวันจบ = วันนำเข้า ถ้าดูจาก completedAt อย่างเดียว งานปี 5
     จะไหลมากองในปีปัจจุบัน แล้ว นศ. ปี 6 ที่ยังไม่จบอะไรเลยปีนี้จะขึ้นว่า "ผ่านแล้ว" */
  const imported = ['CD', 'RPD', 'CB'].map((t) =>
    finished(t as WorkType, { fromSheet: true, countsForYear: 2568 }));
  const [r] = riskRows([S1], imported, S, [], [], NOW);
  ok('งานที่ชีตระบุว่านับเข้าปีก่อน ไม่นับเป็นผลงานปีนี้', r.completedThisYear === 0, r.completedThisYear);
}
{
  /* เคยเป็นระเบิดเวลา: performedAt ของ ProgressUpdate กับ date ของ CheckIn ต้องเป็น
     'YYYY-MM-DD' รูปแบบเดียวกัน (ดู repo.ts → toISODate) ถ้าวันหนึ่งมีใครเปลี่ยนช่องใด
     ช่องหนึ่งเป็น ISO datetime การเทียบจะไม่มีวันตรง → ทุกคนถูกตีว่า "ติดเทคนิค" หมดชั้นปี */
    const w = at('CD', 3);
    const cs = ['2026-10-01', '2026-10-08', '2026-10-15'].map((d) => checkin('s1', d));
    const hit = riskRows([S1], [w], S, cs, [update(w.id, '2026-10-15')], NOW)[0];
    ok('เช็คอินวันที่มี step ผ่าน → ไม่นับว่าติด', hit.stuckPeriods === 0, hit.stuckPeriods);
    const miss = riskRows([S1], [w], S, cs, [], NOW)[0];
    ok('มาคลินิก 3 คาบแต่ไม่มี step ผ่านเลย → ติด 3 คาบ', miss.stuckPeriods === 3, miss.stuckPeriods);
    ok('ติดหลายคาบติดกัน → ยกเป็นเสี่ยงสูง', miss.risk === 'high', miss.reason);
    const undone = riskRows([S1], [w], S, cs, [update(w.id, '2026-10-15', { reversal: true })], NOW)[0];
    ok('รายการที่กด "เลิกทำ" ไม่นับเป็น step ที่ผ่าน', undone.stuckPeriods === 3, undone.stuckPeriods);
    const other = riskRows([S1], [w], S, cs, [update('w-ของคนอื่น', '2026-10-15')], NOW)[0];
    ok('step ของงานคนอื่น ไม่มาล้างสถานะติดของเรา', other.stuckPeriods === 3, other.stuckPeriods);
}
{
  const rows = riskRows(
    [student({ id: 'a' }), student({ id: 'b' })],
    [...['CD', 'RPD', 'CB'].map((t) => finished(t as WorkType, { studentId: 'b' }))],
    S, [], [], NOW,
  );
  ok('เรียงคนเสี่ยงสูงขึ้นก่อน', rows[0].student.id === 'a' && rows[1].student.id === 'b',
    rows.map((r) => `${r.student.id}:${r.risk}`).join(' '));
  ok('เลขบนการ์ดบวกกันได้ (จบแล้ว + ที่กางดู ≤ ทั้งหมด)',
    rows.every((r) => r.piecesDone + r.pieces.length <= r.piecesTotal));
  ok('งานที่จบแล้วโผล่ครบในรายการที่กางดู',
    rows[1].donePieces.length === rows[1].piecesDone, rows[1].donePieces.length);
}
{
  /* เคยพัง: จำนวนคาบที่เหลืออ่านจาก ROUNDS ซึ่งเป็นปฏิทินปี 2569 ที่ฝังตายไว้
     พอเลยปฏิทินนั้นไป ค่าจะเป็น 0 ตลอดกาล → ทุกคนเป็น "เสี่ยงสูง" ถาวร */
  const nextAcademicYear = new Date('2027-10-15T09:00:00+07:00');
  ok('ข้ามไปปีการศึกษาถัดไป ยังมีคาบเหลือให้คำนวณ', periodsLeftNow(S, nextAcademicYear) > 0,
    periodsLeftNow(S, nextAcademicYear));
  ok('ปลายปีการศึกษา (หลังคาบสุดท้าย) คาบเหลือ = 0 ไม่ติดลบ',
    periodsLeftNow(S, new Date('2027-05-01T09:00:00+07:00')) === 0);
  ok('อาจารย์ปรับคาบ/สัปดาห์แล้วตัวเลขขยับตาม',
    periodsLeftNow(withReq({ periodsPerWeek: 4 }), NOW) > periodsLeftNow(S, NOW));
}

/* ── 2. throughputByMonth — ปฏิทินปีการศึกษา ─────────────────────────────── */
console.log('\nthroughputByMonth — 10 เดือน มิ.ย. → มี.ค.');
{
  const empty = throughputByMonth([], NOW);
  ok('ไม่มีงานเลย → ยังคืนครบ 10 เดือน (กราฟต้องมีแกน ไม่ใช่จอว่าง)', empty.length === 10, empty.length);
  ok('ทุกเดือนนับได้ 0 ไม่ใช่ undefined', empty.every((m) => m.count === 0));
  ok('เดือนแรกคือ มิ.ย. เดือนสุดท้ายคือ มี.ค.',
    empty[0].key === '2026-5' && empty[9].key === '2027-2', `${empty[0].key} … ${empty[9].key}`);
  ok('เดือนที่ยังมาไม่ถึงติดธง future', !empty[4].future && empty[5].future,
    empty.map((m) => (m.future ? 'f' : '.')).join(''));
}
{
  const rows = throughputByMonth([
    finished('CD', { completedAt: '2026-09-20' }),
    finished('RPD', { completedAt: '2026-09-02' }),
    finished('CB', { completedAt: '2025-09-02' }), // ปีการศึกษาก่อน
    wp('CD'),                                      // ยังไม่จบ ไม่มี completedAt
  ], NOW);
  ok('งานที่จบเดือน ก.ย. ลงถัง ก.ย. ครบ 2 ชิ้น', rows[3].count === 2, rows[3].count);
  ok('งานของปีการศึกษาก่อนไม่หลุดเข้าถังปีนี้',
    rows.reduce((s, m) => s + m.count, 0) === 2, rows.reduce((s, m) => s + m.count, 0));
  ok('งานที่ยังไม่จบไม่ถูกนับ', rows.every((m) => m.count <= 2));
}

/* ── 3. durationByType — มัธยฐานของลิสต์ว่าง ─────────────────────────────── */
console.log('\ndurationByType — รับเคส → จบเคส กี่สัปดาห์');
{
  const rows = durationByType([]);
  ok('ไม่มีงานจบเลย → ยังคืนครบ 4 ประเภทหลัก', rows.length === 4, rows.length);
  ok('มัธยฐานของลิสต์ว่าง = 0 ไม่ใช่ NaN',
    rows.every((r) => Number.isFinite(r.medianWeeks) && r.samples === 0));
}
{
  const rows = durationByType([
    finished('CD', { acceptedDate: '2026-06-01', completedAt: '2026-07-01' }),  // ~4 สัปดาห์
    finished('CD', { acceptedDate: '2026-06-01', completedAt: '2026-09-01' }),  // ~13 สัปดาห์
    /* วันจบมาก่อนวันรับเคส — เกิดจริงในชีตที่กรอกสลับช่อง ถ้าไม่กรอง จะได้ระยะเวลาติดลบ
       ลากมัธยฐานลงจนอาจารย์อ่านว่า "งานประเภทนี้เร็วมาก" */
    finished('CD', { acceptedDate: '2026-09-01', completedAt: '2026-06-01' }),
    finished('RRM', { acceptedDate: '2026-06-01', completedAt: '2026-07-01' }), // Recall ไม่อยู่ใน 4 ประเภท
  ]);
  const cd = rows.find((r) => r.type === 'CD')!;
  ok('นับเฉพาะแถวที่ระยะเวลาเป็นบวก', cd.samples === 2, cd.samples);
  ok('ค่าต่ำสุดไม่ติดลบ', cd.minWeeks > 0, cd.minWeeks);
  ok('มัธยฐานของ 2 ค่า = ปัดค่ากลาง', cd.medianWeeks === Math.round((4 + 13) / 2), cd.medianWeeks);
  ok('Recall ไม่มีแถวของตัวเอง (นับเฉพาะ 4 ประเภทหลัก)', !rows.some((r) => r.type === 'RRM'));
  ok('เรียงประเภทที่ใช้เวลานานสุดขึ้นก่อน',
    rows.every((r, i) => i === 0 || rows[i - 1].medianWeeks >= r.medianWeeks));
}

/* ── 4. bottleneckByStep — จำนวนช่องบนแกนต้องตรงกับประเภทงาน ──────────────── */
console.log('\nbottleneckByStep — ชิ้นงานกองอยู่ที่ step ไหน');
{
  ok('ไม่มีงานเลย → ยังมีแกน 0–10 ครบ', bottleneckByStep([], S).length === 11);
  /* เคยพัง (ผู้ใช้ทัก 3 ก.ย.): วาดแกน 0–10 เสมอ แต่ Recall มีแค่ 4 ขั้น
     เหลือช่องว่าง 7 ช่องที่ไม่มีทางมีใครไปถึง */
  ok('เลือกประเภท Recall → แกนมีแค่ 4 ขั้น', bottleneckByStep([], S, 'RRM').length === 4,
    bottleneckByStep([], S, 'RRM').length);
  ok('เลือกประเภท CD → แกน 11 ขั้น', bottleneckByStep([], S, 'CD').length === 11);
}
{
  /* หมายเหตุ: bottleneckByStep (และ funnelByType) ไม่รับพารามิเตอร์ now — isStale ข้างในจึง
     เทียบกับนาฬิกาเครื่องเสมอ วันที่ของเทสต์ชุดนี้จึงต้องอิงเวลาจริง ไม่ใช่ NOW ที่ตรึงไว้ */
  const buckets = bottleneckByStep([
    wp('CD'),                                    // ยังไม่เริ่ม → ลงถัง 0
    at('CD', 6),
    at('CD', 6, { lastUpdatedAt: staleByWallClock }),
    finished('CD'),                              // จบแล้ว ไม่ใช่คอขวด
    at('CD', 6, { returned: true }),             // คืนเคสแล้ว ไม่ใช่คอขวด
  ], S, 'CD');
  ok('งานที่ยังไม่เริ่มลงถัง step 0', buckets[0].count === 1, buckets[0].count);
  ok('งานที่จบแล้วและงานที่คืนแล้วไม่กองอยู่บนแกน',
    buckets.reduce((s, b) => s + b.count, 0) === 3, buckets.reduce((s, b) => s + b.count, 0));
  ok('นับเคสค้างแยกไว้ในถังเดียวกัน', buckets[6].count === 2 && buckets[6].stale === 1,
    `count=${buckets[6].count} stale=${buckets[6].stale}`);
  ok('จำนวนเคสค้างไม่มีทางมากกว่าจำนวนในถัง', buckets.every((b) => b.stale <= b.count));
  ok('ทุกถังมีชื่อขั้นตอนกำกับ (ไม่งั้นผู้ใช้กดดูแล้วเจอช่องว่าง)',
    buckets.every((b) => b.label.length > 0));
}
{
  const rr = bottleneckByStep([at('RRM', 2)], S, 'RRM');
  ok('ชื่อขั้นของ Recall มาจากลิสต์ Recall ไม่ใช่ของ CD',
    rr[2].count === 1 && rr[2].label.includes('บันทึกผล'), rr[2].label);
}

/* ── 5. funnelByType — อัตราจบเคส ────────────────────────────────────────── */
console.log('\nfunnelByType');
ok('ไม่มีงานเลย → ลิสต์ว่าง ไม่ใช่แถวที่หารศูนย์', funnelByType([], S).length === 0);
{
  const rows = funnelByType([
    wp('CD'), at('CD', 5), finished('CD'), finished('CD'),
    wp('CB'),
  ], S);
  const cd = rows.find((r) => r.type === 'CD')!;
  ok('อัตราจบ = จบ/ทั้งหมด ปัดเศษ', cd.completionRate === 50, cd.completionRate);
  ok('ยังไม่เริ่ม + กำลังทำ + จบแล้ว = ทั้งหมด (เมื่อไม่มีเคสคืน)',
    cd.notStarted + cd.inProgress + cd.completed === cd.total,
    `${cd.notStarted}+${cd.inProgress}+${cd.completed} vs ${cd.total}`);
  ok('อัตราจบของประเภทที่ยังไม่มีใครจบ = 0 ไม่ใช่ NaN',
    rows.find((r) => r.type === 'CB')!.completionRate === 0);
  ok('เรียงตามลำดับในชีต (CD ก่อน Crown)',
    rows.findIndex((r) => r.type === 'CD') < rows.findIndex((r) => r.type === 'CB'));
}
{
  /* เคยพัง (ผู้ใช้เคาะ 9 ก.ย. 69): เคสที่คืนไปแล้วถูกนับอยู่ในตัวหารของอัตราจบ
     นศ. ที่คืนเคสเพราะคนไข้ย้ายจังหวัดจึงมีอัตราจบต่ำลง ทั้งที่ไม่ใช่ความผิด
     ซ้ำยังไม่ถูกนับใน inProgress ด้วย = สามช่องบวกกันไม่เท่า total ในตารางเดียวกัน
     ตอนนี้เคสคืนถูกยกออกจากช่องทั้งหมด แล้วแยกไปนับในช่อง returned ของตัวเอง */
  const rows = funnelByType([finished('CD'), at('CD', 4, { returned: true })], S);
  const cd = rows[0];
  ok('เคสคืนแล้วไม่กดอัตราจบของ นศ.', cd.completionRate === 100, cd.completionRate);
  ok('เคสคืนแล้วถูกยกออกจาก "รับมา" ด้วย ตารางจะได้บวกกันได้',
    cd.total === 1 && cd.notStarted + cd.inProgress + cd.completed === cd.total,
    `${cd.notStarted}+${cd.inProgress}+${cd.completed} vs ${cd.total}`);
  ok('แต่ไม่หายไปเฉยๆ — นับแยกไว้ในช่องคืนเคส', cd.returned === 1, cd.returned);
}
{
  // ประเภทที่มีแต่เคสคืนล้วน ต้องยังมีแถวให้เห็น ไม่ใช่หายทั้งบรรทัด
  const rows = funnelByType([at('RPD', 2, { returned: true })], S);
  ok('ประเภทที่คืนหมดทุกเคส → ยังมีแถว และบอกว่าคืนไปกี่เคส',
    rows.length === 1 && rows[0].total === 0 && rows[0].returned === 1 && rows[0].completionRate === 0,
    JSON.stringify(rows[0]));
}
{
  // เคสค้างต้องนับเฉพาะงานที่ยังทำอยู่จริงเหมือนเดิม (isStale กันเคสคืนไว้อยู่แล้ว)
  const rows = funnelByType([at('CD', 3, { lastUpdatedAt: staleByWallClock }), at('CD', 3)], S);
  ok('ยังนับเคสค้างได้ถูกต้อง', rows[0].stale === 1, rows[0].stale);
}

/* ── 6. profile / heatmap — 6 แกนบนหน้ากลุ่ม ─────────────────────────────── */
console.log('\nprofile — ทุกแกนเป็น % ของเป้าหมาย');
{
  const axes = profile([], S, NOW);
  ok('นศ. ที่ไม่มีงานเลย → ยังได้ครบ 6 แกน', axes.length === 6, axes.length);
  ok('ทุกแกนเป็นตัวเลข 0–100 ไม่ใช่ NaN',
    axes.every((a) => Number.isFinite(a.value) && a.value >= 0 && a.value <= 100),
    axes.map((a) => `${a.key}=${a.value}`).join(' '));
  /* เคยพัง (ผู้ใช้เคาะ 9 ก.ย. 69): แกน "lab ทำเอง" ใช้ pct() ตัวเดียวกับแกนเกณฑ์
     ซึ่งถือว่า "ไม่มีเป้า = ครบ" → นศ. ที่ยังไม่มีงานเลยได้ 100% ในช่องนี้
     บน heatmap หน้ากลุ่มจึงมีช่องเขียวเต็มหนึ่งช่องปนกับอีก 5 ช่องที่เป็น 0
     แต่ตัวหารของแกนนี้คือ "โอกาสที่มีให้ทำ" ไม่ใช่เป้าหมาย — ไม่มีโอกาส ≠ ทำครบแล้ว */
  ok('ทุกแกนเป็น 0 เมื่อยังไม่มีงาน รวมแกน lab ทำเอง',
    axes.every((a) => a.value === 0), axes.map((a) => `${a.key}=${a.value}`).join(' '));
  ok('ยังบอกตัวเลขจริงกำกับไว้ว่า 0/0 (ไม่ใช่ซ่อนไปเฉยๆ)',
    axes.find((a) => a.key === 'self')!.detail === '0/0', axes.find((a) => a.key === 'self')!.detail);
}
{
  /* มีเคสแต่เป็น Recall ล้วน ซึ่งไม่มี lab ติดดาวสักข้อ → ก็ยังเป็น 0 ด้วยเหตุผลเดียวกัน */
  ok('มีแต่เคส Recall (ไม่มี lab ให้ทำเอง) → แกน lab ทำเอง = 0 ไม่ใช่ 100',
    profile([finished('RRM')], S, NOW).find((a) => a.key === 'self')!.value === 0);
  /* แต่แกนเกณฑ์ต้องใช้กติกาเดิม: ถ้าภาคตั้งเป้าเป็น 0 = ไม่ติดเงื่อนไขข้อนั้น = ครบ */
  ok('แกนเกณฑ์ที่ภาคตั้งเป้าเป็น 0 → ยังนับว่าครบ (100%) เหมือนเดิม',
    profile([], withReq({ req: { ...S.req, postCoreMin: 0 } }), NOW).find((a) => a.key === 'postcore')!.value === 100);
  ok('ทำ lab ไปแล้วบางส่วน → คิดเป็น % ตามปกติ',
    profile([at('CD', 5)], S, NOW).find((a) => a.key === 'self')!.value > 0);
}
{
  const list = [finished('CD'), finished('CD'), at('RPD', 5)];
  const axes = profile(list, S, NOW);
  const cd = axes.find((a) => a.key === 'cd')!;
  ok('CD ครบ 2/2 = 100%', cd.value === 100 && cd.detail === `2/${S.req.cd}`, cd.detail);
  ok('ทำเกินเป้า ค่าไม่ทะลุ 100', profile([...list, finished('CD')], S, NOW).find((a) => a.key === 'cd')!.value === 100);
  ok('แกนที่ครบแล้ว ไม่มีช่องเหลือให้เติมงานที่กำลังทำ', (cd.partials ?? []).length === 0);
  const rpd = axes.find((a) => a.key === 'rpd')!;
  ok('งานที่กำลังทำโผล่เป็นเศษส่วนในแกนที่ยังไม่ครบ',
    (rpd.partials ?? []).length === 1 && rpd.partials![0] > 0 && rpd.partials![0] < 1, rpd.partials);
  ok('เศษส่วนไม่นับงานที่จบแล้วซ้ำ', (cd.partials ?? []).every((f) => f < 1));
}
{
  const cases = [finished('CD'), at('RPD', 5, { returned: true })];
  ok('เคสที่คืนแล้วไม่ไปเติมช่องว่างในโปรไฟล์',
    (profile(cases, S, NOW).find((a) => a.key === 'rpd')!.partials ?? []).length === 0);
}
{
  ok('averageProfile ของกลุ่มว่าง → ไม่หารศูนย์',
    averageProfile([], [], S, NOW).every((a) => Number.isFinite(a.value)));
  const heat = heatmapRows([student({ id: 'x' }), student({ id: 'y' })], [], S, NOW);
  ok('heatmap ให้ทุกคนครบแม้ไม่มีงานสักชิ้น',
    heat.length === 2 && heat.every((h) => h.cells.length === 6));
}

/* ── 7. burn-up + ยอดยกมา ────────────────────────────────────────────────── */
console.log('\nburnup — เส้นสะสมของ "ปีการศึกษานี้"');
{
  const pts = burnup([], [], S, NOW);
  ok('ไม่มีนักศึกษาเลย → 10 จุด เส้นเป้าเป็น 0 ไม่ใช่ NaN',
    pts.length === 10 && pts.every((p) => p.target === 0));
  ok('ไม่มีข้อมูลปีก่อน → เส้นเทียบเป็น null (กราฟจะได้ไม่ลากเส้นศูนย์หลอกตา)',
    pts.every((p) => p.lastYear === null));
}
{
  const st = [student({ id: 'a' }), student({ id: 'b' })];
  const pts = burnup(st, [], S, NOW);
  ok('เดือนที่ยังมาไม่ถึง actual = null ไม่ใช่ 0', pts[4].actual === 0 && pts[5].actual === null,
    pts.map((p) => p.actual).join(','));
  /* เส้นเป้าเริ่มไต่หลังเดือนที่ 3 — ก่อนหน้านั้นจบเคสไม่ได้จริง (ผู้ใช้ทัก 2 ก.ย.
     ว่าเส้นตรงจากศูนย์ทำให้ต้นปีดูแดงเกินจริง) */
  ok('3 เดือนแรกเป้ายังเป็น 0', pts.slice(0, 3).every((p) => p.target === 0),
    pts.map((p) => p.target).join(','));
  ok('เดือนสุดท้ายเป้า = จำนวน นศ. × เกณฑ์รายปี',
    pts[9].target === st.length * S.req.perYear, pts[9].target);
  ok('เส้นเป้าไม่ถอยหลัง', pts.every((p, i) => i === 0 || pts[i - 1].target <= p.target));
}
{
  /* เคยพัง (ผู้ใช้เห็น 287 ในเดือนเดียว 3 ก.ย.): งานนำเข้าไม่มีวันจบจริง
     ประทับเป็นวันนำเข้า ถ้านับตามนั้นเส้นจะพุ่งตั้งฉากในเดือนที่นำเข้า */
  const imported = finished('CD', { fromSheet: true, completedAt: NOW.toISOString() });
  const importedLastYear = finished('RPD', { fromSheet: true, completedAt: NOW.toISOString(), countsForYear: 2568 });
  const notFromSheet = finished('CB', { completedAt: '2026-09-01' });
  const recall = finished('RRM', { fromSheet: true, completedAt: NOW.toISOString() });

  ok('งานนำเข้าของปีนี้ = ยอดยกมา', carriedOverCount([imported], S, NOW) === 1);
  ok('งานนำเข้าที่ชีตระบุว่านับเข้าปีก่อน ไม่อยู่ในยอดยกมาปีนี้',
    carriedOverCount([importedLastYear], S, NOW) === 0);
  ok('งานที่บันทึกในแอป (ไม่ใช่จากชีต) ไม่ใช่ยอดยกมา', carriedOverCount([notFromSheet], S, NOW) === 0);
  ok('Recall ไม่นับ เมื่อเกณฑ์รายปีนับเฉพาะ 4 ประเภทหลัก', carriedOverCount([recall], S, NOW) === 0);
  ok('สลับเป็นนับทุกประเภท → Recall เข้ายอดยกมา',
    carriedOverCount([recall], withReq({ perYearCountsAllTypes: true }), NOW) === 1);

  const pts = burnup([S1], [imported, importedLastYear, notFromSheet], S, NOW);
  ok('เส้น actual เริ่มที่ยอดยกมา ตั้งแต่เดือนแรก', pts[0].actual === 1, pts[0].actual);
  ok('คำอธิบายใต้กราฟกับจุดแรกของกราฟใช้เลขเดียวกัน',
    pts[0].actual === carriedOverCount([imported, importedLastYear, notFromSheet], S, NOW));
  ok('เส้น actual ไม่ถอยหลัง',
    pts.filter((p) => p.actual !== null).every((p, i, arr) => i === 0 || arr[i - 1].actual! <= p.actual!),
    pts.map((p) => p.actual).join(','));
}
{
  /* งานที่จบไปตั้งแต่ปีการศึกษาก่อน (บันทึกในแอป ไม่ใช่จากชีต) ต้องไม่นับเป็นผลงานปีนี้
     ไม่งั้น นศ. ปี 6 จะเริ่มเส้นปีนี้ที่ยอดของปี 5 แล้วดูเหมือนนำแผนตั้งแต่เดือนแรก
     — ซ้ำร้ายชิ้นเดียวกันไปโผล่ในเส้น "ปีที่แล้ว" ด้วย = นับสองรอบบนกราฟเดียว */
  const lastYear = finished('CD', { acceptedDate: '2025-06-01', completedAt: '2025-09-01' });
  const pts = burnup([S1], [lastYear], S, NOW);
  ok('เคสที่จบปีการศึกษาก่อน ไม่ไหลมาเป็นยอดของปีนี้', pts[0].actual === 0,
    pts.map((p) => p.actual).join(','));
  ok('เคสของปีก่อนไปอยู่ในเส้นเทียบ "ปีที่แล้ว" แทน', (pts[9].lastYear ?? 0) === 1, pts[9].lastYear);
}

/* ── 8. headline / caseDots / selfPerformedRows — ต้องไม่พังเมื่อข้อมูลว่าง ── */
console.log('\nส่วนที่เหลือ — ระบบเพิ่งติดตั้ง ยังไม่มีข้อมูลสักแถว');
{
  const h = headline([], [], S, [], [], NOW);
  ok('หัวหน้าหน้าวิเคราะห์: ทุกตัวเลขเป็น 0 ไม่ใช่ undefined/NaN',
    h.atRisk === 0 && h.watch === 0 && h.busiestCount === 0 && Number.isFinite(h.monthsLeft),
    JSON.stringify(h));
  /* ⚠️ สัญญาที่ UI พึ่งอยู่: เมื่อไม่มีข้อมูล headline ยังคืนชื่อประเภท/ชื่อ step ของถังแรก
     (slowestType 'CD', busiestLabel 'Primary impression') ไม่ได้คืนค่าว่าง
     หน้าจอจึงต้องเช็ค busiestCount > 0 ก่อนเสมอ ไม่งั้นจะขึ้นว่า "งาน CD/APD กองอยู่ที่
     step 0 มากที่สุด (0 ชิ้น)" ในระบบที่ยังไม่มีข้อมูลสักแถว
     (Dashboard.tsx:504 และ Analytics.tsx:65 เช็คไว้แล้ว — ข้อนี้กันไม่ให้ใครลืมเช็ค) */
  ok('ไม่มีข้อมูล → busiestCount = 0 ให้หน้าจอใช้เป็นสวิตช์ปิดข้อความ', h.busiestCount === 0);
  ok('ไม่มีข้อมูล → ระยะเวลานานสุดเป็น 0 (ป้ายชื่อประเภทเชื่อไม่ได้ถ้าไม่ดูตัวเลขคู่กัน)',
    h.slowestWeeks === 0, `${h.typeLabel} ${h.slowestWeeks}`);
}
{
  const dots = caseDots([at('CD', 3), finished('CD'), at('CD', 1, { returned: true })], [S1], S);
  ok('หนึ่งจุด = หนึ่งงานที่ยังทำอยู่ (จบ/คืนแล้วไม่มีจุด)', dots.length === 1, dots.length);
  ok('ป้ายของจุดมีชื่อคนและ step', dots[0].label.includes('นศ.') && dots[0].label.includes('step 3'), dots[0].label);
  ok('นักศึกษาที่ไม่อยู่ในลิสต์ → ยังวาดจุดได้ ไม่พัง',
    caseDots([at('CD', 3, { studentId: 'ไม่รู้จัก' })], [], S).length === 1);
}
{
  const rows = selfPerformedRows([S1], []);
  ok('นศ. ที่ไม่มีงาน → 0/0 ไม่ใช่ NaN', rows[0].done === 0 && rows[0].available === 0);
  const cd = selfPerformedRows([S1], [finished('CD')])[0];
  ok('จบเคส CD → ทำ lab ครบทุกข้อที่มีในเคส', cd.done === cd.available && cd.available > 0,
    `${cd.done}/${cd.available}`);
  const recall = selfPerformedRows([S1], [finished('RRM')])[0];
  ok('Recall ไม่มี lab ให้ทำเอง → 0/0', recall.available === 0);
}

console.log(bad ? `\n❌ ตก ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
