/**
 * แบบประเมินตนเองฉบับพิมพ์ (A4) — สำหรับให้อาจารย์ลงนามแล้วเก็บเข้าแฟ้มภาค
 *
 * ทำไมต้องมี: ฟอร์มเดิมเป็น Word ที่ปริ้นท์ไปเซ็น ถ้าแอปพิมพ์ไม่ได้ ภาคจะเสียหลักฐานที่เคยมี
 * (ผู้ใช้สั่งทำล่วงหน้า 4 ก.ย. 69 ระหว่างรอคำยืนยันจากอาจารย์ว่าต้องใช้กระดาษจริงไหม)
 *
 * หน้าตายึดตามฟอร์มจริง: หัวข้อภาษาอังกฤษ ตาราง Topics|Assessment และช่องลงนามท้ายเอกสาร
 */
import { buildFeedback, sortFeedback } from '../domain/saFeedback';
import {
  SA_APPROPRIATE, SA_SCALE, SA_SOURCE, saSectionsFor,
  type SAQuestion, type SAValue,
} from '../domain/selfAssessment';
import { useAllCheckIns, useAllProgressUpdates, useAllWorkpieces } from '../hooks/data';
import { thaiLong } from '../lib/date';
import { lang, t } from '../lib/i18n';
import { useApp } from '../store/app';
import type { SelfAssessment, Student, Teacher } from '../domain/types';

/** ค่าที่พิมพ์ลงกระดาษ — ตัวเลขต้องมีคำกำกับเสมอ คนอ่านกระดาษไม่มี tooltip ให้ชี้ */
function printable(q: SAQuestion, v: SAValue | undefined): string {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.join(' · ');
  if (typeof v === 'number') {
    if (q.kind === 'level') return v === SA_APPROPRIATE ? 'Appropriate' : 'Need improvement';
    if (q.kind === 'yesno') return v === 1 ? 'Yes' : 'No';
    if (v < 0) return 'N/A';
    const s = SA_SCALE.find((x) => x.v === v);
    return s ? `${v} — ${s.label}` : String(v);
  }
  return String(v);
}

export function SaPrintSheet({
  sa, student, advisors,
}: {
  sa: SelfAssessment;
  student: Student;
  advisors: Teacher[];
}) {
  const settings = useApp((s) => s.settings);
  const allWorks = useAllWorkpieces();
  const allCheckins = useAllCheckIns();
  const allUpdates = useAllProgressUpdates();

  const works = allWorks.filter((w) => w.studentId === sa.studentId);
  const checkins = allCheckins.filter((c) => c.studentId === sa.studentId);
  const cards = sortFeedback(buildFeedback({ sa, student, works, checkins, updates: allUpdates, settings }));
  const sections = saSectionsFor(sa.classYear);

  return (
    <div className="a4 a4--sa">
      <h1>Self-assessment (SA) report: MIDS Prosthodontic Clinic {sa.academicYear}</h1>
      <div className="sub">
        {/* ห้ามใส่ค่าสำรองที่ดูสมจริงบนเอกสารที่เซ็นจริง — ไม่มีข้อมูลต้องเห็นว่าว่าง */}
        {t(student.name)} · {student.code} · {student.group} · Year {sa.classYear}
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
        const plain = s.questions.filter((q) => !q.row);
        return (
          <div className="sasec" key={s.key}>
            <h2>{s.title}</h2>
            {s.note && <div className="sacaption">{s.note}</div>}

            {ksRows.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th className="saq">Prosthodontic procedures</th>
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
                        <td>{k ? printable(k, sa.answers[k.key] as SAValue) : ''}</td>
                        <td>{sk ? printable(sk, sa.answers[sk.key] as SAValue) : ''}</td>
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
                    <tr key={q.key}>
                      <td className="saq">{q.label}</td>
                      <td>{printable(q, sa.answers[q.key] as SAValue) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {/* สรุปอัตโนมัติ + ความเห็นอาจารย์ พิมพ์ต่อท้ายเฉพาะที่อาจารย์ปล่อยแล้ว
          ยังไม่ปล่อย = ยังไม่ได้ตรวจ ไม่ควรกลายเป็นเอกสารในแฟ้ม */}
      {sa.feedbackReleasedAt && (
        <div className="sasec">
          <h2>Summary from the tracking system</h2>
          <div className="sacaption">
            Generated from fixed rules comparing the answers above with recorded clinical work — discussion points, not a judgement.
          </div>
          {cards.map((c) => (
            <div className="sacard" key={c.id}>
              <b>{c.title}</b>
              <p>{c.body}</p>
              <span className="ev">{c.evidence}</span>
            </div>
          ))}
          {sa.advisorNote && (
            <>
              <div className="sacaption" style={{ marginTop: 8 }}>
                {lang === 'en' ? "Advisor's comment" : 'ความเห็นของอาจารย์ที่ปรึกษา'}
              </div>
              <div className="sanote">{sa.advisorNote}</div>
            </>
          )}
        </div>
      )}

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
