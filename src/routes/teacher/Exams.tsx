/**
 * การสอบ — OSCE และสอบ RPD design
 *
 * ผู้ใช้เคาะ 8 ก.ย. 69: สองอันนี้ทำเป็นแค่ช่องติ๊กพอ ไม่ต้องมีฟอร์มในแอป
 * OSCE เป็นข้อสอบที่จัดต่างหาก (เคยตัดออกไปแล้วเพราะ "เป็นสอบ ใช้กระดาษดีกว่า")
 * ส่วนสอบ RPD design มีใบอยู่ใน Section II แต่ปกติอาจารย์แค่กดอนุมัติ
 *
 * แยกเป็นหน้าของตัวเองเพราะเป็น "การสอบ" คนละเรื่องกับใบประเมินระหว่างทำเคส
 * และผลของทั้งสองอันเป็นเงื่อนไขจบ นักศึกษาเห็นในหน้าเกณฑ์ของตัวเอง
 */
import { CheckCircle, Circle, SealCheck } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { studentYear } from '../../domain/cohort';
import { groupShort } from '../../domain/group';
import { EXAM_GATE_KEYS, GATE_LABELS } from '../../domain/rules';
import { saYearNow } from '../../domain/saFeedback';
import { setStudentGate } from '../../data/repo';
import { useAllStudents } from '../../hooks/data';
import { t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';
import type { GateKey, Student } from '../../domain/types';

/** ชื่อการสอบที่คนในภาคเรียกกัน — โหมดอังกฤษ t() จะคืนป้ายเดียวกับ GATE_LABELS
 *  (ห้ามคืนสตริงดิบ ไม่งั้นสลับภาษาแล้วหัวตารางยังเป็นไทยอยู่) */
const EXAM_TH: Record<string, string> = {
  designRpd: 'สอบ RPD design',
  osce: 'OSCE',
};

const examName = (k: GateKey) => t(EXAM_TH[k] ?? GATE_LABELS[k]);

export default function Exams() {
  const { teacherGroup, showToast } = useApp();
  const students = useAllStudents();
  const year = saYearNow();
  const [busy, setBusy] = useState<string | null>(null);
  /* ⚠️ ต้องเป็น ref ไม่ใช่ state — state ยังไม่อัปเดตภายใน tick เดียวกัน
     กดรัวจะผ่านยามไปทุกครั้ง แล้วลง audit log ทีละแถว (วัดจริง: กด 6 ที ได้ 6 แถว)
     ธงนี้เป็นเงื่อนไขจบ log ต้องอ่านรู้เรื่อง ไม่ใช่กองซ้ำจากนิ้วลั่น */
  const saving = useRef(false);

  const roster = useMemo(
    () => students.filter((s) => s.group === teacherGroup).sort((a, b) => a.code.localeCompare(b.code)),
    [students, teacherGroup],
  );

  async function toggle(student: Student, key: GateKey, next: boolean) {
    const id = `${student.id}:${key}`;
    if (saving.current) return;
    saving.current = true;
    setBusy(id);
    try {
      await setStudentGate(student.id, key, next, currentActor());
      showToast({
        message: next
          ? t('{name} · {exam} ผ่านแล้ว', { name: student.name, exam: examName(key) })
          : t('{name} · {exam} ยังไม่ผ่าน', { name: student.name, exam: examName(key) }),
        tone: next ? 'success' : 'default',
      });
    } finally { saving.current = false; setBusy(null); }
  }

  const done = (key: GateKey) => roster.filter((s) => s.gates?.[key] === true).length;

  return (
    <TeacherShell active="exams">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('การสอบ')} · {groupShort(teacherGroup)}</h1>
            <p>
              {t('OSCE และสอบ RPD design — บันทึกแค่ผ่าน/ไม่ผ่าน ตัวข้อสอบใช้กระดาษตามเดิม')}
              {' · '}{t('ปีการศึกษา')} {year}
            </p>
          </div>
        </div>

        <div className="panel">
          <h3>{t('กลุ่ม')} {groupShort(teacherGroup)} · {roster.length} {t('คน')}</h3>
          <p className="sub">
            {EXAM_GATE_KEYS.map((k) => `${examName(k)} ${done(k)}/${roster.length}`).join(' · ')}
          </p>

          {/* หัวตารางบอกว่าคอลัมน์ไหนคือการสอบอะไร — จอแคบเลื่อนในแผงตัวเอง */}
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table className="tbl" style={{ minWidth: 460 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{t('นักศึกษา')}</th>
                  {EXAM_GATE_KEYS.map((k) => (
                    <th key={k} style={{ textAlign: 'center', minWidth: 150 }}>
                      <span style={{ display: 'block' }}>{examName(k)}</span>
                      {/* OSCE ชื่อไทยกับอังกฤษตัวเดียวกัน — ขึ้นสองบรรทัดจะดูเหมือนพิมพ์ซ้ำ */}
                      {examName(k) !== GATE_LABELS[k] && (
                        <span style={{ display: 'block', font: '400 9.5px var(--font-body)', color: 'var(--text-faint)' }}>
                          {GATE_LABELS[k]}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span style={{ display: 'block', font: '600 12px var(--font-body)' }}>{t(s.name)}</span>
                      <span style={{ display: 'block', font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)' }}>
                        {s.code} · {t('ปี {n}', { n: studentYear(s) })}
                      </span>
                    </td>
                    {EXAM_GATE_KEYS.map((k) => {
                      const v = s.gates?.[k];
                      return (
                        <td key={k} style={{ textAlign: 'center' }}>
                          <button
                            className="cellbtn"
                            disabled={busy !== null}
                            aria-pressed={v === true}
                            onClick={() => void toggle(s, k, v !== true)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38,
                              border: 0, background: 'none', cursor: 'pointer',
                              color: v === true ? 'var(--success-dark)' : 'var(--text-disabled)',
                              font: '600 11.5px var(--font-body)',
                            }}
                          >
                            {v === true ? <CheckCircle size={18} weight="fill" /> : <Circle size={18} />}
                            {v === true ? t('ผ่านแล้ว') : t('ยังไม่ผ่าน')}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ margin: '12px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
            <SealCheck size={13} style={{ verticalAlign: '-2px' }} />{' '}
            {t('ทั้งสองข้อเป็นเงื่อนไขจบ นักศึกษาเห็นผลในหน้าเกณฑ์ของตัวเอง · ทุกครั้งที่ติ๊กจะถูกบันทึกใน audit log')}
          </p>
        </div>
      </main>
    </TeacherShell>
  );
}
