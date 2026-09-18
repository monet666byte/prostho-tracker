import { ArrowLeft, MagnifyingGlass, XCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, Empty, TypeBadge } from '../../components/ui/Bits';
import { PlainShell } from '../../components/student/Shell';
import { typeMeta } from '../../domain/catalog';
import { currentProc, maxProgression, progression, stepFraction } from '../../domain/rules';
import { usePatientNamesOn, useWorkpieces } from '../../hooks/data';
import { patientTitle } from '../../lib/privacy';
import { t, tSexAge, tText } from '../../lib/i18n';
import { useApp } from '../../store/app';


export default function Search() {
  const navigate = useNavigate();
  const session = useApp((s) => s.session);
  const works = useWorkpieces(session?.studentId);
  const namesOn = usePatientNamesOn();
  const [query, setQuery] = useState('');

  /**
   * ปุ่มลัดสร้างจากงานของตัวเองจริงๆ
   * เดิม hard-code ไว้ ['CD','RPD','Post-core','46','DEMO-0307'] — สองอันหลังเป็นเศษข้อมูลเดโม
   * พอใช้จริง HN "DEMO-0307" ไม่มีทางตรงกับใคร กดแล้วได้ 0 ผลลัพธ์เสมอ
   */
  const quick = useMemo(() => {
    const types = [...new Set(works.map((w) => typeMeta(w.type).short))].slice(0, 4);
    const teeth = [...new Set(works.map((w) => w.tooth).filter(Boolean) as string[])].slice(0, 2);
    // ซี่ฟันเป็นเลขเปล่า "46" ไม่รู้ว่าคืออะไร → ป้าย "ซี่ 46" แต่ค้นด้วยเลขเหมือนเดิม
    return [...types.map((v) => ({ value: v, label: v })), ...teeth.map((v) => ({ value: v, label: t('ซี่ {n}', { n: v }) }))];
  }, [works]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return works;
    return works.filter((w) =>
      [namesOn ? w.patient.name : '', w.patient.hn, w.detail, w.tooth ?? '', typeMeta(w.type).full, typeMeta(w.type).short]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [query, works, namesOn]);

  return (
    <PlainShell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          {/* หน้านี้ไม่มีหัวเรื่องที่มองเห็น (ช่องค้นคือตัวหน้า) — ใส่หัวเรื่องที่มีแต่เสียง
              ให้คนที่ใช้โปรแกรมอ่านหน้าจอกระโดดมาถึงได้ · .sronly ซ่อนจากตาแต่ไม่ซ่อนจากเสียง */}
          <h1 className="sronly">{t('ค้นหาเคส')}</h1>
          <div style={{ flex: 1, position: 'relative' }}>
            <MagnifyingGlass size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'var(--text-faint)' }} />
            <input
              autoFocus
              aria-label={t('ค้นหาเคส')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={namesOn ? t('ค้นชื่อผู้ป่วย · HN · ซี่ฟัน · ประเภทงาน') : t('ค้น HN · ซี่ฟัน · ประเภทงาน')}
              style={{
                width: '100%', height: 46, borderRadius: 12, background: 'var(--fill)', border: 0,
                padding: '0 38px 0 38px', font: '400 13px var(--font-body)', outline: 'none',
              }}
            />
            {query && (
              <button onClick={() => setQuery('')} style={{ position: 'absolute', right: 11, top: 14 }} aria-label={t('ล้าง')}>
                <XCircle size={18} weight="fill" color="var(--text-disabled)" />
              </button>
            )}
          </div>
        </div>

        {quick.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {quick.map((q) => (
              <button key={q.value} className="qchip" data-on={query === q.value} onClick={() => setQuery(query === q.value ? '' : q.value)}>{q.label}</button>
            ))}
          </div>
        )}
      </header>

      <div className="sectiontitle">
        <h4>{t('ผลการค้นหา')} · {t('{n} ชิ้นงาน', { n: results.length })}</h4>
      </div>

      {results.length === 0 ? (
        <div style={{ padding: '0 16px' }}>
          <Empty icon={<MagnifyingGlass size={26} />} title={t('ไม่พบชิ้นงานที่ตรงกับคำค้น')} hint={t('ลองค้นด้วย HN หรือชื่อประเภทงาน')} />
        </div>
      ) : (
        /* หน้าตาเดียวกับหน้าคนไข้ — HN กึ่งหนา · ชื่อ · ป้ายประเภท · หลอด */
        results.map((w) => {
          const cur = currentProc(w);
          const prog = Math.max(progression(w), 0);
          const max = maxProgression(w);
          const done = prog >= max;
          return (
            <Link key={w.id} to={`/app/work/${w.id}`} className="rowcard" style={{ display: 'block', color: 'inherit' }}>
              <div className="rowcard__head">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', font: '400 12.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
                    {namesOn ? <b className="herocase__hn">HN {w.patient.hn}</b> : tSexAge(w.patient.sexAge)}
                  </span>
                  <span style={{ display: 'block', font: '700 16.5px/1.3 var(--font-head)', marginTop: 3 }}>{patientTitle(w.patient, namesOn, t)}</span>
                </span>
              </div>
              <div className="singlerow">
                <TypeBadge type={w.type} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', font: '400 13px var(--font-body)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tText(w.detail)}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
                    <Bar value={stepFraction(w) * 100} color={done ? 'var(--success)' : typeMeta(w.type).color} height={5} />
                    <span style={{ font: '500 11.5px var(--font-mono)', color: done ? 'var(--success-dark)' : 'var(--text-faint)', flex: 'none' }}>
                      {prog}/{max}
                    </span>
                  </span>
                  <span style={{ display: 'block', marginTop: 6, font: '400 12.5px var(--font-body)', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cur ? t('ขั้นล่าสุด: {step}', { step: cur.name }) : t('ยังไม่เริ่ม')}
                  </span>
                </span>
              </div>
            </Link>
          );
        })
      )}
    </PlainShell>
  );
}
