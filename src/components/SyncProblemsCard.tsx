import { retryQuarantined, type SyncProblem } from '../data/cloudSync';
import { useSyncProblems } from '../hooks/data';
import { t } from '../lib/i18n';
import { useApp } from '../store/app';

/** ชื่อตารางที่ผู้ใช้อ่านรู้เรื่อง — ตารางที่ไม่รู้จักแสดงชื่อดิบ ดีกว่าซ่อน */
const TABLE_LABEL: Record<string, string> = {
  checkins: 'คาบคลินิก',
  workpieces: 'ชิ้นงาน',
  updates: 'ประวัติขั้นตอน',
  patients: 'ผู้ป่วย',
  photos: 'รูปงาน',
  reviews: 'ผลตรวจงาน',
  sect2: 'ใบประเมิน Section II',
  sect3: 'ใบประเมิน Section III',
  selfAssessments: 'แบบประเมินตนเอง',
  students: 'รายชื่อนักศึกษา',
  groups: 'กลุ่ม',
};

/** เหตุผลที่ผู้ใช้อ่านรู้เรื่อง — รหัสที่รู้จักแปลให้ ที่เหลือแสดงข้อความของเซิร์ฟเวอร์ตามจริง */
function problemText(p: SyncProblem): string {
  if (p.kind === 'delete') return t('เซิร์ฟเวอร์ไม่ให้ลบ จึงนำรายการกลับมาแสดง') + ' · ' + p.reason;
  // 0029: นักศึกษาคนเดียวเช็คอินวันเดียวกันจากสองเครื่อง — แถวของเครื่องที่ขึ้นทีหลังถูกปฏิเสธ
  if (p.reason.includes('checkins_student_date_uidx')) {
    return t('วันนั้นเช็คอินจากอีกเครื่องไปแล้ว — คาบนี้ซ้ำ ย้ายโน้ตที่ต้องการไปคาบเดิม แล้วลบคาบนี้ได้');
  }
  return p.reason;
}

/**
 * ของที่เซิร์ฟเวอร์ปฏิเสธจนเลิกลองแล้ว — ต้องเห็นด้วยตา ไม่ย่อเหลือบรรทัดจาง
 *
 * ใช้ใบเดียวกันทั้งหน้าตั้งค่าของนักศึกษาและของอาจารย์ · เดิมมีเฉพาะฝั่งนักศึกษา:
 * คะแนนหรือใบประเมินของอาจารย์ที่ถูกปฏิเสธหายจากสายตาไปเลยโดยไม่มีหน้าไหนบอก
 * ไม่มีปัญหา = ไม่วาดอะไรเลย
 */
export function SyncProblemsCard() {
  const problems = useSyncProblems();
  const { showToast } = useApp();
  if (!problems.length) return null;
  return (
    <div className="formrow formrow--stack formrow--warn">
      <b>{t('{n} รายการส่งขึ้นเซิร์ฟเวอร์ไม่ได้', { n: problems.length })}</b>
      <span className="formrow__sub" style={{ color: 'var(--warning-dark)' }}>
        {t('ยังอยู่ในเครื่องนี้ครบ แต่คนอื่นยังไม่เห็น — ถ้ากดลองใหม่แล้วยังไม่ขึ้น ให้แจ้งผู้ดูแลระบบ')}
      </span>
      {problems.slice(0, 5).map((p) => (
        <span key={p.table + String(p.key)} style={{ font: '400 12px/1.55 var(--font-body)', color: 'var(--warning-dark)' }}>
          {t(TABLE_LABEL[p.table] ?? p.table)} · <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(p.key)}</span> — {problemText(p)}
        </span>
      ))}
      <button
        className="textlink textlink--left"
        onClick={() => { retryQuarantined(); showToast({ message: t('ใส่กลับเข้าคิวแล้ว'), tone: 'default' }); }}
      >
        {t('ลองส่งใหม่')} ›
      </button>
    </div>
  );
}
