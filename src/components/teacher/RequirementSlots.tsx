import { Check, SealCheck, WarningCircle, X } from '@phosphor-icons/react';
import {
  caseCount, completedInYear, countsForYearlyReq, countsTowardRequirement, isActiveWork, maxProgression,
  mayCountTowardRequirement, progression, gateRows, GATE_KEYS, reqGroupOf, type ReqGroup, type ReqPart,
} from '../../domain/rules';
import { ReqParts } from '../ReqParts';
import type { GateKey, Settings, Student, Workpiece } from '../../domain/types';
import { academicYear } from '../../lib/date';
import { t } from '../../lib/i18n';

interface Slot {
  state: 'done' | 'active' | 'empty';
  label: string;
  title: string;
}

/** เรียงเคสที่จบแล้วขึ้นก่อน แล้วตามด้วยเคสที่เดินหน้ามากที่สุด — ให้เห็นว่าช่องที่เหลือจะถูกเติมด้วยอะไร
 *  ช่อง "กำลังทำ" รับเฉพาะเคสที่จบแล้วจะนับจริง (ไม่เอาเคสที่ปิดสวิตช์นับเกณฑ์ / คืนแล้ว) */
function slotsFor(pieces: Workpiece[], required: number, done = pieces.filter(countsTowardRequirement), canFill = mayCountTowardRequirement): Slot[] {
  const active = pieces
    .filter((w) => isActiveWork(w) && canFill(w))
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

function Row({ title, color, slots, note, parts, complete }: {
  title: string; color: string; slots: Slot[]; note?: string; parts?: ReqPart[];
  /** ครบเกณฑ์จริง — ช่องเต็มแต่ขาดชนิดที่บังคับ (Post-core · Co-Cr) ยังไม่ขึ้นเขียว */
  complete?: boolean;
}) {
  const done = slots.filter((s) => s.state === 'done').length;
  const ok = complete ?? done >= slots.length;
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--divider)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: color, flex: 'none' }} />
        <span style={{ flex: 1, font: '600 11.5px var(--font-body)' }}>{title}</span>
        <span
          className="mono"
          style={{ font: '600 11px var(--font-mono)', color: ok ? 'var(--success)' : 'var(--text-muted)' }}
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
      {parts && <ReqParts parts={parts} />}
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
export function RequirementSlots({
  works, settings, student, onToggleGate,
}: {
  works: Workpiece[];
  settings: Settings;
  /** ใส่มาเมื่ออยากให้แสดงข้อกำหนด Sect II / Design RPD (ข้อมูลรายคน) */
  student?: Student;
  /** ใส่มา = อาจารย์กดสลับผ่าน/ยังไม่ผ่านได้ (ไม่ใส่ = อ่านอย่างเดียว) */
  onToggleGate?: (key: GateKey, value: boolean) => void;
}) {
  const rows = caseCount(works, settings);
  const inGroup = (g: ReqGroup) => works.filter((w) => reqGroupOf(w.type) === g);
  /* ชนิดที่บังคับแต่ยังไม่ครบ (Post-core · Co-Cr) — ใช้ทำบรรทัดสรุปท้ายการ์ด */
  const missingPieces = rows.reduce((n, r) => n + Math.max(0, r.required - r.done), 0);
  const mustMissing = rows.flatMap((r) => (r.must && !r.must.complete ? [{ label: r.must.label, n: r.must.required - r.must.done }] : []));
  const year = academicYear(new Date());
  const doneThisYear = completedInYear(works, year, settings);
  const gates = student ? gateRows(student.gates) : [];
  const gateMissing = gates.filter((g) => g.value !== true).length;
  const allDone = rows.every((r) => r.complete) && (!student || gateMissing === 0);

  const yearSlots = slotsFor(works, settings.req.perYear, doneThisYear, (w) => countsForYearlyReq(w, settings));

  return (
    <div>
      {/* แถวเกณฑ์สะสมสร้างจาก caseCount ตัวเดียวกับหน้าเกณฑ์ฝั่งนักศึกษา — ช่องนับรวม ใต้ช่องแยกชนิดงาน */}
      {rows.map((r) => (
        <Row
          key={r.group}
          title={t(r.label)}
          color={r.color}
          slots={slotsFor(inGroup(r.group), r.required)}
          parts={r.parts}
          complete={r.complete}
        />
      ))}
      <Row
        title={`เกณฑ์รายปี · ปีการศึกษา ${year}`}
        color="var(--accent)"
        slots={yearSlots}
        note={`จบไปแล้ว ${doneThisYear.length} จาก ${settings.req.perYear} ชิ้นที่ต้องจบในปีนี้`}
      />

      {/* ข้อกำหนดที่ไม่ใช่ชิ้นงาน — ชีตเก็บเป็นคอลัมน์รายคน (Sect II Removable/Fixed · Design RPD)
          กรอกแล้ว 86/88 คนในชีตรุ่น 54 แต่แอปไม่เคยอ่าน → แถบ "ครบเกณฑ์" เดิมจึงยังไม่ครบจริง */}
      {student && (
        <div style={{ padding: '10px 0', borderBottom: '1px solid var(--divider)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--text-muted)', flex: 'none' }} />
            <span style={{ flex: 1, font: '600 11.5px var(--font-body)' }}>{t('ข้อกำหนดก่อนจบ (ไม่ใช่ชิ้นงาน)')}</span>
            <span
              className="mono"
              style={{ font: '600 11px var(--font-mono)', color: gateMissing === 0 ? 'var(--success)' : 'var(--text-muted)' }}
            >
              {GATE_KEYS.length - gateMissing}/{GATE_KEYS.length}
            </span>
          </div>
          <div className="slots">
            {gates.map((g) => {
              const state = g.value === true ? 'done' : g.value === false ? 'no' : 'empty';
              const title = `${g.label} · ${g.value === true ? t('ผ่านแล้ว') : g.value === false ? t('ยังไม่ผ่าน') : t('ยังไม่มีข้อมูล')}`;
              const body = (
                <>
                  {g.value === true && <Check size={13} weight="bold" />}
                  {g.value === false && <X size={12} weight="bold" />}
                  <span style={{ font: '600 9px var(--font-body)', lineHeight: 1.1, textAlign: 'center' }}>{g.label.replace('Sect II Tx. plan · ', '')}</span>
                </>
              );
              return onToggleGate ? (
                <button
                  key={g.key}
                  type="button"
                  className="slots__box slots__box--btn"
                  data-state={state}
                  title={`${title} — ${t('กดเพื่อสลับ')}`}
                  style={{ '--slot': 'var(--success)' } as never}
                  onClick={() => onToggleGate(g.key, g.value !== true)}
                >
                  {body}
                </button>
              ) : (
                <span key={g.key} className="slots__box" data-state={state} title={title} style={{ '--slot': 'var(--success)' } as never}>
                  {body}
                </span>
              );
            })}
          </div>
          <div style={{ font: '400 10px/1.5 var(--font-body)', color: 'var(--text-muted)', marginTop: 6 }}>
            {onToggleGate ? t('อาจารย์ที่ปรึกษาเป็นผู้ยืนยัน — ค่าตั้งต้นมาจากชีต กดช่องเพื่อแก้ได้') : t('อาจารย์ที่ปรึกษาเป็นผู้ยืนยัน — ค่าตั้งต้นมาจากชีต')}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 12, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8,
          background: allDone ? 'var(--success-tint)' : 'var(--fill)',
        }}
      >
        <span style={{ flex: 'none', display: 'grid', marginTop: 1 }}>
          {allDone ? (
            <SealCheck size={15} weight="fill" color="var(--success)" />
          ) : (
            <WarningCircle size={15} weight="fill" color="var(--text-faint)" />
          )}
        </span>
        <span className="pretty" style={{ font: '500 10.5px/1.6 var(--font-body)', color: 'var(--text-secondary)' }}>
          {allDone
            ? t('ครบเกณฑ์สะสมทุกด้านแล้ว')
            : [
                missingPieces > 0 ? t('ยังขาด {n} ชิ้นสำหรับเกณฑ์สะสม', { n: missingPieces }) : '',
                /* ชิ้นครบแล้วแต่ยังไม่มีชนิดที่บังคับ — เดิมขึ้น "ยังขาด 0 ชิ้น และต้องมี Post-core อีก 1 ชิ้น" */
                ...mustMissing.map((m) => t('ต้องมี {f} อีก {n} ชิ้น', { f: m.label, n: Math.max(1, m.n) })),
                student && gateMissing > 0 ? t('ข้อกำหนด Sect II / Design RPD ยังไม่ผ่านอีก {n} ข้อ', { n: gateMissing }) : '',
              ].filter(Boolean).join(' · ')}
        </span>
      </div>
    </div>
  );
}
