import {
  ArrowLeft, Confetti, DownloadSimple, FlagCheckered, Medal, ShareNetwork, Sparkle, TrendUp,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlainShell } from '../../components/student/Shell';
import { t } from '../../lib/i18n';

/**
 * MOCK — หน้าทดลองระบบ achievement (ยังไม่ผูกกับข้อมูลจริง)
 * สามส่วนตามที่ตกลง: ① สมุดบันทึกครั้งแรก · ② การ์ดฉลองจบเคส · ④ สรุปปลายปีแบบ Wrapped
 * โทน: ฉลอง milestone ที่มีความหมายทางวิชาชีพจริง — ไม่มีแต้ม ไม่มี leaderboard
 */

const FIRSTS = [
  { icon: '🦷', title: t('Delivery ครั้งแรก'), detail: t('CD upper · ผู้ป่วย E'), date: '14 ก.ค. 69', got: true },
  { icon: '🎉', title: t('ปิดเคสแรกในชีวิต'), detail: t('CD/- (Upper) · 15 สัปดาห์'), date: '2 ส.ค. 69', got: true },
  { icon: '🛠️', title: t('ทำ lab step เองครบชุดแรก'), detail: 'Mounting → Remounting · CD', date: '21 ก.ค. 69', got: true },
  { icon: '🗿', title: t('ปิดเคส RPD ตัวแรก'), detail: t('โครง Co-Cr ตัวแรกของคุณ'), date: null, got: false },
  { icon: '👑', title: t('ปิดเคส Crown ตัวแรก'), detail: t('ซี่ 46 อยู่ที่ step 9 แล้ว — ใกล้มาก'), date: null, got: false },
  { icon: '🔩', title: t('Post-core ตัวแรก'), detail: t('ซี่ 21 กำลังรอคิว ENDO'), date: null, got: false },
];

const WRAPPED = [
  { big: '6', label: t('ผู้ป่วยที่คุณดูแลปีนี้'), sub: t('ทุกคนคือเคสจริง ฟันจริง ความไว้ใจจริง'), bg: 'var(--accent)', fg: '#fff' },
  { big: '47', label: t('ขั้นตอนที่ผ่านมือคุณ'), sub: t('จาก Primary impression ถึง Completion'), bg: '#0E9F6E', fg: '#fff' },
  { big: '31', label: t('lab step ที่ทำด้วยมือตัวเอง'), sub: t('มากกว่าค่าเฉลี่ยของกลุ่ม 18%'), bg: '#7A5AF8', fg: '#fff' },
  { big: '15', label: t('สัปดาห์กับเคสที่ยาวที่สุด'), sub: t('CD คู่แรก — และคุณพามันจบจนได้'), bg: '#B54708', fg: '#fff' },
];

export default function Achievements() {
  const navigate = useNavigate();
  const [showCelebration, setShowCelebration] = useState(false);
  const [wrappedIndex, setWrappedIndex] = useState(0);
  const gotCount = FIRSTS.filter((f) => f.got).length;

  return (
    <PlainShell
      overlay={
        showCelebration ? (
          <div className="backdrop" onClick={() => setShowCelebration(false)}>
            <div className="sheet celebrate" onClick={(e) => e.stopPropagation()}>
              <div className="grabber" />
              <div className="celebrate__burst" aria-hidden>
                {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i } as never} />)}
              </div>
              <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
                <span className="celebrate__badge"><Confetti size={30} weight="fill" /></span>
                <h3 style={{ margin: '12px 0 2px', font: '700 20px var(--font-head)' }}>{t('ปิดเคสแล้ว!')}</h3>
                <p style={{ margin: 0, font: '500 12.5px var(--font-body)', color: 'var(--text-muted)' }}>
                  46 Crown (PFM) · {t('ผู้ป่วย C')}
                </p>
              </div>

              <div className="celebrate__stats">
                <div><b>10/10</b><span>{t('step ครบ')}</span></div>
                <div><b>9</b><span>{t('สัปดาห์')}</span></div>
                <div><b>4</b><span>{t('lab ทำเอง')}</span></div>
                <div><b>2/2</b><span>{t('Crown ตามเกณฑ์')}</span></div>
              </div>

              <p className="pretty" style={{ margin: '4px 0 0', textAlign: 'center', font: '400 11.5px/1.7 var(--font-body)', color: 'var(--text-body)' }}>
                {t('จาก Abutment preparation วันแรก ถึง Permanent cementation วันนี้ — ฟันซี่นี้จะอยู่กับผู้ป่วยไปอีกหลายปี')} 🦷
              </p>

              <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
                <button className="btn btn--sec" style={{ height: 46 }}><DownloadSimple size={16} /> {t('เก็บการ์ดไว้')}</button>
                <button className="btn" style={{ height: 46 }}><ShareNetwork size={16} weight="fill" /> {t('แชร์')}</button>
              </div>
              <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={() => setShowCelebration(false)}>{t('ปิด')}</button>
            </div>
          </div>
        ) : undefined
      }
    >
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <div style={{ flex: 1 }}>
            <h2 className="h2">{t('เส้นทางของคุณ')}</h2>
          </div>
          <span className="badge" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)' }}>MOCK</span>
        </div>
        <p style={{ margin: '6px 0 0', font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
          {t('หน้าทดลอง — ยังไม่ผูกกับข้อมูลจริง ไว้ตัดสินใจกันก่อนว่าเอาแบบไหน')}
        </p>
      </header>

      <div style={{ padding: '14px 16px 8px', display: 'grid', gap: 14 }}>
        {/* ② การ์ดฉลองจบเคส */}
        <section className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Confetti size={17} weight="fill" color="var(--accent)" />
            <h4 style={{ margin: 0, font: '600 13.5px var(--font-head)', flex: 1 }}>{t('การ์ดฉลองตอนปิดเคส')}</h4>
          </div>
          <p className="pretty" style={{ margin: '5px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
            {t('เด้งอัตโนมัติครั้งเดียวตอนกด Completion of case — สรุปตัวเลขของเคสนั้น เก็บเป็นรูปหรือแชร์ได้')}
          </p>
          <button className="btn" style={{ marginTop: 11, height: 46 }} onClick={() => setShowCelebration(true)}>
            <Sparkle size={17} weight="fill" /> {t('ลองดูตัวอย่าง')}
          </button>
        </section>

        {/* ① สมุดบันทึกครั้งแรก */}
        <section className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Medal size={17} weight="fill" color="var(--self)" />
            <h4 style={{ margin: 0, font: '600 13.5px var(--font-head)', flex: 1 }}>{t('สมุดบันทึกครั้งแรก')}</h4>
            <span className="mono" style={{ font: '600 11px var(--font-mono)', color: 'var(--text-muted)' }}>{gotCount}/{FIRSTS.length}</span>
          </div>
          <p className="pretty" style={{ margin: '5px 0 10px', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
            {t('milestone วิชาชีพที่เกิดขึ้นครั้งเดียวในชีวิต — ระบบบันทึกวันที่ให้เอง ไม่ต้องทำอะไรเพิ่ม')}
          </p>
          <div style={{ display: 'grid', gap: 7 }}>
            {FIRSTS.map((f) => (
              <div
                key={f.title}
                style={{
                  display: 'flex', gap: 11, alignItems: 'center', padding: '9px 11px', borderRadius: 12,
                  background: f.got ? 'var(--self-tint)' : 'var(--bg-subtle)',
                  border: `1px solid ${f.got ? '#E2DAFB' : 'var(--border-3)'}`,
                  opacity: f.got ? 1 : 0.72,
                }}
              >
                <span style={{ fontSize: 20, flex: 'none', filter: f.got ? 'none' : 'grayscale(1)' }}>{f.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', font: '600 12px var(--font-body)', color: f.got ? 'var(--self)' : 'var(--text-secondary)' }}>
                    {f.title}
                  </span>
                  <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 1 }}>
                    {f.detail}
                  </span>
                </span>
                <span className="mono" style={{ font: '500 9.5px var(--font-mono)', color: 'var(--text-faint)', flex: 'none' }}>
                  {f.date ? t(f.date) : t('รออยู่…')}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ④ Wrapped ปลายปี */}
        <section className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <FlagCheckered size={17} weight="fill" color="var(--success)" />
            <h4 style={{ margin: 0, font: '600 13.5px var(--font-head)', flex: 1 }}>{t('สรุปปีของคุณ (ปลายเทอม)')}</h4>
          </div>
          <p className="pretty" style={{ margin: '5px 0 10px', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
            {t('เปิดได้ครั้งเดียวตอนจบปีการศึกษา — แตะการ์ดเพื่อเลื่อนดู')}
          </p>

          <button
            className="wrapped"
            style={{ background: WRAPPED[wrappedIndex].bg, color: WRAPPED[wrappedIndex].fg }}
            onClick={() => setWrappedIndex((wrappedIndex + 1) % WRAPPED.length)}
          >
            <span style={{ font: '400 12px var(--font-body)', opacity: 0.8 }}>{t('ปีการศึกษา')} 2569</span>
            <span style={{ font: '700 56px/1.1 var(--font-head)' }}>{WRAPPED[wrappedIndex].big}</span>
            <span style={{ font: '600 14px var(--font-head)' }}>{WRAPPED[wrappedIndex].label}</span>
            <span style={{ font: '400 11px/1.5 var(--font-body)', opacity: 0.85 }}>{WRAPPED[wrappedIndex].sub}</span>
            <span style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              {WRAPPED.map((_, i) => (
                <i key={i} style={{ width: i === wrappedIndex ? 16 : 5, height: 5, borderRadius: 99, background: 'currentColor', opacity: i === wrappedIndex ? 0.9 : 0.4, transition: 'width .25s' }} />
              ))}
            </span>
          </button>
        </section>

        {/* ③ streak — ตัวอย่างแนวคิดไว้คุยต่อ */}
        <section className="dashed" style={{ padding: 13, display: 'flex', gap: 10 }}>
          <TrendUp size={16} color="var(--text-faint)" style={{ flex: 'none', marginTop: 2 }} />
          <p className="pretty" style={{ margin: 0, font: '400 11px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
            <b>{t('ส่วนที่ 3 (ความสม่ำเสมอ) ยังไม่ทำ')}</b> — {t('รอคุยกันเรื่องรูปแบบ "streak ที่ไม่หาย" ก่อน')}
          </p>
        </section>
      </div>
    </PlainShell>
  );
}
