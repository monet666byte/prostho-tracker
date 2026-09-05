import { ArrowLeft, ArrowRight, CaretLeft, CheckCircle, Lock, PaperPlaneTilt, Printer } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlainShell } from '../../components/student/Shell';
import { Empty } from '../../components/ui/Bits';
import { saveSelfAssessmentDraft, submitSelfAssessment } from '../../data/repo';
import { studentYear } from '../../domain/cohort';
import { saYearNow } from '../../domain/saFeedback';
import {
  SA_APPROPRIATE, SA_FORM_VERSION, SA_NEEDS_WORK, SA_SCALE, SA_SOURCE,
  saColLabel, saHint, saLabel, saNote, saOption, saProgress, saSectionLabel, saSectionMissing, saSectionsFor,
  type SAQuestion, type SAValue,
} from '../../domain/selfAssessment';
import { useSelfAssessment, useStudent } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { lang, t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';

/** ปุ่มเลือกค่าเดียวจากไม่กี่ตัวเลือก — ใช้ทั้ง 0–4 · Appropriate/Need improvement · Yes/No */
function Choice({
  options, value, onPick,
}: {
  options: Array<{ v: number; label: string; sub?: string }>;
  value: number | null;
  onPick: (v: number) => void;
}) {
  return (
    <div className="seg" style={{ gap: 6 }}>
      {options.map((o) => (
        <button
          key={o.v}
          data-on={value === o.v}
          onClick={() => onPick(o.v)}
          /* 6 ตัวเลือก (0–4 + N/A) ต้องอยู่แถวเดียวบนจอมือถือ — ตกบรรทัดแล้ว N/A จะกินเต็มแถว
             กลายเป็นแถบใหญ่ที่ดูเหมือนปุ่มหลัก ทั้งที่เป็นแค่ตัวเลือกหนึ่ง */
          style={{ flex: '1 1 0', minWidth: options.length > 5 ? 40 : 58, display: 'grid', gap: 1, padding: '8px 4px', lineHeight: 1.25 }}
        >
          <span style={{ font: '600 12.5px var(--font-body)' }}>{o.label}</span>
          {o.sub && <span style={{ font: '400 9.5px var(--font-body)', opacity: 0.75 }}>{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

const scaleOptions = (allowNA?: boolean) => [
  ...SA_SCALE.map((s) => ({ v: s.v, label: String(s.v), sub: lang === 'en' ? s.label : s.th })),
  ...(allowNA ? [{ v: -1, label: 'N/A', sub: lang === 'en' ? 'not yet' : 'ยังไม่เคย' }] : []),
];

const levelOptions = () => [
  { v: SA_APPROPRIATE, label: lang === 'en' ? 'Appropriate' : 'เหมาะสมแล้ว' },
  { v: SA_NEEDS_WORK, label: lang === 'en' ? 'Need improvement' : 'ต้องปรับปรุง' },
];

const yesnoOptions = () => [
  { v: 1, label: lang === 'en' ? 'Yes' : 'ใช่' },
  { v: 0, label: lang === 'en' ? 'No' : 'ไม่' },
];

export default function SelfAssess() {
  const { session, settings, showToast } = useApp();
  const navigate = useNavigate();
  const student = useStudent(session?.studentId);
  const year = saYearNow();
  const saved = useSelfAssessment(session?.studentId, year);
  const classYear = student ? studentYear(student) : 5;
  const sections = useMemo(() => saSectionsFor(classYear), [classYear]);

  const [answers, setAnswers] = useState<Record<string, SAValue>>({});
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // โหลดร่างเดิมครั้งเดียว — หลังจากนั้นสถานะในหน้าเป็นความจริง (ไม่งั้นพิมพ์ไปโดนทับไป)
  useEffect(() => {
    if (loaded || saved === undefined) return;
    if (saved) setAnswers(saved.answers as Record<string, SAValue>);
    setLoaded(true);
  }, [saved, loaded]);

  const submitted = saved?.status === 'submitted';
  const progress = saProgress(answers, classYear);
  const section = sections[step];
  const onLast = step === sections.length - 1;

  /** เขียนคำตอบ + บันทึกร่างอัตโนมัติ (หน่วง 600ms — กันเขียนถี่ตอนพิมพ์) */
  function set(key: string, v: SAValue) {
    if (submitted || !session) return;
    const next = { ...answers, [key]: v };
    setAnswers(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveSelfAssessmentDraft({
        studentId: session.studentId,
        academicYear: year,
        classYear,
        formVersion: SA_FORM_VERSION,
        answers: next,
      });
    }, 600);
  }

  // ออกจากหน้าไปกลางคัน — บันทึกสิ่งที่ค้างในตัวจับเวลาทันที
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  async function send() {
    if (!session) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveSelfAssessmentDraft({
      studentId: session.studentId, academicYear: year, classYear, formVersion: SA_FORM_VERSION, answers,
    });
    await submitSelfAssessment(session.studentId, year, currentActor());
    setConfirming(false);
    showToast({ message: t('ส่งแบบประเมินตนเองแล้ว — อาจารย์ที่ปรึกษาจะอ่านก่อนนัดคุย'), tone: 'success' });
  }

  /* ── ฟอร์มปิด: บอกให้ชัดว่าเปิดเมื่อไหร่ ดีกว่าโชว์ฟอร์มเปล่าที่ส่งไม่ได้ ── */
  if (!settings.saOpen && !submitted) {
    return (
      <PlainShell>
        <header className="s-header s-header--row">
          <button className="iconbtn" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}><CaretLeft size={18} /></button>
          <h2 className="h2">{t('ประเมินตนเอง')}</h2>
        </header>
        <div style={{ padding: '16px' }}>
          <Empty
            icon={<Lock size={26} />}
            title={t('ยังไม่เปิดให้กรอก')}
            hint={t('ภาควิชาเปิดแบบประเมินตนเองปีละครั้ง ตอนจบเทอม 1 — รอประกาศจากอาจารย์')}
          />
        </div>
      </PlainShell>
    );
  }

  /* ── ส่งแล้ว: อ่านอย่างเดียว + สรุปที่อาจารย์ปล่อยแล้ว ── */
  if (submitted && saved) {
    return (
      <PlainShell>
        <header className="s-header s-header--row">
          <button className="iconbtn" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}><CaretLeft size={18} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="h2">{t('ประเมินตนเอง')}</h2>
            <p style={{ margin: '2px 0 0', font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>
              {t('ส่งแล้วเมื่อ {d}', { d: thaiShort(saved.submittedAt ?? saved.updatedAt) })}
            </p>
          </div>
        </header>
        <div style={{ padding: '14px 16px 22px', display: 'grid', gap: 12 }}>
          <div
            className="card"
            style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--success-tint)', borderColor: '#CDEEDF' }}
          >
            <CheckCircle size={20} weight="fill" color="var(--success)" style={{ flex: 'none' }} />
            <span style={{ font: '500 12.5px/1.5 var(--font-body)', color: 'var(--success-dark)' }}>
              {t('ส่งเรียบร้อย แก้ไม่ได้แล้ว — ถ้าต้องแก้ให้บอกอาจารย์ที่ปรึกษา')}
            </span>
          </div>

          {/* ปริ้นท์ไปให้อาจารย์เซ็นแล้วเก็บเข้าแฟ้ม — ฟอร์ม Word เดิมทำแบบนี้ */}
          <Link
            to="/app/self-assessment/print"
            className="btn btn--sec"
            style={{ height: 44, textDecoration: 'none' }}
          >
            <Printer size={16} weight="fill" /> {t('พิมพ์')}
          </Link>

          {sections.map((s) => (
            <div key={s.key} className="card" style={{ padding: '12px 14px' }}>
              <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 8 }}>{saSectionLabel(s)}</div>
              <div style={{ display: 'grid', gap: 7 }}>
                {s.questions.map((q) => (
                  <div key={q.key} style={{ display: 'grid', gap: 2 }}>
                    <span style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
                      {saLabel(q)}{q.col ? ` · ${saColLabel(q.col)}` : ''}
                    </span>
                    <span style={{ font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                      {readable(q, answers[q.key]) || <span className="faint">{t('ไม่ได้ตอบ')}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PlainShell>
    );
  }

  /* ── โหมดกรอก — ทีละหมวดเหมือนแบบฟอร์มออนไลน์ ── */
  const missingHere = section ? saSectionMissing(section, answers, classYear) : 0;

  const footer = (
    <div
      style={{
        padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', display: 'flex', gap: 8,
        borderTop: '1px solid var(--divider)', background: 'var(--bg-elevated)',
      }}
    >
      <button
        className="btn btn--sec"
        style={{ height: 46, flex: '0 0 96px' }}
        disabled={step === 0}
        onClick={() => setStep((s) => Math.max(0, s - 1))}
      >
        <ArrowLeft size={16} /> {t('ก่อนหน้า')}
      </button>
      {onLast ? (
        <button
          className="btn"
          style={{ height: 46, flex: 1 }}
          disabled={progress.done < progress.total}
          onClick={() => setConfirming(true)}
        >
          <PaperPlaneTilt size={17} weight="fill" />
          {progress.done < progress.total
            ? t('ยังเหลืออีก {n} ข้อ', { n: progress.total - progress.done })
            : t('ส่งแบบประเมิน')}
        </button>
      ) : (
        <button className="btn" style={{ height: 46, flex: 1 }} onClick={() => setStep((s) => s + 1)}>
          {t('ถัดไป')} <ArrowRight size={16} weight="bold" />
        </button>
      )}
    </div>
  );

  const overlay = confirming ? (
    <div className="backdrop" onClick={() => setConfirming(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <h3 className="h3">{t('ส่งแบบประเมินตนเอง?')}</h3>
        <p style={{ margin: '8px 0 0', font: '400 12px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
          {t('ส่งแล้วแก้เองไม่ได้ อาจารย์ในภาควิชาเห็นคำตอบทั้งหมดได้ และจะอ่านก่อนนัดคุยกับเรา')}
        </p>
        <button className="btn" style={{ height: 50, marginTop: 14 }} onClick={send}>
          <PaperPlaneTilt size={17} weight="fill" /> {t('ยืนยันส่ง')}
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={() => setConfirming(false)}>{t('ยังไม่ส่ง')}</button>
      </div>
    </div>
  ) : undefined;

  return (
    <PlainShell footer={footer} overlay={overlay}>
      <header className="s-header s-header--row">
        <button className="iconbtn" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}><CaretLeft size={18} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="h2">{t('ประเมินตนเอง')}</h2>
          <p style={{ margin: '2px 0 0', font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>
            {t('ปีการศึกษา {y} · ตอบแล้ว {a}/{b} ข้อ', { y: year, a: progress.done, b: progress.total })}
            {settings.saDue ? ` · ${t('ส่งภายใน {d}', { d: thaiShort(settings.saDue) })}` : ''}
          </p>
        </div>
      </header>

      <div style={{ padding: '12px 16px 0' }}>
        <span className="bar" style={{ height: 6 }}>
          <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%`, background: 'var(--accent)' }} />
        </span>
        <div style={{ display: 'flex', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
          {sections.map((s, i) => {
            const left = saSectionMissing(s, answers, classYear);
            return (
              <button
                key={s.key}
                onClick={() => setStep(i)}
                title={saSectionLabel(s)}
                style={{
                  width: 26, height: 26, borderRadius: 8, flex: 'none',
                  border: `1px solid ${i === step ? 'var(--accent)' : 'var(--border)'}`,
                  background: i === step ? 'var(--accent-tint)' : left === 0 ? 'var(--success-tint)' : 'transparent',
                  color: left === 0 ? 'var(--success-dark)' : 'var(--text-muted)',
                  font: '600 10.5px var(--font-mono)', cursor: 'pointer',
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {section && (
        <div style={{ padding: '14px 16px 20px', display: 'grid', gap: 14 }}>
          <div>
            <h3 className="h3">{saSectionLabel(section)}</h3>
            {saNote(section) && (
              <p style={{ margin: '4px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                {saNote(section)}
              </p>
            )}
            {missingHere > 0 && (
              <p style={{ margin: '4px 0 0', font: '500 10.5px var(--font-body)', color: 'var(--warning-dark)' }}>
                {t('ยังไม่ได้ตอบ {n} ข้อในหมวดนี้', { n: missingHere })}
              </p>
            )}
          </div>
          {renderQuestions(section.questions, answers, set)}
          <p style={{ font: '400 10px/1.6 var(--font-body)', color: 'var(--text-faint)', textAlign: 'center' }}>
            {t('บันทึกร่างอัตโนมัติ · อ้างอิงฟอร์ม')} {SA_SOURCE}
          </p>
        </div>
      )}
    </PlainShell>
  );
}

/* ── ตัวช่วยวาดคำถาม ─────────────────────────────────────────────────────── */

/** ข้อ K/S ของประเภทเดียวกันอยู่ติดกัน — จับมาวาดเป็นบล็อกเดียว จะได้เทียบ "รู้" กับ "ทำได้" ได้ในตาแรก */
function renderQuestions(
  questions: readonly SAQuestion[],
  answers: Record<string, SAValue>,
  set: (k: string, v: SAValue) => void,
) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.row) {
      const group = questions.filter((x) => x.row === q.row);
      if (questions.findIndex((x) => x.row === q.row) !== i) continue;
      out.push(
        <div key={q.row} className="card" style={{ padding: '11px 13px', display: 'grid', gap: 8 }}>
          <span style={{ font: '600 12px var(--font-head)' }}>{saLabel(q)}</span>
          {group.map((g) => (
            <div key={g.key} style={{ display: 'grid', gap: 4 }}>
              <span style={{ font: '600 10.5px var(--font-body)', color: 'var(--text-muted)' }}>
                {saColLabel(g.col!)}
              </span>
              <Choice
                options={scaleOptions(g.allowNA)}
                value={typeof answers[g.key] === 'number' ? (answers[g.key] as number) : null}
                onPick={(v) => set(g.key, v)}
              />
            </div>
          ))}
        </div>,
      );
      continue;
    }
    out.push(<Field key={q.key} q={q} answers={answers} set={set} />);
  }
  return <div style={{ display: 'grid', gap: 12 }}>{out}</div>;
}

function Field({
  q, answers, set,
}: {
  q: SAQuestion;
  answers: Record<string, SAValue>;
  set: (k: string, v: SAValue) => void;
}) {
  const v = answers[q.key];
  const numV = typeof v === 'number' ? v : null;
  const hint = saHint(q);

  return (
    <div className="card" style={{ padding: '11px 13px', display: 'grid', gap: 7 }}>
      <div style={{ display: 'grid', gap: 2 }}>
        <span style={{ font: '600 12px/1.45 var(--font-head)' }}>
          {saLabel(q)}
          {q.optional && (
            <span style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)' }}> · {t('ไม่บังคับ')}</span>
          )}
        </span>
        {hint && <span style={{ font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>{hint}</span>}
      </div>

      {q.kind === 'text' && (
        <textarea
          className="input"
          rows={3}
          value={typeof v === 'string' ? v : ''}
          onChange={(e) => set(q.key, e.target.value)}
          placeholder={t('พิมพ์คำตอบ')}
        />
      )}

      {q.kind === 'scale' && (
        <Choice options={scaleOptions(q.allowNA)} value={numV} onPick={(x) => set(q.key, x)} />
      )}
      {q.kind === 'level' && <Choice options={levelOptions()} value={numV} onPick={(x) => set(q.key, x)} />}
      {q.kind === 'yesno' && <Choice options={yesnoOptions()} value={numV} onPick={(x) => set(q.key, x)} />}

      {q.kind === 'multi' && (
        <>
          <div className="actgrid">
            {(q.options ?? []).map((opt, i) => {
              const cur = Array.isArray(v) ? v : [];
              const on = cur.includes(opt);
              return (
                <button
                  key={opt}
                  data-on={on}
                  onClick={() => set(q.key, on ? cur.filter((x) => x !== opt) : [...cur, opt])}
                >
                  {saOption(q, i)}
                </button>
              );
            })}
          </div>
          {q.other && (
            <input
              className="input"
              value={typeof answers[`${q.key}Other`] === 'string' ? (answers[`${q.key}Other`] as string) : ''}
              onChange={(e) => set(`${q.key}Other`, e.target.value)}
              placeholder={t('อื่นๆ (พิมพ์เพิ่มได้)')}
            />
          )}
        </>
      )}
    </div>
  );
}

/** แปลงคำตอบเป็นข้อความอ่านได้ — ใช้ตอนโหมดอ่านอย่างเดียวและฝั่งอาจารย์ */
export function readable(q: SAQuestion, v: SAValue | undefined): string {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        const i = (q.options ?? []).indexOf(x);
        return i >= 0 ? saOption(q, i) : x;
      })
      .join(' · ');
  }
  if (typeof v === 'number') {
    if (q.kind === 'level') return v === SA_APPROPRIATE ? (lang === 'en' ? 'Appropriate' : 'เหมาะสมแล้ว') : (lang === 'en' ? 'Need improvement' : 'ต้องปรับปรุง');
    if (q.kind === 'yesno') return v === 1 ? (lang === 'en' ? 'Yes' : 'ใช่') : (lang === 'en' ? 'No' : 'ไม่');
    if (v < 0) return 'N/A';
    const s = SA_SCALE.find((x) => x.v === v);
    return s ? `${v} · ${lang === 'en' ? s.label : s.th}` : String(v);
  }
  return String(v);
}
