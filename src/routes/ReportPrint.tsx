/**
 * รายงานประจำเดือน — /teacher/report?scope=year|group&year=5&group=CODE
 *
 * เลือกได้สองขอบเขต: ทั้งชั้นปี (หัวหน้ารายวิชาพิมพ์ไปประชุมภาค) หรือกลุ่มเดียว (อาจารย์ที่ปรึกษา)
 * ตัวเลขทุกตัวมาจาก domain/report.ts ซึ่งใช้กติกาเดียวกับหน้าแรก
 * ไม่มีชื่อหรือ HN ผู้ป่วยบนกระดาษ · รายงานกลุ่มมีชื่อนักศึกษา (อาจารย์เห็นในแอปอยู่แล้ว)
 * แยกเป็นหน้าของตัวเองแบบหน้าพิมพ์อื่น — กระดาษต้องไม่มีปุ่มหรือเมนูของแอปติดไป
 */
import { ArrowLeft, Copy, Printer } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { riskRows } from '../domain/analytics';
import { summarizeAll, summarizeGroups } from '../domain/aggregate';
import { typeChipLabel, workLabel } from '../domain/catalog';
import { CLINIC_LAST_YEAR, CLINIC_START_YEAR, isActiveStudent, studentCohortLabel, studentYear } from '../domain/cohort';
import { groupShort, sortGroupCodes } from '../domain/group';
import { monthlyReport, reportMonths } from '../domain/report';
import { isFollowUpGroup } from '../domain/today';
import type { Teacher } from '../domain/types';
import { useAllCheckIns, useAllProgressUpdates, useAllStudents, useAllWorkpieces } from '../hooks/data';
import { monthTitle, thaiLong } from '../lib/date';
import { personName, t } from '../lib/i18n';
import { authorizeExport } from '../lib/export';
import { currentActor, currentPdpaRole, useApp } from '../store/app';

const EMPTY_TEACHERS: Teacher[] = [];
const YEARS = Array.from({ length: CLINIC_LAST_YEAR - CLINIC_START_YEAR + 1 }, (_, i) => CLINIC_START_YEAR + i);

export default function ReportPrint() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { settings, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const teacherGroup = useApp((st) => st.teacherGroup);
  const allStudents = useAllStudents();
  const allWorks = useAllWorkpieces();
  const checkins = useAllCheckIns();
  const updates = useAllProgressUpdates();
  const teachers = useLiveQuery(() => db.teachers.toArray(), [], EMPTY_TEACHERS) ?? EMPTY_TEACHERS;
  const now = useMemo(() => new Date(), []);
  const months = useMemo(() => reportMonths(now), [now]);

  const active = useMemo(() => allStudents.filter((s) => isActiveStudent(s, now)), [allStudents, now]);
  const groupCodes = useMemo(() => sortGroupCodes([...new Set(active.map((s) => s.group))], active), [active]);
  const groupYear = (code: string) => {
    const s = active.find((st) => st.group === code);
    return s ? studentYear(s, now) : CLINIC_START_YEAR;
  };

  /* ค่าเริ่มต้น: ขอบเขตจากลิงก์ที่กดมา · กลุ่ม = กลุ่มที่ดูอยู่ · ปี = ปีของกลุ่มนั้น · เดือน = เดือนนี้ */
  const scope = params.get('scope') === 'group' ? 'group' : 'year';
  const pickedGroup = params.get('group') ?? (teacherGroup && groupCodes.includes(teacherGroup) ? teacherGroup : groupCodes[0] ?? '');
  const pickedYear = Number(params.get('year')) || (pickedGroup ? groupYear(pickedGroup) : CLINIC_START_YEAR);
  const [monthIdx, setMonthIdx] = useState(0);
  const { year: calYear, month } = months[monthIdx];
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };

  const scopeStudents = useMemo(
    () => (scope === 'group'
      ? active.filter((s) => s.group === pickedGroup)
      : active.filter((s) => studentYear(s, now) === pickedYear)),
    [scope, active, pickedGroup, pickedYear, now],
  );
  const groups = useMemo(
    () => (scope === 'year' ? summarizeGroups(summarizeAll(scopeStudents, allWorks, settings)) : undefined),
    [scope, scopeStudents, allWorks, settings],
  );
  const risk = useMemo(() => riskRows(active, allWorks, settings, checkins, updates, now), [active, allWorks, settings, checkins, updates, now]);
  const riskInput = useMemo(() => risk.map((r) => ({ studentId: r.student.id, risk: r.risk, reason: r.reason })), [risk]);
  const r = useMemo(
    () => monthlyReport({ students: scopeStudents, works: allWorks, checkins, settings, risk: riskInput, groups, year: calYear, month, now }),
    [scopeStudents, allWorks, checkins, settings, riskInput, groups, calYear, month, now],
  );

  const byId = useMemo(() => new Map(allStudents.map((s) => [s.id, s])), [allStudents]);
  const advisorsOf = (code: string) => {
    const ids = active.find((s) => s.group === code)?.advisorIds ?? [];
    const names = new Map(teachers.map((tc) => [tc.id, personName(tc)]));
    return [...new Set(ids)].map((id) => t(names.get(id) ?? '')).filter(Boolean).join(' / ');
  };

  const monthName = monthTitle(calYear, month);
  const scopeName = scope === 'group'
    ? `${t('กลุ่ม {g}', { g: groupShort(pickedGroup) })} · ${t('ปี {n}', { n: groupYear(pickedGroup) })}`
    : t('ชั้นปีที่ {n}', { n: pickedYear });
  const cohort = scopeStudents[0] ? studentCohortLabel(scopeStudents[0], now) : '';
  const s = r.today;
  const topStep = r.bottleneckType && s.staleTop ? r.bottleneck.find((b) => b.progression === s.staleTop!.progression) : undefined;

  const headline = `${monthName} · ${scope === 'group' ? groupShort(pickedGroup) : t('ชั้นปี {n}', { n: pickedYear })} ${t('จบเคส {n} ชิ้น', { n: r.completedInMonth })} · ${t('ต้องตาม {n} คน', { n: s.followUp })}`;
  const dekParts: string[] = [];
  if (scope === 'year' && s.followUpGroups.length) {
    dekParts.push(`${t('กลุ่มที่ต้องตามเยอะสุด')} ${s.followUpGroups.slice(0, 3).map((g) => `${groupShort(g.code)} (${g.followUp})`).join(' · ')}`);
  }
  if (s.stale > 0 && s.staleTop) {
    dekParts.push(t('งานค้างเกิน {d} วัน {n} ชิ้น ส่วนใหญ่ติด step {s}{l} ของงาน {ty}', {
      d: settings.stale, n: s.stale, s: s.staleTop.progression, l: topStep?.label ? ` (${topStep.label})` : '', ty: typeChipLabel(s.staleTop.type),
    }));
  }
  if (!dekParts.length) dekParts.push(t('ไม่มีงานค้างเกินกำหนด'));

  /* พิมพ์ / คัดลอก = ข้อมูลออกจากแอป → ผ่านด่านเดียวกับ CSV (สิทธิ์ตามนโยบายภาค + จด audit ก่อน)
     รายงานไม่มีข้อมูลผู้ป่วย จึงขอแบบปิดบังเสมอ · จำนวนแถวที่จด = จำนวนนักศึกษาในรายงาน */
  const gate = async (how: string) => {
    const res = await authorizeExport({
      scope: scope === 'group' ? 'group' : 'cohort',
      works: [],
      rowCount: scopeStudents.length,
      filename: `monthly-report-${how}-${calYear}-${String(month + 1).padStart(2, '0')}`,
      wantIdentified: false,
      role: currentPdpaRole(),
      groupCode: scope === 'group' ? pickedGroup : undefined,
      actor: currentActor(),
    });
    if (!res.ok) showToast({ message: t(res.reason), tone: 'warning' });
    return res.ok;
  };
  const doPrint = async () => {
    setBusy(true);
    try {
      if (await gate('print')) setTimeout(() => window.print(), 50);
    } finally {
      setBusy(false);
    }
  };

  const copyText = async () => {
    setBusy(true);
    try {
      if (!(await gate('copy'))) return;
    } finally {
      setBusy(false);
    }
    const lines = [
      `${t('รายงานประจำเดือน')} · ${scopeName} · ${monthName}`,
      headline,
      ...dekParts,
      `${t('จบเคส')} ${r.completedInMonth} · ${t('กำลังทำ')} ${r.active} · ${t('รอประเมิน {n} คน', { n: s.pendingPeople })} · ${t('ต้องตาม {n} คน', { n: s.followUp })}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast({ message: t('คัดลอกแล้ว วางใน LINE ได้เลย'), tone: 'success' });
    } catch {
      showToast({ message: t('คัดลอกไม่ได้ในเบราว์เซอร์นี้'), tone: 'warning' });
    }
  };

  const followBy = new Map(s.followUpList.map((f) => [f.studentId, f]));
  /* รูปที่ 1 นับจาก followUpList ชุดเดียวกับตัวเลข "ต้องตาม" · แท่งสูงสุด = กลุ่มที่สัดส่วนมากสุด */
  const groupBars = (groups ?? []).map((g) => {
    const f = g.students.filter((st) => followBy.has(st.student.id)).length;
    return { code: g.code, f, size: g.students.length, share: f / Math.max(1, g.students.length) };
  });
  const shareMax = Math.max(0.01, ...groupBars.map((g) => g.share));
  const stepMax = Math.max(1, ...r.bottleneck.map((b) => b.count));
  /* ป้ายใต้รูปที่ 2 ต้องพูดถึงแท่งที่สูงสุดในรูป (ชิ้นที่กำลังทำทั้งหมด) ไม่ใช่กองงานค้างในบรรทัดสรุป */
  const stepTop = r.bottleneck.find((b) => b.count === stepMax && b.count > 0);
  const monthMax = Math.max(1, ...r.months.map((m) => m.count));

  return (
    <div className="rp-page">
      <div className="rp-tools noprint">
        <button className="btn btn--sec" onClick={() => navigate(-1)}><ArrowLeft size={15} /> {t('ย้อนกลับ')}</button>
        <div className="seg seg--sm" role="group" aria-label={t('ขอบเขต')}>
          <button data-on={scope === 'year'} aria-pressed={scope === 'year'} onClick={() => set('scope', 'year')}>{t('ทั้งชั้นปี')}</button>
          <button data-on={scope === 'group'} aria-pressed={scope === 'group'} onClick={() => set('scope', 'group')}>{t('กลุ่มเดียว')}</button>
        </div>
        {scope === 'year' ? (
          <select className="rp-select" value={pickedYear} onChange={(e) => set('year', e.target.value)} aria-label={t('ชั้นปี')}>
            {YEARS.map((y) => <option key={y} value={y}>{t('ปี {n}', { n: y })}</option>)}
          </select>
        ) : (
          <select className="rp-select" value={pickedGroup} onChange={(e) => set('group', e.target.value)} aria-label={t('กลุ่ม')}>
            {groupCodes.map((c) => <option key={c} value={c}>{groupShort(c)} · {t('ปี {n}', { n: groupYear(c) })}</option>)}
          </select>
        )}
        <select className="rp-select" value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))} aria-label={t('เดือน')}>
          {months.map((m, i) => <option key={`${m.year}-${m.month}`} value={i}>{monthTitle(m.year, m.month)}</option>)}
        </select>
        <span className="rp-tools__gap" />
        <button className="btn btn--sec" onClick={copyText} disabled={busy}><Copy size={15} /> {t('คัดลอกข้อความไปวาง LINE')}</button>
        <button className="btn" onClick={doPrint} disabled={busy}><Printer size={16} weight="fill" /> {t('พิมพ์ / บันทึกเป็น PDF')}</button>
      </div>
      <p className="rp-hint noprint">{t('ไม่มีชื่อหรือ HN ผู้ป่วยในรายงาน · ในหน้าต่างพิมพ์ เลือก “บันทึกเป็น PDF” เพื่อได้ไฟล์')}</p>

      <div className="rp-wrap">
        <article className="rp" aria-label={t('รายงานประจำเดือน')}>
          <header className="rp__mast">
            <b>Prosth Mahidol · {t('รายงานประจำเดือน')}</b>
            <span>{scopeName}{cohort && ` · ${cohort}`} · {monthName}</span>
          </header>
          <h1 className="rp__hd">{headline}</h1>
          <p className="rp__dek">{dekParts.join(' · ')}</p>

          <div className="rp__stats">
            <div><b>{r.completedInMonth}</b><span>{t('ชิ้นงานที่จบในเดือนนี้')}</span></div>
            <div><b>{r.active}</b><span>{t('งานที่กำลังทำ')}*</span></div>
            <div><b>{s.pendingPeople}</b><span>{t('คนรอประเมิน')}*</span></div>
            <div><b>{s.followUp}</b><span>{t('คนต้องตาม จาก {n} คน', { n: scopeStudents.length })}*</span></div>
          </div>

          <div className="rp__two">
            {scope === 'year' && groupBars.length ? (
              <figure className="rp__fig">
                <figcaption>{t('รูปที่ 1 · สัดส่วนคนต้องตามรายกลุ่ม')}</figcaption>
                <div className="rp__bars">
                  {groupBars.map((g) => (
                    <div key={g.code} className="rp__bar">
                      <em>{g.f || ''}</em>
                      <i data-tone={isFollowUpGroup(g.f, g.size) ? 'follow' : undefined} style={{ height: `${(g.share / shareMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="rp__axis">{groupBars.map((g) => <span key={g.code}>{groupShort(g.code).replace(/^PT/, '')}</span>)}</div>
                <p className="rp__cap">{t('แท่งแดงอิฐ = ต้องตามตั้งแต่ ⅓ ของกลุ่ม · เลขบนแท่ง = จำนวนคน · แกนล่าง = เลขกลุ่ม PT')}</p>
              </figure>
            ) : (
              <figure className="rp__fig">
                <figcaption>{t('รูปที่ 1 · นักศึกษาในกลุ่ม')}</figcaption>
                <ul className="rp__people">
                  {scopeStudents.map((st) => (
                    <li key={st.id} data-tone={followBy.has(st.id) ? 'follow' : undefined}>
                      <i />{personName(st)}
                    </li>
                  ))}
                </ul>
                <p className="rp__cap">{t('จุดแดงอิฐ = ต้องตาม · จุดเขียว = ทัน')}</p>
              </figure>
            )}
            <figure className="rp__fig">
              <figcaption>{r.bottleneckType ? t('รูปที่ 2 · ชิ้นงาน {ty} คงค้างตาม step', { ty: typeChipLabel(r.bottleneckType) }) : t('รูปที่ 2 · ชิ้นงานคงค้างตาม step')}</figcaption>
              {r.bottleneck.length ? (
                <>
                  <div className="rp__bars">
                    {r.bottleneck.map((b) => (
                      <div key={b.progression} className="rp__bar">
                        <em>{b.count || ''}</em>
                        <i data-tone={b.count === stepMax && b.count > 0 ? 'max' : 'plain'} style={{ height: `${(b.count / stepMax) * 100}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="rp__axis">{r.bottleneck.map((b) => <span key={b.progression}>{b.progression}</span>)}</div>
                  {stepTop && <p className="rp__cap">{t('กองมากสุด step {s} · {l} · {n} ชิ้น', { s: stepTop.progression, l: stepTop.label, n: stepTop.count })}</p>}
                </>
              ) : <p className="rp__cap">{t('ยังไม่มีชิ้นงานที่กำลังทำ')}</p>}
            </figure>
          </div>

          <figure className="rp__fig">
            <figcaption>{t('รูปที่ 3 · จบเคสรายเดือน (ปีการศึกษา)')}</figcaption>
            <div className="rp__bars rp__bars--months">
              {r.months.map((m) => (
                <div key={m.key} className="rp__bar">
                  <em>{m.future ? '' : m.count}</em>
                  <i data-tone={m.key === r.monthKey ? 'pick' : 'plain'} style={{ height: m.future ? 0 : `${(m.count / monthMax) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="rp__axis rp__axis--months">{r.months.map((m) => <span key={m.key}>{m.label}</span>)}</div>
          </figure>

          <div className="rp__two">
            <section>
              {scope === 'year' ? (
                <>
                  <h3>{t('กลุ่มที่ต้องดู')}</h3>
                  {s.followUpGroups.length ? (
                    <table className="rp__tbl">
                      <thead><tr><th>{t('กลุ่ม')}</th><th>{t('ที่ปรึกษา')}</th><th className="n">{t('ต้องตาม')}</th></tr></thead>
                      <tbody>
                        {s.followUpGroups.slice(0, 6).map((g) => (
                          <tr key={g.code}><td>{groupShort(g.code)}</td><td>{advisorsOf(g.code) || '—'}</td><td className="n">{g.followUp}/{g.size}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="rp__cap">{t('ไม่มีกลุ่มที่ต้องตามตั้งแต่ ⅓ ของกลุ่ม')}</p>}
                </>
              ) : (
                <>
                  <h3>{t('นักศึกษาที่ต้องตาม')}</h3>
                  {s.followUpList.length ? (
                    <table className="rp__tbl">
                      <thead><tr><th>{t('ชื่อ')}</th><th>{t('เหตุผล')}</th></tr></thead>
                      <tbody>
                        {s.followUpList.slice(0, 8).map((f) => (
                          <tr key={f.studentId}><td className="nw">{personName(byId.get(f.studentId), '')}</td><td>{f.reason || '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="rp__cap">{t('ไม่มีนักศึกษาที่ต้องตาม')}</p>}
                </>
              )}
            </section>
            <section>
              <h3>{t('ค้างนานที่สุด')}</h3>
              {r.longest.length ? (
                <table className="rp__tbl">
                  <thead><tr><th>{scope === 'year' ? t('กลุ่ม') : t('ชื่อ')}</th><th>{t('งาน')}</th><th className="n">{t('วัน')}</th></tr></thead>
                  <tbody>
                    {r.longest.map((w, i) => {
                      const st = byId.get(w.studentId);
                      return (
                        <tr key={i}>
                          <td className="nw">{scope === 'year' ? (st ? groupShort(st.group) : '—') : personName(st, '')}</td>
                          <td>{workLabel(w)} · step {w.progression}</td>
                          <td className="n">{w.days}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <p className="rp__cap">{t('ไม่มีงานค้างเกินกำหนด')}</p>}
            </section>
          </div>

          <footer className="rp__foot">
            <span>* {t('ค่า ณ วันที่สร้างรายงาน')} · {t('สร้างจาก Prosth Mahidol')} · {thaiLong(now)}</span>
          </footer>
        </article>
      </div>
    </div>
  );
}
