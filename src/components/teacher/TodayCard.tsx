import { Check, Clock, PencilSimple, Warning } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { TodaySummary } from '../../domain/today';
import { t } from '../../lib/i18n';

export interface TodayLine {
  key: string;
  tone: 'do' | 'warn' | 'good';
  icon: 'eval' | 'warn' | 'stale' | 'good';
  text: ReactNode;
  go?: { label: string; onClick: () => void };
}

const ICONS = { eval: PencilSimple, warn: Warning, stale: Clock, good: Check } as const;

/**
 * กล่อง "สรุปวันนี้" หน้าภาพรวมอาจารย์ (ผู้ใช้เลือก mock 15 ก.ย. 69)
 * ขอบรุ้งแบบ Siri หมุนช้าๆ เฉพาะตอนมีเรื่องต้องทำ/ต้องดู · ไม่มีอะไรน่าห่วง = ขอบนิ่ง
 * ไอคอนแบบ 3 (วงกลมสีอ่อน) — สีบอกความหมาย ฟ้า = ต้องทำ · ส้ม = ต้องดู · เขียว = ข่าวดี
 */
export function TodayCard({ scope, summary, lines }: { scope: string; summary: TodaySummary; lines: TodayLine[] }) {
  return (
    <section className={`panel todaycard${summary.needsAttention ? ' todaycard--live' : ''}`} aria-label={t('สรุปวันนี้')}>
      <h3 className="todaycard__head">
        <span className="todaycard__orb" aria-hidden />
        {t('สรุปวันนี้')} · {scope}
      </h3>
      {lines.map((l) => {
        const Icon = ICONS[l.icon];
        const inner = (
          <>
            <span className={`todaycard__ic todaycard__ic--${l.tone}`} aria-hidden><Icon size={15} weight="bold" /></span>
            <span className="todaycard__text">{l.text}</span>
            {l.go && <span className="todaycard__go">{l.go.label} ›</span>}
          </>
        );
        return l.go
          ? <button key={l.key} className="todaycard__line" onClick={l.go.onClick}>{inner}</button>
          : <div key={l.key} className="todaycard__line todaycard__line--still">{inner}</div>;
      })}
    </section>
  );
}
