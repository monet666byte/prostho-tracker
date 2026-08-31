import {
  ArrowLeft, ArrowsClockwise, ArrowsLeftRight, CloudArrowUp, CloudCheck, CloudSlash, EnvelopeSimple,
  ChatCircleDots, BellRinging, ArrowCounterClockwise, SignOut, Translate,
} from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { Empty } from '../../components/ui/Bits';
import { PlainShell } from '../../components/student/Shell';
import { syncNow } from '../../data/repo';
import { useQueue } from '../../hooks/data';
import { relative } from '../../lib/date';
import { lang, setLang, t } from '../../lib/i18n';
import { cloudEnabled } from '../../lib/cloud';
import { currentActor, useApp } from '../../store/app';

export default function Sync() {
  const navigate = useNavigate();
  const { offline, setOffline, showToast, touch, switchRole, resetDemo, signOut } = useApp();
  const queue = useQueue();

  return (
    <PlainShell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <h2 className="h2" style={{ flex: 1 }}>{t('การเชื่อมต่อ & sync')}</h2>
        </div>
      </header>

      <div style={{ padding: '14px 16px 0', display: 'grid', gap: 12 }}>
        <div
          className="card"
          style={{
            padding: 14, display: 'flex', gap: 12, alignItems: 'center',
            background: offline ? 'var(--warning-tint)' : '#fff',
            borderColor: offline ? 'var(--warning-border)' : undefined,
          }}
        >
          <span style={{ color: offline ? 'var(--warning)' : 'var(--success)', display: 'grid', flex: 'none' }}>
            {offline ? <CloudSlash size={26} weight="fill" /> : <CloudCheck size={26} weight="fill" />}
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', font: '600 13.5px var(--font-head)' }}>
              {offline ? t('โหมดออฟไลน์') : t('ออนไลน์')}
            </span>
            <span className="pretty" style={{ display: 'block', font: '400 11px/1.55 var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
              {offline
                ? t('บันทึกลงเครื่อง แล้ว sync เองเมื่อมีสัญญาณ')
                : cloudEnabled
                  ? t('ข้อมูลขึ้นเซิร์ฟเวอร์ทันที')
                  : t('โหมดตัวอย่าง — ข้อมูลเก็บในเครื่องนี้เท่านั้น')}
            </span>
          </span>
          <button className="toggle" data-on={offline} onClick={() => setOffline(!offline)} aria-label={t('สลับโหมดออฟไลน์')}>
            <i />
          </button>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 9 }}>
            <h4 style={{ margin: 0, flex: 1, font: '600 13.5px var(--font-head)' }}>{t('คิวรอ sync')}</h4>
            <span style={{ font: '500 11px var(--font-mono)', color: 'var(--text-faint)' }}>{t('{n} รายการ', { n: queue.length })}</span>
          </div>

          {queue.length === 0 ? (
            <Empty
              icon={<CloudCheck size={26} />}
              title={t('ไม่มีรายการค้าง')}
              hint={cloudEnabled ? t('ข้อมูลทั้งหมดถูกส่งขึ้นเซิร์ฟเวอร์แล้ว') : t('บันทึกครบแล้วในเครื่องนี้')}
            />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {queue.map((q) => (
                <div key={q.id} className="card" style={{ padding: '11px 13px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <CloudArrowUp size={19} color="var(--warning)" style={{ flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: '500 11px var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {q.label}
                    </span>
                    <span style={{ display: 'block', font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
                      {relative(q.createdAt)} · {q.hasPhoto ? t('มีรูปแนบ') : t('ไม่มีรูป')}
                    </span>
                  </span>
                  <span className="chip" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)' }}>{t('รอส่ง')}</span>
                </div>
              ))}
            </div>
          )}

          <button
            className="btn"
            style={{ marginTop: 11 }}
            disabled={offline}
            onClick={async () => {
              const n = await syncNow(currentActor());
              touch();
              showToast({ message: n ? t('sync สำเร็จ {n} รายการ', { n }) : t('ไม่มีรายการค้าง'), tone: n ? 'success' : 'default' });
            }}
          >
            <ArrowsClockwise size={18} weight="bold" />
            {offline ? t('ต้องออนไลน์ก่อนจึงจะ sync ได้') : t('sync ทันที')}
          </button>
        </div>

        {/* สลับภาษา — เดิมอยู่แค่แถบเดโมบนคอม มือถือเปลี่ยนไม่ได้ (ผู้ใช้ขอ 1 ก.ย.)
            เขียนชื่อภาษาด้วยภาษาตัวเองเสมอ คนอ่านไม่ออกอีกภาษาจะได้หาปุ่มเจอ */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Translate size={17} color="var(--text-muted)" />
            <h4 style={{ margin: 0, font: '600 13.5px var(--font-head)' }}>ภาษา · Language</h4>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className={`langbtn${lang === 'th' ? ' langbtn--on' : ''}`}
              onClick={() => lang !== 'th' && setLang('th')}
            >
              ไทย
            </button>
            <button
              className={`langbtn${lang === 'en' ? ' langbtn--on' : ''}`}
              onClick={() => lang !== 'en' && setLang('en')}
            >
              English
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          {/*
            ปุ่มเปิด/ปิดพวกนี้เคยกดได้และเปิดค้างไว้ตั้งแต่แรก (push/email = เปิด)
            ทั้งที่ยังไม่ได้ทำระบบแจ้งเตือนเลยสักช่องทาง — นักศึกษาเห็นว่าเปิดอยู่
            ก็จะรอการแจ้งเตือนที่ไม่มีวันมา แล้วพลาดกำหนดส่ง
            ปิดไว้ก่อนและบอกตรงๆ ว่ายังไม่เปิดใช้ จนกว่าจะทำจริง
          */}
          <h4 style={{ margin: '0 0 3px', font: '600 13.5px var(--font-head)' }}>{t('การแจ้งเตือน')}</h4>
          <p style={{ margin: '0 0 6px', font: '500 10.5px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
            {t('ยังไม่เปิดใช้ในช่วงทดลอง — ตอนนี้ยังไม่มีการแจ้งเตือนส่งออกจากระบบ')}
          </p>
          {(
            [
              { key: 'push', label: 'Push notification', hint: t('ช่องทางหลัก'), Icon: BellRinging },
              { key: 'line', label: t('LINE (สำรอง)'), hint: t('ส่งซ้ำถ้าไม่ได้เปิดแอปใน 24 ชม.'), Icon: ChatCircleDots },
              { key: 'email', label: t('อีเมลสรุปรายสัปดาห์'), hint: t('ทุกวันจันทร์ 08:00'), Icon: EnvelopeSimple },
            ] as const
          ).map(({ key, label, hint, Icon }) => (
            <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--divider)' }}>
              <Icon size={18} color="var(--text-muted)" style={{ flex: 'none' }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', font: '500 12px var(--font-body)' }}>{label}</span>
                <span style={{ display: 'block', font: '400 10px var(--font-body)', color: 'var(--text-faint)' }}>{hint}</span>
              </span>
              <button className="toggle" data-on={false} disabled aria-label={label} title={t('ยังไม่เปิดใช้')}>
                <i />
              </button>
            </div>
          ))}
        </div>

        <button
          className="card"
          style={{ padding: '13px 14px', display: 'flex', gap: 11, alignItems: 'center', textAlign: 'left' }}
          onClick={async () => {
            await signOut();
            navigate('/login');
          }}
        >
          <SignOut size={19} color="var(--text-muted)" style={{ flex: 'none' }} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', font: '600 13px var(--font-head)' }}>{t('ออกจากระบบ')}</span>
            <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
              {t('เปลี่ยนบทบาท')}
            </span>
          </span>
        </button>

        {/* เฉพาะโหมดเดโม — ของตกค้างชุดเดียวกับแถบเดโมที่เคยกวาด (โผล่ในโหมดจริงมาตลอด) */}
        {!cloudEnabled && (
        <div className="dashed" style={{ padding: 14 }}>
          <h4 style={{ margin: '0 0 3px', font: '600 13px var(--font-head)' }}>{t('เครื่องมือสำหรับการนำเสนอ')}</h4>
          <p style={{ margin: '0 0 11px', font: '400 10.5px/1.55 var(--font-body)', color: 'var(--text-faint)' }}>
            {t('สำหรับตอนสาธิต')}
          </p>
          <div style={{ display: 'flex', gap: 9 }}>
            <button
              className="btn btn--sec"
              onClick={async () => {
                await switchRole();
                navigate('/teacher');
              }}
            >
              <ArrowsLeftRight size={16} /> {t('มุมมองอาจารย์')}
            </button>
            <button
              className="btn btn--sec"
              onClick={async () => {
                // ล้างธง "ไว้ก่อน" ของ popup เช็คอิน + เตือนบ่าย — รีเซ็ตแล้วต้องได้ลองใหม่ทั้ง flow
                try { localStorage.removeItem('pt-checkin-ask'); localStorage.removeItem('pt-fill-nudge'); } catch { /* private mode */ }
                await resetDemo();
                showToast({ message: t('รีเซ็ตแล้ว — popup เช็คอินจะกลับมาถามใหม่'), tone: 'success' });
              }}
            >
              <ArrowCounterClockwise size={16} /> {t('รีเซ็ตข้อมูล')}
            </button>
          </div>
        </div>
        )}
      </div>
    </PlainShell>
  );
}
