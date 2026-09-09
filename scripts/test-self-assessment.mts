/**
 * เทสต์ชุดที่ 12 — แบบประเมินตนเอง + การ์ดสรุปให้อาจารย์ · `npm run test:sa`
 *
 * ครอบ domain/selfAssessment.ts (โครงฟอร์ม + ความคืบหน้า + การเปิดให้กรอก)
 * และ domain/saFeedback.ts (กฎที่แปลงคำตอบ + ข้อมูลจริง เป็นการ์ดที่อาจารย์อ่านก่อนนัดคุย)
 *
 * ทำไมต้องมี: การ์ดพวกนี้อาจารย์อ่านก่อนเรียกนักศึกษามาคุย
 * การ์ดที่ผิดไม่ได้ทำให้จอพัง — มันทำให้อาจารย์ไปคุยเรื่องที่ไม่ได้เกิดขึ้นจริง
 * กฎที่ยึด (อยู่ในหัวไฟล์ saFeedback.ts): ทุกใบต้องมี "หลักฐาน" เป็นตัวเลขจริงเสมอ
 * และเป็น "ประเด็นชวนคุย" ไม่ใช่ข้อสรุป — เทสต์ชุดนี้บังคับสองข้อนั้น
 */
import {
  SA_APPROPRIATE, SA_MAX_SCALE, SA_NEEDS_WORK, SA_SCALE, SA_SECTIONS, SA_TYPES,
  saId, saMissing, saOpenFor, saProgress, saQuestionsFor, saSectionMissing, saSectionsFor,
  num, list, text, type SAValue,
} from '../src/domain/selfAssessment.ts';
import { buildFeedback, saYearNow, sortFeedback } from '../src/domain/saFeedback.ts';
import { procList } from '../src/domain/rules.ts';
import { CRITERIA } from '../src/domain/checkin.ts';
import { readDefaultSettings } from './test-helpers.mts';
import type {
  CheckIn, ProgressUpdate, SelfAssessment, Settings, Student, WorkType, Workpiece,
} from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

const S: Settings = readDefaultSettings();
const NOW = new Date('2026-11-20T09:00:00+07:00'); // ปีการศึกษา 2569

/* ═══ ① โครงฟอร์ม ═══════════════════════════════════════════════════════ */
console.log('\n① โครงฟอร์ม');

ok('สเกล 0–4 ครบ 5 ระดับ', SA_SCALE.length === 5 && SA_SCALE[4].v === SA_MAX_SCALE, SA_SCALE.map((x) => x.v).join(','));
ok('Appropriate = 1 · Need improvement = 0', SA_APPROPRIATE === 1 && SA_NEEDS_WORK === 0);
ok('4 ประเภทงานหลักตรงกับเกณฑ์', SA_TYPES.map((t) => t.key).join(',') === 'CD,RPD,CB,PC', SA_TYPES.map((t) => t.key).join(','));

/* คีย์คำถามต้องไม่ซ้ำกันทั้งฟอร์ม — ซ้ำเมื่อไหร่ คำตอบจะทับกันเงียบ ๆ
   ช่องหนึ่งกรอกแล้วอีกช่องเปลี่ยนตาม และแถบความคืบหน้าจะนับผิด */
{
  const keys = SA_SECTIONS.flatMap((s) => s.questions.map((q) => q.key));
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  ok('คีย์คำถามไม่ซ้ำกันทั้งฟอร์ม', dup.length === 0, dup.join(', ') || `${keys.length} ข้อ`);
  ok('คีย์หมวดไม่ซ้ำ', new Set(SA_SECTIONS.map((s) => s.key)).size === SA_SECTIONS.length);
}

/* ฟอร์มมีบล็อกเฉพาะปี 5 — ปี 6 ต้องไม่เห็น และต้องไม่ถูกนับเป็นข้อที่ยังไม่ตอบ */
{
  const y5 = saSectionsFor(5).flatMap((s) => s.questions).map((q) => q.key);
  const y6 = saSectionsFor(6).flatMap((s) => s.questions).map((q) => q.key);
  const only5 = y5.filter((k) => !y6.includes(k));
  ok('ปี 5 เห็นข้อที่ปี 6 ไม่เห็น (ฟอร์มมีบล็อกเฉพาะปี 5 จริง)', only5.length > 0, `${only5.length} ข้อ`);
  ok('ปี 6 ไม่มีข้อที่ปี 5 ไม่มี', y6.every((k) => y5.includes(k)));
  ok('ทุกหมวดที่เหลือหลังกรองต้องมีคำถามอย่างน้อยหนึ่งข้อ',
    saSectionsFor(6).every((s) => s.questions.length > 0));
  const missing6 = saMissing({}, 6).map((q) => q.key);
  ok('ข้อเฉพาะปี 5 ไม่ถูกนับว่า "ยังไม่ตอบ" ของปี 6',
    only5.every((k) => !missing6.includes(k)), only5.filter((k) => missing6.includes(k)).join(', ') || '(ไม่มี)');
}

/* ═══ ② ความคืบหน้าและการส่ง ═══════════════════════════════════════════ */
console.log('\n② ความคืบหน้าและการส่ง');

{
  const p0 = saProgress({}, 5);
  ok('ฟอร์มเปล่า → ยังไม่ตอบสักข้อ', p0.done === 0 && p0.total > 0, `${p0.done}/${p0.total}`);
  ok('จำนวนข้อที่ยังไม่ตอบ = total เมื่อยังไม่กรอกอะไร', saMissing({}, 5).length === p0.total);

  /* ตอบ 0 คือ "คำตอบ" ไม่ใช่ "ยังไม่ตอบ" — สเกลนี้เริ่มที่ 0 (Very low)
     ถ้านับ 0 เป็นช่องว่าง คนที่ให้ตัวเอง 0 ทั้งฟอร์มจะกดส่งไม่ได้ตลอดกาล */
  const required = saSectionsFor(5).flatMap((s) => s.questions).filter((q) => !q.optional);
  const allZero = Object.fromEntries(required.map((q) => [q.key, q.kind === 'scale' ? 0 : 'x'])) as Record<string, SAValue>;
  ok('ตอบ 0 ทุกข้อ = กรอกครบ (0 ไม่ใช่ช่องว่าง)', saMissing(allZero, 5).length === 0,
    saMissing(allZero, 5).map((q) => q.key).slice(0, 3).join(', '));

  const blanks: SAValue[] = [null, '', []];
  for (const b of blanks) {
    const one = { ...allZero, [required[0].key]: b };
    ok(`ค่าว่างแบบ ${JSON.stringify(b)} ยังนับว่ายังไม่ตอบ`, saMissing(one, 5).length === 1, saMissing(one, 5).length);
  }

  ok('ข้อ optional ไม่บังคับตอบ',
    saSectionsFor(5).flatMap((s) => s.questions).some((q) => q.optional)
      ? saMissing(allZero, 5).length === 0 : true);

  const firstSection = saSectionsFor(5)[0];
  ok('จุดแดงรายหมวดนับเฉพาะข้อของหมวดนั้น',
    saSectionMissing(firstSection, {}, 5) === saQuestionsFor(firstSection, 5).filter((q) => !q.optional).length,
    saSectionMissing(firstSection, {}, 5));
}

console.log('\n③ ภาคเปิดให้กรอกหรือยัง');
ok('ยังไม่เปิดปีไหนเลย → กรอกไม่ได้', !saOpenFor({ saOpenYears: [] }, 5));
ok('เปิดเฉพาะปี 6 → ปี 5 ยังกรอกไม่ได้', !saOpenFor({ saOpenYears: [6] }, 5));
ok('เปิดเฉพาะปี 6 → ปี 6 กรอกได้', saOpenFor({ saOpenYears: [6] }, 6));
ok('ไม่รู้ชั้นปี → ไม่เปิดให้ (ปลอดภัยไว้ก่อน)', !saOpenFor({ saOpenYears: [5, 6] }, null));
/* เครื่องที่ยังไม่ได้อัปเดตค่าตั้งจะมี saOpen (boolean) ตัวเก่าอยู่ — ต้องยังอ่านออก */
ok('ค่าตั้งรุ่นเก่า (saOpen=true) ยังใช้ได้', saOpenFor({ saOpen: true }, 5));
ok('ค่าตั้งรุ่นเก่า (saOpen=false) ปิดอยู่', !saOpenFor({ saOpen: false }, 5));

console.log('\n④ คีย์ของใบ');
ok('หนึ่งคน หนึ่งปี หนึ่งใบ', saId('st-1', 2569) === 'sa-st-1-2569', saId('st-1', 2569));
ok('คนละปีคนละใบ', saId('st-1', 2569) !== saId('st-1', 2570));
ok('saYearNow ตรงกับปีการศึกษาของวันนั้น', saYearNow(NOW) === 2569, saYearNow(NOW));

console.log('\n⑤ ตัวแปลงค่า');
ok('num: ตัวเลขปกติผ่าน', num(3) === 3);
ok('num: 0 ต้องได้ 0 ไม่ใช่ null', num(0) === 0, String(num(0)));
ok('num: N/A (ค่าติดลบ) → null ไม่ใช่ 0', num(-1) === null, String(num(-1)));
ok('num: ข้อความ → null', num('3') === null);
ok('list: ไม่ใช่อาเรย์ → อาเรย์ว่าง', list('x').length === 0 && list(undefined).length === 0);
ok('text: ตัวเลข → สตริงว่าง (ไม่แปลงมั่ว)', text(5) === '');

/* ═══ ⑥ การ์ดสรุปให้อาจารย์ ════════════════════════════════════════════ */
console.log('\n⑥ การ์ดสรุปให้อาจารย์');

const student: Student = {
  id: 's1', code: '6504049', name: 'นศ. ทดสอบ', group: 'TH-PT1', year: 6,
  entryYear: 2568, advisorIds: ['t1', 't2'],
} as Student;

let wn = 0;
function wp(type: WorkType, prog: number, over: Partial<Workpiece> = {}): Workpiece {
  const base = {
    id: `w${++wn}`, patientId: `p${wn}`, studentId: 's1', type, detail: `${type} ทดสอบ`,
    acceptedDate: '2026-06-15', minimumRequirement: true, payment: 'ชำระแล้ว',
    sect2Removable: true, sect2Fixed: true, procIndex: -1,
    lastUpdatedAt: NOW.toISOString(), catalogVersion: 'DTPT502-2569', ...over,
  } as Workpiece;
  return { ...base, procIndex: procList(base).findIndex((p) => p[0] === prog) };
}
const doneWork = (type: WorkType, over: Partial<Workpiece> = {}) => {
  const w = wp(type, 0, over);
  return { ...w, procIndex: procList(w).length - 1, completedAt: '2026-10-01T00:00:00.000Z' };
};

let cn = 0;
const checkin = (date: string, over: Partial<CheckIn> = {}): CheckIn => ({
  id: `c${++cn}`, studentId: 's1', date, punctual: true, noPatient: false,
  activities: ['Laboratory work'], status: 'pending', createdAt: `${date}T09:00:00.000Z`, ...over,
} as CheckIn);

const scored = (v: number) => Object.fromEntries(CRITERIA.map((c) => [c.key, v]));

const sa = (answers: Record<string, SAValue>, academicYear = 2569): SelfAssessment => ({
  id: saId('s1', academicYear), studentId: 's1', academicYear, classYear: 6,
  formVersion: '2569.2', answers, status: 'submitted',
  createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
} as SelfAssessment);

const build = (
  answers: Record<string, SAValue>,
  o: { works?: Workpiece[]; checkins?: CheckIn[]; updates?: ProgressUpdate[]; year?: number } = {},
) => buildFeedback({
  sa: sa(answers, o.year ?? 2569), student,
  works: o.works ?? [], checkins: o.checkins ?? [], updates: o.updates ?? [],
  settings: S, now: NOW,
});

/* กฎของโปรเจกต์: ทุกการ์ดต้องมีตัวเลขจริงกำกับ ไม่ใช่คำแนะนำลอย ๆ */
{
  const cards = build(
    { profTime: 1, profPrecaution: 1, courseConfidence: 4, probRedone: 1, labAuth: 0, improveTypes: ['CD'] },
    {
      works: [wp('CD', 3), wp('RPD', 2)],
      checkins: Array.from({ length: 8 }, (_, i) =>
        checkin(`2026-09-${String(i + 1).padStart(2, '0')}`, {
          punctual: i > 4, status: 'evaluated', scores: scored(1),
        })),
    },
  );
  ok('มีการ์ดออกมาจริง', cards.length > 0, `${cards.length} ใบ`);
  ok('ทุกใบมีหัวข้อ · เนื้อความ · หลักฐาน ครบ',
    cards.every((c) => c.title && c.body && c.evidence),
    cards.filter((c) => !c.evidence).map((c) => c.id).join(', ') || '(ครบ)');
  ok('หลักฐานทุกใบมีตัวเลขจริงอยู่ในนั้น',
    cards.every((c) => /\d/.test(c.evidence)),
    cards.filter((c) => !/\d/.test(c.evidence)).map((c) => c.id).join(', ') || '(ครบ)');
  ok('ไม่มีการ์ด id ซ้ำ', new Set(cards.map((c) => c.id)).size === cards.length);
  const order = sortFeedback(cards).map((c) => c.tone);
  ok('เรียงเรื่องที่ต้องจัดการก่อน แล้วค่อยเรื่องให้กำลังใจ',
    order.indexOf('praise') === -1 || order.indexOf('praise') === order.length - order.filter((t) => t === 'praise').length,
    order.join(' > '));
}

/* คาบน้อยกว่า 3 คาบที่ประเมินแล้ว ค่าเฉลี่ยยังไม่มีความหมาย ต้องไม่เอามาตัดสิน */
{
  const two = [
    checkin('2026-09-01', { status: 'evaluated', scores: scored(0) }),
    checkin('2026-09-08', { status: 'evaluated', scores: scored(0) }),
  ];
  const cards = build({ profPrecaution: 1 }, { checkins: two });
  ok('ประเมินแค่ 2 คาบ → ยังไม่ขึ้นการ์ดเทียบคะแนน',
    !cards.some((c) => c.id.startsWith('prof-gap')), cards.map((c) => c.id).join(', '));
  const three = [...two, checkin('2026-09-15', { status: 'evaluated', scores: scored(0) })];
  ok('ครบ 3 คาบ → ขึ้นการ์ดเทียบคะแนนได้',
    build({ profPrecaution: 1 }, { checkins: three }).some((c) => c.id === 'prof-gap-profPrecaution'));
}

/* หัวใจของรอบนี้: คาบที่เอามาเทียบต้องเป็นของปีการศึกษาที่ใบนี้พูดถึงเท่านั้น
   นศ. ปี 6 ที่ปี 5 เคยมาสายบ่อย แต่ปีนี้ตรงเวลาหมด ต้องไม่โดนป้าย "มาสายบ่อยกว่าที่คิด" */
{
  const lastYear = Array.from({ length: 8 }, (_, i) =>
    checkin(`2025-09-${String(i + 1).padStart(2, '0')}`, { punctual: false }));
  const thisYear = Array.from({ length: 8 }, (_, i) =>
    checkin(`2026-09-${String(i + 1).padStart(2, '0')}`, { punctual: true }));
  const cards = build({ profTime: 1 }, { checkins: [...lastYear, ...thisYear] });
  ok('คาบของปีที่แล้วไม่ถูกลากมาปนกับใบปีนี้',
    !cards.some((c) => c.id === 'time-late'), cards.map((c) => c.id).join(', ') || '(ไม่มีการ์ด)');

  const lateNow = Array.from({ length: 8 }, (_, i) =>
    checkin(`2026-09-${String(i + 1).padStart(2, '0')}`, { punctual: i > 5 }));
  ok('มาสายบ่อยในปีนี้จริง → ขึ้นการ์ด',
    build({ profTime: 1 }, { checkins: lateNow }).some((c) => c.id === 'time-late'));

  const evidence = build({ profTime: 1 }, { checkins: [...lastYear, ...lateNow] })
    .find((c) => c.id === 'time-late')?.evidence ?? '';
  ok('ตัวเลขในหลักฐานนับเฉพาะคาบของปีนี้ (8 คาบ ไม่ใช่ 16)',
    evidence.includes('8') && !evidence.includes('16'), evidence);
}

/* ประเภทงานที่ยังไม่มีเคสเลย */
{
  const cards = build({ procCDK: 0, procCDS: 0 }, { works: [wp('RPD', 2)] });
  const card = cards.find((c) => c.id === 'type-none-CD');
  ok('ให้คะแนนตัวเองต่ำ + ยังไม่มีเคสประเภทนั้น → เตือนเป็น risk', card?.tone === 'risk', card?.tone);
  const high = build({ procCDK: 4, procCDS: 4 }, { works: [wp('RPD', 2)] }).find((c) => c.id === 'type-none-CD');
  ok('ให้คะแนนตัวเองสูง + ยังไม่มีเคส → เป็นประเด็นชวนคุย ไม่ใช่คำเตือน', high?.tone === 'gap', high?.tone);
  ok('ไม่ตอบเลย → ไม่เดาแทน (ไม่มีการ์ด)',
    !build({}, { works: [wp('RPD', 2)] }).some((c) => c.id === 'type-none-CD'));
  ok('เคสที่คืนไปแล้วไม่นับเป็น "มีเคสในมือ"',
    build({ procCDK: 0, procCDS: 0 }, { works: [wp('CD', 3, { returned: true })] })
      .some((c) => c.id === 'type-none-CD'));
}

/* ให้คะแนนตัวเองต่ำทั้งที่ทำจบมาแล้ว → ชม */
{
  const cards = build({ procCDK: 1, procCDS: 0 }, { works: [doneWork('CD')] });
  ok('ทำจบมาแล้วแต่ให้คะแนนตัวเองต่ำ → การ์ดให้กำลังใจ',
    cards.some((c) => c.id === 'type-praise-CD' && c.tone === 'praise'), cards.map((c) => c.id).join(', '));
}

/* บอกว่าไม่มีปัญหาเลย แต่มีเคสค้าง */
{
  const stale = wp('CD', 3, { lastUpdatedAt: '2026-08-01T00:00:00.000Z' });
  const answers = { probPreprosth: 0, probRedone: 0, probComplex: 0, probPlanning: 0 };
  ok('ตอบว่าไม่มีปัญหาแต่มีเคสค้าง → ชวนคุย',
    build(answers, { works: [stale] }).some((c) => c.id === 'stale-silent'));
  ok('ยังไม่ได้ตอบหมวดปัญหา → ไม่เดาแทน',
    !build({ probPreprosth: 0 }, { works: [stale] }).some((c) => c.id === 'stale-silent'));
}

/* ยังไม่มีคาบที่ประเมิน — ต้องบอกตรง ๆ ว่าเทียบอะไรไม่ได้ ดีกว่าเงียบ */
{
  const cards = build({ profTime: 1 }, { checkins: [checkin('2026-09-01')] });
  ok('ไม่มีคาบที่ประเมินเลย → มีการ์ดบอกว่าเทียบไม่ได้',
    cards.some((c) => c.id === 'no-eval' && c.tone === 'info'));
}

/* ฟอร์มเปล่าต้องไม่ผลิตการ์ดที่ตัดสินอะไรเลย */
{
  const cards = build({});
  ok('ฟอร์มเปล่า + ไม่มีข้อมูลอะไรเลย → ไม่มีการ์ดที่ตัดสิน (มีได้แค่ info)',
    cards.every((c) => c.tone === 'info'), cards.map((c) => `${c.id}(${c.tone})`).join(', ') || '(ไม่มีการ์ด)');
}

console.log(bad ? `\n❌ ไม่ผ่าน ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
