import { Minus, Plus, ShieldCheck, Trash, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { TYPES } from '../../domain/catalog';
import { staleRows } from '../../domain/aggregate';
import type { Requirement } from '../../domain/types';
import { useAllStudents, useAllWorkpieces, useAudit, useSelfAssessments } from '../../hooks/data';
import { clock } from '../../lib/date';
import { t, tText } from '../../lib/i18n';
import { applyTheme, currentTheme, THEMES } from '../../lib/theme';
import { cohortLabel, isActiveStudent, KEEP_COHORTS, studentYear } from '../../domain/cohort';
import { saYearNow } from '../../domain/saFeedback';
import { saOpenFor } from '../../domain/selfAssessment';
import { purgeExpiredCohorts, retentionReport, type RetentionReport } from '../../data/repo';
import { ensureAlumniSeeded } from '../../data/seed';
import { currentActor, currentPdpaRole, useApp } from '../../store/app';
import { onPdpaPolicy, pdpaPolicy, savePdpaPolicy, type PdpaPolicy, type PdpaRole } from '../../data/pdpaSync';
import { onSettingsSyncState, settingsSyncState } from '../../data/settingsSync';
import { cloudEnabled } from '../../lib/cloud';

const REQ_FIELDS: Array<[keyof Requirement, string, string, string]> = [
  ['cd', 'CD / Complicated APD', TYPES.CD.color, t('จำนวนเคส CD ที่ต้องทำให้ครบตลอดหลักสูตร')],
  ['rpd', 'RPD (Co-Cr or Simple APD)', TYPES.RPD.color, t('จำนวนเคส RPD ที่ต้องทำให้ครบ')],
  ['crown', t('Crown / Bridge (รวม Post-core)'), TYPES.CB.color, t('นับ Crown, Bridge และ Post-core รวมกัน')],
  ['postCoreMin', t('↳ ในนั้นต้องเป็น Post-core'), TYPES.PC.color, t('เงื่อนไขซ้อนในโควตา Crown ด้านบน')],
  ['perYear', t('ทุกปีต้องจบอย่างน้อย'), 'var(--accent)', t('เกณฑ์รายปี แยกจากเกณฑ์สะสม')],
  ['years', t('เกณฑ์สะสมกี่ปี'), 'var(--text-muted)', t('ปกติ 2 ปี (ชั้นปีที่ 5 และ 6)')],
];

/**
 * ปรับเกณฑ์ทีละขั้น พร้อมกันค่าที่ขัดกันเอง
 *
 * Post-core เป็นส่วนย่อยของ Crown/Bridge — ถ้าตั้ง Post-core มากกว่า Crown
 * จะกลายเป็นเกณฑ์ที่ไม่มีใครทำได้เลย (ต้องมี Post-core 3 ชิ้น ในโควตา Crown 2 ชิ้น)
 * ปรับตัวใดตัวหนึ่งแล้วดึงอีกตัวตามให้อยู่ในกรอบเสมอ
 */
function bumpReq(req: Requirement, key: keyof Requirement, delta: number): Requirement {
  const next: Requirement = { ...req, [key]: Math.max(0, req[key] + delta) };
  if (key === 'crown' || key === 'postCoreMin') {
    next.postCoreMin = Math.min(next.postCoreMin, next.crown);
  }
  return next;
}

export default function Settings() {
  const { settings, updateSettings, showToast } = useApp();
  const students = useAllStudents();
  const works = useAllWorkpieces();
  const audit = useAudit(14);
  const staleCount = staleRows(students, works, settings).length;
  // ยอดส่งแบบประเมินตนเองของปีการศึกษานี้ — ให้อาจารย์เห็นว่าเปิดไปแล้วมีคนตอบไหม
  const saRows = useSelfAssessments(saYearNow());
  const activeStudents = students.filter((st) => isActiveStudent(st));
  const saSubmittedIds = new Set(saRows.filter((r) => r.status === 'submitted').map((r) => r.studentId));
  /* นับแยกชั้นปี เพราะเปิดทีละชั้นปีได้ — ตัวหารต้องเป็นคนของชั้นปีนั้น ไม่ใช่ทั้งภาค */
  const saStat = ([5, 6] as const).map((y) => {
    const inYear = activeStudents.filter((st) => studentYear(st) === y);
    return { year: y, total: inYear.length, sent: inYear.filter((st) => saSubmittedIds.has(st.id)).length };
  });
  const saOpenYears = settings.saOpenYears ?? [];
  // ธีมอยู่ใน localStorage ไม่ใช่ store — ถือ state ให้ปุ่มที่เลือกอยู่อัปเดตทันทีที่กด
  const [theme, setTheme] = useState(currentTheme());
  // รายงานว่ามีรุ่นไหนเกินกำหนดเก็บบ้าง
  const [report, setReport] = useState<RetentionReport | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const refreshReport = () => { retentionReport().then(setReport).catch(() => setReport(null)); };
  /* แผง "ข้อมูลย้อนหลัง" นับรุ่นเก่าโดยตรง — ต้องสั่งโหลดรุ่นที่จบแล้วก่อน
     ไม่งั้นจะรายงานว่าเก็บอยู่น้อยกว่าความจริง (รุ่นเก่าโหลดตอนกดดู ไม่ได้โหลดตอนเปิดแอป) */
  useEffect(() => { void ensureAlumniSeeded().then(refreshReport); }, []);
  useEffect(() => { refreshReport(); }, [students.length]);

  async function doPurge() {
    setPurging(true);
    try {
      const res = await purgeExpiredCohorts(currentActor());
      setConfirmPurge(false);
      refreshReport();
      /* เซิร์ฟเวอร์ปฏิเสธ = ยังไม่ได้ลบอะไรเลยทั้งสองฝั่ง (ดูลำดับใน purgeExpiredCohorts)
         ต้องขึ้นเป็นคำเตือนพร้อมเหตุผลจริง ห้ามขึ้นว่า "ลบแล้ว" */
      if (res.server === 'failed') {
        showToast({ message: `${t('ลบไม่สำเร็จ')} — ${res.serverError ?? ''}`, tone: 'warning' });
        return;
      }
      showToast({
        message: res.students
          ? t('ลบแล้ว {n} คน จาก {c}', { n: res.students, c: res.cohorts.map((x) => cohortLabel(x)).join(', ') })
          : t(res.serverError ?? 'ไม่มีรุ่นที่ต้องลบ'),
        tone: res.students ? 'success' : 'warning',
      });
    } finally {
      setPurging(false);
    }
  }

  return (
    <TeacherShell active="settings">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('ตั้งค่าเกณฑ์')}</h1>
            <p>{t('มีผลทั้งระบบทันที')}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <h3>{t('เกณฑ์ขั้นต่ำ')}</h3>
              <p className="sub">
                {t('สะสมตลอดหลักสูตร {y} ปี — ปัจจุบัน', { y: settings.req.years })} CD {settings.req.cd} · RPD {settings.req.rpd} ·
                Crown {settings.req.crown} (Post-core {settings.req.postCoreMin}) · {t('รายปี')} {settings.req.perYear}
              </p>

              <div style={{ marginTop: 12 }}>
                {REQ_FIELDS.map(([key, label, color, hint]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0',
                      borderBottom: '1px solid var(--divider)',
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: color, flex: 'none' }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', font: '600 12.5px var(--font-body)' }}>{label}</span>
                      <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
                        {hint}
                      </span>
                    </span>
                    <div className="stepper">
                      <button
                        onClick={() => updateSettings({ req: bumpReq(settings.req, key as keyof Requirement, -1) })}
                        aria-label={t('ลด')}
                      >
                        <Minus size={13} weight="bold" />
                      </button>
                      <span>{settings.req[key]}</span>
                      <button
                        onClick={() => updateSettings({ req: bumpReq(settings.req, key as keyof Requirement, +1) })}
                        aria-label={t('เพิ่ม')}
                      >
                        <Plus size={13} weight="bold" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel" style={{ background: 'var(--warning-tint)', borderColor: 'var(--warning-border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <WarningCircle size={17} weight="fill" color="var(--warning)" />
                <h3 style={{ color: 'var(--warning-dark)' }}>{t('2 ข้อที่รอภาควิชายืนยัน')}</h3>
              </div>
              <p className="sub" style={{ color: 'var(--warning-dark)', opacity: 0.85 }}>
                {t('ค่าเริ่มต้นตั้งตามที่ตีความจากชีต — พอได้คำตอบแล้วกดสลับได้เลย ตัวเลขทั้งระบบจะคำนวณใหม่ทันที')}
              </p>

              {(
                [
                  [
                    'pairCountsAsOne',
                    t('งานถอดได้ (CD/RPD): คู่ upper+lower นับเป็น'),
                    settings.pairCountsAsOne ? t('1 เคส (ต้องจบทั้งคู่)') : t('2 ชิ้นแยกกัน'),
                    settings.pairCountsAsOne,
                  ],
                  [
                    'perYearCountsAllTypes',
                    t('เกณฑ์รายปีนับ'),
                    settings.perYearCountsAllTypes ? t('ทุกประเภท (รวม Simple APD / Recall)') : t('เฉพาะ 4 ประเภทหลัก'),
                    settings.perYearCountsAllTypes,
                  ],
                ] as Array<[keyof typeof settings, string, string, boolean]>
              ).map(([key, label, value, on]) => (
                <button
                  key={String(key)}
                  onClick={() => updateSettings({ [key]: !on } as never)}
                  style={{ display: 'flex', gap: 11, alignItems: 'center', width: '100%', minHeight: 40, marginTop: 11, textAlign: 'left' }}
                >
                  <span style={{ flex: 1, font: '400 11.5px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
                    {label} <b>{value}</b>
                  </span>
                  <span className="toggle" data-on={on}><i /></span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <h3>{t('คาบคลินิกต่อสัปดาห์')}</h3>
              <p className="sub">{t('ใช้คำนวณสีเสี่ยง "ทันเกณฑ์ปีนี้ไหม" — ตัวเลขจริงขึ้นกับตารางของภาค ปรับให้ตรงได้ที่นี่')}</p>
              <div className="seg" style={{ marginTop: 11 }}>
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} data-on={settings.periodsPerWeek === n} onClick={() => updateSettings({ periodsPerWeek: n })}>
                    {n} {t('คาบ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <h3>{t('แบบประเมินตนเอง')}</h3>
              <p className="sub">{t('ภาคเปิดปีละครั้ง ตอนจบเทอม 1 — เปิดแยกชั้นปีได้ · ชั้นปีที่ยังไม่เปิด นักศึกษาจะไม่เห็นเมนูนี้เลย')}</p>
              <div className="seg" style={{ marginTop: 11 }}>
                {([[], [5], [6], [5, 6]] as number[][]).map((ys) => {
                  const label = ys.length === 0 ? t('ปิด') : ys.length === 2 ? t('ทั้งสองชั้นปี') : t('ปี {n}', { n: ys[0] });
                  const on = ys.length === saOpenYears.length && ys.every((y) => saOpenYears.includes(y));
                  return (
                    <button key={label} data-on={on} onClick={() => updateSettings({ saOpenYears: ys })}>{label}</button>
                  );
                })}
              </div>
              <SettingsSyncNote />
              <label className="field" style={{ marginTop: 11 }}>
                <span>{t('กำหนดส่ง (ไม่บังคับ)')}</span>
                <input
                  className="input mono"
                  type="date"
                  value={settings.saDue ?? ''}
                  onChange={(e) => updateSettings({ saDue: e.target.value || undefined })}
                />
              </label>
              <div style={{ margin: '11px 0 0', display: 'grid', gap: 3 }}>
                {saStat.map((st) => (
                  <p key={st.year} style={{ margin: 0, font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                    {t('ปี {n}', { n: st.year })} · {saOpenFor({ saOpenYears }, st.year) ? t('เปิดอยู่') : t('ปิดอยู่')} ·{' '}
                    {t('ส่งแล้ว')} <b>{st.sent}</b>/{st.total} {t('คน')}
                  </p>
                ))}
              </div>
            </div>

            <div className="panel">
              <h3>{t('นิยาม “เคสค้าง”')}</h3>
              <p className="sub">{t('ชิ้นงานที่ไม่มีการอัปเดตนานเกินกำหนด จะถูก flag ทั้งฝั่งนักศึกษาและ dashboard')}</p>
              <div className="seg" style={{ marginTop: 11 }}>
                {[7, 14, 21, 30].map((d) => (
                  <button key={d} data-on={settings.stale === d} onClick={() => updateSettings({ stale: d })}>
                    {d} {t('วัน')}
                  </button>
                ))}
              </div>
              <p style={{ margin: '11px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                {t('ตอนนี้เข้าเงื่อนไข')} <b>{staleCount}</b> {t('ชิ้นงาน จากทั้งหมด {n} ชิ้นในชั้นปี', { n: works.length })}
              </p>

            </div>

            {/* ธีมสี — เดิมเลือกได้แค่จากแถบเดโมบนคอม อาจารย์ที่เปิดลิงก์แชร์จากแท็บเล็ต/มือถือ
                จะไม่เห็นแถบนั้น (ผู้ใช้ขอ 1 ก.ย.) · ตรงกับการ์ดธีมฝั่ง นศ. ในหน้ากระดิ่ง */}
            <div className="panel">
              <h3>{t('ธีมสี')}</h3>
              <p className="sub">{t('เลือกโทนสีของทั้งแอป — จำไว้เฉพาะเครื่องนี้')}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                {THEMES.map((th) => (
                  <button
                    key={th.cls || 'default'}
                    className={`themebtn${theme === th.cls ? ' themebtn--on' : ''}`}
                    onClick={() => { setTheme(th.cls); applyTheme(th.cls); }}
                  >
                    <span className={`themebtn__dot ${th.cls}`} />
                    {t(th.label)}
                  </button>
                ))}
              </div>
            </div>

            {/* เก็บข้อมูลย้อนหลังตามที่ภาคกำหนด แล้วลบรุ่นที่เกิน (อาจารย์ขอ 1 ก.ย. 69)
                ⚠️ ปุ่มลบกดได้ต่อเมื่อหัวหน้าภาคเปิดสวิตช์ในแผง PDPA ข้างล่างแล้วเท่านั้น */}
            <div className="panel">
              <h3>{t('ข้อมูลย้อนหลัง')}</h3>
              <p className="sub">
                {t('เก็บ {n} รุ่นล่าสุด — รุ่นที่เก่ากว่านั้นลบได้เพื่อไม่ให้ข้อมูลบวม', { n: report?.keepCohorts ?? KEEP_COHORTS })}
              </p>
              {report && (
                <>
                  <p style={{ margin: '11px 0 0', font: '400 11.5px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
                    {t('รุ่นที่เก็บอยู่')}: <b>{report.keep.map((c) => cohortLabel(c)).join(' · ') || '—'}</b>
                  </p>
                  {!report.enabled && (
                    <p style={{ margin: '7px 0 0', font: '400 11.5px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
                      {t('ภาควิชายังไม่ได้เปิดใช้การลบตามกำหนดเก็บ — ข้อมูลเก่ายังอยู่ครบ')}
                    </p>
                  )}
                  {/* คนที่ไม่มีรุ่น = ระบบเดาไม่ได้ว่าเก่าแค่ไหน จึงไม่ลบ ต้องบอกให้เห็น
                      ไม่งั้นจะเข้าใจว่า "ลบครบแล้ว" ทั้งที่ยังมีข้อมูลเก่าค้างอยู่ */}
                  {report.undated > 0 && (
                    <p style={{ margin: '7px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                      {t('มี {n} คนที่ยังไม่ระบุรุ่น — ระบบไม่ลบให้ ต้องเติมรุ่นในหน้ารายชื่อก่อน', { n: report.undated })}
                    </p>
                  )}
                  {report.expired.length === 0 ? (
                    <p style={{ margin: '7px 0 0', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
                      {t('ยังไม่มีรุ่นที่เกินกำหนดเก็บ')}
                    </p>
                  ) : (
                    <>
                      <div style={{ marginTop: 11, display: 'grid', gap: 6 }}>
                        {report.expired.map((e) => (
                          <div key={e.cohort} style={{ display: 'flex', alignItems: 'center', gap: 9, font: '400 11.5px var(--font-body)', color: 'var(--warning-dark)' }}>
                            <b>{cohortLabel(e.cohort)}</b>
                            <span>{t('{a} คน · {b} ชิ้นงาน · {c} คาบ', { a: e.students, b: e.workpieces, c: e.checkins })}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        className="btn"
                        style={{ marginTop: 12, height: 42, fontSize: 13 }}
                        disabled={purging || !report.enabled}
                        onClick={() => setConfirmPurge(true)}
                      >
                        <Trash size={15} weight="bold" />
                        {t('ลบรุ่นที่เกินกำหนด')}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            <PdpaPanel />

            <div className="panel">
              <h3>Audit log</h3>
              <p className="sub">{t('ใครแก้อะไร เมื่อไหร่ — ย้อนดูได้ทุกการเปลี่ยน step และการอนุมัติ')}</p>
              <p className="sub" style={{ marginTop: 2 }}>
                {t('เห็นเฉพาะเรื่องของกลุ่มที่คุณดูแล และสิ่งที่คุณทำเอง · ภาพรวมทั้งภาคเป็นสิทธิ์ของหัวหน้าภาค')}
              </p>
              <div style={{ display: 'grid', gap: 2, marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
                {audit.length === 0 && (
                  <span style={{ font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>{t('ยังไม่มีรายการ')}</span>
                )}
                {audit.map((a) => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, padding: '9px 2px', borderBottom: '1px solid var(--divider)' }}>
                    <span className="mono" style={{ font: '500 10px var(--font-mono)', color: 'var(--text-faint)', flex: 'none', width: 34 }}>
                      {clock(a.at)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pretty" style={{ display: 'block', font: '500 11.5px/1.45 var(--font-body)', color: 'var(--text-secondary)' }}>
                        {tText(a.text)}
                      </span>
                      <span style={{ display: 'block', font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 1 }}>
                        {t(a.who)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <ShieldCheck size={17} color="var(--success)" />
                <h3>{t('สิทธิ์การเข้าถึง & PDPA')}</h3>
              </div>
              <p className="pretty" style={{ margin: '7px 0 0', font: '400 11px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
                {/* ข้อความเดิมเขียนว่า "อาจารย์เห็นเฉพาะกลุ่มที่ปรึกษา" ซึ่งไม่ตรงกับ policy จริง
                    (migration 0004 ตั้งใจให้อาจารย์เห็นทั้งชั้นปี เพราะอาจารย์เวรต้องเซ็นให้ทุกกลุ่ม)
                    เขียนผิดในหน้าที่พูดเรื่อง PDPA อันตรายกว่าไม่เขียน — แก้ให้ตรงความจริง 9 ก.ย. 69 */}
                {t('อาจารย์ในภาคเห็นข้อมูลนักศึกษาได้ทั้งชั้นปี (อาจารย์เวรต้องเซ็นให้ทุกกลุ่ม) · นักศึกษาเห็นเฉพาะของตัวเอง · ตัวคุมฝั่งอาจารย์คือ audit log ที่แก้และลบย้อนหลังไม่ได้ ไม่ใช่การบล็อก')}
              </p>
              <p style={{ margin: '10px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                {t('ปัญหา / ข้อสงสัยเรื่องข้อมูลรายวิชา ติดต่อ ผศ.ดร.ทพ.มนตรี')} ·{' '}
                <a href="mailto:montrimeng@gmail.com" style={{ color: 'var(--accent)' }}>montrimeng@gmail.com</a>
              </p>
            </div>
          </div>
        </div>
        {/* ลบจริง กู้ไม่ได้ — ต้องเห็นตัวเลขที่จะหายไปก่อนกดยืนยัน */}
        {confirmPurge && report && (
          <div className="confirmwrap" onClick={() => setConfirmPurge(false)}>
            <div className="confirmbox" onClick={(e) => e.stopPropagation()}>
              <div className="confirmbox__q">{t('ยืนยันลบข้อมูลรุ่นที่เกินกำหนดเก็บ')}</div>
              <div className="confirmbox__who">{report.expired.map((e) => cohortLabel(e.cohort)).join(' · ')}</div>
              <div className="confirmbox__meta">
                {t('{a} คน · {b} ชิ้นงาน · {c} คาบ', {
                  a: report.expired.reduce((n, e) => n + e.students, 0),
                  b: report.expired.reduce((n, e) => n + e.workpieces, 0),
                  c: report.expired.reduce((n, e) => n + e.checkins, 0),
                })}
              </div>
              <p className="confirmbox__note">
                <WarningCircle size={14} weight="fill" style={{ verticalAlign: -2, marginRight: 4 }} />
                {t('ลบแล้วกู้คืนไม่ได้ — รวมถึงคะแนนประเมินและรูปงานของรุ่นนั้นทั้งหมด')}
              </p>
              <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
                <button className="btn btn--sec" onClick={() => setConfirmPurge(false)}>{t('ยกเลิก')}</button>
                <button className="btn" disabled={purging} onClick={doPurge}>
                  <Trash size={16} weight="bold" />
                  {purging ? t('กำลังลบ…') : t('ลบถาวร')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </TeacherShell>
  );
}


/**
 * บอกว่าค่าที่เพิ่งกด "ถึงเครื่องคนอื่นหรือยัง"
 *
 * ทำไมต้องมี: กดปุ่มแล้วหน้าจอตัวเองเปลี่ยนทันทีเสมอ (ค่าลงเครื่องไปแล้ว)
 * ถ้าส่งขึ้นตู้กลางไม่สำเร็จ อาจารย์จะเข้าใจว่าเปิดฟอร์มแล้ว ทั้งที่นักศึกษายังไม่เห็นอะไรเลย
 * โหมด local/เดโม (ไม่ต่อเซิร์ฟเวอร์) ไม่ต้องขึ้นอะไร — ไม่มีตู้กลางให้ส่งอยู่แล้ว
 */
function SettingsSyncNote() {
  const state = useSyncExternalStore(onSettingsSyncState, settingsSyncState, () => 'off' as const);
  if (!cloudEnabled || state === 'off') return null;
  const failed = state === 'failed';
  return (
    <p
      style={{
        margin: '9px 0 0',
        font: '400 11px/1.6 var(--font-body)',
        color: failed ? 'var(--danger, #c0392b)' : 'var(--text-muted)',
      }}
    >
      {state === 'pending' && t('กำลังส่งขึ้นเครื่องกลาง…')}
      {state === 'synced' && t('ส่งขึ้นเครื่องกลางแล้ว — ทุกเครื่องเห็นค่านี้')}
      {failed && t('ส่งขึ้นเครื่องกลางไม่สำเร็จ — เครื่องอื่นยังเห็นค่าเดิม จะลองใหม่เมื่อเน็ตกลับมา')}
    </p>
  );
}

/* ══════════════════════════════════════════════════════════════════
   แผงนโยบาย PDPA — สวิตช์ที่เปิดได้เฉพาะหัวหน้าภาค (pdpa_policy · migration 0016)

   ทำไมแยกจากแผง "ตั้งค่าเกณฑ์" ข้างบน: เกณฑ์ขั้นต่ำอาจารย์คนไหนก็แก้ได้
   แต่ "ใครส่งออกข้อมูลผู้ป่วยได้" กับ "ลบข้อมูลจริงได้หรือยัง" ต้องเป็นสิทธิ์ของคนเดียว
   อาจารย์ทั่วไปยังเห็นแผงนี้ได้ (จะได้รู้ว่าตอนนี้กติกาคืออะไร) แต่กดอะไรไม่ได้

   ค่าตั้งต้นคือ "ปิดหมด" — โครงพร้อมเปิด ไม่ใช่เปิดไว้แล้ว
   ══════════════════════════════════════════════════════════════════ */
const EXPORT_ROLE_LABELS: Array<[PdpaRole, string]> = [
  ['student', t('นักศึกษา — ของตัวเองเท่านั้น')],
  ['teacher', t('อาจารย์')],
  ['admin', t('หัวหน้าภาค')],
];

function PdpaPanel() {
  const { showToast } = useApp();
  const [pol, setPol] = useState<PdpaPolicy>(() => pdpaPolicy());
  const [saving, setSaving] = useState(false);
  useEffect(() => onPdpaPolicy(() => setPol(pdpaPolicy())), []);
  const isAdmin = currentPdpaRole() === 'admin';

  async function apply(patch: Partial<PdpaPolicy>) {
    setSaving(true);
    try {
      const res = await savePdpaPolicy(patch, currentActor());
      // เขียนไม่ผ่านต้องรู้ทันที — ถ้าเงียบ หัวหน้าภาคจะเชื่อว่าปิดสิทธิ์ไปแล้วทั้งที่ยังเปิดอยู่
      if (res.error) showToast({ message: `${t('บันทึกนโยบายไม่สำเร็จ')} — ${res.error}`, tone: 'warning' });
    } finally {
      setSaving(false);
    }
  }

  const toggleRole = (list: PdpaRole[], r: PdpaRole) =>
    list.includes(r) ? list.filter((x) => x !== r) : [...list, r];

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ShieldCheck size={17} color="var(--warning-dark)" />
        <h3>{t('นโยบาย PDPA')}</h3>
      </div>
      <p className="sub">{t('ค่าเริ่มต้นคือปิดทุกข้อ — เปิดได้เมื่อคณะอนุมัติแล้ว และเปิดได้เฉพาะหัวหน้าภาค')}</p>
      {!isAdmin && (
        <p style={{ margin: '8px 0 0', font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('ดูได้อย่างเดียว — เปลี่ยนได้เฉพาะหัวหน้าภาค')}
        </p>
      )}

      <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
        <div>
          <div style={{ font: '600 12px var(--font-body)' }}>{t('ใครกดส่งออกไฟล์ได้')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
            {EXPORT_ROLE_LABELS.map(([r, label]) => (
              <button
                key={r}
                className="qchip"
                data-on={pol.exportRoles.includes(r)}
                disabled={!isAdmin || saving}
                onClick={() => void apply({
                  exportRoles: toggleRole(pol.exportRoles, r),
                  // ถอนสิทธิ์ส่งออก = ถอนสิทธิ์ส่งออกพร้อมชื่อไปด้วยเสมอ
                  // (เซิร์ฟเวอร์ปฏิเสธค่าที่ขัดกันเองอยู่แล้ว แต่ไม่ควรให้ผู้ใช้เจอ error เพราะเรื่องที่เดาได้)
                  exportIdentifiedRoles: pol.exportRoles.includes(r)
                    ? pol.exportIdentifiedRoles.filter((x) => x !== r)
                    : pol.exportIdentifiedRoles,
                })}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={{ margin: '6px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
            {pol.exportRoles.length === 0
              ? t('ยังไม่เปิดให้ใครส่งออก — ปุ่มส่งออกในแอปกดไม่ได้')
              : t('ทุกครั้งที่มีคนส่งออก ระบบจดลง audit log ว่าใครดึงอะไรออกไปเมื่อไหร่')}
          </p>
        </div>

        <div>
          <div style={{ font: '600 12px var(--font-body)' }}>{t('ใครส่งออกแบบมีชื่อและ HN ผู้ป่วยได้')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
            {EXPORT_ROLE_LABELS.filter(([r]) => pol.exportRoles.includes(r)).map(([r, label]) => (
              <button
                key={r}
                className="qchip"
                data-on={pol.exportIdentifiedRoles.includes(r)}
                disabled={!isAdmin || saving}
                onClick={() => void apply({ exportIdentifiedRoles: toggleRole(pol.exportIdentifiedRoles, r) })}
              >
                {label}
              </button>
            ))}
            {pol.exportRoles.length === 0 && (
              <span style={{ font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>
                {t('ต้องเปิดสิทธิ์ส่งออกก่อน')}
              </span>
            )}
          </div>
          <p style={{ margin: '6px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
            {t('ที่ไม่ได้ติ๊ก จะได้ไฟล์ที่แสดงรหัสเคสแทนชื่อและ HN')}
          </p>
        </div>

        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', font: '600 12.5px var(--font-body)' }}>{t('เปิดใช้การลบตามกำหนดเก็บ')}</span>
              <span style={{ display: 'block', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
                {t('ปิดอยู่ = ไม่มีใครลบข้อมูลรุ่นเก่าได้ แม้แต่หัวหน้าภาค')}
              </span>
            </span>
            <button
              className="qchip"
              data-on={pol.retentionEnabled}
              disabled={!isAdmin || saving}
              onClick={() => void apply({ retentionEnabled: !pol.retentionEnabled })}
            >
              {pol.retentionEnabled ? t('เปิดอยู่') : t('ปิดอยู่')}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12 }}>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', font: '600 12.5px var(--font-body)' }}>{t('เก็บย้อนหลังกี่รุ่น')}</span>
              <span style={{ display: 'block', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
                {t('ตัวเลขนี้ยังไม่ใช่มติภาค — 5 เป็นค่าตั้งต้นจากที่อาจารย์เคยพูดไว้')}
              </span>
            </span>
            <div className="stepper">
              <button
                disabled={!isAdmin || saving || pol.retentionCohorts <= 1}
                onClick={() => void apply({ retentionCohorts: pol.retentionCohorts - 1 })}
                aria-label={t('ลด')}
              >
                <Minus size={13} weight="bold" />
              </button>
              <span>{pol.retentionCohorts}</span>
              <button
                disabled={!isAdmin || saving}
                onClick={() => void apply({ retentionCohorts: pol.retentionCohorts + 1 })}
                aria-label={t('เพิ่ม')}
              >
                <Plus size={13} weight="bold" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {!cloudEnabled && (
        <p style={{ margin: '11px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
          {t('โหมดในเครื่อง/เดโม — ข้อมูลเป็นของสมมติทั้งหมด ค่าที่ตั้งตรงนี้ไม่ถูกส่งไปไหน')}
        </p>
      )}
    </div>
  );
}
