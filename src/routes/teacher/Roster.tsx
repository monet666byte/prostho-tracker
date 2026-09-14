/**
 * หน้าจัดการรายชื่อผู้มีสิทธิ์เข้าระบบ — เห็นเฉพาะหัวหน้าภาค
 *
 * ตาราง invites = "ใครมีสิทธิ์เข้าระบบ และเข้าในฐานะใคร" ภาคเป็นคนกำหนดล่วงหน้า
 * พอคนนั้นสมัครด้วยอีเมลที่อยู่ในรายชื่อ ระบบจะผูกกับ นศ./อาจารย์ ให้เอง
 *
 * เดิมต้องพิมพ์ SQL ทุกครั้งที่เพิ่มคน — หน้านี้ทำให้ภาคทำเองได้
 */
import { CheckCircle, Clock, Trash } from '@phosphor-icons/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { LinkRequestsPanel } from '../../components/teacher/LinkRequestsPanel';
import { AdvisorEditor } from '../../components/teacher/AdvisorGroups';
import { useAllStudents } from '../../hooks/data';
import { cloudEnabled, supabase } from '../../lib/cloud';
import { t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { importRoster, parseRoster } from '../../data/repo';
import { ImportSheetBody } from './ImportSheet';
import { entryYearFromDtmu, isAlumni, studentCohortLabel } from '../../domain/cohort';
import { groupShort } from '../../domain/group';
import type { Student } from '../../domain/types';
import { academicYear } from '../../lib/date';

interface Invite {
  email: string;
  role: 'student' | 'teacher';
  student_id: string | null;
  teacher_id: string | null;
  is_admin: boolean;
}

export default function Roster() {
  const { cloudUser, showToast } = useApp();
  const students = useAllStudents();
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], []) ?? [];
  /* หน้านี้อาจารย์ทุกคนเข้าได้ (ผู้ใช้ให้เปิด 1 ก.ย. — ทุกการกระทำมี audit log)
     แต่ "การให้สิทธิ์เข้าระบบ" ยังเป็นของหัวหน้ารายวิชาเท่านั้น เพราะมันคือการเปิดประตูให้คนใหม่
     เห็นข้อมูลนักศึกษาทั้งภาค — audit log ตามทีหลังไม่ช่วยถ้าข้อมูลรั่วไปแล้ว */
  const isAdmin = !!cloudUser?.isAdmin || !cloudEnabled;

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ฟอร์มเพิ่มคน
  const [email, setEmail] = useState('');
  // นำเข้ารายชื่อรุ่นใหม่
  const [tab, setTab] = useState<'people' | 'sheet'>('people');
  const [dtmu, setDtmu] = useState('');
  const [rosterText, setRosterText] = useState('');
  const [importing, setImporting] = useState(false);
  const parsed = useMemo(() => (rosterText.trim() ? parseRoster(rosterText) : null), [rosterText]);

  async function doImportRoster() {
    if (!parsed?.rows.length || !dtmu) return;
    setImporting(true);
    try {
      const res = await importRoster(parsed.rows, Number(dtmu), currentActor());
      setRosterText('');
      // รุ่นที่ยังไม่ถึงปีขึ้นคลินิกจะยังไม่โผล่ในตัวกรองปี 5/6 — บอกไว้กันเข้าใจว่านำเข้าไม่สำเร็จ
      const startsLater = res.cohort > academicYear(new Date());
      showToast({
        message: startsLater
          ? t('นำเข้าแล้ว {a} คน — จะเริ่มแสดงเป็นชั้นปี 5 ในปีการศึกษา {y}', { a: res.added + res.updated, y: res.cohort })
          : t('นำเข้าแล้ว — เพิ่ม {a} คน · อัปเดต {b} คน', { a: res.added, b: res.updated }),
        tone: 'success',
      });
    } finally {
      setImporting(false);
    }
  }
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [personId, setPersonId] = useState('');
  // ยืนยันก่อนลบ — เดิมกดถังขยะทีเดียวหายเลย ไอคอนเล็กๆ ในตารางกดพลาดง่ายมากบน iPad
  const [confirmDel, setConfirmDel] = useState<Invite | null>(null);

  async function load() {
    if (!supabase || !isAdmin) return;
    const [inv, app] = await Promise.all([
      supabase.from('invites').select('email, role, student_id, teacher_id, is_admin').order('email'),
      supabase.from('app_users').select('email'),
    ]);
    if (inv.error) { setError(inv.error.message); return; }
    setInvites(inv.data as Invite[]);
    setLinked(new Set(((app.data ?? []) as { email: string }[]).map((r) => r.email.toLowerCase())));
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAdmin]);

  /* อาจารย์: ซ่อนบัญชีเดโมที่ค้างอยู่ (id ขึ้นต้น tc-TH…) เมื่อมีอาจารย์จริงในระบบแล้ว
     (ผู้ใช้เจอ 2 ก.ย.: dropdown ยาวเป็นร้อยชื่อ "อ. ช." ซ้ำกัน)
     ⚠️ ห้ามกรองด้วย "มีนักศึกษาผูกอยู่ไหม" — อาจารย์ที่เพิ่งเพิ่ม (เช่น ที่ปรึกษาปี 6
     ที่ยังไม่ได้ผูกกลุ่ม) จะหายไปจากรายการทันที เลือกให้สิทธิ์เข้าระบบไม่ได้ */
  const activeTeachers = useMemo(() => {
    const isDemoSeeded = (id: string) => /^tc-TH\d*-/.test(id);
    const real = teachers.filter((tc) => !isDemoSeeded(tc.id));
    return real.length ? real : teachers;
  }, [teachers]);

  /**
   * ตัวเลือก "คือใคร" ต้องหาคนได้จริง
   *
   * เดิมยัดนักศึกษาทุกคนทุกรุ่นลง <select> เดียว = 481 บรรทัดในเดโม (96 คน × 5 รุ่น)
   * เรียงตามชื่อ จึงมี "นศ. ก" ซ้ำกัน 60 บรรทัดติดกันโดยแยกไม่ออกว่ารุ่นไหน
   * และ native select ไม่มีช่องค้นหา (เจอ 10 ก.ย. 69)
   *
   * สองอย่างที่แก้: ① ตัดรุ่นที่จบไปแล้วออก — คนจบแล้วไม่ต้องให้สิทธิ์เข้าระบบใหม่
   * ② จัดเป็น optgroup ตามรุ่น+กลุ่ม เบราว์เซอร์จะโชว์หัวข้อคั่นให้ กระโดดหาได้
   */
  const people = role === 'student' ? students.filter((st) => !isAlumni(st)) : activeTeachers;
  const peopleGroups = useMemo(() => {
    const buckets = new Map<string, typeof people>();
    for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name, 'th'))) {
      const key = 'group' in p && 'entryYear' in p
        ? `${studentCohortLabel(p as Student)} · ${groupShort((p as Student).group)}`
        : t('อาจารย์');
      buckets.set(key, [...(buckets.get(key) ?? []), p]);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'));
  }, [people]);

  async function addInvite() {
    if (!supabase || !email.trim() || !personId) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from('invites').upsert({
      email: email.trim().toLowerCase(),
      role,
      student_id: role === 'student' ? personId : null,
      teacher_id: role === 'teacher' ? personId : null,
    });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setEmail('');
    setPersonId('');
    showToast({ message: t('เพิ่มรายชื่อแล้ว — คนนี้สมัครเข้าระบบได้เลย'), tone: 'success' });
    void load();
  }

  async function removeInvite(inviteEmail: string) {
    if (!supabase) return;
    setConfirmDel(null);
    const { error: e } = await supabase.from('invites').delete().eq('email', inviteEmail);
    if (e) { setError(e.message); return; }
    showToast({ message: t('ลบรายชื่อแล้ว — คนใหม่จะสมัครด้วยอีเมลนี้ไม่ได้'), tone: 'warning' });
    void load();
  }

  const nameOf = (inv: Invite) =>
    inv.role === 'student'
      ? students.find((s) => s.id === inv.student_id)?.name ?? inv.student_id ?? '—'
      : teachers.find((tc) => tc.id === inv.teacher_id)?.name ?? inv.teacher_id ?? '—';

  if (!isAdmin) {
    return (
      <TeacherShell active="roster">
        <main className="main">
          <div className="main__head"><div style={{ flex: 1 }}><h1>{t('จัดการรายชื่อ')}</h1></div></div>
          <div className="dashed" style={{ padding: '28px 20px', textAlign: 'center', font: '500 12.5px var(--font-body)', color: 'var(--text-muted)' }}>
            {t('หน้านี้สำหรับหัวหน้ารายวิชาเท่านั้น')}
          </div>
        </main>
      </TeacherShell>
    );
  }

  return (
    <TeacherShell active="roster">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('รายชื่อ & นำเข้าข้อมูล')}</h1>
            <p>{t('งานตั้งต้นข้อมูลต้นปี — รับรายชื่อรุ่นใหม่ ให้สิทธิ์เข้าระบบ และย้ายงานเก่าจากชีต')}</p>
          </div>
        </div>

        {/* รวมสองงานที่เคยแยกเป็นคนละเมนู — ผู้ใช้ถามว่าทำไมต้องแยก (1 ก.ย.)
            ต่างกันแค่ "คน" กับ "งาน" แต่ทำพร้อมกันตอนต้นปี จึงอยู่หน้าเดียวกันแบบสลับแท็บ */}
        <div className="tabs tabs--line" role="tablist">
          <button role="tab" aria-selected={tab === 'people'} data-on={tab === 'people'} onClick={() => setTab('people')}>{t('รายชื่อนักศึกษา')}</button>
          <button role="tab" aria-selected={tab === 'sheet'} data-on={tab === 'sheet'} onClick={() => setTab('sheet')}>{t('งานเก่าจากชีต')}</button>
        </div>

        {tab === 'sheet' && <ImportSheetBody />}

        {tab === 'people' && <LinkRequestsPanel />}
        {tab === 'people' && isAdmin && <AdvisorEditor />}

        {tab === 'people' && error && (
          <div style={{ background: 'var(--danger-tint)', color: 'var(--danger-dark)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, font: '500 12px var(--font-body)' }}>
            {error}
          </div>
        )}

        {/* นำเข้ารายชื่อรุ่นใหม่จาก roster ที่ภาคส่งมา (ผู้ใช้ยืนยัน 1 ก.ย.: DTMU56 เป็นต้นไปมีรายชื่อให้) */}
        {tab === 'people' && (<>
        {/* ไอคอนหน้าหัวข้อ + คำอธิบายยาว → หัวข้อกับคำอธิบายบรรทัดเดียว · ช่องรุ่นกับช่องวางอยู่แถวเดียวกัน
            (ผู้ใช้เลือก mock 14 ก.ย. 69) */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panelhead">
            <h3>{t('นำเข้ารายชื่อรุ่นใหม่')}</h3>
            <span className="sub">{t('วางจาก Excel หรือ CSV — รหัส, ชื่อ, กลุ่ม')}</span>
          </div>

          <div className="rosterimport">
            <label className="field">
              <span>{t('รุ่น (DTMU)')}</span>
              <input
                className="input"
                type="number"
                value={dtmu}
                onChange={(e) => setDtmu(e.target.value)}
                placeholder="56"
              />
              {/* ยังไม่กรอกเลขรุ่น แล้วโชว์ "ในปีการศึกษา —" อ่านเหมือนระบบคำนวณไม่ได้
                  บอกตรงๆ ว่ายังต้องกรอกอะไรดีกว่า (เจอ 10 ก.ย. 69) */}
              <small className="rosterimport__hint" title={t('ชั้นปีจะเลื่อนเองทุกวันที่ 1 มิถุนายน')}>
                {dtmu
                  ? t('→ ขึ้นปี 5 ปีการศึกษา {y}', { y: entryYearFromDtmu(Number(dtmu)) })
                  : t('กรอกเลขรุ่นก่อน')}
              </small>
            </label>
            <label className="field">
              <span>{t('รายชื่อ')}</span>
              <textarea
                className="input"
                style={{ minHeight: 96, fontFamily: 'var(--font-mono)', fontSize: 12.5, resize: 'vertical' }}
                value={rosterText}
                onChange={(e) => setRosterText(e.target.value)}
                placeholder={'6604001, นศ. ก, PT1\n6604002, นศ. ข, PT1'}
              />
            </label>
          </div>

          {parsed && (
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: 0, font: '500 12px var(--font-body)', color: parsed.rows.length ? 'var(--success-dark)' : 'var(--text-muted)' }}>
                {t('อ่านได้ {n} คน', { n: parsed.rows.length })}
                {parsed.errors.length > 0 && ` · ${t('ข้ามไป {n} บรรทัด', { n: parsed.errors.length })}`}
              </p>
              {parsed.errors.slice(0, 5).map((e) => (
                <p key={e.line} style={{ margin: '4px 0 0', font: '400 11px var(--font-mono)', color: 'var(--warning-dark)' }}>
                  {t('บรรทัด')} {e.line}: {e.text} — {e.reason}
                </p>
              ))}
            </div>
          )}

          <button
            className="btn"
            style={{ marginTop: 12, height: 42, width: 'auto', padding: '0 18px' }}
            disabled={!parsed?.rows.length || !dtmu || importing}
            onClick={doImportRoster}
          >
            {importing ? t('กำลังนำเข้า…') : t('นำเข้ารายชื่อ')}
          </button>
        </div>

        {isAdmin && (<>
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panelhead">
            <h3>{t('เพิ่มคนเข้าระบบ')}</h3>
            <span className="sub">{t('ใส่อีเมลที่จะใช้สมัคร แล้วเลือกว่าเป็นใคร')}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
            <label className="field" style={{ flex: '1 1 240px' }}>
              <span>{t('อีเมล')}</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@student.mahidol.edu" />
            </label>
            <label className="field" style={{ flex: '0 0 150px' }}>
              <span>{t('เข้าในฐานะ')}</span>
              <select className="input" value={role} onChange={(e) => { setRole(e.target.value as 'student' | 'teacher'); setPersonId(''); }}>
                <option value="student">{t('นักศึกษา')}</option>
                <option value="teacher">{t('อาจารย์')}</option>
              </select>
            </label>
            <PersonPicker
              key={role}
              options={peopleGroups.flatMap(([label, list]) => list.map((p) => ({
                id: p.id,
                name: t(p.name),
                code: 'code' in p ? (p as { code: string }).code : '',
                group: label,
              })))}
              value={personId}
              onChange={setPersonId}
            />
            <button className="btn" style={{ width: 'auto', padding: '0 18px', height: 44 }} disabled={busy || !email.trim() || !personId} onClick={addInvite}>
              {t('+ เพิ่ม')}
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panelhead">
            <h3>{t('รายชื่อทั้งหมด')} · {invites?.length ?? 0}</h3>
            <span className="sub">{t('✓ เขียว = สมัครแล้วใช้งานได้ · นาฬิกา = เชิญไว้แต่ยังไม่ได้สมัคร')}</span>
          </div>
          <div className="tblwrap" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>{t('อีเมล')}</th>
                  <th style={{ width: 90 }}>{t('ฐานะ')}</th>
                  <th style={{ width: 160 }}>{t('คือใคร')}</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {invites === null && (
                  <tr><td colSpan={5} className="faint" style={{ padding: 16 }}>{t('กำลังโหลด…')}</td></tr>
                )}
                {invites?.length === 0 && (
                  <tr><td colSpan={5} className="faint" style={{ padding: 16 }}>{t('ยังไม่มีใครในรายชื่อ')}</td></tr>
                )}
                {invites?.map((inv) => {
                  const active = linked.has(inv.email.toLowerCase());
                  return (
                    <tr key={inv.email}>
                      <td title={active ? t('สมัครแล้ว') : t('ยังไม่ได้สมัคร')}>
                        {active
                          ? <CheckCircle size={17} weight="fill" color="var(--success)" />
                          : <Clock size={17} color="var(--text-disabled)" />}
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {inv.email}
                        {inv.is_admin && (
                          <span className="badge" style={{ background: 'var(--accent-tint)', color: 'var(--accent-hover)', marginLeft: 6 }}>
                            {t('หัวหน้ารายวิชา')}
                          </span>
                        )}
                      </td>
                      <td>{inv.role === 'student' ? t('นักศึกษา') : t('อาจารย์')}</td>
                      <td style={{ font: '500 12px var(--font-body)' }}>{t(nameOf(inv))}</td>
                      <td>
                        <button
                          className="delbtn"
                          title={t('ลบออกจากรายชื่อ')}
                          onClick={() => setConfirmDel(inv)}
                        >
                          <Trash size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* คำอธิบาย "ลบแล้วเกิดอะไร" ย้ายไปอยู่ในกล่องยืนยันตอนกดลบ (14 ก.ย. 69) */}
        </div>
        </>)}
        {!isAdmin && (
          <p className="sub" style={{ marginTop: 4 }}>
            {t('การให้สิทธิ์เข้าระบบเป็นของหัวหน้ารายวิชา — ส่วนการนำเข้าข้อมูลทำได้ทุกคน และถูกบันทึกใน audit log')}
          </p>
        )}
        </>)}

        {confirmDel && (
          <div className="confirmwrap" onClick={() => setConfirmDel(null)}>
            <div className="confirmbox" onClick={(e) => e.stopPropagation()}>
              <div className="confirmbox__q">{t('เอาออกจากรายชื่อผู้มีสิทธิ์เข้าระบบ')}</div>
              <div className="confirmbox__who" style={{ fontSize: 19, wordBreak: 'break-all' }}>{confirmDel.email}</div>
              <div className="confirmbox__meta">
                {confirmDel.role === 'student' ? t('นักศึกษา') : t('อาจารย์')} · {t(nameOf(confirmDel))}
              </div>
              <p className="confirmbox__note">
                {linked.has(confirmDel.email.toLowerCase())
                  ? t('คนนี้สมัครเข้าระบบไปแล้ว — การลบจากรายชื่อไม่ได้ปิดบัญชีเดิม ต้องไปปิดในหน้า Supabase อีกที')
                  : t('คนนี้ยังไม่ได้สมัคร — ลบแล้วจะสมัครด้วยอีเมลนี้ไม่ได้')}
              </p>
              <div className="confirmbox__actions">
                <button className="btn btn--sec" onClick={() => setConfirmDel(null)}>{t('ยกเลิก')}</button>
                <button className="btn" onClick={() => removeInvite(confirmDel.email)}>
                  <Trash size={16} weight="bold" />
                  {t('เอาออก')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </TeacherShell>
  );
}

/**
 * ช่อง "คือใคร" แบบพิมพ์ค้น (ผู้ใช้เลือก mock 14 ก.ย. 69)
 * เดิมเป็น <select> ที่มีหลายร้อยชื่อ ต้องเลื่อนหาเอง — native select ค้นไม่ได้
 * พิมพ์รหัสหรือชื่อ → รายการ 8 อันแรกที่ตรง · ลูกศรขึ้นลง + Enter เลือกได้
 */
function PersonPicker({ options, value, onChange }: {
  options: Array<{ id: string; name: string; code: string; group: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const listId = useId();
  const picked = options.find((o) => o.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const needle = q.trim().toLowerCase();
  const matches = (needle
    ? options.filter((o) => `${o.code} ${o.name} ${o.group}`.toLowerCase().includes(needle))
    : options).slice(0, 8);

  function pick(id: string) {
    onChange(id);
    setQ('');
    setOpen(false);
  }

  return (
    <label className="field personpick" style={{ flex: '1 1 220px' }}>
      <span>{t('คือใคร')}</span>
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? q : picked ? `${picked.name}${picked.code ? ` · ${picked.code}` : ''}` : q}
        placeholder={t('พิมพ์รหัสหรือชื่อ')}
        onFocus={() => { setOpen(true); setHi(0); }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); if (value) onChange(''); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && open && matches[hi]) { e.preventDefault(); pick(matches[hi].id); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <div className="personpick__list" id={listId} role="listbox">
          {matches.length === 0 && <div className="personpick__none">{t('ไม่พบชื่อหรือรหัสนี้')}</div>}
          {matches.map((o, i) => (
            <div
              key={o.id}
              role="option"
              aria-selected={i === hi}
              data-on={i === hi}
              className="personpick__opt"
              onMouseDown={(e) => { e.preventDefault(); pick(o.id); }}
              onMouseEnter={() => setHi(i)}
            >
              {o.code && <small>{o.code}</small>}
              <span>{o.name}</span>
              <em>{o.group}</em>
            </div>
          ))}
        </div>
      )}
    </label>
  );
}
