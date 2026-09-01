/** ปุ่มเลือกชั้นปี [ปี 5 | ปี 6 | รวม] — ใช้คู่กับ useYearView บนหน้าภาพรวม */
import { t } from '../../lib/i18n';
import type { YearView } from '../../hooks/useYearView';

export function YearSeg({ view, onChange }: { view: YearView; onChange: (v: YearView) => void }) {
  const options: Array<[YearView, string]> = [['5', `${t('ปี')} 5`], ['6', `${t('ปี')} 6`], ['all', t('ทุกปี')]];
  return (
    <div className="grouppick" style={{ display: 'flex', gap: 6 }}>
      {options.map(([v, label]) => (
        <button key={v} data-on={view === v} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}
