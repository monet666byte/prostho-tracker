import { ArrowLeft, CameraPlus, CaretDown, CaretUp, Check, CheckCircle, Circle, CircleDashed, Images, SealCheck } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArchBadge, Bar, PendingBadge, PhotoSlot, SelfBadge, TypeBadge,
} from '../../components/ui/Bits';
import { ConfirmSheet } from '../../components/student/ConfirmSheet';
import { PlainShell } from '../../components/student/Shell';
import { usePhotoAttach } from '../../components/student/usePhotoAttach';
import { TYPES } from '../../domain/catalog';
import {
  maxProgression, nextProc, progression, stepGroups, isReturned } from '../../domain/rules';
import { usePending, useWorkpiece, useWorkpiecePhotos } from '../../hooks/data';
import { setWorkpieceReturned } from '../../data/repo';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';

export default function WorkpieceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const w = useWorkpiece(id);
  const pending = usePending();
  const { openSheet, showToast, touch } = useApp();
  // step ที่ผู้ใช้กดกางดูเอง (นอกเหนือจาก step ที่กำลังทำซึ่งกางอยู่แล้ว)
  const [openStep, setOpenStep] = useState<number | null>(null);
  // ต้องเรียกก่อน early return ด้านล่าง — กฎของ hook
  const attach = usePhotoAttach(id);
  const shots = useWorkpiecePhotos(id);

  /* คืนเคส — เคสที่คนไข้ไม่มาต่อ/ยกเลิก นักศึกษากดเองได้ (ผู้ใช้ถาม 2 ก.ย.)
     ⚠️ hook ต้องอยู่เหนือ early return ด้านล่าง (กฎของ hook — เคยพลาดตรงนี้จนหน้าเปล่า) */
  const [askReturn, setAskReturn] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const savingReturn = useRef(false);

  if (!w) return <PlainShell><div style={{ padding: 24 }}>{t('ไม่พบชิ้นงานนี้')}</div></PlainShell>;

  async function confirmReturn(flag: boolean) {
    if (!w || savingReturn.current) return;
    savingReturn.current = true;
    try {
      await setWorkpieceReturned(w.id, flag, returnNote, currentActor());
      setAskReturn(false);
      setReturnNote('');
      touch();
      showToast({
        message: flag ? t('คืนเคสแล้ว — ไม่นับเป็นงานที่กำลังทำ') : t('เอาเคสกลับมาทำต่อแล้ว'),
        tone: flag ? 'warning' : 'success',
      });
    } finally {
      savingReturn.current = false;
    }
  }



  const meta = TYPES[w.type];
  const groups = stepGroups(w);
  const prog = progression(w);
  const max = maxProgression(w);
  const next = nextProc(w);

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
        {attach.input}
        <button className="btn btn--sec" disabled={attach.busy} onClick={attach.open}>
          <CameraPlus size={16} /> {attach.busy ? t('กำลังย่อรูป…') : t('แนบรูป')}
        </button>
        {/* เดิมป้ายเขียน "บันทึกโน้ต" แต่หน้า photos ไม่มีช่องโน้ต — ป้ายต้องตรงกับของจริง
            (ระบบโน้ตต่อเคสยังไม่ทำ ถ้าจะทำค่อยแยกปุ่มใหม่) */}
        <button className="btn btn--sec" onClick={() => navigate('/app/photos')}>
          <Images size={16} /> {t('คลังรูปงาน')}
        </button>
      </div>
      <button
        className="btn btn--ghost"
        style={{ marginTop: 6, height: 40, fontSize: 12, color: isReturned(w) ? 'var(--success-dark)' : 'var(--danger)' }}
        onClick={() => (isReturned(w) ? void confirmReturn(false) : setAskReturn(true))}
      >
        {isReturned(w) ? t('เอาเคสกลับมาทำต่อ') : t('คืนเคสนี้')}
      </button>
    </div>
  );

  return (
    <PlainShell
      footer={footer}
      overlay={<>
        <ConfirmSheet />
        {askReturn && (
          <div className="backdrop" onClick={() => setAskReturn(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="grabber" />
              <h3 className="h3">{t('คืนเคสนี้?')}</h3>
              <p style={{ margin: '4px 0 12px', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                {t('ใช้เมื่อผู้ป่วยไม่มาต่อ / ยกเลิกการรักษา — เคสจะยังอยู่ในรายการแบบขีดฆ่า และไม่ถูกนับเป็นงานที่กำลังทำ · กดกลับมาทำต่อได้ทีหลัง')}
              </p>
              <label className="field">
                <span style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)' }}>{t('เหตุผล (ไม่บังคับ)')}</span>
                <input
                  className="input"
                  autoFocus
                  placeholder={t('เช่น ผู้ป่วยไม่สะดวกมาต่อ · ต้องรักษารากเพิ่ม')}
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                />
              </label>
              <button className="btn" style={{ height: 50, marginTop: 14, background: 'var(--danger)' }} onClick={() => void confirmReturn(true)}>
                {t('ยืนยันคืนเคส')}
              </button>
              <button className="btn btn--sec" style={{ height: 44, marginTop: 8 }} onClick={() => setAskReturn(false)}>{t('ยกเลิก')}</button>
            </div>
          </div>
        )}
      </>}
    >
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
          {/* เคยมีปุ่มเมนู ⋯ ตรงนี้ แต่ไม่เคยผูกอะไรเลย (กดแล้วเงียบ) — เอาออกจนกว่าจะมีเมนูจริง
              การลบชิ้นงานทำได้ที่หน้าคนไข้ (โหมดแก้ไข) */}
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

        {/* V1 เก็บกวาด (ผู้ใช้เลือก 1 ก.ย.): ชิปบอกประเภทอยู่แล้ว — หัวย่อลง ตัดบรรทัด detail
            และตัดชิป % (เลขถ่วงน้ำหนักไม่ตรงกับ 5/10 ชวนงง) เหลือ bar + x/y ที่เดียว */}
        <h2 className="h2" style={{ marginTop: 10, font: '600 17.5px/1.3 var(--font-head)' }}>{meta.full}</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <Bar value={(Math.max(prog, 0) / max) * 100} color={meta.color} height={8} />
          <span style={{ font: '600 12px var(--font-mono)', color: 'var(--text-secondary)', flex: 'none' }}>
            {Math.max(prog, 0)}/{max}
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
                {/* V1: แถวเดียวจบ — สถานะบอกด้วยสีจุด+น้ำหนักตัวอักษรแทนบรรทัดคำอธิบาย
                    (คำว่า "ผ่านแล้ว/รอดำเนินการ" ซ้ำกับสีจุด — ผู้ใช้บอกรก 1 ก.ย.)
                    เหลือวันที่เฉพาะขั้นที่ผ่านล่าสุด · จำนวนขั้นย่อยย่อเป็น ×N */}
                <button
                  onClick={() => setOpenStep(openStep === g.progression ? null : g.progression)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', width: '100%', textAlign: 'left' }}
                >
                  <span className={`tl__title tl__title--${g.state}`}>
                    {first.name}
                    {extra > 0 && <span className="tl__count">×{extra + 1}</span>}
                  </span>
                  {g.hasSelf && <SelfBadge compact />}
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {passedDate && <span className="tl__date">{passedDate}</span>}
                    <span style={{ color: 'var(--text-disabled)', display: 'grid' }}>
                      {expanded ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
                    </span>
                  </span>
                </button>

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
                      {shots.slice(0, 4).map((ph) => (
                        <PhotoSlot key={ph.id} src={ph.dataUrl} alt={ph.stepLabel} filled />
                      ))}
                      <button
                        className="dashed"
                        style={{ width: 52, height: 52, display: 'grid', placeItems: 'center', color: 'var(--accent)' }}
                        onClick={attach.open}
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
