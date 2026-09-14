import { Check, UsersThree, WarningCircle } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { db } from '../../data/db';
import { useAllStudents, useGroups } from '../../hooks/data';
import { claimGroup, releaseGroup, setGroupAdvisors } from '../../lib/advisors';
import { cloudEnabled } from '../../lib/cloud';
import { t } from '../../lib/i18n';
import { CLINIC_LAST_YEAR, CLINIC_START_YEAR, cohortOf, isAlumni, studentCohortLabel, studentYear } from '../../domain/cohort';
import { groupShort, sortGroupCodes } from '../../domain/group';
import type { Teacher } from '../../domain/types';
import { useApp } from '../../store/app';

/**
 * อาจารย์ที่ปรึกษาของกลุ่ม (0024_group_advisors.sql) — ผู้ใช้เคาะ 14 ก.ย. 69: อาจารย์เลือกเอง + หัวหน้าภาคแก้ได้
 *
 * ถามอาจารย์เองเมื่อมีรุ่นที่ยังมีกลุ่มไม่มีที่ปรึกษา และอาจารย์คนนี้ยังไม่ได้ดูแลกลุ่มไหนในรุ่นนั้น
 * ตอบ "ไม่ได้เป็นที่ปรึกษา" แล้วไม่ถามรุ่นนั้นอีก (จำในเครื่อง) — รุ่นใหม่มาเมื่อไหร่ถามใหม่
 * ที่ปรึกษาอ่านจาก groups.advisorIds (ตัวที่กฎบนเซิร์ฟเวอร์ใช้) ไม่ใช่ของนักศึกษา
 */

const EMPTY_TEACHERS: Teacher[] = [];
const DISMISS_KEY = 'advisorPromptDismissed';

export interface GroupRow {
  code: string;
  cohort: number;
  label: string;
  advisors: string[];
  /** มีแถวใน groups แล้ว — false = ยังดึงลงมาไม่ถึง (ห้ามอ่านว่า "ไม่มีที่ปรึกษา") */
  known: boolean;
}

/** กลุ่มที่ยังเรียนอยู่หรือรุ่นที่รับรายชื่อไว้ล่วงหน้า (ไม่รวมรุ่นที่จบแล้ว) พร้อมที่ปรึกษาปัจจุบัน */
export function useActiveGroupRows(): GroupRow[] {
  const students = useAllStudents();
  const groups = useGroups();
  return useMemo(() => {
    const advisorsOf = new Map(groups.map((g) => [g.code, (g.advisorIds ?? []).filter(Boolean)]));
    const codes = sortGroupCodes([...new Set(students.filter((s) => !isAlumni(s)).map((s) => s.group))], students);
    return codes.map((code) => {
      const st = students.find((s) => s.group === code)!;
      const y = studentYear(st);
      const label = y < CLINIC_START_YEAR
        ? `${studentCohortLabel(st)} · ${t('ยังไม่เริ่ม')}`
        : `${studentCohortLabel(st)} · ${t('ปี')} ${Math.min(y, CLINIC_LAST_YEAR)}`;
      return { code, cohort: cohortOf(st), label, advisors: advisorsOf.get(code) ?? [], known: advisorsOf.has(code) };
    });
  }, [students, groups]);
}

function readDismissed(): number[] {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as number[]; } catch { return []; }
}

/** รุ่นที่ควรถามอาจารย์คนนี้ · ว่าง = ไม่ต้องถาม */
export function useAdvisorPromptCohorts(): number[] {
  const rows = useActiveGroupRows();
  const me = useApp((s) => s.session?.teacherId);
  const isTeacher = useApp((s) => !!s.cloudUser?.teacherId);
  return useMemo(() => {
    if (!cloudEnabled || !isTeacher || !me) return [];
    /* เครื่องใหม่: ตาราง students ลงมาก่อน groups → ทุกกลุ่มดูเหมือนไม่มีที่ปรึกษาชั่วครู่
       แล้วกล่องถามเด้งผิดๆ (เจอใน test:google-login 14 ก.ย. 69) — รอจนรู้จักทุกกลุ่มก่อน */
    if (rows.length === 0 || rows.some((r) => !r.known)) return [];
    const dismissed = readDismissed();
    const cohorts = [...new Set(rows.map((r) => r.cohort))];
    return cohorts.filter((c) => {
      const inCohort = rows.filter((r) => r.cohort === c);
      return !dismissed.includes(c)
        && inCohort.some((r) => r.advisors.length === 0)
        && !inCohort.some((r) => r.advisors.includes(me));
    });
  }, [rows, me, isTeacher]);
}

/** กล่องเลือกกลุ่มที่ปรึกษา — mode 'prompt' = ระบบถามเอง · 'manage' = อาจารย์กดเปิดเอง */
export function AdvisorGroupsDialog({ mode, cohorts, onClose }: { mode: 'prompt' | 'manage'; cohorts?: number[]; onClose: () => void }) {
  const rows = useActiveGroupRows();
  const me = useApp((s) => s.session?.teacherId);
  const showToast = useApp((s) => s.showToast);
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const nameOf = (id: string) => teachers.find((tc) => tc.id === id)?.name ?? id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);

  const shown = mode === 'prompt' && cohorts?.length ? rows.filter((r) => cohorts.includes(r.cohort)) : rows;
  const byLabel = new Map<string, GroupRow[]>();
  shown.forEach((r) => byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r]));

  async function act(code: string, kind: 'claim' | 'release') {
    if (guard.current) return;
    guard.current = true;
    setBusy(code);
    setError(null);
    try {
      const r = kind === 'claim' ? await claimGroup(code) : await releaseGroup(code);
      if (!r.ok) { setError(r.error); return; }
      showToast({
        message: kind === 'claim'
          ? t('บันทึกแล้ว — กลุ่ม {g} เป็นกลุ่มที่ปรึกษาของคุณ', { g: groupShort(code) })
          : t('ถอนตัวจากกลุ่ม {g} แล้ว', { g: groupShort(code) }),
        tone: 'success',
      });
      if (kind === 'claim' && mode === 'prompt') onClose();
    } finally {
      guard.current = false;
      setBusy(null);
    }
  }

  function notAdvisor() {
    if (cohorts?.length) {
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...new Set([...readDismissed(), ...cohorts])])); } catch { /* private mode */ }
    }
    onClose();
  }

  return (
    <div className="confirmwrap" onClick={mode === 'manage' ? onClose : undefined}>
      <div className="confirmbox" style={{ maxWidth: 520, width: '100%', textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', font: '700 17px var(--font-head)' }}>
          <UsersThree size={20} weight="duotone" style={{ color: 'var(--accent)' }} />
          {mode === 'prompt' ? t('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?') : t('กลุ่มที่ปรึกษาของฉัน')}
        </div>
        <p className="confirmbox__note" style={{ marginTop: 6 }}>
          {mode === 'prompt'
            ? t('มีกลุ่มที่ยังไม่มีอาจารย์ที่ปรึกษา — เลือกครั้งเดียว แอปจะเปิดกลุ่มนั้นเป็นกลุ่มของคุณ และให้คุณยืนยันบัญชีนักศึกษาในกลุ่มได้')
            : t('เลือกหรือถอนตัวได้เอง · กลุ่มหนึ่งมีได้ 2 ท่าน · ถ้าเต็มแล้วแต่ไม่ถูกต้อง ติดต่อหัวหน้าภาค')}
        </p>

        {error && (
          <div role="alert" style={{ display: 'flex', gap: 8, marginTop: 10, borderRadius: 12, padding: '10px 12px', background: 'var(--danger-tint)', color: 'var(--danger-dark)', font: '500 12px var(--font-body)' }}>
            <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
            {error}
          </div>
        )}

        <div style={{ maxHeight: '52vh', overflowY: 'auto', marginTop: 12, display: 'grid', gap: 14 }}>
          {shown.length === 0 && (
            <p style={{ margin: 0, font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>{t('ยังไม่มีกลุ่มของรุ่นที่กำลังเรียน')}</p>
          )}
          {[...byLabel.entries()].map(([label, list]) => (
            <div key={label}>
              <div style={{ font: '600 11px var(--font-body)', color: 'var(--text-faint)', marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {list.map((r) => {
                  const mine = !!me && r.advisors.includes(me);
                  const full = r.advisors.length >= 2;
                  return (
                    <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${mine ? 'var(--accent)' : 'var(--border-2)'}`, background: mine ? 'var(--accent-tint)' : undefined, borderRadius: 12, padding: '8px 10px' }}>
                      <b style={{ font: '700 14px var(--font-head)', minWidth: 46 }}>{groupShort(r.code)}</b>
                      <span style={{ flex: 1, minWidth: 0, font: '400 11.5px var(--font-body)', color: r.advisors.length ? 'var(--text-body)' : 'var(--warning-dark)' }}>
                        {r.advisors.length ? r.advisors.map(nameOf).join(' / ') : t('ยังไม่มีที่ปรึกษา')}
                      </span>
                      {mine ? (
                        <button className="btn btn--sec" style={{ width: 'auto', height: 34, padding: '0 12px' }} disabled={!!busy} onClick={() => act(r.code, 'release')}>
                          {t('ถอนตัว')}
                        </button>
                      ) : (
                        <button className="btn" style={{ width: 'auto', height: 34, padding: '0 12px' }} disabled={!!busy || full} onClick={() => act(r.code, 'claim')}
                          title={full ? t('กลุ่มนี้มีอาจารย์ที่ปรึกษาครบ 2 ท่านแล้ว') : undefined}>
                          <Check size={14} weight="bold" />
                          {full ? t('ครบแล้ว') : t('ฉันดูแลกลุ่มนี้')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="confirmbox__actions">
          {mode === 'prompt' ? (
            <button className="btn btn--sec" onClick={notAdvisor}>{t('ไม่ได้เป็นที่ปรึกษากลุ่มในรุ่นนี้')}</button>
          ) : (
            <button className="btn btn--sec" onClick={onClose}>{t('ปิด')}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** หัวหน้าภาค: ตั้งที่ปรึกษาทุกกลุ่ม (อยู่ในหน้ารายชื่อ) */
export function AdvisorEditor() {
  const rows = useActiveGroupRows();
  const showToast = useApp((s) => s.showToast);
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const sorted = useMemo(() => [...teachers].sort((a, b) => a.name.localeCompare(b.name, 'th')), [teachers]);
  const [draft, setDraft] = useState<Record<string, [string, string]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!cloudEnabled || rows.length === 0) return null;

  const valueOf = (r: GroupRow): [string, string] => draft[r.code] ?? [r.advisors[0] ?? '', r.advisors[1] ?? ''];
  const changed = (r: GroupRow) => {
    const [a, b] = valueOf(r);
    return a !== (r.advisors[0] ?? '') || b !== (r.advisors[1] ?? '');
  };

  async function save(r: GroupRow) {
    setBusy(r.code);
    setError(null);
    const res = await setGroupAdvisors(r.code, valueOf(r));
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setDraft((d) => { const n = { ...d }; delete n[r.code]; return n; });
    showToast({ message: t('บันทึกที่ปรึกษากลุ่ม {g} แล้ว', { g: groupShort(r.code) }), tone: 'success' });
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3><UsersThree size={16} style={{ verticalAlign: -3, marginRight: 6 }} />{t('อาจารย์ที่ปรึกษาแต่ละกลุ่ม')}</h3>
      <p className="sub">{t('อาจารย์เลือกกลุ่มเองได้ตอนเข้าแอป · ตรงนี้ไว้ตรวจและแก้ให้ถูก · กลุ่มหนึ่งมีได้ 2 ท่าน')}</p>
      {error && (
        <div role="alert" style={{ marginTop: 10, borderRadius: 12, padding: '10px 12px', background: 'var(--danger-tint)', color: 'var(--danger-dark)', font: '500 12px var(--font-body)' }}>{error}</div>
      )}
      <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
        {rows.map((r) => {
          const [a, b] = valueOf(r);
          const pick = (slot: 0 | 1, v: string) => setDraft((d) => ({ ...d, [r.code]: slot === 0 ? [v, valueOf(r)[1]] : [valueOf(r)[0], v] }));
          return (
            <div key={r.code} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ minWidth: 150, font: '500 12px var(--font-body)' }}>
                <b style={{ font: '700 13px var(--font-head)' }}>{groupShort(r.code)}</b> <span style={{ color: 'var(--text-faint)' }}>· {r.label}</span>
              </span>
              {([0, 1] as const).map((slot) => (
                <select key={slot} className="input" style={{ flex: '1 1 150px', height: 36 }} value={slot === 0 ? a : b}
                  onChange={(e) => pick(slot, e.target.value)} aria-label={`${groupShort(r.code)} ${t('ที่ปรึกษา')} ${slot + 1}`}>
                  <option value="">{t('— ไม่มี —')}</option>
                  {sorted.map((tc) => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
                </select>
              ))}
              <button className="btn" style={{ width: 'auto', height: 36, padding: '0 14px' }} disabled={!changed(r) || busy === r.code} onClick={() => save(r)}>
                {t('บันทึก')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
