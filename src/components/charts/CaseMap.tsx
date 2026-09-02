import { useState } from 'react';
import { ORDER, TYPES, typesPresent } from '../../domain/catalog';
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

export function CaseMap({ dots, staleDays, onStepClick, activeStep, showTypeLegend = true, stepNames }: {
  dots: CaseDot[];
  staleDays: number;
  /** ปิดเมื่อหน้าแม่มี legend สีอยู่แล้ว (เช่นปุ่มประเภทที่มีจุดสี+จำนวน) */
  showTypeLegend?: boolean;
  /** ชื่อ step จริงใต้เลขแต่ละคอลัมน์ — ใช้เมื่อกรองเหลือประเภทเดียว (ชื่อถึงจะตรง) */
  stepNames?: string[];
  /** ถ้าส่งมา: เลขแกนใต้กราฟกดได้ (เปิดรายละเอียดขั้นตอนของ step นั้น) */
  onStepClick?: (n: number) => void;
  activeStep?: number | null;
}) {
  const [hover, setHover] = useState<CaseDot | null>(null);

  // เรียงสีให้เกาะกลุ่มกันในแต่ละกอง (ตามลำดับประเภทงาน) และดันตัวค้างขึ้นบนสุดของกลุ่มตัวเอง
  const columns = Array.from({ length: 11 }, (_, i) => ({
    progression: i,
    items: dots
      .filter((d) => d.progression === i)
      .sort((a, b) => {
        if (ORDER[a.type] !== ORDER[b.type]) return ORDER[a.type] - ORDER[b.type];
        return Number(a.stale) - Number(b.stale);
      }),
  }));
  const tallest = Math.max(1, ...columns.map((c) => c.items.length));

  return (
    <div>
      <div className="casemap" style={{ '--rows': Math.ceil(tallest / 5) } as never}>
        {columns.map((col) => (
          <div className="casemap__col" key={col.progression}>
            <span className="casemap__count">{col.items.length || ''}</span>
            <span className="casemap__dots">
              {col.items.map((d) => (
                <i
                  key={d.id}
                  data-stale={d.stale}
                  data-on={hover?.id === d.id}
                  style={{ background: TYPES[d.type].color }}
                  title={d.label}
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </span>
            {onStepClick ? (
              <button
                className="casemap__step"
                data-on={activeStep === col.progression}
                onClick={() => onStepClick(col.progression)}
                title={`ดูขั้นตอนใน step ${col.progression}`}
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

      <div className="chartlegend">
        {showTypeLegend && typesPresent(dots).map((t) => (
          <span key={t}><i style={{ background: TYPES[t].color, borderRadius: 99 }} /> {TYPES[t].short}</span>
        ))}
        <span><i style={{ background: '#fff', border: '1.5px solid var(--danger-chart)', borderRadius: 99 }} /> {t('ค้างเกิน {n} วัน', { n: staleDays })}</span>
        <span style={{ marginLeft: 'auto', minHeight: 16, color: 'var(--text-secondary)' }}>
          {hover ? tText(hover.label) : t('{n} ชิ้นงาน · ชี้ที่จุดเพื่อดูว่าเป็นเคสของใคร', { n: dots.length })}
        </span>
      </div>
    </div>
  );
}
