import { CalendarBlank, CameraPlus, CheckCircle, HandTap, ImageSquare } from '@phosphor-icons/react';
import { advanceStep } from '../../data/repo';
import { TYPES } from '../../domain/catalog';
import { caseCount, nextProc } from '../../domain/rules';
import { useApp } from '../../store/app';
import { useWorkpiece, useWorkpieces } from '../../hooks/data';
import { thaiShort } from '../../lib/date';

export function ConfirmSheet() {
  const { sheet, closeSheet, patchSheet, offline, showToast, session, settings, touch } = useApp();
  const w = useWorkpiece(sheet?.workpieceId);
  const all = useWorkpieces(session?.studentId);
  if (!sheet || !w) return null;

  const next = nextProc(w);
  if (!next) return null;
  const meta = TYPES[w.type];

  async function confirm() {
    if (!sheet || !w || !next) return;
    const res = await advanceStep({
      workpieceId: w.id,
      performedAt: sheet.performedAt,
      withPhoto: sheet.withPhoto,
      offline,
      actor: 'นศ. ก',
    });
    closeSheet();
    touch();
    if (!res) return;

    if (res.queued) {
      showToast({ message: 'บันทึกในเครื่อง · รอ sync เมื่อมีสัญญาณ', tone: 'warning', undoWorkpieceId: w.id });
    } else if (res.completedCase && w.minimumRequirement) {
      // ชิ้นนี้เพิ่งจบเคส — บอกว่าไปถึงไหนของเกณฑ์แล้ว
      const after = all.map((x) => (x.id === w.id ? { ...x, procIndex: res.workpiece.procIndex, completedAt: new Date().toISOString() } : x));
      const rows = caseCount(after, settings);
      const row =
        w.type === 'CB' || w.type === 'PC'
          ? rows.find((r) => r.group === 'CROWN')
          : rows.find((r) => r.group === w.type);

      if (!row) {
        showToast({ message: `จบเคสแล้ว · ${res.label}`, tone: 'success', undoWorkpieceId: w.id });
      } else if (row.group === 'CROWN' && row.done >= row.required && row.postCoreComplete === false) {
        showToast({
          message: `Crown/Bridge ครบ ${row.done}/${row.required} แล้ว — แต่ยังต้องเป็น Post-core อีก ${(row.postCoreRequired ?? 0) - (row.postCoreDone ?? 0)} ชิ้น`,
          tone: 'warning',
          undoWorkpieceId: w.id,
        });
      } else if (row.complete) {
        showToast({ message: `ครบ ${row.label} ตามเกณฑ์แล้ว (${row.done}/${row.required})`, tone: 'success', undoWorkpieceId: w.id });
      } else {
        showToast({
          message: `จบเคสแล้ว · ${row.label} ${row.done}/${row.required}`,
          tone: 'success',
          undoWorkpieceId: w.id,
        });
      }
    } else {
      showToast({ message: `บันทึกแล้ว · ${res.label}`, tone: 'default', undoWorkpieceId: w.id });
    }
  }

  return (
    <div className="backdrop" onClick={closeSheet}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <h3 className="h3">ทำขั้นนี้เสร็จแล้ว?</h3>
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
            step นี้ต้องทำเอง (self-performed)
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <label className="field" style={{ flex: 1 }}>
            <span style={{ font: '600 11.5px var(--font-body)', color: 'var(--text-secondary)' }}>
              วันที่ทำ <span className="faint mono" style={{ fontWeight: 400 }}>· {thaiShort(sheet.performedAt)}</span>
            </span>
            <span style={{ position: 'relative', display: 'block' }}>
              <input
                className="input mono"
                type="date"
                value={sheet.performedAt}
                onChange={(e) => patchSheet({ performedAt: e.target.value })}
                style={{ paddingRight: 34 }}
              />
              <CalendarBlank
                size={16}
                style={{ position: 'absolute', right: 11, top: 14, color: 'var(--text-faint)', pointerEvents: 'none' }}
              />
            </span>
          </label>
          <button
            type="button"
            className="dashed"
            onClick={() => patchSheet({ withPhoto: !sheet.withPhoto })}
            style={{
              width: 104, marginTop: 22, height: 44, display: 'grid', placeItems: 'center', gap: 2,
              borderColor: sheet.withPhoto ? 'var(--accent)' : undefined,
              background: sheet.withPhoto ? 'var(--accent-tint)' : undefined,
              color: sheet.withPhoto ? 'var(--accent)' : 'var(--text-muted)',
              font: '600 11px var(--font-body)',
            }}
          >
            {sheet.withPhoto ? <ImageSquare size={17} weight="fill" /> : <CameraPlus size={17} />}
            {sheet.withPhoto ? 'แนบแล้ว 1 รูป' : 'แนบรูป'}
          </button>
        </div>

        <p style={{ margin: '9px 0 0', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
          แนบภายหลังได้
        </p>

        <button className="btn" style={{ height: 56, marginTop: 14 }} onClick={confirm}>
          <CheckCircle size={19} weight="fill" />
          ใช่ · บันทึกเลย
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 4 }} onClick={closeSheet}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
