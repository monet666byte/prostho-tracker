import { Minus, Plus, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { TYPES } from '../../domain/catalog';
import { staleRows } from '../../domain/aggregate';
import type { Requirement } from '../../domain/types';
import { useAllStudents, useAllWorkpieces, useAudit } from '../../hooks/data';
import { clock } from '../../lib/date';
import { useApp } from '../../store/app';

const REQ_FIELDS: Array<[keyof Requirement, string, string, string]> = [
  ['cd', 'CD / Complicated APD', TYPES.CD.color, 'จำนวนเคส CD ที่ต้องทำให้ครบตลอดหลักสูตร'],
  ['rpd', 'RPD (Co-Cr or Simple APD)', TYPES.RPD.color, 'จำนวนเคส RPD ที่ต้องทำให้ครบ'],
  ['crown', 'Crown / Bridge (รวม Post-core)', TYPES.CB.color, 'นับ Crown, Bridge และ Post-core รวมกัน'],
  ['postCoreMin', '↳ ในนั้นต้องเป็น Post-core', TYPES.PC.color, 'เงื่อนไขซ้อนในโควตา Crown ด้านบน'],
  ['perYear', 'ทุกปีต้องจบอย่างน้อย', 'var(--accent)', 'เกณฑ์รายปี แยกจากเกณฑ์สะสม'],
  ['years', 'เกณฑ์สะสมกี่ปี', 'var(--text-muted)', 'ปกติ 2 ปี (ชั้นปีที่ 5 และ 6)'],
];

export default function Settings() {
  const { settings, updateSettings } = useApp();
  const students = useAllStudents();
  const works = useAllWorkpieces();
  const audit = useAudit(14);
  const staleCount = staleRows(students, works, settings).length;

  return (
    <TeacherShell active="settings">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>ตั้งค่าเกณฑ์</h1>
            <p>มีผลทั้งระบบทันที</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <h3>เกณฑ์ขั้นต่ำ</h3>
              <p className="sub">
                สะสมตลอดหลักสูตร {settings.req.years} ปี — ปัจจุบัน CD {settings.req.cd} · RPD {settings.req.rpd} ·
                Crown {settings.req.crown} (Post-core {settings.req.postCoreMin}) · รายปี {settings.req.perYear}
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
                        onClick={() => updateSettings({ req: { ...settings.req, [key]: Math.max(0, settings.req[key] - 1) } })}
                        aria-label="ลด"
                      >
                        <Minus size={13} weight="bold" />
                      </button>
                      <span>{settings.req[key]}</span>
                      <button
                        onClick={() => updateSettings({ req: { ...settings.req, [key]: settings.req[key] + 1 } })}
                        aria-label="เพิ่ม"
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
                <h3 style={{ color: 'var(--warning-dark)' }}>2 ข้อที่รอภาควิชายืนยัน</h3>
              </div>
              <p className="sub" style={{ color: 'var(--warning-dark)', opacity: 0.85 }}>
                ค่าเริ่มต้นตั้งตามที่ตีความจากชีต — พอได้คำตอบแล้วกดสลับได้เลย ตัวเลขทั้งระบบจะคำนวณใหม่ทันที
              </p>

              {(
                [
                  [
                    'pairCountsAsOne',
                    'งานถอดได้ (CD/RPD): คู่ upper+lower นับเป็น',
                    settings.pairCountsAsOne ? '1 เคส (ต้องจบทั้งคู่)' : '2 ชิ้นแยกกัน',
                    settings.pairCountsAsOne,
                  ],
                  [
                    'perYearCountsAllTypes',
                    'เกณฑ์รายปีนับ',
                    settings.perYearCountsAllTypes ? 'ทุกประเภท (รวม Simple APD / Recall)' : 'เฉพาะ 4 ประเภทหลัก',
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
              <h3>นิยาม “เคสค้าง”</h3>
              <p className="sub">ชิ้นงานที่ไม่มีการอัปเดตนานเกินกำหนด จะถูก flag ทั้งฝั่งนักศึกษาและ dashboard</p>
              <div className="seg" style={{ marginTop: 11 }}>
                {[7, 14, 21, 30].map((d) => (
                  <button key={d} data-on={settings.stale === d} onClick={() => updateSettings({ stale: d })}>
                    {d} วัน
                  </button>
                ))}
              </div>
              <p style={{ margin: '11px 0 0', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                ตอนนี้เข้าเงื่อนไข <b>{staleCount}</b> ชิ้นงาน จากทั้งหมด {works.length} ชิ้นในชั้นปี
              </p>

            </div>

            <div className="panel">
              <h3>Audit log</h3>
              <p className="sub">ใครแก้อะไร เมื่อไหร่ — ย้อนดูได้ทุกการเปลี่ยน step และการอนุมัติ</p>
              <div style={{ display: 'grid', gap: 2, marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
                {audit.length === 0 && (
                  <span style={{ font: '400 11px var(--font-body)', color: 'var(--text-faint)' }}>ยังไม่มีรายการ</span>
                )}
                {audit.map((a) => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, padding: '9px 2px', borderBottom: '1px solid var(--divider)' }}>
                    <span className="mono" style={{ font: '500 10px var(--font-mono)', color: 'var(--text-faint)', flex: 'none', width: 34 }}>
                      {clock(a.at)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pretty" style={{ display: 'block', font: '500 11.5px/1.45 var(--font-body)', color: 'var(--text-secondary)' }}>
                        {a.text}
                      </span>
                      <span style={{ display: 'block', font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 1 }}>
                        {a.who}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <ShieldCheck size={17} color="var(--success)" />
                <h3>สิทธิ์การเข้าถึง &amp; PDPA</h3>
              </div>
              <p className="pretty" style={{ margin: '7px 0 0', font: '400 11px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
                อาจารย์เห็นข้อมูลเฉพาะนักศึกษาในกลุ่มที่ปรึกษา · ชื่อและ HN ผู้ป่วยแสดงตามสิทธิ์ PDPA ·
                ทุกการอนุมัติและการแก้ step ถูกบันทึกใน audit log ที่แก้ย้อนหลังไม่ได้
              </p>
              <p style={{ margin: '10px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                ปัญหา / ข้อสงสัยเรื่องข้อมูลรายวิชา ติดต่อ ผศ.ดร.ทพ.มนตรี ·{' '}
                <a href="mailto:montrimeng@gmail.com" style={{ color: 'var(--accent)' }}>montrimeng@gmail.com</a>
              </p>
            </div>
          </div>
        </div>
      </main>
    </TeacherShell>
  );
}
