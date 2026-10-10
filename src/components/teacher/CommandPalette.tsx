import { ArrowRight, MagnifyingGlass, Users } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CLINIC_LAST_YEAR, CLINIC_START_YEAR, studentCohortLabel, studentYear } from '../../domain/cohort';
import { groupShort, sortGroupCodes } from '../../domain/group';
import type { Student } from '../../domain/types';
import { useAllStudents } from '../../hooks/data';
import { personName, t } from '../../lib/i18n';
import { useApp } from '../../store/app';

export interface PalettePage { key: string; label: string; to: string; Icon: Icon }

type Row =
  | { kind: 'student'; id: string; student: Student }
  | { kind: 'group'; id: string; code: string; count: number; year: string }
  | { kind: 'page'; id: string; page: PalettePage };

const MAX_STUDENTS = 6;
const MAX_GROUPS = 4;

/** ป้ายชั้นปี — กติกาเดียวกับตัวเลือกกลุ่มในแถบซ้าย (รุ่นที่จบ/ยังไม่เริ่มไม่มี "ปี 7" หรือ "ปี 4") */
function yearLabel(s: Student): string {
  const y = studentYear(s);
  if (y > CLINIC_LAST_YEAR) return `${t('จบแล้ว')} ${studentCohortLabel(s)}`;
  if (y < CLINIC_START_YEAR) return `${t('ยังไม่เริ่ม')} ${studentCohortLabel(s)}`;
  return t('ปี {n}', { n: y });
}

/**
 * ค้นหาได้ทุกอย่างฝั่งอาจารย์ — ⌘K / Ctrl+K จากหน้าไหนก็ได้ หรือปุ่ม "ค้นหา" ในแถบซ้าย
 *
 * ค้นได้: ชื่อ/ชื่ออังกฤษ/รหัสนักศึกษา · รหัสกลุ่ม · ชื่อหน้า
 * ไม่ค้น HN/ชื่อผู้ป่วย — ระดับปิดบังตัวตนกำหนดรายหน้าที่ identityLevelFor() ช่องค้นหารวมไม่ใช่หน้าที่ภาคเคาะไว้
 * เลือกนักศึกษา = เปลี่ยนกลุ่มที่ดูเป็นกลุ่มของคนนั้นแล้วเปิดตรวจงานรายคน (แบบเดียวกับกดชื่อในตาราง)
 */
export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: PalettePage[] }) {
  const navigate = useNavigate();
  const setTeacherGroup = useApp((st) => st.setTeacherGroup);
  const teacherGroup = useApp((st) => st.teacherGroup);
  const students = useAllStudents();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQ('');
    setSel(0);
    // รอให้กล่องวาดก่อนค่อยโฟกัส
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => { cancelAnimationFrame(id); returnFocus.current?.focus?.(); };
  }, [open]);

  /* จำนวนคน + ป้ายชั้นปีต่อกลุ่ม — รหัสสั้นซ้ำกันข้ามรุ่น (PT4 ปี 5 กับ PT4 ปี 6) ต้องมีชั้นปีกำกับ */
  const groupInfo = useMemo(() => {
    const m = new Map<string, { count: number; year: string }>();
    students.forEach((s) => {
      const g = m.get(s.group);
      m.set(s.group, { count: (g?.count ?? 0) + 1, year: g?.year ?? yearLabel(s) });
    });
    return m;
  }, [students]);

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const pageRows: Row[] = pages
      .filter((p) => !needle || p.label.toLowerCase().includes(needle))
      .map((p) => ({ kind: 'page', id: `p-${p.key}`, page: p }));
    if (!needle) return pageRows;
    const studentRows: Row[] = students
      .filter((s) => `${s.name} ${s.nameEn ?? ''} ${s.code}`.toLowerCase().includes(needle))
      /* คนที่ยังเรียนอยู่ขึ้นก่อนรุ่นที่จบ · กลุ่มที่ดูอยู่ขึ้นก่อน · ที่เหลือเรียงตามรหัส */
      .sort((a, b) => Number(studentYear(a) > CLINIC_LAST_YEAR) - Number(studentYear(b) > CLINIC_LAST_YEAR)
        || Number(b.group === teacherGroup) - Number(a.group === teacherGroup)
        || a.code.localeCompare(b.code))
      .slice(0, MAX_STUDENTS)
      .map((s) => ({ kind: 'student', id: `s-${s.id}`, student: s }));
    const codes = sortGroupCodes([...groupInfo.keys()].filter((c) => groupShort(c).toLowerCase().includes(needle) || c.toLowerCase().includes(needle)), students);
    const groupRows: Row[] = codes.slice(0, MAX_GROUPS).map((c) => ({ kind: 'group', id: `g-${c}`, code: c, count: groupInfo.get(c)?.count ?? 0, year: groupInfo.get(c)?.year ?? '' }));
    return [...studentRows, ...groupRows, ...pageRows];
  }, [q, pages, students, groupInfo, teacherGroup]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const run = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    if (r.kind === 'student') {
      setTeacherGroup(r.student.group);
      navigate(`/teacher/review?student=${r.student.id}`);
    } else if (r.kind === 'group') {
      setTeacherGroup(r.code);
      navigate('/teacher/group');
    } else {
      navigate(r.page.to);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run(rows[sel]); }
  };

  const heading = (kind: Row['kind']) => (kind === 'student' ? t('นักศึกษา') : kind === 'group' ? t('กลุ่ม') : t('หน้า'));

  return (
    <div className="cmdk" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk__box" role="dialog" aria-modal="true" aria-label={t('ค้นหา')} onKeyDown={onKey}>
        <div className="cmdk__in">
          <MagnifyingGlass size={18} aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('ค้นชื่อหรือรหัสนักศึกษา · กลุ่ม · ชื่อหน้า')}
            aria-label={t('ค้นหา')}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={rows[sel] ? `cmdk-${rows[sel].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk__list" id="cmdk-list" role="listbox" ref={listRef}>
          {rows.length === 0 && <div className="cmdk__empty">{t('ไม่พบ "{q}"', { q: q.trim() })}</div>}
          {rows.map((r, i) => {
            const first = i === 0 || rows[i - 1].kind !== r.kind;
            return (
              <div key={r.id}>
                {first && <div className="cmdk__head">{heading(r.kind)}</div>}
                <div
                  id={`cmdk-${r.id}`}
                  role="option"
                  aria-selected={i === sel}
                  data-on={i === sel}
                  className="cmdk__row"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(r)}
                >
                  {r.kind === 'student' && (
                    <>
                      <span className="cmdk__av" aria-hidden>{personName(r.student).replace(/^(นศ|อ)\.\s*/, '').trim()[0] ?? '?'}</span>
                      <span className="cmdk__tx">
                        <b>{personName(r.student)}</b>
                        <small>{r.student.code} · {groupShort(r.student.group)} · {yearLabel(r.student)}</small>
                      </span>
                      <span className="cmdk__go">{t('ตรวจงานรายคน')}</span>
                    </>
                  )}
                  {r.kind === 'group' && (
                    <>
                      <span className="cmdk__av cmdk__av--grp" aria-hidden><Users size={15} weight="bold" /></span>
                      <span className="cmdk__tx">
                        <b>{t('กลุ่ม {g}', { g: groupShort(r.code) })}</b>
                        <small>{r.year} · {t('{n} คน', { n: r.count })}</small>
                      </span>
                      <span className="cmdk__go">{t('สรุปกลุ่ม')}</span>
                    </>
                  )}
                  {r.kind === 'page' && (
                    <>
                      <span className="cmdk__av cmdk__av--page" aria-hidden><r.page.Icon size={15} /></span>
                      <span className="cmdk__tx"><b>{r.page.label}</b></span>
                      <ArrowRight size={14} className="cmdk__arrow" aria-hidden />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cmdk__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd>{t('เลือก')}</span>
          <span><kbd>↵</kbd>{t('เปิด')}</span>
          <span><kbd>esc</kbd>{t('ปิด')}</span>
        </div>
      </div>
    </div>
  );
}
