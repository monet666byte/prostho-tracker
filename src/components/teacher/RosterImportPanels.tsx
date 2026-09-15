/**
 * หน้ารายชื่อ — สองทางหลักที่ผู้ใช้เลือก (15 ก.ย. 69: "อยากได้ workflow ที่ใช้ง่ายที่สุด")
 *   ① เลือกไฟล์ Excel จากภาค → อ่านแท็บนักศึกษา + อาจารย์พร้อมกัน → ดูสรุป → ยืนยันครั้งเดียว
 *   ② เพิ่มทีละคน (อาจารย์ใหม่กลางเทอม ฯลฯ) — ไม่ต้องพิมพ์หัวตาราง ไม่ต้องเขียน SQL
 *
 * ทั้งสองทางผ่านตัวอ่านเดียวกับช่องวางข้อความ (lib/rosterParse) และลงข้อมูลผ่าน data/rosterApply
 * = กติกาตรวจแถว / ข้ามแถวตัวอย่าง / ไม่ทับอีเมลที่เชิญไว้ ตรงกันทุกทาง
 */
import { FileXls, UserPlus } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';
import { academicYear } from '../../lib/date';
import { entryYearFromDtmu } from '../../domain/cohort';
import {
  looksLikeStudentRoster, looksLikeTeacherRoster, parseRoster, parseTeacherRoster,
} from '../../lib/rosterParse';
import type { RosterRow, TeacherRosterRow } from '../../lib/rosterParse';
import { readXlsx, tableToTsv } from '../../lib/xlsxRead';
import { applyStudents, applyTeachers, needsDtmu } from '../../data/rosterApply';
import type { InviteIndex, InviteOutcome, StudentApplyResult, TeacherApplyResult } from '../../data/rosterApply';
import { db } from '../../data/db';

type Issue = { sheet: string; line: number; text: string; reason: string };

/** ข้อความสรุปหลังนำเข้า — ใช้ร่วมกันทุกทาง */
export function importSummary(st: StudentApplyResult | null, tc: TeacherApplyResult | null): { message: string; warn: boolean } {
  const parts: string[] = [];
  if (st) {
    parts.push(st.latestCohort > academicYear(new Date())
      ? t('นักศึกษา {a} คน — จะเริ่มแสดงเป็นชั้นปี 5 ในปีการศึกษา {y}', { a: st.added + st.updated, y: st.latestCohort })
      : t('นักศึกษา: เพิ่ม {a} · อัปเดต {b}', { a: st.added, b: st.updated }));
  }
  if (tc) parts.push(t('อาจารย์: เพิ่ม {a} · อัปเดต {b}', { a: tc.added, b: tc.updated }));
  if (tc?.invitedAsStudent.length) {
    parts.push(t('ไม่ได้เพิ่มเป็นอาจารย์ {n} อีเมล เพราะเชิญไว้แล้วในฐานะนักศึกษา: {e}', { n: tc.invitedAsStudent.length, e: tc.invitedAsStudent.join(', ') }));
  }
  const inv: InviteOutcome[] = [st?.invites, tc?.invites].filter((x): x is InviteOutcome => !!x);
  const err = inv.find((x) => x.error)?.error;
  if (err) parts.push(t('ให้สิทธิ์ด้วยอีเมลไม่สำเร็จ: {e}', { e: err }));
  else if (inv.length) {
    const added = inv.reduce((n, x) => n + x.added, 0);
    const skipped = inv.reduce((n, x) => n + x.skipped, 0);
    parts.push(t('ให้สิทธิ์เข้าระบบ {n} อีเมล', { n: added })
      + (skipped ? ` · ${t('ข้าม {n} อีเมลที่อยู่ในรายชื่ออยู่แล้ว (สิทธิ์เดิมไม่เปลี่ยน)', { n: skipped })}` : ''));
  }
  return { message: parts.join(' · '), warn: !!err || !!tc?.invitedAsStudent.length };
}

interface Shared {
  /** รายชื่อเชิญที่มีอยู่ · null = ต่อเซิร์ฟเวอร์อยู่แต่ยังโหลดไม่เสร็จ (หรือโหลดไม่ได้ — ดู invitesError) */
  invited: InviteIndex | null;
  /** โหลดรายชื่อเชิญไม่ได้ — ต้องบอกและให้กดลองใหม่ ไม่ใช่ "รอสักครู่" ตลอดไป */
  invitesError: string | null;
  /** โหลดรายชื่อเชิญใหม่ (หลังนำเข้า / กดลองใหม่) */
  onDone: () => void;
}

/** ข้อความรอ/โหลดไม่ได้ของรายชื่อเชิญ พร้อมปุ่มลองใหม่ */
function InvitesWait({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <p className={error ? 'rosterfile__err' : 'rosterimport__hint'} style={{ marginTop: 8 }}>
      {error ? `${t('โหลดรายชื่อเชิญไม่ได้')} — ${error} ` : t('รอโหลดรายชื่อเชิญสักครู่…')}
      {error && <button className="linkbtn" onClick={onRetry}>{t('ลองใหม่')}</button>}
    </p>
  );
}

/* ══ ① เลือกไฟล์ Excel ══════════════════════════════════════════════════════ */

interface FilePreview {
  fileName: string;
  students: RosterRow[];
  teachers: TeacherRosterRow[];
  issues: Issue[];
  /** นักศึกษาที่รหัสมีในระบบแล้ว (นำเข้า = อัปเดต) */
  existing?: number;
  /** คนเดิมที่ชื่อ/กลุ่มจะเปลี่ยนตามไฟล์ */
  changed?: string[];
}

export function FileImportPanel({ invited, invitesError, onDone }: Shared) {
  const { showToast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [dtmu, setDtmu] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setReadError(null);
    setPreview(null);
    try {
      const sheets = /\.csv$/i.test(file.name)
        ? [{ name: file.name, text: await file.text() }]
        : (await readXlsx(await file.arrayBuffer())).map((s) => ({ name: s.name, text: tableToTsv(s.rows) }));
      const p: FilePreview = { fileName: file.name, students: [], teachers: [], issues: [] };
      let recognized = 0;
      for (const s of sheets) {
        if (looksLikeTeacherRoster(s.text)) {
          recognized++;
          const r = parseTeacherRoster(s.text);
          p.teachers.push(...r.rows);
          p.issues.push(...r.errors.map((e) => ({ sheet: s.name, ...e })));
        } else if (looksLikeStudentRoster(s.text)) {
          recognized++;
          const r = parseRoster(s.text);
          p.students.push(...r.rows);
          p.issues.push(...r.errors.map((e) => ({ sheet: s.name, ...e })));
        }
        /* แผ่นอื่น (เช่น คำอธิบาย) ไม่มีหัวตารางรายชื่อ = ข้ามเงียบๆ */
      }
      /* แถวตัวอย่างสีเทาในแบบฟอร์มเป็นของที่ต้องข้ามอยู่แล้ว — ไม่นับเป็น "ปัญหา" ให้คนอ่านตกใจ */
      p.issues = p.issues.filter((e) => !/แถวตัวอย่างในแบบฟอร์ม/.test(e.reason));
      /* รหัสซ้ำข้ามแผ่น (สองแผ่นนักศึกษาในไฟล์เดียว) — ตัวอ่านเช็คได้แค่ในแผ่นเดียวกัน */
      const seen = new Set<string>();
      p.students = p.students.filter((r) => {
        if (seen.has(r.code)) { p.issues.push({ sheet: '', line: 0, text: r.code, reason: 'รหัสซ้ำกับแผ่นอื่นในไฟล์ — ใช้แถวแรก' }); return false; }
        seen.add(r.code);
        return true;
      });
      /* อีเมลเดียวกันทั้งแท็บอาจารย์และแท็บนักศึกษา — รายชื่อเชิญเก็บได้บทบาทเดียว · อาจารย์ลงก่อน
         จึงตัดอีเมลออกจากแถวนักศึกษา (คนยังเข้ารายชื่อ แต่ต้องผูกบัญชีด้วยรหัสแทน) และบอกไว้ ไม่ปล่อยให้หายเงียบ */
      const teacherEmails = new Set(p.teachers.map((r) => r.email));
      p.students = p.students.map((r) => {
        if (!r.email || !teacherEmails.has(r.email)) return r;
        p.issues.push({ sheet: '', line: 0, text: `${r.code} ${r.email}`, reason: 'อีเมลนี้อยู่ในแท็บอาจารย์ด้วย — ไม่ใส่อีเมลให้นักศึกษาคนนี้' });
        const { email: _drop, ...rest } = r;
        return rest;
      });
      /* รหัสที่มีในระบบแล้ว = นำเข้าแล้วจะแก้ชื่อ/กลุ่มของคนเดิม — ต้องเห็นก่อนกดยืนยัน */
      const codes = new Set(p.students.map((r) => r.code));
      const existing = codes.size ? await db.students.where('code').anyOf([...codes]).toArray() : [];
      const byCode = new Map(p.students.map((r) => [r.code, r]));
      p.changed = existing
        .filter((st) => { const r = byCode.get(st.code)!; return st.name !== r.name || !st.group.endsWith(`-${r.group}`); })
        .map((st) => `${st.code} ${st.name} → ${byCode.get(st.code)!.name} · ${byCode.get(st.code)!.group}`);
      p.existing = existing.length;
      if (recognized && !p.students.length && !p.teachers.length && !p.issues.length) {
        setReadError(t('ไฟล์นี้ยังไม่มีรายชื่อ — มีแต่แถวตัวอย่าง ตรวจว่าเลือกไฟล์ที่ภาคกรอกแล้ว'));
        return;
      }
      if (!p.students.length && !p.teachers.length && !p.issues.length) {
        setReadError(t('ไม่พบตารางรายชื่อในไฟล์นี้ — ต้องมีหัวตารางแบบแบบฟอร์มขอรายชื่อ (รหัส · ชื่อ · กลุ่ม หรือ ชื่อ · อีเมล · บทบาท)'));
        return;
      }
      setPreview(p);
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const missingDtmu = !!preview && needsDtmu(preview.students);
  const waitingInvites = !!preview?.teachers.length && invited === null;
  const canImport = !!preview && (preview.students.length + preview.teachers.length > 0)
    && (!missingDtmu || !!Number(dtmu)) && !waitingInvites && !busy;

  async function confirm() {
    if (!preview || !canImport) return;
    setBusy(true);
    try {
      /* อาจารย์ก่อน — ถ้าเซิร์ฟเวอร์ปฏิเสธกลางทาง นักศึกษายังไม่ถูกแตะ ลองใหม่ได้ทั้งไฟล์ (นำเข้าซ้ำ = อัปเดต ไม่สร้างซ้ำ) */
      const tc = preview.teachers.length ? await applyTeachers(preview.teachers, invited ?? new Map(), currentActor()) : null;
      const st = preview.students.length ? await applyStudents(preview.students, Number(dtmu) || null, currentActor()) : null;
      const s = importSummary(st, tc);
      showToast({ message: t('นำเข้าแล้ว') + ' — ' + s.message, tone: s.warn ? 'warning' : 'success' });
      setPreview(null);
      setDtmu('');
      onDone();
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : String(e), tone: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  const cohorts = preview ? [...new Set(preview.students.map((r) => r.dtmu).filter(Boolean))].sort() : [];
  const admins = preview?.teachers.filter((r) => r.isAdmin).length ?? 0;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panelhead">
        <h3>{t('นำเข้ารายชื่อจากไฟล์ Excel')}</h3>
        <span className="sub">
          {t('ไฟล์แบบฟอร์มขอรายชื่อที่ภาคกรอกแล้ว — อ่านแท็บนักศึกษาและอาจารย์พร้อมกัน')}
          {' · '}
          <a href="prostho-roster-request-template.xlsx" download>{t('ดาวน์โหลดแบบฟอร์มเปล่า')}</a>
        </span>
      </div>

      <input
        ref={input}
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }}
      />
      {!preview && (
        <button className="btn" style={{ marginTop: 12, height: 44, width: 'auto', padding: '0 18px' }} onClick={() => input.current?.click()}>
          <FileXls size={19} weight="bold" />
          {t('เลือกไฟล์ Excel')}
        </button>
      )}
      {readError && <p className="rosterfile__err">{readError}</p>}

      {preview && (
        <div className="rosterfile">
          <p className="rosterfile__name">{preview.fileName}</p>
          <ul className="rosterfile__sum">
            <li data-on={preview.students.length > 0}>
              <b>{t('นักศึกษา {n} คน', { n: preview.students.length })}</b>
              {cohorts.length > 0 && <span>{cohorts.map((d) => `DTMU${d}`).join(' · ')}</span>}
              {preview.students.some((r) => r.email) && <span>{t('มีอีเมล {n} คน', { n: preview.students.filter((r) => r.email).length })}</span>}
            </li>
            <li data-on={preview.teachers.length > 0}>
              <b>{t('อาจารย์ {n} ท่าน', { n: preview.teachers.length })}</b>
              {admins > 0 && <span>{t('หัวหน้ารายวิชา {n} ท่าน', { n: admins })}</span>}
            </li>
          </ul>

          {preview.issues.length > 0 && (
            <div className="rosterfile__issues">
              <p>{t('ข้ามไป {n} บรรทัด — แก้ในไฟล์แล้วเลือกไฟล์ใหม่ได้', { n: preview.issues.length })}</p>
              {preview.issues.slice(0, 8).map((e, i) => (
                <p key={i} className="mono">
                  {e.sheet && `${e.sheet} · `}{e.line > 0 && `${t('บรรทัด')} ${e.line}: `}{e.text} — {e.reason}
                </p>
              ))}
              {preview.issues.length > 8 && <p>{t('และอีก {n} บรรทัด', { n: preview.issues.length - 8 })}</p>}
            </div>
          )}

          {!!preview.existing && (
            <div className="rosterfile__issues">
              <p>{t('มีในระบบแล้ว {n} คน — นำเข้าแล้วจะอัปเดตตามไฟล์', { n: preview.existing })}{preview.changed?.length ? ` · ${t('ชื่อหรือกลุ่มจะเปลี่ยน {n} คน', { n: preview.changed.length })}` : ''}</p>
              {preview.changed?.slice(0, 5).map((c) => <p key={c} className="mono">{c}</p>)}
            </div>
          )}

          {missingDtmu && (
            <label className="field" style={{ maxWidth: 220, marginTop: 10 }}>
              <span>{t('บางแถวไม่มีรุ่น — กรอกเลขรุ่น (DTMU)')}</span>
              <input className="input" type="number" value={dtmu} onChange={(e) => setDtmu(e.target.value)} placeholder="56" />
              {Number(dtmu) > 0 && <small className="rosterimport__hint">{t('→ ขึ้นปี 5 ปีการศึกษา {y}', { y: entryYearFromDtmu(Number(dtmu)) })}</small>}
            </label>
          )}
          {waitingInvites && <InvitesWait error={invitesError} onRetry={onDone} />}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn" style={{ height: 44, width: 'auto', padding: '0 18px' }} disabled={!canImport} onClick={confirm}>
              {busy ? t('กำลังนำเข้า…') : t('ยืนยันนำเข้า')}
            </button>
            <button className="btn btn--sec" style={{ height: 44, width: 'auto', padding: '0 18px' }} disabled={busy} onClick={() => { setPreview(null); setDtmu(''); }}>
              {t('ยกเลิก')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══ ② เพิ่มทีละคน ══════════════════════════════════════════════════════════ */

const GROUPS = Array.from({ length: 12 }, (_, i) => `PT${i + 1}`);
const clean = (s: string) => s.replace(/[\t\r\n,]+/g, ' ').trim();

export function AddPersonPanel({ invited, invitesError, onDone, onLinkExisting }: Shared & { onLinkExisting: () => void }) {
  const { showToast } = useApp();
  const [kind, setKind] = useState<'teacher' | 'student'>('teacher');
  const [f, setF] = useState({ email: '', name: '', nameEn: '', role: 'อาจารย์', code: '', dtmu: '', group: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setProblem(null); };

  async function add() {
    setProblem(null);
    /* ประกอบเป็นตารางหนึ่งแถวแล้วส่งเข้าตัวอ่านเดียวกับไฟล์ — กติกาตรวจ (อีเมล · กลุ่มที่มีจริง · ความยาวชื่อ) ตรงกันทุกทาง */
    let st: StudentApplyResult | null = null;
    let tc: TeacherApplyResult | null = null;
    setBusy(true);
    try {
      if (kind === 'teacher') {
        if (invited === null) { setProblem(invitesError ? `${t('โหลดรายชื่อเชิญไม่ได้')} — ${invitesError}` : t('รอโหลดรายชื่อเชิญสักครู่ แล้วกดใหม่')); return; }
        const r = parseTeacherRoster(`ชื่อ\tชื่ออังกฤษ\tอีเมล\tบทบาท\n${[f.name, f.nameEn, f.email, f.role].map(clean).join('\t')}`);
        if (!r.rows.length) { setProblem(r.errors[0]?.reason ?? t('กรอกข้อมูลให้ครบ')); return; }
        /* คนใหม่เท่านั้น — อีเมลที่เชิญไว้แล้วจะไปแก้ชื่อคนเดิมโดยสิทธิ์ไม่เปลี่ยน ซึ่งไม่ใช่สิ่งที่คนกรอกฟอร์มนี้ตั้งใจ */
        if (invited.has(r.rows[0].email)) { setProblem(t('อีเมลนี้อยู่ในรายชื่อแล้ว — ดูในตาราง "รายชื่อทั้งหมด" ด้านล่าง')); return; }
        tc = await applyTeachers(r.rows, invited, currentActor());
      } else {
        const r = parseRoster(`รหัส\tชื่อ\tชื่ออังกฤษ\tอีเมล\tรุ่น\tกลุ่ม\n${[f.code, f.name, f.nameEn, f.email, f.dtmu, f.group].map(clean).join('\t')}`);
        if (!r.rows.length) { setProblem(r.errors[0]?.reason ?? t('กรอกข้อมูลให้ครบ')); return; }
        if (needsDtmu(r.rows)) { setProblem(t('กรอกเลขรุ่น (DTMU)')); return; }
        /* ฟอร์มนี้มีไว้เพิ่ม "คนใหม่" — รหัสที่มีแล้วจะกลายเป็นแก้ชื่อ/ย้ายกลุ่มของคนเดิม (พิมพ์รหัสผิดตัวเดียวก็ทับเพื่อน)
           เช็คเร็วในเครื่องก่อน แล้ว applyStudents เช็คซ้ำหลังดึงข้อมูลล่าสุด */
        const dup = await db.students.where('code').equals(r.rows[0].code).first();
        if (dup) { setProblem(t('รหัส {c} มีในระบบแล้ว ({n}) — แก้คนเดิมให้นำเข้าจากไฟล์ หรือตรวจรหัสอีกครั้ง', { c: dup.code, n: dup.name })); return; }
        st = await applyStudents(r.rows, null, currentActor(), { onlyNew: true });
      }
      const s = importSummary(st, tc);
      showToast({ message: t('เพิ่มแล้ว') + ' — ' + s.message, tone: s.warn ? 'warning' : 'success' });
      setF({ email: '', name: '', nameEn: '', role: 'อาจารย์', code: '', dtmu: kind === 'student' ? f.dtmu : '', group: kind === 'student' ? f.group : '' });
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = kind === 'teacher'
    ? !!(f.email.trim() && f.name.trim())
    : !!(f.code.trim() && f.name.trim() && f.dtmu.trim() && f.group);

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panelhead">
        <h3>{t('เพิ่มทีละคน')}</h3>
        <span className="sub">{t('คนใหม่ที่ไม่อยู่ในไฟล์ เช่น อาจารย์ที่มาเพิ่มกลางเทอม — เพิ่มแล้วเข้าระบบด้วยอีเมลนั้นได้ทันที')}</span>
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: 12, marginBottom: 4 }}>
        <button role="tab" aria-selected={kind === 'teacher'} data-on={kind === 'teacher'} onClick={() => { setKind('teacher'); setProblem(null); }}>{t('อาจารย์')}</button>
        <button role="tab" aria-selected={kind === 'student'} data-on={kind === 'student'} onClick={() => { setKind('student'); setProblem(null); }}>{t('นักศึกษา')}</button>
      </div>

      <div className="addperson">
        {kind === 'student' && (
          <label className="field addperson__code">
            <span>{t('รหัสนักศึกษา')} *</span>
            <input className="input" inputMode="numeric" maxLength={7} value={f.code} onChange={set('code')} placeholder="6604001" />
          </label>
        )}
        <label className="field addperson__name">
          <span>{t('ชื่อ-นามสกุล (ไทย)')} *</span>
          <input className="input" value={f.name} onChange={set('name')} placeholder={kind === 'teacher' ? 'อ.ทพ. สมศักดิ์ ใจดี' : 'สมชาย ดีมาก'} />
        </label>
        <label className="field addperson__name">
          <span>{t('ชื่อ-นามสกุล (อังกฤษ)')}</span>
          <input className="input" value={f.nameEn} onChange={set('nameEn')} placeholder={kind === 'teacher' ? 'Somsak Jaidee' : 'Somchai Deemak'} />
        </label>
        <label className="field addperson__email">
          <span>{t('อีเมล')}{kind === 'teacher' ? ' *' : ''}</span>
          <input className="input" type="email" value={f.email} onChange={set('email')} placeholder={kind === 'teacher' ? 'name@mahidol.edu' : 'name@student.mahidol.edu'} />
        </label>
        {kind === 'teacher' ? (
          <label className="field addperson__small">
            <span>{t('บทบาท')}</span>
            <select className="input" value={f.role} onChange={set('role')}>
              <option value="อาจารย์">{t('อาจารย์')}</option>
              <option value="หัวหน้ารายวิชา">{t('หัวหน้ารายวิชา')}</option>
            </select>
          </label>
        ) : (<>
          <label className="field addperson__small">
            <span>{t('รุ่น (DTMU)')} *</span>
            <input className="input" type="number" value={f.dtmu} onChange={set('dtmu')} placeholder="56" />
          </label>
          <label className="field addperson__small">
            <span>{t('กลุ่ม')} *</span>
            <select className="input" value={f.group} onChange={set('group')}>
              <option value="">—</option>
              {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </>)}
      </div>

      {kind === 'teacher' && f.role === 'หัวหน้ารายวิชา' && (
        <p className="rosterimport__hint" style={{ marginTop: 8 }}>{t('หัวหน้ารายวิชาเพิ่มคนเข้าระบบ สำรองข้อมูล และเห็นบันทึกการใช้งานทั้งระบบได้')}</p>
      )}
      {kind === 'student' && !f.email.trim() && (
        <p className="rosterimport__hint" style={{ marginTop: 8 }}>{t('ไม่ใส่อีเมล = นักศึกษาผูกบัญชีเองด้วยรหัส แล้วรออาจารย์ที่ปรึกษายืนยัน')}</p>
      )}
      {problem && <p className="rosterfile__err">{problem}</p>}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn" style={{ height: 44, width: 'auto', padding: '0 18px' }} disabled={!ready || busy} onClick={add}>
          <UserPlus size={18} weight="bold" />
          {busy ? t('กำลังเพิ่ม…') : t('เพิ่ม')}
        </button>
        <button className="linkbtn" onClick={onLinkExisting}>{t('มีชื่อในระบบแล้ว แค่จะผูกอีเมลเพิ่ม')}</button>
      </div>
    </div>
  );
}
