import { ArrowLeft, CameraPlus, Check, CheckCircle, Circle, CircleDashed, Images, SealCheck } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, PendingBadge, PhotoSlot, SelfBadge } from '../../components/ui/Bits';
import { ConfirmSheet } from '../../components/student/ConfirmSheet';
import { PlainShell } from '../../components/student/Shell';
import { usePhotoAttach } from '../../components/student/usePhotoAttach';
import { typeMeta } from '../../domain/catalog';
import {
  maxProgression, nextProc, progression, stepGroups, isReturned, stepFraction } from '../../domain/rules';
import { useLastStepDate, usePatientNamesOn, usePending, usePhotoSrc, useWorkpiece, useWorkpiecePhotos } from '../../hooks/data';
import { patientTitle } from '../../lib/privacy';
import { setWorkpieceReturned } from '../../data/repo';
import { thaiShort } from '../../lib/date';
import { t, tSexAge } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';

export default function WorkpieceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const w = useWorkpiece(id);
  const namesOn = usePatientNamesOn();
  const pending = usePending();
  const { openSheet, showToast, touch } = useApp();
  // step ที่ผู้ใช้กดกางดูเอง (นอกเหนือจาก step ที่กำลังทำซึ่งกางอยู่แล้ว)
  const [openStep, setOpenStep] = useState<number | null>(null);
  // ต้องเรียกก่อน early return ด้านล่าง — กฎของ hook
  const attach = usePhotoAttach(id);
  const shots = useWorkpiecePhotos(id);
  const shotSrcs = usePhotoSrc(shots);

  /* คืนเคส — เคสที่คนไข้ไม่มาต่อ/ยกเลิก นักศึกษากดเองได้
     ⚠️ hook ต้องอยู่เหนือ early return ด้านล่าง (กฎของ hook — เคยพลาดตรงนี้จนหน้าเปล่า) */
  const [askReturn, setAskReturn] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const savingReturn = useRef(false);
  const lastStepDate = useLastStepDate(w);

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



  const meta = typeMeta(w.type);
  const groups = stepGroups(w);
  const prog = progression(w);
  const max = maxProgression(w);
  const next = nextProc(w);
  const lastDoneIndex = groups.map((x) => x.state).lastIndexOf('done');

  const footer = (
    <div className="footer">
      {next ? (
        <>
          {/* ตัดบรรทัด "ถัดไป: …" — ซ้ำกับขั้นที่ไฮไลต์บนเส้นทาง (mock 4A) */}
          <button
            className={`btn${next.progression >= max ? ' btn--success' : ''}`}
            style={{ height: 58, borderRadius: 16 }}
            onClick={() => openSheet(w.id)}
          >
            <CheckCircle size={20} weight="fill" />
            {/* ชื่อขั้นสุดท้ายไม่ใช่ "Completion of case" ทุกประเภท — Recall จบที่ "Completion of recall"
                เขียนชื่อขั้นจริงต่อท้าย ปุ่มจะตรงกับบรรทัดที่อยู่เหนือมันเสมอ */}
            {next.progression >= max ? `${t('ปิดเคส')} · ${next.name}` : t('ทำขั้นนี้เสร็จแล้ว')}
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
            <div
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="return-sheet-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grabber" />
              <h3 className="h3" id="return-sheet-title">{t('คืนเคสนี้?')}</h3>
              <p style={{ margin: '4px 0 12px', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                {t('ใช้เมื่อผู้ป่วยไม่มาต่อ / ยกเลิกการรักษา — เคสจะยังอยู่ในรายการแบบขีดฆ่า และไม่ถูกนับเป็นงานที่กำลังทำ · กดกลับมาทำต่อได้ทีหลัง')}
              </p>
              <label className="field">
                <span style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)' }}>{t('เหตุผล (ไม่บังคับ)')}</span>
                {/* ไม่ใส่ autoFocus — บนมือถือคีย์บอร์ดเด้งทันทีแล้วบังคำอธิบาย+ปุ่มยืนยัน ทั้งที่ช่องนี้ไม่บังคับ */}
                <input
                  className="input"
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
          {/* หัวหน้าแบบหน้าแรก: ชื่อผู้ป่วยเป็นหัวเรื่อง
              ชิปประเภท/ขากรรไกร/ซี่ → บรรทัดเทาบรรทัดเดียวพร้อม HN กึ่งหนา · ชิป minimum requirement → ข้อความเขียว
              ตัดหัวข้อ "CD / Complicated APD" ตัวใหญ่ (ซ้ำกับบรรทัดเทา) */}
          <h1 style={{ flex: 1, minWidth: 0, margin: 0, font: '700 20px/1.3 var(--font-head)' }}>{patientTitle(w.patient, namesOn, t)}</h1>
          {/* เคยมีปุ่มเมนู ⋯ ตรงนี้ แต่ไม่เคยผูกอะไรเลย (กดแล้วเงียบ) — เอาออกจนกว่าจะมีเมนูจริง
              การลบชิ้นงานทำได้ที่หน้าคนไข้ (โหมดแก้ไข) */}
        </div>

        <div className="detailmeta">
          <span className="dot" style={{ background: meta.color }} />
          <span>
            {meta.short}
            {w.arch ? ` · ${w.arch === 'upper' ? 'Upper' : 'Lower'}` : ''}
            {w.tooth ? ` · ${t('ซี่')} ${w.tooth}` : ''}
            {w.kennedy ? ` · ${w.kennedy}` : ''}
            {namesOn ? <>{' · '}<b className="herocase__hn">HN {w.patient.hn}</b></> : <>{' · '}{tSexAge(w.patient.sexAge)}</>}
            {' · '}{t('รับเคส')} {thaiShort(w.acceptedDate)}
          </span>
        </div>
        {(w.minimumRequirement || pending.has(w.id)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
            {w.minimumRequirement && (
              <span style={{ font: '500 12.5px var(--font-body)', color: 'var(--success-dark)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <SealCheck size={13} weight="fill" /> {t('นับ minimum requirement')}
              </span>
            )}
            {pending.has(w.id) && <PendingBadge />}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <Bar value={stepFraction(w) * 100} color={meta.color} height={8} />
          <span style={{ font: '600 12px var(--font-mono)', color: 'var(--text-secondary)', flex: 'none' }}>
            {Math.max(prog, 0)}/{max}
          </span>
        </div>
      </header>

      <div className="tl tl--stagger" style={{ paddingTop: 16 }}>
        {groups.map((g, gi) => {
          const first = g.procs[0];
          const extra = g.procs.length - 1;
          const passedDate = gi === lastDoneIndex && lastStepDate ? thaiShort(lastStepDate) : null;
          const expanded = g.state === 'active' || openStep === g.progression;
          return (
            <div className="tl__item" key={g.progression} style={{ '--i': gi } as React.CSSProperties}>
              <div className="tl__rail">
                <span className={`tl__dot tl__dot--${g.state}`}>
                  {g.state === 'done' ? <Check size={14} weight="bold" /> : g.progression}
                </span>
                {gi < groups.length - 1 && <span className={`tl__line${g.state === 'done' ? ' tl__line--done' : ''}`} />}
              </div>

              <div className="tl__body">
                {/* V1: แถวเดียวจบ — สถานะบอกด้วยสีจุด+น้ำหนักตัวอักษรแทนบรรทัดคำอธิบาย

                    เหลือวันที่เฉพาะขั้นที่ผ่านล่าสุด · จำนวนขั้นย่อยย่อเป็น ×N */}
                <button
                  aria-expanded={expanded}
                  onClick={() => setOpenStep(openStep === g.progression ? null : g.progression)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', width: '100%', textAlign: 'left' }}
                >
                  <span className={`tl__title tl__title--${g.state}`}>
                    {first.name}
                    {extra > 0 && <span className="tl__count">×{extra + 1}</span>}
                  </span>
                  {/* ชิปม่วง "ทำเอง" → ตัวอักษรม่วงเล็ก · ตัดลูกศรท้ายแถว (แตะแถวยังกางขั้นย่อยได้) */}
                  {g.hasSelf && <span className="tl__self">{t('ทำเอง')}</span>}
                  {passedDate && <span className="tl__date" style={{ marginLeft: 'auto' }}>{passedDate}</span>}
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
                        <PhotoSlot key={ph.id} src={shotSrcs.get(ph.id)} alt={ph.stepLabel} filled />
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
