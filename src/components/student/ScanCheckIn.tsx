import { CheckCircle, Keyboard, WarningCircle, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkCheckinCode, TYPED_CODE_LENGTH } from '../../domain/checkinQr';
import { tapFeedback } from '../../lib/haptic';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

type Stamp = { checkinAt: string; punctual: boolean };

/**
 * ด่านสแกน QR หน้าห้องก่อนเช็คอิน — ทุกปุ่มเช็คอินฝั่งนักศึกษาผ่านตัวนี้
 *
 * สวิตช์ `settings.checkinScan` ปิด = เรียก `run` ทันที (เช็คอินแตะเดียวเหมือนเดิม)
 * เปิด = เปิดกล้องเต็มจอก่อน สแกนผ่านแล้วค่อยเรียก `run` แล้วโชว์หน้า "เช็คอินแล้ว" แทน toast
 *
 * เวลาเช็คอินยังประทับใน checkInNow ตอนสแกนผ่าน ไม่ใช่ตอนกดปุ่ม — กดค้างไว้แล้วค่อยเดินไปสแกนหน้าห้อง
 * เวลาต้องเป็นเวลาที่ถึงห้องจริง
 *
 * คืน null เมื่อผู้ใช้ปิดกล้องเอง · `scanned` บอกผู้เรียกว่าหน้าจอสำเร็จโชว์ไปแล้ว ไม่ต้องขึ้น toast ซ้ำ
 */
export function useScanCheckIn() {
  const { settings } = useApp();
  const required = !!settings.checkinScan;
  const [phase, setPhase] = useState<null | { kind: 'scan' } | { kind: 'done'; stamp: Stamp; fillLink: boolean }>(null);
  const job = useRef<{ run: () => Promise<Stamp>; fillLink: boolean; resolve: (v: { stamp: Stamp; scanned: boolean } | null) => void; reject: (e: unknown) => void } | null>(null);

  const checkIn = useCallback(
    async (run: () => Promise<Stamp>, opts: { fillLink?: boolean } = {}): Promise<{ stamp: Stamp; scanned: boolean } | null> => {
      if (!required) return { stamp: await run(), scanned: false };
      return new Promise((resolve, reject) => {
        job.current = { run, fillLink: !!opts.fillLink, resolve, reject };
        setPhase({ kind: 'scan' });
      });
    },
    [required],
  );

  async function accept() {
    const j = job.current;
    if (!j) return;
    try {
      const stamp = await j.run();
      tapFeedback(30);
      setPhase({ kind: 'done', stamp, fillLink: j.fillLink });
      j.resolve({ stamp, scanned: true });
    } catch (e) {
      setPhase(null);
      j.reject(e);
    } finally {
      job.current = null;
    }
  }

  const closeDone = useCallback(() => setPhase(null), []);

  function cancel() {
    job.current?.resolve(null);
    job.current = null;
    setPhase(null);
  }

  const overlay: ReactNode = phase?.kind === 'scan'
    ? <ScanScreen onAccept={accept} onClose={cancel} />
    : phase?.kind === 'done'
      ? <DoneScreen stamp={phase.stamp} fillLink={phase.fillLink} onClose={closeDone} />
      : null;

  return { checkIn, overlay, required };
}

/* ── กล้อง ─────────────────────────────────────────────────────────────── */

type CamState = 'starting' | 'live' | 'denied' | 'nocam';

function ScanScreen({ onAccept, onClose }: { onAccept: () => Promise<void>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<CamState>('starting');
  const [typing, setTyping] = useState(false);
  const [bad, setBad] = useState(false);
  const busy = useRef(false);

  async function submit(raw: string, via: 'qr' | 'typed') {
    if (busy.current) return;
    const verdict = checkCheckinCode(raw, via);
    if (!verdict.ok) {
      setBad(true);
      return;
    }
    busy.current = true;
    await onAccept();
  }

  useEffect(() => {
    if (typing) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCam('nocam');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        if (stopped) return;
        setCam((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'nocam');
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCam('live');

      // ไลบรารีอ่าน QR โหลดตอนเปิดกล้องครั้งแรกเท่านั้น — คนที่ไม่เคยสแกนไม่ต้องโหลด
      const { default: jsQR } = await import('jsqr');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const loop = (now: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        // อ่านทุก ~150ms พอ — ทุกเฟรมทำให้มือถือรุ่นเก่าร้อนและแบตไหล
        if (now - last < 150 || !ctx || video.readyState < 2 || busy.current) return;
        last = now;
        const scale = Math.min(1, 640 / (video.videoWidth || 640));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        if (!canvas.width || !canvas.height) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (found?.data) void submit(found.data, 'qr');
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing]);

  if (typing || cam === 'denied' || cam === 'nocam') {
    return (
      <CodeEntry
        reason={typing ? null : cam === 'denied' ? t('ยังไม่ได้อนุญาตให้แอปใช้กล้อง') : t('เปิดกล้องในเครื่องนี้ไม่ได้')}
        onBackToCamera={cam === 'live' || cam === 'starting' ? () => setTyping(false) : undefined}
        onSubmit={(code) => submit(code, 'typed')}
        bad={bad}
        clearBad={() => setBad(false)}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="qrscan" role="dialog" aria-modal="true" aria-label={t('สแกนเช็คอิน')}>
      <video ref={videoRef} className="qrscan__video" playsInline muted />
      <div className="qrscan__top">
        <button className="qrscan__x" onClick={onClose} aria-label={t('ปิดกล้อง')}><X size={18} weight="bold" /></button>
        <span className="qrscan__title">{t('สแกนเช็คอิน')}</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="qrscan__finder" aria-hidden="true">
        <i className="qrscan__corner" /><i className="qrscan__corner" /><i className="qrscan__corner" /><i className="qrscan__corner" />
        {cam === 'live' && <i className="qrscan__line" />}
      </div>
      <div className="qrscan__hint">
        {bad ? (
          <>
            <b>{t('อ่าน QR นี้ไม่ได้')}</b>
            <span>{t('ส่อง QR ที่จอหน้าห้องคลินิกอีกครั้ง')}</span>
          </>
        ) : (
          <>
            <b>{cam === 'starting' ? t('กำลังเปิดกล้อง…') : t('ส่อง QR ที่หน้าห้องคลินิก')}</b>
            <span>{t('เจอแล้วระบบลงเวลาให้เอง ไม่ต้องกดอะไรต่อ')}</span>
          </>
        )}
      </div>
      <div className="qrscan__bottom">
        <button className="qrscan__pill" onClick={() => { setBad(false); setTyping(true); }}>
          <Keyboard size={16} /> {t('กล้องใช้ไม่ได้? พิมพ์รหัส 6 หลักแทน')}
        </button>
      </div>
    </div>
  );
}

/* ── พิมพ์รหัสแทน ──────────────────────────────────────────────────────── */

function CodeEntry({ reason, onBackToCamera, onSubmit, bad, clearBad, onClose }: {
  reason: string | null;
  onBackToCamera?: () => void;
  onSubmit: (code: string) => Promise<void>;
  bad: boolean;
  clearBad: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const digits = code.replace(/\D/g, '').slice(0, TYPED_CODE_LENGTH);
  const ready = digits.length === TYPED_CODE_LENGTH;
  return (
    <div className="qrscan qrscan--light" role="dialog" aria-modal="true" aria-label={t('พิมพ์รหัสใต้ QR')}>
      <div className="qrscan__top">
        <button className="qrscan__x" onClick={onClose} aria-label={t('ปิด')}><X size={18} weight="bold" /></button>
        <span />
        <span style={{ width: 36 }} />
      </div>
      <form
        className="qrcode"
        onSubmit={(e) => { e.preventDefault(); if (ready) void onSubmit(digits); }}
      >
        {reason && (
          <p className="qrcode__reason"><WarningCircle size={16} weight="fill" /> {reason}</p>
        )}
        <h2 className="qrcode__h">{t('พิมพ์รหัสใต้ QR')}</h2>
        <p className="qrcode__sub">{t('รหัส 6 หลักอยู่ใต้ QR ที่จอหน้าห้อง')}</p>
        <input
          id="checkin-code"
          className="qrcode__input"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={TYPED_CODE_LENGTH + 2}
          value={code}
          onChange={(e) => { clearBad(); setCode(e.target.value); }}
          placeholder="000000"
          aria-label={t('รหัส 6 หลัก')}
          aria-invalid={bad}
        />
        {bad && <p className="qrcode__bad">{t('รหัสต้องเป็นตัวเลข 6 หลัก')}</p>}
        <div className="qrcode__actions">
          <button className="btn" type="submit" disabled={!ready}>{t('เช็คอิน')}</button>
          {onBackToCamera && (
            <button className="btn btn--ghost" type="button" onClick={onBackToCamera}>{t('กลับไปสแกน')}</button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ── สแกนผ่านแล้ว ──────────────────────────────────────────────────────── */

function DoneScreen({ stamp, fillLink, onClose }: { stamp: Stamp; fillLink: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  // ไม่กดอะไร = ปิดเองแล้วกลับหน้าเดิม (เช็คอินด่วนต้องจบเร็ว)
  useEffect(() => {
    const id = setTimeout(onClose, 3500);
    return () => clearTimeout(id);
  }, [onClose]);
  return (
    <div className="qrscan qrscan--light" role="dialog" aria-modal="true" aria-label={t('เช็คอินแล้ว')}>
      <div className="qrdone">
        <span className="qrdone__ic"><CheckCircle size={44} weight="fill" /></span>
        <h2 className="qrdone__h">{t('เช็คอินแล้ว')}</h2>
        <div className="qrdone__time">{t('{time} น.', { time: stamp.checkinAt })}</div>
        <span className={`qrdone__chip${stamp.punctual ? '' : ' qrdone__chip--late'}`}>
          {stamp.punctual ? t('ตรงเวลา') : t('สาย')}
        </span>
      </div>
      <div className="qrdone__foot">
        {fillLink ? (
          <>
            <button className="btn" onClick={() => { onClose(); navigate('/app/checkin'); }}>{t('เติมกิจกรรมเลย')}</button>
            <button className="btn btn--ghost" onClick={onClose}>{t('ไว้ทีหลัง')}</button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>{t('เสร็จ')}</button>
        )}
      </div>
    </div>
  );
}
