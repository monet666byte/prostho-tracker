import { useMemo, useState } from 'react';
import { CalendarBlank, Stack } from '@phosphor-icons/react';
import { CRITERIA, MAX_TOTAL, groupSessionsByWork, lowestScore, totalScore, type WorkHistoryGroup } from '../../domain/checkin';
import { typeMeta } from '../../domain/catalog';
import type { CheckIn, ProgressUpdate, Workpiece } from '../../domain/types';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';

/** ชิปหนึ่งคาบ: วันที่ · คะแนนรวม · สีตามข้อที่ได้ต่ำสุดของคาบนั้น (สีไฟจราจรชุดเดียวกับหน้าประเมิน) */
function SessionChip({ c }: { c: CheckIn }) {
  if (c.status !== 'evaluated' || !c.scores) {
    return <span className="shist__chip" data-low="pending">{thaiShort(c.date)} · {t('รอประเมิน')}</span>;
  }
  const detail = CRITERIA.map((cr) => `${t(cr.short)} ${c.scores?.[cr.key] ?? '–'}`).join(' · ');
  return (
    <span className="shist__chip" data-low={lowestScore(c)} title={detail}>
      {thaiShort(c.date)} · {totalScore(c.scores)}<small>/{MAX_TOTAL}</small>
    </span>
  );
}

function groupTitle(g: WorkHistoryGroup): { title: string; color: string; note?: string } {
  if (g.key === 'multi') {
    return {
      title: t('คนไข้มีหลายงาน'),
      color: 'var(--text-faint)',
      note: t('{types} — ไม่มี step ที่บันทึกวันเดียวกับคาบ จึงระบุไม่ได้ว่าทำงานไหน', {
        types: g.types.map((x) => typeMeta(x).short).join(' / '),
      }),
    };
  }
  if (g.key === 'none') {
    return { title: t('ไม่ผูกกับเคส'), color: 'var(--text-faint)', note: t('ไม่มีผู้ป่วย หรือคนไข้ไม่มีเคสของนักศึกษาคนนี้') };
  }
  const m = typeMeta(g.key);
  return { title: m.short, color: m.color };
}

/**
 * ประวัติคาบของนักศึกษาหนึ่งคน สลับดู "ตามวัน" / "ตามประเภทงาน"
 * กติกาจับคู่คาบกับประเภทงานอยู่ที่ groupSessionsByWork (domain/checkin.ts) — ห้ามเดาประเภทในหน้าจอ
 */
export function SessionHistory({ sessions, works, updates }: {
  sessions: CheckIn[];
  works: Workpiece[];
  updates: ProgressUpdate[];
}) {
  const [view, setView] = useState<'type' | 'date'>('type');
  const groups = useMemo(() => groupSessionsByWork(sessions, works, updates), [sessions, works, updates]);
  const byDate = useMemo(
    () => [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [sessions],
  );
  const pending = sessions.filter((c) => c.status !== 'evaluated').length;

  return (
    <div className="shist">
      <div className="shist__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="shist__title">{t('ประวัติคาบ')}</div>
          <div className="faint shist__sub">
            {t('{n} คาบ', { n: sessions.length })}{pending ? ` · ${t('รอประเมิน {n}', { n: pending })}` : ''}
          </div>
        </div>
        <div className="seg seg--sm" role="group" aria-label={t('เรียงประวัติ')}>
          <button data-on={view === 'date'} aria-pressed={view === 'date'} onClick={() => setView('date')}>
            <CalendarBlank size={14} weight="bold" />{t('ตามวัน')}
          </button>
          <button data-on={view === 'type'} aria-pressed={view === 'type'} onClick={() => setView('type')}>
            <Stack size={14} weight="bold" />{t('ตามประเภทงาน')}
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="dashed shist__empty">{t('ยังไม่มีคาบของคนนี้')}</div>
      ) : view === 'date' ? (
        <div className="shist__chips">
          {byDate.map((c) => <SessionChip key={c.id} c={c} />)}
        </div>
      ) : (
        <div className="shist__groups">
          {groups.map((g) => {
            const head = groupTitle(g);
            return (
              <section key={g.key} className="shist__group" data-loose={g.key === 'multi' || g.key === 'none'}>
                <div className="shist__ghead">
                  <span className="shist__dot" style={{ background: head.color }} aria-hidden />
                  <b>{head.title}</b>
                  <span className="faint">
                    {t('{n} คาบ', { n: g.evaluated })}{g.pending ? ` · ${t('รอ {n}', { n: g.pending })}` : ''}
                  </span>
                </div>
                <div className="shist__chips">
                  {g.sessions.map((c) => <SessionChip key={c.id} c={c} />)}
                </div>
                {g.repeatLow ? (
                  <div className="shist__note">
                    {t('ต่ำกว่า 3 ซ้ำ: {s} ({n} จาก {m} คาบ)', {
                      s: t(CRITERIA.find((cr) => cr.key === g.repeatLow!.key)?.short ?? g.repeatLow.key),
                      n: g.repeatLow.count,
                      m: g.evaluated,
                    })}
                  </div>
                ) : g.evaluated >= 2 ? (
                  <div className="shist__note faint">{t('ไม่มีหัวข้อที่ต่ำซ้ำ')}</div>
                ) : null}
                {head.note && <div className="shist__note faint">{head.note}</div>}
              </section>
            );
          })}
          <p className="faint shist__legend">{t('สีชิป = ข้อที่ได้ต่ำสุดของคาบนั้น · เลข = คะแนนรวม')}</p>
        </div>
      )}
    </div>
  );
}
