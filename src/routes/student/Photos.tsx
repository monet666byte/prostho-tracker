import { ArrowLeft, Camera, Images, WarningCircle } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { Empty, PhotoSlot } from '../../components/ui/Bits';
import { PlainShell } from '../../components/student/Shell';
import { retryPhoto } from '../../data/repo';
import { usePhotos, useWorkpieces } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { useApp } from '../../store/app';
import type { PhotoStatus } from '../../domain/types';
import { t, tText } from '../../lib/i18n';
import { usePhotoAttach } from '../../components/student/usePhotoAttach';

const CHIP: Record<PhotoStatus, { label: string; bg: string; fg: string }> = {
  ok: { label: t('อัปโหลดแล้ว'), bg: 'var(--success-tint)', fg: 'var(--success)' },
  queue: { label: t('รออัปโหลด'), bg: 'var(--warning-tint)', fg: 'var(--warning)' },
  fail: { label: t('ส่งไม่สำเร็จ'), bg: 'var(--danger-tint)', fg: 'var(--danger-dark)' },
};

export default function Photos() {
  const navigate = useNavigate();
  const { session, offline, showToast } = useApp();
  const photos = usePhotos(session?.studentId);
  const works = useWorkpieces(session?.studentId);

  const target = works.find((w) => w.procIndex >= 0);
  const cam = usePhotoAttach(target?.id, { camera: true });
  const lib = usePhotoAttach(target?.id);
  const busy = cam.busy || lib.busy;

  return (
    <PlainShell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label="ย้อนกลับ">
            <ArrowLeft size={17} />
          </button>
          <h2 className="h2" style={{ flex: 1 }}>{t('รูปต่อ step')}</h2>
        </div>
        <p style={{ margin: '6px 0 0', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('ย่อรูปให้อัตโนมัติ · ถ่ายตอนเน็ตหลุดได้ เดี๋ยวส่งขึ้นเองทีหลัง')}
        </p>
      </header>

      {cam.input}
      {lib.input}

      <div style={{ display: 'flex', gap: 11, padding: '14px 16px 0' }}>
        <button className="card" style={bigBtn} disabled={busy} onClick={cam.open}>
          <Camera size={24} weight="fill" color="var(--accent)" />
          {busy ? t('กำลังย่อรูป…') : t('ถ่ายรูป')}
        </button>
        <button className="card" style={bigBtn} disabled={busy} onClick={lib.open}>
          <Images size={24} weight="fill" color="var(--accent)" />
          {busy ? t('รอสักครู่') : t('เลือกจากคลัง')}
        </button>
      </div>

      <div className="sectiontitle">
        <h4>{t('รูปทั้งหมด · {n} รูป', { n: photos.length })}</h4>
      </div>

      <div style={{ padding: '0 16px', display: 'grid', gap: 9 }}>
        {photos.length === 0 && (
          <Empty icon={<Images size={26} />} title={t('ยังไม่มีรูปในเคสนี้')} hint={t('แนบรูปตอนบันทึก step เสร็จได้เลย')} />
        )}
        {photos.map((p) => {
          const chip = CHIP[p.status];
          return (
            <button
              key={p.id}
              className="card"
              style={{ padding: 10, display: 'flex', gap: 11, alignItems: 'center', textAlign: 'left' }}
              onClick={async () => {
                if (p.status !== 'fail') return;
                await retryPhoto(p.id, offline);
                showToast({ message: t('ลองส่งรูปใหม่แล้ว'), tone: 'default' });
              }}
            >
              <PhotoSlot size={74} filled src={p.dataUrl} alt={p.stepLabel} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: '500 11px var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {p.stepLabel}
                </span>
                <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 3 }}>
                  {tText(p.detail)}
                </span>
                <span style={{ display: 'block', font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 4 }}>
                  {thaiShort(p.createdAt)} · {p.sizeLabel}
                </span>
              </span>
              <span className="chip" style={{ background: chip.bg, color: chip.fg, flex: 'none' }}>
                {p.status === 'fail' && <WarningCircle size={12} weight="fill" />}
                {chip.label}
              </span>
            </button>
          );
        })}
      </div>
    </PlainShell>
  );
}

const bigBtn: React.CSSProperties = {
  flex: 1, height: 80, display: 'grid', placeItems: 'center', gap: 6, borderRadius: 14,
  font: '600 12.5px var(--font-body)', color: 'var(--text-secondary)',
};
