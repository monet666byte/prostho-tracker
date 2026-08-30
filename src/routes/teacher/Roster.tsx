/**
 * หน้าจัดการรายชื่อผู้มีสิทธิ์เข้าระบบ — เห็นเฉพาะหัวหน้าภาค
 *
 * ตาราง invites = "ใครมีสิทธิ์เข้าระบบ และเข้าในฐานะใคร" ภาคเป็นคนกำหนดล่วงหน้า
 * พอคนนั้นสมัครด้วยอีเมลที่อยู่ในรายชื่อ ระบบจะผูกกับ นศ./อาจารย์ ให้เอง
 *
 * เดิมต้องพิมพ์ SQL ทุกครั้งที่เพิ่มคน — หน้านี้ทำให้ภาคทำเองได้
 */
import { CheckCircle, Clock, Plus, Trash, UserPlus, Users } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { useAllStudents } from '../../hooks/data';
import { supabase } from '../../lib/cloud';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';

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
  const isAdmin = !!cloudUser?.isAdmin;

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ฟอร์มเพิ่มคน
  const [email, setEmail] = useState('');
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

  const people = role === 'student' ? students : teachers;
  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => a.name.localeCompare(b.name, 'th')),
    [people],
  );

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
            {t('หน้านี้สำหรับหัวหน้าภาคเท่านั้น')}
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
            <h1>{t('จัดการรายชื่อ')}</h1>
            <p>{t('ใครมีสิทธิ์เข้าระบบ และเข้าในฐานะใคร — คนที่ไม่อยู่ในรายชื่อนี้ สมัครแล้วก็ใช้งานไม่ได้')}</p>
          </div>
        </div>

        {error && (
          <div style={{ background: 'var(--danger-tint)', color: 'var(--danger-dark)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, font: '500 12px var(--font-body)' }}>
            {error}
          </div>
        )}

        <div className="panel" style={{ marginBottom: 16 }}>
          <h3><UserPlus size={16} style={{ verticalAlign: -3, marginRight: 6 }} />{t('เพิ่มคนเข้าระบบ')}</h3>
          <p className="sub">{t('พิมพ์อีเมลที่เขาจะใช้สมัคร แล้วเลือกว่าเขาคือใครในระบบ')}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
            <label className="field" style={{ flex: '1 1 240px' }}>
              <span>{t('อีเมล')}</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@student.mahidol.ac.th" />
            </label>
            <label className="field" style={{ flex: '0 0 150px' }}>
              <span>{t('เข้าในฐานะ')}</span>
              <select className="input" value={role} onChange={(e) => { setRole(e.target.value as 'student' | 'teacher'); setPersonId(''); }}>
                <option value="student">{t('นักศึกษา')}</option>
                <option value="teacher">{t('อาจารย์')}</option>
              </select>
            </label>
            <label className="field" style={{ flex: '1 1 220px' }}>
              <span>{t('คือใคร')}</span>
              <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">{t('— เลือก —')}</option>
                {sortedPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{'code' in p ? ` · ${(p as { code: string }).code}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" style={{ width: 'auto', padding: '0 18px', height: 44 }} disabled={busy || !email.trim() || !personId} onClick={addInvite}>
              <Plus size={17} weight="bold" />
              {t('เพิ่มรายชื่อ')}
            </button>
          </div>
        </div>

        <div className="panel">
          <h3><Users size={16} style={{ verticalAlign: -3, marginRight: 6 }} />{t('รายชื่อทั้งหมด')} · {invites?.length ?? 0}</h3>
          <p className="sub">{t('✓ เขียว = สมัครแล้วใช้งานได้ · นาฬิกา = เชิญไว้แต่ยังไม่ได้สมัคร')}</p>
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
                            {t('หัวหน้าภาค')}
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
          <p style={{ margin: '12px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
            {t('ลบรายชื่อ = คนใหม่สมัครด้วยอีเมลนี้ไม่ได้ · คนที่สมัครไปแล้วต้องปิดบัญชีในหน้า Supabase อีกที')}
          </p>
        </div>

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
