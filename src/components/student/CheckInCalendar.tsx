import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { checkinsInMonth } from '../../domain/checkin';
import type { CheckIn } from '../../domain/types';
import { monthTitle, toISODate, weekdayShort } from '../../lib/date';
import { t } from '../../lib/i18n';

/**
 * ปฏิทินคาบรายเดือน — วันที่มาคลินิกมีจุดบอกสถานะ (เขียว = ประเมินแล้ว · ส้ม = รอประเมิน · วงเส้น = ไม่มีผู้ป่วย)
 * แตะวันที่มีคาบ = กางแถวคาบนั้นในรายการด้านล่าง · เปิดมาที่เดือนของคาบล่าสุด (ถ้ายังไม่มีคาบ ใช้เดือนนี้)
 */
export function CheckInCalendar({ checkins, onPick }: { checkins: CheckIn[]; onPick: (c: CheckIn) => void }) {
  const today = toISODate(new Date());
  const latest = checkins.reduce<string>((m, c) => (c.date > m ? c.date : m), '');
  const start = latest || today;
  const [ym, setYm] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));
  const shift = (d: number) => setYm(({ y, m }) => ({ y: y + Math.floor((m + d) / 12), m: ((m + d) % 12 + 12) % 12 }));

  const inMonth = checkinsInMonth(checkins, ym.y, ym.m);
  const byDay = new Map(inMonth.map((c) => [Number(c.date.slice(8, 10)), c]));
  const lead = new Date(ym.y, ym.m, 1).getDay();
  const daysIn = new Date(ym.y, ym.m + 1, 0).getDate();
  // เลื่อนไปข้างหน้าเกินเดือนนี้ไม่มีประโยชน์ — ยังไม่มีคาบในอนาคต
  const atNow = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}` >= today.slice(0, 7);

  return (
    <div className="card calcard">
      <div className="calcard__head">
        <span className="calcard__title">{monthTitle(ym.y, ym.m)}</span>
        {inMonth.length > 0 && <span className="calcard__count">🔥 {t('มา {n} คาบเดือนนี้', { n: inMonth.length })}</span>}
        <button className="calcard__nav" onClick={() => shift(-1)} aria-label={t('เดือนก่อน')}><CaretLeft size={16} weight="bold" /></button>
        <button className="calcard__nav" onClick={() => shift(1)} disabled={atNow} aria-label={t('เดือนถัดไป')}><CaretRight size={16} weight="bold" /></button>
      </div>
      <div className="calcard__grid">
        {weekdayShort().map((d, i) => <span key={i} className="calcard__wd" aria-hidden>{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const day = i + 1;
          const iso = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const c = byDay.get(day);
          if (!c) return <span key={day} className="calday" data-today={iso === today}>{day}<span className="calday__dot" /></span>;
          const status = c.status === 'evaluated' ? 'ok' : 'wait';
          return (
            <button
              key={day} className="calday" data-today={iso === today} onClick={() => onPick(c)}
              aria-label={`${day} · ${c.status === 'evaluated' ? t('ประเมินแล้ว') : t('รอประเมิน')}${c.noPatient ? ` · ${t('ไม่มีผู้ป่วย')}` : ''}`}
            >
              {day}
              <span className={`calday__dot calday__dot--${status}${c.noPatient ? ' calday__dot--nopt' : ''}`} />
            </button>
          );
        })}
      </div>
      <div className="calcard__legend">
        <span><i className="calday__dot calday__dot--ok" />{t('ประเมินแล้ว')}</span>
        <span><i className="calday__dot calday__dot--wait" />{t('รอประเมิน')}</span>
        <span><i className="calday__dot calday__dot--nopt" />{t('ไม่มีผู้ป่วย')}</span>
      </div>
    </div>
  );
}
