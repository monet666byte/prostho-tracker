/** ปุ่มเลือกชั้นปี [ปี 5 | ปี 6 | ทุกปี] — segmented แบบ iOS: เม็ดขาวเลื่อนตามตัวที่เลือก */
import { t } from '../../lib/i18n';
import type { YearView } from '../../hooks/useYearView';

const OPTIONS: Array<[YearView, () => string]> = [
  ['5', () => `${t('ปี')} 5`],
  ['6', () => `${t('ปี')} 6`],
  ['all', () => t('รวมปี')],
  ['alumni', () => t('จบแล้ว')],
];

export function YearSeg({ view, onChange }: { view: YearView; onChange: (v: YearView) => void }) {
  const idx = OPTIONS.findIndex(([v]) => v === view);
  return (
    <div className="yearseg" data-idx={idx} role="tablist" aria-label={t('ชั้นปี')}>
      <span className="yearseg__thumb" aria-hidden />
      {OPTIONS.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={view === v} data-on={view === v} onClick={() => onChange(v)}>
          {label()}
        </button>
      ))}
    </div>
  );
}
