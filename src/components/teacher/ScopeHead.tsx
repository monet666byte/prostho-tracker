import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useAllStudents } from '../../hooks/data';
import { usePhone } from '../../hooks/usePhone';
import { CLINIC_LAST_YEAR, CLINIC_START_YEAR, studentCohortLabel, studentYear } from '../../domain/cohort';
import { groupShort } from '../../domain/group';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

/**
 * หัวหน้าของทุกหน้าฝั่งอาจารย์ — บอกว่าตัวเลขในหน้านี้นับจากใคร
 *
 * สีตรงกับสองหมวดในแถบเมนูซ้าย และสองโซนในหน้าแรก:
 * - group: พื้นฟ้าอ่อน + บรรทัดรอง "กลุ่ม PT7 · ปี 5 · 8 คน" (กลุ่มที่เลือกอยู่ในแถบซ้าย)
 * - year: พื้นกลาง สำหรับหน้าที่ดูทั้งชั้นปี
 * - setup: ไม่มีพื้น สำหรับหน้าตั้งค่า/ข้อมูล
 */
export function ScopeHead({
  scope, icon: IconC, title, sub, right, phoneTitle, phoneSub, phoneEye,
}: {
  scope: 'group' | 'year' | 'setup';
  icon: Icon;
  title: ReactNode;
  /** บรรทัดรองเพิ่มเติม — หน้ากลุ่มจะมีบรรทัดบอกกลุ่มนำหน้าให้เอง */
  sub?: ReactNode;
  /** ของชิดขวา เช่น แท็บชั้นปี */
  right?: ReactNode;
  /** มือถือ: ชื่อหน้าแบบสั้น (หัวตัวใหญ่บรรทัดเดียว) · ไม่ใส่ = ใช้ title */
  phoneTitle?: ReactNode;
  /** มือถือ: null = ไม่แสดงบรรทัดรอง (ตัดตัวหนังสือ) · ไม่ใส่ = ใช้ sub */
  phoneSub?: ReactNode | null;
  /** มือถือ: บรรทัดเล็กเหนือชื่อหน้า สำหรับหน้าที่ไม่ใช่ของกลุ่ม · หน้ากลุ่มได้ชื่อกลุ่มเอง */
  phoneEye?: ReactNode;
}) {
  const phone = usePhone();
  const group = useApp((st) => st.teacherGroup);
  const students = useAllStudents();
  let groupLine: string | null = null;
  if (scope === 'group' && group) {
    const members = students.filter((s) => s.group === group);
    const yearLabel = yearLabelOf(members);
    groupLine = [t('กลุ่ม {g}', { g: groupShort(group) }), yearLabel, t('{n} คน', { n: members.length })].filter(Boolean).join(' · ');
  }
  /* มือถือ: ไม่มีกล่อง/ไอคอน — บรรทัดเล็กสีเทาบอกกลุ่ม แล้วชื่อหน้าตัวใหญ่ (ชุดเดียวกับหน้าประเมิน) */
  if (phone) {
    const eye = phoneEye ?? (scope === 'group' && group ? [groupShort(group), yearLabelOf(students.filter((s) => s.group === group))]
      .filter(Boolean).join(' · ') : '');
    const line = phoneSub === null ? null : phoneSub ?? sub;
    return (
      <div className="tpg__hd">
        {eye && <div className="tpg__eye">{eye}</div>}
        <h1 className="tpg__h1">{phoneTitle ?? title}</h1>
        {line && <p className="tpg__sub">{line}</p>}
        {right && <div className="tpg__right">{right}</div>}
      </div>
    );
  }
  return (
    <div className={`main__head scopehead scopehead--${scope}`}>
      <span className="scopehead__ic" aria-hidden><IconC size={18} weight={scope === 'group' ? 'bold' : 'regular'} /></span>
      <div className="scopehead__title">
        <h1>{title}</h1>
        {(groupLine || sub) && (
          <p>
            {groupLine}
            {groupLine && sub && ' · '}
            {sub}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

/* ป้ายชั้นปีกติกาเดียวกับตัวเลือกกลุ่มในแถบซ้าย — รุ่นที่จบ/ยังไม่เริ่มไม่มี "ปี 7" หรือ "ปี 4" */
function yearLabelOf(members: ReturnType<typeof useAllStudents>): string | null {
  const y = members[0] ? studentYear(members[0]) : null;
  return y === null ? null
    : y > CLINIC_LAST_YEAR ? `${t('จบแล้ว')} ${studentCohortLabel(members[0])}`
      : y < CLINIC_START_YEAR ? `${t('ยังไม่เริ่ม')} ${studentCohortLabel(members[0])}`
        : t('ปี {n}', { n: y });
}
