import { ChalkboardTeacher, GoogleLogo, LockSimple, Student, Tooth } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/app';
import { PhoneFrame } from '../components/student/Shell';
import type { Role } from '../domain/types';

export default function Login() {
  const [role, setRole] = useState<Role | null>(null);
  const { signIn, installPrompt, dismissInstall, openInstall } = useApp();
  const navigate = useNavigate();

  async function go() {
    if (!role) return;
    await signIn(role);
    navigate(role === 'student' ? '/app' : '/teacher');
  }

  return (
    <div className="canvas">
      <PhoneFrame>

        <div className="screen" style={{ padding: '30px 24px 20px', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 16, background: 'var(--accent)', color: '#fff',
              display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-accent)',
            }}
          >
            <Tooth size={30} weight="fill" />
          </div>

          <h1 className="h1" style={{ marginTop: 18 }}>Prostho Tracker</h1>
          <p className="pretty" style={{ margin: '8px 0 0', font: '400 13px/1.65 var(--font-body)', color: 'var(--text-body)' }}>
            ติดตามเคสงานทันตกรรมประดิษฐ์ รายวิชา DTPT502
          </p>
          <p style={{ margin: '10px 0 0', font: '500 11.5px var(--font-body)', color: 'var(--text-muted)' }}>
            เข้าระบบด้วยบัญชี @student.mahidol.ac.th
          </p>

          <div
            style={{
              marginTop: 12, borderRadius: 12, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start',
              background: 'var(--warning-tint)', border: '1px solid var(--warning-border)',
            }}
          >
            <span className="badge" style={{ background: 'var(--warning)', color: '#fff', flex: 'none', marginTop: 1 }}>DEMO</span>
            <span className="pretty" style={{ font: '400 10.5px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>
              ตัวอย่างช่วงเริ่มต้น (~10%) · ข้อมูลสมมติทั้งหมด
            </span>
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
            {(
              [
                { key: 'student', title: 'นักศึกษา', hint: 'บันทึก step · ดูเกณฑ์ · ส่งรายงาน', Icon: Student },
                { key: 'teacher', title: 'อาจารย์ / ภาควิชา', hint: 'ภาพรวมทั้งชั้นปี · ตรวจงาน · ตั้งค่าเกณฑ์', Icon: ChalkboardTeacher },
              ] as const
            ).map(({ key, title, hint, Icon }) => (
              <button
                key={key}
                onClick={() => setRole(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderRadius: 14,
                  textAlign: 'left', transition: 'all .15s',
                  border: `1px solid ${role === key ? 'var(--accent)' : 'var(--border-2)'}`,
                  background: role === key ? 'var(--accent-tint)' : '#fff',
                }}
              >
                <span
                  style={{
                    width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: 'none',
                    background: role === key ? 'var(--accent)' : 'var(--fill)',
                    color: role === key ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={21} weight={role === key ? 'fill' : 'regular'} />
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', font: '600 14px var(--font-head)' }}>{title}</span>
                  <span style={{ display: 'block', font: '400 11px var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {hint}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <button className="btn" style={{ marginTop: 18 }} disabled={!role} onClick={go}>
            <GoogleLogo size={19} weight="bold" />
            เข้าสู่ระบบด้วย Google
          </button>

          <button
            onClick={openInstall}
            style={{ marginTop: 12, font: '600 11.5px var(--font-body)', color: 'var(--accent)' }}
          >
            เพิ่มลงหน้าจอโฮม (ใช้ออฟไลน์ในคลินิกได้)
          </button>

          <p
            className="pretty"
            style={{ margin: 'auto 0 0', paddingTop: 20, font: '400 10px/1.6 var(--font-body)', color: 'var(--text-faint)', display: 'flex', gap: 7 }}
          >
            <LockSimple size={14} style={{ flex: 'none', marginTop: 1 }} />
            ข้อมูลผู้ป่วยเก็บตาม PDPA · ทุกการแก้ไขมี audit log
          </p>
        </div>

        {installPrompt && (
          <div className="backdrop" onClick={dismissInstall}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="grabber" />
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span
                  style={{
                    width: 46, height: 46, borderRadius: 13, background: 'var(--accent)', color: '#fff',
                    display: 'grid', placeItems: 'center', flex: 'none',
                  }}
                >
                  <Tooth size={25} weight="fill" />
                </span>
                <div>
                  <div style={{ font: '600 14.5px var(--font-head)' }}>เพิ่ม Prostho Tracker ลงหน้าจอโฮม</div>
                  <div style={{ font: '400 11.5px/1.5 var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                    เปิดใช้ได้เร็วกว่า ใช้ได้แม้สัญญาณคลินิกไม่ดี
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
                <button className="btn btn--sec" style={{ height: 46 }} onClick={dismissInstall}>ไว้ก่อน</button>
                <button className="btn" style={{ height: 46 }} onClick={dismissInstall}>เพิ่มเลย</button>
              </div>
            </div>
          </div>
        )}
      </PhoneFrame>
    </div>
  );
}
