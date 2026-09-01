import { CalendarBlank, CameraPlus, CheckCircle, HandTap, ImageSquare } from '@phosphor-icons/react';
import { advanceStep } from '../../data/repo';
import { TYPES } from '../../domain/catalog';
import { caseCount, nextProc } from '../../domain/rules';
import { currentActor, useApp } from '../../store/app';
import { useWorkpiece, useWorkpieces, useWorkpiecePhotos } from '../../hooks/data';
import { usePhotoAttach } from './usePhotoAttach';
import { thaiShort, toISODate } from '../../lib/date';
import { t } from '../../lib/i18n';
import { tapFeedback } from '../../lib/haptic';

export function ConfirmSheet() {
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
  if (!sheet || !w) return null;

  const next = nextProc(w);
  if (!next) return null;
  const meta = TYPES[w.type];

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
      const row =
        w.type === 'CB' || w.type === 'PC'
          ? rows.find((r) => r.group === 'CROWN')
          : rows.find((r) => r.group === w.type);

      if (!row) {
        showToast({ message: `${t('จบเคสแล้ว')} · ${res.label}`, tone: 'success', undoWorkpieceId: w.id });
      } else if (row.group === 'CROWN' && row.done >= row.required && row.postCoreComplete === false) {
        showToast({
          message: t('Crown/Bridge ครบ {a}/{b} แล้ว — แต่ยังต้องเป็น Post-core อีก {n} ชิ้น', { a: row.done, b: row.required, n: (row.postCoreRequired ?? 0) - (row.postCoreDone ?? 0) }),
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
        <h3 className="h3">{t('ทำขั้นนี้เสร็จแล้ว?')}</h3>
        <p style={{ margin: '5px 0 0', font: '400 12px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
          {meta.full} · <span className="mono">{next.name}</span>
        </p>

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
          {attach.input}
          <button
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
          </button>
        </div>

        <p style={{ margin: '9px 0 0', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('แนบภายหลังได้')}
        </p>

        <button className="btn" style={{ height: 56, marginTop: 14 }} onClick={confirm}>
          <CheckCircle size={19} weight="fill" />
          {t('ใช่ · บันทึกเลย')}
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={closeSheet}>
          {t('ยกเลิก')}
        </button>
      </div>
    </div>
  );
}
