import { useEffect, useState } from 'react';
import { typeChipLabel, typeMeta } from '../../domain/catalog';
import type { WorkType } from '../../domain/types';
import { t } from '../../lib/i18n';

const R = 62;
const C = 2 * Math.PI * R;

/**
 * วงงานที่กำลังทำ แยกประเภท (ผู้ใช้เลือก 15 ก.ย. 69 — "อยากให้เปิดแล้วมีวงๆ")
 * ข้างวงมีแค่ชื่อประเภท ไม่มีตัวเลข · ชี้/จิ้มส่วนไหน เลขกลางวงเปลี่ยนเป็นของประเภทนั้น
 */
export function TypeDonut({ items, foot }: { items: Array<{ type: WorkType; count: number }>; foot?: string }) {
  const total = items.reduce((s, x) => s + x.count, 0);
  const [hot, setHot] = useState<WorkType | null>(null);
  /* เริ่มจากวงว่างแล้ววาดขึ้นหนึ่งครั้ง — รอให้หน้าวาดเสร็จก่อน (เครื่องว่าง) ค่อยเริ่ม
     เดิมเริ่มทันทีแล้วชนกับจังหวะที่ทั้งหน้ากำลังโหลด วงเลยวาดกระตุก (ผู้ใช้บอก "แลคๆ" 15 ก.ย. 69) */
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setDrawn(true), { timeout: 600 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setDrawn(true), 250);
    return () => window.clearTimeout(id);
  }, []);
  const hover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;
  const pick = hot ? items.find((x) => x.type === hot) : undefined;

  let off = 0;
  const segs = items.filter((x) => x.count > 0).map((x) => {
    const len = (x.count / total) * C;
    const seg = { ...x, len, off };
    off += len;
    return seg;
  });
  const bind = (ty: WorkType) => ({
    onMouseEnter: hover ? () => setHot(ty) : undefined,
    onMouseLeave: hover ? () => setHot(null) : undefined,
    onClick: () => setHot(hot === ty ? null : ty),
  });

  return (
    <div className={`typedonut${hot ? ' typedonut--hot' : ''}`}>
      <svg viewBox="-80 -80 160 160" role="img" aria-label={t('งานที่กำลังทำ')}>
        <circle className="typedonut__track" r={R} />
        <g transform="rotate(-90)">
          {segs.map((s) => (
            <circle
              key={s.type}
              r={R}
              className={`typedonut__seg${hot === s.type ? ' typedonut__seg--on' : ''}`}
              stroke={typeMeta(s.type).color}
              strokeDasharray={`${drawn ? Math.max(0, s.len - (segs.length > 1 ? 2.5 : 0)) : 0} ${C}`}
              strokeDashoffset={-s.off}
              {...bind(s.type)}
            />
          ))}
        </g>
        <text className="typedonut__n" textAnchor="middle" y={8}>{pick ? pick.count : total}</text>
        <text className="typedonut__sub" textAnchor="middle" y={26}>{pick ? typeChipLabel(pick.type) : t('งานที่กำลังทำ')}</text>
      </svg>
      <div className="typedonut__side">
      <div className="typedonut__legend">
        {items.filter((x) => x.count > 0).map((x) => (
          <button key={x.type} aria-pressed={hot === x.type} {...bind(x.type)} onFocus={() => setHot(x.type)} onBlur={() => setHot(null)}>
            <i style={{ background: typeMeta(x.type).color }} />
            {typeChipLabel(x.type)}
          </button>
        ))}
      </div>
      {foot && <small className="typedonut__foot">{foot}</small>}
      </div>
    </div>
  );
}
