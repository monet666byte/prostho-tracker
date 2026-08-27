import { useState } from 'react';
import type { HeatRow } from '../../domain/analytics';

/**
 * ตารางรายคน × ด้านเกณฑ์ — แบบ "ช่องนับชิ้น" (ผู้ใช้เคาะแล้ว 27 ส.ค. หลังลองเทียบกับวงกลมรวมและแท่ง)
 *  - เป้าเป็นหน่วยเล็ก (1–3 ชิ้น) → วาดเป็นวงตามจำนวนจริง: ทึบ = จบแล้ว · เติมวนตาม step = กำลังทำ · ว่าง = ยังไม่เริ่ม
 *  - ช่องที่เป้าเป็นเลขใหญ่ (lab ทำเอง) ใช้แท่ง+ตัวเลขเสมอ เพราะนับวงไม่ไหว
 */
const parse = (detail: string): [number, number] | null => {
  const m = detail.match(/^(\d+)\s*\/\s*(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

const PARTIAL = '#6E93F2';

/** แท่งเล็ก + ตัวเลข — สำหรับช่องเป้าใหญ่ (lab ทำเอง) */
function MiniBar({ value, detail }: { value: number; detail: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 44, height: 6, borderRadius: 3, background: 'var(--fill)', overflow: 'hidden', display: 'inline-block' }}>
        <i style={{ display: 'block', height: '100%', width: `${value}%`, background: value >= 100 ? 'var(--accent)' : PARTIAL, borderRadius: 3 }} />
      </span>
      <span className="mono" style={{ font: '400 10px var(--font-mono)', color: 'var(--text-faint)' }}>{detail}</span>
    </span>
  );
}

export function Heatmap({ rows }: { rows: HeatRow[] }) {
  const [asTable, setAsTable] = useState(false);
  const columns = rows[0]?.cells ?? [];

  const cell = (c: HeatRow['cells'][number], studentName: string) => {
    const title = `${studentName} · ${c.label}: ${c.detail} (${c.value}%)`;
    const p = parse(c.detail);

    if (!p || p[1] > 6 || c.key === 'self') {
      return <span title={title}><MiniBar value={c.value} detail={c.detail} /></span>;
    }

    const [done, need] = p;
    const full = done >= need;
    const partials = c.partials ?? [];
    const slotTitle = partials.length ? `${title} · กำลังทำอีก ${partials.length} งาน` : title;
    return (
      <span title={slotTitle} style={{ display: 'inline-flex', alignItems: 'center', gap: 3.5 }}>
        {Array.from({ length: need }, (_, i) => {
          // ช่องที่เกินจำนวนที่จบแล้ว: ถ้ามีงานกำลังทำ เติมสีวนรอบศูนย์กลางตามความคืบหน้า step
          const partial = i >= done ? partials[i - done] : undefined;
          const partialPct = partial ? Math.round(partial * 100) : 0;
          return (
            <i
              key={i}
              style={{
                width: 13, height: 13, borderRadius: '50%', display: 'inline-block',
                background: i < done
                  ? (full ? 'var(--accent)' : PARTIAL)
                  : partialPct > 0
                    ? `conic-gradient(${PARTIAL} ${partialPct}%, var(--fill) 0)`
                    : 'var(--fill)',
                border: i < done ? 'none' : '1px solid var(--border)',
                boxSizing: 'border-box',
              }}
            />
          );
        })}
        {full && <b style={{ font: '700 10px var(--font-body)', color: 'var(--accent)', marginLeft: 1 }}>✓</b>}
      </span>
    );
  };

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table className="heat">
          <thead>
            <tr>
              <th />
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.student.id}>
                <th scope="row">
                  {r.student.name}
                  <span className="mono">{r.student.code}</span>
                </th>
                {r.cells.map((c) => (
                  <td key={c.key}>{cell(c, r.student.name)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="chartlegend">
        <span><i style={{ background: 'var(--accent)', borderRadius: '50%' }} /> 1 วง = 1 ชิ้นตามเป้า · ครบ ✓</span>
        <span><i style={{ background: `conic-gradient(${PARTIAL} 60%, var(--fill) 0)`, borderRadius: '50%' }} /> กำลังทำ (วนตาม step)</span>
        <span><i style={{ background: 'var(--fill)', borderRadius: '50%' }} /> ยังไม่เริ่ม</span>
        <button onClick={() => setAsTable(!asTable)}>{asTable ? 'ซ่อนตัวเลข' : 'ดูตัวเลข'}</button>
      </div>

      {asTable && (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 2 }}>
            <thead>
              <tr>
                <th>นักศึกษา</th>
                {columns.map((c) => (
                  <th key={c.key} style={{ width: 76 }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student.id}>
                  <td style={{ font: '600 11.5px var(--font-body)' }}>{r.student.name}</td>
                  {r.cells.map((c) => (
                    <td key={c.key} className="mono" style={{ color: c.value >= 100 ? 'var(--success)' : undefined }}>
                      {c.detail}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
