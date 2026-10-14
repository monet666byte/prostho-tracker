import { PauseCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { setPatientWait, updatePatientNote } from '../../data/repo';
import { WAIT_MAX_DAYS, WAIT_REASONS } from '../../domain/rules';
import type { WaitReason, WorkpieceView } from '../../domain/types';
import { toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
import { waitReasonLabel } from '../../lib/waitReason';
import { currentActor, useApp } from '../../store/app';

/**
 * แผ่นตั้งสถานะคนไข้ — "นัดได้ปกติ" หรือ "รอคนไข้" (เหตุผล + วันนัดครั้งหน้า) + โน้ตสถานะเดิม
 * เปิดจากบรรทัดสถานะใต้ชื่อคนไข้ (หน้าคนไข้) และจากการ์ดถามบนหน้าแรกเมื่อเคสเงียบ
 * ตั้งแล้วมีผลกับทุกเคสที่กำลังทำของคนไข้รายนี้ (setPatientWait)
 */
export function WaitSheet({ patientId, title, works, note, onClose }: {
  patientId: string;
  title: string;
  /** เคสของคนไข้รายนี้ — ใช้อ่านสถานะปัจจุบัน */
  works: WorkpieceView[];
  note?: string;
  onClose: () => void;
}) {
  const { showToast, touch } = useApp();
  const current = works.find((w) => w.waitReason);
  const [reason, setReason] = useState<WaitReason | null>(current?.waitReason ?? null);
  const [until, setUntil] = useState(current?.waitUntil ?? '');
  const [text, setText] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const today = toISODate(new Date());

  async function save() {
    setBusy(true);
    try {
      await setPatientWait(patientId, reason ? { reason, until: until || undefined } : null, currentActor());
      if ((note ?? '') !== text.trim()) await updatePatientNote(patientId, text, currentActor());
      touch();
      showToast({
        message: reason ? t('ตั้งเป็นรอคนไข้แล้ว — อาจารย์จะเห็นว่าเคสนี้รอคนไข้ ไม่ใช่ค้าง') : t('บันทึกสถานะผู้ป่วยแล้ว'),
        tone: 'success',
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '86%', overflowY: 'auto' }}>
        <div className="grabber" />
        <h3 className="h3">{t('สถานะ {p}', { p: title })}</h3>
        <p style={{ margin: '4px 0 12px', font: '400 12px/1.55 var(--font-body)', color: 'var(--text-muted)' }}>
          {t('เลือกถ้าเคสหยุดเพราะคนไข้ — ระหว่างนี้แอปจะไม่นับเคสนี้เป็น "ค้าง"')}
        </p>
        <div className="actgrid" role="radiogroup" aria-label={t('สถานะผู้ป่วย')}>
          <button role="radio" aria-checked={reason === null} data-on={reason === null} onClick={() => setReason(null)}>
            {t('นัดได้ปกติ')}
          </button>
          {WAIT_REASONS.map((r) => (
            <button key={r} role="radio" aria-checked={reason === r} data-on={reason === r} onClick={() => setReason(r)}>
              {waitReasonLabel(r)}
            </button>
          ))}
        </div>
        {reason && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>{t('นัดครั้งหน้า (ถ้ารู้)')}</span>
            <input className="input mono" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
            <small style={{ display: 'block', marginTop: 4, font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
              {until
                ? t('เลยวันนัดแล้วเคสยังไม่ขยับ จะกลับมานับเป็นค้างตามปกติ')
                : t('ไม่ใส่วันนัด รอได้ {n} วัน แล้วกลับมานับตามปกติ', { n: WAIT_MAX_DAYS })}
            </small>
          </label>
        )}
        <label className="field" style={{ marginTop: 12 }}>
          <span>{t('โน้ต (ไม่บังคับ)')}</span>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('สถานะผู้ป่วย เช่น รอ preprosth · รอถอนฟัน · F/U 2 wks')} />
        </label>
        <button className="btn" style={{ height: 52, marginTop: 15 }} disabled={busy} onClick={save}>
          <PauseCircle size={18} weight="fill" />
          {t('บันทึก')}
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={onClose}>{t('ยกเลิก')}</button>
      </div>
    </div>
  );
}
