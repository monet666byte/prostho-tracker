import { ArrowLeft, Camera } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { PhotoSlot } from '../../components/ui/Bits';
import { PlainShell } from '../../components/student/Shell';
import { getPhotoStatus, retryPhoto } from '../../data/repo';
import { usePatientNamesOn, usePhotoSrc, usePhotos, useWorkpieces } from '../../hooks/data';
import { patientWithHn } from '../../lib/privacy';
import { useState } from 'react';
import { thaiShort } from '../../lib/date';
import { useApp } from '../../store/app';
import type { PhotoStatus } from '../../domain/types';
import { t, tText } from '../../lib/i18n';
import { usePhotoAttach } from '../../components/student/usePhotoAttach';

/**
 * ป้ายต้องตรงกับความจริง ไม่ใช่ตรงกับที่อยากให้เป็น
 * 'local' = โหมดที่ไม่มีเซิร์ฟเวอร์ให้อัปเลย (เดโม/แชร์/GitHub Pages) — ใช้สีกลาง ไม่ใช่สีเตือน
 * เพราะมันไม่ใช่ความผิดพลาด แค่ไม่ได้ต่อคลาวด์ ต่างจาก 'queue' ที่แปลว่าต่ออยู่แต่ยังไม่ขึ้น
 */
const CHIP: Record<PhotoStatus, { label: string; bg: string; fg: string }> = {
  ok: { label: t('อัปโหลดแล้ว'), bg: 'var(--success-tint)', fg: 'var(--success)' },
  queue: { label: t('รออัปโหลด'), bg: 'var(--warning-tint)', fg: 'var(--warning)' },
  fail: { label: t('ส่งไม่สำเร็จ'), bg: 'var(--danger-tint)', fg: 'var(--danger-dark)' },
  local: { label: t('เก็บในเครื่องนี้'), bg: 'var(--fill)', fg: 'var(--text-muted)' },
};

export default function Photos() {
  const navigate = useNavigate();
  const { session, showToast } = useApp();
  const photos = usePhotos(session?.studentId);
  const srcs = usePhotoSrc(photos);
  const works = useWorkpieces(session?.studentId);

  const namesOn = usePatientNamesOn();
  /* รูปที่ถ่ายจากหน้านี้ต้องผูกกับเคสที่ถูกต้อง — มีหลายเคสที่เริ่มแล้วต้องให้เลือกก่อน
     ไม่งั้นรูปในปากคนไข้ไปโผล่ในแฟ้มของอีกคนโดยไม่มีใครรู้ (รูปผูกกับ step ปัจจุบันของเคสที่เลือก) */
  const candidates = works.filter((w) => w.procIndex >= 0);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const target = candidates.find((w) => w.id === pickedId) ?? candidates[0];
  const cam = usePhotoAttach(target?.id, { camera: true });
  const lib = usePhotoAttach(target?.id);
  const busy = cam.busy || lib.busy;
  const uploading = cam.uploading || lib.uploading;

  return (
    <PlainShell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <h1 className="h2" style={{ flex: 1 }}>{t('คลังรูปงาน')}</h1>
        </div>
        <p style={{ margin: '6px 0 0', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('ย่อรูปให้อัตโนมัติ · ถ่ายตอนเน็ตหลุดได้ เดี๋ยวส่งขึ้นเองทีหลัง')}
        </p>
      </header>

      {cam.input}
      {lib.input}

      {/* ปุ่มหลักปุ่มเดียว + ลิงก์ — ถ่ายรูปใช้บ่อยกว่าเลือกจากคลัง */}
      <div style={{ padding: '16px 16px 0' }}>
        {candidates.length > 1 && (
          <label style={{ display: 'grid', gap: 4, marginBottom: 10, font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
            {t('แนบรูปเข้าเคส')}
            <select className="input" value={target?.id ?? ''} onChange={(e) => setPickedId(e.target.value)}>
              {candidates.map((w) => (
                <option key={w.id} value={w.id}>{tText(w.detail)} · {patientWithHn(w.patient, namesOn, t)}</option>
              ))}
            </select>
          </label>
        )}
        {candidates.length === 1 && target && (
          <p style={{ margin: '0 0 8px', font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
            {t('แนบรูปเข้าเคส')} {tText(target.detail)} · {patientWithHn(target.patient, namesOn, t)}
          </p>
        )}
        <button className="btn" style={{ height: 52, borderRadius: 16 }} disabled={busy || !target} onClick={cam.open}>
          <Camera size={20} weight="fill" />
          {busy ? (uploading ? t('กำลังส่งรูป…') : t('กำลังย่อรูป…')) : t('ถ่ายรูป')}
        </button>
        <button className="textlink" disabled={busy} onClick={lib.open}>
          {t('เลือกจากคลังในเครื่อง')} ›
        </button>
      </div>

      <div className="critlabel" style={{ margin: '14px 20px 8px' }}>
        <span className="homelabel" style={{ margin: 0 }}>{t('รูปทั้งหมด')}</span>
        <span className="mono faint">{photos.length}</span>
      </div>

      <div style={{ padding: '0 16px' }}>
        {photos.length === 0 ? (
          <div className="card emptyplain">
            <b>{t('ยังไม่มีรูป')}</b>
            {t('แนบรูปตอนบันทึก step เสร็จได้เลย')}
          </div>
        ) : (
          <div className="card checklist">
            {photos.map((p) => {
              const chip = CHIP[p.status];
              return (
                <button
                  key={p.id}
                  className="photorow"
                  onClick={async () => {
                    if (p.status !== 'fail') return;
                    await retryPhoto(p.id);
                    // อ่านสถานะจริงหลังลองส่ง — เดิมขึ้น "ลองส่งใหม่แล้ว" ทุกครั้งไม่ว่าผลจะเป็นยังไง
                    const now = await getPhotoStatus(p.id);
                    showToast(now === 'ok'
                      ? { message: t('ส่งรูปขึ้นเซิร์ฟเวอร์แล้ว'), tone: 'success' }
                      : { message: t('ยังส่งไม่ขึ้น — ดูสาเหตุที่หน้า “ตั้งค่า”'), tone: 'warning' });
                  }}
                >
                  <PhotoSlot size={64} filled src={srcs.get(p.id)} alt={p.stepLabel} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: '600 13.5px var(--font-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.stepLabel}
                    </span>
                    <span style={{ display: 'block', font: '400 12px var(--font-body)', color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tText(p.detail)}
                    </span>
                    <span style={{ display: 'block', font: '400 12px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
                      {thaiShort(p.createdAt)} · {p.sizeLabel} · <span style={{ color: chip.fg, fontWeight: 600 }}>{chip.label}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PlainShell>
  );
}
