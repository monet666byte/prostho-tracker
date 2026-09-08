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
  caseCount, caseCountTotals, completedInYear, countCDA, countsTowardRequirement,
  daysSinceUpdate, isActiveWork, isStale, maxProgression, meetsAllRequirements,
  overallPercent, percentCompleted, procList, sortWorkpieces, yearlyRows,
} from '../src/domain/rules.ts';
import { readFileSync } from 'node:fs';
import type { Settings, Workpiece, WorkType } from '../src/domain/types.ts';

/**
 * ค่าตั้งต้นจริงจาก data/seed.ts — อ่านเป็นข้อความแล้ว eval แทนการ import
 *
 * import ตรงๆ ไม่ได้เพราะ seed.ts ลาก lib/cloud.ts กับ data/db.ts (Dexie/IndexedDB)
 * ซึ่งเป็นของฝั่งเบราว์เซอร์ล้วน รันใน node ไม่ได้
 * แต่ก็ไม่ยอมพิมพ์ค่าซ้ำไว้ในเทสต์ — ถ้าภาคเปลี่ยนเกณฑ์แล้วเทสต์ยังยึดเลขเก่า
 * เทสต์จะผ่านทั้งที่ไม่ตรงของจริง ซึ่งแย่กว่าไม่มีเทสต์
 */
function readDefaultSettings(): Settings {
  const src = readFileSync(new URL('../src/data/seed.ts', import.meta.url), 'utf8');
  const start = src.indexOf('export const DEFAULT_SETTINGS');
  const open = src.indexOf('{', start);
  if (start < 0 || open < 0) throw new Error('หา DEFAULT_SETTINGS ใน seed.ts ไม่เจอ — แก้ readDefaultSettings()');
  let depth = 0, end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  // ปลอดภัยพอ: อ่านไฟล์ในรีโปตัวเอง และสคริปต์นี้รันมือในเครื่อง dev เท่านั้น
  // (ใช้ JSON.parse ไม่ได้ — ในลิเทอรัลมีคอมเมนต์ คีย์ไม่มีเครื่องหมายคำพูด และ trailing comma)
  // oxlint-disable-next-line no-eval
  return (0, eval)('(' + src.slice(open, end + 1) + ')') as Settings;
}

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
ok('APD ไม่อยู่ใน 4 ประเภทหลัก → ไม่นับ', !countsTowardRequirement(finished('APD')));
ok('Recall ไม่อยู่ใน 4 ประเภทหลัก → ไม่นับ', !countsTowardRequirement(finished('RRM')));

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
}
{
  /* เคยพัง: รายชื่อปีสร้างจากปีที่มี completedAt เท่านั้น ปีที่จบ 0 ชิ้นจึงหายไป
     → นศ. ที่ปี 2568 จบ 0 แล้วไปเร่งจบทีเดียวในปี 2569 ระบบสรุปว่า "ครบเกณฑ์" */
  const list = [
    wp('CD', { acceptedDate: '2025-08-01' }), // รับเคสปี 2568 แต่ไม่จบสักชิ้นในปีนั้น
    ...['CD', 'CD', 'RPD', 'RPD', 'CB', 'PC'].map((tp) => finished(tp as WorkType, { completedAt: '2026-09-01' })),
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
const fullSet = ['CD', 'CD', 'RPD', 'RPD', 'CB', 'PC'].map((tp) =>
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

console.log(bad ? `\n❌ ตก ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
