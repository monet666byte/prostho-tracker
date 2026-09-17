import { Check, CheckSquare, Square, UsersThree, WarningCircle } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { db } from '../../data/db';
import { useAllStudents, useGroups } from '../../hooks/data';
import { claimGroup, releaseGroup, setGroupAdvisors } from '../../lib/advisors';
import { cloudEnabled } from '../../lib/cloud';
import { academicYear } from '../../lib/date';
import { personName, t } from '../../lib/i18n';
import { CLINIC_LAST_YEAR, CLINIC_START_YEAR, isAlumni, studentCohortLabel, studentYear } from '../../domain/cohort';
import { currentAdvisorIds, groupShort, sortGroupCodes } from '../../domain/group';
import type { Teacher } from '../../domain/types';
import { useApp } from '../../store/app';

/**
 * อาจารย์ที่ปรึกษาของกลุ่ม (0024_group_advisors.sql)
 *
 * ภาคยืนยัน:
 *   · อาจารย์เลือกเอง แบ่งตามชั้นปี (ปี 5 / ปี 6) ติ๊ก PT ได้หลายกลุ่ม · หัวหน้าภาคแก้ได้
 *   · กลุ่มหนึ่งมีที่ปรึกษากี่ท่านก็ได้
 *   · ขึ้นปีการศึกษาใหม่ ล้างที่เลือกไว้ทั้งหมด ทุกคนเลือกใหม่ (วันที่ยังไม่เคาะ — ใช้ 1 มิ.ย. ไปก่อน)
 * ที่ปรึกษาอ่านผ่าน currentAdvisorIds() เสมอ (ของปีก่อน = ไม่มี)
 */

const EMPTY_TEACHERS: Teacher[] = [];
const DISMISS_KEY = 'advisorPromptDismissedYear';

export interface GroupRow {
  code: string;
  /** ชั้นปีของสมาชิกตอนนี้ — 5 / 6 · น้อยกว่า 5 = รุ่นที่รับรายชื่อไว้ล่วงหน้า */
  classYear: number;
  cohortLabel: string;
  advisors: string[];
  /** มีแถวใน groups แล้ว — false = ยังดึงลงมาไม่ถึง (ห้ามอ่านว่า "ไม่มีที่ปรึกษา") */
  known: boolean;
}

/** กลุ่มของรุ่นที่ยังเรียนอยู่ + รุ่นที่รับรายชื่อไว้ล่วงหน้า (ไม่รวมรุ่นที่จบแล้ว) */
export function useActiveGroupRows(): GroupRow[] {
  const students = useAllStudents();
  const groups = useGroups();
  return useMemo(() => {
    const byCode = new Map(groups.map((g) => [g.code, g]));
    const codes = sortGroupCodes([...new Set(students.filter((s) => !isAlumni(s)).map((s) => s.group))], students);
    return codes.map((code) => {
      const st = students.find((s) => s.group === code)!;
      const g = byCode.get(code);
      return {
        code,
        classYear: Math.min(studentYear(st), CLINIC_LAST_YEAR),
        cohortLabel: studentCohortLabel(st),
        advisors: currentAdvisorIds(g),
        known: !!g,
      };
    });
  }, [students, groups]);
}

const sectionTitle = (y: number) => (y < CLINIC_START_YEAR ? t('รุ่นที่ยังไม่ขึ้นคลินิก') : `${t('ปี')} ${y}`);

/** แบ่งกลุ่มตามชั้นปี (ปี 5 → ปี 6 → รุ่นถัดไป) — หัวข้อเดียวอาจมีสองรุ่นถ้ามีคนซ้ำชั้น จึงเก็บป้ายรุ่นไว้ด้วย */
function bySection(rows: GroupRow[]): Array<{ year: number; cohorts: string; rows: GroupRow[] }> {
  const years = [...new Set(rows.map((r) => r.classYear))].sort((a, b) => {
    const rank = (y: number) => (y < CLINIC_START_YEAR ? 99 : y);
    return rank(a) - rank(b);
  });
  return years.map((year) => {
    const list = rows.filter((r) => r.classYear === year);
    return { year, cohorts: [...new Set(list.map((r) => r.cohortLabel))].join(', '), rows: list };
  });
}

function readDismissedYear(): number | null {
  try { return Number(localStorage.getItem(DISMISS_KEY)) || null; } catch { return null; }
}

/**
 * ควรถามอาจารย์คนนี้ไหม: ปีการศึกษานี้ยังไม่ได้เลือกกลุ่มไหนเลย และยังไม่ได้ตอบว่า "ไม่ได้เป็นที่ปรึกษา"
 * ขึ้นปีใหม่ → ที่เลือกไว้ถูกล้าง + คำตอบ "ไม่ได้เป็น" ของปีก่อนหมดอายุ → ถามใหม่เอง
 */
export function useAdvisorPrompt(): boolean {
  const rows = useActiveGroupRows();
  const me = useApp((s) => s.session?.teacherId);
  const isTeacher = useApp((s) => !!s.cloudUser?.teacherId);
  return useMemo(() => {
    if (!cloudEnabled || !isTeacher || !me) return false;
    /* เครื่องใหม่: ตาราง students ลงมาก่อน groups → ทุกกลุ่มดูเหมือนไม่มีที่ปรึกษาชั่วครู่
       แล้วกล่องถามเด้งผิดๆ — รอจนรู้จักทุกกลุ่มก่อน */
    if (rows.length === 0 || rows.some((r) => !r.known)) return false;
    if (readDismissedYear() === academicYear(new Date())) return false;
    return !rows.some((r) => r.advisors.includes(me));
  }, [rows, me, isTeacher]);
}

/** กล่องเลือกกลุ่มที่ปรึกษา — ติ๊กแล้วบันทึกทันที · mode 'prompt' = ระบบถามเอง · 'manage' = อาจารย์กดเปิดเอง */
export function AdvisorGroupsDialog({ mode, onClose }: { mode: 'prompt' | 'manage'; onClose: () => void }) {
  const rows = useActiveGroupRows();
  const me = useApp((s) => s.session?.teacherId);
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const nameOf = (id: string) => personName(teachers.find((tc) => tc.id === id)) || id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const mineCount = rows.filter((r) => !!me && r.advisors.includes(me)).length;

  async function toggle(r: GroupRow) {
    if (guard.current || !me) return;
    guard.current = true;
    setBusy(r.code);
    setError(null);
    try {
      const res = r.advisors.includes(me) ? await releaseGroup(r.code) : await claimGroup(r.code);
      if (!res.ok) setError(res.error);
    } finally {
      guard.current = false;
      setBusy(null);
    }
  }

  function notAdvisor() {
    try { localStorage.setItem(DISMISS_KEY, String(academicYear(new Date()))); } catch { /* private mode */ }
    onClose();
  }

  return (
    <div className="confirmwrap" onClick={mode === 'manage' ? onClose : undefined}>
      <div className="confirmbox" role="dialog" aria-label={t('เลือกกลุ่มที่ปรึกษา')} style={{ maxWidth: 560, width: '100%', textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', font: '700 17px var(--font-head)' }}>
          <UsersThree size={20} weight="fill" style={{ color: 'var(--accent)' }} />
          {t('ปีการศึกษา {y} คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?', { y: academicYear(new Date()) })}
        </div>
        <p className="confirmbox__note" style={{ marginTop: 6 }}>
          {t('ติ๊กได้หลายกลุ่ม ทั้งปี 5 และปี 6 · บันทึกทันทีที่ติ๊ก · ขึ้นปีการศึกษาใหม่จะให้เลือกใหม่')}
        </p>

        {error && (
          <div role="alert" style={{ display: 'flex', gap: 8, marginTop: 10, borderRadius: 12, padding: '10px 12px', background: 'var(--danger-tint)', color: 'var(--danger-dark)', font: '500 12px var(--font-body)' }}>
            <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
            {error}
          </div>
        )}

        <div style={{ maxHeight: '56vh', overflowY: 'auto', marginTop: 12, display: 'grid', gap: 16 }}>
          {rows.length === 0 && (
            <p style={{ margin: 0, font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>{t('ยังไม่มีกลุ่มของรุ่นที่กำลังเรียน')}</p>
          )}
          {bySection(rows).map((sec) => (
            <section key={sec.year} aria-label={sectionTitle(sec.year)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
                <b style={{ font: '700 14px var(--font-head)' }}>{sectionTitle(sec.year)}</b>
                <span style={{ font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>{sec.cohorts}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
                {sec.rows.map((r) => {
                  const mine = !!me && r.advisors.includes(me);
                  const others = r.advisors.filter((id) => id !== me);
                  return (
                    <button
                      key={r.code}
                      role="checkbox"
                      aria-checked={mine}
                      aria-label={`${sectionTitle(sec.year)} ${groupShort(r.code)}`}
                      disabled={!!busy}
                      onClick={() => toggle(r)}
                      style={{
                        display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', padding: '8px 10px', borderRadius: 12,
                        border: `1px solid ${mine ? 'var(--accent)' : 'var(--border-2)'}`, background: mine ? 'var(--accent-tint)' : '#fff',
                        opacity: busy && busy !== r.code ? 0.6 : 1,
                      }}
                    >
                      {mine
                        ? <CheckSquare size={18} weight="fill" style={{ color: 'var(--accent)', flex: 'none', marginTop: 1 }} />
                        : <Square size={18} style={{ color: 'var(--text-faint)', flex: 'none', marginTop: 1 }} />}
                      <span style={{ minWidth: 0 }}>
                        <b style={{ display: 'block', font: '700 13px var(--font-head)' }}>{groupShort(r.code)}</b>
                        <span style={{ display: 'block', font: '400 10.5px/1.5 var(--font-body)', color: others.length ? 'var(--text-muted)' : 'var(--text-faint)' }}>
                          {busy === r.code ? t('กำลังบันทึก…') : others.length ? others.map(nameOf).join(' / ') : t('ยังไม่มีท่านอื่น')}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="confirmbox__actions">
          {mode === 'prompt' && mineCount === 0 ? (
            <button className="btn btn--sec" onClick={notAdvisor}>{t('ปีนี้ไม่ได้เป็นที่ปรึกษากลุ่มไหน')}</button>
          ) : (
            <button className="btn" onClick={onClose}>{t('เสร็จแล้ว')}{mineCount ? ` · ${t('{n} กลุ่ม', { n: mineCount })}` : ''}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** หัวหน้าภาค: ตั้งที่ปรึกษาทุกกลุ่ม (อยู่ในหน้ารายชื่อ) — กี่ท่านก็ได้ · เพิ่ม/เอาออกแล้วกดบันทึก */
export function AdvisorEditor() {
  const rows = useActiveGroupRows();
  const showToast = useApp((s) => s.showToast);
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const sorted = useMemo(() => [...teachers].sort((a, b) => a.name.localeCompare(b.name, 'th')), [teachers]);
  const nameOf = (id: string) => personName(teachers.find((tc) => tc.id === id)) || id;
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!cloudEnabled || rows.length === 0) return null;

  const valueOf = (r: GroupRow): string[] => draft[r.code] ?? r.advisors;
  const changed = (r: GroupRow) => valueOf(r).join('|') !== r.advisors.join('|');
  const edit = (r: GroupRow, next: string[]) => setDraft((d) => ({ ...d, [r.code]: next }));

  async function save(r: GroupRow) {
    const sent = valueOf(r);
    setBusy(r.code);
    setError(null);
    const res = await setGroupAdvisors(r.code, sent);
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    /* เซิร์ฟเวอร์รับแล้ว แต่รอบดึงข้อมูลอาจตกระหว่างทาง (เน็ตหลุด) — ถ้าในเครื่องยังไม่ใช่ชุดที่ส่งไป
       ห้ามขึ้น "บันทึกแล้ว" ทับชื่อเก่า (ป้ายหลอก) · เก็บร่างไว้และบอกตรงๆ */
    const nowLocal = currentAdvisorIds(await db.groups.get(r.code));
    if ([...nowLocal].sort().join('|') !== sent.filter(Boolean).sort().join('|')) {
      setError(t('บันทึกกลุ่ม {g} บนเซิร์ฟเวอร์แล้ว แต่เครื่องนี้ยังดึงข้อมูลกลับมาไม่ได้ — รีเฟรชหน้าเพื่อดูค่าจริง', { g: groupShort(r.code) }));
      return;
    }
    /* ล้างร่างเฉพาะเมื่อยังเป็นชุดที่ส่งไป — ถ้าระหว่างรอมีคนเพิ่ม/เอาออกอีก ต้องเก็บไว้ให้กดบันทึกรอบใหม่ */
    setDraft((d) => {
      if ((d[r.code] ?? []).join('|') !== sent.join('|')) return d;
      const n = { ...d }; delete n[r.code]; return n;
    });
    showToast({ message: t('บันทึกที่ปรึกษากลุ่ม {g} แล้ว', { g: groupShort(r.code) }), tone: 'success' });
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3><UsersThree size={16} style={{ verticalAlign: -3, marginRight: 6 }} />{t('อาจารย์ที่ปรึกษาแต่ละกลุ่ม · ปีการศึกษา {y}', { y: academicYear(new Date()) })}</h3>
      <p className="sub">{t('อาจารย์เลือกกลุ่มเองได้ตอนเข้าแอป · ตรงนี้ไว้ตรวจและแก้ให้ถูก · กลุ่มหนึ่งมีกี่ท่านก็ได้ · ขึ้นปีการศึกษาใหม่ล้างให้เลือกใหม่')}</p>
      {error && (
        <div role="alert" style={{ marginTop: 10, borderRadius: 12, padding: '10px 12px', background: 'var(--danger-tint)', color: 'var(--danger-dark)', font: '500 12px var(--font-body)' }}>{error}</div>
      )}
      {bySection(rows).map((sec) => (
        <div key={sec.year} style={{ marginTop: 14 }}>
          <div style={{ font: '700 13px var(--font-head)', marginBottom: 6 }}>
            {sectionTitle(sec.year)} <span style={{ font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>{sec.cohorts}</span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {sec.rows.map((r) => {
              const ids = valueOf(r);
              const addable = sorted.filter((tc) => !ids.includes(tc.id));
              return (
                <div key={r.code} data-group={r.code} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border-2)', paddingBottom: 8 }}>
                  <b style={{ font: '700 13px var(--font-head)', minWidth: 48 }}>{groupShort(r.code)}</b>
                  <span style={{ flex: '1 1 220px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {ids.length === 0 && <span style={{ font: '400 11.5px var(--font-body)', color: 'var(--warning-dark)' }}>{t('ยังไม่มีที่ปรึกษา')}</span>}
                    {ids.map((id) => (
                      <span key={id} className="chip" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', height: 28, padding: '0 6px 0 10px', background: 'var(--fill)', font: '500 12px var(--font-body)' }}>
                        {nameOf(id)}
                        <button aria-label={`${t('เอาออก')} ${nameOf(id)}`} disabled={busy === r.code} onClick={() => edit(r, ids.filter((x) => x !== id))}
                          style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 10, color: 'var(--text-muted)' }}>×</button>
                      </span>
                    ))}
                    {addable.length > 0 && (
                      <select className="input" style={{ width: 'auto', height: 30, fontSize: 12 }} value="" disabled={busy === r.code}
                        aria-label={`${sectionTitle(sec.year)} ${groupShort(r.code)} ${t('เพิ่มที่ปรึกษา')}`}
                        onChange={(e) => { if (e.target.value) edit(r, [...ids, e.target.value]); }}>
                        <option value="">{t('+ เพิ่มอาจารย์')}</option>
                        {addable.map((tc) => <option key={tc.id} value={tc.id}>{personName(tc)}</option>)}
                      </select>
                    )}
                  </span>
                  {/* ไม่มีอะไรแก้ = ข้อความ "บันทึกแล้ว" แทนปุ่มเทา — ปุ่มเทาดูเหมือนระบบค้าง */}
                  {changed(r) || busy === r.code ? (
                    <button className="btn" style={{ width: 'auto', height: 34, padding: '0 14px' }} disabled={busy === r.code} onClick={() => save(r)}>
                      {busy === r.code ? t('กำลังบันทึก…') : t('บันทึก')}
                    </button>
                  ) : r.advisors.length > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 34, font: '600 12px var(--font-body)', color: 'var(--success-dark)' }}>
                      <Check size={14} weight="bold" />{t('บันทึกแล้ว')}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
