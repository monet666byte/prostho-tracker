/**
 * หน้าพิมพ์ Section II + III — วางให้เหมือนหน้ากระดาษในสมุดทีละใบ
 *
 * ทำไมต้องมี: ทุกใบในสมุดมีลายเซ็นอาจารย์ ซึ่งเซ็นในแอปไม่ได้ (พิสูจน์ไม่ได้ว่าใครเซ็น)
 * ถ้าไม่มีหน้าพิมพ์ อาจารย์ต้องคีย์ในแอปแล้วไปเขียนกระดาษอีกรอบ = พิมพ์สองรอบ ไม่มีใครทำ
 * มีหน้านี้แล้วกลายเป็น คีย์ครั้งเดียว → พิมพ์ → เซ็นบนกระดาษที่พิมพ์ออกมา
 *
 * ช่องที่อาจารย์กาไว้จะถูกตีกรอบทึบ ช่องที่เหลือยังพิมพ์ตัวเลขไว้เหมือนกระดาษเปล่า
 * เพื่อให้คนอ่านทวนเห็นว่าเกณฑ์แต่ละระดับให้กี่คะแนน
 */
import {
  RPD_DESIGN_GROUPS, RPD_DESIGN_REMARK, S2_FULL_SCORE, S2_GRADES, sect2Form,
} from '../domain/sect2';
import { S3_FULL_SCORE, s3Points, sect3Form } from '../domain/sect3';
import { SheetBoundary } from './SheetBoundary';
import { thaiShort } from '../lib/date';
import { t } from '../lib/i18n';
import type { Sect2Record, Sect3Record, Student } from '../domain/types';

const PORTFOLIO_TITLE = 'Clinical Performance Portfolio';

function Head({ section, code, student }: { section: string; code: string; student: Student }) {
  return (
    <>
      <div className="pfhead">
        <div>
          {PORTFOLIO_TITLE}
          <br />
          {section}
        </div>
        <div className="pfcode">{code}</div>
      </div>
      <div className="pffield">
        <span>Student full name <b>{student.name}</b></span>
        <span>ID <b className="mono">{student.code}</b></span>
        <span>Group <b>{student.group}</b></span>
      </div>
    </>
  );
}

function CaseLine({ row }: { row: Sect2Record | Sect3Record }) {
  return (
    <div className="pffield">
      <span>Patient full name <b>{row.patientName ?? ''}</b></span>
      <span>H.N. <b className="mono">{row.hn ?? ''}</b></span>
      {'typeOfWorks' in row && row.typeOfWorks ? <span>Type of works <b>{row.typeOfWorks}</b></span> : null}
    </div>
  );
}

function Sign({ caption = 'Instructor signature', date }: { caption?: string; date?: string }) {
  return (
    <div className="sign">
      <div>
        <div className="line" />
        <div className="cap">{caption}</div>
      </div>
      <div style={{ maxWidth: 190 }}>
        <div className="line" style={{ textAlign: 'center', font: '400 9px var(--font-body)', paddingTop: 16 }}>
          {date ? thaiShort(date) : ''}
        </div>
        <div className="cap">Date</div>
      </div>
    </div>
  );
}

/* ── Section III · ใบละหน้า ─────────────────────────────────────────────── */
export function Sect3PrintPage({ row, student }: { row: Sect3Record; student: Student }) {
  const form = sect3Form(row.formKey);
  if (!form) return null;
  /* แถวที่ grades เป็น null (ข้อมูลเพี้ยนจาก sync หรือแอปเวอร์ชันเก่า) เคยทำให้
     ทั้งหน้าพิมพ์ว่างเปล่า เพราะ React ล้มทั้งต้นไม้ — กันไว้ที่นี่ใบเดียวพัง ที่เหลือยังพิมพ์ได้ */
  const grades = row.grades ?? {};
  const kindLabel = form.kind === 'K' ? '(Knowledge assessment)' : form.kind === 'S' ? '(Skill assessment)' : '(Knowledge and skill assessment)';
  let n = 0;
  return (
    <section className="a4 a4--pf">
      <Head
        section="Section III: Knowledge and skill assessments in specific prosthodontic procedures"
        code={form.code}
        student={student}
      />
      <h1 className="pftitle">{form.title}</h1>
      <div className="pfsub">{kindLabel}{form.yearOnly ? ` · YEAR ${form.yearOnly}` : ''}</div>
      <CaseLine row={row} />

      <table>
        <thead>
          <tr>
            <th className="tick">#</th>
            <th>Assessment topic</th>
            <th className="pfpt">O</th>
            <th className="pfpt">S</th>
            <th className="pfpt">U</th>
          </tr>
        </thead>
        <tbody>
          {form.topics.map((topic) => {
            const rows = [];
            if (topic.sub) {
              rows.push(<tr key={`${topic.key}-sub`} className="pfsubrow"><td colSpan={5}>{topic.sub}</td></tr>);
            }
            n++;
            const picked = grades[topic.key];
            rows.push(
              <tr key={topic.key}>
                <td className="tick">{n}</td>
                <td>{topic.label} <b>({topic.max})</b></td>
                {(['O', 'S', 'U'] as const).map((g) => (
                  <td key={g} className={`pfpt${picked === g ? ' pfon' : ''}`}>{s3Points(topic, g)}</td>
                ))}
              </tr>,
            );
            return rows;
          })}
          <tr className="pftotal">
            <td />
            <td style={{ textAlign: 'right' }}>TOTAL</td>
            <td className="pfpt" colSpan={3}>{row.total ?? ''} / {S3_FULL_SCORE}</td>
          </tr>
        </tbody>
      </table>

      {form.note && <p className="pfnote"><b>Remark:</b> {form.note}</p>}
      <Sign date={row.at} />
    </section>
  );
}

/* ── Section II · ใบให้คะแนน (แบ่งสองหน้าเหมือนกระดาษ) ────────────────────── */
function Sect2Half({ row, student, from, to, part }: {
  row: Sect2Record; student: Student; from: number; to: number; part: string;
}) {
  const form = sect2Form(row.formKey);
  if (!form) return null;
  return (
    <section className="a4 a4--pf">
      <Head
        section="Section II: Patient examination and treatment planning assessments"
        code="YEAR 5"
        student={student}
      />
      <h1 className="pftitle">{form.title} {part}</h1>
      <CaseLine row={row} />

      <table>
        <thead>
          <tr>
            <th className="tick">#</th>
            {S2_GRADES.map((g) => <th key={g.v}>{g.label}</th>)}
            <th className="pfpt">Score</th>
          </tr>
        </thead>
        <tbody>
          {form.criteria.slice(from, to).map((c, i) => {
            const picked = row.grades?.[c.key];
            return [
              <tr key={`${c.key}-t`} className="pfsubrow">
                <td colSpan={6}>
                  <b>{c.title}</b>
                  {c.detail && <div className="pfdet">{c.detail}</div>}
                </td>
              </tr>,
              <tr key={c.key}>
                <td className="tick">{from + i + 1}</td>
                {S2_GRADES.map((g) => (
                  <td key={g.v} className={picked === g.v ? 'pfon' : undefined}>
                    {c.rubric[g.v]} <b>({c.max * g.ratio} pts)</b>
                  </td>
                ))}
                <td className="pfpt">{picked ? c.max * S2_GRADES.find((g) => g.v === picked)!.ratio : ''} /{c.max}</td>
              </tr>,
            ];
          })}
          {to >= form.criteria.length && (
            <tr className="pftotal">
              <td />
              <td colSpan={4} style={{ textAlign: 'right' }}>Total score</td>
              <td className="pfpt">{row.total ?? ''} / {S2_FULL_SCORE}</td>
            </tr>
          )}
        </tbody>
      </table>

      {to >= form.criteria.length && (
        <>
          <p className="pfnote">
            The advisor will sign the assessment when: 1. The assessment was completed.
            2. The patient has accepted the treatment plan and signed the informed consent form in the prosthodontic chart.
          </p>
          <Sign caption="Advisor signature" date={row.at} />
        </>
      )}
    </section>
  );
}

export function Sect2PrintPages({ row, student }: { row: Sect2Record; student: Student }) {
  const form = sect2Form(row.formKey);
  if (!form) return null;
  return (
    <>
      <Sect2Half row={row} student={student} from={0} to={3} part="(1/2)" />
      <Sect2Half row={row} student={student} from={3} to={form.criteria.length} part="(2/2)" />
    </>
  );
}

/* ── Section II · ใบ RPD design ─────────────────────────────────────────── */
export function RpdDesignPrintPage({ row, student }: { row: Sect2Record; student: Student }) {
  return (
    <section className="a4 a4--pf">
      <Head
        section="Section II: Patient examination and treatment planning assessments"
        code="YEAR 5"
        student={student}
      />
      <h1 className="pftitle">RPD Design Examination Form</h1>
      <div className="pffield">
        <span>Examinee full name <b>{student.name}</b></span>
        <span>ID <b className="mono">{student.code}</b></span>
      </div>
      <CaseLine row={row} />

      <table>
        <thead>
          <tr>
            <th>Assessment topic</th>
            <th className="pfpt">Pass</th>
            <th className="pfpt">Fail</th>
          </tr>
        </thead>
        <tbody>
          {RPD_DESIGN_GROUPS.map((g) => [
            <tr key={g.no} className="pfsubrow"><td colSpan={3}><b>{g.no}. {g.title}</b></td></tr>,
            ...g.topics.map((topic) => {
              const v = row.marks?.[topic.key];
              return (
                <tr key={topic.key}>
                  <td style={{ paddingLeft: 16 }}>{topic.no} {topic.label}</td>
                  <td className={`pfpt${v === true ? ' pfon' : ''}`}>{v === true ? '✓' : ''}</td>
                  <td className={`pfpt${v === false ? ' pfon' : ''}`}>{v === false ? '✓' : ''}</td>
                </tr>
              );
            }),
          ])}
          <tr className="pftotal">
            <td style={{ textAlign: 'right' }}>Result</td>
            <td className="pfpt" colSpan={2}>{row.passed ? 'PASS' : t('ยังไม่ผ่าน')}</td>
          </tr>
        </tbody>
      </table>

      <p className="pfnote"><b>Remark:</b> {RPD_DESIGN_REMARK}</p>
      <div className="sign">
        <div>
          <div className="line" />
          <div className="cap">Examinee signature</div>
        </div>
        <div>
          <div className="line" />
          <div className="cap">Examiner signature</div>
        </div>
        <div style={{ maxWidth: 150 }}>
          <div className="line" style={{ textAlign: 'center', font: '400 9px var(--font-body)', paddingTop: 16 }}>
            {thaiShort(row.at)}
          </div>
          <div className="cap">Date</div>
        </div>
      </div>
    </section>
  );
}

/** ทุกใบที่ประเมินแล้วของ นศ. คนหนึ่ง เรียงตามลำดับในสมุด */
export function PortfolioPrintSheet({ student, sect2, sect3 }: {
  student: Student; sect2: Sect2Record[]; sect3: Sect3Record[];
}) {
  const s2 = ['removable', 'fixed', 'rpdDesign']
    .map((k) => sect2.find((r) => r.formKey === k))
    .filter((r): r is Sect2Record => !!r);
  // เรียงตามลำดับใบในสมุด ไม่ใช่ตามวันที่ประเมิน
  const order = new Map(sect3.map((r) => [r.formKey, r]));
  const s3 = ['cdK1', 'cdK2', 'cdS1', 'cdS2', 'rpdK1', 'rpdK2', 'rpdS1', 'rpdS2',
    'fdpK1', 'fdpK2', 'fdpS1', 'fdpS2', 'recallCd', 'recallRpd', 'recallFdp']
    .map((k) => order.get(k))
    .filter((r): r is Sect3Record => !!r);

  return (
    <>
      {s2.map((row) => (
        <SheetBoundary key={row.id} label={row.formKey}>
          {row.formKey === 'rpdDesign'
            ? <RpdDesignPrintPage row={row} student={student} />
            : <Sect2PrintPages row={row} student={student} />}
        </SheetBoundary>
      ))}
      {s3.map((row) => (
        <SheetBoundary key={row.id} label={row.formKey}>
          <Sect3PrintPage row={row} student={student} />
        </SheetBoundary>
      ))}
    </>
  );
}
