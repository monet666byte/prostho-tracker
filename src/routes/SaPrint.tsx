/**
 * หน้าพิมพ์แบบประเมินตนเอง — หน้าเดียวใช้ได้ทั้งสองฝั่ง
 *   นักศึกษา  /app/self-assessment/print       (ของตัวเอง)
 *   อาจารย์   /teacher/sa/:studentId/print     (ของ นศ. ที่เลือก)
 *
 * แยกเป็นหน้าของตัวเองแทนการซ่อน/แสดงตอนพิมพ์ เพราะเอกสารที่จะเซ็นจริง
 * ต้องไม่มีโอกาสติดปุ่มหรือแถบเมนูของแอปหลุดไปบนกระดาษ
 */
import { ArrowLeft, Printer } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SaPrintSheet } from '../components/SaPrintSheet';
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
  const navigate = useNavigate();
  const studentId = fromRoute ?? session?.studentId;
  const student = useStudent(studentId);
  const sa = useSelfAssessment(studentId, saYearNow());
  const [ready, setReady] = useState(false);

  const teachers = useLiveQuery(() => db.teachers.toArray(), [], NO_TEACHERS) ?? NO_TEACHERS;
  const advisors = student ? teachers.filter((tc) => student.advisorIds.includes(tc.id)) : [];

  // ให้ข้อมูลวาดเสร็จก่อนค่อยปล่อยให้กดพิมพ์ — กันพิมพ์ออกมาเป็นหน้าว่าง
  useEffect(() => {
    if (student && sa !== undefined) setReady(true);
  }, [student, sa]);

  if (!student || !sa || sa.status !== 'submitted') {
    return (
      <div style={{ padding: 28, display: 'grid', gap: 12, placeItems: 'center', minHeight: '100vh', alignContent: 'center' }}>
        <span style={{ font: '600 14px var(--font-head)', color: 'var(--text-muted)' }}>
          {t('ยังไม่มีแบบประเมินที่ส่งแล้วของปีนี้')}
        </span>
        <button className="btn btn--sec" style={{ height: 42, width: 180 }} onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> {t('ย้อนกลับ')}
        </button>
      </div>
    );
  }

  return (
    <div className="saprint">
      <div
        className="noprint"
        style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 780, margin: '0 auto 14px' }}
      >
        <button className="btn btn--sec" style={{ height: 40, flex: '0 0 120px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> {t('ย้อนกลับ')}
        </button>
        <button className="btn" style={{ height: 40, flex: 1 }} disabled={!ready} onClick={() => window.print()}>
          <Printer size={16} weight="fill" /> {t('พิมพ์ / บันทึกเป็น PDF')}
        </button>
      </div>
      <p
        className="noprint"
        style={{ maxWidth: 780, margin: '0 auto 12px', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-faint)' }}
      >
        {t('ในหน้าต่างพิมพ์ เลือกปลายทางเป็น “บันทึกเป็น PDF” เพื่อได้ไฟล์ · ช่องลงนามอยู่ท้ายเอกสาร')}
      </p>
      <div className="a4wrap">
        <SaPrintSheet sa={sa} student={student} advisors={advisors} />
      </div>
    </div>
  );
}
