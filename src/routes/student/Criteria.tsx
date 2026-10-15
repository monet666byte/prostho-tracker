import { SealCheck } from '@phosphor-icons/react';
import { ReqParts } from '../../components/ReqParts';
import { Shell } from '../../components/student/Shell';
import { caseCount, caseCountTotals, gateRows, gatesDone, yearlyRows } from '../../domain/rules';
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
  // yearlyRows ไล่ปีเรียงจนถึงปีปัจจุบันเสมอ — ตัวท้ายคือปีนี้
  const thisYear = years[years.length - 1];

  return (
    <Shell>
      {/* หัวหน้าเป็นแผงแบบการ์ดสะสมแต้ม: เลขรวมตัวใหญ่ + แถบทีละชิ้น + วงต่อประเภท + เกณฑ์รายปีของปีนี้
          ตัวเลขทุกตัวมาจาก caseCount / caseCountTotals / yearlyRows ชุดเดียวกับรายการด้านล่าง */}
      <header className="s-header pagepanel">
        <div className="critpanel__kicker">{t('เกณฑ์สะสม {y} ปี', { y: settings.req.years })} · {t('ปี 5–6')}</div>
        {/* หัวเรื่องของหน้าคือคำ ไม่ใช่ตัวเลขใหญ่ (WCAG 1.3.1) — ซ่อนจากตา โปรแกรมอ่านหน้าจออ่านได้ */}
        <h1 className="sronly">{t('เกณฑ์สะสมปี 5–6')}</h1>
        <div className="critpanel__big">
          {totals.done} <span>/ {totals.required} {t('เคส')}</span>
        </div>
        <div className="critpanel__segs" style={{ gridTemplateColumns: `repeat(${Math.max(1, totals.required)}, minmax(0, 1fr))` }} aria-hidden>
          {Array.from({ length: totals.required }, (_, i) => <i key={i} data-on={i < totals.done} />)}
        </div>
        <div className="critpanel__types">
          {rows.map((r) => (
            <div key={r.group} className="critpanel__type">
              <PanelRing done={r.done} total={r.required} />
              <span className="critpanel__name">
                <span className="dot" style={{ background: r.color }} />
                {t(r.short)}
              </span>
            </div>
          ))}
        </div>
        {thisYear && (
          <div className="critpanel__year">
            <span style={{ flex: 1 }}>{t('ปีการศึกษา')} {thisYear.year} · {t('เกณฑ์รายปี')}</span>
            <b>{thisYear.done} <span>/ {thisYear.required}</span></b>
          </div>
        )}
      </header>

      {/* หน้าเกณฑ์แบบ "ตัดของซ้ำ"
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
              {/* แถบนับรวม · ใต้แถบแยกชนิดงาน (CD/Complicated APD · Co-Cr/Simple APD · Post-core/Crown)
                  ชนิดที่บังคับ (Co-Cr · Post-core) โชว์เป็น x/y แทนบรรทัดม่วงเดิม */}
              {r.parts && <ReqParts parts={r.parts} />}
            </div>
          ))}
        </article>

        <div className="homelabel critlabel">
          <span>{t('ข้อกำหนดก่อนจบ')}</span>
          <span className="mono">{gatesDone(student?.gates)}/{gates.length}</span>
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
          {t('เกณฑ์รายปี')}{settings.perYearCountsAllTypes ? t(' (นับทุกประเภท)') : t(' (นับ CD · RPD · Simple APD · Post-core · Crown/Bridge)')}
          {' · '}{t('Simple APD นับเข้า RPD · Recall นับเฉพาะเกณฑ์สะสม ไม่นับเกณฑ์รายปี')}
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

/** วงความคืบหน้าของเกณฑ์หนึ่งประเภทบนแผง — ตัวเลขซ้อนเป็น HTML ให้ฟอนต์ตรงกับทั้งหน้า */
function PanelRing({ done, total }: { done: number; total: number }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  const f = Math.min(1, done / Math.max(1, total));
  return (
    <span className="critpanel__ring">
      <svg width="50" height="50" viewBox="0 0 50 50" aria-hidden>
        <circle cx="25" cy="25" r={R} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="5" />
        {f > 0 && (
          <circle cx="25" cy="25" r={R} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${C * f} ${C}`} transform="rotate(-90 25 25)" />
        )}
      </svg>
      <b>{done}/{total}</b>
    </span>
  );
}
