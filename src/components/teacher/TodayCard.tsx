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
}

export interface TodayScope {
  key: string;
  label: string;
  on: boolean;
  /** ไม่มี = ป้ายเฉยๆ (มีขอบเขตเดียว ไม่ต้องสลับ) */
  onPick?: () => void;
}

const ICONS = { eval: PencilSimple, warn: Warning, stale: Clock, good: Check, sync: ArrowsClockwise, offline: CloudSlash } as const;

/** "สวัสดีตอนเช้า" ก่อนเที่ยง · หลังเที่ยง "สวัสดีวันศุกร์" */
export function greeting(now = new Date()): string {
  if (now.getHours() < 12) return t('สวัสดีตอนเช้า');
  const day = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'th-TH', { weekday: 'long' }).format(now);
  return t('สวัสดี{d}', { d: day });
}

/**
 * กล่อง "สรุปวันนี้" หน้าภาพรวมอาจารย์
 * ขอบรุ้งแบบ Siri หมุนช้าๆ เฉพาะตอนมีเรื่องต้องทำ/ต้องดู · ไม่มีอะไรน่าห่วง = ขอบนิ่ง
 * ไอคอนแบบ 3 (วงกลมสีอ่อน) — สีบอกความหมาย ฟ้า = ต้องทำ · ส้ม = ต้องดู · เขียว = ข่าวดี
 */
export function TodayCard({ name, summary, lines, scopes }: { name: string; summary: TodaySummary; lines: TodayLine[]; scopes: TodayScope[] }) {
  return (
    <section className={`panel todaycard${summary.needsAttention ? ' todaycard--live' : ''}`} aria-label={t('สรุปวันนี้')}>
      <div className="todaycard__top">
        <h3 className="todaycard__head">
          <span className="todaycard__orb" aria-hidden />
          <span>{greeting()}{name && ` ${name}`}</span>
        </h3>
        <div className="todaycard__scope" role="group" aria-label={t('สรุปของ')}>
          {scopes.map((sc) => sc.onPick
            ? <button key={sc.key} aria-pressed={sc.on} onClick={sc.onPick}>{sc.label}</button>
            : <span key={sc.key} aria-current="true">{sc.label}</span>)}
        </div>
      </div>
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
