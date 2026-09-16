import { CaretLeft, ChalkboardTeacher, CheckCircle, SignIn, Student, Tooth, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { cloudEnabled, takeOAuthReturnError } from '../lib/cloud';
import { explainOAuthError, signInWithGoogle } from '../lib/auth';
import { LinkAccount } from '../components/LinkAccount';
import { useApp } from '../store/app';
import { PhoneFrame } from '../components/student/Shell';
import { canInstall, isAppleSafari, onInstallChange, promptInstall } from '../lib/install';
import type { Role } from '../domain/types';
import { takeSignOutNotice } from '../data/localWipe';

export default function Login() {
  const [role, setRole] = useState<Role | null>(null);
  const { signIn, signInCloud, installPrompt, dismissInstall, cloudUnlinked } = useApp();
  const navigate = useNavigate();
  // โหมด cloud ใช้อีเมล+รหัสผ่านจริง — โหมด local/แชร์เดโมยังเลือกบทบาทเข้าได้เลยเหมือนเดิม
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailMode, setEmailMode] = useState(false);
  /* กลับมาจากหน้า Google พร้อม error (เช่น อีเมลไม่อยู่ในรายชื่อเชิญ) — อ่านครั้งเดียวตอน mount */
  const [error, setError] = useState<string | null>(() => {
    const oauth = takeOAuthReturnError();
    // บัญชีที่ยังไม่ผูก ไม่ใช้ข้อความนี้แล้ว — หน้า LinkAccount อธิบายและพาทำต่อเอง (0023)
    return oauth ? explainOAuthError(oauth) : null;
  });
  const [googleBusy, setGoogleBusy] = useState(false);

  /* ── ติดตั้งลงหน้าจอโฮม ──
     เบราว์เซอร์ยิง beforeinstallprompt ตอนไหนก็ได้ (บางทีหลังหน้าโหลดไปแล้วหลายวินาที)
     จึงต้องรับแจ้งเปลี่ยนแปลง ไม่ใช่อ่านค่าครั้งเดียวตอน render */
  /* ผลของการออกจากระบบครั้งก่อน — อ่านครั้งเดียวตอน mount แล้วมันลบตัวเองทิ้ง
     ต้องมาโผล่ที่นี่ ไม่ใช่เป็น toast: ToastView อยู่ในเชลล์ที่ถูกถอดไปแล้วตอน navigate
     และข้อความ "ข้อมูลยังอยู่ในเครื่องนี้" เป็นเรื่องที่ต้องอ่านให้ทัน ไม่ใช่แถบที่หายเอง */
  const [signOutNotice] = useState(takeSignOutNotice);
  const [installable, setInstallable] = useState(canInstall());
  const [installing, setInstalling] = useState(false);
  useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);
  const manualOnly = !installable && isAppleSafari();

  async function doInstall() {
    setInstalling(true);
    const res = await promptInstall();
    setInstalling(false);
    // 'unavailable' = เบราว์เซอร์ไม่มีปุ่มให้เรียก — คงกล่องไว้ให้อ่านวิธีทำมือ
    if (res !== 'unavailable') dismissInstall();
  }

  async function go() {
    if (!role) return;
    await signIn(role);
    navigate(role === 'student' ? '/app' : '/teacher');
  }

  async function goGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    const res = await signInWithGoogle();
    // สำเร็จ = เบราว์เซอร์กำลังเปลี่ยนไปหน้า Google · มาถึงบรรทัดนี้แปลว่าออกไปไม่ได้
    if (res.error) { setError(res.error); setGoogleBusy(false); }
  }

  async function goCloud(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const res = await signInCloud(email, password);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    navigate(useApp.getState().session?.role === 'teacher' ? '/teacher' : '/app');
  }

  /* ชื่อ + โลโก้อยู่ตรงนี้ที่เดียวในหน้า login — ผู้ใช้แจ้ง 14 ก.ย. 69 ว่าอาจเปลี่ยนทั้งคู่
     (ไอคอนแอปอยู่ public/ อีก 7 ไฟล์ · ชื่อบนแท็บ/ตอนติดตั้งอยู่ index.html + vite.config.ts) */
  const brand = (compact: boolean) => (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        ...(compact ? { paddingTop: 8 } : { flex: 1, justifyContent: 'center', padding: '24px 0' }),
      }}
    >
      <div
        style={{
          width: compact ? 56 : 84, height: compact ? 56 : 84, borderRadius: compact ? 16 : 26,
          background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center',
          boxShadow: `0 ${compact ? 4 : 6}px 0 var(--accent-hover)`,
        }}
      >
        <Tooth size={compact ? 30 : 46} weight="fill" />
      </div>
      <h1 className="h1" style={{ marginTop: compact ? 14 : 22, fontSize: compact ? 22 : 28 }}>Prostho Tracker</h1>
      <p style={{ margin: '6px 0 0', font: '400 14px/1.5 var(--font-body)', color: 'var(--text-body)' }}>
        {t('บันทึกเคสทันตกรรมประดิษฐ์')}
      </p>
      {/* ปี 5 = DTPT502 · ปี 6 = DTPT602 (ตรงกับ domain/selfAssessment.ts) — เดิมเขียนแค่ 502 */}
      <p style={{ margin: '4px 0 0', font: '500 12.5px var(--font-head)', color: 'var(--text-faint)', letterSpacing: '.02em' }}>
        DTPT502 · DTPT602
      </p>
    </div>
  );

  const errorBox = error && (
    <div
      role="alert"
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start', borderRadius: 12, padding: '10px 12px', textAlign: 'left',
        background: 'var(--danger-tint)', color: 'var(--danger-dark)', font: '500 12px/1.6 var(--font-body)',
      }}
    >
      <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
      {error}
    </div>
  );

  const notices = (
    <>
      {signOutNotice && (
        <div
          role="status"
          style={{
            borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 8,
            alignItems: 'flex-start', textAlign: 'left',
            background: signOutNotice.tone === 'ok' ? 'var(--success-tint)' : 'var(--warning-tint)',
            border: `1px solid ${signOutNotice.tone === 'ok' ? 'var(--success-mid)' : 'var(--warning-border)'}`,
          }}
        >
          {signOutNotice.tone === 'ok'
            ? <CheckCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1, color: 'var(--success)' }} />
            : <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1, color: 'var(--warning-dark)' }} />}
          <span
            className="pretty"
            style={{
              font: '500 11.5px/1.6 var(--font-body)',
              color: signOutNotice.tone === 'ok' ? 'var(--success-dark)' : 'var(--warning-dark)',
            }}
          >
            {signOutNotice.message}
          </span>
        </div>
      )}
      {errorBox}
    </>
  );

  const linkBtn = { padding: 8, font: '600 13px var(--font-head)', color: 'var(--accent)' } as const;

  return (
    <div className="canvas">
      <PhoneFrame>

        <div className="screen" style={{ padding: '24px 24px 22px', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
          {cloudEnabled && cloudUnlinked ? (
            <>
              {brand(true)}
              {signOutNotice && <div style={{ marginTop: 12 }}>{notices}</div>}
              <LinkAccount />
            </>
          ) : cloudEnabled && emailMode ? (
            /* ทางสำรอง (บัญชีสาธิต/สำรอง) — แยกเป็นจอที่สอง ไม่ให้แย่งสายตาปุ่ม Google (ผู้ใช้เลือกแบบ M1 14 ก.ย. 69) */
            <form onSubmit={goCloud} style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
              <button
                type="button"
                onClick={() => { setEmailMode(false); setError(null); }}
                style={{ ...linkBtn, alignSelf: 'flex-start', marginLeft: -8, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <CaretLeft size={16} weight="bold" />
                {t('กลับ')}
              </button>
              <h1 className="h1" style={{ fontSize: 22, marginBottom: 8 }}>{t('เข้าด้วยอีเมล')}</h1>
              <label className="field">
                <span>{t('อีเมล')}</span>
                <input
                  className="input"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  placeholder="name@student.mahidol.edu"
                />
              </label>
              <label className="field">
                <span>{t('รหัสผ่าน')}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                />
              </label>
              {errorBox}
              <button className="btn" type="submit" disabled={busy || !email.trim() || !password}>
                <SignIn size={19} weight="bold" />
                {busy ? t('กำลังเข้าสู่ระบบ…') : t('เข้าสู่ระบบ')}
              </button>
              <p className="pretty" style={{ margin: 'auto 0 0', paddingTop: 16, font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                {t('บัญชีต้องถูกเพิ่มโดยภาควิชาก่อน — ระบบจะรู้เองว่าคุณคือนักศึกษาหรืออาจารย์')}
              </p>
            </form>
          ) : cloudEnabled ? (
            <>
              {brand(false)}
              <div style={{ display: 'grid', gap: 10 }}>
                {notices}
                {/* บอกก่อนไปหน้า Google ว่าต้องเลือกบัญชีไหน — หน้า Google มักเสนอ Gmail ส่วนตัวขึ้นมาก่อน */}
                <div style={{ display: 'grid', gap: 6, margin: '2px 0 6px' }}>
                  {[
                    { who: t('นักศึกษา'), local: 'name', domain: '@student.mahidol.edu' },
                    { who: t('อาจารย์'), local: 'name', domain: '@mahidol.edu' },
                  ].map((r) => (
                    <div
                      key={r.domain}
                      style={{
                        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 8,
                        padding: '0 4px', font: '500 12.5px var(--font-body)', color: 'var(--text-faint)',
                      }}
                    >
                      {r.who}
                      <b style={{ font: '600 13.5px var(--font-head)', color: 'var(--text)' }}>
                        {r.local}<span style={{ color: 'var(--accent)' }}>{r.domain}</span>
                      </b>
                    </div>
                  ))}
                </div>
                <button className="btn" type="button" onClick={goGoogle} disabled={googleBusy}>
                  <GoogleMark />
                  {googleBusy ? t('กำลังไปหน้า Google…') : t('เข้าสู่ระบบด้วย Google')}
                </button>
                <button type="button" style={linkBtn} onClick={() => { setEmailMode(true); setError(null); }}>
                  {t('ใช้อีเมลและรหัสผ่านแทน')}
                </button>
              </div>
            </>
          ) : (
          <>
          {brand(false)}
          {/* ป้ายเดโมเฉพาะเวอร์ชันที่ไม่ต่อเซิร์ฟเวอร์ (GitHub Pages / ลิงก์แชร์) — เวอร์ชันนำร่องบน Vercel
              ใช้ข้อมูลจริงของผู้ใช้ ห้ามบอกว่า "ข้อมูลสมมติทั้งหมด" (ผู้ใช้ขอเอาออก 14 ก.ย. 69) */}
          <div style={{ display: 'grid', gap: 10 }}>
          <div
            style={{
              borderRadius: 12, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start',
              background: 'var(--warning-tint)', border: '1px solid var(--warning-border)',
            }}
          >
            <span className="badge" style={{ background: 'var(--warning)', color: '#fff', flex: 'none', marginTop: 1 }}>DEMO</span>
            <span className="pretty" style={{ font: '400 10.5px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
              {t('ข้อมูลสมมติทั้งหมด')}
            </span>
          </div>
          {notices}
            {(
              [
                { key: 'student', title: t('นักศึกษา'), hint: t('บันทึก step · ดูเกณฑ์ · ส่งรายงาน'), Icon: Student },
                { key: 'teacher', title: t('อาจารย์ / ภาควิชา'), hint: t('ภาพรวมทั้งชั้นปี · ตรวจงาน · ตั้งค่า'), Icon: ChalkboardTeacher },
              ] as const
            ).map(({ key, title, hint, Icon }) => (
              <button
                key={key}
                onClick={() => setRole(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14,
                  textAlign: 'left', transition: 'all .15s',
                  border: `1px solid ${role === key ? 'var(--accent)' : 'var(--border-2)'}`,
                  background: role === key ? 'var(--accent-tint)' : '#fff',
                }}
              >
                <span
                  style={{
                    width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: 'none',
                    background: role === key ? 'var(--accent)' : 'var(--fill)',
                    color: role === key ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={21} weight={role === key ? 'fill' : 'regular'} />
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', font: '600 14px var(--font-head)' }}>{title}</span>
                  <span style={{ display: 'block', font: '400 11px var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {hint}
                  </span>
                </span>
              </button>
            ))}

          <button className="btn" style={{ marginTop: 6 }} disabled={!role} onClick={go}>
            <GoogleMark />
            {t('เข้าสู่ระบบด้วย Google')}
          </button>
          </div>
          </>
          )}
        </div>

        {/* โชว์กล่องเชิญติดตั้งเฉพาะตอนที่ทำอะไรได้จริง
            ① installable = กดปุ่มเดียวติดตั้งได้ (Chrome/Edge/Android)
            ② manualOnly  = Safari บนเครื่อง Apple — บอกวิธีทำมือได้
            นอกจากนี้กล่องจะมีแต่ปุ่มที่กดไม่ได้ ("เบราว์เซอร์นี้ยังเพิ่มไม่ได้")
            แล้วยังบังหน้า login ทั้งหน้าจนกดเข้าระบบไม่ได้ (วัดเจอ 7 ก.ย. 69)
            beforeinstallprompt มาช้าหลายวินาทีได้ พอมาแล้ว onInstallChange จะ re-render ให้เอง */}
        {installPrompt && (installable || manualOnly) && (
          <div className="backdrop" onClick={dismissInstall}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="grabber" />
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span
                  style={{
                    width: 46, height: 46, borderRadius: 13, background: 'var(--accent)', color: '#fff',
                    display: 'grid', placeItems: 'center', flex: 'none',
                  }}
                >
                  <Tooth size={25} weight="fill" />
                </span>
                <div>
                  <div style={{ font: '600 14.5px var(--font-head)' }}>{t('เพิ่ม Prostho Tracker ลงหน้าจอโฮม')}</div>
                  <div style={{ font: '400 11.5px/1.5 var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('เปิดใช้ได้เร็วกว่า ใช้ได้แม้สัญญาณคลินิกไม่ดี')}
                  </div>
                </div>
              </div>
              {manualOnly && (
                /* Safari ไม่มี API ให้เรียก — บอกทางเดินให้ครบ ดีกว่าปุ่มที่กดแล้วไม่เกิดอะไร */
                <ol
                  style={{
                    margin: '14px 0 0', paddingLeft: 18,
                    font: '400 11.5px/1.8 var(--font-body)', color: 'var(--text-secondary)',
                  }}
                >
                  <li>{t('แตะปุ่มแชร์ ⬆︎ ด้านล่างจอ')}</li>
                  <li>{t('เลื่อนหาแล้วแตะ “Add to Home Screen”')}</li>
                  <li>{t('แตะ “Add” มุมขวาบน')}</li>
                </ol>
              )}
              <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
                <button className="btn btn--sec" style={{ height: 46 }} onClick={dismissInstall}>
                  {manualOnly ? t('เข้าใจแล้ว') : t('ไว้ก่อน')}
                </button>
                {!manualOnly && (
                  <button className="btn" style={{ height: 46 }} disabled={!installable || installing} onClick={doInstall}>
                    {installing ? t('กำลังติดตั้ง…') : installable ? t('เพิ่มเลย') : t('เบราว์เซอร์นี้ยังเพิ่มไม่ได้')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </PhoneFrame>
    </div>
  );
}

/** โลโก้ G สี่สีของ Google ในวงกลมขาว — วางบนปุ่มน้ำเงินได้โดยไม่จม */
function GoogleMark() {
  return (
    <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}>
      <svg viewBox="0 0 48 48" width="15" height="15" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
      </svg>
    </span>
  );
}
