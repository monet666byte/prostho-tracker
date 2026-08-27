import { useState } from 'react';
import type { BurnupPoint } from '../../domain/analytics';

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

  const maxY = Math.max(...points.map((p) => p.target), ...points.map((p) => p.actual ?? 0)) * 1.06;
  const x = (i: number) => padL + (i / (points.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / maxY) * plotH;

  const actualPts = points.map((p, i) => (p.actual === null ? null : `${x(i)},${y(p.actual)}`)).filter(Boolean);
  const targetPts = points.map((p, i) => `${x(i)},${y(p.target)}`);
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
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="ชิ้นงานที่จบสะสม เทียบเป้าหมาย">
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
        <span><i style={{ background: 'var(--accent)', height: 3, width: 16, borderRadius: 99 }} /> จบจริงสะสม</span>
        <span>
          <i style={{ background: 'transparent', borderTop: '2px dashed var(--text-disabled)', height: 0, width: 16 }} /> เป้าถ้าจะผ่านเกณฑ์รายปีทั้งชั้น
        </span>
        <span style={{ marginLeft: 'auto', minHeight: 16, color: 'var(--text-secondary)' }}>
          {hover !== null
            ? `${points[hover].label} · จบจริง ${points[hover].actual ?? '—'} · เป้า ${points[hover].target}`
            : behind > 0
              ? `ตอนนี้ตามหลังเป้าอยู่ ${behind} ชิ้น`
              : 'ตอนนี้นำหน้าเป้าอยู่'}
        </span>
      </div>
    </div>
  );
}
