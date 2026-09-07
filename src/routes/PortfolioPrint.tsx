/**
 * หน้าพิมพ์สมุด portfolio — ใช้ร่วมกันสองทาง (แบบเดียวกับหน้าพิมพ์ SA)
 *   อาจารย์    /teacher/portfolio/:studentId/print   (ของ นศ. ที่เลือก)
 *   นักศึกษา   /app/portfolio/print                  (ของตัวเอง — ไม่มี :studentId)
 *
 * แยกเป็นหน้าของตัวเองเพราะเอกสารที่จะเซ็นจริง
 * ต้องไม่มีโอกาสติดปุ่มหรือแถบเมนูของแอปหลุดไปบนกระดาษ
 *
 * ⚠️ พิมพ์เฉพาะใบที่ประเมินเสร็จแล้ว — ใบที่อาจารย์กรอกค้างไว้ต้องไม่หลุดออกกระดาษ
 * (ข้อความใต้ปุ่มเขียนไว้แบบนี้มาตลอด แต่โค้ดเดิมส่งทุกแถวเข้าไปพิมพ์จริงๆ)
 */
import { ArrowLeft, Printer } from '@phosphor-icons/react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store/app';
import { PortfolioPrintSheet } from '../components/PortfolioPrintSheet';
import { saYearNow } from '../domain/saFeedback';
import { useSect2, useSect3, useStudent } from '../hooks/data';
import { t } from '../lib/i18n';

export default function PortfolioPrint() {
  const { studentId: fromRoute } = useParams();
  const session = useApp((s) => s.session);
  // ไม่มี :studentId = นักศึกษาเปิดสมุดตัวเอง
  const studentId = fromRoute ?? session?.studentId;
  const navigate = useNavigate();
  const year = saYearNow();
  const student = useStudent(studentId);
  const allSect2 = useSect2(studentId, year);
  const allSect3 = useSect3(studentId, year);
  // ใบร่างต้องไม่ออกกระดาษ — ใบให้คะแนนดูที่ total · ใบ RPD design ดูที่ passed
  const sect2 = allSect2.filter((r) => (r.formKey === 'rpdDesign' ? r.passed != null : r.total != null));
  const sect3 = allSect3.filter((r) => r.total != null);
  const count = sect2.length + sect3.length;
  // ให้ข้อมูลวาดเสร็จก่อนค่อยปล่อยให้กดพิมพ์ — กันพิมพ์ออกมาเป็นหน้าว่าง
  // คำนวณตรงๆ ได้ ไม่ต้องเป็น state (state จะทำให้ render สองรอบโดยไม่ได้อะไร)
  const ready = !!student && count > 0;

  if (!student || count === 0) {
    return (
      <div style={{ padding: 28, display: 'grid', gap: 12, placeItems: 'center', minHeight: '100vh', alignContent: 'center' }}>
        <span style={{ font: '600 14px var(--font-head)', color: 'var(--text-muted)' }}>
          {t('ยังไม่มีใบที่ประเมินแล้วของปีนี้')}
        </span>
        <button className="btn btn--sec" style={{ height: 42, width: 180 }} onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> {t('ย้อนกลับ')}
        </button>
      </div>
    );
  }

  return (
    <div className="saprint">
      <div className="noprint" style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 780, margin: '0 auto 14px' }}>
        <button className="btn btn--sec" style={{ height: 40, flex: '0 0 120px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> {t('ย้อนกลับ')}
        </button>
        <button className="btn" style={{ height: 40, flex: 1 }} disabled={!ready} onClick={() => window.print()}>
          <Printer size={16} weight="fill" /> {t('พิมพ์ / บันทึกเป็น PDF')}
        </button>
      </div>
      <p className="noprint" style={{ maxWidth: 780, margin: '0 auto 12px', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
        {t('พิมพ์เฉพาะใบที่ประเมินแล้ว · ช่องที่กาไว้จะเป็นพื้นทึบ อ่านออกบนเครื่องพิมพ์ขาวดำ · ลงนามบนกระดาษที่พิมพ์ออกมา')}
      </p>
      <div className="a4wrap">
        <PortfolioPrintSheet student={student} sect2={sect2} sect3={sect3} />
      </div>
    </div>
  );
}
