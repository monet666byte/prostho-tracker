import {
  ArrowLeft, CameraPlus, CaretDown, CaretUp, Check, CheckCircle, Circle, CircleDashed, DotsThree, NotePencil,
  SealCheck,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArchBadge, Bar, PendingBadge, PhotoSlot, SelfBadge, TypeBadge,
} from '../../components/ui/Bits';
import { ConfirmSheet } from '../../components/student/ConfirmSheet';
import { PlainShell } from '../../components/student/Shell';
import { addPhoto } from '../../data/repo';
import { TYPES } from '../../domain/catalog';
import {
  currentProc, isComplete, maxProgression, nextProc, percentCompleted, progression, stepGroups,
} from '../../domain/rules';
import { usePending, useWorkpiece } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { t, tText } from '../../lib/i18n';
import { useApp } from '../../store/app';

export default function WorkpieceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const w = useWorkpiece(id);
  const pending = usePending();
  const { openSheet, offline, showToast } = useApp();
  // step ที่ผู้ใช้กดกางดูเอง (นอกเหนือจาก step ที่กำลังทำซึ่งกางอยู่แล้ว)
  const [openStep, setOpenStep] = useState<number | null>(null);

  if (!w) return <PlainShell><div style={{ padding: 24 }}>{t('ไม่พบชิ้นงานนี้')}</div></PlainShell>;

  const meta = TYPES[w.type];
  const groups = stepGroups(w);
  const prog = progression(w);
  const max = maxProgression(w);
  const next = nextProc(w);
  const cur = currentProc(w);
  const done = isComplete(w);

  const footer = (
    <div className="footer">
      {next ? (
        <>
          <div style={{ font: '400 11.5px/1.5 var(--font-body)', color: 'var(--text-muted)', marginBottom: 9 }}>
            {t('ถัดไป')}: <span className="mono">{next.name}</span>
          </div>
          <button
            className={`btn${next.progression >= max ? ' btn--success' : ''}`}
            style={{ height: 58, borderRadius: 16 }}
            onClick={() => openSheet(w.id)}
          >
            <CheckCircle size={20} weight="fill" />
            {next.progression >= max ? t('ปิดเคส · Completion of case') : t('ทำขั้นนี้เสร็จแล้ว')}
          </button>
        </>
      ) : (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52,
            borderRadius: 14, background: 'var(--success-tint)', color: 'var(--success-dark)',
            font: '600 13.5px var(--font-body)',
          }}
        >
          <SealCheck size={19} weight="fill" />
          {t('จบเคสแล้ว · นับเข้าเกณฑ์')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 9, marginTop: 8 }}>
        <button
          className="btn btn--sec"
          onClick={async () => {
            await addPhoto(w.id, offline);
            showToast({ message: offline ? t('เก็บรูปในเครื่อง · รอ sync') : t('แนบรูปแล้ว'), tone: offline ? 'warning' : 'default' });
          }}
        >
          <CameraPlus size={16} /> {t('แนบรูป')}
        </button>
        <button className="btn btn--sec" onClick={() => navigate('/app/photos')}>
          <NotePencil size={16} /> {t('บันทึกโน้ต')}
        </button>
      </div>
    </div>
  );

  return (
    <PlainShell footer={footer} overlay={<ConfirmSheet />}>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', font: '600 14.5px var(--font-head)' }}>{t(w.patient.name)}</span>
            <span style={{ display: 'block', font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)' }}>
              HN {w.patient.hn} · {t('รับเคส')} {thaiShort(w.acceptedDate)}
            </span>
          </span>
          <button className="iconbtn iconbtn--plain" aria-label={t('เมนู')}>
            <DotsThree size={20} weight="bold" />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
          <TypeBadge type={w.type} />
          <ArchBadge arch={w.arch} />
          {w.tooth && (
            <span className="badge mono" style={{ background: 'var(--fill)', color: 'var(--text-muted)', fontWeight: 500 }}>
              {t('ซี่')} {w.tooth}
            </span>
          )}
          {w.kennedy && (
            <span className="badge" style={{ background: 'var(--fill)', color: 'var(--text-muted)' }}>{w.kennedy}</span>
          )}
          {w.minimumRequirement && (
            <span className="badge" style={{ background: 'var(--success-tint)', color: 'var(--success-dark)' }}>
              <SealCheck size={12} weight="fill" /> {t('นับ minimum requirement')}
            </span>
          )}
          {pending.has(w.id) && <PendingBadge />}
        </div>

        <h2 className="h2" style={{ marginTop: 10 }}>{meta.full}</h2>
        <div style={{ font: '400 11px var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>{tText(w.detail)}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 13 }}>
          <Bar value={(Math.max(prog, 0) / max) * 100} color={meta.color} height={8} />
          <span style={{ font: '600 12px var(--font-mono)', color: 'var(--text-secondary)', flex: 'none' }}>
            {Math.max(prog, 0)}/{max}
          </span>
          <span
            className="chip"
            style={{ background: done ? 'var(--success-tint)' : 'var(--accent-tint)', color: done ? 'var(--success-dark)' : 'var(--accent)' }}
          >
            {percentCompleted(w)}% completed
          </span>
        </div>
      </header>

      <div className="tl" style={{ paddingTop: 16 }}>
        {groups.map((g, gi) => {
          const first = g.procs[0];
          const extra = g.procs.length - 1;
          const lastDoneIndex = groups.map((x) => x.state).lastIndexOf('done');
          const passedDate = gi === lastDoneIndex ? thaiShort(w.lastUpdatedAt) : null;
          const expanded = g.state === 'active' || openStep === g.progression;
          return (
            <div className="tl__item" key={g.progression}>
              <div className="tl__rail">
                <span className={`tl__dot tl__dot--${g.state}`}>
                  {g.state === 'done' ? <Check size={14} weight="bold" /> : g.progression}
                </span>
                {gi < groups.length - 1 && <span className={`tl__line${g.state === 'done' ? ' tl__line--done' : ''}`} />}
              </div>

              <div className="tl__body">
                <button
                  onClick={() => setOpenStep(openStep === g.progression ? null : g.progression)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', width: '100%', textAlign: 'left' }}
                >
                  <span className="tl__title">
                    {first.name}
                    {extra > 0 && <span className="faint" style={{ fontWeight: 400 }}> · +{extra} {t('ขั้นตอนย่อย')}</span>}
                  </span>
                  {g.hasSelf && <SelfBadge compact />}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-disabled)', display: 'grid' }}>
                    {expanded ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
                  </span>
                </button>
                <div className="tl__meta">
                  {g.state === 'done'
                    ? passedDate ? `${t('ผ่านแล้ว')} · ${passedDate}` : t('ผ่านแล้ว')
                    : g.state === 'active'
                      ? cur && cur.progression === g.progression
                        ? t('กำลังทำ · ผ่านบางขั้นตอนย่อยแล้ว')
                        : t('กำลังทำ · ยังไม่บันทึก')
                      : t('รอดำเนินการ')}
                </div>

                {expanded && (
                  <div className="tl__panel">
                    {g.procs.map((p) => {
                      const passed = w.procIndex >= p.index;
                      const isNext = w.procIndex + 1 === p.index;
                      return (
                        <div className="tl__proc" key={p.index}>
                          <span style={{ flex: 'none', marginTop: 1, display: 'grid' }}>
                            {passed ? (
                              <CheckCircle size={15} weight="fill" color="var(--success)" />
                            ) : isNext ? (
                              <CircleDashed size={15} color="var(--accent)" />
                            ) : (
                              <Circle size={15} color="var(--text-disabled)" />
                            )}
                          </span>
                          <span style={{ flex: 1, color: passed ? 'var(--text-faint)' : 'var(--text-secondary)' }}>
                            {p.name}
                          </span>
                          {p.selfPerformed && <SelfBadge compact />}
                        </div>
                      );
                    })}
                    {g.state === 'active' && (
                    <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
                      <PhotoSlot filled />
                      <PhotoSlot filled />
                      <button
                        className="dashed"
                        style={{ width: 52, height: 52, display: 'grid', placeItems: 'center', color: 'var(--accent)' }}
                        onClick={async () => {
                          await addPhoto(w.id, offline);
                          showToast({ message: offline ? t('เก็บรูปในเครื่อง · รอ sync') : t('แนบรูปแล้ว'), tone: offline ? 'warning' : 'default' });
                        }}
                        aria-label={t('เพิ่มรูป')}
                      >
                        <CameraPlus size={19} />
                      </button>
                    </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PlainShell>
  );
}
