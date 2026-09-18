/**
 * ช่องกรอกของฟอร์มเช็คอิน — ใช้ร่วมกันระหว่างหน้าคาบคลินิกกับแผ่นถามเช็คอินบนหน้าแรก
 *
 * แชร์เฉพาะส่วนที่หน้าตาเหมือนกันทุกจุด: ปุ่มกิจกรรมรายกลุ่ม และกล่องเลือกผู้ป่วย
 * ป้ายหัวข้อกับกรอบรอบนอกยังอยู่ที่หน้าจอ เพราะสองที่ใช้ markup คนละแบบ
 * (หน้าคาบใช้ label.field · แผ่นถามใช้ div + aria-label) — ห้ามฝืนรวม
 */
import type { CSSProperties } from 'react';
import { ACTIVITY_GROUPS } from '../../domain/checkin';
import { t } from '../../lib/i18n';

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
