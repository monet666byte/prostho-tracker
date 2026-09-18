/**
 * หน้าพิมพ์แบบประเมินตนเอง — หน้าเดียวใช้ได้ทั้งสองฝั่ง
 *   นักศึกษา  /app/self-assessment/print       (ของตัวเอง)
 *   อาจารย์   /teacher/sa/:studentId/print     (ของ นศ. ที่เลือก)
 *
 * แยกเป็นหน้าของตัวเองแทนการซ่อน/แสดงตอนพิมพ์ เพราะเอกสารที่จะเซ็นจริง
 * ต้องไม่มีโอกาสติดปุ่มหรือแถบเมนูของแอปหลุดไปบนกระดาษ
 */
import { useParams } from 'react-router-dom';
import { PrintEmpty, PrintToolbar } from '../components/PrintShell';
import { SaPrintSheet } from '../components/SaPrintSheet';
import { SheetBoundary } from '../components/SheetBoundary';
import { db } from '../data/db';
import { saYearNow } from '../domain/saFeedback';
import { useSelfAssessment, useStudent } from '../hooks/data';
import { useLiveQuery } from 'dexie-react-hooks';
import { t } from '../lib/i18n';
import { useApp } from '../store/app';
import type { Teacher } from '../domain/types';

const NO_TEACHERS: Teacher[] = [];

export default function SaPrint() {
  const { studentId: fromRoute } = useParams();
  const session = useApp((s) => s.session);
  const studentId = fromRoute ?? session?.studentId;
  const student = useStudent(studentId);
  const sa = useSelfAssessment(studentId, saYearNow());
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], NO_TEACHERS) ?? NO_TEACHERS;
  const advisors = student ? teachers.filter((tc) => student.advisorIds.includes(tc.id)) : [];

  // ถึงตรงนี้ได้แปลว่าข้อมูลครบแล้ว (ด่านด้านล่างคืนหน้าว่างถ้ายังไม่มีใบที่ส่ง) ปุ่มพิมพ์จึงกดได้เสมอ
  if (!student || !sa || sa.status !== 'submitted') {
    return <PrintEmpty message={t('ยังไม่มีแบบประเมินที่ส่งแล้วของปีนี้')} />;
  }

  return (
    <div className="saprint">
      <PrintToolbar hint={t('ในหน้าต่างพิมพ์ เลือกปลายทางเป็น “บันทึกเป็น PDF” เพื่อได้ไฟล์ · ช่องลงนามอยู่ท้ายเอกสาร')} />
      <div className="a4wrap">
        {/* ใบเดียวก็ต้องมีตาข่าย — แถวที่ข้อมูลไม่ครบต้องได้กรอบแจ้งเตือน ไม่ใช่หน้าว่างทั้งหน้า */}
        <SheetBoundary label="SA">
          <SaPrintSheet sa={sa} student={student} advisors={advisors} />
        </SheetBoundary>
      </div>
    </div>
  );
}
