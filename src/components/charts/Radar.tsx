import { useId, useState } from 'react';
import type { ProfileAxis } from '../../domain/analytics';
import { t } from '../../lib/i18n';

/**
 * กราฟแมงมุม — ใช้กับ "คะแนนประเมินรายคาบ 8 หัวข้อ" (หน้าประเมินรายคาบ)
 * เหมาะเพราะแกนเป็นหน่วยเดียวกัน (คะแนนเฉลี่ย 0–3 แปลงเป็น %) ค่าเฉลี่ยหลายคาบทำให้รูปต่อเนื่องจริง
 * (เคยถอดจากหน้าเกณฑ์เคส เพราะค่าที่นั่นกระโดด 0/50/100 — เหตุผลยังถูกต้อง อย่าเอากลับไปใช้ที่นั่น)
 * ชุดหลักใช้สีเน้น ชุดอ้างอิงใช้สีเทา (รูปแบบ emphasis ไม่ใช่หลายสีแข่งกัน)
 */
export function Radar({
  axes,
  reference,
  label,
  referenceLabel,
  size = 260,
  onAxisClick,
  activeKey,
  floor = 0,
}: {
  axes: ProfileAxis[];
  reference?: ProfileAxis[];
  label: string;
  referenceLabel?: string;
  size?: number;
  /** ถ้าส่งมา: กดจุด/ชื่อหัวข้อได้ (ใช้เปิดกราฟรายหัวข้อ) */
  onAxisClick?: (key: string) => void;
  activeKey?: string | null;
  /** % ที่ใจกลางวง (ตัดฐานสเกล) — ใช้เมื่อข้อมูลกระจุกช่วงบน เช่นคะแนน 0/1/3 ที่เฉลี่ยแล้วเกาะ 2–3 */
  floor?: number;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  // svg กว้างกว่า size เพื่อให้ป้ายแกนซ้าย-ขวาไม่โดนตัด ไม่ว่าตัวหนังสือจะใหญ่แค่ไหน
  const PAD_X = 52;
  const W = size + PAD_X * 2;
  const cx = W / 2;
  const cy = size / 2;
  const r = size / 2 - 30;
  const n = axes.length;

  const point = (index: number, value: number) => {
    const angle = (-90 + (360 / n) * index) * (Math.PI / 180);
    const f = Math.max(0, Math.min(1, (value - floor) / (100 - floor)));
    const d = f * r;
    return [cx + Math.cos(angle) * d, cy + Math.sin(angle) * d] as const;
  };
  // วงกริดตามสเกลจริง: floor 50 (คะแนน 1.5 กลางวง) → วงที่คะแนน 2, 2.5, 3
  const rings = floor > 0
    ? [floor + (100 - floor) / 3, floor + ((100 - floor) * 2) / 3, 100]
    : [50, 100];
  // ตำแหน่งป้ายชื่อแกน — อิงรัศมีตรงๆ (ไม่ผ่านสเกล floor ไม่งั้นป้ายโดน clamp มาติดขอบวง)
  const labelPoint = (index: number) => {
    const angle = (-90 + (360 / n) * index) * (Math.PI / 180);
    const d = 1.17 * r;
    return [cx + Math.cos(angle) * d, cy + Math.sin(angle) * d] as const;
  };

  const path = (list: ProfileAxis[]) =>
    list.map((a, i) => point(i, a.value).join(',')).join(' ');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={W} height={size} viewBox={`0 0 ${W} ${size}`} style={{ maxWidth: '100%' }} role="img" aria-labelledby={`${id}-t`}>
          <title id={`${id}-t`}>{label} — {t('โปรไฟล์ความคืบหน้า 6 ด้าน')}</title>

          {/* วงกริดแค่ 50 กับ 100 — น้อยเส้นเท่าที่ยังบอกสเกลได้ */}
          {rings.map((ring) => (
            <polygon
              key={ring}
              points={axes.map((_, i) => point(i, ring).join(',')).join(' ')}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {axes.map((_, i) => {
            const [x, y] = point(i, 100);
            return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />;
          })}

          {/* ชุดอ้างอิง — เงาเทาจางๆ ไม่มีเส้นขอบ จะได้ไม่แย่งสายตากับชุดหลัก */}
          {reference && <polygon points={path(reference)} fill="rgba(152,162,179,.16)" />}

          {/* ชุดหลัก */}
          <polygon points={path(axes)} fill="rgba(43,92,230,.11)" stroke="var(--accent)" strokeWidth={2} />

          {axes.map((a, i) => {
            const [x, y] = point(i, a.value);
            return (
              <circle
                key={a.key}
                cx={x}
                cy={y}
                r={hover === i ? 6 : 4.5}
                fill="var(--accent)"
                stroke="#fff"
                strokeWidth={2}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onAxisClick?.(a.key)}
                style={{ cursor: 'pointer' }}
              >
                <title>{`${a.label}: ${a.detail} (${a.value}%)`}</title>
              </circle>
            );
          })}

          {/* ป้ายแกนบรรทัดเดียว — ตัวเลขอยู่ใน tooltip กับตาราง ไม่ยัดลงรูป */}
          {axes.map((a, i) => {
            const [x, y] = labelPoint(i);
            const anchor = Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end';
            return (
              <text
                key={a.key}
                x={x}
                y={y}
                textAnchor={anchor}
                dominantBaseline="middle"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onAxisClick?.(a.key)}
                style={{
                  font: `${hover === i || activeKey === a.key ? 700 : 500} 10.5px var(--font-body)`,
                  fill: hover === i || activeKey === a.key ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: onAxisClick ? 'pointer' : undefined,
                  textDecoration: activeKey === a.key ? 'underline' : undefined,
                }}
              >
                {a.label}
              </text>
            );
          })}
        </svg>
      </div>

      <div style={{ textAlign: 'center', minHeight: 18, font: '500 11px var(--font-body)', color: 'var(--text-secondary)' }}>
        {hover !== null
          ? `${axes[hover].label} · ${axes[hover].detail} (${axes[hover].value}%)`
          : onAxisClick
            ? t('ชี้ที่จุดดูตัวเลข · กดหัวข้อเพื่อดูกราฟหัวข้อนั้น')
            : t('ชี้ที่จุดเพื่อดูตัวเลข')}
      </div>

      <div className="chartlegend">
        <span><i style={{ background: 'var(--accent)' }} /> {label}</span>
        {reference && <span><i style={{ background: '#98A2B3' }} /> {referenceLabel ?? t('ค่าเฉลี่ย')}</span>}
        <button onClick={() => setAsTable(!asTable)}>{asTable ? t('ซ่อนตาราง') : t('ดูเป็นตาราง')}</button>
      </div>

      {asTable && (
        <table className="tbl" style={{ marginTop: 4 }}>
          <thead>
            <tr>
              <th>{t('ด้าน')}</th>
              <th style={{ width: 92 }}>{label}</th>
              {reference && <th style={{ width: 92 }}>{referenceLabel ?? t('ค่าเฉลี่ย')}</th>}
            </tr>
          </thead>
          <tbody>
            {axes.map((a, i) => (
              <tr key={a.key}>
                <td style={{ font: '500 11.5px var(--font-body)' }}>{a.label}</td>
                <td className="mono">{a.detail}</td>
                {reference && <td className="mono faint">{reference[i].value}%</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
