import {
  BatteryFull, CalendarCheck, CellSignalFull, CellSignalSlash, ChartDonut, CloudSlash, House, UsersThree, WifiHigh,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../../store/app';
import { clock } from '../../lib/date';
import { t } from '../../lib/i18n';
import { ToastView } from '../ToastView';
import { DemoBar } from '../DemoBar';
import { RoleFab } from '../RoleFab';

const TABS = [
  { to: '/app', label: t('หน้าแรก'), Icon: House, end: true },
  { to: '/app/patients', label: t('คนไข้'), Icon: UsersThree, end: false },
  { to: '/app/criteria', label: t('เกณฑ์'), Icon: ChartDonut, end: false },
  { to: '/app/checkin', label: t('คาบ'), Icon: CalendarCheck, end: false },
];

/** ความสูงเต็มของเครื่อง (820 + ขอบ 10×2) */
const PHONE_OUTER = 840;

/**
 * ย่อทั้งเครื่องด้วย scale ให้พอดีความสูงจอเสมอ — วัดจาก innerHeight จริง
 * เลยรอดทั้งจอเตี้ย ทั้ง zoom ของเบราว์เซอร์ (ที่ CSS media query จับไม่ได้)
 */
function usePhoneScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      // มือถือจริง หรือแท็บเล็ตจอสัมผัส (iPad) = เต็มจอ ไม่ย่อ — ให้ตรงกับ media query ฝั่ง CSS
      const touchTablet = window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 1400;
      if (window.innerWidth <= 780 || touchTablet) return setScale(1);
      const avail = window.innerHeight - 136; // เผื่อแถบเดโม + ระยะขอบ (เผื่อเยอะไว้ กันขอบล่างโดนตัด)
      setScale(Math.min(1, Math.max(0.5, avail / PHONE_OUTER)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

export function PhoneFrame({ children }: { children: ReactNode }) {
  const scale = usePhoneScale();
  return (
    <div className="phonewrap" style={{ height: PHONE_OUTER * scale, display: 'flex', justifyContent: 'center' }}>
      <div className="phone" style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
        {children}
      </div>
    </div>
  );
}

function StatusBar() {
  const offline = useApp((s) => s.offline);
  return (
    <div className="statusbar">
      <span>{clock(new Date())}</span>
      <span className="icons">
        {offline ? <CellSignalSlash weight="fill" /> : <CellSignalFull weight="fill" />}
        {offline ? <CloudSlash weight="fill" /> : <WifiHigh weight="fill" />}
        <BatteryFull weight="fill" />
      </span>
    </div>
  );
}

function TabBar() {
  return (
    <nav className="tabbar">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'on' : undefined)}>
          {({ isActive }) => (
            <>
              <i>
                <Icon size={22} weight={isActive ? 'fill' : 'regular'} />
              </i>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}


/**
 * ติดธง data-scrolled ให้ตัวที่เลื่อน — หัวเรื่องใช้โชว์เส้นคั่นเฉพาะตอนมีเนื้อหาข้างหลัง
 * ใช้ onScroll ตรงๆ แทน useEffect+ref เพราะ ref ผูกพลาดได้ตอน remount ข้ามบทบาท
 * (เจอจริง: effect ไม่รันหลังสลับหน้า attribute เลยไม่ลง) — onScroll อยู่กับ element เสมอ
 */
function markScrolled(e: React.UIEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  el.dataset.scrolled = el.scrollTop > 4 ? 'true' : 'false';
}

export function Shell({ children, footer, overlay }: { children: ReactNode; footer?: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="canvas">
      <DemoBar />
      <PhoneFrame>
        <StatusBar />
        <div className="screen screen--pad" onScroll={markScrolled}><div className="screenfill">{children}</div></div>
        {footer}
        <TabBar />
        <RoleFab />
        <ToastView />
        {overlay}
      </PhoneFrame>
    </div>
  );
}

/** หน้าที่ไม่มี tab bar (S3, S7, S8 …) */
export function PlainShell({ children, footer, overlay }: { children: ReactNode; footer?: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="canvas">
      <DemoBar />
      <PhoneFrame>
        <StatusBar />
        <div className="screen screen--plain" onScroll={markScrolled}><div className="screenfill">{children}</div></div>
        {footer}
        <ToastView />
        {overlay}
      </PhoneFrame>
    </div>
  );
}
