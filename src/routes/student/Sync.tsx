import { ArrowLeft } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlainShell } from '../../components/student/Shell';
import { syncNow } from '../../data/repo';
import { noteSignOutOutcome, wipeLocalDataOnSignOut } from '../../data/localWipe';
import { onSyncProblems, retryQuarantined, syncProblems, type SyncProblem } from '../../data/cloudSync';
import { usePendingPushCount, useQueue } from '../../hooks/data';
import { relative } from '../../lib/date';
import { lang, setLang, t } from '../../lib/i18n';
import { cloudEnabled } from '../../lib/cloud';
import { applyTheme, currentTheme, THEMES } from '../../lib/theme';
import { currentActor, useApp } from '../../store/app';
import {
  onPersistState, persistState, requestPersistentStorage, type PersistState,
} from '../../lib/storagePersist';

/** เหตุผลที่ผู้ใช้อ่านรู้เรื่อง — รหัสที่รู้จักแปลให้ ที่เหลือแสดงข้อความของเซิร์ฟเวอร์ตามจริง */
function problemText(p: SyncProblem): string {
  if (p.kind === 'delete') return t('เซิร์ฟเวอร์ไม่ให้ลบ จึงนำรายการกลับมาแสดง') + ' · ' + p.reason;
  // 0029: นักศึกษาคนเดียวเช็คอินวันเดียวกันจากสองเครื่อง — แถวของเครื่องที่ขึ้นทีหลังถูกปฏิเสธ
  if (p.reason.includes('checkins_student_date_uidx')) {
    return t('วันนั้นเช็คอินจากอีกเครื่องไปแล้ว — คาบนี้ซ้ำ ย้ายโน้ตที่ต้องการไปคาบเดิม แล้วลบคาบนี้ได้');
  }
  return p.reason;
}

export default function Sync() {
  const navigate = useNavigate();
  const { offline, setOffline, showToast, touch, switchRole, resetDemo, signOut } = useApp();
  const queue = useQueue();
  /* ตัวเลข "รอส่ง" ต้องมาจากคิวจริงของตัวส่ง ไม่ใช่แค่รายการที่จดไว้ตอนเปิดสวิตช์ออฟไลน์
     (ตาราง queue ว่างเสมอเมื่อเน็ตหลุดเอง — เดิมจึงขึ้น "ส่งขึ้นเซิร์ฟเวอร์แล้ว" ทั้งที่ยังค้าง) */
  const unsent = usePendingPushCount();
  const waiting = queue.length || unsent;
  // ธีมเก็บใน localStorage (ไม่ใช่ store) — ถือ state ไว้ให้ปุ่มที่เลือกอยู่รีเฟรชทันทีที่กด
  const [theme, setTheme] = useState(currentTheme());
  /**
   * ของที่เซิร์ฟเวอร์ปฏิเสธจนเลิกลองแล้ว — ต้องเห็นด้วยตา
   * เดิมของพวกนี้ถูกทิ้งเงียบๆ พร้อมงานอื่นที่อยู่ในก้อนเดียวกัน (ดู flush() ใน cloudSync.ts)
   * ผู้ใช้จะรู้ตัวก็ต่อเมื่อเปิดจากอีกเครื่องแล้วของไม่อยู่ ซึ่งสายไปแล้ว
   */
  const [problems, setProblems] = useState<SyncProblem[]>(syncProblems);
  useEffect(() => onSyncProblems(() => setProblems(syncProblems())), []);
  /* สถานะความถาวรของที่เก็บในเครื่อง — init() ยิงคำขอไว้แล้ว ตรงนี้แค่ฟังผล
     (ถามอีกรอบเผื่อผู้ใช้เปิดหน้านี้ก่อนคำตอบรอบแรกมาถึง) */
  const [persist, setPersist] = useState<PersistState>(persistState);
  useEffect(() => {
    const off = onPersistState(() => setPersist(persistState()));
    void requestPersistentStorage().then(setPersist);
    return off;
  }, []);

  async function doSync() {
    const r = await syncNow(currentActor());
    touch();
    /* ข้อความต้องตรงกับของจริง — เน็ตที่ต่อติดแต่ยิงไม่ถึงเซิร์ฟเวอร์ทำให้ปุ่มนี้
       กดได้ทั้งที่ส่งไม่ขึ้น เดิมขึ้นว่า "sync สำเร็จ" ทุกครั้ง (ดู syncNow ใน repo.ts) */
    if (r.stillPending || r.photosFailed) {
      showToast({
        message: t('ส่งขึ้นไม่ครบ — เหลือค้าง {n} รายการ ระบบจะลองใหม่ให้เอง', {
          n: r.stillPending + r.photosFailed,
        }),
        tone: 'warning',
      });
      return;
    }
    const done = r.cleared + r.photos;
    showToast({
      message: done ? t('sync สำเร็จ {n} รายการ', { n: done }) : t('ไม่มีรายการค้าง'),
      tone: done ? 'success' : 'default',
    });
  }

  /* การ์ด 9 ใบ → 4 หมวดแบบแอปตั้งค่าในมือถือ */
  return (
    <PlainShell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <h1 className="h2" style={{ flex: 1 }}>{t('ตั้งค่า')}</h1>
        </div>
      </header>

      <div className="newform">
        <div className="homelabel">{t('การเชื่อมต่อ')}</div>
        <div className="card formcard">
          <div className="formrow">
            <span className="dot" style={{ width: 10, height: 10, background: offline ? 'var(--warning)' : 'var(--success)' }} />
            <span className="formrow__main">
              <b>{offline ? t('โหมดออฟไลน์') : t('ออนไลน์')}</b>
              <span className="formrow__sub">
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

          {/* ของที่เซิร์ฟเวอร์ปฏิเสธ — ต้องเห็นด้วยตา ไม่ย่อเหลือบรรทัดจาง */}
          {problems.length > 0 && (
            <div className="formrow formrow--stack formrow--warn">
              <b>{t('{n} รายการส่งขึ้นเซิร์ฟเวอร์ไม่ได้', { n: problems.length })}</b>
              <span className="formrow__sub" style={{ color: 'var(--warning-dark)' }}>
                {t('ยังอยู่ในเครื่องนี้ครบ แต่คนอื่นยังไม่เห็น — ถ้ากดลองใหม่แล้วยังไม่ขึ้น ให้แจ้งผู้ดูแลระบบ')}
              </span>
              {problems.slice(0, 5).map((p) => (
                <span key={p.table + String(p.key)} style={{ font: '400 11px var(--font-mono)', color: 'var(--warning-dark)' }}>
                  {p.table} · {String(p.key)} — {problemText(p)}
                </span>
              ))}
              <button className="textlink textlink--left" onClick={() => { retryQuarantined(); showToast({ message: t('ใส่กลับเข้าคิวแล้ว'), tone: 'default' }); }}>
                {t('ลองส่งใหม่')} ›
              </button>
            </div>
          )}

          <div className="formrow">
            <span className="formrow__main">
              <b>{t('รอส่งขึ้นระบบ')}</b>
              {waiting === 0 && (
                <span className="formrow__sub">
                  {cloudEnabled ? t('ข้อมูลทั้งหมดถูกส่งขึ้นเซิร์ฟเวอร์แล้ว') : t('บันทึกครบแล้วในเครื่องนี้')}
                </span>
              )}
              {queue.length === 0 && unsent > 0 && (
                <span className="formrow__sub" style={{ color: 'var(--warning-dark)' }}>
                  {t('ยังอยู่ในเครื่องนี้ ยังไม่ถึงเซิร์ฟเวอร์ — ระบบจะลองส่งให้เองเมื่อต่อเน็ตได้')}
                </span>
              )}
            </span>
            <span className="formrow__value" style={waiting ? { color: 'var(--warning-dark)' } : undefined}>
              {t('{n} รายการ', { n: waiting })}
            </span>
          </div>
          {queue.map((q) => (
            <div key={q.id} className="formrow formrow--sub">
              <span className="formrow__main">
                <span style={{ display: 'block', font: '500 12px var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.label}</span>
                <span className="formrow__sub">{relative(q.createdAt)} · {q.hasPhoto ? t('มีรูปแนบ') : t('ไม่มีรูป')}</span>
              </span>
            </div>
          ))}

          <button className="formrow" disabled={offline} onClick={doSync}>
            <span className="formrow__main">
              <b style={{ color: offline ? 'var(--text-disabled)' : 'var(--accent)' }}>
                {offline ? t('ต้องออนไลน์ก่อนจึงจะ sync ได้') : t('sync ทันที')}
              </b>
            </span>
          </button>
        </div>

        {/* ที่เก็บข้อมูลในเครื่องนี้ถาวรแค่ไหน — เบราว์เซอร์มีสิทธิ์ลบเองได้
            Safari/iOS ลบที่เก็บของเว็บที่ไม่ได้เปิดใน 7 วัน (ยกเว้นที่เพิ่มลงหน้าจอโฮม)
            ข้อมูลที่ยังไม่ได้ขึ้นตู้กลางอยู่ในนั้นทั้งหมด ผู้ใช้ควรรู้ ไม่ใช่ให้หายแล้วค่อยรู้
            ⚠️ ห้ามเขียนว่า "ปลอดภัยแล้ว" — ของที่ปลอดภัยจริงคือของที่ขึ้นตู้กลางแล้ว */}
        <p className="newform__hint" style={persist === 'persisted' ? undefined : { color: 'var(--warning-dark)' }}>
          {persist === 'persisted'
            ? t('ข้อมูลในเครื่องนี้: เบราว์เซอร์รับปากว่าจะไม่ลบทิ้งเอง')
            : persist === 'best-effort'
              ? t('⚠ เบราว์เซอร์อาจลบข้อมูลในเครื่องถ้าพื้นที่ไม่พอ — เพิ่มแอปลงหน้าจอโฮมช่วยได้')
              : t('⚠ เบราว์เซอร์นี้ลบข้อมูลเว็บที่ไม่ได้เปิดเกิน 7 วัน (Safari/iPhone) — เพิ่มแอปลงหน้าจอโฮมจะไม่ถูกลบ')}
        </p>

        <div className="homelabel">{t('การแสดงผล')}</div>
        <div className="card formcard">
          {/* สลับภาษา — เดิมอยู่แค่แถบเดโมบนคอม มือถือเปลี่ยนไม่ได้
              เขียนชื่อภาษาด้วยภาษาตัวเองเสมอ คนอ่านไม่ออกอีกภาษาจะได้หาปุ่มเจอ */}
          <div className="formrow">
            <span className="formrow__main"><b>ภาษา · Language</b></span>
            <span className="minseg">
              <button data-on={lang === 'th'} aria-pressed={lang === 'th'} onClick={() => lang !== 'th' && setLang('th')}>ไทย</button>
              <button data-on={lang === 'en'} aria-pressed={lang === 'en'} onClick={() => lang !== 'en' && setLang('en')}>EN</button>
            </span>
          </div>
          {/* ธีมสี — เหตุผลเดียวกับปุ่มภาษา: คนเปิดลิงก์แชร์จากมือถือเลือกไม่ได้ */}
          <div className="formrow">
            <span className="formrow__main"><b>{t('ธีมสี')}</b></span>
            <span className="minseg">
              {THEMES.map((th) => (
                <button
                  key={th.cls || 'default'}
                  data-on={theme === th.cls}
                  aria-pressed={theme === th.cls}
                  onClick={() => { setTheme(th.cls); applyTheme(th.cls); }}
                >
                  {t(th.label)}
                </button>
              ))}
            </span>
          </div>
        </div>

        {/*
          ปุ่มเปิด/ปิดพวกนี้เคยกดได้และเปิดค้างไว้ตั้งแต่แรก (push/email = เปิด)
          ทั้งที่ยังไม่ได้ทำระบบแจ้งเตือนเลยสักช่องทาง — นักศึกษาเห็นว่าเปิดอยู่
          ก็จะรอการแจ้งเตือนที่ไม่มีวันมา แล้วพลาดกำหนดส่ง
          ปิดไว้ก่อนและบอกตรงๆ ว่ายังไม่เปิดใช้ จนกว่าจะทำจริง
        */}
        <div className="critlabel" style={{ margin: '6px 4px -2px' }}>
          <span className="homelabel" style={{ margin: 0 }}>{t('การแจ้งเตือน')}</span>
          <span style={{ font: '500 12px var(--font-body)', color: 'var(--warning-dark)' }}>{t('ยังไม่เปิดใช้')}</span>
        </div>
        <div className="card formcard">
          {(
            [
              { key: 'push', label: 'Push notification' },
              { key: 'line', label: t('LINE (สำรอง)') },
              { key: 'email', label: t('อีเมลสรุปรายสัปดาห์') },
            ] as const
          ).map(({ key, label }) => (
            <div key={key} className="formrow formrow--off">
              <span className="formrow__main"><b>{label}</b></span>
              <button className="toggle" data-on={false} disabled aria-label={label} title={t('ยังไม่เปิดใช้')}>
                <i />
              </button>
            </div>
          ))}
        </div>

        <div className="homelabel">{t('บัญชี')}</div>
        <div className="card formcard">
          <button
            className="formrow"
            onClick={async () => {
              /* ล้างข้อมูลในเครื่องด้วย — ข้อมูลที่ต้องล็อกอินถึงจะเห็น ไม่ควรค้างอยู่หลังออกจากระบบ
                 (ASVS V14.3.1) · ล้างเฉพาะตอนของขึ้นเซิร์ฟเวอร์ครบแล้ว ถ้ายังมีค้างต้องบอกตรง ๆ
                 ⚠️ "ปิดแอป" ไม่เข้าทางนี้ — ปิดแท็บไม่ล้างอะไรเลย ไม่งั้นออฟไลน์ใช้ไม่ได้ */
              const res = await wipeLocalDataOnSignOut();
              await signOut();
              /* ห้ามใช้ showToast ที่นี่ — ToastView อยู่ข้างใน student/Shell.tsx
                 พอ navigate ไป /login เชลล์ถูกถอด toast ตายไปพร้อมกัน
                 ข้อความจึงไม่มีทางถึงตาผู้ใช้ */
              noteSignOutOutcome(res);
              navigate('/login');
            }}
          >
            <span className="formrow__main">
              <b style={{ color: 'var(--danger)' }}>{t('ออกจากระบบ')}</b>
              <span className="formrow__sub">
                {cloudEnabled
                  ? t('ล้างข้อมูลออกจากเครื่องนี้ด้วย (ถ้า sync ครบแล้ว) · ปิดแอปเฉย ๆ ไม่ล้าง')
                  : t('เปลี่ยนบทบาท')}
              </span>
            </span>
          </button>
        </div>

        {/* เฉพาะโหมดเดโม — ของตกค้างชุดเดียวกับแถบเดโมที่เคยกวาด (โผล่ในโหมดจริงมาตลอด) */}
        {!cloudEnabled && (
          <p className="newform__hint" style={{ textAlign: 'center', marginTop: 8 }}>
            {t('สำหรับตอนสาธิต')}:{' '}
            <button
              className="inlinelink"
              onClick={async () => {
                await switchRole();
                navigate('/teacher');
              }}
            >
              {t('มุมมองอาจารย์')}
            </button>
            {' · '}
            <button
              className="inlinelink"
              onClick={async () => {
                // ล้างธง "ไว้ก่อน" ของ popup เช็คอิน + เตือนบ่าย — รีเซ็ตแล้วต้องได้ลองใหม่ทั้ง flow
                try { localStorage.removeItem('pt-checkin-ask'); localStorage.removeItem('pt-fill-nudge'); } catch { /* private mode */ }
                await resetDemo();
                showToast({ message: t('รีเซ็ตแล้ว — popup เช็คอินจะกลับมาถามใหม่'), tone: 'success' });
              }}
            >
              {t('รีเซ็ตข้อมูล')}
            </button>
          </p>
        )}
      </div>
    </PlainShell>
  );
}
