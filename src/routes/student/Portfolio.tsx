/**
 * สมุดของฉัน — นักศึกษาเปิดดู portfolio ของตัวเองทั้งเล่ม
 *
 * ที่มา: ผู้ใช้ขอ 7 ก.ย. 69 "อยากให้เห็นหนังสือทั้งเล่มของตัวเอง section 1 2 3"
 * ของเดิมข้อมูล Section II/III ซิงก์ลงเครื่องนักศึกษาแล้ว สิทธิ์อ่านก็เปิดไว้แล้ว
 * แต่ไม่มีหน้าไหนแสดงเลย — เขาเห็นแค่ธง "ผ่าน/ไม่ผ่าน" ในหน้าเกณฑ์
 * ไม่รู้ว่าตกข้อไหน ได้เท่าไหร่ ใครประเมิน
 *
 * หน้านี้เดินตามสารบัญของสมุดจริง (Clinical Performance Portfolio, ed. 3 May 2024)
 *   Section I   ประเมินรายคาบ  → มีหน้าของตัวเองอยู่แล้ว ที่นี่สรุปให้แล้วลิงก์ไป
 *   Section II  ตรวจและวางแผนการรักษา
 *   Section III ความรู้และทักษะ
 * OSCE ตัดทิ้งตามคำสั่งผู้ใช้ (เป็นข้อสอบ ใช้กระดาษต่อ) · Section IV ยังไม่เคาะว่าทำไหม
 *
 * ⚠️ อ่านอย่างเดียวเด็ดขาด — คนให้คะแนนคืออาจารย์ หน้านี้ไม่มีทางเขียนอะไรกลับ
 * และ **โชว์เฉพาะใบที่ประเมินเสร็จแล้ว** ใบที่อาจารย์กรอกค้างไว้ถือว่ายังไม่ประเมิน
 * ไม่งั้นนักศึกษาจะเห็นคะแนนกลางคันแล้วเข้าใจว่าโดนให้คะแนนต่ำ
 */
import { BookOpen, CaretDown, CalendarCheck, CheckCircle, Circle, Printer } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../../components/student/Shell';
import { cohortLabel, cohortOf, studentYear } from '../../domain/cohort';
import { groupShort } from '../../domain/group';
import { saYearNow } from '../../domain/saFeedback';
import { saCourseCode } from '../../domain/selfAssessment';
import {
  RPD_DESIGN_GROUPS, S2_FULL_SCORE, S2_GRADES, s2Points, sect2Form,
} from '../../domain/sect2';
import { S3_FULL_SCORE, s3Points, sect3Form, sect3FormsFor } from '../../domain/sect3';
import { useCheckIns, useSect2, useSect3, useStudent } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import type { S2Grade } from '../../domain/sect2';
import type { S3Grade } from '../../domain/sect3';
import type { Sect2Record, Sect3Record } from '../../domain/types';

/** ใบ Section II เรียงตามลำดับในสมุด */
const SECT2_ROWS = [
  { key: 'removable', label: 'Removable prosthesis · examination and treatment planning' },
  { key: 'fixed', label: 'Fixed prosthesis · examination and treatment planning' },
  { key: 'rpdDesign', label: 'RPD Design examination form' },
] as const;

const S3_GROUP_TITLE = {
  CD: 'Complete dentures (CD)',
  RPD: 'Removable partial dentures (RPD)',
  FDP: 'Fixed prosthesis (FDP)',
} as const;

/**
 * ประเมินเสร็จแล้วจริงหรือยัง — ใบให้คะแนนดูที่ total · ใบ RPD design ดูที่ passed
 * ที่ต้องมีฟังก์ชันนี้เพราะแถวร่างกับแถวเสร็จหน้าตาเหมือนกันทุกอย่าง ต่างแค่ช่องนี้
 */
const done2 = (r: Sect2Record | undefined): boolean =>
  !!r && (r.formKey === 'rpdDesign' ? r.passed !== undefined && r.passed !== null : r.total !== null && r.total !== undefined);
const done3 = (r: Sect3Record | undefined): boolean => !!r && r.total !== null && r.total !== undefined;

/** ใบล่าสุดของแต่ละฟอร์ม นับเฉพาะที่ประเมินเสร็จ (rows เรียงใหม่→เก่ามาแล้วจาก repo) */
function latestDone<T extends { formKey: string }>(rows: T[], ok: (r: T) => boolean): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (ok(r) && !m.has(r.formKey)) m.set(r.formKey, r);
  return m;
}

function Row({ code, title, score, open, onToggle, children }: {
  code: string;
  title: string;
  /** null = ยังไม่ได้ประเมิน */
  score: string | null;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const graded = score !== null;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={graded ? onToggle : undefined}
        disabled={!graded}
        aria-expanded={graded ? open : undefined}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px',
          background: 'none', border: 0, textAlign: 'left', cursor: graded ? 'pointer' : 'default',
        }}
      >
        {graded
          ? <CheckCircle size={17} weight="fill" color="var(--success-dark)" style={{ flex: 'none' }} />
          : <Circle size={17} color="var(--text-disabled)" style={{ flex: 'none' }} />}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', font: '700 11px var(--font-head)', color: 'var(--text-secondary)' }}>{code}</span>
          <span style={{ display: 'block', font: '400 11px/1.45 var(--font-body)', color: 'var(--text-muted)', marginTop: 1 }}>
            {title}
          </span>
        </span>
        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            font: graded ? '700 13px var(--font-head)' : '400 11px var(--font-body)',
            color: graded ? 'var(--text)' : 'var(--text-disabled)',
          }}>
            {graded ? score : t('ยังไม่ได้ประเมิน')}
          </span>
          {graded && (
            <CaretDown
              size={13}
              color="var(--text-disabled)"
              style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .18s' }}
            />
          )}
        </span>
      </button>
      {graded && open && (
        <div style={{ borderTop: '1px solid var(--border-faint)', padding: '10px 12px 12px' }}>{children}</div>
      )}
    </div>
  );
}

/** บรรทัดล่างสุดของใบที่กางออก — ใครประเมิน วันไหน */
function Signed({ by, at }: { by: string; at: string }) {
  return (
    <p style={{ margin: '9px 0 0', font: '400 10px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
      {t('ประเมินโดย')} {by} · {thaiShort(at)} · {t('ลงนามจริงบนกระดาษ')}
    </p>
  );
}

function Sect3Detail({ row }: { row: Sect3Record }) {
  const form = sect3Form(row.formKey);
  if (!form) return null;
  return (
    <>
      <div style={{ display: 'grid', gap: 5 }}>
        {form.topics.map((topic) => {
          const g = row.grades?.[topic.key] as S3Grade | undefined;
          const pts = s3Points(topic, g);
          return (
            <div key={topic.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ flex: 1, minWidth: 0, font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-muted)' }}>
                {topic.label}
              </span>
              <span
                style={{
                  flex: 'none', width: 17, height: 17, borderRadius: 5, display: 'grid', placeItems: 'center',
                  font: '700 9.5px var(--font-head)',
                  /* ระดับที่ได้ต้องกวาดตาเห็นทั้งใบในทีเดียวว่าตกข้อไหน ตัวอักษรจางๆ อ่านไม่ทัน */
                  background: g === 'O' ? 'var(--success-tint)' : g === 'S' ? 'var(--warning-tint)' : g === 'U' ? 'var(--danger-tint)' : 'var(--fill)',
                  color: g === 'O' ? 'var(--success-dark)' : g === 'S' ? 'var(--warning-dark)' : g === 'U' ? 'var(--danger)' : 'var(--text-disabled)',
                }}
              >
                {g ?? '–'}
              </span>
              <span style={{ flex: 'none', font: '600 11px var(--font-head)', width: 44, textAlign: 'right' }}>
                {pts ?? '—'}/{topic.max}
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', font: '400 10px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
        {t('O = ได้เต็มข้อ · S = ได้ครึ่งข้อ · U = ไม่ได้คะแนน')}
      </p>
      <Signed by={row.by} at={row.at} />
    </>
  );
}

/**
 * รายละเอียดใบ Section II
 *
 * ⚠️ ข้อความเกณฑ์ของ Section II เป็นร้อยแก้วยาวมาก (บางข้อมี 5 ข้อย่อยในย่อหน้าเดียว)
 * รอบแรกเอามาแปะใต้ทุกหัวข้อ ผู้ใช้ทักว่ารก — กลายเป็นกำแพงตัวหนังสือจนหาคะแนนไม่เจอ
 * ค่าเริ่มต้นจึงเหลือ "หัวข้อ · ระดับ · คะแนน" แล้วซ่อนคำอธิบายไว้ใต้ปุ่มเดียวของทั้งใบ
 * (ล้อกับปุ่ม "ดูเกณฑ์ทั้ง 4 ระดับ" ฝั่งอาจารย์ที่ใช้วิธีเดียวกัน)
 */
function Sect2Detail({ row }: { row: Sect2Record }) {
  const [showRubric, setShowRubric] = useState(false);
  const form = sect2Form(row.formKey);
  if (!form) return null;
  return (
    <>
      <div style={{ display: 'grid', gap: 6 }}>
        {form.criteria.map((c) => {
          const g = row.grades?.[c.key] as S2Grade | undefined;
          const pts = s2Points(c, g);
          const level = S2_GRADES.find((x) => x.v === g);
          return (
            <div key={c.key}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ flex: 1, minWidth: 0, font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-muted)' }}>
                  {c.title}
                </span>
                <span
                  style={{
                    flex: 'none', font: '700 9.5px var(--font-head)', borderRadius: 5, padding: '1px 5px',
                    background: g === 'O' ? 'var(--success-tint)' : g === 'S' ? 'var(--accent-tint)'
                      : g === 'M' ? 'var(--warning-tint)' : g === 'U' ? 'var(--danger-tint)' : 'var(--fill)',
                    color: g === 'O' ? 'var(--success-dark)' : g === 'S' ? 'var(--accent)'
                      : g === 'M' ? 'var(--warning-dark)' : g === 'U' ? 'var(--danger)' : 'var(--text-disabled)',
                  }}
                >
                  {g ?? '–'}
                </span>
                <span style={{ flex: 'none', font: '600 11px var(--font-head)', width: 46, textAlign: 'right' }}>
                  {pts ?? '—'}/{c.max}
                </span>
              </div>
              {showRubric && level && (
                <p style={{ margin: '3px 0 5px', font: '400 10px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
                  <b style={{ color: 'var(--text-muted)' }}>{level.label}</b> — {c.rubric[level.v]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={() => setShowRubric((v) => !v)}
        style={{
          marginTop: 8, background: 'none', border: 0, padding: 0,
          font: '600 10.5px var(--font-body)', color: 'var(--accent)', cursor: 'pointer',
        }}
      >
        {showRubric ? t('ซ่อนคำอธิบายเกณฑ์') : t('ดูคำอธิบายเกณฑ์ที่ได้')}
      </button>
      <p style={{ margin: '7px 0 0', font: '400 10px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
        {t('O = Outstanding · S = Satisfactory · M = Marginal · U = Unsatisfactory')}
      </p>
      <Signed by={row.by} at={row.at} />
    </>
  );
}

function RpdDesignDetail({ row }: { row: Sect2Record }) {
  return (
    <>
      <div style={{ display: 'grid', gap: 8 }}>
        {RPD_DESIGN_GROUPS.map((g) => (
          <div key={g.no}>
            <div style={{ font: '700 10.5px var(--font-head)', color: 'var(--text-secondary)', marginBottom: 3 }}>
              {g.no}. {g.title}
            </div>
            <div style={{ display: 'grid', gap: 3 }}>
              {g.topics.map((topic) => {
                const v = row.marks?.[topic.key];
                return (
                  <div key={topic.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ flex: 1, minWidth: 0, font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-muted)' }}>
                      {topic.no} {topic.label}
                    </span>
                    <span style={{
                      flex: 'none', font: '700 10px var(--font-head)',
                      color: v ? 'var(--success-dark)' : 'var(--text-disabled)',
                    }}>
                      {v ? t('ผ่าน') : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Signed by={row.by} at={row.at} />
    </>
  );
}

export default function Portfolio() {
  const { session } = useApp();
  const student = useStudent(session?.studentId);
  const year = saYearNow();
  const rows2 = useSect2(session?.studentId, year);
  const rows3 = useSect3(session?.studentId, year);
  const checkins = useCheckIns(session?.studentId);
  const [open, setOpen] = useState<string | null>(null);

  const classYear = student ? studentYear(student) : 5;
  const forms3 = useMemo(() => sect3FormsFor(classYear), [classYear]);
  const latest2 = useMemo(() => latestDone(rows2, done2), [rows2]);
  const latest3 = useMemo(() => latestDone(rows3, done3), [rows3]);

  // ประเมินรายคาบ = Section I ของสมุด — สรุปตัวเลขไว้ตรงนี้ รายละเอียดอยู่หน้า "คาบ"
  const evaluated = checkins.filter((c) => c.status === 'evaluated');

  const doneCount = latest2.size + latest3.size;
  const totalCount = SECT2_ROWS.length + forms3.length;

  const toggle = (k: string) => setOpen((cur) => (cur === k ? null : k));

  return (
    <Shell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={18} weight="fill" color="var(--accent)" />
          <span style={{ font: '700 15px var(--font-head)' }}>{t('สมุดของฉัน')}</span>
        </div>
        <p style={{ margin: '5px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
          Clinical Performance Portfolio · {saCourseCode(classYear)} · {t('ปีการศึกษา')} {year}
        </p>
        {student && (
          <p style={{ margin: '3px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
            {student.name} · {student.code} · {groupShort(student.group)} · {cohortLabel(cohortOf(student))}
            {' · '}{t('ชั้นปีที่ {n}', { n: classYear })}
          </p>
        )}
        <p style={{ margin: '9px 0 0', font: '600 12px var(--font-head)' }}>
          {t('ประเมินแล้ว')} {doneCount}/{totalCount} {t('ใบ')}
        </p>
      </header>

      <div style={{ padding: '14px 16px 0', display: 'grid', gap: 16 }}>
        {/* ── Section I ── */}
        <section style={{ display: 'grid', gap: 7 }}>
          <h2 style={{ margin: 0, font: '700 12px var(--font-head)' }}>
            Section I · <span style={{ color: 'var(--text-muted)' }}>{t('ประเมินรายคาบ')}</span>
          </h2>
          <Link to="/app/checkin" className="card" style={{ padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <CalendarCheck size={17} color="var(--accent)" style={{ flex: 'none' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: '600 12px var(--font-head)' }}>
                {t('อาจารย์ประเมินแล้ว {n} คาบ', { n: evaluated.length })}
              </span>
              <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 1 }}>
                {t('จากที่เช็คอินไว้ {n} คาบ · แตะเพื่อดูรายคาบ', { n: checkins.length })}
              </span>
            </span>
          </Link>
        </section>

        {/* ── Section II ── */}
        <section style={{ display: 'grid', gap: 7 }}>
          <h2 style={{ margin: 0, font: '700 12px var(--font-head)' }}>
            Section II · <span style={{ color: 'var(--text-muted)' }}>{t('ตรวจและวางแผนการรักษา')}</span>
          </h2>
          {SECT2_ROWS.map((r) => {
            const row = latest2.get(r.key);
            const score = !row ? null
              : r.key === 'rpdDesign' ? (row.passed ? 'PASS' : t('ยังไม่ผ่าน'))
                : `${row.total}/${S2_FULL_SCORE}`;
            return (
              <Row
                key={r.key}
                code={r.key === 'rpdDesign' ? 'Design' : 'Sect II'}
                title={r.label}
                score={score}
                open={open === `2:${r.key}`}
                onToggle={() => toggle(`2:${r.key}`)}
              >
                {row && (r.key === 'rpdDesign' ? <RpdDesignDetail row={row} /> : <Sect2Detail row={row} />)}
              </Row>
            );
          })}
        </section>

        {/* ── Section III ── */}
        <section style={{ display: 'grid', gap: 7 }}>
          <h2 style={{ margin: 0, font: '700 12px var(--font-head)' }}>
            Section III · <span style={{ color: 'var(--text-muted)' }}>{t('ความรู้และทักษะ')}</span>
          </h2>
          {(['CD', 'RPD', 'FDP'] as const).map((g) => {
            const mine = forms3.filter((f) => f.group === g);
            if (!mine.length) return null;
            return (
              <div key={g} style={{ display: 'grid', gap: 6 }}>
                <div style={{ font: '700 10.5px var(--font-head)', color: 'var(--text-secondary)', marginTop: 3 }}>
                  {S3_GROUP_TITLE[g]}
                </div>
                {mine.map((f) => {
                  const row = latest3.get(f.key);
                  return (
                    <Row
                      key={f.key}
                      code={f.code}
                      title={f.title}
                      score={row ? `${row.total}/${S3_FULL_SCORE}` : null}
                      open={open === `3:${f.key}`}
                      onToggle={() => toggle(`3:${f.key}`)}
                    >
                      {row && <Sect3Detail row={row} />}
                    </Row>
                  );
                })}
              </div>
            );
          })}
        </section>

        {/* พิมพ์ได้เฉพาะตอนมีของให้พิมพ์ — ปุ่มที่กดแล้วเจอหน้าว่างแย่กว่าไม่มีปุ่ม */}
        {doneCount > 0 && (
          <Link to="/app/portfolio/print" className="btn btn--sec" style={{ height: 42 }}>
            <Printer size={16} weight="fill" /> {t('พิมพ์สมุดของฉัน')}
          </Link>
        )}

        <p style={{ margin: 0, font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
          {t('อาจารย์เป็นผู้ประเมินและลงนามบนสมุดกระดาษ หน้านี้ดูได้อย่างเดียว แก้ไม่ได้ · ใบที่อาจารย์ยังกรอกไม่เสร็จจะขึ้นว่ายังไม่ได้ประเมิน')}
        </p>
        <div style={{ height: 8 }} />
      </div>
    </Shell>
  );
}
