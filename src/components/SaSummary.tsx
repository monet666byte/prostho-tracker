/**
 * การ์ดสรุปอัตโนมัติจากแบบประเมินตนเอง — เห็นเฉพาะฝั่งอาจารย์
 *
 * ภาคยืนยัน: นักศึกษาไม่ต้องเห็นสรุปนี้ ให้เป็นเครื่องมือเตรียมตัวของอาจารย์
 * ก่อนนัดคุยเท่านั้น (จึงไม่มีทั้งปุ่มปล่อยและช่องความเห็นอีกต่อไป)
 * ตัวกฎอยู่ที่ domain/saFeedback.ts — ที่นี่แค่วาด
 */
import { Info, Sparkle, Warning, WarningOctagon } from '@phosphor-icons/react';
import { buildFeedback, sortFeedback, type FeedbackTone } from '../domain/saFeedback';
import { useAllCheckIns, useAllProgressUpdates, useAllWorkpieces, useStudent } from '../hooks/data';
import { t } from '../lib/i18n';
import { useApp } from '../store/app';
import type { SelfAssessment } from '../domain/types';

/* การ์ดเดียว แถวละเรื่อง — เดิมกล่องสีพื้นเข้มคนละใบ + กล่องโค้ดซ้อนใน
   สีเหลืออยู่แค่วงกลมหน้าหัวข้อ */
const TONE: Record<FeedbackTone, { dot: string; Icon: typeof Info }> = {
  risk: { dot: 'var(--danger)', Icon: WarningOctagon },
  gap: { dot: 'var(--warning)', Icon: Warning },
  info: { dot: 'var(--text-faint)', Icon: Info },
  praise: { dot: 'var(--success)', Icon: Sparkle },
};

export function SaSummary({ sa }: { sa: SelfAssessment }) {
  const settings = useApp((s) => s.settings);
  const student = useStudent(sa.studentId);
  const allWorks = useAllWorkpieces();
  const allCheckins = useAllCheckIns();
  const allUpdates = useAllProgressUpdates();

  if (!student) return null;
  const works = allWorks.filter((w) => w.studentId === sa.studentId);
  const checkins = allCheckins.filter((c) => c.studentId === sa.studentId);
  const cards = sortFeedback(buildFeedback({ sa, works, checkins, updates: allUpdates, settings }));

  return (
    <div className="panel insights">
      <div className="insights__head">
        <h3>{t('สรุปจากระบบ')}</h3>
        <span className="sub">{t('เทียบคำตอบกับผลงานจริง · ใช้เป็นประเด็นคุย ไม่ใช่คำตัดสิน')}</span>
      </div>

      {cards.length === 0 && (
        <p className="insights__empty">{t('ยังไม่พบจุดที่คำตอบกับข้อมูลจริงต่างกันชัดเจน')}</p>
      )}

      {cards.map((c) => {
        const tone = TONE[c.tone];
        return (
          <div key={c.id} className="insight">
            <span className="insight__ic" style={{ background: tone.dot }}><tone.Icon size={12} weight="fill" /></span>
            <div style={{ minWidth: 0 }}>
              <b>{c.title}</b>
              <p>{c.body}</p>
              <small>{c.evidence}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
