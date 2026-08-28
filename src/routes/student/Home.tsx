import { Bell, CaretRight, CheckCircle, CheckSquare, HandTap, MagnifyingGlass, Square } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import { ArchBadge, Bar, PendingBadge, StaleBadge, TypeBadge } from '../../components/ui/Bits';
import { ConfirmSheet } from '../../components/student/ConfirmSheet';
import { Shell } from '../../components/student/Shell';
import { useCheckIns, usePending, useStepsOnDates, useStudent, useWorkpieces } from '../../hooks/data';
import { relative } from '../../lib/date';
import { t } from '../../lib/i18n';
import { TYPES } from '../../domain/catalog';
import {
  caseCountTotals, currentProc, daysSinceUpdate, isComplete, isStale, maxProgression, nextProc, procAt, procLabel, progression,
} from '../../domain/rules';
import { useApp } from '../../store/app';

/** วงแหวนความคืบหน้า — บนการ์ดเข้ม (แนวเดียวกับ ring ในแอปฟิตเนสที่ผู้ใช้ชอบ) */
function Ring({ value, max }: { value: number; max: number }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, value / max));
  return (
    <svg width="78" height="78" viewBox="0 0 78 78" style={{ flex: 'none' }} aria-hidden>
      <circle cx="39" cy="39" r={R} fill="none" stroke="var(--track)" strokeWidth="7" />
      <circle
        cx="39" cy="39" r={R} fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${C * f} ${C}`} transform="rotate(-90 39 39)"
      />
      <text x="39" y="37" textAnchor="middle" style={{ font: '700 15px var(--font-head)', fill: 'var(--text)' }}>{value}</text>
      <text x="39" y="51" textAnchor="middle" style={{ font: '400 9.5px var(--font-mono)', fill: 'var(--text-faint)' }}>/ {max}</text>
    </svg>
  );
}

function HeroCard({
  w, pending, stale, onPass,
}: {
  w: ReturnType<typeof useWorkpieces>[number];
  pending: boolean;
  stale: boolean;
  onPass: () => void;
}) {
  const cur = currentProc(w);
  const next = nextProc(w);
  const prog = Math.max(progression(w), 0);
  const max = maxProgression(w);
  // step หนึ่งมีขั้นย่อยได้หลายอัน — บอกตำแหน่งไว้ จะได้ไม่เข้าใจว่ากดแล้วจบทั้ง step
  let sibTotal = 0;
  let subPos = 0;
  if (next) {
    for (let i = 0; ; i++) {
      const pa = procAt(w, i);
      if (!pa) break;
      if (pa.progression === next.progression) {
        sibTotal++;
        if (pa.index === next.index) subPos = sibTotal;
      }
    }
  }
  return (
    <article className={`herocase t-${w.type}`}>
      <div className="herocase__top">
        <TypeBadge type={w.type} />
        <ArchBadge arch={w.arch} />
        {pending && <PendingBadge />}
        {stale && <StaleBadge days={daysSinceUpdate(w)} />}
        <span style={{ marginLeft: 'auto', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {relative(w.lastUpdatedAt)}
        </span>
      </div>

      {/* ตัดวงเล็บอธิบายท้ายชื่อเคส (เช่น "ไม่เหลือฟันแม้แต่ซี่เดียว") — คนใช้รู้อยู่แล้วว่า CD คืออะไร */}
      <Link to={`/app/work/${w.id}`} className="herocase__patient">
        {t(w.patient.name)} · HN {w.patient.hn} · {w.detail.replace(/\s*\(.*\)\s*$/, '')}
      </Link>

      {/* step ถัดไปคือพระเอกของการ์ด — ชื่อใหญ่ อ่านปราดเดียวรู้ว่าวันนี้ต้องทำอะไร */}
      <div className="herocase__main">
        <Ring value={prog} max={max} />
        <div style={{ minWidth: 0 }}>
          {next ? (
            <>
              <div className="herocase__caption">
                {t('ขั้นตอนที่กำลังทำ')} · Step {next.progression}{sibTotal > 1 ? ` · ${t('ขั้นย่อย')} ${subPos}/${sibTotal}` : ''}
              </div>
              <div className="herocase__step">{next.name}</div>
              {/* หลาย step มีขั้นย่อย 2 อัน — โชว์แค่ชื่อขั้นที่เพิ่งเสร็จ ไม่ใส่เลข step จะได้ไม่ชนกับข้างบน */}
              {cur && <div className="herocase__done">✓ {t('เสร็จก่อนหน้า')}: {cur.name}</div>}
            </>
          ) : (
            <>
              <div className="herocase__caption">{t('สถานะ')}</div>
              <div className="herocase__step">{cur ? procLabel(w.type, cur) : t('ยังไม่เริ่ม')}</div>
            </>
          )}
        </div>
      </div>

      {next && (
        <button className="herocase__btn" onClick={onPass}>
          <CheckCircle size={19} weight="fill" />
          {t('ทำขั้นนี้เสร็จแล้ว')}
        </button>
      )}
      {next && (
        <Link
          to={`/app/work/${w.id}`}
          style={{ display: 'block', textAlign: 'center', marginTop: 10, font: '500 11.5px var(--font-body)', color: 'var(--accent)' }}
        >
          {t('ดูขั้นตอนทั้งหมดของเคสนี้')} ›
        </Link>
      )}
      {next?.selfPerformed && (
        <div className="selfrow">
          <HandTap size={15} weight="fill" />
          {t('step นี้ต้องทำเอง (self-performed)')}
        </div>
      )}
    </article>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return t('สวัสดีตอนเช้า');
  if (h < 17) return t('สวัสดีตอนบ่าย');
  return t('สวัสดีตอนเย็น');
}

export default function Home() {
  const { session, settings, openSheet } = useApp();
  const student = useStudent(session?.studentId);
  const works = useWorkpieces(session?.studentId);
  const pending = usePending();
  const navigate = useNavigate();

  const active = works.filter((w) => !isComplete(w));
  const recent = [...active].sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  // การ์ดเต็มเฉพาะเคสที่แตะล่าสุด — ที่เหลือเป็นแถวย่อ กดชื่อเข้าไปดูเต็ม กดปุ่มขวาเพื่อผ่าน step ได้เลย
  const hero = recent[0];
  const rest = recent.slice(1, 5);
  const totals = caseCountTotals(works, settings);
  const checkins = useCheckIns(session?.studentId);
  const today = new Date().toISOString().slice(0, 10);
  const todayCheckIn = checkins.find((c) => c.date === today);
  const checkedInToday = !!todayCheckIn;
  const todaySteps = useStepsOnDates(session ? [{ studentId: session.studentId, date: today }] : []);
  const todayStepCount = (todaySteps.get(`${session?.studentId}|${today}`) ?? []).length;

  return (
    <Shell overlay={<ConfirmSheet />}>
      <header className="s-header s-header--row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>{greeting()}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span style={{ font: '700 19px var(--font-head)' }}>{t(student?.name ?? 'นศ. ก')}</span>
            <span className="groupchip">{(student?.group ?? 'TH-PT7').replace('TH-', '')}</span>
          </div>
        </div>
        <Link to="/app/search" className="iconbtn iconbtn--plain" aria-label={t('ค้นหา')}>
          <MagnifyingGlass size={18} />
        </Link>
        <Link to="/app/sync" className="iconbtn" aria-label={t('แจ้งเตือน')}>
          <Bell size={18} weight="fill" />
        </Link>
      </header>

      <div className="sectiontitle" style={{ padding: '12px 16px 7px' }}>
        <h4>{t('วันนี้')}</h4>
      </div>

      {/* ทุกกล่องอยู่ในกองเดียว ระยะเท่ากันหมด — ต่อเนื่องแบบ mock ที่ผู้ใช้เลือก */}
      <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
      <Link
        to="/app/checkin"
        className="card"
        style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px', borderRadius: 16 }}
      >
        {checkedInToday ? (
          <CheckSquare size={26} weight="fill" color="var(--success)" style={{ flex: 'none' }} />
        ) : (
          <Square size={26} color="var(--warning)" style={{ flex: 'none' }} />
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', font: '600 13px/1.4 var(--font-head)' }}>{t('เช็คอินคาบวันนี้')}</span>
          <span style={{ display: 'block', font: '400 10.5px/1.5 var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
            {checkedInToday
              ? `${t(todayCheckIn?.activities[0] ?? '')}${todayStepCount > 0 ? ` · ${t('เสร็จแล้ว {n} ขั้น', { n: todayStepCount })}` : ''} · ${todayCheckIn?.status === 'evaluated' ? t('ประเมินแล้ว') : t('รอประเมิน')}`
              : t('ยังไม่เช็คอิน — กดเพื่อเช็คอิน')}
          </span>
        </span>
        <CaretRight size={15} color="var(--text-disabled)" style={{ flex: 'none' }} />
      </Link>

      {hero && <HeroCard w={hero} pending={pending.has(hero.id)} stale={isStale(hero, settings)} onPass={() => openSheet(hero.id)} />}

      {rest.map((w) => {
        const next = nextProc(w);
        const meta = TYPES[w.type];
        return (
          <div key={w.id} className="minirow">
            <Link to={`/app/work/${w.id}`} className="minirow__body">
              <span className="minirow__top">
                <TypeBadge type={w.type} />
                <span className="minirow__name">{t(w.patient.name)}</span>
                {w.arch && <span className="minirow__arch">{w.arch === 'upper' ? 'Upper' : 'Lower'}</span>}
                {w.tooth && <span className="minirow__arch">{t('ซี่')} {w.tooth}</span>}
                {isStale(w, settings) && <StaleBadge days={daysSinceUpdate(w)} />}
                {pending.has(w.id) && <PendingBadge />}
              </span>
              <span className="minirow__meta">
                <Bar value={(Math.max(progression(w), 0) / maxProgression(w)) * 100} color={meta.color} height={5} />
                <span className="mono">{Math.max(progression(w), 0)}/{maxProgression(w)}</span>
              </span>
            </Link>
            {next && (
              <button className="minirow__pass" onClick={() => openSheet(w.id)} aria-label={t('บันทึกทำ step {n} เสร็จ', { n: next.progression })}>
                <CheckCircle size={17} weight="fill" />
                <span>{next.progression}</span>
              </button>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 11 }}>
        <button className="card" style={statBox} onClick={() => navigate('/app/patients')}>
          <span style={statNum}>{active.length}</span>
          <span style={statLabel}>{t('ชิ้นงานที่กำลังทำ')}</span>
        </button>
        <button className="card" style={statBox} onClick={() => navigate('/app/criteria')}>
          <span style={{ ...statNum, color: totals.allComplete ? 'var(--success)' : 'var(--accent)' }}>
            {totals.done}/{totals.required}
          </span>
          <span style={statLabel}>{t('เกณฑ์สะสม 2 ปี')}</span>
        </button>
      </div>
      </div>
    </Shell>
  );
}

const statBox: React.CSSProperties = {
  flex: 1, padding: '13px 14px', display: 'grid', gap: 3, textAlign: 'left', borderRadius: 14,
};
const statNum: React.CSSProperties = { font: '700 22px var(--font-head)', color: 'var(--accent)' };
const statLabel: React.CSSProperties = { font: '400 11px var(--font-body)', color: 'var(--text-muted)' };
