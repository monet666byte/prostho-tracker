import { useMemo, useState } from 'react';
import { boardByStep } from '../../domain/analytics';
import { countByKind } from '../../domain/aggregate';
import { KINDS, kindOf, kindsPresent, type WorkKind } from '../../domain/catalog';
import { isActiveWork } from '../../domain/rules';
import type { CheckIn, Settings, Student, Workpiece } from '../../domain/types';
import { personName, t, tText } from '../../lib/i18n';

/**
 * กระดานเคสตาม step — มุมมองที่สองของหน้าสรุปกลุ่ม (คู่กับตาราง)
 * 1 การ์ด = ชิ้นงานที่กำลังทำ 1 ชิ้น · คอลัมน์ = step · นับจาก boardByStep (ตัวเดียวกับกราฟคอขวด)
 * คอลัมน์ที่ไม่มีการ์ดหดเหลือแถบแคบ · คอลัมน์ที่กองมากสุดมีพื้นส้มอ่อน
 */
export function CaseBoard({ works, students, checkins, settings, onOpen }: {
  works: Workpiece[];
  students: Student[];
  checkins: CheckIn[];
  settings: Settings;
  onOpen: (s: Student) => void;
}) {
  const active = useMemo(() => works.filter(isActiveWork), [works]);
  /* ปุ่มเลือกตามชนิดงาน (CD แยก Complicated APD) — ขั้นตอนเหมือนกัน กรองชิ้นก่อนแล้วส่ง WorkType ไปหาคอลัมน์ */
  const types = kindsPresent(active);
  const counts = useMemo(() => countByKind(active), [active]);
  const [picked, setPicked] = useState<WorkKind | null>(null);
  const type = picked && types.includes(picked) ? picked : types[0];
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const cols = useMemo(
    () => (type ? boardByStep(works.filter((w) => kindOf(w) === type), settings, KINDS[type].type, checkins) : []),
    [works, settings, type, checkins],
  );
  const most = Math.max(0, ...cols.map((c) => c.cards.length));

  if (!type) {
    return <div className="dashed" style={{ padding: '22px 16px', textAlign: 'center', font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>{t('ยังไม่มีชิ้นงานที่กำลังทำในกลุ่มนี้')}</div>;
  }

  return (
    <div className="caseboard">
      <div className="caseboard__bar">
        <div className="seg seg--sm" role="group" aria-label={t('ประเภทงาน')}>
          {types.map((ty) => (
            <button key={ty} data-on={ty === type} aria-pressed={ty === type} onClick={() => setPicked(ty)}>
              <i className="caseboard__dot" style={{ background: KINDS[ty].color }} />
              {KINDS[ty].label}
              <b className="seg__count">{counts.find((c) => c.kind === ty)?.count ?? 0}</b>
            </button>
          ))}
        </div>
        <div className="caseboard__legend" aria-hidden>
          <span><i className="caseboard__sw caseboard__sw--stale" />{t('ค้างเกิน {d} วัน', { d: settings.stale })}</span>
          <span><i className="caseboard__sw caseboard__sw--eval" />{t('รอประเมิน')}</span>
          <span><i className="caseboard__sw caseboard__sw--hot" />{t('step ที่กองมากสุด')}</span>
        </div>
      </div>
      <div className="caseboard__cols">
        {cols.map((c) => {
          const n = c.cards.length;
          const hot = n > 0 && n === most && most > 1;
          return (
            <section
              key={c.progression}
              className={`caseboard__col${n === 0 ? ' caseboard__col--empty' : ''}${hot ? ' caseboard__col--hot' : ''}`}
              aria-label={`step ${c.progression} · ${c.label} · ${t('{n} ชิ้น', { n })}`}
            >
              <div className="caseboard__head" title={c.label}>
                <b>{c.progression}</b>
                <span>{c.label}</span>
                {n > 0 && <em>{n}</em>}
              </div>
              {c.cards.map((k) => {
                const st = byId.get(k.work.studentId);
                return (
                  <button key={k.work.id} className="caseboard__card" onClick={() => st && onOpen(st)} title={t('ดูงานรายคน + คอมเมนต์')}>
                    <b>{personName(st, '')}</b>
                    <small className="caseboard__detail">{tText(k.work.detail)}</small>
                    <small>{k.days === 0 ? t('อัปเดตวันนี้') : t('อัปเดต {n} วันก่อน', { n: k.days })}</small>
                    {(k.stale || k.pendingEval) && (
                      <span className="caseboard__tags">
                        {k.stale && <span className="caseboard__tag caseboard__tag--stale">{t('ค้าง {n} วัน', { n: k.days })}</span>}
                        {k.pendingEval && <span className="caseboard__tag caseboard__tag--eval">{t('รอประเมิน')}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
