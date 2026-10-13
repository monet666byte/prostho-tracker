import { ArrowClockwise, CaretLeft, CaretRight, CheckCircle, ListBullets, PencilSimple, Signature, Table, UserFocus, WarningCircle } from '@phosphor-icons/react';
import { Fragment, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { ScopeHead } from '../../components/teacher/ScopeHead';
import { Radar } from '../../components/charts/Radar';
import { ConfirmActions, ConfirmBox } from '../../components/ui/ConfirmBox';
import type { ProfileAxis } from '../../domain/analytics';
import { evaluateCheckIn, reviseCheckIn, setCheckInPunctual } from '../../data/repo';
import {
  CRITERIA, MAX_TOTAL, SCORE_SLOTS, isValidScore, missingCriteria, rubricText, scoreLevels, supersededBy, supersededTitle, totalScore,
} from '../../domain/checkin';
import { isAlumni } from '../../domain/cohort';
import {
  useAllCheckIns, useAllPatients, useAllStudents, useIdentityLevel, usePatientNamesOn, useStepsOnDates, useTeacher,
} from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { personName, t } from '../../lib/i18n';
import { patientLabel } from '../../lib/privacy';
import type { CheckIn } from '../../domain/types';
import { currentActor, useApp } from '../../store/app';
import { groupShort } from '../../domain/group';

/** ปุ่มคะแนนหนึ่งแถว — วางตามช่อง 0 1 2 3 ทุกแถว ข้อที่สมุดไม่มีระดับ 2 เว้นช่องไว้ ให้เลขแต่ละตัวอยู่คอลัมน์เดียวกัน */
function ScoreButtons({ critKey, label, value, disabled, hint, onPick }: {
  critKey: string;
  label: string;
  value: number | undefined;
  disabled?: boolean;
  hint?: (n: number) => string | undefined;
  onPick: (n: number, e: MouseEvent) => void;
}) {
  const levels = scoreLevels(critKey);
  return (
    <span className="scorerow__btns" role="radiogroup" aria-label={label}>
      {SCORE_SLOTS.map((n) => levels.includes(n) ? (
        <button
          key={n}
          type="button"
          title={hint?.(n)}
          data-on={value === n}
          data-v={n}
          aria-pressed={value === n}
          disabled={disabled}
          onClick={(e) => onPick(n, e)}
        >
          {n}
        </button>
      ) : (
        // เป็นปุ่มล่องหนเพื่อรับขนาดจากกฎปุ่มคะแนนทุกโหมด (เมาส์/สัมผัส/ตัวใหญ่) โดยไม่ต้องตามแก้ทีละที่
        <button key={n} type="button" className="scorerow__gap" tabIndex={-1} aria-hidden="true" disabled />
      ))}
    </span>
  );
}

/** คำอธิบายทุกระดับของหัวข้อหนึ่ง (ข้อความอังกฤษตามสมุด) — ระดับที่เลือกอยู่มีพื้นเน้น ให้อ่านทวนได้ว่าคะแนนที่ให้แปลว่าอะไร */
function RubricLevels({ critKey, picked }: { critKey: string; picked: number | undefined }) {
  return (
    <div className="rubric">
      {[...scoreLevels(critKey)].reverse().map((n) => (
        <p key={n} data-picked={picked === n}>
          <b>{n}</b>
          <span>{rubricText(critKey, n)}</span>
        </p>
      ))}
    </div>
  );
}

/** เส้นคะแนนรายคาบของนักศึกษาหนึ่งคน — ใช้ได้ทั้งคะแนนรวม (0–24) และรายหัวข้อ (0–3) */
function ScoreTrend({
  rows,
  getValue = (c) => totalScore(c.scores) ?? 0,
  max = MAX_TOTAL,
  ticks = [8, 16, 24],
  height = 132,
}: {
  rows: CheckIn[];
  getValue?: (c: CheckIn) => number;
  max?: number;
  ticks?: number[];
  height?: number;
}) {
  const pts = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) {
    return <p className="faint" style={{ font: '400 11px var(--font-body)', margin: '20px 0' }}>{t('มีผลประเมินคาบเดียว — เส้นแนวโน้มจะขึ้นเมื่อมีตั้งแต่ 2 คาบ')}</p>;
  }
  const W = 460, H = height, padL = 34, padR = 40, padT = 24, padB = 26;
  const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('คะแนนรายคาบ')}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" style={{ font: '400 9px var(--font-mono)', fill: 'var(--text-faint)' }}>{v}</text>
        </g>
      ))}
      <polyline
        points={pts.map((c, i) => `${x(i)},${y(getValue(c))}`).join(' ')}
        fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
      />
      {pts.map((c, i) => {
        const v = getValue(c);
        return (
          <g key={c.id}>
            <circle cx={x(i)} cy={y(v)} r={4} fill="var(--accent)" stroke="#fff" strokeWidth={2}>
              <title>{`${thaiShort(c.date)} · ${v}/${max} · ${c.activities.join(', ')}`}</title>
            </circle>
            <text x={x(i)} y={y(v) - 9} textAnchor="middle" style={{ font: '600 9.5px var(--font-mono)', fill: 'var(--text-muted)' }}>{v}</text>
            {(pts.length <= 5 || i % 2 === 0 || i === pts.length - 1) && (
              <text x={x(i)} y={H - 8} textAnchor="middle" style={{ font: '400 9px var(--font-body)', fill: 'var(--text-faint)' }}>{thaiShort(c.date)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const EVAL_MODE_KEY = 'pt-eval-mode';

/** หน้าประเมินรายคาบ — แทนการเซ็นสมุด Clinical rotation logbook ทีละแถว */
export default function Evaluate() {
  const { session, showToast } = useApp();
  const teacher = useTeacher(session?.teacherId);
  const students = useAllStudents();
  const patients = useAllPatients();
  const idLevel = useIdentityLevel('session-eval');
  const namesOn = usePatientNamesOn();
  const checkins = useAllCheckIns();

  const group = useApp((st) => st.teacherGroup);
  /* คะแนนที่กำลังกรอก ต่อ check-in — เริ่มแบบยังไม่เลือกสักข้อ และลงนามไม่ได้จนกว่าจะครบ 8 ข้อ
     เดิมเริ่มที่ 3 ทุกข้อ: อาจารย์กดลงนามได้โดยไม่ได้ดูทีละข้อ · ไม่เริ่มที่ 0 เพราะข้อที่กดตกจะกลายเป็น 0 เงียบๆ */
  const [drafts, setDrafts] = useState<Record<string, Record<string, number>>>({});
  /* เกณฑ์ที่กางอยู่ (แตะชื่อหัวข้อ) — เปิดได้ทีละข้อทั้งหน้า
     กางเป็นแถวเต็มกว้างใต้ "คู่แถว" ที่หัวข้อนั้นอยู่ ไม่ใช่ใต้หัวข้อเดียว — การ์ดจอกว้างเรียงหัวข้อสองคอลัมน์
     ถ้ากางในคอลัมน์เดียว อีกคอลัมน์จะเหลือช่องโล่งสูงเท่าเกณฑ์ · cols = จำนวนคอลัมน์ ณ ตอนกด (อ่านจากกริดจริง) */
  const [openRubric, setOpenRubric] = useState<{ id: string; key: string; cols: number } | null>(null);
  // หมุนจอ/ย่อหน้าต่าง จำนวนคอลัมน์อาจเปลี่ยน — ปิดเกณฑ์ที่กางไว้แทนการวางผิดแถว
  // ดูเฉพาะความกว้าง: Safari บน iPhone ยิง resize ทุกครั้งที่เลื่อนจอจนแถบที่อยู่ยุบ/กาง (ความสูงเปลี่ยน)
  useEffect(() => {
    if (!openRubric) return;
    const width = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== width) setOpenRubric(null); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [openRubric]);
  const [chartStudent, setChartStudent] = useState<string | null>(null);
  // หัวข้อที่กดเลือกบนกราฟแมงมุม — เปิดกราฟเส้นรายหัวข้อฝั่งขวา (คงไว้ตอนสลับคน จะได้เทียบหัวข้อเดิมข้ามคน)
  const [critKey, setCritKey] = useState<string | null>(null);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const patientById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  const inGroup = checkins.filter((c) => studentById.get(c.studentId)?.group === group);
  const groupStudents = useMemo(
    () => students.filter((st) => st.group === group).sort((a, b) => a.code.localeCompare(b.code)),
    [students, group],
  );
  const evaluatedInGroup = useMemo(() => inGroup.filter((c) => c.status === 'evaluated'), [inGroup]);

  // รายหัวข้อ (0–3) ต่อคน และของทั้งกลุ่มไว้เป็นเส้นเทียบ — รูปทรงกราฟใช้ค่าเฉลี่ย
  // แต่ตัวเลขที่โชว์เป็น "จำนวนครั้ง" ที่ได้แต่ละระดับ (อาจารย์คอมเมนต์ว่าไม่อยากเห็นเลขเฉลี่ย)
  const criterionAvg = (rows: CheckIn[]): ProfileAxis[] =>
    CRITERIA.map((cr) => {
      const vals = rows.map((c) => c.scores?.[cr.key] ?? 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const count = (n: number) => vals.filter((v) => v === n).length;
      const hasTwo = scoreLevels(cr.key).includes(2);
      return {
        key: cr.key,
        label: t(cr.short),
        value: Math.round((avg / 3) * 100),
        detail: hasTwo
          ? t('ได้ 3 = {a} คาบ · ได้ 2 = {d} · ได้ 1 = {b} · ได้ 0 = {c}', { a: count(3), d: count(2), b: count(1), c: count(0) })
          : t('ได้ 3 = {a} คาบ · ได้ 1 = {b} · ได้ 0 = {c}', { a: count(3), b: count(1), c: count(0) }),
        counts: [count(3), hasTwo ? count(2) : null, count(1), count(0)] as [number, number | null, number, number],
      };
    });
  const selectedId = chartStudent ?? groupStudents[0]?.id ?? null;
  const selectedRows = evaluatedInGroup.filter((c) => c.studentId === selectedId);
  const groupProfile = useMemo(() => criterionAvg(evaluatedInGroup), [evaluatedInGroup]);
  const stepsByKey = useStepsOnDates(inGroup.map((c) => ({ studentId: c.studentId, date: c.date })));
  // ชั้นที่ 3 — ยืนยันโดยระบุชื่อ: ต่อให้หน้าจอขยับ ก่อนบันทึกจะมีกล่องบอกชื่อ นศ. เสมอ
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /* คาบที่กำลังแก้ป้ายตรงต่อเวลา + เหตุผลที่อาจารย์พิมพ์ (ไม่บังคับ แต่ลงไปใน audit ถ้าพิมพ์) */
  const [punctualId, setPunctualId] = useState<string | null>(null);
  const [punctualNote, setPunctualNote] = useState('');
  const signing = useRef(false);
  // แก้คะแนนที่ลงไปแล้ว — คาบที่กำลังแก้ และคะแนนชุดใหม่ที่กำลังกรอก
  const [reviseId, setReviseId] = useState<string | null>(null);
  const [reviseDraft, setReviseDraft] = useState<Record<string, number>>({});
  /* โหมด "ทีละคน" — โชว์การ์ดเดียว มีคิวด้านข้าง + ปุ่มลัดคีย์บอร์ด · จำไว้ในเครื่อง
     ขั้นตอนบันทึกเหมือนโหมดรายการทุกอย่าง (เริ่มแบบยังไม่เลือก · กล่องยืนยันชื่อก่อนลงนาม) */
  const [mode, setModeState] = useState<'list' | 'focus'>(() => {
    try { return localStorage.getItem(EVAL_MODE_KEY) === 'focus' ? 'focus' : 'list'; } catch { return 'list'; }
  });
  const setMode = (m: 'list' | 'focus') => {
    setModeState(m);
    try { localStorage.setItem(EVAL_MODE_KEY, m); } catch { /* โหมดส่วนตัว — จำไม่ได้ก็ไม่เป็นไร */ }
  };
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeCrit, setActiveCrit] = useState(0);

  /**
   * ⚠️ ความปลอดภัย: กันอาจารย์ "ประเมินผิดคน"
   *
   * ชั้นที่ 1 — ลำดับคงที่: เรียงตามรหัสนักศึกษาเหมือนใบรายชื่อ (เดิมเรียงใหม่สุดขึ้นบน
   *   ทำให้การ์ดกระโดดเวลามีคนเช็คอินเข้ามาระหว่างอาจารย์กำลังกด)
   * ชั้นที่ 2 — ของใหม่ไม่แทรก: คนที่เช็คอินระหว่างนี้ไปรออยู่หลังแถบ "มีเช็คอินใหม่"
   *   อาจารย์กดเองเมื่อพร้อม รายการที่กำลังทำอยู่จึงไม่ขยับใต้นิ้ว
   */
  const pendingAll = useMemo(() => {
    const rows = inGroup.filter((c) => c.status === 'pending');
    return rows.sort((a, b) => {
      const ca = studentById.get(a.studentId)?.code ?? '';
      const cb = studentById.get(b.studentId)?.code ?? '';
      return ca.localeCompare(cb) || a.date.localeCompare(b.date);
    });
  }, [inGroup, studentById]);

  const pendingKey = pendingAll.map((c) => c.id).join(',');
  const [snapshot, setSnapshot] = useState<string[]>([]);
  // "กำลังทำงานอยู่" = แตะปุ่มคะแนนของใครไปแล้ว หรือเปิดกล่องยืนยันค้างไว้
  // ตอนนี้เท่านั้นที่ล็อกรายการ — ถ้ายังไม่ได้แตะอะไร ของใหม่ไหลเข้ามาได้ตามปกติ
  const busyScoring = Object.keys(drafts).length > 0 || confirmId !== null;
  /**
   * การล็อกรายการมีไว้กันการ์ดขยับใต้นิ้ว "ภายในกลุ่มเดียวกัน" เท่านั้น
   *
   * บั๊กที่เจอ: ถ้าแตะคะแนนค้างไว้แล้วสลับไปกลุ่มอื่น snapshot ของกลุ่มเดิมยังถูกใช้อยู่
   * ทุกคนในกลุ่มใหม่จึงถูกนับเป็น "ของใหม่" ไปกองหลังแถบสีฟ้า และหัวข้อขึ้นว่า
   * "รอประเมิน · 0 คน" ทั้งที่มีคนรอจริง — อาจารย์เวรที่สลับมาเซ็นให้กลุ่มอื่น
   * จะเข้าใจว่าไม่มีใครรอแล้วเดินจากไป
   * เปลี่ยนกลุ่ม = เริ่มงานชุดใหม่ ต้องล้างทั้ง snapshot และคะแนนที่ค้างของกลุ่มเดิม
   */
  const snapGroup = useRef(group);
  useEffect(() => {
    const switchedGroup = snapGroup.current !== group;
    if (switchedGroup) {
      snapGroup.current = group;
      setDrafts({});
      setConfirmId(null);
      setSnapshot(pendingAll.map((c) => c.id));
      return;
    }
    if (!busyScoring) setSnapshot(pendingAll.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyScoring, pendingKey, group]);

  const confirmRow = confirmId ? pendingAll.find((c) => c.id === confirmId) ?? null : null;
  const confirmStudent = confirmRow ? studentById.get(confirmRow.studentId) : undefined;
  /* หาได้จากทั้งคิวที่รอประเมินและประวัติที่ประเมินแล้ว — ป้ายนี้แก้ได้ทั้งก่อนและหลังลงคะแนน
     (เวลาที่มาถึงไม่เกี่ยวกับว่าให้คะแนนไปแล้วหรือยัง) */
  const punctualRow = punctualId ? inGroup.find((c) => c.id === punctualId) ?? null : null;
  const punctualStudent = punctualRow ? studentById.get(punctualRow.studentId) : undefined;

  const closePunctual = () => { setPunctualId(null); setPunctualNote(''); };

  async function savePunctual(id: string, next: boolean) {
    const res = await setCheckInPunctual(id, next, teacher?.name ?? currentActor(), punctualNote);
    closePunctual();
    if (res.ok) {
      showToast({
        message: next
          ? t('แก้เป็น "ตรงเวลา" แล้ว — บันทึกใน audit log')
          : t('แก้เป็น "มาสาย" แล้ว — บันทึกใน audit log'),
        tone: 'success',
      });
    } else if (res.reason === 'graduated') {
      showToast({ message: t('รุ่นนี้เรียนจบแล้ว — แก้ไขไม่ได้'), tone: 'warning' });
    } else if (res.reason === 'nochange') {
      showToast({ message: t('ค่าเดิมอยู่แล้ว ไม่มีอะไรเปลี่ยน'), tone: 'warning' });
    } else {
      showToast({ message: t('ไม่พบคาบนี้แล้ว (อาจถูกลบไป)'), tone: 'warning' });
    }
  }
  const shown = new Set(snapshot);
  const pending = pendingAll.filter((c) => shown.has(c.id));
  const incoming = pendingAll.filter((c) => !shown.has(c.id));
  const showIncoming = () => setSnapshot(pendingAll.map((c) => c.id));
  const evaluatedAll = inGroup.filter((c) => c.status === 'evaluated');
  // ตารางประวัติยาวมาก — พับไว้ก่อน โชว์ 5 แถวล่าสุดพอ
  const [showAllEvaluated, setShowAllEvaluated] = useState(false);
  const evaluated = showAllEvaluated ? evaluatedAll.slice(0, 40) : evaluatedAll.slice(0, 5);

  const draftFor = (id: string): Record<string, number> => drafts[id] ?? {};

  async function sign(id: string) {
    if (signing.current) return;
    // ปุ่มลงนามปิดอยู่แล้วถ้ายังไม่ครบ — กันซ้ำตรงนี้เผื่อมาทางคีย์บอร์ด
    if (missingCriteria(draftFor(id)).length) return;
    signing.current = true;
    // โหมดทีละคน: เซ็นเสร็จแล้วไปคนถัดไปในคิว (คิดไว้ก่อนรายการจะหดลง)
    const at = pending.findIndex((c) => c.id === id);
    const nextId = pending[at + 1]?.id ?? pending[at - 1]?.id ?? null;
    try {
      const res = await evaluateCheckIn(id, draftFor(id), teacher?.name ?? currentActor());
      setConfirmId(null);
      if (res.ok) {
        setFocusId(nextId);
        setActiveCrit(0);
        // ปล่อย draft ของคาบที่เซ็นแล้ว — ถ้าไม่เหลือใครค้าง รายการจะกลับมาอัปเดตเองตามปกติ
        setDrafts((d) => {
          const next = { ...d };
          delete next[id];
          return next;
        });
        showToast({ message: t('บันทึกผลประเมินแล้ว (เทียบเท่าลงนามในสมุด)'), tone: 'success' });
      } else if (res.reason === 'already') {
        // ชั้นที่ 4 — อาจารย์อีกท่านลงคะแนนคาบนี้ไปแล้ว ระบบไม่เขียนทับให้
        showToast({ message: t('คาบนี้ {who} ประเมินไปแล้ว — ระบบไม่บันทึกทับ', { who: res.by || t('อาจารย์ท่านอื่น') }), tone: 'warning' });
      } else if (res.reason === 'graduated') {
        showToast({ message: t('รุ่นนี้เรียนจบแล้ว — แก้ไขไม่ได้'), tone: 'warning' });
      } else {
        showToast({ message: t('ไม่พบคาบนี้แล้ว (อาจถูกลบไป)'), tone: 'warning' });
      }
    } finally {
      signing.current = false;
    }
  }

  // ── แก้คะแนนที่ลงไปแล้ว ────────────────────────────────────────────────
  const reviseRow = reviseId ? evaluatedAll.find((c) => c.id === reviseId) ?? null : null;
  const reviseStudent = reviseRow ? studentById.get(reviseRow.studentId) : undefined;
  const reviseBefore = reviseRow?.scores ?? {};
  const reviseDiffs = CRITERIA.filter((cr) => (reviseBefore[cr.key] ?? 0) !== (reviseDraft[cr.key] ?? 0));

  function openRevise(c: CheckIn) {
    setReviseId(c.id);
    setReviseDraft(Object.fromEntries(CRITERIA.map((cr) => [cr.key, c.scores?.[cr.key] ?? 0])));
  }
  function closeRevise() {
    setReviseId(null);
    setReviseDraft({});
  }

  async function saveRevise() {
    if (!reviseRow || signing.current) return;
    signing.current = true;
    try {
      const res = await reviseCheckIn(reviseRow.id, reviseDraft, teacher?.name ?? currentActor());
      if (res.ok) {
        closeRevise();
        showToast({
          message: t('แก้คะแนนแล้ว {n} หัวข้อ — บันทึกไว้ในประวัติเรียบร้อย', { n: res.changed }),
          tone: 'success',
        });
      } else if (res.reason === 'nochange') {
        closeRevise();
      } else if (res.reason === 'graduated') {
        closeRevise();
        showToast({ message: t('รุ่นนี้เรียนจบแล้ว — แก้ไขไม่ได้'), tone: 'warning' });
      } else {
        showToast({ message: t('แก้ไม่สำเร็จ — คาบนี้อาจถูกลบหรือเปลี่ยนสถานะไปแล้ว'), tone: 'warning' });
      }
    } finally {
      signing.current = false;
    }
  }

  const current = mode === 'focus' ? (pending.find((c) => c.id === focusId) ?? pending[0]) : undefined;
  const currentIndex = current ? pending.findIndex((c) => c.id === current.id) : -1;
  const goFocus = (step: number) => {
    const next = pending[currentIndex + step];
    if (next) { setFocusId(next.id); setActiveCrit(0); }
  };

  /* ปุ่มลัดของโหมดทีละคน — ใช้ e.code ให้ทำงานแม้แป้นพิมพ์เป็นภาษาไทย (เลข 1 บนแป้นไทยคือ "ๅ")
     ไม่ทำงานตอนพิมพ์ในช่องกรอก หรือมีกล่องแก้ป้ายตรงเวลา/แก้คะแนนเปิดอยู่
     กล่องยืนยันลงนามเปิดอยู่: Enter = ยืนยัน · Esc = ยกเลิก (กล่องนี้ยังบอกชื่อ นศ. ทุกครั้งเหมือนเดิม) */
  useEffect(() => {
    if (mode !== 'focus') return;
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (punctualId || reviseId) return;
      if (confirmRow) {
        if (e.key === 'Enter') { e.preventDefault(); void sign(confirmRow.id); }
        else if (e.key === 'Escape') { e.preventDefault(); setConfirmId(null); }
        return;
      }
      if (!current) return;
      const st = studentById.get(current.studentId);
      const locked = st ? isAlumni(st) : false;
      const digit = ({ Digit0: 0, Numpad0: 0, Digit1: 1, Numpad1: 1, Digit2: 2, Numpad2: 2, Digit3: 3, Numpad3: 3 } as Record<string, number>)[e.code];
      if (digit !== undefined) {
        if (locked) return;
        e.preventDefault();
        const d = draftFor(current.id);
        const cr = CRITERIA[activeCrit];
        // 2 มีเฉพาะ Knowledge/Skill/Precaution — กด 2 ที่ข้ออื่นไม่ทำอะไร และไม่ขยับไปข้อถัดไป
        if (!isValidScore(cr.key, digit)) return;
        setDrafts((prev) => ({ ...prev, [current.id]: { ...d, [cr.key]: digit } }));
        setActiveCrit((i) => Math.min(CRITERIA.length - 1, i + 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); setActiveCrit((i) => Math.min(CRITERIA.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setActiveCrit((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        // กันปุ่มที่โฟกัสค้างอยู่ (เช่นปุ่มคะแนนที่เพิ่งกด) โดนกดซ้ำแทนการเปิดกล่องยืนยัน
        e.preventDefault();
        if (locked) return;
        // ยังไม่ครบ: พาไปข้อแรกที่ยังไม่เลือกแทนการเปิดกล่องยืนยัน
        const miss = missingCriteria(draftFor(current.id));
        if (miss.length) setActiveCrit(CRITERIA.findIndex((cr) => cr.key === miss[0]));
        else setConfirmId(current.id);
      } else if (e.code === 'KeyJ') {
        e.preventDefault(); goFocus(1);
      } else if (e.code === 'KeyK') {
        e.preventDefault(); goFocus(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** การ์ดประเมินหนึ่งคาบ — ใช้ทั้งโหมดรายการและโหมดทีละคน (focus = มีแถวหัวข้อที่เลือกไว้สำหรับคีย์บอร์ด) */
  const renderEvalCard = (c: CheckIn, focus = false) => {
    const student = studentById.get(c.studentId);
    const patient = c.patientId ? patientById.get(c.patientId) : undefined;
    const draft = draftFor(c.id);
    const total = totalScore(draft) ?? 0;
    // รุ่นที่เรียนจบแล้ว = ประวัติที่ปิดจบ ห้ามให้คะแนนย้อนหลัง
    const locked = student ? isAlumni(student) : false;
    return (
      <div key={c.id} className="evalcard evalcard--calm">
        {/* การ์ดประเมินแบบ "ตัดของซ้ำ"
            ซ้าย = ใคร · ทำอะไร · ขวา = ให้คะแนน · 3 เป็นปุ่มเรียบ
            ข้อที่ให้ 2 = เหลืองอ่อน · 1 = เหลือง · 0 = แดง → ตาเห็นเฉพาะข้อที่หักทันที (เดิมปุ่มน้ำเงินทึบ 8 ปุ่มทุกคน) */}
        <div className="evalcard__info">
          <div className="evalwho">
            <b>{personName(student, '')}</b>
            <span className="mono">{student?.code}</span>
          </div>
          <div className="evalline">
            {thaiShort(c.date)}{c.checkinAt ? ` · ${c.checkinAt}` : ''}{' · '}
            {/* ป้ายตรงต่อเวลา — กดเพื่อแก้ได้ทั้งสองทาง
                `punctual` คิดครั้งเดียวตอนกดเช็คอินจากเวลาเครื่อง แล้วเดิมแก้ไม่ได้เลย
                คนที่มาคาบบ่ายจริงแต่ลืมเช็คอินจนเย็นจะถูกบันทึกว่าสายถาวร
                แล้วหน้าประเมินตนเองขึ้น "มาสายบ่อยกว่าที่คิด" ให้อาจารย์อ่าน
                ต้องกดได้ทั้งสองสถานะ — ทางเดียวแปลว่าแก้พลาดแล้วแก้กลับไม่ได้ */}
            <button
              className={`evalpunct${c.punctual ? '' : ' evalpunct--late'}`}
              title={t('อาจารย์แก้ป้ายนี้ได้ — ทุกครั้งบันทึกใน audit log')}
              onClick={() => setPunctualId(c.id)}
            >
              {c.punctual ? t('ตรงเวลา') : t('มาสาย')}
            </button>
            {c.noPatient && <> · {t('ไม่มีผู้ป่วย')}</>}
            {/* นักศึกษาแก้บันทึกหลังเช็คอิน — โชว์ให้อาจารย์เห็นตรงๆ ว่ามีการแก้และเมื่อไหร่ (รายละเอียดเต็มอยู่ audit log) */}
            {c.editedAt && <> · {t('นศ. แก้ไข')} {thaiShort(c.editedAt)}</>}
          </div>
          <div className="evalact">
            {c.activities.length ? c.activities.map((a) => t(a)).join(' · ') : <i style={{ color: 'var(--text-faint)', fontWeight: 400 }}>{t('ยังไม่ระบุกิจกรรม')}</i>}
            {/* ให้คะแนน "นักศึกษา" — คนไข้เป็นบริบทว่าคาบนั้นทำอะไร ไม่ใช่สิ่งที่ต้องระบุตัว
                ระดับที่เห็นมาจาก lib/privacy.ts (สวิตช์ maskByDefault ของภาค) */}
            {patient && (() => {
              const lb = patientLabel(patient, idLevel, namesOn);
              return (
                <span className="mono evalpatient">
                  {' · '}{t(lb.name)}{lb.hn ? ` (HN ${lb.hn})` : ''}
                </span>
              );
            })()}
          </div>
          {c.note && (
            <div className="evalsteps" style={{ overflowWrap: 'anywhere' }}>{t('โน้ต')}: {c.note}</div>
          )}
          {/* หลักฐานจริงประกอบการให้คะแนน — step ที่นักศึกษาบันทึกว่าทำเสร็จในวันนั้น
              ไม่มี = บรรทัดเล็กบรรทัดเดียว (เดิมเป็นกล่องเทาว่างทั้งกล่อง) */}
          {(stepsByKey.get(`${c.studentId}|${c.date}`) ?? []).length ? (
            <div className="evalsteps evalsteps--done">
              <CheckCircle size={13} weight="fill" style={{ verticalAlign: -2, marginRight: 4 }} />
              {(stepsByKey.get(`${c.studentId}|${c.date}`) ?? []).join(' · ')}
            </div>
          ) : (
            <div className="evalsteps">{t('ไม่มีบันทึก step เสร็จวันนั้น')}</div>
          )}
        </div>

        <div className="evalcard__scores">
          {CRITERIA.map((cr, ci) => {
            const v = draft[cr.key];
            const picked = isValidScore(cr.key, v);
            const open = openRubric?.id === c.id && openRubric.key === cr.key;
            // แถวเกณฑ์วางต่อจากหัวข้อตัวท้ายของคู่ (สองคอลัมน์) หรือต่อจากหัวข้อนั้นเลย (คอลัมน์เดียว)
            const openAt = openRubric?.id === c.id ? CRITERIA.findIndex((x) => x.key === openRubric.key) : -1;
            const rowEnd = openAt < 0 ? -1
              : openRubric!.cols > 1 ? Math.min(CRITERIA.length - 1, openAt - (openAt % openRubric!.cols) + openRubric!.cols - 1)
              : openAt;
            const openCrit = openAt >= 0 ? CRITERIA[openAt] : null;
            return (
              <Fragment key={cr.key}>
                <div className="scorerow" data-open={open} data-changed={picked && v !== 3} data-empty={!picked} data-cur={focus && ci === activeCrit} onClick={focus ? () => setActiveCrit(ci) : undefined}>
                  {/* เกณฑ์จากสมุด: ชี้เมาส์ = กล่องลอย (เฉพาะเครื่องที่มีเมาส์) · แตะ/คลิกชื่อ = กางเป็นแถว
                      ไม่ผูกกับการกดคะแนน — ให้คะแนนต่อเนื่องได้โดยไม่มีอะไรเด้งมาบัง */}
                  <span className="scorerow__head">
                    <button
                      type="button"
                      className="scorerow__label scorerow__label--btn"
                      aria-expanded={open}
                      onClick={(e) => {
                        const grid = e.currentTarget.closest('.evalcard__scores');
                        const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 1;
                        setOpenRubric(open ? null : { id: c.id, key: cr.key, cols });
                      }}
                    >
                      {cr.label}<span className="scorerow__q" aria-hidden="true">?</span>
                      {!picked && <span className="scorerow__empty">{t('ยังไม่เลือก')}</span>}
                    </button>
                    {!open && (
                      <span className="scorerow__pop" role="tooltip">
                        <b>{cr.label}</b>
                        <RubricLevels critKey={cr.key} picked={v} />
                      </span>
                    )}
                  </span>
                  <ScoreButtons
                    critKey={cr.key}
                    label={cr.label}
                    value={v}
                    disabled={locked}
                    hint={focus ? (n) => t('กด {n} บนคีย์บอร์ด', { n }) : undefined}
                    onPick={(n, e) => {
                      setDrafts({ ...drafts, [c.id]: { ...draft, [cr.key]: n } });
                      if (focus) { e.stopPropagation(); setActiveCrit(Math.min(CRITERIA.length - 1, ci + 1)); }
                    }}
                  />
                </div>
                {ci === rowEnd && openCrit && (
                  <div className="rubricrow">
                    {openRubric!.cols > 1 && <b>{openCrit.label}</b>}
                    <RubricLevels critKey={openCrit.key} picked={draft[openCrit.key]} />
                  </div>
                )}
              </Fragment>
            );
          })}
          {(() => {
            const missing = missingCriteria(draft).length;
            const changed = CRITERIA.filter((cr) => isValidScore(cr.key, draft[cr.key]) && draft[cr.key] !== 3).length;
            const anyPicked = missing < CRITERIA.length;
            return (
              <div className="evalfoot">
                <span className="evalfoot__total">{missing ? '–' : total}<small> / {MAX_TOTAL}</small></span>
                <span className="evalfoot__note">
                  {missing ? t('ยังไม่เลือก {n} ข้อ', { n: missing }) : changed ? t('ปรับ {n} ข้อ', { n: changed }) : t('ได้ 3 ทุกข้อ')}
                  {anyPicked && (
                    <>
                      {' · '}
                      <button
                        className="textbtn"
                        disabled={locked}
                        onClick={() => { const next = { ...drafts }; delete next[c.id]; setDrafts(next); }}
                      >
                        {t('ล้างที่เลือก')}
                      </button>
                    </>
                  )}
                </span>
                <button
                  className="btn"
                  style={{ width: 'auto', height: 40, fontSize: 13, padding: '0 16px' }}
                  disabled={locked || missing > 0}
                  title={locked ? t('รุ่นนี้เรียนจบแล้ว — แก้ไขไม่ได้') : undefined}
                  onClick={() => setConfirmId(c.id)}
                >
                  {!missing && <Signature size={16} weight="bold" />}
                  {locked ? t('รุ่นนี้จบแล้ว') : missing ? t('เลือกให้ครบก่อน (เหลือ {n})', { n: missing }) : t('บันทึกผล · ลงนาม')}
                </button>
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  return (
    <TeacherShell active="evaluate">
      <main className="main">
        <ScopeHead scope="group" icon={Table} title={t('ประเมินรายคาบ')} />

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="evalhead">
            <h3>
              {t('รอประเมิน')} · {t('{n} คน', { n: new Set(pending.map((c) => c.studentId)).size })}
              {pending.length > new Set(pending.map((c) => c.studentId)).size && ` (${t('{n} รายการ', { n: pending.length })})`}
            </h3>
            <div className="seg seg--sm" role="group" aria-label={t('มุมมอง')}>
              <button data-on={mode === 'list'} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
                <ListBullets size={14} weight="bold" />{t('ทั้งหมด')}
              </button>
              <button data-on={mode === 'focus'} aria-pressed={mode === 'focus'} onClick={() => setMode('focus')}>
                <UserFocus size={14} weight="bold" />{t('ทีละคน')}
              </button>
            </div>
          </div>

          {pending.length === 0 && (
            <div className="dashed" style={{ marginTop: 12, padding: '22px 16px', textAlign: 'center', font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
              {t('ประเมินครบทุกคนแล้ว')}
            </div>
          )}

          {incoming.length > 0 && (
            <button
              onClick={showIncoming}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 12,
                background: 'var(--accent-tint)', border: '1px solid var(--accent-ring)', borderRadius: 12,
                padding: '10px 14px', cursor: 'pointer', font: '600 12px var(--font-body)', color: 'var(--accent-hover)',
              }}
            >
              <ArrowClockwise size={15} weight="bold" />
              {t('มีเช็คอินใหม่ {n} รายการ — แตะเพื่อแสดง', { n: incoming.length })}
              <span style={{ marginLeft: 'auto', font: '400 10.5px var(--font-body)', color: 'var(--text-muted)' }}>
                {t('รายการที่กำลังให้คะแนนจะไม่ขยับ')}
              </span>
            </button>
          )}

          {mode === 'focus' && current ? (
            <div className="evalfocus">
              {/* คิวด้านข้าง — ลำดับเดียวกับโหมดรายการ (ตามรหัสนักศึกษา) · จุดฟ้า = แตะคะแนนไปแล้ว */}
              <div className="evalfocus__queue">
                {pending.map((c, i) => {
                  const st = studentById.get(c.studentId);
                  const on = c.id === current.id;
                  return (
                    <button key={c.id} className="evalq" data-on={on} aria-current={on ? 'true' : undefined} onClick={() => { setFocusId(c.id); setActiveCrit(0); }}>
                      <span className="evalq__n">{i + 1}</span>
                      <span className="evalq__who">
                        <b>{personName(st, '')}</b>
                        <small>{thaiShort(c.date)}</small>
                      </span>
                      {drafts[c.id] && <span className="evalq__dot" title={t('แตะคะแนนไปแล้ว')} />}
                    </button>
                  );
                })}
                <div className="evalfocus__keys" aria-hidden>
                  <div><kbd>0</kbd><kbd>1</kbd><kbd>3</kbd>{t('ให้คะแนนหัวข้อที่เลือก')}</div>
                  <div><kbd>↑</kbd><kbd>↓</kbd>{t('เลื่อนหัวข้อ')}</div>
                  <div><kbd>↵</kbd>{t('บันทึก (มีกล่องยืนยันชื่อ)')}</div>
                  <div><kbd>J</kbd><kbd>K</kbd>{t('คนถัดไป / ก่อนหน้า')}</div>
                </div>
              </div>
              <div className="evalfocus__main">
                <div className="evalfocus__bar">
                  <span>{t('คนที่ {i} จาก {n}', { i: currentIndex + 1, n: pending.length })}</span>
                  <button className="evalfocus__nav" onClick={() => goFocus(-1)} disabled={currentIndex <= 0} aria-label={t('คนก่อนหน้า')}><CaretLeft size={15} weight="bold" /></button>
                  <button className="evalfocus__nav" onClick={() => goFocus(1)} disabled={currentIndex >= pending.length - 1} aria-label={t('คนถัดไป')}><CaretRight size={15} weight="bold" /></button>
                </div>
                {renderEvalCard(current, true)}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 13, marginTop: 12 }}>
              {pending.map((c) => renderEvalCard(c))}
            </div>
          )}
        </div>

        <div className="panel">
          <h3>{t('ประเมินแล้วล่าสุด')} · {t('กลุ่ม')} {groupShort(group)}</h3>
          {/* ส่วนประวัติแบบ "ตัดของซ้ำ": ชิปคะแนน → ตัวเลข · ปุ่มแก้มีกรอบ → ข้อความ
              · ปุ่มดูทั้งหมดยาวเต็มแถว → ลิงก์ · ปุ่มเลือกนักศึกษา 8 ปุ่ม → ช่องเลือกอันเดียว · คำอธิบายกราฟรวมบรรทัดเดียว */}
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('นักศึกษา')}</th>
                <th style={{ width: 76 }}>{t('วันที่')}</th>
                <th>{t('กิจกรรม')}</th>
                <th style={{ width: 66 }}>{t('คะแนน')}</th>
                <th style={{ width: 88 }}>{t('ผู้ประเมิน')}</th>
                <th style={{ width: 46 }} />
              </tr>
            </thead>
            <tbody>
              {evaluated.length === 0 && (
                <tr><td colSpan={6} className="faint" style={{ padding: 16 }}>{t('ยังไม่มีคาบที่ประเมินแล้ว')}</td></tr>
              )}
              {evaluated.map((c) => {
                const st = studentById.get(c.studentId);
                const locked = st ? isAlumni(st) : false;
                return (
                <tr key={c.id}>
                  <td style={{ font: '600 11.5px var(--font-body)' }}>{personName(st, '')}</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>{thaiShort(c.date)}</td>
                  <td style={{ font: '400 11px var(--font-body)', color: 'var(--text-muted)' }}>{c.activities.length ? c.activities.map((a) => t(a)).join(' · ') : t('ยังไม่ระบุกิจกรรม')}</td>
                  <td>
                    {(() => {
                      const sc = totalScore(c.scores) ?? 0;
                      return (
                        <span className="mono" style={{ fontWeight: 600, color: sc === MAX_TOTAL ? 'var(--success-dark)' : sc < 20 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                          {sc}/{MAX_TOTAL}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
                    {t(c.evaluatedBy ?? '')}
                    {/* คะแนนชุดก่อนหน้ายังอยู่ครบในฐานข้อมูล (0017) — บอกให้เห็นว่ามีคนทับ
                        ไม่งั้นอาจารย์ที่ลงคะแนนไปก่อนจะไม่มีทางรู้ว่าของตัวเองถูกแทนที่ */}
                    {supersededBy(c) && (
                      <span className="chip" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)', marginInlineStart: 4 }} title={supersededTitle(c)}>
                        <WarningCircle size={10} weight="fill" /> {t('ทับของ {who}', { who: t(supersededBy(c)!) })}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className="revisebtn revisebtn--text"
                      disabled={locked}
                      title={locked ? t('รุ่นนี้เรียนจบแล้ว — แก้ไขไม่ได้') : t('แก้คะแนนคาบนี้')}
                      onClick={() => openRevise(c)}
                    >
                      {t('แก้')}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {evaluatedAll.length > 5 && (
            <button
              className="textbtn"
              style={{ marginTop: 8 }}
              onClick={() => setShowAllEvaluated(!showAllEvaluated)}
            >
              {showAllEvaluated ? t('พับเหลือ 5 แถว') : t('ดูทั้งหมด ({n} รายการ)', { n: evaluatedAll.length })} {showAllEvaluated ? '▴' : '›'}
            </button>
          )}
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="tblhead">
            <h3>{t('กราฟคะแนนรายคน')}</h3>
            <select
              className="tblhead__group"
              value={selectedId ?? ''}
              onChange={(e) => setChartStudent(e.target.value)}
              aria-label={t('เลือกนักศึกษา')}
            >
              {groupStudents.map((st) => (
                <option key={st.id} value={st.id}>{`${personName(st)} · ${st.code}`}</option>
              ))}
            </select>
          </div>

          {selectedRows.length === 0 ? (
            <div className="dashed" style={{ padding: '22px 16px', textAlign: 'center', font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
              {t('ยังไม่มีคาบที่ประเมินแล้วของคนนี้')}
            </div>
          ) : (
            // flex-wrap + จัดชิดบน: จอแคบ/ตัวหนังสือใหญ่ กราฟขวาจะตกลงมาเต็มแถวแทนที่จะโดนบีบ
            // และความสูงที่เปลี่ยน (เปิดตาราง/เปิดกราฟหัวข้อ) จะไม่ดันของอย่างอื่นขยับ
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 30, alignItems: 'flex-start', marginTop: 4 }}>
              <div style={{ flex: '1 1 400px', minWidth: 'min(300px, 100%)', maxWidth: 560 }}>
                <Radar
                  axes={criterionAvg(selectedRows)}
                  reference={groupProfile}
                  label={personName(studentById.get(selectedId ?? ''), '')}
                  referenceLabel={`${t('เฉลี่ยกลุ่ม')} ${groupShort(group)}`}
                  size={250}
                  onAxisClick={(k) => setCritKey(k === critKey ? null : k)}
                  activeKey={critKey}
                  floor={50}
                />
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 'min(270px, 100%)', maxWidth: 500 }}>
                <div style={{ font: '600 12.5px var(--font-head)', marginBottom: 2 }}>{t('คะแนนรวมรายคาบ (เต็ม {n})', { n: MAX_TOTAL })}</div>
                <ScoreTrend rows={selectedRows} />
                {critKey ? (() => {
                  const crit = CRITERIA.find((cr) => cr.key === critKey)!;
                  return (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, font: '600 12.5px var(--font-head)' }}>
                          {t('คะแนน "{s}" รายคาบ (เต็ม 3)', { s: t(crit.short) })} <span className="faint" style={{ font: '400 10.5px var(--font-body)' }}>{crit.label}</span>
                        </div>
                        <button
                          onClick={() => setCritKey(null)}
                          style={{ font: '500 11px var(--font-body)', color: 'var(--text-muted)', background: 'var(--fill)', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
                        >
                          {t('ปิด')}
                        </button>
                      </div>
                      <ScoreTrend
                        rows={selectedRows}
                        getValue={(c) => c.scores?.[critKey] ?? 0}
                        max={3}
                        ticks={[0, 1, 3]}
                        height={104}
                      />
                    </div>
                  );
                })() : (
                  <p className="faint" style={{ font: '400 11.5px/1.6 var(--font-body)', marginTop: 10 }}>
                    {t('เงาเทา = ค่าเฉลี่ยกลุ่ม · ขอบวง = 3 · กดหัวข้อบนกราฟแมงมุม (เช่น Instrument) เพื่อดูคะแนนหัวข้อนั้นรายคาบ')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        {/* กล่องยืนยันก่อนลงนาม — ชั้นสุดท้ายกันประเมินผิดคน โชว์ชื่อ+รหัส+วันที่+คะแนนตัวใหญ่ */}
        {/* แก้ป้ายตรงต่อเวลา — โชว์เวลาที่ระบบจับได้คู่กับเกณฑ์ ให้อาจารย์ตัดสินบนข้อเท็จจริง
            ไม่ใช่กดเปลี่ยนลอยๆ · เวลาที่ระบบจับได้เป็นข้อเท็จจริง ตรงนี้แก้แค่ "คำตัดสิน" */}
        {punctualRow && (
          <ConfirmBox onBackdrop={closePunctual}>
            <div className="confirmbox__q">{t('แก้ป้ายตรงต่อเวลาของ')}</div>
            <div className="confirmbox__who">{personName(punctualStudent, '')}</div>
            <div className="confirmbox__meta">
              <span className="mono">{punctualStudent?.code}</span> · {t('คาบ')} {thaiShort(punctualRow.date)}
              {punctualRow.checkinAt ? ` · ${t('เช็คอิน {time} น.', { time: punctualRow.checkinAt })}` : ''}
            </div>
            <p className="confirmbox__note" style={{ textAlign: 'left' }}>
              {t('ตอนนี้ระบบบันทึกว่า')} <b>{punctualRow.punctual ? t('ตรงเวลา') : t('มาสาย')}</b>
              {' — '}{t('เกณฑ์ที่ใช้: คาบเช้าเกิน 09:15 · คาบบ่ายเกิน 13:15 นับเป็นสาย')}
              <br />
              {t('เวลาที่ระบบจับได้ไม่ถูกแก้ — ที่แก้คือคำตัดสินว่านับเป็นสายไหม')}
            </p>
            <label className="field" style={{ marginTop: 4 }}>
              <span>{t('เหตุผล (ไม่บังคับ · ลงใน audit log)')}</span>
              <input
                className="input"
                value={punctualNote}
                onChange={(e) => setPunctualNote(e.target.value)}
                placeholder={t('เช่น มาทันแต่ลืมเช็คอิน')}
              />
            </label>
            <ConfirmActions onCancel={closePunctual} onConfirm={() => void savePunctual(punctualRow.id, !punctualRow.punctual)}>
              {punctualRow.punctual ? t('เปลี่ยนเป็น "มาสาย"') : t('เปลี่ยนเป็น "ตรงเวลา"')}
            </ConfirmActions>
          </ConfirmBox>
        )}

        {confirmRow && (
          <ConfirmBox onBackdrop={() => setConfirmId(null)}>
            <div className="confirmbox__q">{t('ยืนยันบันทึกคะแนนของ')}</div>
            <div className="confirmbox__who">{personName(confirmStudent, '')}</div>
            <div className="confirmbox__meta">
              <span className="mono">{confirmStudent?.code}</span> · {t('คาบ')} {thaiShort(confirmRow.date)}
              {confirmRow.checkinAt ? ` · ${t('{time} น.', { time: confirmRow.checkinAt })}` : ''}
            </div>
            <div className="confirmbox__score">
              {totalScore(draftFor(confirmRow.id)) ?? 0}<span>/{MAX_TOTAL}</span>
            </div>
            <p className="confirmbox__note">
              <WarningCircle size={14} weight="fill" style={{ verticalAlign: -2, marginRight: 4 }} />
              {t('ตรวจชื่อให้ตรงกับนักศึกษาที่อยู่ตรงหน้าก่อนกดยืนยัน')}
            </p>
            <ConfirmActions onCancel={() => setConfirmId(null)} onConfirm={() => sign(confirmRow.id)}>
              <Signature size={17} weight="bold" />
              {t('ยืนยัน · ลงนาม')}
            </ConfirmActions>
          </ConfirmBox>
        )}

        {/* กล่องแก้คะแนนที่ลงไปแล้ว — โชว์ค่าเดิมคู่ค่าใหม่ทุกหัวข้อ ไม่ให้แก้แบบไม่รู้ตัว */}
        {reviseRow && (
          <ConfirmBox onBackdrop={closeRevise} wide>
            <div className="confirmbox__q">{t('แก้คะแนนของ')}</div>
            <div className="confirmbox__who">{personName(reviseStudent, '')}</div>
            <div className="confirmbox__meta">
              <span className="mono">{reviseStudent?.code}</span> · {t('คาบ')} {thaiShort(reviseRow.date)}
              {reviseRow.evaluatedBy ? ` · ${t('ประเมินโดย {who}', { who: t(reviseRow.evaluatedBy) })}` : ''}
            </div>
            {supersededBy(reviseRow) && (
              <div className="confirmbox__meta" style={{ color: 'var(--warning-dark)' }}>
                <WarningCircle size={11} weight="fill" /> {supersededTitle(reviseRow)}
              </div>
            )}

            <div className="revisegrid">
              {CRITERIA.map((cr) => {
                const was = reviseBefore[cr.key] ?? 0;
                const now = reviseDraft[cr.key] ?? 0;
                return (
                  <div key={cr.key} className="scorerow" data-changed={was !== now}>
                    <span className="scorerow__label" title={t(cr.th)}>{cr.label}</span>
                    {was !== now && <span className="revisewas">{t('เดิม')} {was}</span>}
                    <ScoreButtons
                      critKey={cr.key}
                      label={cr.label}
                      value={now}
                      onPick={(n) => setReviseDraft({ ...reviseDraft, [cr.key]: n })}
                    />
                  </div>
                );
              })}
            </div>

            <div className="revisesum">
              {reviseDiffs.length === 0 ? (
                <span className="faint">{t('ยังไม่ได้แก้อะไร')}</span>
              ) : (
                <>
                  <b>{t('แก้ {n} หัวข้อ', { n: reviseDiffs.length })}</b>
                  <span className="mono">
                    {totalScore(reviseBefore) ?? 0} → {totalScore(reviseDraft) ?? 0}/{MAX_TOTAL}
                  </span>
                </>
              )}
            </div>

            <p className="confirmbox__note">
              <WarningCircle size={14} weight="fill" style={{ verticalAlign: -2, marginRight: 4 }} />
              {t('การแก้จะถูกบันทึกในประวัติพร้อมค่าเดิม ลบทิ้งไม่ได้ และชื่อผู้ประเมินจะเปลี่ยนเป็นคุณ')}
            </p>

            <ConfirmActions onCancel={closeRevise} onConfirm={saveRevise} disabled={reviseDiffs.length === 0}>
              <PencilSimple size={17} weight="bold" />
              {t('ยืนยันการแก้')}
            </ConfirmActions>
          </ConfirmBox>
        )}
      </main>
    </TeacherShell>
  );
}
