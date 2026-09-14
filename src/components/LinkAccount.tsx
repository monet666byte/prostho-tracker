import { ArrowsClockwise, CheckCircle, Clock, IdentificationCard, SignOut, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/cloud';
import { getAppUser } from '../lib/auth';
import { cancelLinkRequest, canSelfLink, myLinkRequest, requestLink, type MyLinkRequest } from '../lib/link';
import { t } from '../lib/i18n';
import { groupShort } from '../domain/group';
import { useApp } from '../store/app';

/**
 * บัญชีที่ล็อกอินแล้วแต่ยังไม่ผูกกับนักศึกษาคนไหน (0023_link_requests.sql)
 *
 * นักศึกษา @student.mahidol.edu: ใส่รหัสนักศึกษา → รออาจารย์ที่ปรึกษายืนยัน → เปิดแอปได้เอง
 * อีเมลอื่น (อาจารย์ / Gmail ส่วนตัว): ผูกเองไม่ได้ ต้องให้หัวหน้าภาคเพิ่มรายชื่อ — บอกให้ชัดว่าต้องทำอะไร
 */
export function LinkAccount() {
  const signOut = useApp((s) => s.signOut);
  const [email, setEmail] = useState<string | null>(null);
  const [req, setReq] = useState<MyLinkRequest | null | undefined>(undefined); // undefined = กำลังโหลด
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false); // กันกดรัว — state มีผลหลัง re-render

  /* ยืนยันแล้ว = มีแถว app_users → เปิดแอปใหม่ให้ init ผูก session + เริ่ม sync ตามทางปกติ
     (เลี่ยงการประกอบ session เองตรงนี้ ซึ่งจะข้ามขั้นที่ init ทำ เช่น ล้างของเดโม/อ่านชื่อ) */
  const checkLinked = useCallback(async () => {
    if (!(await getAppUser())) return;
    // ต้องออกจาก #/login ด้วย — หน้า login ไม่เด้งเองแม้มี session แล้ว (เจอในเทสต์ 14 ก.ย. 69)
    window.location.hash = '#/';
    window.location.reload();
  }, []);

  const load = useCallback(async () => {
    const r = await myLinkRequest();
    if (!r.ok) { setError(r.error); setReq(null); return; }
    setReq(r.value);
    if (r.value?.status === 'approved') void checkLinked();
  }, [checkLinked]);

  useEffect(() => {
    void (async () => {
      const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
      setEmail(data.user?.email ?? null);
      await load();
    })();
  }, [load]);

  // รอยืนยันอยู่ → ถามซ้ำเป็นระยะ อาจารย์กดแล้วนักศึกษาไม่ต้องทำอะไร
  useEffect(() => {
    if (req?.status !== 'pending') return;
    const id = setInterval(() => { void checkLinked(); void load(); }, 20_000);
    return () => clearInterval(id);
  }, [req?.status, checkLinked, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (guard.current || !code.trim()) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await requestLink(code);
      if (!r.ok) setError(r.error);
      else { setReq(r.value); setCode(''); }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  async function cancel() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      const r = await cancelLinkRequest();
      if (!r.ok) setError(r.error);
      else setReq(null);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    await checkLinked();
    await load();
    setBusy(false);
  }

  const student = canSelfLink(email);

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <IdentificationCard size={24} weight="duotone" style={{ color: 'var(--accent)', flex: 'none' }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '600 15px var(--font-head)' }}>{t('ผูกบัญชีกับรายชื่อนักศึกษา')}</div>
          <div style={{ font: '400 11px var(--font-body)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
            {t('เข้าด้วย')} {email ?? '…'}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', gap: 8, borderRadius: 12, padding: '10px 12px', background: 'var(--danger-tint)', color: 'var(--danger-dark)', font: '500 11.5px/1.6 var(--font-body)' }}>
          <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </div>
      )}

      {email && !student && (
        <p className="pretty" style={{ margin: 0, font: '400 12px/1.7 var(--font-body)', color: 'var(--text-body)' }}>
          {t('บัญชีนี้ยังไม่อยู่ในรายชื่อ — อาจารย์ให้ติดต่อหัวหน้าภาคเพื่อเพิ่มรายชื่อ · นักศึกษาให้ออกแล้วเข้าใหม่ด้วยอีเมล @student.mahidol.edu')}
        </p>
      )}

      {student && req === undefined && (
        <div className="skel" style={{ height: 88, borderRadius: 14 }} />
      )}

      {student && req?.status === 'pending' && (
        <div style={{ borderRadius: 14, padding: '14px 14px', background: 'var(--accent-tint)', display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', font: '600 12.5px var(--font-body)', color: 'var(--accent-hover)' }}>
            <Clock size={17} weight="fill" />
            {t('รออาจารย์ที่ปรึกษายืนยัน')}
          </div>
          <div style={{ font: '600 16px var(--font-head)' }}>{req.studentName}</div>
          <div style={{ font: '400 11.5px var(--font-body)', color: 'var(--text-muted)' }}>
            {req.studentCode} · {t('กลุ่ม')} {groupShort(req.groupCode)}
          </div>
          <p className="pretty" style={{ margin: '4px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-body)' }}>
            {t('อาจารย์ยืนยันแล้วแอปจะเปิดให้เอง ไม่ต้องทำอะไรเพิ่ม · ถ้าชื่อไม่ใช่คุณ กดแก้รหัส')}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="btn btn--sec" style={{ flex: 1 }} onClick={refresh} disabled={busy}>
              <ArrowsClockwise size={16} weight="bold" />
              {t('ตรวจสถานะ')}
            </button>
            <button className="btn btn--sec" style={{ flex: 1 }} onClick={cancel} disabled={busy}>
              {t('แก้รหัส')}
            </button>
          </div>
        </div>
      )}

      {student && req?.status === 'approved' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', font: '600 12.5px var(--font-body)', color: 'var(--success-dark)' }}>
          <CheckCircle size={17} weight="fill" />
          {t('ยืนยันแล้ว — กำลังเปิดแอป…')}
        </div>
      )}

      {student && (req === null || req?.status === 'rejected') && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          {req?.status === 'rejected' && (
            <p className="pretty" style={{ margin: 0, font: '500 11.5px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
              {t('คำขอก่อนหน้าไม่ได้รับการยืนยัน — ตรวจรหัสแล้วส่งใหม่ หรือคุยกับอาจารย์ที่ปรึกษา')}
            </p>
          )}
          <label className="field">
            <span>{t('รหัสนักศึกษา')}</span>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6604048"
            />
          </label>
          <button className="btn" type="submit" disabled={busy || !code.trim()}>
            {busy ? t('กำลังส่ง…') : t('ส่งคำขอให้อาจารย์ยืนยัน')}
          </button>
        </form>
      )}

      <button
        onClick={() => void signOut()}
        style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', font: '600 11.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 4 }}
      >
        <SignOut size={15} />
        {t('ออกจากระบบ / ใช้บัญชีอื่น')}
      </button>
    </div>
  );
}
