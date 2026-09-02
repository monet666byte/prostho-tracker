import { ArrowLeft, CaretDown, ChatCircleText, SquaresFour, X } from '@phosphor-icons/react';
import {useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, PhotoSlot, TypeBadge } from '../../components/ui/Bits';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { RequirementSlots } from '../../components/teacher/RequirementSlots';
import { setReview } from '../../data/repo';
import { TYPES } from '../../domain/catalog';
import { caseCount, currentProc, daysSinceUpdate, isComplete, isStale, maxProgression, percentCompleted, procLabel,
  progression, sortWorkpieces, yearlyRows, nextProc } from '../../domain/rules';
import { useAllStudents, usePending, useReviews, useTeacher, useWorkpieces } from '../../hooks/data';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { thaiShort, relative } from '../../lib/date';
import { t, tSexAge, tText } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';
import { groupShort } from '../../domain/group';

type Filter = 'all' | 'stale' | 'done';

/**
 * หน้าตรวจงานรายคน — ใช้เป็นครั้งคราว: ไล่ดูความคืบหน้า/รูปงาน แล้วทิ้งคอมเมนต์ถึงนักศึกษา
 * (ระบบรายงาน + ขั้นตรวจรับเข้าเกณฑ์ ถูกตัดออกทั้งคู่ตามผู้ใช้ — เคสนับเข้าเกณฑ์ทันทีที่ลง)
 */
export default function Review() {
  const { session, settings, showToast } = useApp();
  const teacher = useTeacher(session?.teacherId);
  const students = useAllStudents();
  const reviews = useReviews();
  const pending = usePending();
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], []) ?? [];
  const teacherById = useMemo(() => new Map(teachers.map((tc) => [tc.id, tc])), [teachers]);

  const groupCode = useApp((st) => st.teacherGroup);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [studentId, setStudentId] = useState<string | undefined>(params.get('student') ?? undefined);
  // เปลี่ยนกลุ่ม (จาก sidebar) แล้วเด้งไปคนแรกของกลุ่มใหม่
  useEffect(() => setStudentId(undefined), [groupCode]);
  // เข้าหน้านี้จากการกดชื่อนักศึกษาในสรุปกลุ่ม (?student=) — ประกาศทีหลัง ให้ชนะ effect รีเซ็ตตอน mount
  useEffect(() => { const q = params.get('student'); if (q) setStudentId(q); }, [params]);

  const groupStudents = useMemo(
    () => students.filter((s) => s.group === groupCode).sort((a, b) => a.code.localeCompare(b.code)),
    [students, groupCode],
  );
  const advisors = groupStudents[0]?.advisorIds.map((id) => t(teacherById.get(id)?.name ?? '—')).join(' / ') ?? '';
  const activeId = studentId ?? groupStudents[0]?.id;
  const active = groupStudents.find((s) => s.id === activeId);
  const works = useWorkpieces(activeId);

  /**
   * รูปงานจริงของแต่ละชิ้น — เดิมตรงนี้เป็นช่องรูปเปล่า 2 ช่องกับป้ายว่า
   * "2 รูป (เดโม — ยังไม่มีรูปจริง)" ตอนนี้ระบบเก็บรูปจริงแล้วจึงดึงมาแสดง
   */
  const photoByWork = useLiveQuery(async () => {
    const ids = works.map((w) => w.id);
    if (!ids.length) return new Map<string, { id: string; dataUrl?: string; stepLabel: string }[]>();
    const rows = await db.photos.where('workpieceId').anyOf(ids).toArray();
    const map = new Map<string, { id: string; dataUrl?: string; stepLabel: string }[]>();
    rows.forEach((ph) => map.set(ph.workpieceId, [...(map.get(ph.workpieceId) ?? []), ph]));
    return map;
  }, [works.map((w) => w.id).join(',')], new Map()) ?? new Map();

  const [filter, setFilter] = useState<Filter>('all');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  // กันกดรัวปุ่มบันทึกคอมเมนต์ — useRef เพราะ setState ตามคลิกรัวไม่ทัน
  const savingComment = useRef(false);
  // แผงสรุปเกณฑ์พับไว้เป็นค่าเริ่มต้น — สรุปย่ออยู่ในหัวการ์ดแล้ว กดดูเต็มเมื่อต้องใช้
  const [showReq, setShowReq] = useState(false);

  const list = useMemo(() => {
    const sorted = sortWorkpieces(works);
    if (filter === 'stale') return sorted.filter((w) => isStale(w, settings));
    if (filter === 'done') return sorted.filter((w) => isComplete(w));
    return sorted;
  }, [works, filter, settings]);

  const staleCount = works.filter((w) => isStale(w, settings)).length;
  const doneCount = works.filter((w) => isComplete(w)).length;
  const reqRows = caseCount(works, settings);
  const crownRow = reqRows.find((r) => r.group === 'CROWN');
  const thisYear = yearlyRows(works, settings).slice(-1)[0] ?? { done: 0, required: settings.req.perYear };

  return (
    <TeacherShell active="mygroup">
      <main className="main">
        <button
          onClick={() => navigate('/teacher/group')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, marginBottom: 8, cursor: 'pointer', font: '500 12px var(--font-body)', color: 'var(--accent)' }}
        >
          <ArrowLeft size={14} weight="bold" /> {t('กลับสรุปกลุ่ม')}
        </button>
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('ตรวจงานรายคน')}</h1>
            <p>
              {t('กลุ่ม')} {groupShort(groupCode)} · {t('{n} คน', { n: groupStudents.length })}
              {advisors && ` · ${t('อาจารย์ที่ปรึกษา')} ${advisors}`}
              {' — '}{t('ใช้เป็นครั้งคราว ตอนรับเคสใหม่/เคสจบ (งานประจำคาบอยู่ที่ "ประเมินรายคาบ")')}
            </p>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px' }}>
          {/* สลับคนผ่าน dropdown เล็กๆ แทนแถวปุ่มทั้งกลุ่ม (ผู้ใช้ 2 ก.ย.: ปุ่มชื่อคนอื่นทั้งกลุ่มไม่จำเป็น) */}
          <select
            className="input"
            style={{ width: 'auto', maxWidth: 250, height: 38, font: '600 12.5px var(--font-body)' }}
            value={activeId ?? ''}
            onChange={(e) => setStudentId(e.target.value)}
          >
            {groupStudents.map((st) => (
              <option key={st.id} value={st.id}>{t(st.name)} · {st.code}</option>
            ))}
          </select>
          <div style={{ flex: 1 }}>
            <div style={{ font: '500 12px var(--font-body)', color: 'var(--text-secondary)' }}>
              {t('{n} ชิ้นงาน', { n: works.length })} · {t('เกณฑ์สะสม')}{' '}
              {reqRows.map((r) => `${r.group === 'CROWN' ? 'Crown' : r.group} ${r.done}/${r.required}`).join(' · ')}
              {crownRow?.postCoreRequired !== undefined && ` (Post-core ${crownRow.postCoreDone}/${crownRow.postCoreRequired})`}
              {' · '}{t('รายปี')} {thisYear.done}/{thisYear.required}
            </div>
          </div>
          <button
            className="btn btn--sec"
            style={{ width: 'auto', height: 34, fontSize: 11.5, padding: '0 12px' }}
            onClick={() => setShowReq(!showReq)}
          >
            <SquaresFour size={14} /> {showReq ? t('ซ่อนเกณฑ์') : t('ดูเกณฑ์')}
          </button>
        </div>

        {/* ตัวกรอง — ปุ่มใหญ่แยกบรรทัด มีจำนวนกำกับทุกอัน (แถบเล็กในแผงสรุปเดิมกดยาก) */}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 13 }}>
          {(
            [
              ['all', t('ทั้งหมด'), works.length],
              ['stale', t('ค้างนาน'), staleCount],
              ['done', t('จบเคสแล้ว'), doneCount],
            ] as Array<[Filter, string, number]>
          ).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                font: `600 12.5px var(--font-body)`, padding: '9px 15px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${filter === k ? 'var(--accent)' : 'var(--border-2)'}`,
                background: filter === k ? 'var(--accent)' : '#fff',
                color: filter === k ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {label} <span className="mono" style={{ fontWeight: 400, opacity: 0.75 }}>{n}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: showReq ? 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' : '1fr', gap: 13, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 10 }}>
          {list.length === 0 && (
            <div className="dashed" style={{ padding: '22px 16px', textAlign: 'center', font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
              {t('ไม่มีชิ้นงานในหมวดนี้')}
            </div>
          )}
          {list.map((w) => {
            const meta = TYPES[w.type];
            const cur = currentProc(w);
            const review = reviews.get(w.id);
            const opened = expanded === w.id;
            return (
              <article key={w.id} className="reviewcard" style={{ display: 'block' }}>
                {/* หัวแถว = ปุ่มเปิด/ปิดทั้งแถบ กดง่ายสำหรับผู้ใช้สูงอายุ */}
                <button
                  onClick={() => setExpanded(opened ? null : w.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <TypeBadge type={w.type} />
                    <span style={{ font: '600 13.5px var(--font-head)' }}>{tText(w.detail)}</span>
                    {w.minimumRequirement && (
                      <span className="badge" style={{ background: 'var(--success-tint)', color: 'var(--success-dark)' }}>{t('นับเกณฑ์')}</span>
                    )}
                    {isStale(w, settings) && (
                      <span className="badge" style={{ background: 'var(--danger-tint)', color: 'var(--danger-dark)' }}>
                        {t('ค้าง {d} วัน', { d: daysSinceUpdate(w) })}
                      </span>
                    )}
                    {pending.has(w.id) && (
                      <span className="badge" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)' }}>{t('รอ sync')}</span>
                    )}
                    {!!(review?.comment) && (
                      <span className="badge" style={{ background: 'var(--accent-tint)', color: 'var(--accent-hover)' }}>
                        <ChatCircleText size={11} weight="fill" style={{ verticalAlign: -1.5, marginRight: 3 }} />{t('คอมเมนต์แล้ว')}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', font: '500 11px var(--font-body)', flex: 'none' }}>
                      {opened ? t('ซ่อน') : t('รูป · คอมเมนต์')}
                      <CaretDown size={12} weight="bold" style={{ transform: opened ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                    </span>
                  </div>

                  <div className="mono" style={{ font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)', marginTop: 6 }}>
                    {t(w.patient.name)} · HN {w.patient.hn} · {tSexAge(w.patient.sexAge)} · {t('รับเคส')} {thaiShort(w.acceptedDate)}
                    {/* สถานะผู้ป่วย (รอ preprosth ฯลฯ) ต้องเห็นตั้งแต่แถว ไม่ต้องกาง — ผู้ใช้ขอ 2 ก.ย. */}
                    {w.patient.note && (
                      <span style={{ font: '500 10.5px var(--font-body)', color: 'var(--warning-dark)' }}>
                        {' '}· 📝 {t(w.patient.note)}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 10 }}>
                    <Bar value={(Math.max(progression(w), 0) / maxProgression(w)) * 100} color={meta.color} height={8} />
                    <span className="mono" style={{ font: '600 11.5px var(--font-mono)', color: 'var(--text-secondary)', flex: 'none' }}>
                      {Math.max(progression(w), 0)}/{maxProgression(w)}
                    </span>
                    <span className="chip" style={{ background: meta.tint, color: meta.ink }}>{percentCompleted(w)}%</span>
                    <span style={{ font: '400 11.5px var(--font-mono)', color: 'var(--text-body)', flex: 1, minWidth: 140 }}>
                      {cur ? procLabel(w.type, cur) : t('ยังไม่เริ่ม')}
                    </span>
                  </div>
                </button>

                {opened && (
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                    {/* รายละเอียดเคส — ผู้ใช้ขอ 2 ก.ย.: กดเข้ามาแล้วอยากเห็นมากกว่ารูป+คอมเมนต์ */}
                    {(() => {
                      const nx = nextProc(w);
                      const rows: Array<[string, string]> = [
                        [t('ขั้นถัดไป'), nx ? procLabel(w.type, nx) : t('จบเคสแล้ว')],
                        ...(w.tooth ? [[t('ซี่'), w.tooth] as [string, string]] : []),
                        ...(w.kennedy ? [[t('Kennedy'), w.kennedy] as [string, string]] : []),
                        ...(w.dentureClass ? [[t('ลักษณะเคส'), tText(w.dentureClass)] as [string, string]] : []),
                        [t('ชำระเงิน'), t(w.payment)],
                        [t('อัปเดตล่าสุด'), relative(w.lastUpdatedAt)],
                      ];
                      return (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 22px' }}>
                            {rows.map(([k, v]) => (
                              <span key={k} style={{ font: '400 11px var(--font-body)', color: 'var(--text-muted)' }}>
                                {k}: <b style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{v}</b>
                              </span>
                            ))}
                          </div>
                          {w.patient.note && (
                            <div style={{ marginTop: 7, padding: '7px 10px', borderRadius: 9, background: 'var(--warning-tint)', font: '400 11px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
                              {t('หมายเหตุ/สถานะผู้ป่วยจากชีต')}: {w.patient.note}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
                    {(() => {
                      const shots = (photoByWork.get(w.id) ?? []) as { id: string; dataUrl?: string; stepLabel: string }[];
                      return (
                        <div style={{ flex: '0 1 auto' }}>
                          <div style={{ font: '500 10px var(--font-body)', color: 'var(--text-faint)', marginBottom: 5 }}>
                            {shots.length
                              ? t('รูปงานที่นักศึกษาแนบ · {n} รูป', { n: shots.length })
                              : t('นักศึกษายังไม่ได้แนบรูปของชิ้นงานนี้')}
                          </div>
                          {shots.length > 0 && (
                            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                              {shots.slice(0, 6).map((ph) => (
                                <PhotoSlot key={ph.id} size={64} filled src={ph.dataUrl} alt={ph.stepLabel} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <div style={{ flex: '1 1 280px', minWidth: 260 }}>
                      <textarea
                        className="input"
                        style={{ minHeight: 64, fontSize: 12 }}
                        placeholder={t('คอมเมนต์ถึงนักศึกษา…')}
                        value={comments[w.id] ?? review?.comment ?? ''}
                        onChange={(e) => setComments({ ...comments, [w.id]: e.target.value })}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          className="btn btn--sec"
                          style={{ height: 38, fontSize: 12, width: 'auto', padding: '0 14px' }}
                          onClick={async () => {
                            if (savingComment.current) return;
                            savingComment.current = true;
                            try {
                              await setReview(w.id, review?.status ?? 'pending', comments[w.id] ?? review?.comment ?? '', teacher?.name ?? currentActor());
                              showToast({ message: t('บันทึกคอมเมนต์แล้ว'), tone: 'success' });
                            } finally {
                              savingComment.current = false;
                            }
                          }}
                        >
                          <ChatCircleText size={15} /> {t('บันทึกคอมเมนต์')}
                        </button>

                      </div>
                    </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          </div>

          {showReq && (
          <div className="panel" style={{ position: 'sticky', top: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <h3 style={{ flex: 1 }}>{t('เกณฑ์ของ')} {t(active?.name ?? '')}</h3>
              <button className="iconbtn iconbtn--plain" style={{ width: 26, height: 26 }} onClick={() => setShowReq(false)} aria-label={t('ปิด')}>
                <X size={13} weight="bold" />
              </button>
            </div>
            <p className="sub">{t('ทึบ = จบแล้ว · มีเลข = กำลังทำ (step ที่ผ่าน) · ประ = ยังไม่มีเคส')}</p>
            <div style={{ marginTop: 6 }}>
              <RequirementSlots works={works} settings={settings} />
            </div>
          </div>
          )}
        </div>
      </main>
    </TeacherShell>
  );
}
