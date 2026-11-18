import { ArrowRight, CaretDown, CaretRight, MagnifyingGlass } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { typeMeta } from '../../domain/catalog';
import type { TodaySummary } from '../../domain/today';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';
import { waitReasonLabel } from '../../lib/waitReason';
import { greeting } from './TodayCard';

/**
 * หน้าแรกอาจารย์บนมือถือ (แบบ B3) — งานเดียวที่ต้องทำคือ "ประเมิน" จึงขึ้นก่อนทุกอย่าง
 *   แผงน้ำเงิน: วันนี้มีกี่คนรอ + ปุ่มเริ่มประเมิน · วงแหวน = คาบวันนี้ที่ประเมินแล้ว
 *   รอประเมิน: จุดน้ำเงิน แตะชื่อ = เปิดประเมินคนนั้น
 *   อยู่ step เดิมมาสักพัก: จุดส้ม · ไม่นับวัน ไม่ใช้คำว่า "ต้องตาม" (ความช้าส่วนมากมาจากคนไข้)
 * ตัวเลขทุกตัวมาจาก todaySummary ชุดเดียวกับกล่องวันนี้บนจอใหญ่
 */
export function PhoneHome({
  name, groupCodes, groupLabel, current, onPickGroup, otherPending, summary, studentName,
  ring, onSearch, onStart, onOpenEval, onOpenStudent, onGoGroup, extra,
}: {
  name: string;
  groupCodes: string[];
  groupLabel: (code: string) => string;
  current: string;
  onPickGroup: (code: string) => void;
  /** กลุ่มอื่นที่อาจารย์ดูแลแล้วมีคนรอประเมิน */
  otherPending: Array<{ code: string; n: number }>;
  summary: TodaySummary;
  studentName: (id: string) => string;
  /** คาบวันนี้ในกลุ่มที่ดู: ประเมินแล้ว / ทั้งหมด · ไม่มีคาบวันนี้ = null */
  ring: { done: number; total: number } | null;
  onSearch: () => void;
  onStart: () => void;
  onOpenEval: (studentId: string) => void;
  onOpenStudent: (studentId: string) => void;
  onGoGroup: () => void;
  extra?: ReactNode;
}) {
  const pend = summary.pendingList;
  const R = 22;
  const C = 2 * Math.PI * R;
  const ringPct = ring && ring.total ? ring.done / ring.total : 0;
  const stuck = summary.staleList.slice(0, 6);
  const waiting = summary.waitingList.slice(0, 3);

  return (
    <main className="main tph">
      <header className="tph__top">
        <div className="tph__hello">
          <h1>{greeting()}{name ? `, ${name}` : ''}</h1>
          <div className="tph__groups">
            {/* ตัวเลือกกลุ่มเป็น select จริงที่ซ่อนอยู่ใต้ป้าย — ได้ตัวเลือกของเครื่องเอง (ล้อหมุนบน iPhone) */}
            <label className="tph__grouppick">
              <span>{groupLabel(current)}</span>
              <CaretDown size={12} weight="bold" aria-hidden />
              <select value={current} onChange={(e) => onPickGroup(e.target.value)} aria-label={t('เลือกกลุ่มที่ดู')}>
                {groupCodes.map((code) => <option key={code} value={code}>{groupLabel(code)}</option>)}
              </select>
            </label>
            {otherPending.map((g) => (
              <button key={g.code} className="tph__other" onClick={() => onPickGroup(g.code)}
                aria-label={t('กลุ่ม {g} มี {n} คนรอประเมิน', { g: groupLabel(g.code), n: g.n })}>
                {groupLabel(g.code).split(' · ')[0]} <b>{g.n}</b>
              </button>
            ))}
          </div>
        </div>
        <button className="tph__round" onClick={onSearch} aria-label={t('ค้นหา')}>
          <MagnifyingGlass size={19} weight="bold" />
        </button>
      </header>

      <section className="tph__hero" aria-label={t('สรุปวันนี้')}>
        <div className="tph__herorow">
          <div className="tph__herotext">
            <span>{t('วันนี้ ({d})', { d: thaiShort(new Date()) })}</span>
            <b>{pend.length ? t('{n} คนรอประเมิน', { n: pend.length }) : t('ประเมินครบแล้ว')}</b>
          </div>
          {ring && (
            <div className="tph__ring">
              <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
                <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="6" />
                <circle cx="28" cy="28" r={R} fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${(C * ringPct).toFixed(1)} ${C.toFixed(1)}`} />
              </svg>
              <b>{ring.done}/{ring.total}</b>
              <small>{t('ประเมินแล้ว')}</small>
            </div>
          )}
        </div>
        {pend.length > 0 && (
          <button className="tph__start" onClick={onStart}>
            {t('เริ่มประเมิน')} <ArrowRight size={17} weight="bold" />
          </button>
        )}
      </section>

      <div className="tph__sect">
        <h2>{t('รอประเมิน')}</h2>
        <span>{t('{n} คน', { n: pend.length })}</span>
      </div>
      {pend.length ? (
        <div className="tph__rows">
          {pend.map((p) => (
            <button key={p.studentId} className="tph__row" onClick={() => onOpenEval(p.studentId)}>
              <span className="tph__dot" aria-hidden />
              <span className="tph__who">
                <b>{studentName(p.studentId)}</b>
                <small>{p.activities.length ? p.activities.map((a) => t(a)).join(' · ') : t('ยังไม่ระบุกิจกรรม')}</small>
              </span>
              <span className="tph__when">{p.count > 1 ? t('{n} คาบ', { n: p.count }) : thaiShort(p.latestDate)}</span>
              <CaretRight size={16} weight="bold" className="tph__chev" aria-hidden />
            </button>
          ))}
        </div>
      ) : (
        <div className="tph__rows tph__empty">{t('ไม่มีงานรอประเมินแล้ว')}</div>
      )}

      {(stuck.length > 0 || waiting.length > 0) && (
        <>
          <div className="tph__sect">
            <h2>{t('อยู่ step เดิมมาสักพัก')}</h2>
            <button className="tph__link" onClick={onGoGroup}>{t('ทั้งกลุ่ม')} ›</button>
          </div>
          <div className="tph__rows">
            {stuck.map((s) => (
              <button key={s.workId} className="tph__row" onClick={() => onOpenStudent(s.studentId)}>
                <span className="tph__dot tph__dot--stuck" aria-hidden />
                <span className="tph__who">
                  <b>{studentName(s.studentId)}</b>
                  <small>{typeMeta(s.type).short} · step {s.progression}/{s.max}</small>
                </span>
                <CaretRight size={16} weight="bold" className="tph__chev" aria-hidden />
              </button>
            ))}
            {waiting.map((w) => (
              <button key={w.workId} className="tph__row" onClick={() => onOpenStudent(w.studentId)}>
                <span className="tph__dot tph__dot--wait" aria-hidden />
                <span className="tph__who">
                  <b>{studentName(w.studentId)}</b>
                  <small>{typeMeta(w.type).short} · {waitReasonLabel(w.reason)}</small>
                </span>
                <span className="tph__tag">{t('รอคนไข้')}</span>
                <CaretRight size={16} weight="bold" className="tph__chev" aria-hidden />
              </button>
            ))}
          </div>
        </>
      )}
      {extra}
    </main>
  );
}
