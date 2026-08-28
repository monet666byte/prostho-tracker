import { Check, SealCheck, WarningCircle } from '@phosphor-icons/react';
import { TYPES } from '../../domain/catalog';
import {
  caseCount, completedInYear, countsTowardRequirement, isComplete, maxProgression, progression,
} from '../../domain/rules';
import type { Settings, Workpiece } from '../../domain/types';
import { academicYear } from '../../lib/date';
import { t } from '../../lib/i18n';

interface Slot {
  state: 'done' | 'active' | 'empty';
  label: string;
  title: string;
}

/** เรียงเคสที่จบแล้วขึ้นก่อน แล้วตามด้วยเคสที่เดินหน้ามากที่สุด — ให้เห็นว่าช่องที่เหลือจะถูกเติมด้วยอะไร */
function slotsFor(pieces: Workpiece[], required: number): Slot[] {
  const done = pieces.filter(countsTowardRequirement);
  const active = pieces
    .filter((w) => !isComplete(w))
    .sort((a, b) => progression(b) - progression(a));

  return Array.from({ length: Math.max(required, 1) }, (_, i) => {
    if (i < done.length) {
      return { state: 'done' as const, label: '', title: `${t('จบเคสแล้ว')} · ${done[i].detail}` };
    }
    const candidate = active[i - done.length];
    if (candidate) {
      const p = Math.max(0, progression(candidate));
      return {
        state: 'active' as const,
        label: `${p}/${maxProgression(candidate)}`,
        title: `กำลังทำ · ${candidate.detail} · step ${p}`,
      };
    }
    return { state: 'empty' as const, label: '', title: t('ยังไม่มีเคสในช่องนี้') };
  });
}

function Row({ title, color, slots, note }: { title: string; color: string; slots: Slot[]; note?: string }) {
  const done = slots.filter((s) => s.state === 'done').length;
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--divider)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: color, flex: 'none' }} />
        <span style={{ flex: 1, font: '600 11.5px var(--font-body)' }}>{title}</span>
        <span
          className="mono"
          style={{ font: '600 11px var(--font-mono)', color: done >= slots.length ? 'var(--success)' : 'var(--text-muted)' }}
        >
          {done}/{slots.length}
        </span>
      </div>
      <div className="slots">
        {slots.map((s, i) => (
          <span key={i} className="slots__box" data-state={s.state} title={s.title} style={{ '--slot': color } as never}>
            {s.state === 'done' && <Check size={13} weight="bold" />}
            {s.state === 'active' && <span className="mono">{s.label}</span>}
          </span>
        ))}
      </div>
      {note && (
        <div style={{ font: '400 10px/1.5 var(--font-body)', color: 'var(--text-muted)', marginTop: 6 }}>{note}</div>
      )}
    </div>
  );
}

/**
 * แสดงเกณฑ์เป็นช่องทีละเคส แทนกราฟ
 * เพราะเกณฑ์จริงเป็นหลักหน่วย (CD 1 · RPD 2 · Crown 2) การวาดเป็น % จะดูเหมือนมีข้อมูลละเอียด
 * ทั้งที่ค่าที่เป็นไปได้มีแค่ 0 / 50 / 100 — ช่องทีละเคสบอกตรงกว่าและชี้ได้ว่าต้องคุยเรื่องไหน
 */
export function RequirementSlots({ works, settings }: { works: Workpiece[]; settings: Settings }) {
  const rows = caseCount(works, settings);
  const crown = rows.find((r) => r.group === 'CROWN')!;
  const year = academicYear(new Date());
  const doneThisYear = completedInYear(works, year, settings);

  const yearSlots = slotsFor(
    [...doneThisYear, ...works.filter((w) => !isComplete(w))],
    settings.req.perYear,
  );

  return (
    <div>
      <Row
        title={TYPES.CD.full}
        color={TYPES.CD.color}
        slots={slotsFor(works.filter((w) => w.type === 'CD'), settings.req.cd)}
      />
      <Row
        title={TYPES.RPD.full}
        color={TYPES.RPD.color}
        slots={slotsFor(works.filter((w) => w.type === 'RPD'), settings.req.rpd)}
      />
      <Row
        title={t('Crown / Bridge (รวม Post-core)')}
        color={TYPES.CB.color}
        slots={slotsFor(works.filter((w) => w.type === 'CB' || w.type === 'PC'), settings.req.crown)}
        note={
          crown.postCoreComplete
            ? `Post-core ครบ ${crown.postCoreDone}/${crown.postCoreRequired} แล้ว`
            : `ในช่องด้านบนต้องเป็น Post-core อย่างน้อย ${crown.postCoreRequired} ชิ้น — ตอนนี้ ${crown.postCoreDone}`
        }
      />
      <Row
        title={`เกณฑ์รายปี · ปีการศึกษา ${year}`}
        color="var(--accent)"
        slots={yearSlots}
        note={`จบไปแล้ว ${doneThisYear.length} จาก ${settings.req.perYear} ชิ้นที่ต้องจบในปีนี้`}
      />

      <div
        style={{
          marginTop: 12, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8,
          background: rows.every((r) => r.complete) ? 'var(--success-tint)' : 'var(--fill)',
        }}
      >
        <span style={{ flex: 'none', display: 'grid', marginTop: 1 }}>
          {rows.every((r) => r.complete) ? (
            <SealCheck size={15} weight="fill" color="var(--success)" />
          ) : (
            <WarningCircle size={15} weight="fill" color="var(--text-faint)" />
          )}
        </span>
        <span className="pretty" style={{ font: '500 10.5px/1.6 var(--font-body)', color: 'var(--text-secondary)' }}>
          {rows.every((r) => r.complete)
            ? t('ครบเกณฑ์สะสมทุกด้านแล้ว')
            : t('ยังขาด {n} ชิ้นสำหรับเกณฑ์สะสม', { n: rows.reduce((n, r) => n + Math.max(0, r.required - r.done), 0) }) +
              (crown.postCoreComplete ? '' : t(' และต้องมี Post-core อีก 1 ชิ้น'))}
        </span>
      </div>
    </div>
  );
}
