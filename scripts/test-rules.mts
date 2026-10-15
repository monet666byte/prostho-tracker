/**
 * ทดสอบ src/domain/rules.ts — รันด้วย `npm run test:rules`
 *
 * ทำไมต้องมี: ไฟล์นี้คือสมองของทั้งแอป — % completed, เคสค้าง, การนับเข้าเกณฑ์
 * ทุกตัวเลขที่นักศึกษาและอาจารย์เห็นออกมาจากที่นี่ ถ้าคำนวณเพี้ยนจะไม่มี error
 * ให้เห็น มีแต่ตัวเลขที่ผิดแบบดูดี ๆ — ซึ่งอันตรายกว่าแอปพัง
 *
 * เน้นเทสต์ 3 กลุ่ม:
 *   1. กฎที่ "รอภาควิชายืนยัน" (pairCountsAsOne, perYearCountsAllTypes) — ต้องสลับได้จริงทั้งสองทาง
 *   2. บั๊กที่เคยเจอมาแล้ว — กันไม่ให้กลับมาอีก (มีคอมเมนต์กำกับว่าเคยพังยังไง)
 *   3. ขอบที่ทำให้ "ครบเกณฑ์" ผิด — เพราะกระทบการจบของนักศึกษาโดยตรง
 */
import {
  activeStepGroup, caseCount, completionImpact, groupByReqRow, caseCountTotals, completedInYear, countCDA, countsTowardRequirement,
  daysSinceUpdate, isActiveWork, isStale, isWaitingForPatient, maxProgression, meetsAllRequirements, needsWaitNudge, WAIT_MAX_DAYS,
  overallPercent, percentCompleted, procList, requirementFlag, sortWorkpieces, yearlyRows,
} from '../src/domain/rules.ts';
import { workLabel } from '../src/domain/catalog.ts';
import { readDefaultSettings } from './test-helpers.mts';
import type { Settings, Workpiece, WorkType } from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

/** วันอ้างอิงของทุกเทสต์ — ต.ค. 2026 = ปีการศึกษา 2569 */
const NOW = new Date('2026-10-15T09:00:00+07:00');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let seq = 0;
/** ชิ้นงานตั้งต้น — ยังไม่เริ่มทำ นับเข้าเกณฑ์ อัปเดตวันนี้ */
function wp(type: WorkType, over: Partial<Workpiece> = {}): Workpiece {
  return {
    id: `w${++seq}`, patientId: `p${seq}`, studentId: 's1', type,
    detail: type, acceptedDate: '2026-08-01', minimumRequirement: true,
    payment: 'ชำระแล้ว', sect2Removable: true, sect2Fixed: true,
    procIndex: -1, lastUpdatedAt: NOW.toISOString(), catalogVersion: '2569',
    ...over,
  };
}
/** ทำให้ชิ้นงานจบเคส (procedure สุดท้ายของประเภทนั้น) */
function done(w: Workpiece, completedAt = '2026-09-01'): Workpiece {
  return { ...w, procIndex: procList(w).length - 1, completedAt };
}
/** ชิ้นงานที่จบแล้วในหนึ่งบรรทัด */
const finished = (type: WorkType, over: Partial<Workpiece> = {}) => done(wp(type, over));

const S = readDefaultSettings();
const withReq = (over: Partial<Settings>): Settings => ({ ...S, ...over });

/* ── 1. % completed ───────────────────────────────────────────────────────── */
console.log('\n% completed — สูตร (progression + 1) / (maxProgression + 1)');
ok('ยังไม่เริ่ม = 0%', percentCompleted(wp('CD')) === 0);
ok('จบเคส = 100%', percentCompleted(finished('CD')) === 100);
{
  // CD มี progression 0–10 → อยู่ที่ progression 4 ควรได้ round(5/11*100) = 45
  const at4 = procList(wp('CD')).findIndex((p) => p[0] === 4);
  const v = percentCompleted(wp('CD', { procIndex: at4 }));
  ok('CD กลางทาง (progression 4) = 45%', v === 45, v);
}
{
  // Recall มีแค่ progression 0–3 — ถ้าไปหาร 11 ตายตัวจะได้ 36% แทนที่จะเป็น 100%
  const r = finished('RRM');
  ok('Recall จบเคส = 100% (maxProgression 3 ไม่ใช่ 10)', percentCompleted(r) === 100, percentCompleted(r));
  ok('maxProgression ของ Recall = 3', maxProgression(r) === 3, maxProgression(r));
}
ok('นักศึกษาที่ยังไม่มีงานเลย = 0% ไม่ใช่ NaN', overallPercent([]) === 0, overallPercent([]));

/* ── 2. คืนเคส ─────────────────────────────────────────────────────────────── */
console.log('\nคืนเคส — ไม่ใช่งานที่ทำอยู่ และไม่ควรค้างตลอดกาล');
const returnedOld = wp('CD', { returned: true, lastUpdatedAt: daysBefore(60) });
ok('คืนเคสแล้ว ไม่นับเป็นงานที่ทำอยู่', !isActiveWork(returnedOld));
/* เคยพัง: isStale ดูแค่ !isComplete เคสที่คืนไปแล้วจึงค้างถาวร (ไม่มีใครอัปเดตอีก)
   ไปพองอยู่ในตัวเลข "เคสค้าง" ของหน้าอาจารย์ทุกหน้าไม่มีวันหาย */
ok('คืนเคสแล้ว ไม่นับเป็นเคสค้าง', !isStale(returnedOld, S, NOW));

/* ── 3. เคสค้าง ────────────────────────────────────────────────────────────── */
console.log('\nเคสค้าง — ตั้งไว้ที่ ' + S.stale + ' วัน');
ok('ครบพอดี ' + S.stale + ' วัน = ค้าง', isStale(wp('CD', { lastUpdatedAt: daysBefore(S.stale) }), S, NOW));
ok('ก่อนครบ 1 วัน = ยังไม่ค้าง', !isStale(wp('CD', { lastUpdatedAt: daysBefore(S.stale - 1) }), S, NOW));
ok('จบเคสแล้ว ต่อให้ทิ้งไว้ 60 วันก็ไม่ค้าง',
  !isStale(done(wp('CD', { lastUpdatedAt: daysBefore(60) })), S, NOW));
ok('นับวันไม่ติดลบเมื่อวันที่ในอนาคต',
  daysSinceUpdate(wp('CD', { lastUpdatedAt: '2027-01-01' }), NOW) === 0);

/* ── 4. นับเข้าเกณฑ์หรือไม่ ─────────────────────────────────────────────────── */
console.log('\nชิ้นงานไหนนับเข้าเกณฑ์');
ok('จบ + ติดธงเกณฑ์ + ประเภทหลัก → นับ', countsTowardRequirement(finished('CD')));
ok('ยังไม่จบ → ไม่นับ', !countsTowardRequirement(wp('CD')));
ok('อาจารย์ยังไม่ตรวจรับ (pendingQualification) → ไม่นับ',
  !countsTowardRequirement(finished('CD', { pendingQualification: true })));
ok('ไม่ได้ติดธง minimumRequirement → ไม่นับ',
  !countsTowardRequirement(finished('CD', { minimumRequirement: false })));
ok('Simple APD นับเข้าเกณฑ์สะสม (กลุ่ม RPD)', countsTowardRequirement(finished('APD')));
/* ป้ายบนหน้าเคส (requirementFlag) ต้องตรงกับตัวนับ — เดิม Simple APD ที่ติ๊กไว้ขึ้นป้าย "นับ" ทั้งที่ไม่เคยนับจริง */
{
  const all: WorkType[] = ['CD', 'RPD', 'APD', 'PC', 'CB', 'RRM', 'RFX'];
  const mismatch = all.flatMap((ty) => [true, false].flatMap((flag) => {
    const w = finished(ty, { minimumRequirement: flag });
    return (requirementFlag(w) === 'on') === countsTowardRequirement(w) ? [] : [`${ty}/${flag}`];
  }));
  ok('ป้าย "นับ" บนหน้าเคส = จบแล้วนับจริง ทุกประเภท', mismatch.length === 0, mismatch.join(' '));
  ok('Simple APD ขึ้นป้าย "นับ" เหมือนประเภทอื่น', requirementFlag(wp('APD')) === 'on');
  ok('ประเภทที่ catalog ไม่รู้จัก ไม่ขึ้นป้ายนับหรือไม่นับ', requirementFlag(wp('XYZ' as WorkType)) === 'never');
  ok('ปิดสวิตช์ → ป้าย "ไม่นับ"', requirementFlag(wp('CD', { minimumRequirement: false })) === 'off');
}
/* Recall เข้าเกณฑ์สะสมตั้งแต่ 10 ก.ย. 69 (ผู้ใช้เพิ่ม: งานถอดได้ 1 · งานติดแน่น 1)
   แต่ยัง **ไม่** เข้าเกณฑ์รายปี — สองชุดนี้ต่างกัน ดู CUM_REQ_TYPES กับ REQ_TYPES ใน catalog.ts
   (ข้อที่ยืนยันว่ารายปีไม่นับ อยู่ในหัวข้อ "เกณฑ์รายปี" ข้างล่าง) */
ok('Recall งานถอดได้ นับเข้าเกณฑ์สะสม', countsTowardRequirement(finished('RRM')));
ok('Recall งานติดแน่น นับเข้าเกณฑ์สะสม', countsTowardRequirement(finished('RFX')));

/* ── 5. Count CDA ──────────────────────────────────────────────────────────── */
console.log('\nCount CDA — นับเฉพาะ arch ที่เป็น CD หรืองาน Complicated');
{
  const list = [
    wp('CD', { dentureClass: 'CD' }),
    wp('CD', { dentureClass: 'complicated-APD' }),
    wp('RPD', { dentureClass: 'complicated-RPD' }),
    wp('RPD', { dentureClass: 'simple-RPD' }),   // ไม่นับ
    wp('APD', { dentureClass: 'simple-APD' }),   // ไม่นับ
    wp('CB'),                                     // ไม่มี dentureClass → ไม่นับ
  ];
  ok('3 จาก 6 แถวเข้าสูตร', countCDA(list) === 3, countCDA(list));
}

/* ── 6. เกณฑ์สะสม + ข้อที่รอภาควิชายืนยัน ──────────────────────────────────── */
console.log('\nเกณฑ์สะสม — CD ' + S.req.cd + ' · RPD ' + S.req.rpd + ' · Crown ' + S.req.crown);
const cdRow = (list: Workpiece[], st: Settings) => caseCount(list, st).find((r) => r.group === 'CD')!;
const crownRow = (list: Workpiece[], st: Settings) => caseCount(list, st).find((r) => r.group === 'CROWN')!;
{
  const pair = [
    finished('CD', { arch: 'upper', pairId: 'pr1' }),
    finished('CD', { arch: 'lower', pairId: 'pr1' }),
  ];
  const rowSep = cdRow(pair, withReq({ pairCountsAsOne: false }));
  const rowOne = cdRow(pair, withReq({ pairCountsAsOne: true }));
  ok('นับรายแถว (ค่าเริ่มต้น): คู่บน+ล่าง = 2', rowSep.done === 2, rowSep.done);
  ok('นับรายแถว: ครบเกณฑ์ CD แล้ว', rowSep.complete);
  ok('นับต่อเคส: คู่บน+ล่าง = 1', rowOne.done === 1, rowOne.done);
  ok('นับต่อเคส: ยังไม่ครบเกณฑ์ CD', !rowOne.complete);

  const half = [pair[0], wp('CD', { arch: 'lower', pairId: 'pr1' })];
  ok('นับต่อเคส: จบข้างเดียว ยังไม่นับเป็นเคส',
    cdRow(half, withReq({ pairCountsAsOne: true })).done === 0,
    cdRow(half, withReq({ pairCountsAsOne: true })).done);

  const halfPending = [
    finished('CD', { arch: 'upper', pairId: 'pr2' }),
    finished('CD', { arch: 'lower', pairId: 'pr2', pendingQualification: true }),
  ];
  ok('นับต่อเคส: อีกข้างรออาจารย์ตรวจรับ ยังไม่นับ',
    cdRow(halfPending, withReq({ pairCountsAsOne: true })).done === 0);
}
{
  const twoCrowns = [finished('CB'), finished('CB')];
  const r = crownRow(twoCrowns, S);
  ok('Crown ครบจำนวนแต่ไม่มี Post-core → ยังไม่ครบ', r.done === 2 && !r.complete, `done=${r.done}`);
  ok('บอกได้ว่าที่ขาดคือ Post-core', r.postCoreDone === 0 && r.postCoreComplete === false);

  const mixed = [finished('CB'), finished('PC')];
  const r2 = crownRow(mixed, S);
  ok('Crown 1 + Post-core 1 → ครบ', r2.done === 2 && r2.complete);
}
/* เกณฑ์ RPD = Co-Cr RPD หรือ Simple APD รวมกัน โดยต้องเป็น Co-Cr อย่างน้อย coCrMin
   เกณฑ์ CD = CD หรือ Complicated APD รวมกัน — หน้าจอแยกชนิดให้เห็น แต่นับรวม */
const rpdRow = (list: Workpiece[], st: Settings) => caseCount(list, st).find((r) => r.group === 'RPD')!;
{
  const twoApd = [finished('APD', { dentureClass: 'simple-APD' }), finished('APD', { dentureClass: 'simple-APD' })];
  const r = rpdRow(twoApd, S);
  ok('Simple APD 2 ชิ้น → RPD 2/2 แต่ยังไม่ครบ (ไม่มี Co-Cr)', r.done === 2 && !r.complete, `done=${r.done}`);
  ok('บอกได้ว่าที่ขาดคือ Co-Cr', r.must?.label === 'Co-Cr RPD' && r.must.done === 0 && !r.must.complete);

  const mixed = [finished('APD', { dentureClass: 'simple-APD' }), finished('RPD', { dentureClass: 'complicated-RPD' })];
  const r2 = rpdRow(mixed, S);
  ok('Simple APD 1 + Co-Cr (Complicated RPD) 1 → ครบ', r2.done === 2 && r2.complete);
  ok('Complicated RPD นับเป็น Co-Cr', r2.must?.done === 1);

  ok('ตั้ง Co-Cr = 0 → Simple APD 2 ชิ้นครบได้', rpdRow(twoApd, withReq({ req: { ...S.req, coCrMin: 0 } })).complete);

  const parts = r2.parts!;
  ok('รายการชนิดย่อยของ RPD: Co-Cr 1 · Simple APD 1',
    parts.find((p) => p.key === 'RPD')?.done === 1 && parts.find((p) => p.key === 'APD')?.done === 1);
  ok('Co-Cr เป็นชนิดที่บังคับ', parts.find((p) => p.key === 'RPD')?.required === S.req.coCrMin);
}
{
  const list = [
    finished('CD', { dentureClass: 'CD' }),
    wp('CD', { dentureClass: 'complicated-APD', procIndex: 5 }),
    wp('CD', { dentureClass: 'complicated-APD', procIndex: 3, minimumRequirement: false }), // ปิดสวิตช์ → ไม่ขึ้นเป็นกำลังทำ
  ];
  const r = cdRow(list, S);
  const cd = r.parts!.find((p) => p.key === 'CD')!;
  const capd = r.parts!.find((p) => p.key === 'complicated-APD')!;
  ok('CD แยกชนิด: CD จบ 1 · Complicated APD กำลังทำ 1', cd.done === 1 && cd.doing === 0 && capd.done === 0 && capd.doing === 1,
    `cd ${cd.done}/${cd.doing} · capd ${capd.done}/${capd.doing}`);
  ok('แถบ CD ยังนับรวม (= ผลรวมชนิดย่อย)', r.done === cd.done + capd.done);
  const cdNoClass = cdRow([finished('CD')], S).parts!.find((p) => p.key === 'CD')!;
  ok('CD ที่ไม่มีลักษณะเคส (นำเข้าจากชีต) ไปอยู่บรรทัด CD', cdNoClass.done === 1);
}
{
  /* ป้ายชนิดงานบนการ์ดเคส/หน้าแรก — ต้องแยกชนิดเดียวกับรายการใต้แถบเกณฑ์ */
  ok('ป้าย: CD / Complicated APD / Co-Cr RPD / Simple APD',
    workLabel(wp('CD', { dentureClass: 'CD' })) === 'CD'
    && workLabel(wp('CD', { dentureClass: 'complicated-APD' })) === 'Complicated APD'
    && workLabel(wp('RPD', { dentureClass: 'complicated-RPD' })) === 'Co-Cr RPD'
    && workLabel(wp('APD', { dentureClass: 'simple-APD' })) === 'Simple APD');
  ok('ป้าย: CD ที่ไม่มีลักษณะเคสเป็น CD (ตรงกับตัวนับ)', workLabel(wp('CD')) === 'CD');
  ok('ป้าย: ประเภทไม่รู้จักไม่ระเบิด', workLabel(wp('XYZ' as WorkType)) === '?');

  const items = [wp('CB', { id: 'c1' }), wp('APD', { id: 'a1' }), wp('XYZ' as WorkType, { id: 'x1' }), wp('RPD', { id: 'r1' }), wp('CD', { id: 'd1' })];
  const groups = groupByReqRow(items, caseCount(items, S));
  ok('จัดกลุ่มหน้าแรกตามแถวเกณฑ์: CD → RPD → Crown → ไม่รู้จัก',
    groups.map((g) => g.row?.group ?? 'none').join(',') === 'CD,RPD,CROWN,none', groups.map((g) => g.row?.group ?? 'none').join(','));
  ok('Simple APD อยู่กลุ่ม RPD และคงลำดับเดิมในกลุ่ม', groups[1].items.map((w) => w.id).join(',') === 'a1,r1');
  ok('ไม่มีเคสหายหรือซ้ำตอนจัดกลุ่ม', groups.reduce((n, g) => n + g.items.length, 0) === items.length);
}
{
  /* ทุกแถวที่มีชนิดย่อย: ผลรวมชิ้นที่จบของชนิดย่อย = ตัวเลขบนแถบ (นับรายแถว) — สองตัวเลขบนการ์ดเดียวต้องไม่ขัดกัน */
  const many: Workpiece[] = [
    finished('CD'), finished('CD', { dentureClass: 'complicated-APD' }), finished('RPD'), finished('APD'),
    finished('PC'), finished('CB'), finished('CB', { minimumRequirement: false }), wp('RPD'), wp('APD'),
  ];
  const bad = caseCount(many, S).filter((r) => r.parts && r.parts.reduce((n, p) => n + p.done, 0) !== r.done).map((r) => r.group);
  ok('ผลรวมชนิดย่อย = ตัวเลขบนแถบ ทุกแถว', bad.length === 0, bad.join(' '));
}
{
  // การ์ดสรุปต้องไม่โชว์ "8/6" เวลาทำเกินเกณฑ์
  const over = [finished('CD'), finished('CD'), finished('CD'), finished('CD')];
  const t = caseCountTotals(over, S);
  ok('ทำเกินเกณฑ์ ยอดรวมไม่เกินเพดาน', t.done <= t.required, `${t.done}/${t.required}`);
}

/* ── 7. เกณฑ์รายปี ─────────────────────────────────────────────────────────── */
console.log('\nเกณฑ์รายปี — ทุกปีต้องจบอย่างน้อย ' + S.req.perYear + ' ชิ้น');
{
  /* เคยพัง (ผู้ใช้ทัก 3 ก.ย.): งานที่นำเข้าจากชีตมีวันจบ = วันนำเข้า
     ถ้าดูจาก completedAt อย่างเดียว งานของปี 5 จะไหลมากองในปีปัจจุบันหมด
     ชีตระบุปีไว้เองในคอลัมน์ for PT502/PT602 → ต้องเชื่อชีตก่อน */
  const imported = finished('CD', { completedAt: '2026-09-01', countsForYear: 2568, fromSheet: true });
  ok('มี countsForYear → เข้าปีที่ชีตระบุ', completedInYear([imported], 2568, S).length === 1);
  ok('มี countsForYear → ไม่ไหลมาปีปัจจุบัน', completedInYear([imported], 2569, S).length === 0);

  const normal = finished('CD', { completedAt: '2026-09-01' });
  ok('ไม่มี countsForYear → ใช้ปีการศึกษาของวันจบ', completedInYear([normal], 2569, S).length === 1);

  const recall = finished('RRM', { completedAt: '2026-09-01' });
  ok('นับเฉพาะ 4 ประเภทหลัก (ค่าเริ่มต้น): Recall ไม่นับ', completedInYear([recall], 2569, S).length === 0);
  ok('สลับเป็นนับทุกประเภท: Recall นับ',
    completedInYear([recall], 2569, withReq({ perYearCountsAllTypes: true })).length === 1);

  /* ภาคยืนยัน: เคสที่ไม่นับเกณฑ์สะสม ไม่นับเข้าเกณฑ์รายปีด้วย — เดิมรายปีไม่เช็คสวิตช์ เลขสองชุดจึงขัดกัน */
  const unticked = finished('CD', { completedAt: '2026-09-01', minimumRequirement: false });
  ok('ปิดสวิตช์นับเกณฑ์ → ไม่นับรายปี', completedInYear([unticked], 2569, S).length === 0);
  ok('ปิดสวิตช์นับเกณฑ์ → ไม่นับรายปีแม้เปิดนับทุกประเภท',
    completedInYear([unticked], 2569, withReq({ perYearCountsAllTypes: true })).length === 0);
  const waiting = finished('CD', { completedAt: '2026-09-01', pendingQualification: true });
  ok('รอตรวจรับ → ไม่นับรายปี', completedInYear([waiting], 2569, S).length === 0);
}
{
  /* เคยพัง: รายชื่อปีสร้างจากปีที่มี completedAt เท่านั้น ปีที่จบ 0 ชิ้นจึงหายไป
     → นศ. ที่ปี 2568 จบ 0 แล้วไปเร่งจบทีเดียวในปี 2569 ระบบสรุปว่า "ครบเกณฑ์" */
  const list = [
    wp('CD', { acceptedDate: '2025-08-01' }), // รับเคสปี 2568 แต่ไม่จบสักชิ้นในปีนั้น
    ...['CD', 'CD', 'RPD', 'RPD', 'CB', 'PC', 'RRM', 'RFX'].map((tp) => finished(tp as WorkType, { completedAt: '2026-09-01' })),
  ];
  const rows = yearlyRows(list, S, NOW);
  ok('ปีที่จบ 0 ชิ้นต้องยังอยู่ในรายการตรวจ', rows.some((r) => r.year === 2568), rows.map((r) => r.year).join(','));
  ok('ปี 2568 ตกเกณฑ์', rows.find((r) => r.year === 2568)?.complete === false);
  ok('ปี 2569 ผ่านเกณฑ์', rows.find((r) => r.year === 2569)?.complete === true);
  ok('เกณฑ์สะสมครบแล้ว แต่ยังไม่ถือว่าครบเกณฑ์จบ (เพราะปี 2568 ว่าง)',
    caseCountTotals(list, S).allComplete && !meetsAllRequirements(list, S, NOW));
}

/* ── 8. ครบเกณฑ์จบ + ข้อสอบ/ใบประเมิน ─────────────────────────────────────── */
console.log('\nครบเกณฑ์จบ');
/* ครบเกณฑ์สะสมทุกกลุ่ม = CD 2 · RPD 2 · Crown 2 (มี Post-core 1) · Recall ถอดได้ 1 · Recall ติดแน่น 1
   Recall สองชิ้นเพิ่มเข้ามา 10 ก.ย. 69 — ไม่ใส่ก็จะไม่ครบเกณฑ์อีกต่อไป */
const fullSet = ['CD', 'CD', 'RPD', 'RPD', 'CB', 'PC', 'RRM', 'RFX'].map((tp) =>
  finished(tp as WorkType, { acceptedDate: '2026-08-01', completedAt: '2026-09-01' }));
ok('ชิ้นงานครบทั้งสะสมและรายปี → ครบเกณฑ์', meetsAllRequirements(fullSet, S, NOW));
ok('ไม่มีข้อมูล gate เลย → ไม่บล็อก', meetsAllRequirements(fullSet, S, NOW, {}));
ok('gate ครบ 4 ข้อ → ครบเกณฑ์', meetsAllRequirements(fullSet, S, NOW,
  { sect2Removable: true, sect2Fixed: true, osce: true, designRpd: true }));
ok('gate ขาด 1 ข้อ → ยังไม่ครบ', !meetsAllRequirements(fullSet, S, NOW,
  { sect2Removable: true, sect2Fixed: true, osce: true, designRpd: false }));
ok('ชิ้นงานขาด → ยังไม่ครบ แม้ gate ผ่านหมด',
  !meetsAllRequirements(fullSet.slice(0, 3), S, NOW,
    { sect2Removable: true, sect2Fixed: true, osce: true, designRpd: true }));

/* ── 9. ลำดับการแสดงผล ─────────────────────────────────────────────────────── */
console.log('\nลำดับรายการ');
{
  const list = [
    wp('CB', { id: 'cb', minimumRequirement: true }),
    wp('CD', { id: 'lower', arch: 'lower', pairId: 'pr', patientId: 'p-same' }),
    wp('CD', { id: 'upper', arch: 'upper', pairId: 'pr', patientId: 'p-same' }),
    wp('RPD', { id: 'extra', minimumRequirement: false }),
  ];
  const order = sortWorkpieces(list).map((w) => w.id);
  ok('งานนับเกณฑ์ขึ้นก่อนงานที่ไม่นับ', order.indexOf('extra') === order.length - 1, order.join(' → '));
  ok('CD มาก่อน Crown/Bridge', order.indexOf('upper') < order.indexOf('cb'));
  ok('คู่เดียวกัน upper มาก่อน lower', order.indexOf('upper') < order.indexOf('lower'));
  ok('ไม่แก้ลิสต์เดิม (คืนอาร์เรย์ใหม่)', list[0].id === 'cb');
}

/* ── 10. ขั้นย่อยของ step ที่กำลังทำ (วงแหวนบนหน้าแรก นศ.) ─────────────────── */
console.log('\nขั้นย่อยของ step ที่กำลังทำ');
{
  const list = procList(wp('CD'));
  const firstOf5 = list.findIndex((p) => p[0] === 5);
  const total5 = list.filter((p) => p[0] === 5).length;
  // ผ่านขั้นย่อยแรกของ step 5 แล้ว → กำลังทำ step 5 · เสร็จ 1 ขั้น
  const mid = activeStepGroup(wp('CD', { procIndex: firstOf5 }));
  ok('กลาง step 5: กลุ่มคือ step 5', mid?.progression === 5, mid?.progression);
  ok('กลาง step 5: เสร็จ 1 ขั้นย่อย', mid?.done === 1, mid?.done);
  ok('กลาง step 5: จำนวนขั้นย่อยตรงกับ catalog', mid?.procs.length === total5, mid?.procs.length);
  // ผ่านขั้นย่อยสุดท้ายของ step 4 → กลุ่มที่ทำต่อคือ step 5 ยังไม่เสร็จสักขั้น
  const edge = activeStepGroup(wp('CD', { procIndex: firstOf5 - 1 }));
  ok('ขอบ step 4→5: กลุ่มคือ step 5 เสร็จ 0', edge?.progression === 5 && edge?.done === 0, `${edge?.progression} ${edge?.done}`);
  ok('ยังไม่เริ่ม: กลุ่มแรกเสร็จ 0', activeStepGroup(wp('CD'))?.done === 0);
  ok('จบเคส: ไม่มีกลุ่มที่กำลังทำ', activeStepGroup(finished('CD')) === null);
  ok('Recall: กลุ่มไม่เกินขั้น 3', (activeStepGroup(wp('RRM'))?.progression ?? 99) <= maxProgression(wp('RRM')));
}

/* ── 11. แผ่นฉลองตอนปิดเคส — ตัวเลขต้องตรงกับหน้าเกณฑ์ ───────────────────── */
console.log('\nแผ่นฉลองตอนปิดเคส');
{
  const open = wp('CD', { id: 'cd-open', acceptedDate: '2026-07-02', procIndex: procList(wp('CD')).length - 2 });
  const other = finished('CD', { id: 'cd-old' });
  const before = [open, other];
  const closed = { ...open, procIndex: procList(open).length - 1, completedAt: NOW.toISOString() };
  const after = [closed, other];
  const imp = completionImpact(before, after, closed, S, NOW);
  ok('แถว CD ขยับจาก 1 เป็น 2', imp.rowBefore === 1 && imp.row?.done === 2, `${imp.rowBefore} → ${imp.row?.done}`);
  ok('ยอดสะสมหลังจบ = caseCountTotals ของรายการหลังจบ', imp.totalsAfter.done === caseCountTotals(after, S).done);
  ok('ปีนี้ขยับ +1', imp.year.done === imp.yearBefore + 1, `${imp.yearBefore} → ${imp.year.done}`);
  ok('นับวันจากวันรับเคส', imp.days === 105, imp.days);
  const simple = wp('APD', { id: 'apd', minimumRequirement: false });
  const simpleDone = { ...simple, procIndex: procList(simple).length - 1, completedAt: NOW.toISOString() };
  ok('ปิดสวิตช์นับเกณฑ์ → ไม่มีแถวเกณฑ์', completionImpact([simple], [simpleDone], simpleDone, S, NOW).row === null);
  const apd = wp('APD', { id: 'apd2' });
  const apdDone = { ...apd, procIndex: procList(apd).length - 1, completedAt: NOW.toISOString() };
  ok('Simple APD จบ → แถว RPD ขยับ', completionImpact([apd], [apdDone], apdDone, S, NOW).row?.group === 'RPD');
}


console.log('\nรอคนไข้ — เคสหยุดเพราะคนไข้ไม่นับเป็นค้าง จนเลยวันนัด / เกิน WAIT_MAX_DAYS');
{
  const old = { lastUpdatedAt: daysBefore(30) };
  const plain = wp('CD', old);
  ok('เคสเงียบ 30 วัน ไม่ได้ตั้งรอ = ค้าง', isStale(plain, S, NOW));
  const waitDate = wp('CD', { ...old, waitReason: 'preprosth', waitUntil: '2026-10-28', waitSince: '2026-10-01' });
  ok('ตั้งรอพร้อมวันนัดในอนาคต = ไม่ค้าง', isWaitingForPatient(waitDate, NOW) && !isStale(waitDate, S, NOW));
  ok('วันนัดคือวันนี้ ยังนับว่ารอ', isWaitingForPatient({ ...waitDate, waitUntil: '2026-10-15' }, NOW));
  const past = { ...waitDate, waitUntil: '2026-10-14' };
  ok('เลยวันนัดแล้ว = กลับมาค้างตามปกติ', !isWaitingForPatient(past, NOW) && isStale(past, S, NOW));
  const noDate = wp('CD', { ...old, waitReason: 'busy', waitSince: '2026-10-01' });
  ok('ไม่มีวันนัด รอได้ภายใน WAIT_MAX_DAYS', isWaitingForPatient(noDate, NOW) && !isStale(noDate, S, NOW));
  const tooLong = { ...noDate, waitSince: new Date(NOW.getTime() - WAIT_MAX_DAYS * 86_400_000).toISOString().slice(0, 10) };
  ok('ไม่มีวันนัดและเกิน WAIT_MAX_DAYS = กลับมาค้าง', !isWaitingForPatient(tooLong, NOW) && isStale(tooLong, S, NOW));
  const doneWait = done(wp('CD', { waitReason: 'busy', waitSince: '2026-10-01' }));
  ok('เคสจบแล้วไม่นับว่ารอ (ไม่ขึ้นในรายการรอ)', !isWaitingForPatient(doneWait, NOW));
  const returned = wp('CD', { ...old, returned: true, waitReason: 'busy', waitSince: '2026-10-01' });
  ok('เคสคืนแล้วไม่นับว่ารอ', !isWaitingForPatient(returned, NOW));
  ok('เคสเงียบ 10 วัน ไม่ได้ตั้งรอ → ถามนักศึกษา', needsWaitNudge(wp('CD', { lastUpdatedAt: daysBefore(10) }), NOW));
  ok('เคสเงียบ 9 วัน → ยังไม่ถาม', !needsWaitNudge(wp('CD', { lastUpdatedAt: daysBefore(9) }), NOW));
  ok('ตั้งรอแล้ว → ไม่ถามซ้ำ', !needsWaitNudge(waitDate, NOW));
}

console.log(bad ? `\n❌ ตก ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
