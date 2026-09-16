import { SealCheck } from '@phosphor-icons/react';
import { Shell } from '../../components/student/Shell';
import { caseCount, caseCountTotals, gateRows, yearlyRows } from '../../domain/rules';
import { useStudent, useWorkpieces } from '../../hooks/data';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

export default function Criteria() {
  const { session, settings } = useApp();
  const works = useWorkpieces(session?.studentId);
  const student = useStudent(session?.studentId);
  // ข้อกำหนดที่ไม่ใช่ชิ้นงาน — อาจารย์เป็นคนติ๊ก นักศึกษาเห็นอย่างเดียว
  const gates = gateRows(student?.gates);
  const gateKnown = gates.some((g) => g.value !== undefined);

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
        {/* หัวเรื่องของหน้าคือคำว่า "เกณฑ์สะสม…" ไม่ใช่ตัวเลขใหญ่ข้างบน (ตัวเลขคือค่า)
            ทำเป็น h1 โดยคงหน้าตาเดิมไว้ทุกอย่าง (WCAG 1.3.1) */}
        {/* ซ้ำกับหัวข้อ "เกณฑ์สะสม · ปี 5–6" ที่อยู่ถัดลงไป — ซ่อนจากจอ แต่ยังเป็นหัวเรื่องให้โปรแกรมอ่านหน้าจอ (16 ก.ย. 69) */}
        <h1 className="sronly">{t('เกณฑ์สะสมปี 5–6')}</h1>
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

      {/* หน้าเกณฑ์แบบ "ตัดของซ้ำ" (ผู้ใช้เลือก mock รอบ 3 · 14 ก.ย. 69)
          หัวข้อเล็กสามกลุ่ม · แต่ละกลุ่มเป็นการ์ดใบเดียวคั่นเส้น (เดิมประเภทงานละใบ)
          ตัดบรรทัด "เหลืออีก n ชิ้น" (อ่านจาก x/y กับช่องว่างในแถบได้) · กล่องม่วง Post-core เป็นบรรทัดเล็ก
          คำอธิบายยาวรวมเป็นหมายเหตุท้ายหน้า · เกณฑ์รายปียังขึ้นก่อน (ผู้ใช้ขอคงลำดับเดิม) */}
      <div style={{ padding: '6px 16px 0', display: 'grid', gap: 10 }}>
        <div className="homelabel critlabel">
          <span>{t('เกณฑ์รายปี')} · {t('ปีละ {n} ชิ้น', { n: settings.req.perYear })}</span>
        </div>
        <article className="card critgroup" style={{ borderBottomWidth: 2 }}>
          {years.map((y) => (
            <div key={y.year} className="critrow">
              <div className="critrow__h">
                <b>{t('ปีการศึกษา')} {y.year}</b>
                <span className="critrow__v" style={{ color: y.complete ? 'var(--success-dark)' : 'var(--warning)' }}>{y.done}/{y.required}</span>
              </div>
              <Segs n={y.required} done={y.done} color="var(--accent)" />
            </div>
          ))}
        </article>

        <div className="homelabel critlabel">
          <span>{t('เกณฑ์สะสม')} · {t('ปี 5–6')}</span>
          <span className="mono">{totals.done}/{totals.required}</span>
        </div>
        <article className="card critgroup" style={{ borderBottomWidth: 2 }}>
          {rows.map((r) => (
            <div key={r.group} className="critrow">
              <div className="critrow__h">
                <span className="dot" style={{ background: r.color }} />
                <b>{t(r.label)}</b>
                <span className="critrow__v" style={{ color: r.complete ? 'var(--success-dark)' : undefined }}>
                  {r.complete && <SealCheck size={14} weight="fill" style={{ verticalAlign: -2, marginRight: 4 }} />}
                  {r.done}/{r.required}
                </span>
              </div>
              <Segs n={r.required} done={r.done} color={r.color} />
              {/* Crown/Bridge มีเงื่อนไขซ้อน: ในโควตานี้ต้องเป็น Post-core อย่างน้อย N ชิ้น */}
              {r.postCoreRequired !== undefined && (
                <div className="critrow__note" style={{ color: r.postCoreComplete ? 'var(--success-dark)' : 'var(--self)' }}>
                  {t('ต้องมี {f} อย่างน้อย {n} ชิ้น · ตอนนี้ {a}/{n}', { f: 'Post-core', n: r.postCoreRequired, a: r.postCoreDone ?? 0 })}
                </div>
              )}
            </div>
          ))}
        </article>

        <div className="homelabel critlabel">
          <span>{t('ข้อกำหนดก่อนจบ')}</span>
          <span className="mono">{gates.filter((g) => g.value === true).length}/{gates.length}</span>
        </div>
        <article className="card critgroup" style={{ borderBottomWidth: 2 }}>
          {gates.map((g) => (
            <div key={g.key} className="critgate">
              <span>{g.label}</span>
              <span
                style={{
                  color: g.value === true ? 'var(--success-dark)' : g.value === false ? 'var(--danger)' : 'var(--text-faint)',
                  fontWeight: g.value === undefined ? 400 : 600,
                }}
              >
                {g.value === true ? t('ผ่านแล้ว') : g.value === false ? t('ยังไม่ผ่าน') : t('ยังไม่มีข้อมูล')}
              </span>
            </div>
          ))}
        </article>

        <p className="critfoot">
          {t('เกณฑ์รายปี')}{settings.perYearCountsAllTypes ? t(' (นับทุกประเภท)') : t(' (นับเฉพาะ CD · RPD · Post-core · Crown/Bridge)')}
          {' · '}{t('Simple APD ไม่นับเข้าเกณฑ์ · Recall นับเฉพาะเกณฑ์สะสม ไม่นับเกณฑ์รายปี')}
          {' · '}{gateKnown ? t('อาจารย์ที่ปรึกษาเป็นผู้ยืนยัน — ค่าตั้งต้นมาจากชีต') : t('อาจารย์ที่ปรึกษาเป็นผู้ยืนยัน — ยังไม่มีข้อมูลในระบบ')}
        </p>
      </div>
    </Shell>
  );
}

/** แถบเป็นช่องตามจำนวนที่ต้องมี — ช่องที่ยังว่างคือจำนวนที่เหลือ (แทนบรรทัด "เหลืออีก n ชิ้น") */
function Segs({ n, done, color }: { n: number; done: number; color: string }) {
  return (
    <div className="critsegs" style={{ gridTemplateColumns: `repeat(${Math.max(1, n)}, 1fr)` }} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ background: i < done ? color : undefined }} />
      ))}
    </div>
  );
}
