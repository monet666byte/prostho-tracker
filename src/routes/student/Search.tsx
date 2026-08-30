import { ArrowLeft, MagnifyingGlass, XCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, TypeBadge } from '../../components/ui/Bits';
import { Empty } from '../../components/ui/Bits';
import { PlainShell } from '../../components/student/Shell';
import { TYPES } from '../../domain/catalog';
import { currentProc, maxProgression, procLabel, progression } from '../../domain/rules';
import { useWorkpieces } from '../../hooks/data';
import { t, tText } from '../../lib/i18n';
import { useApp } from '../../store/app';


export default function Search() {
  const navigate = useNavigate();
  const session = useApp((s) => s.session);
  const works = useWorkpieces(session?.studentId);
  const [query, setQuery] = useState('');

  /**
   * ปุ่มลัดสร้างจากงานของตัวเองจริงๆ
   * เดิม hard-code ไว้ ['CD','RPD','Post-core','46','DEMO-0307'] — สองอันหลังเป็นเศษข้อมูลเดโม
   * พอใช้จริง HN "DEMO-0307" ไม่มีทางตรงกับใคร กดแล้วได้ 0 ผลลัพธ์เสมอ
   */
  const quick = useMemo(() => {
    const types = [...new Set(works.map((w) => TYPES[w.type].short))].slice(0, 4);
    const teeth = [...new Set(works.map((w) => w.tooth).filter(Boolean) as string[])].slice(0, 2);
    return [...types, ...teeth];
  }, [works]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return works;
    return works.filter((w) =>
      [w.patient.name, w.patient.hn, w.detail, w.tooth ?? '', TYPES[w.type].full, TYPES[w.type].short]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [query, works]);

  return (
    <PlainShell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <div style={{ flex: 1, position: 'relative' }}>
            <MagnifyingGlass size={17} style={{ position: 'absolute', left: 13, top: 15, color: 'var(--text-faint)' }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ค้นชื่อผู้ป่วย · HN · ซี่ฟัน · ประเภทงาน')}
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
              <button key={q} className="qchip mono" onClick={() => setQuery(q)}>{q}</button>
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
        results.map((w) => {
          const cur = currentProc(w);
          const meta = TYPES[w.type];
          return (
            <Link key={w.id} to={`/app/work/${w.id}`} className="casecard" style={{ display: 'block' }}>
              <div className="casecard__top">
                <TypeBadge type={w.type} />
                <span style={{ font: '600 13.5px var(--font-head)' }}>{t(w.patient.name)}</span>
                <span style={{ marginLeft: 'auto', font: '400 10px var(--font-mono)', color: 'var(--text-faint)' }}>
                  HN {w.patient.hn}
                </span>
              </div>
              <div className="casecard__meta" style={{ marginTop: 6 }}>{tText(w.detail)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '10px 0 7px' }}>
                <Bar value={(Math.max(progression(w), 0) / maxProgression(w)) * 100} color={meta.color} height={5} />
                <span style={{ font: '500 10px var(--font-mono)', color: 'var(--text-faint)' }}>
                  {Math.max(progression(w), 0)}/{maxProgression(w)}
                </span>
              </div>
              <div style={{ font: '400 11px var(--font-mono)', color: 'var(--text-muted)' }}>
                {cur ? procLabel(w.type, cur) : t('ยังไม่เริ่ม')}
              </div>
            </Link>
          );
        })
      )}
    </PlainShell>
  );
}
