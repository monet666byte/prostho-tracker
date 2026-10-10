import { ArrowsClockwise, Check, Clock, CloudSlash, PencilSimple, Warning } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { TodaySummary } from '../../domain/today';
import { lang, t } from '../../lib/i18n';

export interface TodayLine {
  key: string;
  tone: 'do' | 'warn' | 'good';
  icon: 'eval' | 'warn' | 'stale' | 'good' | 'sync' | 'offline';
  text: ReactNode;
  go?: { label: string; onClick: () => void };
  /** รายคนใต้บรรทัด (ชื่อ + ปุ่มทำงานนั้นได้เลย) — ไม่มี = บรรทัดเดียวแบบเดิม */
  items?: ReactNode;
}

const ICONS = { eval: PencilSimple, warn: Warning, stale: Clock, good: Check, sync: ArrowsClockwise, offline: CloudSlash } as const;

/** "สวัสดีตอนเช้า" ก่อนเที่ยง · หลังเที่ยง "สวัสดีวันศุกร์" */
export function greeting(now = new Date()): string {
  if (now.getHours() < 12) return t('สวัสดีตอนเช้า');
  const day = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'th-TH', { weekday: 'long' }).format(now);
  return t('สวัสดี{d}', { d: day });
}

/** บรรทัดในกล่องสรุปวันนี้ — ใช้ซ้ำในกล่อง "ต้องดูในชั้นปี" ของโซนทั้งชั้นปี */
export function TodayLines({ lines }: { lines: TodayLine[] }) {
  return (
    <>
      {lines.map((l) => {
        const Icon = ICONS[l.icon];
        const inner = (
          <>
            <span className={`todaycard__ic todaycard__ic--${l.tone}`} aria-hidden><Icon size={15} weight="bold" /></span>
            <span className="todaycard__text">{l.text}</span>
            {l.go && <span className="todaycard__go">{l.go.label} ›</span>}
          </>
        );
        const line = l.go
          ? <button className="todaycard__line" onClick={l.go.onClick}>{inner}</button>
          : <div className="todaycard__line todaycard__line--still">{inner}</div>;
        return (
          <div key={l.key} className={l.items ? 'todaycard__group' : undefined}>
            {line}
            {l.items && <div className="todaycard__kids">{l.items}</div>}
          </div>
        );
      })}
    </>
  );
}

/**
 * กล่อง "สรุปวันนี้" หน้าแรกอาจารย์ (อยู่ในโซนกลุ่ม · นับเฉพาะกลุ่มนั้น)
 * ขอบรุ้งแบบ Siri หมุนช้าๆ เฉพาะตอนมีเรื่องต้องทำ/ต้องดู · ไม่มีอะไรน่าห่วง = ขอบนิ่ง
 * ไอคอนแบบ 3 (วงกลมสีอ่อน) — สีบอกความหมาย ฟ้า = ต้องทำ · ส้ม = ต้องดู · เขียว = ข่าวดี
 */
export function TodayCard({ name, summary, lines }: { name: string; summary: TodaySummary; lines: TodayLine[] }) {
  return (
    <section className={`panel todaycard${summary.needsAttention ? ' todaycard--live' : ''}`} aria-label={t('สรุปวันนี้')}>
      <div className="todaycard__top">
        <h3 className="todaycard__head">
          <span className="todaycard__orb" aria-hidden />
          <span>{greeting()}{name && ` ${name}`}</span>
        </h3>
      </div>
      <TodayLines lines={lines} />
    </section>
  );
}
