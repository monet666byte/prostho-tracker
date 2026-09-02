import { CaretRight, LinkSimple, PencilSimpleLine, PlusCircle, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, PendingBadge, StaleBadge, TypeBadge } from '../../components/ui/Bits';
import { Shell } from '../../components/student/Shell';
import { usePending, useWorkpieces } from '../../hooks/data';
import { deleteWorkpiece, updatePatientNote } from '../../data/repo';
import { TYPES } from '../../domain/catalog';
import { currentProc, daysSinceUpdate, isStale, maxProgression, progression } from '../../domain/rules';
import type { WorkpieceView } from '../../domain/types';
import { t, tSexAge, tText } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';

function MiniRow({
  w, pending, stale, editing, onDelete,
}: {
  w: WorkpieceView; pending: boolean; stale: boolean; editing: boolean; onDelete: (w: WorkpieceView) => void;
}) {
  const meta = TYPES[w.type];
  const prog = progression(w);
  const max = maxProgression(w);
  const cur = currentProc(w);
  return (
    <Link to={`/app/work/${w.id}`} className="pairrow">
      <span className="pairrow__arch">{w.arch ? (w.arch === 'upper' ? 'Upper' : 'Lower') : (w.tooth ?? '—')}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block', font: '400 11px var(--font-mono)', color: 'var(--text-body)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {cur ? cur.name : t('ยังไม่เริ่ม')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
          <Bar value={(Math.max(prog, 0) / max) * 100} color={meta.color} height={5} />
          <span style={{ font: '500 10px var(--font-mono)', color: 'var(--text-faint)', flex: 'none' }}>
            {Math.max(prog, 0)}/{max}
          </span>
        </span>
      </span>
      {pending && <PendingBadge />}
      {stale && <StaleBadge days={daysSinceUpdate(w)} />}
      {editing && (
        <button
          className="delbtn"
          onClick={(e) => { e.preventDefault(); onDelete(w); }}
          aria-label={`${t('ลบ')} ${w.detail}`}
        >
          <Trash size={15} />
        </button>
      )}
    </Link>
  );
}

/** ตัวย่อบน avatar — ใช้อักษรแรกของคำสุดท้าย ("ผู้ป่วย A" → "A") */
function initial(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? name).charAt(0);
}

function DeleteSheet({ target, onCancel, onConfirm }: { target: WorkpieceView | null; onCancel: () => void; onConfirm: () => void }) {
  if (!target) return null;
  const hasProgress = target.procIndex >= 0;
  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
          <span
            style={{
              width: 40, height: 40, borderRadius: 12, background: 'var(--danger-tint)', color: 'var(--danger)',
              display: 'grid', placeItems: 'center', flex: 'none',
            }}
          >
            <WarningCircle size={22} weight="fill" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="h3">{t('ลบชิ้นงานนี้?')}</h3>
            <p style={{ margin: '5px 0 0', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-body)' }}>
              {tText(target.detail)}
              <span style={{ display: 'block', font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>
                {t(target.patient.name)} · HN {target.patient.hn}
              </span>
            </p>
          </div>
        </div>

        <p className="pretty" style={{ margin: '13px 0 0', font: '400 11.5px/1.65 var(--font-body)', color: 'var(--text-muted)' }}>
          {hasProgress
            ? t('ประวัติ step ที่บันทึกไว้และรูปทั้งหมดของชิ้นนี้จะถูกลบไปด้วย และย้อนกลับไม่ได้ — ถ้าแค่กรอกผิด step ใช้ปุ่ม "เลิกทำ" แทนได้')
            : t('ชิ้นนี้ยังไม่ได้เริ่มบันทึกอะไร ลบได้โดยไม่เสียประวัติ')}
          {' '}{t('ถ้าเป็นชิ้นสุดท้ายของผู้ป่วย รายชื่อผู้ป่วยจะถูกลบออกด้วย')}
        </p>

        <button
          className="btn"
          style={{ marginTop: 16, background: 'var(--danger)', boxShadow: '0 2px 0 var(--danger-dark)' }}
          onClick={onConfirm}
        >
          <Trash size={18} weight="fill" />
          {t('ลบชิ้นงาน')}
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={onCancel}>
          {t('ยกเลิก')}
        </button>
      </div>
    </div>
  );
}

export default function Patients() {
  const { session, settings, showToast, touch } = useApp();
  // แก้สถานะผู้ป่วย (รอ preprosth / รอถอนฟัน ฯลฯ) — id ที่กำลังแก้ + ข้อความร่าง
  const [noteEdit, setNoteEdit] = useState<{ id: string; text: string } | null>(null);
  const works = useWorkpieces(session?.studentId);
  const pending = usePending();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<WorkpieceView | null>(null);

  async function confirmDelete() {
    if (!target) return;
    await deleteWorkpiece(target.id, currentActor());
    setTarget(null);
    showToast({ message: t('ลบ {d} แล้ว', { d: target.detail }), tone: 'warning' });
  }

  // จัดกลุ่มตามผู้ป่วย โดยคงลำดับที่ sortWorkpieces จัดไว้แล้ว
  const byPatient = new Map<string, WorkpieceView[]>();
  works.forEach((w) => {
    const arr = byPatient.get(w.patientId) ?? [];
    arr.push(w);
    byPatient.set(w.patientId, arr);
  });

  return (
    <Shell overlay={<DeleteSheet target={target} onCancel={() => setTarget(null)} onConfirm={confirmDelete} />}>
      <header className="s-header">
        <div className="s-header--row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="h2">{t('คนไข้ + ชิ้นงาน')}</h2>
          <p style={{ margin: '3px 0 0', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
            {t('{a} คน · {b} ชิ้นงาน', { a: byPatient.size, b: works.length })}{editing ? t(' · แตะถังขยะเพื่อลบ') : ''}
          </p>
        </div>
        <button
          className={`iconbtn${editing ? '' : ' iconbtn--plain'}`}
          onClick={() => setEditing(!editing)}
          aria-label={editing ? t('เสร็จสิ้น') : t('แก้ไขรายการ')}
        >
          {editing ? <X size={17} weight="bold" /> : <PencilSimpleLine size={17} />}
        </button>
        </div>
      </header>

      <div style={{ paddingTop: 14 }}>
        {[...byPatient.entries()].map(([pid, list]) => {
          const patient = list[0].patient;
          // แยกคู่ upper/lower ออกจากชิ้นเดี่ยว
          const pairs = new Map<string, WorkpieceView[]>();
          const singles: WorkpieceView[] = [];
          list.forEach((w) => {
            if (w.pairId) {
              const arr = pairs.get(w.pairId) ?? [];
              arr.push(w);
              pairs.set(w.pairId, arr);
            } else singles.push(w);
          });

          return (
            <section key={pid} className="rowcard">
              <div className="rowcard__head">
                <span className="avatar">{initial(t(patient.name))}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', font: '600 14px var(--font-head)' }}>{t(patient.name)}</span>
                  <span style={{ display: 'block', font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>
                    HN {patient.hn} · {tSexAge(patient.sexAge)}
                  </span>
                  {/* สถานะผู้ป่วยจากชีต/ที่กรอกเอง — แตะเพื่อแก้ได้เลย (ผู้ใช้ขอ 2 ก.ย.) */}
                  {noteEdit?.id !== patient.id && (
                    <button
                      onClick={() => setNoteEdit({ id: patient.id, text: patient.note ?? '' })}
                      style={{ display: 'block', textAlign: 'left', padding: 0, marginTop: 3, background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      {patient.note ? (
                        <span style={{ font: '500 10.5px var(--font-body)', color: 'var(--warning-dark)' }}>
                          📝 {t(patient.note)} <PencilSimpleLine size={11} style={{ verticalAlign: -1.5 }} />
                        </span>
                      ) : (
                        <span style={{ font: '500 10px var(--font-body)', color: 'var(--text-faint)' }}>
                          + {t('เพิ่มสถานะ (เช่น รอ preprosth · รอถอนฟัน)')}
                        </span>
                      )}
                    </button>
                  )}
                </span>
                <CaretRight size={16} color="var(--text-disabled)" />
              </div>
              {noteEdit?.id === patient.id && (
                <div style={{ display: 'flex', gap: 7, margin: '8px 0 2px' }}>
                  <input
                    className="input"
                    style={{ height: 38, fontSize: 12 }}
                    autoFocus
                    placeholder={t('สถานะผู้ป่วย เช่น รอ preprosth · รอถอนฟัน · F/U 2 wks')}
                    value={noteEdit.text}
                    onChange={(e) => setNoteEdit({ id: patient.id, text: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Escape') setNoteEdit(null); }}
                  />
                  <button
                    className="btn"
                    style={{ width: 'auto', height: 38, padding: '0 14px', fontSize: 12, flex: 'none' }}
                    onClick={async () => {
                      await updatePatientNote(patient.id, noteEdit.text, currentActor());
                      setNoteEdit(null);
                      touch();
                      showToast({ message: t('บันทึกสถานะผู้ป่วยแล้ว'), tone: 'success' });
                    }}
                  >
                    {t('บันทึก')}
                  </button>
                  <button className="btn btn--sec" style={{ width: 'auto', height: 38, padding: '0 12px', fontSize: 12, flex: 'none' }} onClick={() => setNoteEdit(null)}>
                    <X size={13} />
                  </button>
                </div>
              )}

              {[...pairs.values()].map((pair) => {
                const first = pair[0];
                return (
                  <div key={first.pairId} className={`pairbox t-${first.type}`}>
                    <div className="pairlabel">
                      <LinkSimple size={13} weight="bold" />
                      {t('คู่ upper/lower · รับเคสพร้อมกัน')} · {TYPES[first.type].short}
                    </div>
                    {pair.map((w) => (
                      <MiniRow
                        key={w.id}
                        w={w}
                        pending={pending.has(w.id)}
                        stale={isStale(w, settings)}
                        editing={editing}
                        onDelete={setTarget}
                      />
                    ))}
                  </div>
                );
              })}

              {singles.map((w) => (
                <Link key={w.id} to={`/app/work/${w.id}`} className="singlerow">
                  <TypeBadge type={w.type} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block', font: '500 11.5px var(--font-body)', color: 'var(--text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {tText(w.detail)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
                      <Bar
                        value={(Math.max(progression(w), 0) / maxProgression(w)) * 100}
                        color={TYPES[w.type].color}
                        height={5}
                      />
                      <span style={{ font: '500 10px var(--font-mono)', color: 'var(--text-faint)', flex: 'none' }}>
                        {Math.max(progression(w), 0)}/{maxProgression(w)}
                      </span>
                    </span>
                  </span>
                  {pending.has(w.id) && <PendingBadge />}
                  {isStale(w, settings) && <StaleBadge days={daysSinceUpdate(w)} />}
                  {editing && (
                    <button
                      className="delbtn"
                      onClick={(e) => { e.preventDefault(); setTarget(w); }}
                      aria-label={`${t('ลบ')} ${w.detail}`}
                    >
                      <Trash size={15} />
                    </button>
                  )}
                </Link>
              ))}
            </section>
          );
        })}

        <Link
          to="/app/new"
          className="dashed"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '2px 16px 0',
            height: 52, font: '600 13px var(--font-body)', color: 'var(--accent)',
          }}
        >
          <PlusCircle size={19} weight="fill" />
          {t('เพิ่มคนไข้ / ชิ้นงานใหม่')}
        </Link>
      </div>
    </Shell>
  );
}
