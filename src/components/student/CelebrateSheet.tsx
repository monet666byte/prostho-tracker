import { Check } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import type { completionImpact } from '../../domain/rules';
import { t } from '../../lib/i18n';

/**
 * แผ่นฉลองตอนปิดเคส — เด้งหลังบันทึกขั้นสุดท้ายสำเร็จ (ออฟไลน์/รอส่ง ไม่เด้ง ใช้ toast เดิม)
 * บอกว่าเคสนี้ทำให้เกณฑ์ขยับเท่าไหร่ · ตัวเลขมาจาก completionImpact (domain/rules.ts) ชุดเดียวกับหน้าเกณฑ์
 * เก็บสถานะในไฟล์นี้เอง (ไม่แตะ store/app.ts) — ConfirmSheet เป็นคนเรียก celebrate()
 */
export interface Celebration {
  who: string;
  impact: ReturnType<typeof completionImpact>;
  /** settings.req.years — เกณฑ์สะสมกี่ปี */
  years: number;
}

let current: Celebration | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function celebrate(c: Celebration) { current = c; emit(); }
function close() { current = null; emit(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

// เศษกระดาษรอบวงติ๊ก — ตำแหน่งคงที่ (ไม่สุ่มทุกครั้งที่วาด)
const BITS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2;
  const d = 70 + (i % 3) * 16;
  return {
    x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d * 0.8), r: i * 37,
    round: i % 2 === 1, color: ['var(--panel-hi)', '#f2b661', '#8ee6c2', '#f49ac2', 'var(--panel)'][i % 5],
  };
});

export function CelebrateSheet() {
  const c = useSyncExternalStore(subscribe, () => current);
  const navigate = useNavigate();
  if (!c) return null;
  const { impact } = c;
  const row = impact.row;
  const months = Math.floor(impact.days / 30);
  const took = months > 0
    ? t('ใช้เวลา {m} เดือน {d} วัน', { m: months, d: impact.days - months * 30 })
    : t('ใช้เวลา {d} วัน', { d: impact.days });

  return (
    <div className="backdrop" onClick={close}>
      <div className="sheet celebrate" role="dialog" aria-modal="true" aria-labelledby="celebrate-title" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate__burst" aria-hidden>
          {BITS.map((b, i) => (
            <span
              key={i}
              className="celebrate__bit"
              style={{
                width: b.round ? 8 : 6, height: b.round ? 8 : 12, borderRadius: b.round ? '50%' : 2, background: b.color,
                '--x': `${b.x}px`, '--y': `${b.y}px`, '--r': `${b.r}deg`,
              } as React.CSSProperties}
            />
          ))}
          <span className="celebrate__badge"><Check size={42} weight="bold" /></span>
        </div>
        <h3 id="celebrate-title">{t('ปิดเคสแล้ว!')}</h3>
        <div className="celebrate__who">{c.who} · {took}</div>

        <div className="celebrate__box">
          {row && (
            <div>
              <div className="celebrate__row">
                <span style={{ fontWeight: 600 }}>{t('เกณฑ์')} {t(row.label)}</span>
                <b style={{ color: row.complete ? 'var(--success-dark)' : undefined }}>
                  {impact.rowBefore}/{row.required} → {row.done}/{row.required}{row.complete ? ' ✓' : ''}
                </b>
              </div>
              <div className="celebrate__segs" style={{ gridTemplateColumns: `repeat(${Math.max(1, row.required)}, minmax(0, 1fr))` }} aria-hidden>
                {Array.from({ length: row.required }, (_, i) => (
                  <i
                    key={i}
                    className={i >= impact.rowBefore && i < row.done ? 'is-new' : undefined}
                    style={i < row.done ? { background: row.color } : undefined}
                  />
                ))}
              </div>
              {row.complete && <div className="celebrate__done">{t('ครบเกณฑ์ {l} แล้ว', { l: t(row.short) })}</div>}
            </div>
          )}
          <div className="celebrate__row">
            <span>{t('เกณฑ์สะสม {y} ปี', { y: c.years })}</span>
            <b>{impact.totalsAfter.done} / {impact.totalsAfter.required}</b>
          </div>
          {impact.year && (
            <div className="celebrate__row">
              <span>{t('ปีการศึกษา')} {impact.year.year} ({t('รายปี')})</span>
              <b>{impact.year.done} / {impact.year.required}</b>
            </div>
          )}
        </div>

        <div className="celebrate__btns">
          <button className="btn btn--sec" onClick={() => { close(); navigate('/app/criteria'); }}>{t('ดูเกณฑ์')}</button>
          <button className="btn" onClick={close}>{t('เยี่ยมเลย')}</button>
        </div>
      </div>
    </div>
  );
}
