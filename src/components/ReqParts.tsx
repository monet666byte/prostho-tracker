import type { ReqPart } from '../domain/rules';
import { t } from '../lib/i18n';

/**
 * รายการชนิดงานใต้แถบเกณฑ์สะสม — แถบนับรวมกัน (เช่น CD + Complicated APD = 2)
 * รายการนี้บอกว่าชิ้นที่จบ/กำลังทำเป็นชนิดไหน · ชนิดที่บังคับ (Post-core · Co-Cr) โชว์เป็น x/y
 * ใช้ทั้งหน้าเกณฑ์ฝั่งนักศึกษาและช่องเกณฑ์รายคนฝั่งอาจารย์ ให้ทั้งสองฝั่งอ่านเหมือนกัน
 */
export function ReqParts({ parts }: { parts: ReqPart[] }) {
  return (
    <div className="reqparts">
      {parts.map((p) => {
        const must = (p.required ?? 0) > 0;
        const ok = must && p.done >= (p.required ?? 0);
        return (
          <div key={p.key} className="reqparts__row">
            <span className="reqparts__name">
              {p.label}
              {p.hint && <small> {t(p.hint)}</small>}
              {must && <small className="reqparts__must"> · {t('บังคับ ≥{n}', { n: p.required ?? 0 })}</small>}
            </span>
            <span className="reqparts__st">
              {t('จบ')}{' '}
              <b data-tone={must ? (ok ? 'ok' : 'must') : undefined}>{must ? `${p.done}/${p.required}` : p.done}</b>
              {p.doing > 0 && <span className="reqparts__doing">{t('กำลังทำ {n}', { n: p.doing })}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
