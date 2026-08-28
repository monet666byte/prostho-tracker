import { CalendarCheck, HourglassMedium, SealCheck, WarningCircle } from '@phosphor-icons/react';
import { Shell } from '../../components/student/Shell';
import { TYPES } from '../../domain/catalog';
import { caseCount, caseCountTotals, yearlyRows } from '../../domain/rules';
import { useWorkpieces } from '../../hooks/data';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

export default function Criteria() {
  const { session, settings } = useApp();
  const works = useWorkpieces(session?.studentId);

  const totals = caseCountTotals(works, settings);
  const rows = caseCount(works, settings);
  const years = yearlyRows(works, settings);

  return (
    <Shell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ font: '700 40px/1 var(--font-head)', color: 'var(--accent)' }}>{totals.done}</span>
          <span style={{ font: '500 13px var(--font-body)', color: 'var(--text-muted)' }}>
            / {totals.required} {t('เคสตามเกณฑ์สะสม {y} ปี', { y: settings.req.years })}
          </span>
        </div>
        <p style={{ margin: '6px 0 12px', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('เกณฑ์สะสมปี 5–6')}
        </p>
        <span className="bar" style={{ height: 10, display: 'block' }}>
          <i
            style={{
              width: `${(totals.done / Math.max(1, totals.required)) * 100}%`,
              background: 'linear-gradient(90deg,#2B5CE6,#5B82F5)',
              transition: 'width .6s cubic-bezier(.4,0,.2,1)',
              display: 'block',
              height: '100%',
              borderRadius: 99,
            }}
          />
        </span>
      </header>

      <div style={{ padding: '14px 16px 0', display: 'grid', gap: 11 }}>
        {/* เกณฑ์รายปีขึ้นก่อน — เป้าที่ต้องจัดการปีนี้ ใกล้ตัวกว่าเกณฑ์สะสม 2 ปี */}
        <article className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarCheck size={16} color="var(--accent)" />
            <span style={{ flex: 1, font: '600 13px var(--font-head)' }}>{t('เกณฑ์รายปี')}</span>
            <span className="chip" style={{ background: 'var(--fill)', color: 'var(--text-muted)' }}>
              {t('ปีละ {n} ชิ้น', { n: settings.req.perYear })}
            </span>
          </div>
          <p style={{ margin: '5px 0 0', font: '400 10.5px/1.55 var(--font-body)', color: 'var(--text-faint)' }}>
            {t('แยกจากเกณฑ์สะสม — ทุกปีการศึกษาต้องจบเคสอย่างน้อย {n} ชิ้นงาน', { n: settings.req.perYear })}
            {settings.perYearCountsAllTypes ? t(' (นับทุกประเภท)') : t(' (นับเฉพาะ CD · RPD · Post-core · Crown/Bridge)')}
          </p>

          <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
            {years.map((y) => (
              <div key={y.year}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                  <span className="mono" style={{ flex: 1, font: '600 11.5px var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {t('ปีการศึกษา')} {y.year}
                  </span>
                  <span style={{ font: '700 12px var(--font-mono)', color: y.complete ? 'var(--success)' : 'var(--warning)' }}>
                    {y.done} / {y.required}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {Array.from({ length: y.required }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        flex: 1, height: 10, borderRadius: 4,
                        background: i < y.done ? 'var(--accent)' : 'var(--track)',
                        transition: 'background .4s ease',
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>

        {rows.map((r) => (
          <article key={r.group} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: r.color, flex: 'none' }} />
              <span style={{ flex: 1, font: '600 13px var(--font-head)' }}>{t(r.label)}</span>
              <span style={{ font: '700 14px var(--font-mono)', color: r.complete ? 'var(--success)' : 'var(--text-secondary)' }}>
                {r.done} / {r.required}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 5, marginTop: 11 }}>
              {Array.from({ length: r.required }, (_, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1, height: 10, borderRadius: 4,
                    background: i < r.done ? r.color : 'var(--track)',
                    transition: 'background .4s ease',
                  }}
                />
              ))}
            </div>

            {/* Crown/Bridge มีเงื่อนไขซ้อน: ในโควตานี้ต้องเป็น Post-core อย่างน้อย N ชิ้น */}
            {r.postCoreRequired !== undefined && (
              <div
                style={{
                  marginTop: 10, borderRadius: 10, padding: '9px 11px',
                  display: 'flex', alignItems: 'center', gap: 7,
                  background: r.postCoreComplete ? 'var(--success-tint)' : 'var(--self-tint)',
                  color: r.postCoreComplete ? 'var(--success-dark)' : 'var(--self)',
                  font: '500 11px/1.45 var(--font-body)',
                }}
              >
                <span style={{ display: 'grid', flex: 'none' }}>
                  {r.postCoreComplete ? <SealCheck size={14} weight="fill" /> : <WarningCircle size={14} weight="fill" />}
                </span>
                {t('ในจำนวนนี้ต้องเป็น {f} อย่างน้อย {n} ชิ้น — ตอนนี้ {a}/{n}', { f: TYPES.PC.full, n: r.postCoreRequired, a: r.postCoreDone ?? 0 })}
              </div>
            )}

            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
                font: '500 11px var(--font-body)',
                color: r.complete ? 'var(--success-dark)' : 'var(--text-muted)',
              }}
            >
              {r.complete ? <SealCheck size={14} weight="fill" /> : <HourglassMedium size={14} />}
              {r.complete ? t('ครบเกณฑ์แล้ว') : t('เหลืออีก {n} ชิ้น', { n: Math.max(0, r.required - r.done) })}
            </div>
          </article>
        ))}

        <p style={{ margin: '2px 2px 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
          {t('Simple APD และ Recall ไม่นับเข้าเกณฑ์')}
        </p>

      </div>
    </Shell>
  );
}
