/**
 * ทดสอบสูตรคะแนน src/domain/sect2.ts + sect3.ts — รันด้วย `npm run test:forms`
 *
 * ทำไมต้องมี: สองไฟล์นี้คือใบประเมินที่ถอดจากสมุดกระดาษมาทีละบรรทัด
 * ถ้าถอดผิดจะไม่มีใครรู้ — อาจารย์การะดับเดิม แต่ได้คะแนนคนละเลขกับที่เคยให้บนกระดาษ
 * ในไฟล์มี assertSect2()/assertSect3() เป็น "ยามกันถอดผิด" อยู่แล้ว (เรียกตอนเปิดแอปโหมด dev)
 * เทสต์ชุดนี้จึง (1) บังคับให้ยามสองตัวนั้นถูกรันจริงใน CI ไม่ใช่แค่ตอนเปิดแอป
 * และ (2) เทสต์สิ่งที่ยามยังไม่ครอบ — ตัวสูตรคิดคะแนน และการแยก "ยังไม่ให้คะแนนครบ" ออกจาก "ได้ 0"
 *
 * ข้อที่ตั้งใจเทสต์หนักที่สุด: sect2Total/sect3Total ต้องคืน null เมื่อกาไม่ครบ
 * ถ้าวันหนึ่งมันคืน 0 แทน หน้าจอจะขึ้น "0/70" ให้นักศึกษาที่อาจารย์แค่ยังประเมินไม่เสร็จ
 */
import {
  assertSect2, RPD_DESIGN_GROUPS, RPD_DESIGN_TOPICS, rpdDesignPassed, S2_FULL_SCORE, S2_GRADES,
  s2Points, sect2Form, sect2Total, SECT2_FORMS,
} from '../src/domain/sect2.ts';
import {
  assertSect3, S3_FULL_SCORE, s3Points, sect3Form, sect3FormsFor, sect3Total, SECT3_FORMS,
} from '../src/domain/sect3.ts';
import type { S2Grade } from '../src/domain/sect2.ts';
import type { S3Grade } from '../src/domain/sect3.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

/* ── 1. ยามกันถอดผิดที่มีอยู่แล้ว — บังคับให้รันจริง ─────────────────────── */
console.log('\nยามกันถอดผิด (assertSect2 / assertSect3)');
ok('assertSect2 ไม่มีข้อทักท้วง', assertSect2().length === 0, assertSect2().join(' · '));
ok('assertSect3 ไม่มีข้อทักท้วง', assertSect3().length === 0, assertSect3().join(' · '));

/* ── 2. สิ่งที่ยามยังไม่ครอบ — โครงของเล่ม ───────────────────────────────── */
console.log('\nโครงของเล่ม — จำนวนใบและรหัสใบ');
ok('Section II มี 2 ใบให้คะแนน (Removable + Fixed)', SECT2_FORMS.length === 2, SECT2_FORMS.length);
ok('ทั้งสองใบผูกกับธงคนละข้อในโปรไฟล์ นศ.',
  new Set(SECT2_FORMS.map((f) => f.gate)).size === 2, SECT2_FORMS.map((f) => f.gate).join(','));
ok('Section III มี 15 ใบ (Part A 12 + Part B 3)', SECT3_FORMS.length === 15, SECT3_FORMS.length);
ok('รหัสมุมขวาบนของใบห้ามซ้ำ (assert เดิมเช็คแค่ key ไม่ได้เช็ค code)',
  new Set(SECT3_FORMS.map((f) => f.code)).size === SECT3_FORMS.length,
  SECT3_FORMS.map((f) => f.code).join(','));
ok('Part A ครบ 12 ใบ · Part B ครบ 3 ใบ',
  SECT3_FORMS.filter((f) => f.part === 'A').length === 12 && SECT3_FORMS.filter((f) => f.part === 'B').length === 3);
ok('ทั้ง 3 กลุ่ม (CD/RPD/FDP) มี Part A กลุ่มละ 4 ใบ',
  (['CD', 'RPD', 'FDP'] as const).every((g) => SECT3_FORMS.filter((f) => f.part === 'A' && f.group === g).length === 4));
{
  /* Part B เขียน "YEAR 6" ไว้ทั้ง 3 ใบ — ถ้ากรองผิด ปี 5 จะเห็นใบ recall ที่ยังไม่ถึงคิว
     (หรือแย่กว่า: ปี 6 ไม่เห็น แล้วประเมินไม่ครบเล่ม) */
  ok('ปี 5 เห็นเฉพาะ Part A', sect3FormsFor(5).length === 12 && sect3FormsFor(5).every((f) => f.part === 'A'),
    sect3FormsFor(5).length);
  ok('ปี 6 เห็นครบทั้งเล่ม', sect3FormsFor(6).length === 15, sect3FormsFor(6).length);
}
ok('หาใบด้วย key ได้', sect3Form('cdK1')?.code === 'CD-K1' && sect2Form('removable')?.gate === 'sect2Removable');
ok('key ที่ไม่มีจริง → undefined ไม่ใช่พัง', sect3Form('ไม่มีใบนี้') === undefined && sect2Form('nope') === undefined);

/* ── 3. Section II — 4 ระดับ O/S/M/U ─────────────────────────────────────── */
console.log('\nSection II — Outstanding เต็ม · Satisfactory 80% · Marginal 60% · Unsat 0');
{
  const c10 = SECT2_FORMS[0].criteria.find((c) => c.max === 10)!;
  const c20 = SECT2_FORMS[0].criteria.find((c) => c.max === 20)!;
  ok('ข้อเต็ม 10 → 10 / 8 / 6 / 0',
    [s2Points(c10, 'O'), s2Points(c10, 'S'), s2Points(c10, 'M'), s2Points(c10, 'U')].join(',') === '10,8,6,0',
    [s2Points(c10, 'O'), s2Points(c10, 'S'), s2Points(c10, 'M'), s2Points(c10, 'U')].join(','));
  ok('ข้อเต็ม 20 → 20 / 16 / 12 / 0',
    [s2Points(c20, 'O'), s2Points(c20, 'S'), s2Points(c20, 'M'), s2Points(c20, 'U')].join(',') === '20,16,12,0',
    [s2Points(c20, 'O'), s2Points(c20, 'S'), s2Points(c20, 'M'), s2Points(c20, 'U')].join(','));
  /* 0.8 กับ 0.6 เป็นทศนิยมฐานสองที่ไม่ลงตัว — ถ้าวันหนึ่งมีคนเพิ่มข้อเต็มค่าอื่น
     (เช่น 15) คะแนนอาจกลายเป็น 11.999999999999998 แล้วโผล่บนใบประเมินแบบนั้นเลย */
  ok('คะแนนทุกข้อทุกระดับเป็นเลขที่พิมพ์ออกใบได้ (ไม่มีเศษทศนิยมลอย)',
    SECT2_FORMS.every((f) => f.criteria.every((c) =>
      S2_GRADES.every((g) => Number.isInteger((s2Points(c, g.v) ?? 0) * 100)))));
  ok('ยังไม่ได้กา → null ไม่ใช่ 0', s2Points(c10, undefined) === null);
}
{
  for (const f of SECT2_FORMS) {
    const all = (g: S2Grade) => Object.fromEntries(f.criteria.map((c) => [c.key, g])) as Record<string, S2Grade>;
    ok(`${f.key}: กา Outstanding ทุกข้อ = ${S2_FULL_SCORE} เต็ม`, sect2Total(f, all('O')) === S2_FULL_SCORE, sect2Total(f, all('O')));
    ok(`${f.key}: กา Satisfactory ทุกข้อ = 80% ของเต็ม`, sect2Total(f, all('S')) === S2_FULL_SCORE * 0.8, sect2Total(f, all('S')));
    ok(`${f.key}: กา Unsatisfactory ทุกข้อ = 0 (ไม่ใช่ null)`, sect2Total(f, all('U')) === 0);
    /* จุดสำคัญที่สุดของไฟล์นี้: "ยังประเมินไม่เสร็จ" ต้องแยกจาก "ได้ศูนย์" ให้ขาด */
    const partial = { ...all('O') };
    delete partial[f.criteria[f.criteria.length - 1].key];
    ok(`${f.key}: กาไม่ครบ → null (ไม่ใช่คะแนนบางส่วนที่ดูเหมือนคะแนนจริง)`, sect2Total(f, partial) === null,
      String(sect2Total(f, partial)));
    ok(`${f.key}: ยังไม่กาสักข้อ → null`, sect2Total(f, {}) === null);
  }
}

/* ── 4. RPD Design examination — ผ่าน/ไม่ผ่าน ต้องผ่านทุกข้อ ─────────────── */
console.log('\nRPD Design examination — ผ่านทั้งใบ = ผ่านทุกข้อ');
{
  ok('มี 17 ข้อใน 4 หมวด', RPD_DESIGN_TOPICS.length === 17 && RPD_DESIGN_GROUPS.length === 4);
  const allPass = Object.fromEntries(RPD_DESIGN_TOPICS.map((t) => [t.key, true]));
  ok('ติ๊กครบทุกข้อ → ผ่าน', rpdDesignPassed(allPass));
  ok('ยังไม่ติ๊กเลย → ไม่ผ่าน (ไม่ใช่ผ่านเพราะไม่มีข้อที่ false)', !rpdDesignPassed({}));
  /* ข้อที่ "ยังไม่ตรวจ" (undefined) ต้องไม่ถูกนับเป็นผ่าน — ต่างจาก false แค่ในความหมาย
     แต่ผลบนใบเหมือนกันคือยังไม่ผ่าน (ตามหมายเหตุท้ายใบ: ต้องผ่านทุกข้อ) */
  const oneMissing = { ...allPass };
  delete oneMissing[RPD_DESIGN_TOPICS[8].key];
  ok('ขาดไป 1 ข้อ (ยังไม่ตรวจ) → ไม่ผ่าน', !rpdDesignPassed(oneMissing));
  ok('ตก 1 ข้อ → ไม่ผ่าน', !rpdDesignPassed({ ...allPass, [RPD_DESIGN_TOPICS[0].key]: false }));
  ok('เลขข้อในหมวดไม่ซ้ำกัน', new Set(RPD_DESIGN_TOPICS.map((t) => t.no)).size === 17);
}

/* ── 5. Section III — 3 ระดับ O/S/U ──────────────────────────────────────── */
console.log('\nSection III — Outstanding เต็ม · Satisfactory ครึ่ง · Unsat 0');
{
  const t = SECT3_FORMS[0].topics[0];
  ok('S ต้องเป็นครึ่งหนึ่งของ O เป๊ะ ทุกข้อทุกใบ',
    SECT3_FORMS.every((f) => f.topics.every((x) => s3Points(x, 'S')! * 2 === s3Points(x, 'O')!)));
  ok('U = 0 ทุกข้อ', SECT3_FORMS.every((f) => f.topics.every((x) => s3Points(x, 'U') === 0)));
  ok('ยังไม่ได้กา → null ไม่ใช่ 0', s3Points(t, undefined) === null);
}
{
  for (const f of SECT3_FORMS) {
    const all = (g: S3Grade) => Object.fromEntries(f.topics.map((x) => [x.key, g])) as Record<string, S3Grade>;
    const full = sect3Total(f, all('O'));
    const half = sect3Total(f, all('S'));
    ok(`${f.code}: O ทุกข้อ = ${S3_FULL_SCORE} เต็ม`, full === S3_FULL_SCORE, full);
    ok(`${f.code}: S ทุกข้อ = ครึ่งของเต็ม`, half === S3_FULL_SCORE / 2, half);
    ok(`${f.code}: U ทุกข้อ = 0 (ไม่ใช่ null)`, sect3Total(f, all('U')) === 0);
    const partial = { ...all('O') };
    delete partial[f.topics[0].key];
    ok(`${f.code}: กาไม่ครบ → null`, sect3Total(f, partial) === null, String(sect3Total(f, partial)));
  }
}
{
  /* ใบที่มีข้อเต็ม 0.5 กับ 1.5 (Recall-CD, CD-K1) — คะแนนผสมต้องยังเป็นทวีคูณของ 0.25
     ไม่งั้นจะได้ 4.749999999999999 ไปพิมพ์บนใบประเมิน */
  const mixed = SECT3_FORMS.filter((f) => f.topics.some((t) => t.max % 1 !== 0));
  ok('มีใบที่ให้คะแนนเป็นทศนิยมจริง (ถ้าไม่มี แปลว่าถอดฟอร์มหาย)', mixed.length > 0, mixed.map((f) => f.code).join(','));
  ok('คะแนนผสม O/S/U ยังเป็นทวีคูณของ 0.25 ทุกใบ',
    mixed.every((f) => {
      const grades = Object.fromEntries(f.topics.map((t, i) => [t.key, (['O', 'S', 'U'] as S3Grade[])[i % 3]]));
      const total = sect3Total(f, grades)!;
      return Number.isInteger(Math.round(total * 100)) && Math.abs(total * 4 - Math.round(total * 4)) < 1e-9;
    }));
}
{
  // คีย์ข้อไม่ซ้ำข้ามใบ — เพราะคะแนนเก็บเป็น Record<key, grade> ก้อนเดียวต่อ นศ. หนึ่งคน
  const keys = SECT3_FORMS.flatMap((f) => f.topics.map((t) => t.key));
  ok('คีย์ข้อไม่ซ้ำกันข้ามทั้ง 15 ใบ', new Set(keys).size === keys.length, `${new Set(keys).size}/${keys.length}`);
  ok('ทุกข้อมีข้อความกำกับ (ใบเปล่าไม่มีทางให้คะแนนถูก)',
    SECT3_FORMS.every((f) => f.topics.every((t) => t.label.trim().length > 0)));
}

console.log(bad ? `\n❌ ตก ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
