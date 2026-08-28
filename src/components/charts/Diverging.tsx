import { useState } from 'react';
import type { ProfileAxis } from '../../domain/analytics';
import { t } from '../../lib/i18n';

/**
 * แท่งสองทาง — ตอบคำถาม "กลุ่มนี้ต่างจากค่าเฉลี่ยด้านไหนบ้าง" ในภาพเดียว
 * ขวา = สูงกว่าค่าเฉลี่ย · ซ้าย = ต่ำกว่า · เส้นกลางคือค่าเฉลี่ย (จุดที่แปลว่า "ไม่ต่าง")
 */
export function DivergingBars({
  axes,
  reference,
  label,
  referenceLabel,
}: {
  axes: ProfileAxis[];
  reference: ProfileAxis[];
  label: string;
  referenceLabel: string;
}) {
  const [asTable, setAsTable] = useState(false);

  const rows = axes.map((a, i) => ({
    ...a,
    ref: reference[i]?.value ?? 0,
    delta: a.value - (reference[i]?.value ?? 0),
  }));
  // สเกลพอดีข้อมูล (ขั้นต่ำ 6) — ค่าต่างเล็กๆ จะยังเห็นเป็นแท่ง ไม่ใช่ขีดจิ๋ว
  const span = Math.max(6, ...rows.map((r) => Math.abs(r.delta)));

  return (
    <div>
      <div className="dvg">
        {rows.map((r) => {
          const width = (Math.abs(r.delta) / span) * 50;
          const above = r.delta >= 0;
          return (
            <div className="dvg__row" key={r.key} title={`${r.label}: ${r.value}% · ${referenceLabel} ${r.ref}%`}>
              <span className="dvg__label">{r.label}</span>
              <span className="dvg__track">
                <i className="dvg__zero" />
                <i
                  className="dvg__bar"
                  style={{
                    left: above ? '50%' : `${50 - width}%`,
                    width: `${Math.max(width, r.delta === 0 ? 0 : 0.6)}%`,
                    background: above ? 'var(--accent)' : '#E9553F',
                    borderRadius: above ? '0 4px 4px 0' : '4px 0 0 4px',
                  }}
                />
              </span>
              <span className="dvg__value" style={{ color: above ? 'var(--accent)' : '#B42318' }}>
                {r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}
                {Math.abs(r.delta)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="chartlegend" style={{ justifyContent: 'flex-end' }}>
        <button onClick={() => setAsTable(!asTable)}>{asTable ? t('ซ่อนตาราง') : t('ดูเป็นตาราง')}</button>
      </div>

      {asTable && (
        <table className="tbl" style={{ marginTop: 4 }}>
          <thead>
            <tr>
              <th>{t('ด้าน')}</th>
              <th style={{ width: 90 }}>{label}</th>
              <th style={{ width: 96 }}>{referenceLabel}</th>
              <th style={{ width: 62 }}>{t('ต่างกัน')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ font: '500 11.5px var(--font-body)' }}>{r.label}</td>
                <td className="mono">{r.value}%</td>
                <td className="mono faint">{r.ref}%</td>
                <td className="mono" style={{ color: r.delta >= 0 ? 'var(--accent)' : '#B42318' }}>
                  {r.delta > 0 ? '+' : ''}{r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
