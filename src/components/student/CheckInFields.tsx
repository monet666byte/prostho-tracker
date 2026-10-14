/**
 * ช่องกรอกของฟอร์มเช็คอิน — ใช้ร่วมกันระหว่างหน้าคาบคลินิกกับแผ่นถามเช็คอินบนหน้าแรก
 *
 * แชร์เฉพาะส่วนที่หน้าตาเหมือนกันทุกจุด: ปุ่มกิจกรรมรายกลุ่ม และกล่องเลือกผู้ป่วย
 * ป้ายหัวข้อกับกรอบรอบนอกยังอยู่ที่หน้าจอ เพราะสองที่ใช้ markup คนละแบบ
 * (หน้าคาบใช้ label.field · แผ่นถามใช้ div + aria-label) — ห้ามฝืนรวม
 */
import { Check } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { ACTIVITY_GROUPS } from '../../domain/checkin';
import { WAIT_REASONS, isActiveWork } from '../../domain/rules';
import type { WaitReason, WorkpieceView } from '../../domain/types';
import { setPatientWait } from '../../data/repo';
import { toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
import { patientWithHn } from '../../lib/privacy';
import { waitReasonLabel } from '../../lib/waitReason';

/** ปุ่มกิจกรรมในคาบ แบ่งตามกลุ่ม — แตะซ้ำ = เอาออก */
export function ActivityChips({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <>
      {ACTIVITY_GROUPS.map((g) => (
        <div key={g.label} className="actgroup">
          <div className="actgroup__label">{t(g.label)}</div>
          <div className="actgrid">
            {g.items.map((a) => (
              <button key={a} data-on={selected.includes(a)} onClick={() => onChange(selected.includes(a) ? selected.filter((x) => x !== a) : [...selected, a])}>
                {t(a)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * กล่องเลือกผู้ป่วยที่นัด — รายการมาจาก useCheckInPatients
 * ariaLabel ใส่เมื่อป้ายของช่องไม่ได้เป็น <label> ที่ครอบ select อยู่ (โปรแกรมอ่านหน้าจอจะไม่รู้ว่าช่องนี้คืออะไร)
 */
export function PatientSelect({
  value, onChange, patients, ariaLabel, style,
}: {
  value: string;
  onChange: (patientId: string) => void;
  patients: [string, string][];
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  return (
    <select className="input" aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      <option value="">{t('— ไม่ระบุ —')}</option>
      {patients.map(([id, label]) => (
        <option key={id} value={id}>{label}</option>
      ))}
    </select>
  );
}

/** สิ่งที่เลือกในส่วน "คนไข้คนไหนไม่มา" — ว่าง = ไม่ตั้งรอให้ใคร */
export interface NoPatientWaitValue { ids: string[]; reason: WaitReason; until: string }
export const EMPTY_NO_PATIENT_WAIT: NoPatientWaitValue = { ids: [], reason: 'busy', until: '' };

/**
 * เช็คอินว่า "ไม่มีผู้ป่วย" แล้วถามต่อทันทีว่าคนไข้คนไหนไม่มา — ทางที่นักศึกษาจะเจอ "รอคนไข้" เองโดยไม่ต้องรู้ก่อน
 * ไม่บังคับเลือก (บางคาบไม่ได้นัดใครไว้) · บันทึกหลังเช็คอินสำเร็จด้วย applyNoPatientWait
 */
export function NoPatientWait({ works, namesOn, value, onChange }: {
  works: WorkpieceView[];
  namesOn: boolean;
  value: NoPatientWaitValue;
  onChange: (next: NoPatientWaitValue) => void;
}) {
  const seen = new Map<string, string>();
  works.filter(isActiveWork).forEach((w) => { if (!seen.has(w.patientId)) seen.set(w.patientId, patientWithHn(w.patient, namesOn, t)); });
  if (seen.size === 0) return null;
  const today = toISODate(new Date());
  return (
    <div className="nopt">
      <div className="nopt__title">{t('คนไข้คนไหนไม่มาวันนี้? (ไม่บังคับ)')}</div>
      {[...seen.entries()].map(([id, label]) => {
        const on = value.ids.includes(id);
        return (
          <button
            key={id} type="button" className="nopt__pick" data-on={on} aria-pressed={on}
            onClick={() => onChange({ ...value, ids: on ? value.ids.filter((x) => x !== id) : [...value.ids, id] })}
          >
            <span className="nopt__box" aria-hidden>{on && <Check size={11} weight="bold" />}</span>{label}
          </button>
        );
      })}
      {value.ids.length > 0 && (
        <>
          <div className="actgrid" role="radiogroup" aria-label={t('เหตุผล')}>
            {WAIT_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={value.reason === r} data-on={value.reason === r} onClick={() => onChange({ ...value, reason: r })}>
                {waitReasonLabel(r)}
              </button>
            ))}
          </div>
          <label className="field" style={{ margin: 0 }}>
            <span>{t('นัดครั้งหน้า (ถ้ารู้)')}</span>
            <input className="input mono" type="date" min={today} value={value.until} onChange={(e) => onChange({ ...value, until: e.target.value })} />
          </label>
          <small style={{ font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
            {t('เคสของคนไข้ที่เลือกจะไม่นับเป็น "ค้าง" ระหว่างรอ และอาจารย์จะเห็นว่ารอคนไข้')}
          </small>
        </>
      )}
    </div>
  );
}

/** ตั้ง "รอคนไข้" ให้คนไข้ที่เลือกตอนเช็คอิน — เรียกหลังเช็คอินสำเร็จเท่านั้น */
export async function applyNoPatientWait(value: NoPatientWaitValue, actor: string): Promise<number> {
  let n = 0;
  for (const id of value.ids) n += await setPatientWait(id, { reason: value.reason, until: value.until || undefined }, actor);
  return n;
}
