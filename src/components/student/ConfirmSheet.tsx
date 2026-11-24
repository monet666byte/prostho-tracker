import { CalendarBlank, CameraPlus, CheckCircle, CircleHalf, HandTap, ImageSquare } from '@phosphor-icons/react';
import { advanceStep, markStepInProgress } from '../../data/repo';
import { useWipFeature } from '../../data/wipFeature';
import { recordStepLabel } from './stepLabel';
import { typeMeta, workLabel } from '../../domain/catalog';
import { caseCount, completionImpact, nextProc, reqGroupOf } from '../../domain/rules';
import { currentActor, useApp } from '../../store/app';
import { useCheckIns, usePatientNamesOn, useWorkpiece, useWorkpieces, useWorkpiecePhotos } from '../../hooks/data';
import { patientTitle } from '../../lib/privacy';
import { CelebrateSheet, celebrate } from './CelebrateSheet';
import { usePhotoAttach } from './usePhotoAttach';
import { thaiShort, toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
import { tapFeedback } from '../../lib/haptic';

/** แผ่นยืนยันผ่าน step + แผ่นฉลองตอนปิดเคส (โผล่หลังแผ่นยืนยันปิดไปแล้ว) */
export function ConfirmSheet() {
  return (
    <>
      <ConfirmStepSheet />
      <CelebrateSheet />
    </>
  );
}

function ConfirmStepSheet() {
  const namesOn = usePatientNamesOn();
  const { sheet, closeSheet, patchSheet, offline, showToast, session, settings, touch } = useApp();
  const w = useWorkpiece(sheet?.workpieceId);
  const all = useWorkpieces(session?.studentId);
  /**
   * ปุ่ม "แนบรูป" เดิมแค่สลับธง แล้วขึ้นว่า "แนบแล้ว 1 รูป" โดยไม่มีรูปจริงสักใบ
   * (advanceStep จะสร้างแถวรูปเปล่าพร้อมขนาดไฟล์ที่สุ่มขึ้นมาให้ด้วย)
   * ตอนนี้เปิดตัวเลือกไฟล์จริง และนับจากรูปที่มีอยู่จริงของชิ้นงานนี้
   */
  const attach = usePhotoAttach(sheet?.workpieceId);
  const shots = useWorkpiecePhotos(sheet?.workpieceId);
  /* "ยังไม่เสร็จ" จดลงคาบของวันที่เลือก — ต้องมีคาบวันนั้นก่อน · เซิร์ฟเวอร์ยังไม่รัน 0035 = ไม่มีตัวเลือกนี้ */
  const wipOn = useWipFeature();
  const checkins = useCheckIns(session?.studentId);
  if (!sheet || !w) return null;

  const next = nextProc(w);
  if (!next) return null;
  const meta = typeMeta(w.type);
  const period = checkins.find((c) => c.date === sheet.performedAt);
  // เปลี่ยนวันที่ไปวันที่ไม่มีคาบ = กลับเป็น "เสร็จแล้ว" เอง (ปุ่มยังไม่เสร็จกดไม่ได้อยู่แล้ว)
  const wip = wipOn && sheet.mode === 'wip' && !!period;
  const isToday = sheet.performedAt === toISODate(new Date());

  async function confirmWip() {
    if (!sheet || !w || !next) return;
    tapFeedback();
    const res = await markStepInProgress({
      workpieceId: w.id, date: sheet.performedAt, note: sheet.note, actor: currentActor(),
    });
    if (!res.ok) {
      showToast({
        message: res.reason === 'no-checkin'
          ? t('ยังไม่ได้เช็คอินวันที่ {d} — เช็คอินก่อนถึงบันทึกว่าทำวันนั้นได้', { d: thaiShort(sheet.performedAt) })
          : t('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'),
        tone: 'warning',
      });
      return;
    }
    closeSheet();
    touch();
    showToast({
      message: t('บันทึกแล้ว · {s} ทำต่อคาบหน้า', { s: next.name }),
      tone: 'default',
      undoWip: { checkinId: res.checkinId, workpieceId: w.id },
    });
  }

  async function confirm() {
    if (!sheet || !w || !next) return;
    tapFeedback();
    const res = await advanceStep({
      workpieceId: w.id,
      performedAt: sheet.performedAt,
      withPhoto: shots.length > 0,
      offline,
      actor: currentActor(),
    });
    closeSheet();
    touch();
    if (!res) return;

    if (res.queued) {
      showToast({ message: t('บันทึกในเครื่อง · รอ sync เมื่อมีสัญญาณ'), tone: 'warning', undoWorkpieceId: w.id });
    } else if (res.completedCase && w.minimumRequirement) {
      // ชิ้นนี้เพิ่งจบเคส — บอกว่าไปถึงไหนของเกณฑ์แล้ว
      const after = all.map((x) => (x.id === w.id ? { ...x, procIndex: res.workpiece.procIndex, completedAt: new Date().toISOString() } : x));
      const rows = caseCount(after, settings);
      const closed = after.find((x) => x.id === w.id) ?? w;
      celebrate({
        who: `${patientTitle(w.patient, namesOn, t)} · ${workLabel(w)}${w.arch ? ` · ${w.arch === 'upper' ? 'Upper' : 'Lower'}` : w.tooth ? ` · ${t('ซี่')} ${w.tooth}` : ''}`,
        impact: completionImpact(all, after, closed, settings),
        years: settings.req.years,
      });
      const group = reqGroupOf(w.type);
      const row = group ? rows.find((r) => r.group === group) : undefined;

      if (!row) {
        showToast({ message: `${t('จบเคสแล้ว')} · ${res.label}`, tone: 'success', undoWorkpieceId: w.id });
      } else if (row.done >= row.required && row.must && !row.must.complete) {
        // ชิ้นครบแล้วแต่ยังไม่มีชนิดที่บังคับ — Crown ขาด Post-core · RPD ขาด Co-Cr
        showToast({
          message: t('{l} ครบ {a}/{b} แล้ว — แต่ยังต้องเป็น {f} อีก {n} ชิ้น', { l: row.short, a: row.done, b: row.required, f: row.must.label, n: row.must.required - row.must.done }),
          tone: 'warning',
          undoWorkpieceId: w.id,
        });
      } else if (row.complete) {
        showToast({ message: t('ครบ {l} ตามเกณฑ์แล้ว ({a}/{b})', { l: t(row.label), a: row.done, b: row.required }), tone: 'success', undoWorkpieceId: w.id });
      } else {
        showToast({
          message: `${t('จบเคสแล้ว')} · ${t(row.label)} ${row.done}/${row.required}`,
          tone: 'success',
          undoWorkpieceId: w.id,
        });
      }
    } else {
      showToast({ message: `${t('บันทึกแล้ว')} · ${res.label}`, tone: 'default', undoWorkpieceId: w.id });
    }
  }

  return (
    <div className="backdrop" onClick={closeSheet}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {wipOn ? (
          <>
            <h3 className="h3">{next.name}</h3>
            <p style={{ margin: '5px 0 0', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
              {meta.full} · {patientTitle(w.patient, namesOn, t)}
            </p>
            {/* ปุ่มรองซ้าย ปุ่มหลักขวา — ลำดับเดียวกับปุ่มบนการ์ดน้ำเงินหน้าแรก */}
            <div className="stepchoice" role="radiogroup" aria-label={t('ผลของ step นี้')}>
              <button
                type="button" role="radio" aria-checked={wip}
                className="stepchoice__opt" data-on={wip}
                disabled={!period}
                onClick={() => patchSheet({ mode: 'wip' })}
              >
                <span className="stepchoice__h"><CircleHalf size={16} weight="fill" />{t('ยังไม่เสร็จ')}</span>
                <span className="stepchoice__s">{t('คาบหน้าทำต่อ')}</span>
              </button>
              <button
                type="button" role="radio" aria-checked={!wip}
                className="stepchoice__opt" data-on={!wip}
                onClick={() => patchSheet({ mode: 'done' })}
              >
                <span className="stepchoice__h"><CheckCircle size={16} weight="fill" />{t('เสร็จแล้ว')}</span>
                <span className="stepchoice__s">{t('ขยับไป step ถัดไป')}</span>
              </button>
            </div>
            {!period && (
              <p style={{ margin: '7px 0 0', font: '400 11px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
                {t('"ยังไม่เสร็จ" ใช้ได้เมื่อเช็คอินคาบวันที่ {d} แล้ว', { d: thaiShort(sheet.performedAt) })}
              </p>
            )}
          </>
        ) : (
          <>
            <h3 className="h3">{t('ทำขั้นนี้เสร็จแล้ว?')}</h3>
            <p style={{ margin: '5px 0 0', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
              {meta.full} · <span className="mono">{next.name}</span>
            </p>
          </>
        )}

        {wip && (
          <label className="field" style={{ marginTop: 14 }}>
            <span style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)' }}>{t('ทำถึงไหน (ไม่บังคับ)')}</span>
            <textarea
              className="input"
              rows={2}
              maxLength={200}
              value={sheet.note ?? ''}
              onChange={(e) => patchSheet({ note: e.target.value })}
              placeholder={t('เช่น เรียงฟันหลังซ้ายแล้ว เหลือขวา')}
              style={{ height: 'auto', minHeight: 64, paddingTop: 10, resize: 'none' }}
            />
          </label>
        )}

        {next.selfPerformed && (
          <div
            style={{
              marginTop: 12, background: 'var(--self-tint)', color: 'var(--self)', borderRadius: 12,
              padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center',
              font: '500 11.5px/1.5 var(--font-body)',
            }}
          >
            <HandTap size={17} weight="fill" style={{ flex: 'none' }} />
            {t('step นี้ต้องทำเอง (self-performed)')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <label className="field" style={{ flex: 1 }}>
            <span style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)' }}>
              {t('วันที่ทำ')} <span className="faint mono" style={{ fontWeight: 400 }}>· {thaiShort(sheet.performedAt)}</span>
            </span>
            <span style={{ position: 'relative', display: 'block' }}>
              <input
                className="input mono"
                type="date"
                value={sheet.performedAt}
                max={toISODate(new Date())}
                onChange={(e) => patchSheet({ performedAt: e.target.value })}
                style={{ paddingRight: 34 }}
              />
              <CalendarBlank
                size={16}
                style={{ position: 'absolute', right: 11, top: 14, color: 'var(--text-faint)', pointerEvents: 'none' }}
              />
            </span>
          </label>
          {/* "ยังไม่เสร็จ" ไม่มีแถว step ให้รูปผูก — ซ่อนปุ่มแนบรูป ไม่งั้นแนบแล้วรูปหายเงียบ */}
          {!wip && attach.input}
          {!wip && <button
            type="button"
            className="dashed"
            disabled={attach.busy}
            onClick={attach.open}
            style={{
              width: 104, marginTop: 22, height: 44, display: 'grid', placeItems: 'center', gap: 2,
              borderColor: shots.length ? 'var(--accent)' : undefined,
              background: shots.length ? 'var(--accent-tint)' : undefined,
              color: shots.length ? 'var(--accent)' : 'var(--text-muted)',
              font: '600 11px var(--font-body)',
            }}
          >
            {shots.length ? <ImageSquare size={17} weight="fill" /> : <CameraPlus size={17} />}
            {attach.busy ? t('กำลังย่อรูป…') : shots.length ? t('แนบแล้ว {n} รูป', { n: shots.length }) : t('แนบรูป')}
          </button>}
        </div>

        {!wip && (
          <p style={{ margin: '9px 0 0', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
            {t('แนบภายหลังได้')}
          </p>
        )}

        {wip ? (
          <button className="btn btn--sec stepchoice__wipbtn" style={{ height: 56, marginTop: 14 }} onClick={confirmWip}>
            <CircleHalf size={19} weight="fill" />
            {isToday ? t('บันทึกว่าทำวันนี้') : t('บันทึกว่าทำวันที่ {d}', { d: thaiShort(sheet.performedAt) })}
          </button>
        ) : (
          <button className="btn" style={{ height: 56, marginTop: 14 }} onClick={confirm}>
            <CheckCircle size={19} weight="fill" />
            {wipOn ? recordStepLabel(next.name) : t('ใช่ · บันทึกเลย')}
          </button>
        )}
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={closeSheet}>
          {t('ยกเลิก')}
        </button>
      </div>
    </div>
  );
}
