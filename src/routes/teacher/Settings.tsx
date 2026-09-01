import { Minus, Plus, ShieldCheck, Trash, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { TYPES } from '../../domain/catalog';
import { staleRows } from '../../domain/aggregate';
import type { Requirement } from '../../domain/types';
import { useAllStudents, useAllWorkpieces, useAudit } from '../../hooks/data';
import { clock } from '../../lib/date';
import { t, tText } from '../../lib/i18n';
import { applyTheme, currentTheme, THEMES } from '../../lib/theme';
import { cohortLabel, KEEP_COHORTS } from '../../domain/cohort';
import { purgeExpiredCohorts, retentionReport, type RetentionReport } from '../../data/repo';
import { currentActor, useApp } from '../../store/app';

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
  // ธีมอยู่ใน localStorage ไม่ใช่ store — ถือ state ให้ปุ่มที่เลือกอยู่อัปเดตทันทีที่กด
  const [theme, setTheme] = useState(currentTheme());
  // รายงานว่ามีรุ่นไหนเกินกำหนดเก็บบ้าง
  const [report, setReport] = useState<RetentionReport | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const refreshReport = () => { retentionReport().then(setReport).catch(() => setReport(null)); };
  useEffect(() => { refreshReport(); }, [students.length]);

  async function doPurge() {
    setPurging(true);
    try {
      const res = await purgeExpiredCohorts(currentActor());
      setConfirmPurge(false);
      refreshReport();
      showToast({
        message: res.students
          ? t('ลบแล้ว {n} คน จาก {c}', { n: res.students, c: res.cohorts.map((x) => cohortLabel(x)).join(', ') })
          : t('ไม่มีรุ่นที่ต้องลบ'),
        tone: 'success',
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
                  style={{ display: 'flex', gap: 11, alignItems: 'center', width: '100%', marginTop: 11, textAlign: 'left' }}
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

            {/* เก็บข้อมูลย้อนหลังตามที่ภาคกำหนด แล้วลบรุ่นที่เกิน (อาจารย์ขอ 1 ก.ย. 69) */}
            <div className="panel">
              <h3>{t('ข้อมูลย้อนหลัง')}</h3>
              <p className="sub">{t('เก็บ {n} รุ่นล่าสุด — รุ่นที่เก่ากว่านั้นลบได้เพื่อไม่ให้ข้อมูลบวม', { n: KEEP_COHORTS })}</p>
              {report && (
                <>
                  <p style={{ margin: '11px 0 0', font: '400 11.5px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
                    {t('รุ่นที่เก็บอยู่')}: <b>{report.keep.map((c) => cohortLabel(c)).join(' · ') || '—'}</b>
                  </p>
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
                        disabled={purging}
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
                {t('อาจารย์เห็นข้อมูลเฉพาะนักศึกษาในกลุ่มที่ปรึกษา · ชื่อและ HN ผู้ป่วยแสดงตามสิทธิ์ PDPA · ทุกการอนุมัติและการแก้ step ถูกบันทึกใน audit log ที่แก้ย้อนหลังไม่ได้')}
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
