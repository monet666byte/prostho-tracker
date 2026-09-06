/**
 * แบบประเมินตนเองฉบับพิมพ์ (A4) — สำหรับให้อาจารย์ลงนามแล้วเก็บเข้าแฟ้มภาค
 *
 * ทำไมต้องมี: ฟอร์มเดิมเป็น Word ที่ปริ้นท์ไปเซ็น ถ้าแอปพิมพ์ไม่ได้ ภาคจะเสียหลักฐานที่เคยมี
 * (ผู้ใช้สั่งทำล่วงหน้า 4 ก.ย. 69 ระหว่างรอคำยืนยันจากอาจารย์ว่าต้องใช้กระดาษจริงไหม)
 *
 * หน้าตายึดตามฟอร์มจริง: หัวข้อภาษาอังกฤษ ตาราง Topics|Assessment และช่องลงนามท้ายเอกสาร
 */
import { Fragment } from 'react';
import {
  SA_APPROPRIATE, SA_SCALE, SA_SOURCE, saCourseCode, saOtherText, saSectionsFor,
  type SAQuestion, type SAValue,
} from '../domain/selfAssessment';
import { thaiLong } from '../lib/date';
import { t } from '../lib/i18n';
import type { SelfAssessment, Student, Teacher } from '../domain/types';

/** ค่าที่พิมพ์ลงกระดาษ — ตัวเลขต้องมีคำกำกับเสมอ คนอ่านกระดาษไม่มี tooltip ให้ชี้ */
function printable(q: SAQuestion, v: SAValue | undefined, answers: Record<string, SAValue>): string {
  // เอกสารที่เซ็นต้องมีทุกอย่างที่ นศ. เขียน รวมช่อง "อื่นๆ" ที่เก็บคนละคีย์
  const extra = answers ? saOtherText(q, answers) : '';
  const join = (main: string) => [main, extra].filter(Boolean).join(' · ');
  if (v === undefined || v === null || v === '') return extra;
  if (Array.isArray(v)) return join(v.join(' · '));
  if (typeof v === 'number') {
    if (q.kind === 'level') return v === SA_APPROPRIATE ? 'Appropriate' : 'Need improvement';
    if (q.kind === 'yesno') return v === 1 ? 'Yes' : 'No';
    if (v < 0) return 'N/A';
    const s = SA_SCALE.find((x) => x.v === v);
    return join(s ? `${v} — ${s.label}` : String(v));
  }
  return join(String(v));
}

export function SaPrintSheet({
  sa, student, advisors, courseCode,
}: {
  sa: SelfAssessment;
  student: Student;
  advisors: Teacher[];
  /** รหัสวิชาบนหัวเอกสาร — ปกติคิดจากชั้นปี (ปี 5 DTPT502 · ปี 6 DTPT602) ส่งมาทับได้ถ้าภาคเปลี่ยน */
  courseCode?: string;
}) {
  const sections = saSectionsFor(sa.classYear);
  const course = courseCode ?? saCourseCode(sa.classYear);

  return (
    <div className="a4 a4--sa">
      <h1>Self-assessment (SA) report: MIDS Prosthodontic Clinic {sa.academicYear}</h1>
      <div className="sub">
        {/* ห้ามใส่ค่าสำรองที่ดูสมจริงบนเอกสารที่เซ็นจริง — ไม่มีข้อมูลต้องเห็นว่าว่าง */}
        {t(student.name)} · {student.code} · {student.group} · {course} Year {sa.classYear} MIDS
        {advisors.length > 0 && <> · Advisors: {advisors.map((a) => t(a.name)).join(', ')}</>}
      </div>
      <div className="sub">
        Submitted {sa.submittedAt ? thaiLong(sa.submittedAt) : '—'} · Printed {thaiLong(new Date())} · Form {sa.formVersion}
      </div>
      <div className="sacaption">Scoring rubrics: 0 – Very low · 1 – Low · 2 – Moderate · 3 – High · 4 – Very high</div>
      <div className="sacaption">Based on {SA_SOURCE}</div>

      {sections.map((s) => {
        // ตาราง K/S ในฟอร์มจริงเป็น 3 คอลัมน์ (Topic | K | S) — คงรูปเดิมไว้ อาจารย์คุ้นตาแบบนี้
        const ksRows = [...new Set(s.questions.filter((q) => q.row).map((q) => q.row!))];
        /* ข้อที่ตั้ง printMerge ไม่ขึ้นแถวของตัวเอง — ไปต่อท้ายคำตอบของข้อก่อนหน้า
           เพื่อให้กระดาษหน้าตาเหมือนฟอร์ม Word ที่เป็นข้อความยาวช่องเดียว */
        const plain = s.questions.filter((q) => !q.row && !q.printMerge);
        const mergedInto = new Map<string, SAQuestion[]>();
        let prev: SAQuestion | undefined;
        for (const q of s.questions) {
          if (q.row) continue;
          if (q.printMerge && prev) mergedInto.set(prev.key, [...(mergedInto.get(prev.key) ?? []), q]);
          else prev = q;
        }
        const cell = (q: SAQuestion) => [
          printable(q, sa.answers[q.key] as SAValue, sa.answers as Record<string, SAValue>),
          ...(mergedInto.get(q.key) ?? []).map((m) => printable(m, sa.answers[m.key] as SAValue, sa.answers as Record<string, SAValue>)),
        ].filter(Boolean).join(' · ');
        return (
          <div className="sasec" key={s.key} style={s.printContinues ? { marginTop: 8 } : undefined}>
            {!s.printContinues && <h2>{s.title}</h2>}
            {s.note && !s.printContinues && <div className="sacaption">{s.note}</div>}

            {ksRows.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th className="saq">Prosthodontic procedures;</th>
                    <th style={{ width: '27%' }}>Knowledge (K)</th>
                    <th style={{ width: '27%' }}>Skill (S)</th>
                  </tr>
                </thead>
                <tbody>
                  {ksRows.map((row) => {
                    const k = s.questions.find((q) => q.row === row && q.col === 'K');
                    const sk = s.questions.find((q) => q.row === row && q.col === 'S');
                    return (
                      <tr key={row}>
                        <td className="saq">{k?.label ?? row}</td>
                        <td>{k ? printable(k, sa.answers[k.key] as SAValue, sa.answers as Record<string, SAValue>) : ''}</td>
                        <td>{sk ? printable(sk, sa.answers[sk.key] as SAValue, sa.answers as Record<string, SAValue>) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {plain.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th className="saq">Topics</th>
                    <th>Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {plain.map((q) => (
                    <Fragment key={q.key}>
                    {q.sub && (
                      <tr><td className="saq" colSpan={2} style={{ fontWeight: 600, background: '#f9fafb' }}>{q.sub}</td></tr>
                    )}
                    <tr>
                      <td className="saq">{q.label}</td>
                      <td>{cell(q) || '—'}</td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <div className="sign">
        <div>
          <div className="line" />
          <div className="cap">{t('ลงนามนักศึกษา')}</div>
        </div>
        <div>
          <div className="line" />
          <div className="cap">{t('ลงนามอาจารย์ที่ปรึกษา')}</div>
        </div>
        <div>
          <div className="line" />
          <div className="cap">{t('วันที่')}</div>
        </div>
      </div>
    </div>
  );
}
