/**
 * แถวเลือกเคสของนักศึกษาบนหัวฟอร์มประเมิน
 *
 * บนกระดาษช่อง "Patient name / H.N." เขียนมือ แต่ในแอปไม่ต้องพิมพ์ —
 * ระบบรู้อยู่แล้วว่านักศึกษาคนนี้มีเคสอะไรบ้าง แตะทีเดียวเติมให้ครบ (ผู้ใช้ขอ 7 ก.ย. 69)
 * เร็วกว่า และไม่มีพิมพ์ H.N. ผิด ซึ่งเป็นเลขที่ใช้ตามตัวผู้ป่วยจริง
 * ช่องพิมพ์เองยังอยู่ เผื่อเคสที่ยังไม่ได้ลงทะเบียนในแอป
 *
 * ⚠️ ต้องกรองตามชนิดของใบที่กำลังกรอก (10 ก.ย. 69)
 * เดิมเสนอเคสทั้งหมดของนักศึกษาโดยไม่ดูว่าใบนี้เป็นใบอะไร — ใบ Removable
 * ก็เสนอเคส Post-core ให้กด แล้วเติม "37 Post-core crown (cast post)" ลงช่อง
 * ประเภทงานของใบงานถอดได้เฉยๆ อาจารย์กดเร็วๆ ไม่ทันดูก็บันทึกไปแล้ว
 * และเงื่อนไขจบ sect2Removable ก็ติ๊กผ่านจากใบที่กรอกด้วยเคสงานติดแน่น
 */
import { useMemo } from 'react';
import { useWorkpieces } from '../../hooks/data';
import { t } from '../../lib/i18n';
import type { WorkType } from '../../domain/types';

export interface PickedCase { name: string; hn: string; works: string[] }

/** ใบประเมินแต่ละแบบรับเคสประเภทไหนได้บ้าง — คีย์ตรงกับ formKey ของ Sect II และ group ของ Sect III */
export type CaseScope = 'removable' | 'fixed' | 'rpdDesign' | 'CD' | 'RPD' | 'FDP';

const SCOPE_TYPES: Record<CaseScope, readonly WorkType[]> = {
  removable: ['CD', 'RPD', 'APD'],
  fixed: ['PC', 'CB'],
  // ใบ RPD design ใช้กับงานที่มีการออกแบบโครง — Simple APD ก็ต้องออกแบบเหมือนกัน
  rpdDesign: ['RPD', 'APD'],
  CD: ['CD'],
  RPD: ['RPD', 'APD'],
  FDP: ['PC', 'CB'],
};

const SCOPE_LABEL: Record<CaseScope, string> = {
  removable: 'งานถอดได้',
  fixed: 'งานติดแน่น',
  rpdDesign: 'งาน RPD',
  CD: 'งาน CD',
  RPD: 'งาน RPD',
  FDP: 'งานติดแน่น',
};

export function CasePicker({ studentId, scope, patientName, hn, onPick }: {
  studentId: string;
  /** ใบที่กำลังกรอกเป็นแบบไหน — ใช้กรองว่าจะเสนอเคสไหนให้กด */
  scope: CaseScope;
  patientName: string;
  hn: string;
  onPick: (c: PickedCase) => void;
}) {
  const works = useWorkpieces(studentId);
  /* ผู้ป่วยคนเดียวอาจมีหลายชิ้นงาน — รวมเป็นรายคน แล้วเก็บชื่องานไว้ให้ครบทุกชิ้น
     แต่เก็บเฉพาะชิ้นที่เข้ากับใบนี้ ไม่งั้นผู้ป่วยที่มีทั้งงานถอดได้และงานติดแน่น
     จะเติมชื่องานอีกฝั่งพ่วงมาด้วย */
  const cases = useMemo(() => {
    const allow = SCOPE_TYPES[scope];
    const byPatient = new Map<string, PickedCase>();
    for (const w of works) {
      if (!allow.includes(w.type)) continue;
      const cur = byPatient.get(w.patient.id) ?? { name: w.patient.name, hn: w.patient.hn, works: [] };
      if (!cur.works.includes(w.detail)) cur.works.push(w.detail);
      byPatient.set(w.patient.id, cur);
    }
    return [...byPatient.values()];
  }, [works, scope]);

  const label = t(SCOPE_LABEL[scope]);

  /* ไม่มีเคสที่เข้ากับใบนี้ — บอกตรงๆ ดีกว่าเงียบ ไม่งั้นอาจารย์จะสงสัยว่าทำไมไม่มีปุ่มให้กด
     (ช่องพิมพ์เองอยู่ข้างล่างอยู่แล้ว จึงไม่ได้ปิดทางใคร) */
  if (!cases.length) {
    return (
      <span style={{ display: 'block', font: '500 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 12 }}>
        {t('นักศึกษาคนนี้ยังไม่มีเคส{k} — พิมพ์ชื่อผู้ป่วยเองได้', { k: label })}
      </span>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <span style={{ display: 'block', font: '600 10.5px var(--font-body)', color: 'var(--text-faint)', marginBottom: 5 }}>
        {t('เลือกจากเคสของนักศึกษา · {k} — แตะแล้วเติมให้เอง', { k: label })}
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
