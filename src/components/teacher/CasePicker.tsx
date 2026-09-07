/**
 * แถวเลือกเคสของนักศึกษาบนหัวฟอร์มประเมิน
 *
 * บนกระดาษช่อง "Patient name / H.N." เขียนมือ แต่ในแอปไม่ต้องพิมพ์ —
 * ระบบรู้อยู่แล้วว่านักศึกษาคนนี้มีเคสอะไรบ้าง แตะทีเดียวเติมให้ครบ (ผู้ใช้ขอ 7 ก.ย. 69)
 * เร็วกว่า และไม่มีพิมพ์ H.N. ผิด ซึ่งเป็นเลขที่ใช้ตามตัวผู้ป่วยจริง
 * ช่องพิมพ์เองยังอยู่ เผื่อเคสที่ยังไม่ได้ลงทะเบียนในแอป
 */
import { useMemo } from 'react';
import { useWorkpieces } from '../../hooks/data';
import { t } from '../../lib/i18n';

export interface PickedCase { name: string; hn: string; works: string[] }

export function CasePicker({ studentId, patientName, hn, onPick }: {
  studentId: string;
  patientName: string;
  hn: string;
  onPick: (c: PickedCase) => void;
}) {
  const works = useWorkpieces(studentId);
  /* ผู้ป่วยคนเดียวอาจมีหลายชิ้นงาน — รวมเป็นรายคน แล้วเก็บชื่องานไว้ให้ครบทุกชิ้น */
  const cases = useMemo(() => {
    const byPatient = new Map<string, PickedCase>();
    for (const w of works) {
      const cur = byPatient.get(w.patient.id) ?? { name: w.patient.name, hn: w.patient.hn, works: [] };
      if (!cur.works.includes(w.detail)) cur.works.push(w.detail);
      byPatient.set(w.patient.id, cur);
    }
    return [...byPatient.values()];
  }, [works]);

  if (!cases.length) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <span style={{ display: 'block', font: '600 10.5px var(--font-body)', color: 'var(--text-faint)', marginBottom: 5 }}>
        {t('เลือกจากเคสของนักศึกษา — แตะแล้วเติมให้เอง')}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {cases.map((c) => (
          <button
            key={c.hn + c.name}
            type="button"
            className="chipbtn"
            data-on={c.hn === hn && c.name === patientName}
            title={c.works.join(' · ')}
            onClick={() => onPick(c)}
          >
            <b>{c.name}</b>
            <span style={{ font: '400 10px var(--font-mono)', opacity: 0.75 }}>{c.hn}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
