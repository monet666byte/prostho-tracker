/**
 * สรุปอัตโนมัติจากแบบประเมินตนเอง — เอา "สิ่งที่นักศึกษาคิด" ชนกับ "สิ่งที่เกิดขึ้นจริงในแอป"
 *
 * ทำไมเป็นกฎในโค้ด ไม่ใช่ AI (เคาะกับผู้ใช้ 4 ก.ย. 69):
 *   · อ่านโค้ดแล้วรู้เลยว่าทำไมการ์ดใบนี้ขึ้น — อาจารย์ตรวจสอบได้
 *   · ผลเหมือนเดิมทุกครั้ง ไม่มีค่าใช้จ่าย และข้อมูลนักศึกษาไม่ออกนอกระบบ
 *   · ทุกใบต้องมี "หลักฐาน" เป็นตัวเลขจริงเสมอ ไม่ใช่คำแนะนำลอยๆ
 * วันหน้าถ้าจะเติม AI ให้เพิ่มแหล่งการ์ดอีกแหล่ง — โครงหน้าจอไม่ต้องแก้
 *
 * ⚠️ กฎเหล่านี้อ่านตัวเลข ไม่ได้อ่านใจคน — ทุกใบเป็น "ประเด็นชวนคุย" ไม่ใช่ข้อสรุป
 *   จึงต้องให้อาจารย์อ่านก่อน แล้วค่อยกดปล่อยให้นักศึกษาเห็น (feedbackReleasedAt)
 */

import { CRITERIA, MAX_SCORE } from './checkin';
import { caseCount, isComplete, isStale } from './rules';
import { academicYear } from '../lib/date';
import { lang, tText } from '../lib/i18n';
import { num, list as asList, SA_TYPES, type SAType, type SAValue } from './selfAssessment';
import type {
  CheckIn, ProgressUpdate, SelfAssessment, Settings, Student, Workpiece, WorkType,
} from './types';

export type FeedbackTone =
  | 'gap' // นักศึกษามองต่างจากข้อมูลจริง — ประเด็นชวนคุย
  | 'risk' // ตัวเลขจริงบอกว่าน่าห่วง
  | 'praise' // ประเมินตัวเองต่ำกว่าที่ทำได้จริง
  | 'info'; // ข้อมูลประกอบ ไม่ตัดสิน

export interface FeedbackCard {
  id: string;
  tone: FeedbackTone;
  /** หัวข้อสั้น */
  title: string;
  /** อธิบายว่าเห็นอะไร */
  body: string;
  /** ตัวเลขที่ใช้ตัดสิน — ให้อาจารย์ตรวจสอบที่มาได้ */
  evidence: string;
}

/** ข้อความสองภาษาแบบสั้น ไม่ต้องผ่านพจนานุกรม (ข้อความพวกนี้ยาวและใช้ที่เดียว) */
const tx = (th: string, en: string) => (lang === 'en' ? en : th);

/* ── ตัวเลขจริงที่กฎใช้ ─────────────────────────────────────────────────── */

/** หัวข้อในแบบประเมินตนเอง ↔ หัวข้อที่อาจารย์ให้คะแนนรายคาบ (ตรงกันเกือบ 1:1) */
const PROF_TO_CRITERION: Record<string, { crit: string; th: string; en: string }> = {
  profPrecaution: { crit: 'precaution', th: 'การป้องกันการติดเชื้อ', en: 'Universal precautions' },
  profInstrument: { crit: 'instrument', th: 'การเตรียมเครื่องมือ', en: 'Instrument preparation' },
  profTime: { crit: 'time', th: 'การบริหารเวลา', en: 'Time management' },
  profCommunication: { crit: 'communication', th: 'การสื่อสาร', en: 'Interpersonal communication' },
  profDocuments: { crit: 'chart', th: 'การบันทึกเอกสาร', en: 'Documents / chart recording' },
  profAppearance: { crit: 'conduct', th: 'ความประพฤติโดยรวม', en: 'General conduct' },
};

/** ชิ้นงานของประเภทนี้ — RPD ในฟอร์มรวม APD ด้วย */
function worksOfType(works: Workpiece[], type: SAType): Workpiece[] {
  const match: WorkType[] = type === 'RPD' ? ['RPD', 'APD'] : [type as WorkType];
  return works.filter((w) => match.includes(w.type) && !w.returned);
}

/** ค่าเฉลี่ยคะแนนอาจารย์รายหัวข้อ (0–3) จากคาบที่ประเมินแล้ว */
function teacherAverages(checkins: CheckIn[]): { avg: Map<string, number>; n: number } {
  const scored = checkins.filter((c) => c.status === 'evaluated' && c.scores);
  const avg = new Map<string, number>();
  if (!scored.length) return { avg, n: 0 };
  CRITERIA.forEach((c) => {
    const vals = scored.map((s) => s.scores?.[c.key]).filter((v): v is number => typeof v === 'number');
    if (vals.length) avg.set(c.key, vals.reduce((a, b) => a + b, 0) / vals.length);
  });
  return { avg, n: scored.length };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const one = (n: number) => n.toFixed(1);

export interface FeedbackInput {
  sa: SelfAssessment;
  student: Student;
  works: Workpiece[];
  checkins: CheckIn[];
  updates: ProgressUpdate[];
  settings: Settings;
  now?: Date;
}

/* ── เครื่องยนต์ ────────────────────────────────────────────────────────── */

export function buildFeedback(input: FeedbackInput): FeedbackCard[] {
  const { sa, works, checkins, updates, settings } = input;
  const now = input.now ?? new Date();
  const a = sa.answers as Record<string, SAValue>;
  const cards: FeedbackCard[] = [];
  const mine = works.filter((w) => !w.returned);

  /* ① มุมมองเรื่องความเป็นวิชาชีพ vs คะแนนที่อาจารย์ให้จริง
        ต้องมีอย่างน้อย 3 คาบที่ประเมินแล้ว ไม่งั้นค่าเฉลี่ยยังไม่มีความหมาย */
  const { avg, n: scoredPeriods } = teacherAverages(checkins);
  if (scoredPeriods >= 3) {
    for (const [key, meta] of Object.entries(PROF_TO_CRITERION)) {
      const self = num(a[key]);
      const mean = avg.get(meta.crit);
      if (self === null || mean === undefined) continue;
      const topic = lang === 'en' ? meta.en : meta.th;
      const ev = tx(
        `อาจารย์ให้เฉลี่ย ${one(mean)}/${MAX_SCORE} จาก ${scoredPeriods} คาบที่ประเมินแล้ว`,
        `Instructor average ${one(mean)}/${MAX_SCORE} across ${scoredPeriods} evaluated periods`,
      );
      // นักศึกษาว่า "ทำได้เหมาะสม" แต่คะแนนจริงยังต่ำ → ชวนคุยว่ามองต่างกันตรงไหน
      if (self >= 1 && mean < 2) {
        cards.push({
          id: `prof-gap-${key}`, tone: 'gap',
          title: tx(`มองต่างกันเรื่อง${topic}`, `Different view on ${topic.toLowerCase()}`),
          body: tx(
            `นักศึกษาประเมินตัวเองว่าทำได้เหมาะสม แต่คะแนนที่ได้รับในคาบยังอยู่ระดับต่ำ ลองคุยกันว่าอาจารย์มองที่จุดไหน`,
            `The student rated this appropriate, but period scores remain low. Worth discussing what the instructors are looking at.`,
          ),
          evidence: ev,
        });
      }
      // ตรงข้าม: ประเมินตัวเองต่ำ แต่คะแนนจริงดี → บอกให้รู้ว่าทำได้ดีกว่าที่คิด
      if (self <= 0 && mean >= 2.5) {
        cards.push({
          id: `prof-praise-${key}`, tone: 'praise',
          title: tx(`${topic}ดีกว่าที่ประเมินตัวเอง`, `${topic} is better than self-rated`),
          body: tx(
            `นักศึกษาบอกว่าข้อนี้ต้องปรับปรุง แต่คะแนนจากอาจารย์อยู่ในเกณฑ์ดีมาโดยตลอด`,
            `The student flagged this for improvement, but instructor scores have been consistently good.`,
          ),
          evidence: ev,
        });
      }
    }
  }

  /* ② การบริหารเวลา vs การมาตรงเวลาจริง (ข้อมูลคนละชุดกับคะแนน — เวลาเช็คอินระบบจับเอง) */
  const late = checkins.filter((c) => !c.punctual).length;
  if (checkins.length >= 4) {
    const rate = late / checkins.length;
    if (num(a.profTime) !== null && num(a.profTime)! >= 1 && rate > 0.25) {
      cards.push({
        id: 'time-late', tone: 'gap',
        title: tx('มาสายบ่อยกว่าที่คิด', 'Late more often than self-rated'),
        body: tx(
          'นักศึกษาประเมินการบริหารเวลาว่าเหมาะสม แต่เวลาเช็คอินจริงเข้าเกณฑ์สายอยู่หลายคาบ',
          'Time management was rated appropriate, but recorded check-in times were late in several periods.',
        ),
        evidence: tx(
          `สาย ${late} จาก ${checkins.length} คาบ (${pct(rate)})`,
          `Late in ${late} of ${checkins.length} periods (${pct(rate)})`,
        ),
      });
    }
  }

  /* ③ ความรู้/ทักษะรายประเภทงาน vs เคสที่มีจริงในมือ */
  for (const t of SA_TYPES) {
    const k = num(a[`proc${t.key}K`]);
    const s = num(a[`proc${t.key}S`]);
    const rows = worksOfType(mine, t.key);
    const done = rows.filter(isComplete).length;
    const label = lang === 'en' ? t.label : t.th;
    const lowest = [k, s].filter((v): v is number => v !== null);
    if (!lowest.length) continue;
    const min = Math.min(...lowest);

    if (rows.length === 0) {
      cards.push({
        id: `type-none-${t.key}`, tone: min <= 1 ? 'risk' : 'gap',
        title: tx(`ยังไม่มีเคส ${label}`, `No ${label} case yet`),
        body: min <= 1
          ? tx(
              'ให้คะแนนตัวเองต่ำและยังไม่มีเคสประเภทนี้เลย ควรวางแผนรับเคสก่อนเข้าเทอม 2',
              'Low self-rating and no case of this type yet. Plan to accept one before term 2.',
            )
          : tx(
              'ให้คะแนนความรู้/ทักษะไว้ค่อนข้างสูง แต่ยังไม่เคยลงมือกับผู้ป่วยจริงในประเภทนี้',
              'Rated relatively high, but has not yet worked on a real patient of this type.',
            ),
        evidence: tx(
          `K ${k ?? '—'} · S ${s ?? '—'} · เคสในมือ 0 ชิ้น`,
          `K ${k ?? '—'} · S ${s ?? '—'} · 0 cases in hand`,
        ),
      });
      continue;
    }

    if (min <= 1 && done >= 1) {
      cards.push({
        id: `type-praise-${t.key}`, tone: 'praise',
        title: tx(`${label} ทำจบมาแล้วจริง`, `${label} already completed`),
        body: tx(
          'ให้คะแนนตัวเองไว้ต่ำ ทั้งที่ทำเคสประเภทนี้จบมาแล้ว อาจประเมินตัวเองต่ำกว่าที่ทำได้',
          'Self-rated low despite having completed a case of this type — possibly underrating themselves.',
        ),
        evidence: tx(
          `K ${k ?? '—'} · S ${s ?? '—'} · จบแล้ว ${done} จาก ${rows.length} ชิ้น`,
          `K ${k ?? '—'} · S ${s ?? '—'} · ${done} of ${rows.length} completed`,
        ),
      });
    }
  }

  /* ④ ความมั่นใจว่าจะทำครบเกณฑ์ vs เกณฑ์ที่ทำได้จริง */
  const conf = num(a.courseConfidence);
  const req = caseCount(mine, settings);
  const shortRows = req.filter((r) => !r.complete);
  const reqEvidence = req
    .map((r) => `${r.group} ${r.done}/${r.required}`)
    .join(' · ');
  if (conf !== null) {
    if (conf <= 1 && shortRows.length === 0) {
      cards.push({
        id: 'req-ok', tone: 'praise',
        title: tx('เกณฑ์สะสมครบแล้วตามตัวเลข', 'Cumulative requirement already met'),
        body: tx(
          'นักศึกษาไม่ค่อยมั่นใจว่าจะทำครบ แต่ตัวเลขในระบบบอกว่าเกณฑ์สะสมครบทุกกลุ่มแล้ว',
          'The student is unsure about finishing, but the tracked numbers show every requirement group is met.',
        ),
        evidence: reqEvidence,
      });
    } else if (conf >= 3 && shortRows.length >= 2) {
      cards.push({
        id: 'req-gap', tone: 'risk',
        title: tx('มั่นใจสูงแต่ยังขาดหลายกลุ่ม', 'Confident, but several groups still short'),
        body: tx(
          'นักศึกษามั่นใจว่าจะทำครบ แต่ยังขาดเกณฑ์อยู่หลายกลุ่ม ควรไล่แผนรับเคสให้ชัดในนัดนี้',
          'The student is confident, but multiple requirement groups are still short. Worth mapping out case intake in this meeting.',
        ),
        evidence: reqEvidence,
      });
    }
  }

  /* ⑤ "ต้องทำซ้ำ / รื้อทำใหม่" — เทียบกับการย้อน step ที่บันทึกไว้จริง */
  const myWorkIds = new Set(mine.map((w) => w.id));
  const reversals = updates.filter((u) => u.reversal && myWorkIds.has(u.workpieceId));
  if (a.probRedone === 1) {
    if (reversals.length > 0) {
      const byWork = new Map<string, number>();
      reversals.forEach((r) => byWork.set(r.workpieceId, (byWork.get(r.workpieceId) ?? 0) + 1));
      const worst = [...byWork.entries()].sort((x, y) => y[1] - x[1])[0];
      const w = mine.find((p) => p.id === worst[0]);
      cards.push({
        id: 'redo-evidence', tone: 'info',
        title: tx('การทำซ้ำที่ระบบบันทึกไว้', 'Redone steps on record'),
        body: tx(
          'นักศึกษาระบุว่าเจอปัญหาต้องทำซ้ำ — นี่คือเคสที่มีการย้อน step มากที่สุด ใช้เป็นจุดตั้งต้นในการคุยได้',
          'The student reported repeated work. This is the case with the most reverted steps — a good starting point.',
        ),
        evidence: tx(
          `ย้อน step ทั้งหมด ${reversals.length} ครั้ง · มากสุดที่ ${w?.detail ?? '—'} (${worst[1]} ครั้ง)`,
          `${reversals.length} reverted steps total · most on ${w?.detail ?? '—'} (${worst[1]})`,
        ),
      });
    } else {
      cards.push({
        id: 'redo-nodata', tone: 'info',
        title: tx('ทำซ้ำแต่ไม่มีร่องรอยในระบบ', 'Repeated work not reflected in records'),
        body: tx(
          'นักศึกษาบอกว่าต้องทำซ้ำ แต่ในระบบไม่มีการย้อน step เลย อาจเป็นงานที่ทำซ้ำก่อนกดผ่านขั้น ลองให้เล่าว่าติดตรงไหน',
          'The student reported redoing work, but no step reversals are recorded. Ask where the repetition actually happened.',
        ),
        evidence: tx('ย้อน step 0 ครั้ง', '0 reverted steps'),
      });
    }
  }

  /* ⑥ เคสค้างนาน ทั้งที่ตอบว่าไม่มีปัญหา */
  const stale = mine.filter((w) => !isComplete(w) && isStale(w, settings, now));
  const noProblem = ['probPreprosth', 'probRedone', 'probComplex', 'probPlanning'].every((k) => a[k] === 0);
  if (stale.length > 0 && noProblem) {
    cards.push({
      id: 'stale-silent', tone: 'gap',
      title: tx('ตอบว่าไม่มีปัญหา แต่มีเคสค้าง', 'No problems reported, but cases are stalling'),
      body: tx(
        'ทุกข้อในหมวดปัญหาตอบว่าไม่มี แต่ระบบเห็นเคสที่ไม่ขยับมานาน ลองถามว่าติดที่ผู้ป่วย แล็บ หรือคิว',
        'Every problem item was answered "No", yet some cases have not moved for a while. Ask whether the blocker is the patient, the lab, or scheduling.',
      ),
      evidence: tx(
        `${stale.length} ชิ้นไม่ขยับเกิน ${settings.stale} วัน · เช่น ${stale[0].detail}`,
        `${stale.length} pieces idle over ${settings.stale} days · e.g. ${stale[0].detail}`,
      ),
    });
  }

  /* ⑦ ใบสั่งงานแล็บ — ข้อที่ฟอร์มจริงมักได้คะแนนต่ำสุด */
  const labAuth = num(a.labAuth);
  if (labAuth !== null && labAuth <= 1) {
    cards.push({
      id: 'lab-auth', tone: 'risk',
      title: tx('ยังไม่เข้าใจเรื่องใบสั่งงานแล็บ', 'Lab work authorization not understood'),
      body: tx(
        'ให้คะแนนความเข้าใจเรื่องเอกสารสั่งงานแล็บไว้ต่ำ ซึ่งเป็นขั้นที่ทำให้งานค้างได้ทั้งเคส ควรทบทวนให้ชัดก่อนส่งงานชิ้นต่อไป',
        'Rated low on lab authorization paperwork — a step that can stall a whole case. Worth clarifying before the next lab submission.',
      ),
      evidence: tx(`ให้คะแนนตัวเอง ${labAuth}/4`, `Self-rated ${labAuth}/4`),
    });
  }

  /* ⑧ ประเภทงานที่อยากพัฒนา — ผูกกับเกณฑ์ที่ยังขาดจริง */
  const wants = asList(a.improveTypes);
  if (wants.length) {
    const names = wants
      .map((k) => SA_TYPES.find((t) => t.key === k))
      .filter(Boolean)
      .map((t) => (lang === 'en' ? t!.label : t!.th));
    // ใช้ชื่อเต็มของกลุ่มเกณฑ์ ไม่ใช่รหัสย่อ (CD/RPD/CROWN) — อาจารย์อ่านรายงานนี้ ไม่ใช่โปรแกรมเมอร์
    const shortNames = shortRows.map((r) => tText(r.label)).join(' · ');
    cards.push({
      id: 'wants', tone: 'info',
      title: tx('เรื่องที่นักศึกษาอยากพัฒนา', 'What the student wants to improve'),
      body: names.join(' · '),
      evidence: shortRows.length
        ? tx(`กลุ่มที่ยังขาดเกณฑ์: ${shortNames}`, `Requirement groups still short: ${shortNames}`)
        : tx('เกณฑ์สะสมครบทุกกลุ่มแล้ว', 'All requirement groups already met'),
    });
  }

  /* ⑨ ยังไม่มีคาบที่ประเมิน — บอกตรงๆ ว่าเทียบอะไรไม่ได้ ดีกว่าเงียบ */
  if (scoredPeriods === 0) {
    cards.push({
      id: 'no-eval', tone: 'info',
      title: tx('ยังไม่มีคาบที่อาจารย์ประเมิน', 'No evaluated periods yet'),
      body: tx(
        'ส่วนที่เทียบมุมมองนักศึกษากับคะแนนจากอาจารย์ยังทำไม่ได้ เพราะยังไม่มีคาบที่ประเมินในระบบ',
        'The self-versus-instructor comparison is unavailable because no period has been evaluated yet.',
      ),
      evidence: tx(`เช็คอิน ${checkins.length} คาบ · ประเมินแล้ว 0`, `${checkins.length} check-ins · 0 evaluated`),
    });
  }

  return cards;
}

/** เรียงให้เรื่องที่ต้องคุยขึ้นก่อน แล้วค่อยเรื่องที่ให้กำลังใจ */
const TONE_ORDER: Record<FeedbackTone, number> = { risk: 0, gap: 1, info: 2, praise: 3 };

export function sortFeedback(cards: FeedbackCard[]): FeedbackCard[] {
  return [...cards].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

/** ปีการศึกษาที่ควรกรอกตอนนี้ */
export function saYearNow(now = new Date()): number {
  return academicYear(now);
}
