/**
 * บรรทัดให้กำลังใจรายวันบนหน้าแรก — เลือกจากสถานการณ์จริงของคนนั้นวันนั้น
 *
 * หลักที่ผู้ใช้เคาะ (28 ส.ค.):
 * - บอกของจริงเสมอ (ชื่อผู้ป่วย/step/ตัวเลข) + กำลังใจสั้นๆ ท้ายประโยค
 * - โทนอบอุ่นแบบ "ขอให้เป็นวันที่ดีในคลินิกครับ" — ชมเยอะๆ (เก่งมาก/ยอดเยี่ยม)
 * - ห้ามมีอะไรที่เพิ่มความเครียด: ไม่ทวงงาน ไม่ประชด ไม่เทียบกับเพื่อน
 * - ไม่มี streak เช็คอิน (เข้าทุกคาบเป็นหน้าที่อยู่แล้ว) — มีแค่ฉลองคาบเลขสวย
 */
import { t } from '../lib/i18n';
import { currentProc, isComplete, maxProgression, nextProc, progression, yearlyRows } from './rules';
import type { CheckIn, Settings, WorkpieceView } from './types';

const DAY = 86_400_000;

/** ข้อความกลางๆ โทนอบอุ่น — หมุนตามวันจะได้ไม่ซ้ำทุกวัน */
const DEFAULTS = [
  'ขอให้เป็นวันที่ดีในคลินิกครับ 🦷',
  'ค่อยเป็นค่อยไป เก็บทีละขั้น — เอาใจช่วยเสมอครับ',
  'ใจเย็นๆ มือนิ่งๆ วันนี้ผ่านไปด้วยดีแน่ครับ',
];

/** quote สั้นๆ ท้ายการ์ดไฟ 🔥 — หมุนตามวัน (วันเดียวกันเห็นประโยคเดิม พรุ่งนี้ค่อยเปลี่ยน)
 *  ผู้ใช้เคาะ 1 ก.ย.: เป็นอังกฤษทั้งสองภาษา — โทน minimal แบบ "bit by bit"
 *  (แปลไทยแล้วไม่สวย เลยไม่แปล — แนวเดียวกับหัวข้อ radar ที่เป็นอังกฤษทั้งคู่) */
const QUOTES = [
  'bit by bit',
  'slow is fine — just keep going',
  'small steps still count',
  'quietly adding up',
  'no rush, no stopping',
  'one more step today',
  'steady beats fast',
  'still growing',
];

export function dailyQuote(now = new Date()): string {
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / DAY);
  return QUOTES[dayOfYear % QUOTES.length];
}

export function cheerLine(
  works: WorkpieceView[],
  checkins: CheckIn[],
  settings: Settings,
  now = new Date(),
): string {
  const today = now.toISOString().slice(0, 10);
  const active = works.filter((w) => !isComplete(w));
  const daysSince = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);

  // 1–2. มีเคสใกล้จบ — เรื่องน่าตื่นเต้นสุด เช็คก่อน
  const nearest = active
    .map((w) => ({ w, remaining: maxProgression(w) - Math.max(progression(w), 0) }))
    .filter((x) => x.remaining > 0 && Math.max(progression(x.w), 0) > 0)
    .sort((a, b) => a.remaining - b.remaining)[0];
  if (nearest && nearest.remaining === 1) {
    return t('{p} เหลือขั้นเดียวก็จบเคสแล้ว — โชคดีกับคาบนี้ครับ 🍀', { p: t(nearest.w.patient.name) });
  }
  if (nearest && nearest.remaining <= 3) {
    return t('เคสของ{p} ใกล้จบแล้ว เหลืออีก {n} ขั้น — ค่อยๆ เก็บครับ', { p: t(nearest.w.patient.name), n: nearest.remaining });
  }

  // 3. เช็คอินวันนี้แล้วและระบุผู้ป่วย — บอกคิวของวันนี้ + goodluck
  const todayCheckIn = checkins.find((c) => c.date === today && c.patientId);
  if (todayCheckIn) {
    const w = active
      .filter((x) => x.patientId === todayCheckIn.patientId)
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0];
    const next = w ? nextProc(w) : null;
    if (w && next) {
      return t('วันนี้คิว {s} ของ{p} — โชคดีกับคาบนี้ครับ 🍀', { s: next.name, p: t(w.patient.name) });
    }
  }

  // 4. เพิ่งผ่าน step มาหมาดๆ (ภายใน 3 วัน) — ชมก่อนเลย
  const fresh = active
    .filter((w) => Math.max(progression(w), 0) > 0 && daysSince(w.lastUpdatedAt) <= 3)
    .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0];
  if (fresh) {
    const cur = currentProc(fresh);
    const next = nextProc(fresh);
    if (cur && next) {
      return t('เก่งมากครับ — ผ่าน {a} เรียบร้อยแล้ว 👏 ขั้นต่อไป {b} รออยู่', { a: cur.name, b: next.name });
    }
  }

  // 5. เพิ่งปิดเคสในสัปดาห์นี้
  const justDone = works
    .filter((w) => isComplete(w) && w.completedAt && daysSince(w.completedAt) <= 7)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
  if (justDone) {
    return t('ยอดเยี่ยมมาก — ปิดเคสของ{p} ได้แล้ว ภูมิใจได้เลยครับ', { p: t(justDone.patient.name) });
  }

  // 6. เกณฑ์รายปีครบแล้ว
  const thisYear = yearlyRows(works, settings).slice(-1)[0];
  if (thisYear?.complete) {
    return t('เก่งมากครับ เกณฑ์ปีนี้ครบแล้ว — ที่เหลือจากนี้คือกำไรล้วนๆ');
  }

  // 8. วันนี้คือคาบเลขสวย (นับสะสมทั้งหมด ไม่มีวันรีเซ็ต)
  if (checkins.some((c) => c.date === today)) {
    const n = checkins.length;
    if ([10, 25, 50, 100].includes(n)) {
      return t('วันนี้เป็นคาบที่ {n} ของคุณแล้ว — เดินทางมาไกลมากครับ', { n });
    }
  }

  // 12. ค่าเริ่มต้นโทนอบอุ่น — หมุนตามวันของปี
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / DAY);
  return t(DEFAULTS[dayOfYear % DEFAULTS.length]);
}
