import { useRef, useState } from 'react';
import { orderOf, typeChipLabel, typeMeta, typesPresent } from '../../domain/catalog';
import type { CaseDot } from '../../domain/analytics';
import { t, tText } from '../../lib/i18n';

/**
 * แผนที่เคส — หนึ่งจุดคือชิ้นงานจริงหนึ่งชิ้น เรียงเป็นคอลัมน์ตาม step ที่ทำถึง
 *
 * เลือกแบบนี้แทนกราฟแท่ง เพราะจำนวนเคสของจริงนับเป็นหน่วยได้
 * ไม่ต้องเฉลี่ยหรือปัดเป็น % — เห็นกองงานตรงคอขวดเป็นตัวเคสเลย
 */
/** ย่อชื่อ step ให้พอดีใต้แกน — ตัดท่อนขยายในวงเล็บ/หลัง : แล้วเหลือ ~3 คำแรก (ชื่อเต็มดูได้ตอนกดเลข) */
const STOP_TAIL = new Set(['and', 'or', 'and/or', 'for', 'of', 'the', '&']);
function shortStep(name: string): string {
  const head = name.split(/[:(]/)[0].trim();
  if (head.length <= 26) return head;
  const words = head.split(/\s+/).slice(0, 3);
  while (words.length && STOP_TAIL.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(' ');
}

export function CaseMap({ dots, staleDays, onStepClick, activeStep, showTypeLegend = true, showStaleLegend = true, stepNames, lively = false }: {
  dots: CaseDot[];
  staleDays: number;
  /** ปิดเมื่อหน้าแม่มี legend สีอยู่แล้ว (เช่นปุ่มประเภทที่มีจุดสี+จำนวน) */
  showTypeLegend?: boolean;
  /** ปิดเมื่อหน้าแม่บอก "วงแดง = ค้าง" ไว้ในคำอธิบายหัวกราฟแล้ว */
  showStaleLegend?: boolean;
  /** ชื่อ step จริงใต้เลขแต่ละคอลัมน์ — ใช้เมื่อกรองเหลือประเภทเดียว (ชื่อถึงจะตรง) */
  stepNames?: string[];
  /** ถ้าส่งมา: เลขแกนใต้กราฟกดได้ (เปิดรายละเอียดขั้นตอนของ step นั้น) */
  onStepClick?: (n: number) => void;
  activeStep?: number | null;
  /** หน้าวิเคราะห์: จุดเด้งขึ้นไล่ทีละคอลัมน์ตอนเปิด · ชี้คอลัมน์แล้วคอลัมน์อื่นจาง + การ์ดสรุป */
  lively?: boolean;
}) {
  const [hover, setHover] = useState<CaseDot | null>(null);
  const [colPeek, setColPeek] = useState<{ n: number; x: number; y: number; ax: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;
  const peekCol = (n: number, el: HTMLElement | null) => {
    const wrap = wrapRef.current;
    if (!lively || !canHover || !wrap || !el) return;
    const wb = wrap.getBoundingClientRect();
    const cb = el.getBoundingClientRect();
    const W = 200;
    const want = cb.left - wb.left + cb.width / 2 - W / 2;
    const x = Math.max(0, Math.min(wb.width - W, want));
    setColPeek({ n, x, y: cb.top - wb.top - 8, ax: W / 2 + (want - x) });
  };

  // เรียงสีให้เกาะกลุ่มกันในแต่ละกอง (ตามลำดับประเภทงาน) และดันตัวค้างขึ้นบนสุดของกลุ่มตัวเอง
  const columns = Array.from({ length: 11 }, (_, i) => ({
    progression: i,
    items: dots
      .filter((d) => d.progression === i)
      .sort((a, b) => {
        if (orderOf(a.type) !== orderOf(b.type)) return orderOf(a.type) - orderOf(b.type);
        return Number(a.stale) - Number(b.stale);
      }),
  }));
  const tallest = Math.max(1, ...columns.map((c) => c.items.length));

  return (
    <div ref={wrapRef} className={lively ? 'casemap-wrap casemap-wrap--lively' : undefined} onMouseLeave={() => setColPeek(null)}>
      <div className={`casemap${colPeek ? ' casemap--peek' : ''}`} style={{ '--rows': Math.ceil(tallest / 5) } as never}>
        {columns.map((col) => (
          <div
            className="casemap__col"
            key={col.progression}
            data-focus={colPeek?.n === col.progression}
            onMouseEnter={(e) => peekCol(col.progression, e.currentTarget.querySelector<HTMLElement>('.casemap__dots'))}
            onClick={lively && onStepClick ? () => onStepClick(col.progression) : undefined}
          >
            <span className="casemap__count">{col.items.length || ''}</span>
            <span className="casemap__dots">
              {col.items.map((d) => (
                <i
                  key={d.id}
                  data-stale={d.stale}
                  data-on={hover?.id === d.id}
                  style={{ background: typeMeta(d.type).color }}
                  title={d.label}
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </span>
            {onStepClick ? (
              <button
                className="casemap__step"
                data-on={activeStep === col.progression || colPeek?.n === col.progression}
                onClick={(e) => { e.stopPropagation(); onStepClick(col.progression); }}
                title={t('ดูขั้นตอนใน step {n}', { n: col.progression })}
                style={{ cursor: 'pointer' }}
              >
                {col.progression}
              </button>
            ) : (
              <span className="casemap__step">{col.progression}</span>
            )}
            {stepNames && <span className="casemap__name">{shortStep(stepNames[col.progression] ?? '')}</span>}
          </div>
        ))}
      </div>

      {colPeek && (() => {
        const items = columns[colPeek.n]?.items ?? [];
        const byType = typesPresent(items).map((ty) => ({ ty, n: items.filter((d) => d.type === ty).length }));
        const stale = items.filter((d) => d.stale).length;
        return (
          <div className="casemap__card" role="tooltip" style={{ left: colPeek.x, top: colPeek.y, '--ax': `${colPeek.ax}px` } as React.CSSProperties}>
            <b>Step {colPeek.n} · {t('{n} ชิ้น', { n: items.length })}</b>
            {stale > 0 && <small className="casemap__cardwarn">{t('ค้างเกิน {d} วัน {n} ชิ้น', { d: staleDays, n: stale })}</small>}
            {byType.map(({ ty, n }) => (
              <span className="casemap__cardrow" key={ty}>
                <span style={{ color: '#c8d4ff' }}>{typeChipLabel(ty)}</span>
                <span className="casemap__cardtr"><i style={{ width: `${items.length ? Math.round((n / items.length) * 100) : 0}%`, background: typeMeta(ty).color }} /></span>
                <span className="casemap__cardn">{n}</span>
              </span>
            ))}
            {onStepClick && items.length > 0 && <small className="casemap__cardgo">{t('กดเพื่อดูขั้นตอน')} ›</small>}
          </div>
        );
      })()}

      <div className="chartlegend">
        {showTypeLegend && typesPresent(dots).map((t) => (
          <span key={t}><i style={{ background: typeMeta(t).color, borderRadius: 99 }} /> {typeChipLabel(t)}</span>
        ))}
        {showStaleLegend && <span><i style={{ background: '#fff', border: '1.5px solid var(--danger-chart)', borderRadius: 99 }} /> {t('ค้างเกิน {n} วัน', { n: staleDays })}</span>}
        <span style={{ marginLeft: 'auto', minHeight: 16, color: 'var(--text-secondary)' }}>
          {hover ? tText(hover.label) : t('{n} ชิ้นงาน · ชี้ที่จุดเพื่อดูว่าเป็นเคสของใคร', { n: dots.length })}
        </span>
      </div>
    </div>
  );
}
