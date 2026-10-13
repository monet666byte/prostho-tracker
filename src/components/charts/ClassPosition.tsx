import { useEffect, useRef, useState } from 'react';
import type { PositionPoint } from '../../domain/analytics';
import { groupShort } from '../../domain/group';
import { personName, t } from '../../lib/i18n';

const pct = (x: number) => Math.round(x * 100);

/**
 * นักศึกษาอยู่ตรงไหนของชั้นปี — สองหน้าตาตามจำนวนคนที่มีข้อมูล (domain: classPosition)
 *   curve = false  ทีละแถว ชื่อ + จุด (ช่วงนำร่องที่มีแค่บางกลุ่ม · คนน้อยจนโค้งไม่มีความหมาย)
 *   curve = true   โค้งจากข้อมูลจริง (ไม่ใช่สูตรค่าเฉลี่ย + SD) + จุดเฉพาะกลุ่มของฉัน
 * ทั้งสองแบบมีเส้นประ "เป้าตอนนี้" — ให้อ่านเทียบกับเกณฑ์ ไม่ใช่เทียบกับเพื่อนอย่างเดียว
 */
export function ClassPosition({
  points, expected, curve, myGroup,
}: {
  points: PositionPoint[];
  expected: number | null;
  curve: boolean;
  myGroup?: string | null;
}) {
  return curve
    ? <CurveView points={points} expected={expected} myGroup={myGroup} />
    : <RowsView points={points} expected={expected} myGroup={myGroup} />;
}

function tip(p: PositionPoint) {
  return `${personName(p.student)} · ${groupShort(p.student.group)} — ${pct(p.share)}% · ${t('จบแล้ว {d}/{n} ช่อง', { d: p.done, n: p.total })}`;
}

function RowsView({ points, expected, myGroup }: { points: PositionPoint[]; expected: number | null; myGroup?: string | null }) {
  return (
    <div className="cpos-rows" role="list">
      {expected !== null && (
        <div className="cpos-row cpos-row--head" aria-hidden>
          <span />
          <span className="cpos-track">
            <span className="cpos-goal-label" style={{ left: `${pct(expected)}%` }}>
              {t('เป้าตอนนี้ ~{n}%', { n: pct(expected) })}
            </span>
          </span>
          <span />
        </div>
      )}
      {points.map((p) => (
        <div className="cpos-row" role="listitem" key={p.student.id} title={tip(p)}>
          <span className="cpos-name">
            <b>{personName(p.student)}</b>
            <span>{groupShort(p.student.group)}</span>
          </span>
          <span className="cpos-track">
            <i className="cpos-rule" />
            {expected !== null && <i className="cpos-goal" style={{ left: `${pct(expected)}%` }} />}
            <i
              className="cpos-dot"
              data-mine={!myGroup || p.student.group === myGroup}
              style={{ left: `${p.share * 100}%` }}
            />
          </span>
          <span className="cpos-val mono" data-behind={p.behind}>{pct(p.share)}%</span>
        </div>
      ))}
      <div className="cpos-row cpos-row--axis" aria-hidden>
        <span />
        <span className="cpos-track">
          {[0, 50, 100].map((v) => <span key={v} style={{ left: `${v}%` }}>{v}%</span>)}
        </span>
        <span />
      </div>
    </div>
  );
}

const H = 210;
const PAD = { l: 14, r: 14, t: 28, b: 30 };

/** วาดเท่าความกว้างจริงของกล่อง — viewBox ตายตัวทำให้ตัวหนังสือในกราฟโตตามจอกว้าง */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function CurveView({ points, expected, myGroup }: { points: PositionPoint[]; expected: number | null; myGroup?: string | null }) {
  const [box, W] = useWidth(640);
  const vals = points.map((p) => p.share);
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  // ความกว้างหน้าต่างแบบ Silverman · ขั้นต่ำ 0.04 กันโค้งเป็นหนามเมื่อทุกคนค่าเดียวกัน
  const bw = Math.max(0.04, 1.06 * sd * Math.pow(n, -0.2));
  const dens = (x: number) => vals.reduce((a, v) => a + Math.exp(-0.5 * ((x - v) / bw) ** 2), 0);
  const xs = Array.from({ length: 121 }, (_, i) => i / 120);
  const peak = Math.max(...xs.map(dens)) || 1;
  const y0 = H - PAD.b;
  const plotH = y0 - PAD.t;
  const X = (v: number) => PAD.l + v * (W - PAD.l - PAD.r);
  const Y = (v: number) => y0 - (dens(v) / peak) * plotH * 0.9;
  const line = xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(x).toFixed(1)}`).join('');
  const mine = myGroup ? points.filter((p) => p.student.group === myGroup) : [];

  return (
    <div ref={box}>
    <svg className="cpos-curve" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t('การกระจายตัวของนักศึกษาทั้งชั้นปี')}>
      <path d={`${line}L${X(1)} ${y0}L${X(0)} ${y0}Z`} fill="var(--accent)" fillOpacity={0.08} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {expected !== null && (
        <g>
          <line x1={X(expected)} x2={X(expected)} y1={PAD.t - 6} y2={y0} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text
            x={X(expected)}
            y={PAD.t - 11}
            textAnchor={expected > 0.85 ? 'end' : expected < 0.15 ? 'start' : 'middle'}
            className="cpos-svgtext"
          >
            {t('เป้าตอนนี้ ~{n}%', { n: pct(expected) })}
          </text>
        </g>
      )}
      {mine.map((p) => (
        <circle key={p.student.id} cx={X(p.share)} cy={Y(p.share)} r={5.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2}>
          <title>{tip(p)}</title>
        </circle>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <text key={v} x={X(v)} y={y0 + 17} textAnchor="middle" className="cpos-svgtext">{pct(v)}%</text>
      ))}
    </svg>
    </div>
  );
}
