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
import { useParams } from 'react-router-dom';
import { isSect2Evaluated } from '../domain/sect2';
import { isSect3Evaluated } from '../domain/sect3';
import { useApp } from '../store/app';
import { PortfolioPrintSheet } from '../components/PortfolioPrintSheet';
import { PrintEmpty, PrintToolbar } from '../components/PrintShell';
import { saYearNow } from '../domain/saFeedback';
import { useSect2, useSect3, useStudent } from '../hooks/data';
import { t } from '../lib/i18n';

export default function PortfolioPrint() {
  const { studentId: fromRoute } = useParams();
  const session = useApp((s) => s.session);
  // ไม่มี :studentId = นักศึกษาเปิดสมุดตัวเอง
  const studentId = fromRoute ?? session?.studentId;
  const year = saYearNow();
  const student = useStudent(studentId);
  const allSect2 = useSect2(studentId, year);
  const allSect3 = useSect3(studentId, year);
  // ใบร่างต้องไม่ออกกระดาษ — ใบให้คะแนนดูที่ total · ใบ RPD design ดูที่ passed
  const sect2 = allSect2.filter(isSect2Evaluated);
  const sect3 = allSect3.filter(isSect3Evaluated);
  const count = sect2.length + sect3.length;
  if (!student || count === 0) {
    return <PrintEmpty message={t('ยังไม่มีใบที่ประเมินแล้วของปีนี้')} />;
  }

  return (
    <div className="saprint">
      <PrintToolbar hint={t('พิมพ์เฉพาะใบที่ประเมินแล้ว · ช่องที่กาไว้จะเป็นพื้นทึบ อ่านออกบนเครื่องพิมพ์ขาวดำ · ลงนามบนกระดาษที่พิมพ์ออกมา')} />
      <div className="a4wrap">
        <PortfolioPrintSheet student={student} sect2={sect2} sect3={sect3} />
      </div>
    </div>
  );
}
