/**
 * เทสต์ชุดที่ 9 — "กฎที่ต้องจริงเสมอ" ข้ามโมดูล · รันด้วย `npm run test:invariants`
 *
 * ต่างจากเทสต์ชุดอื่นตรงวิธีคิด:
 *   ชุดอื่นเขียนเคสที่คนคิดออกแล้วเช็คว่าได้คำตอบตามที่คิด
 *   ชุดนี้สุ่มข้อมูลหลายพันชุด แล้วเช็คว่า "ความสัมพันธ์ระหว่างตัวเลข" ยังจริงอยู่ไหม
 *
 * ทำไมต้องมี: บั๊กที่แพงที่สุดในระบบนี้ไม่ใช่บั๊กที่ทำให้จอขาว แต่คือบั๊กที่ทำให้
 * หน้าอาจารย์ขึ้นเลขสวยๆ ที่ผิด — ไม่มีใครรู้ว่าผิดจนกว่าจะเอาไปตัดสินใจแล้วพลาด
 * เลขพวกนี้มาจากหลายฟังก์ชันในหลายไฟล์ที่ต้องเห็นตรงกัน (เช่น "เคสค้าง" บนหน้าภาพรวม
 * ต้องเท่ากับจำนวนจุดบนแผนที่เคสเสมอ) — ความไม่ตรงกันแบบนี้เทสต์รายฟังก์ชันจับไม่ได้
 *
 * โครงไฟล์:
 *   ส่วน A — เทสต์กันบั๊กเก่า 3 ตัวที่เจอวันที่ 10 ก.ย. 69 (มีเรื่องเล่ากำกับว่าเคยพังยังไง)
 *   ส่วน B — สุ่มข้อมูล N ชุด เช็ค invariant ทั้งหมด (ผิดที่ไหนพิมพ์ seed ให้เล่นซ้ำได้)
 */
import {
  bottleneckByStep, burnup, carriedOverCount, caseDots, durationByType, funnelByType,
  headline, heatmapRows, profile, riskRows, selfPerformedRows, throughputByMonth,
} from '../src/domain/analytics.ts';
import { summarizeStudent } from '../src/domain/aggregate.ts';
import {
  caseCountTotals, isActiveWork, isComplete, isReturned, maxProgression,
  meetsAllRequirements, overallPercent, percentCompleted, procList, progression, yearlyRows,
} from '../src/domain/rules.ts';
import { REQ_TYPES, TYPES } from '../src/domain/catalog.ts';
import { readDefaultSettings } from './test-helpers.mts';
import type { CheckIn, ProgressUpdate, Settings, Student, WorkType, Workpiece } from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

const NOW = new Date('2026-10-15T09:00:00+07:00');
const S: Settings = readDefaultSettings();
const ALL_TYPES = Object.keys(TYPES) as WorkType[];

let seq = 0;
function wp(type: WorkType, over: Partial<Workpiece> = {}): Workpiece {
  return {
    id: `w${++seq}`, patientId: `p${seq}`, studentId: 's1', type, detail: type,
    acceptedDate: '2026-06-15', minimumRequirement: true, payment: 'ชำระแล้ว',
    sect2Removable: true, sect2Fixed: true, procIndex: -1,
    lastUpdatedAt: NOW.toISOString(), catalogVersion: 'DTPT502-2569', ...over,
  };
}
/** ชิ้นงานที่หยุดอยู่ที่ progression ที่ระบุ */
function at(type: WorkType, prog: number, over: Partial<Workpiece> = {}): Workpiece {
  const w = wp(type, over);
  return { ...w, procIndex: procList(w).findIndex((p) => p[0] === prog) };
}
function done(type: WorkType, completedAt: string, over: Partial<Workpiece> = {}): Workpiece {
  const w = wp(type, over);
  return { ...w, procIndex: procList(w).length - 1, completedAt };
}
const student = (id: string, over: Partial<Student> = {}): Student =>
  ({ id, name: id, code: id, group: 'TH-PT1', cohort: 2568, ...over }) as Student;

/* ══════════════════════════════════════════════════════════════════
   ส่วน A — บั๊กที่เคยเจอจริง (10 ก.ย. 69)
   ══════════════════════════════════════════════════════════════════ */

console.log('\nA1. งานนำเข้าจากชีตต้องไม่ทำให้ "ใช้เวลากี่สัปดาห์กว่าจะจบ" เพี้ยน');
/* เคยพัง: ชีตไม่มีคอลัมน์วันจบ ตอนนำเข้าจึงประทับ completedAt = วันนำเข้า
   durationByType คิด (วันนำเข้า − วันรับเคส) เคสที่รับไว้ตั้งแต่ปีก่อนจึงกลายเป็น 60+ สัปดาห์
   วันที่ภาคนำเข้าชีตจริงทีเดียวหลายร้อยแถว ค่ามัธยฐานจะเพี้ยนทั้งกราฟตั้งแต่วันแรก
   และประโยคสรุปหน้าภาพรวม ("ประเภทที่ช้าที่สุดคือ …") อ่านจากค่านี้ตรงๆ */
{
  const real = done('CD', '2026-08-10T00:00:00.000Z', { acceptedDate: '2026-06-15' });
  const imported = done('CD', '2026-09-10T00:00:00.000Z', {
    acceptedDate: '2025-07-01', fromSheet: true, countsForYear: 2568,
  });
  const alone = durationByType([real]).find((d) => d.type === 'CD')!;
  const mixed = durationByType([real, imported]).find((d) => d.type === 'CD')!;
  ok('มัธยฐานไม่ขยับเมื่อมีงานนำเข้าปนเข้ามา', alone.medianWeeks === mixed.medianWeeks, `${alone.medianWeeks} vs ${mixed.medianWeeks}`);
  ok('งานนำเข้าไม่ถูกนับเป็นตัวอย่าง', mixed.samples === 1, mixed.samples);
  ok('กราฟจบเคสต่อเดือนก็ไม่นับงานนำเข้า',
    throughputByMonth([real, imported], NOW).reduce((a, b) => a + b.count, 0) === 1);
}

console.log('\nA2. step ที่เหลือต้องวัดจากขั้นสุดท้ายของประเภทนั้น ไม่ใช่ 10 ตายตัว');
/* เคยพัง: stepsRemaining ใช้ (10 − progression) กับทุกประเภท แต่งาน Recall จบที่ขั้น 3
   เคส Recall ที่เหลืออีก 1 ขั้นจึงถูกอ่านว่าเหลือ 8 ขั้น และป้าย step ขึ้นเป็น "Recall-Rem-4"
   ซึ่งไม่มีอยู่จริงในลิสต์ */
{
  const st = student('s1');
  const works = [at('RRM', 2, { studentId: 's1' })];
  // เปิด perYearCountsAllTypes เพื่อให้ Recall นับเข้าเกณฑ์ได้ — จะได้วัดเฉพาะสูตร "เหลือกี่ขั้น" ล้วนๆ
  const settings = { ...S, perYearCountsAllTypes: true, req: { ...S.req, perYear: 1 } };
  const r = riskRows([st], works, settings, [], [], NOW)[0];
  ok('เหลือ 1 ขั้นจริง → stepsRemaining = 1', r.stepsRemaining === 1, r.stepsRemaining);
  ok('ป้าย step ไม่เกินขั้นสุดท้ายของประเภท', r.stuckStep === `${TYPES.RRM.prefix}-3`, r.stuckStep);
}

console.log('\nA3. เคสที่นับเข้าเกณฑ์รายปีไม่ได้ ต้องไม่ถูกใช้เป็นทางไปสู่เกณฑ์');
/* เคยพัง: riskRows หยิบ "เคสที่ใกล้จบที่สุด" มาคิดโดยไม่ดูประเภท
   นักศึกษาที่ในมือมีแต่ Simple APD กับ Recall (ทั้งคู่ไม่นับเข้าเกณฑ์รายปี) จึงถูกอ่านว่า
   เหลืออีกไม่กี่ step แล้วขึ้นสถานะ ok — คนที่ควรถูกตามก่อนใครกลายเป็นคนที่หน้าอาจารย์บอกว่าไม่ต้องห่วง */
{
  const st = student('s1');
  const uncountable = [at('APD', 9, { studentId: 's1' }), at('RRM', 2, { studentId: 's1' }), at('RFX', 2, { studentId: 's1' })];
  const countable = [at('CD', 9, { studentId: 's1' }), at('RPD', 9, { studentId: 's1' }), at('CB', 9, { studentId: 's1' })];
  const a = riskRows([st], uncountable, S, [], [], NOW)[0];
  const b = riskRows([st], countable, S, [], [], NOW)[0];
  ok('เคสที่ไม่นับ → เหลือเท่ากับยังไม่มีเคสเลย (3 × 10)', a.stepsRemaining === 30, a.stepsRemaining);
  ok('เคสที่นับได้ใกล้จบ → เหลือน้อยกว่ามาก', b.stepsRemaining === 3, b.stepsRemaining);
  ok('คนที่มีแต่เคสที่ไม่นับ ต้องไม่ดูปลอดภัยกว่าคนที่มีเคสจริงใกล้จบ', a.stepsRemaining > b.stepsRemaining);
  ok('แกน "เกณฑ์รายปี" บนกราฟแมงมุมก็ไม่เติมช่องด้วยเคสที่ไม่นับ',
    (profile(uncountable, S, NOW).find((x) => x.key === 'year')!.partials ?? []).length === 0);
}

/* ══════════════════════════════════════════════════════════════════
   ส่วน B — สุ่มข้อมูลแล้วเช็คกฎที่ต้องจริงเสมอ
   ══════════════════════════════════════════════════════════════════ */

/** PRNG แบบกำหนด seed ได้ — พังเมื่อไหร่พิมพ์ seed ออกมาแล้วเล่นซ้ำได้เป๊ะ */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Dataset {
  students: Student[];
  works: Workpiece[];
  checkins: CheckIn[];
  updates: ProgressUpdate[];
  settings: Settings;
}

function makeDataset(seed: number): Dataset {
  const r = rng(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const chance = (p: number) => r() < p;

  const settings: Settings = {
    ...S,
    req: {
      ...S.req,
      cd: int(0, 3), rpd: int(0, 3), crown: int(0, 3),
      postCoreMin: int(0, 2), perYear: int(0, 4), years: int(1, 2),
    },
    perYearCountsAllTypes: chance(0.3),
    pairCountsAsOne: chance(0.3),
    stale: int(3, 30),
    periodsPerWeek: int(0, 4),
  };

  const students: Student[] = [];
  const works: Workpiece[] = [];
  const checkins: CheckIn[] = [];
  const updates: ProgressUpdate[] = [];

  for (let si = 0; si < int(1, 5); si++) {
    const id = `s${seed}-${si}`;
    students.push(student(id, { group: `TH-PT${int(1, 3)}`, cohort: pick([2567, 2568, 2569]) }));

    for (let wi = 0; wi < int(0, 6); wi++) {
      const type = pick(ALL_TYPES);
      const base = wp(type, {
        studentId: id,
        patientId: `p${seed}-${si}-${int(0, 2)}`,
        variant: type === 'PC' ? pick(['cast', 'prefab'] as const) : undefined,
        acceptedDate: `${pick([2025, 2026])}-${String(int(1, 12)).padStart(2, '0')}-10`,
        minimumRequirement: chance(0.8),
        pendingQualification: chance(0.15) || undefined,
        returned: chance(0.12) || undefined,
        fromSheet: chance(0.35) || undefined,
        countsForYear: chance(0.25) ? pick([2568, 2569]) : undefined,
        pairId: chance(0.2) ? `pair-${seed}-${si}-${int(0, 1)}` : undefined,
        arch: pick(['upper', 'lower'] as const),
      });
      const list = procList(base);
      const idx = int(-1, list.length - 1);
      const complete = idx === list.length - 1;
      const w: Workpiece = {
        ...base,
        procIndex: idx,
        lastUpdatedAt: new Date(NOW.getTime() - int(0, 120) * 86_400_000).toISOString(),
        // จงใจปล่อยให้ "จบแล้วแต่ไม่มีวันจบ" เกิดได้ — เป็นสภาพจริงของข้อมูลนำเข้าบางแถว
        completedAt: complete && chance(0.85)
          ? new Date(NOW.getTime() - int(0, 400) * 86_400_000).toISOString()
          : undefined,
      };
      works.push(w);

      if (chance(0.5)) {
        updates.push({
          id: `u${works.length}`, workpieceId: w.id, procIndex: Math.max(0, idx),
          progression: Math.max(0, progression(w)), performedAt: w.lastUpdatedAt.slice(0, 10),
          selfPerformed: chance(0.3), photoIds: [], reversal: chance(0.1) || undefined,
          createdBy: id, createdAt: w.lastUpdatedAt, syncedAt: null,
        });
      }
    }

    for (let ci = 0; ci < int(0, 5); ci++) {
      checkins.push({
        id: `c${seed}-${si}-${ci}`, studentId: id,
        date: new Date(NOW.getTime() - int(0, 90) * 86_400_000).toISOString().slice(0, 10),
        activity: 'Laboratory work', status: pick(['pending', 'evaluated'] as const),
      } as CheckIn);
    }
  }
  return { students, works, checkins, updates, settings };
}

/** เดินเข้าไปในผลลัพธ์ทุกชั้น หาเลขที่ไม่ใช่เลข (NaN / Infinity) */
function findBadNumber(v: unknown, path = ''): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = findBadNumber(v[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'student') continue;
      const hit = findBadNumber(val, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

type Check = { name: string; run: (d: Dataset) => string | null };

const CHECKS: Check[] = [
  {
    name: 'funnel: ยังไม่เริ่ม + กำลังทำ + จบเคส = ทั้งหมด (และเคสคืนยกออกครบ)',
    run: ({ works, settings }) => {
      for (const row of funnelByType(works, settings)) {
        if (row.notStarted + row.inProgress + row.completed !== row.total) {
          return `${row.type}: ${row.notStarted}+${row.inProgress}+${row.completed} ≠ ${row.total}`;
        }
        const ofType = works.filter((w) => w.type === row.type);
        if (row.total + row.returned !== ofType.length) return `${row.type}: total+returned ≠ ของจริง`;
        if (row.stale > row.inProgress + row.notStarted) return `${row.type}: เคสค้างมากกว่าเคสที่ยังทำอยู่`;
      }
      return null;
    },
  },
  {
    name: 'คอขวดรายขั้น: ผลรวมทุกช่อง = จำนวนงานที่กำลังทำ',
    run: ({ works, settings }) => {
      const activeAll = works.filter(isActiveWork).length;
      const sumAll = bottleneckByStep(works, settings).reduce((a, b) => a + b.count, 0);
      if (sumAll !== activeAll) return `รวมทุกประเภท ${sumAll} ≠ ${activeAll}`;
      for (const type of ALL_TYPES) {
        const activeType = works.filter((w) => w.type === type && isActiveWork(w)).length;
        const sum = bottleneckByStep(works, settings, type).reduce((a, b) => a + b.count, 0);
        if (sum !== activeType) return `${type}: ${sum} ≠ ${activeType}`;
      }
      return null;
    },
  },
  {
    name: 'แผนที่เคส: จำนวนจุด = จำนวนงานที่กำลังทำ และ step ไม่เกินขั้นสุดท้าย',
    run: ({ works, students, settings }) => {
      const dots = caseDots(works, students, settings);
      const active = works.filter(isActiveWork);
      if (dots.length !== active.length) return `${dots.length} ≠ ${active.length}`;
      for (const d of dots) {
        if (d.progression < 0 || d.progression > maxProgression({ type: d.type })) return `จุด ${d.id} step ${d.progression}`;
      }
      return null;
    },
  },
  {
    name: '% ของชิ้นงาน อยู่ใน 0–100 และ 100% ⟺ จบเคส',
    run: ({ works }) => {
      for (const w of works) {
        const p = percentCompleted(w);
        if (p < 0 || p > 100) return `${w.id} = ${p}%`;
        if ((p === 100) !== isComplete(w)) return `${w.id}: ${p}% แต่ isComplete=${isComplete(w)}`;
      }
      return null;
    },
  },
  {
    name: 'สรุปรายคน: กำลังทำ ≤ ทั้งหมด · ค้าง ≤ กำลังทำ · เกณฑ์ที่ทำได้ ≤ เกณฑ์ทั้งหมด',
    run: ({ students, works, settings }) => {
      for (const st of students) {
        const mine = works.filter((w) => w.studentId === st.id);
        const s = summarizeStudent(st, mine, settings);
        if (s.active > s.pieces) return `${st.id}: active ${s.active} > pieces ${s.pieces}`;
        if (s.stale > s.active) return `${st.id}: stale ${s.stale} > active ${s.active}`;
        if (s.reqDone > s.reqTotal) return `${st.id}: reqDone ${s.reqDone} > reqTotal ${s.reqTotal}`;
        if (s.percent < 0 || s.percent > 100) return `${st.id}: percent ${s.percent}`;
        if (s.allComplete && !caseCountTotals(mine, settings).allComplete) return `${st.id}: ครบทั้งที่เกณฑ์สะสมยังไม่ครบ`;
        if (s.allComplete && !yearlyRows(mine, settings, NOW).every((y) => y.complete)) return `${st.id}: ครบทั้งที่เกณฑ์รายปียังไม่ครบ`;
      }
      return null;
    },
  },
  {
    name: 'เกณฑ์สะสม: ที่ทำได้ ≤ ที่ต้องการ และ "ครบ" ต้องแปลว่าเต็มทุกช่อง',
    run: ({ works, settings }) => {
      const totals = caseCountTotals(works, settings);
      if (totals.done > totals.required) return `${totals.done} > ${totals.required}`;
      if (totals.allComplete && totals.done !== totals.required) return `ครบแต่ ${totals.done}/${totals.required}`;
      for (const row of totals.rows) {
        if (row.done < 0) return `${row.group} ติดลบ`;
        if (row.complete && row.done < row.required) return `${row.group} ครบทั้งที่ ${row.done}/${row.required}`;
      }
      return null;
    },
  },
  {
    name: 'เกณฑ์รายปี: ยอดรวมทุกปี ≤ จำนวนชิ้นที่จบและรู้ว่านับเข้าปีไหน',
    run: ({ works, settings }) => {
      const rows = yearlyRows(works, settings, NOW);
      const sum = rows.reduce((a, r) => a + r.done, 0);
      const eligible = works.filter(
        (w) => isComplete(w) && w.completedAt
          && (settings.perYearCountsAllTypes || (REQ_TYPES as readonly string[]).includes(w.type)),
      ).length;
      if (sum > eligible) return `รวมรายปี ${sum} > ชิ้นที่จบ ${eligible}`;
      for (const r of rows) if (r.complete !== r.done >= r.required) return `ปี ${r.year} ธงไม่ตรงกับตัวเลข`;
      return null;
    },
  },
  {
    name: 'ความเสี่ยง: ตัวเลขไม่ติดลบ · ok ต้องไม่ใช่คนที่คำนวณแล้วไม่ทัน',
    run: ({ students, works, settings, checkins, updates }) => {
      for (const r of riskRows(students, works, settings, checkins, updates, NOW)) {
        if (r.stepsRemaining < 0 || r.periodsNeeded < 0 || r.silentDays < 0) return `${r.student.id}: มีเลขติดลบ`;
        if (r.piecesDone > r.piecesTotal) return `${r.student.id}: จบ ${r.piecesDone} > ถือ ${r.piecesTotal}`;
        if (r.piecesCounted > r.yearGap) return `${r.student.id}: นับ ${r.piecesCounted} > ขาด ${r.yearGap}`;
        if (r.risk === 'ok' && r.yearGap > 0 && r.periodsNeeded > r.periodsLeft) {
          return `${r.student.id}: ok ทั้งที่ต้องใช้ ${r.periodsNeeded} คาบ เหลือ ${r.periodsLeft}`;
        }
        for (const p of r.pieces) {
          const n = Number(p.code.split('-').pop());
          if (Number.isFinite(n) && n > maxProgression({ type: p.type })) return `${r.student.id}: ป้าย ${p.code} เกินขั้นสุดท้าย`;
        }
      }
      return null;
    },
  },
  {
    name: 'ตัวเลขที่คิดจากวันจบ ต้องไม่ขยับตามงานนำเข้าจากชีต',
    run: ({ works }) => {
      const real = works.filter((w) => !w.fromSheet);
      const a = JSON.stringify(durationByType(works));
      const b = JSON.stringify(durationByType(real));
      if (a !== b) return 'durationByType เปลี่ยนเมื่อมีงานนำเข้า';
      const ta = throughputByMonth(works, NOW).reduce((x, y) => x + y.count, 0);
      const tb = throughputByMonth(real, NOW).reduce((x, y) => x + y.count, 0);
      if (ta !== tb) return `throughputByMonth ${ta} ≠ ${tb}`;
      return null;
    },
  },
  {
    name: 'กราฟแมงมุม / heatmap: ทุกแกน 0–100 · ช่องที่เติมไม่เต็มไม่เกินโควตา',
    run: ({ students, works, settings }) => {
      const rows = heatmapRows(students, works, settings, NOW);
      if (rows.length !== students.length) return 'จำนวนแถวไม่เท่าจำนวนนักศึกษา';
      for (const row of rows) {
        for (const axis of row.cells) {
          if (axis.value < 0 || axis.value > 100) return `${row.student.id}/${axis.key} = ${axis.value}`;
          for (const f of axis.partials ?? []) if (f <= 0 || f > 1) return `${row.student.id}/${axis.key} partial ${f}`;
        }
      }
      return null;
    },
  },
  {
    name: 'lab ทำเอง: ที่ทำแล้ว ≤ ที่มีให้ทำ',
    run: ({ students, works }) => {
      for (const r of selfPerformedRows(students, works)) {
        if (r.done > r.available) return `${r.student.id}: ${r.done} > ${r.available}`;
      }
      return null;
    },
  },
  {
    name: 'เส้นสะสม: ไม่ลดลง · เริ่มไม่ต่ำกว่ายอดยกมา · เป้าไม่ลดลง',
    run: ({ students, works, settings }) => {
      const carried = carriedOverCount(works, settings, NOW);
      const cap = works.filter((w) => w.fromSheet && w.completedAt).length;
      if (carried > cap) return `ยอดยกมา ${carried} > งานนำเข้าที่จบ ${cap}`;
      let prevActual = -1;
      let prevTarget = -1;
      for (const p of burnup(students, works, settings, NOW)) {
        if (p.actual !== null) {
          if (p.actual < prevActual) return 'เส้นสะสมลดลง';
          if (p.actual < carried) return `เส้นสะสม ${p.actual} ต่ำกว่ายอดยกมา ${carried}`;
          prevActual = p.actual;
        }
        if (p.target < prevTarget) return 'เส้นเป้าลดลง';
        prevTarget = p.target;
      }
      return null;
    },
  },
  {
    name: 'ครบเกณฑ์จบ ต้องแปลว่าครบทั้งเกณฑ์สะสมและรายปีทุกปี',
    run: ({ students, works, settings }) => {
      for (const st of students) {
        const mine = works.filter((w) => w.studentId === st.id);
        if (!meetsAllRequirements(mine, settings, NOW)) continue;
        if (!caseCountTotals(mine, settings).allComplete) return `${st.id}: เกณฑ์สะสมยังไม่ครบ`;
        if (!yearlyRows(mine, settings, NOW).every((y) => y.complete)) return `${st.id}: เกณฑ์รายปียังไม่ครบ`;
      }
      return null;
    },
  },
  {
    name: 'เคสที่คืนไปแล้ว ต้องไม่โผล่ในงานที่กำลังทำ/เคสค้าง/แผนที่เคส',
    run: ({ works, students, settings }) => {
      const returned = new Set(works.filter(isReturned).map((w) => w.id));
      if (!returned.size) return null;
      if (works.filter(isActiveWork).some((w) => returned.has(w.id))) return 'เคสคืนยังนับเป็นงานที่ทำอยู่';
      if (caseDots(works, students, settings).some((d) => returned.has(d.id))) return 'เคสคืนยังมีจุดบนแผนที่';
      return null;
    },
  },
  {
    name: 'ไม่มีเลขที่ไม่ใช่เลข (NaN / Infinity) โผล่ไปถึงหน้าจอ',
    run: ({ students, works, settings, checkins, updates }) => {
      const outputs: Record<string, unknown> = {
        headline: headline(students, works, settings, checkins, updates, NOW),
        funnel: funnelByType(works, settings),
        bottleneck: bottleneckByStep(works, settings),
        duration: durationByType(works),
        throughput: throughputByMonth(works, NOW),
        risk: riskRows(students, works, settings, checkins, updates, NOW),
        burnup: burnup(students, works, settings, NOW),
        heatmap: heatmapRows(students, works, settings, NOW),
        profile: profile(works, settings, NOW),
        selfPerf: selfPerformedRows(students, works),
        overall: overallPercent(works),
        totals: caseCountTotals(works, settings),
        yearly: yearlyRows(works, settings, NOW),
        summaries: students.map((st) => summarizeStudent(st, works.filter((w) => w.studentId === st.id), settings)),
      };
      return findBadNumber(outputs);
    },
  },
];

const ROUNDS = Number(process.env.ROUNDS ?? 2000);
console.log(`\nB. สุ่มข้อมูล ${ROUNDS} ชุด เช็ค ${CHECKS.length} กฎ`);
const failures = new Map<string, { seed: number; detail: string; count: number }>();
for (let seed = 1; seed <= ROUNDS; seed++) {
  const d = makeDataset(seed);
  for (const c of CHECKS) {
    let detail: string | null;
    try {
      detail = c.run(d);
    } catch (e) {
      detail = `โยน error: ${(e as Error).message}`;
    }
    if (detail) {
      const prev = failures.get(c.name);
      if (prev) prev.count++;
      else failures.set(c.name, { seed, detail, count: 1 });
    }
  }
}
for (const c of CHECKS) {
  const f = failures.get(c.name);
  ok(c.name, !f, f ? `พัง ${f.count}/${ROUNDS} ชุด · ชุดแรก seed=${f.seed} · ${f.detail}` : '');
}

console.log(bad ? `\n❌ ไม่ผ่าน ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
