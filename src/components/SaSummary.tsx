/**
 * การ์ดสรุปอัตโนมัติจากแบบประเมินตนเอง — ใช้ร่วมกันสองฝั่ง
 *   อาจารย์: เห็นทันทีที่นักศึกษาส่ง (ไว้เตรียมตัวก่อนนัดคุย)
 *   นักศึกษา: เห็นเมื่ออาจารย์กดปล่อยแล้วเท่านั้น
 * ตัวกฎอยู่ที่ domain/saFeedback.ts — ที่นี่แค่วาด
 */
import { ChatCircleDots, Info, Sparkle, Warning, WarningOctagon } from '@phosphor-icons/react';
import { buildFeedback, sortFeedback, type FeedbackTone } from '../domain/saFeedback';
import { useAllCheckIns, useAllProgressUpdates, useAllWorkpieces, useStudent } from '../hooks/data';
import { t } from '../lib/i18n';
import { useApp } from '../store/app';
import type { SelfAssessment } from '../domain/types';

const TONE: Record<FeedbackTone, { bg: string; ink: string; border: string; Icon: typeof Info; label: string }> = {
  risk: { bg: 'var(--danger-tint)', ink: 'var(--danger-dark)', border: 'var(--danger-tint)', Icon: WarningOctagon, label: 'ควรจัดการก่อน' },
  gap: { bg: 'var(--warning-tint)', ink: 'var(--warning-dark)', border: 'var(--warning-tint)', Icon: Warning, label: 'มองต่างจากข้อมูลจริง' },
  info: { bg: 'var(--fill)', ink: 'var(--text-secondary)', border: 'var(--divider)', Icon: Info, label: 'ข้อมูลประกอบ' },
  praise: { bg: 'var(--success-tint)', ink: 'var(--success-dark)', border: 'var(--success-tint)', Icon: Sparkle, label: 'ทำได้ดีกว่าที่คิด' },
};

export function SaSummary({ sa, showAdvisorNote }: { sa: SelfAssessment; showAdvisorNote?: boolean }) {
  const settings = useApp((s) => s.settings);
  const student = useStudent(sa.studentId);
  const allWorks = useAllWorkpieces();
  const allCheckins = useAllCheckIns();
  const allUpdates = useAllProgressUpdates();

  if (!student) return null;
  const works = allWorks.filter((w) => w.studentId === sa.studentId);
  const checkins = allCheckins.filter((c) => c.studentId === sa.studentId);
  const cards = sortFeedback(buildFeedback({ sa, student, works, checkins, updates: allUpdates, settings }));

  return (
    <div style={{ display: 'grid', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Sparkle size={15} weight="fill" color="var(--accent)" />
        <span style={{ font: '600 12.5px var(--font-head)' }}>{t('สรุปจากระบบ')}</span>
        <span style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('เทียบคำตอบกับผลงานจริง')}
        </span>
      </div>

      {cards.length === 0 && (
        <div className="card" style={{ padding: '12px 14px', font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
          {t('ยังไม่พบจุดที่คำตอบกับข้อมูลจริงต่างกันชัดเจน')}
        </div>
      )}

      {cards.map((c) => {
        const tone = TONE[c.tone];
        return (
          <div key={c.id} className="card" style={{ padding: '11px 13px', display: 'grid', gap: 5, borderColor: tone.border }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                style={{
                  width: 22, height: 22, borderRadius: 7, flex: 'none', display: 'grid', placeItems: 'center',
                  background: tone.bg, color: tone.ink,
                }}
              >
                <tone.Icon size={13} weight="fill" />
              </span>
              <span style={{ font: '600 12px/1.4 var(--font-head)', flex: 1, minWidth: 0 }}>{c.title}</span>
            </div>
            <span style={{ font: '400 11.5px/1.65 var(--font-body)', color: 'var(--text-secondary)' }}>{c.body}</span>
            <span
              className="mono"
              style={{ font: '500 10px/1.5 var(--font-mono)', color: tone.ink, background: tone.bg, borderRadius: 7, padding: '5px 8px' }}
            >
              {c.evidence}
            </span>
          </div>
        );
      })}

      {showAdvisorNote && sa.advisorNote && (
        <div className="card" style={{ padding: '11px 13px', display: 'grid', gap: 5, borderColor: 'var(--accent-ring)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <ChatCircleDots size={15} weight="fill" color="var(--accent)" />
            <span style={{ font: '600 12px var(--font-head)' }}>{t('ความเห็นของอาจารย์ที่ปรึกษา')}</span>
          </div>
          <span style={{ font: '400 11.5px/1.7 var(--font-body)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
            {sa.advisorNote}
          </span>
        </div>
      )}

      <p style={{ margin: 0, font: '400 9.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
        {t('สรุปนี้มาจากกฎที่ตั้งไว้ในระบบ ไม่ใช่คำตัดสิน — ใช้เป็นประเด็นตั้งต้นในการคุยกับอาจารย์')}
      </p>
    </div>
  );
}
