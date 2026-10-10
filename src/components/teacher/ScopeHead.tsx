import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useAllStudents } from '../../hooks/data';
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
  scope, icon: IconC, title, sub, right,
}: {
  scope: 'group' | 'year' | 'setup';
  icon: Icon;
  title: ReactNode;
  /** บรรทัดรองเพิ่มเติม — หน้ากลุ่มจะมีบรรทัดบอกกลุ่มนำหน้าให้เอง */
  sub?: ReactNode;
  /** ของชิดขวา เช่น แท็บชั้นปี */
  right?: ReactNode;
}) {
  const group = useApp((st) => st.teacherGroup);
  const students = useAllStudents();
  let groupLine: string | null = null;
  if (scope === 'group' && group) {
    const members = students.filter((s) => s.group === group);
    const y = members[0] ? studentYear(members[0]) : null;
    /* ป้ายชั้นปีกติกาเดียวกับตัวเลือกกลุ่มในแถบซ้าย — รุ่นที่จบ/ยังไม่เริ่มไม่มี "ปี 7" หรือ "ปี 4" */
    const yearLabel = y === null ? null
      : y > CLINIC_LAST_YEAR ? `${t('จบแล้ว')} ${studentCohortLabel(members[0])}`
        : y < CLINIC_START_YEAR ? `${t('ยังไม่เริ่ม')} ${studentCohortLabel(members[0])}`
          : t('ปี {n}', { n: y });
    groupLine = [t('กลุ่ม {g}', { g: groupShort(group) }), yearLabel, t('{n} คน', { n: members.length })].filter(Boolean).join(' · ');
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
