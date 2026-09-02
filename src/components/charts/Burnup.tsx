import { useState } from 'react';
import type { BurnupPoint } from '../../domain/analytics';
import { t } from '../../lib/i18n';

/**
 * เส้นสะสม (burn-up) — เส้นทึบคือจบจริงสะสม เส้นประคือเป้าที่ควรจะเป็น
 * สองเส้นหน่วยเดียวกันบนแกนเดียว · ช่องว่างระหว่างเส้นคือ "ตามหลังอยู่เท่าไหร่" อ่านได้ทันที
 */
export function Burnup({ points, width = 640, height = 220 }: { points: BurnupPoint[]; width?: number; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const padL = 40;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  /* ⚠️ ทุกค่าเป็น 0 ได้จริง — เช่นดูรุ่นที่เรียนจบไปแล้ว ซึ่งไม่มีเคสจบในปีการศึกษาปัจจุบัน
     ถ้าไม่กัน maxY จะเป็น 0 แล้ว v/maxY = NaN ทำให้ทุกพิกัดในกราฟพัง (เห็นเป็น error ยาวใน console) */
  const maxY = Math.max(
    1,
    Math.max(...points.map((p) => p.target), ...points.map((p) => p.actual ?? 0), ...points.map((p) => p.lastYear ?? 0)) * 1.06,
  );
  // จุดเดียวก็หารศูนย์เหมือนกัน
  const x = (i: number) => padL + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => padT + plotH - (v / maxY) * plotH;

  const actualPts = points.map((p, i) => (p.actual === null ? null : `${x(i)},${y(p.actual)}`)).filter(Boolean);
  const targetPts = points.map((p, i) => `${x(i)},${y(p.target)}`);
  // เส้นปีที่แล้ว — มีเฉพาะเมื่อมีข้อมูลรุ่นก่อนในระบบ
  const hasLastYear = points.some((p) => p.lastYear !== null);
  const lastYearPts = hasLastYear ? points.map((p, i) => `${x(i)},${y(p.lastYear ?? 0)}`) : [];
  const lastActualIndex = points.reduce((acc, p, i) => (p.actual !== null ? i : acc), 0);
  const last = points[lastActualIndex];
  const behind = (last.target ?? 0) - (last.actual ?? 0);

  // เส้นกริดแนวนอน 4 เส้น ปัดเป็นเลขสวย
  const stepRaw = maxY / 4;
  const mag = 10 ** Math.floor(Math.log10(stepRaw));
  const step = Math.ceil(stepRaw / mag) * mag;
  const gridVals: number[] = [];
  for (let v = step; v < maxY; v += step) gridVals.push(v);

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('ชิ้นงานที่จบสะสม เทียบเป้าหมาย')}>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={width - padR} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 7} y={y(v)} textAnchor="end" dominantBaseline="middle" style={{ font: '400 9.5px var(--font-mono)', fill: 'var(--text-faint)' }}>
              {v}
            </text>
          </g>
        ))}
        <line x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} stroke="var(--border-2)" strokeWidth={1} />

        {/* เส้นเป้า — เส้นประ (เพราะเป็น projection ไม่ใช่ข้อมูลจริง) */}
        <polyline points={targetPts.join(' ')} fill="none" stroke="var(--text-disabled)" strokeWidth={1.5} strokeDasharray="5 4" />

        {/* เส้นปีที่แล้ว — เทียบจังหวะกับรุ่นก่อน (ปรับสเกลตามจำนวนคนแล้ว) */}
        {hasLastYear && (
          <polyline points={lastYearPts.join(' ')} fill="none" stroke="var(--self)" strokeWidth={1.5} strokeDasharray="2 3" opacity={0.75} />
        )}

        {/* เส้นจริง */}
        <polyline points={actualPts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* จุด + hit area */}
        {points.map((p, i) => (
          <g key={i}>
            {p.actual !== null && (
              <circle cx={x(i)} cy={y(p.actual)} r={hover === i ? 5.5 : i === lastActualIndex ? 4.5 : 3} fill="var(--accent)" stroke="#fff" strokeWidth={2} />
            )}
            <rect
              x={x(i) - plotW / points.length / 2}
              y={padT}
              width={plotW / points.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            <text x={x(i)} y={height - 8} textAnchor="middle" style={{ font: `${hover === i ? 600 : 400} 9.5px var(--font-body)`, fill: hover === i ? 'var(--accent)' : 'var(--text-faint)' }}>
              {p.label}
            </text>
          </g>
        ))}

        {/* direct label ที่ปลายเส้นจริง — จุดเดียวที่สำคัญ */}
        {last.actual !== null && (
          <text
            x={x(lastActualIndex) + 8}
            y={y(last.actual) - 8}
            style={{ font: '600 10.5px var(--font-mono)', fill: 'var(--accent)' }}
          >
            {last.actual}
          </text>
        )}
      </svg>

      <div className="chartlegend">
        <span><i style={{ background: 'var(--accent)', height: 3, width: 16, borderRadius: 99 }} /> {t('จบจริงสะสม')}</span>
        <span>
          <i style={{ background: 'transparent', borderTop: '2px dashed var(--text-disabled)', height: 0, width: 16 }} /> {t('เป้าถ้าจะผ่านเกณฑ์รายปีทั้งชั้น')}
        </span>
        {hasLastYear && (
          <span>
            <i style={{ background: 'transparent', borderTop: '2px dotted var(--self)', height: 0, width: 16 }} /> {t('รุ่นก่อน ณ เดือนเดียวกัน')}
          </span>
        )}
        <span style={{ marginLeft: 'auto', minHeight: 16, color: 'var(--text-secondary)' }}>
          {hover !== null
            ? `${points[hover].label} · ${t('จบจริง')} ${points[hover].actual ?? '—'} · ${t('เป้า')} ${points[hover].target}${points[hover].lastYear !== null ? ` · ${t('รุ่นก่อน')} ${points[hover].lastYear}` : ''}`
            : behind > 0
              ? t('ตอนนี้ตามหลังเป้าอยู่ {n} ชิ้น', { n: behind })
              : t('ตอนนี้นำหน้าเป้าอยู่')}
        </span>
      </div>
    </div>
  );
}
