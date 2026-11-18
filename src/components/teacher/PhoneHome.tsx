import { Bell, CaretDown, CaretRight, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { cloudEnabled } from '../../lib/cloud';
import { LinkRequestsPanel, useLinkRequests } from './LinkRequestsPanel';
import { typeMeta } from '../../domain/catalog';
import type { TodaySummary } from '../../domain/today';
import { thaiShort } from '../../lib/date';
import { t } from '../../lib/i18n';
import { waitReasonLabel } from '../../lib/waitReason';
import { greeting } from './TodayCard';

/**
 * หน้าแรกอาจารย์บนมือถือ (แบบ B3) — งานเดียวที่ต้องทำคือ "ประเมิน" จึงขึ้นก่อนทุกอย่าง
 *   แผงน้ำเงิน: เลขใหญ่ = กี่คนรอประเมิน + ปุ่มเริ่มประเมิน
 *   รอประเมิน: จุดน้ำเงิน แตะชื่อ = เปิดประเมินคนนั้น · โชว์ 3 คนแรก ที่เหลือกด "ดูอีก n คน"
 *   อยู่ step เดิมมาสักพัก: จุดส้ม · ไม่นับวัน ไม่ใช้คำว่า "ต้องตาม" (ความช้าส่วนมากมาจากคนไข้)
 * ตัวเลขทุกตัวมาจาก todaySummary ชุดเดียวกับกล่องวันนี้บนจอใหญ่
 */
export function PhoneHome({
  name, groupCodes, groupLabel, current, onPickGroup, otherPending, summary, studentName,
  onSearch, onStart, onOpenEval, onOpenStudent,
}: {
  name: string;
  groupCodes: string[];
  groupLabel: (code: string) => string;
  current: string;
  onPickGroup: (code: string) => void;
  /** กลุ่มอื่นที่อาจารย์ดูแลแล้วมีคนรอประเมิน */
  otherPending: Array<{ code: string; n: number }>;
  summary: TodaySummary;
  studentName: (id: string) => string;
  onSearch: () => void;
  onStart: () => void;
  onOpenEval: (studentId: string) => void;
  onOpenStudent: (studentId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  /* กระดิ่ง = เรื่องที่รอให้อาจารย์ทำ แต่ไม่ได้อยู่ในรายชื่อรอประเมิน:
     นศ. แก้คาบตามที่ขอแล้ว (todaySummary.fixedList) · นศ. ขอผูกบัญชี (เฉพาะต่อ cloud) */
  const links = useLinkRequests();
  const fixed = summary.fixedList;
  const bellCount = fixed.length + links.rows.length;
  const pend = summary.pendingList;
  const PEND_MAX = 3;
  const pendShown = showAll ? pend : pend.slice(0, PEND_MAX);
  const stuck = summary.staleList.slice(0, 6);
  const waiting = summary.waitingList.slice(0, 3);
  const now = new Date();

  return (
    <main className="main tph">
      <header className="tph__top">
        <div className="tph__hello">
          <span className="tph__greet">{greeting(now)}</span>
          <h1>{name || t('อาจารย์')}</h1>
          <div className="tph__groups">
            {/* ตัวเลือกกลุ่มเป็น select จริงที่ซ่อนอยู่ใต้ป้าย — ได้ตัวเลือกของเครื่องเอง (ล้อหมุนบน iPhone) */}
            <label className="tph__grouppick">
              <span>{t('กลุ่ม')} {groupLabel(current)}</span>
              <CaretDown size={14} weight="bold" aria-hidden />
              <select value={current} onChange={(e) => onPickGroup(e.target.value)} aria-label={t('เลือกกลุ่มที่ดู')}>
                {groupCodes.map((code) => <option key={code} value={code}>{groupLabel(code)}</option>)}
              </select>
            </label>
            {otherPending.map((g) => (
              <button key={g.code} className="tph__other" onClick={() => onPickGroup(g.code)}
                aria-label={t('กลุ่ม {g} มี {n} คนรอประเมิน', { g: groupLabel(g.code), n: g.n })}>
                {groupLabel(g.code).split(' · ')[0]} <b>{g.n}</b>
              </button>
            ))}
          </div>
        </div>
        <button className="tph__round" onClick={onSearch} aria-label={t('ค้นหา')}>
          <MagnifyingGlass size={20} />
        </button>
        <button className="tph__round" onClick={() => setBellOpen(true)} aria-expanded={bellOpen}
          aria-label={bellCount ? t('แจ้งเตือน — {n} เรื่อง', { n: bellCount }) : t('แจ้งเตือน')}>
          <Bell size={20} />
          {bellCount > 0 && <span className="tph__belldot" aria-hidden />}
        </button>
      </header>

      <section className="tph__hero" aria-label={t('สรุปวันนี้')}>
        <span className="tph__date">{t('วันนี้ · {d}', { d: thaiShort(now) })}</span>
        {pend.length ? (
          <div className="tph__big"><b>{pend.length}</b><span>{t('คนรอประเมิน')}</span></div>
        ) : (
          <div className="tph__big"><span>{t('ประเมินครบแล้ว')}</span></div>
        )}
        {pend.length > 0 && (
          <button className="tph__start" onClick={onStart}>
            {t('เริ่มประเมิน')} <CaretRight size={18} weight="bold" />
          </button>
        )}
      </section>

      <section className="tph__card">
        <div className="tph__sect">
          <h2>{t('รอประเมิน')}</h2>
          {pend.length > 0 && <span>{t('แตะชื่อ = ประเมินคนนั้น')}</span>}
        </div>
        {pend.length ? (
          <>
            {pendShown.map((p) => (
              <button key={p.studentId} className="tph__row" onClick={() => onOpenEval(p.studentId)}>
                <span className="tph__dot" aria-hidden />
                <span className="tph__who">
                  <b>{studentName(p.studentId)}</b>
                  <small>
                    {p.activities.length ? p.activities.map((a) => t(a)).join(' · ') : t('ยังไม่ระบุกิจกรรม')}
                    {' · '}{p.count > 1 ? t('{n} คาบ', { n: p.count }) : thaiShort(p.latestDate)}
                  </small>
                </span>
                <CaretRight size={18} className="tph__chev" aria-hidden />
              </button>
            ))}
            {pend.length > PEND_MAX && (
              <button className="tph__more" onClick={() => setShowAll(!showAll)}>
                {showAll ? t('ย่อ') : t('ดูอีก {n} คน', { n: pend.length - PEND_MAX })}
              </button>
            )}
          </>
        ) : (
          <div className="tph__empty">{t('ไม่มีงานรอประเมินแล้ว')}</div>
        )}
      </section>

      {(stuck.length > 0 || waiting.length > 0) && (
        <section className="tph__card">
          <div className="tph__sect">
            <h2>{t('อยู่ step เดิมมาสักพัก')}</h2>
          </div>
          {stuck.map((s) => (
            <button key={s.workId} className="tph__row" onClick={() => onOpenStudent(s.studentId)}>
              <span className="tph__dot tph__dot--stuck" aria-hidden />
              <span className="tph__who">
                <b>{studentName(s.studentId)}</b>
                <small>{typeMeta(s.type).short} · step {s.progression}/{s.max}</small>
              </span>
              <CaretRight size={18} className="tph__chev" aria-hidden />
            </button>
          ))}
          {waiting.map((w) => (
            <button key={w.workId} className="tph__row" onClick={() => onOpenStudent(w.studentId)}>
              <span className="tph__dot tph__dot--wait" aria-hidden />
              <span className="tph__who">
                <b>{studentName(w.studentId)}</b>
                <small>{typeMeta(w.type).short} · {waitReasonLabel(w.reason)}</small>
              </span>
              <span className="tph__tag">{t('รอคนไข้')}</span>
              <CaretRight size={18} className="tph__chev" aria-hidden />
            </button>
          ))}
        </section>
      )}
      {bellOpen && (
        <div className="tsheet" role="dialog" aria-modal="true" aria-label={t('แจ้งเตือน')}>
          <button className="tsheet__scrim" aria-label={t('ปิด')} onClick={() => setBellOpen(false)} />
          <div className="tsheet__body">
            <span className="tsheet__grab" aria-hidden />
            <div className="tsheet__head">
              <b>{t('แจ้งเตือน')}</b>
              <button className="tsheet__x" onClick={() => setBellOpen(false)} aria-label={t('ปิด')}><X size={16} weight="bold" /></button>
            </div>
            {fixed.length > 0 && (
              <section className="tph__card tph__card--flat">
                <div className="tph__sect">
                  <h2>{t('นศ. แก้คาบตามที่ขอแล้ว')}</h2>
                  <span>{t('แตะ = ประเมิน')}</span>
                </div>
                {fixed.map((f) => (
                  <button key={f.checkinId} className="tph__row" onClick={() => { setBellOpen(false); onOpenEval(f.studentId); }}>
                    <span className="tph__dot tph__dot--fixed" aria-hidden />
                    <span className="tph__who">
                      <b>{studentName(f.studentId)}</b>
                      <small>{t('คาบ {d}', { d: thaiShort(f.date) })}{f.editedAt ? ` · ${t('แก้เมื่อ {d}', { d: thaiShort(f.editedAt) })}` : ''}</small>
                    </span>
                    <CaretRight size={18} className="tph__chev" aria-hidden />
                  </button>
                ))}
              </section>
            )}
            {cloudEnabled && <LinkRequestsPanel alwaysShow data={links} />}
            {bellCount === 0 && !links.error && (
              <div className="tph__bellempty">
                <b>{t('ยังไม่มีเรื่องใหม่')}</b>
                <span>{t('จุดแดงจะขึ้นเมื่อ นศ. แก้คาบตามที่ขอ หรือ นศ. ขอผูกบัญชีรออาจารย์ยืนยัน')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
