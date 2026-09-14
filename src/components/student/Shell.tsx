import {
  BatteryFull, BookOpen, CalendarCheck, CellSignalFull, CellSignalSlash, ChartDonut, CloudSlash, House, UsersThree, WifiHigh,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useApp } from '../../store/app';
import { clock } from '../../lib/date';
import { t } from '../../lib/i18n';
import { ToastView } from '../ToastView';
import { DemoBar } from '../DemoBar';
import { RoleFab } from '../RoleFab';

/* ห้าแท็บ — "สมุด" คือ portfolio ของตัวเอง (Section I/II/III)
   เดิมมีแค่การ์ดบนหน้าแรก ซึ่งอยู่ต่ำกว่าขอบจอ 196px ต้องเลื่อนลงไปหา
   ผู้ใช้ถามหาสองรอบว่าเปิดเล่มตัวเองยังไง = หาไม่เจอจริง จึงยกขึ้นมาเป็นแท็บ */
const TABS = [
  { to: '/app', label: t('หน้าแรก'), Icon: House, end: true },
  { to: '/app/patients', label: t('คนไข้'), Icon: UsersThree, end: false },
  { to: '/app/criteria', label: t('เกณฑ์'), Icon: ChartDonut, end: false },
  { to: '/app/checkin', label: t('คาบ'), Icon: CalendarCheck, end: false },
  { to: '/app/portfolio', label: t('สมุด'), Icon: BookOpen, end: false },
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

/* แถบล่างแบบกระจกไอคอนล้วน (ผู้ใช้ส่งคลิป Instagram มาเป็นตัวอย่าง 14 ก.ย.)
   · ป้ายชื่อแท็บซ่อนจากตา แต่ยังอยู่ใน aria-label ให้ VoiceOver อ่าน
   · พื้นรองแท็บที่เลือกเป็นชิ้นเดียว เลื่อนไปหาแท็บใหม่ (ไม่กระพริบย้ายที่)
   · เลื่อนลงแล้วแถบหดเล็ก เลื่อนขึ้นกลับขนาดเดิม — ทำที่ markScrolled */
// แต่ละหน้าสร้าง Shell ของตัวเอง แถบจึงถูกสร้างใหม่ทุกครั้งที่เปลี่ยนแท็บ
// จำตำแหน่งเดิมไว้นอกคอมโพเนนต์ แล้วค่อยเลื่อนพื้นรองจากที่เดิมไปที่ใหม่หลังวาดเฟรมแรก
let lastTabIndex = 0;

function TabBar() {
  const { pathname } = useLocation();
  const active = TABS.findIndex(({ to, end }) => (end ? pathname === to : pathname.startsWith(to)));
  const [pillAt, setPillAt] = useState(lastTabIndex);
  useEffect(() => {
    if (active < 0) return;
    const id = requestAnimationFrame(() => setPillAt(active));
    lastTabIndex = active;
    return () => cancelAnimationFrame(id);
  }, [active]);
  return (
    <nav className="tabbar" style={{ '--tab-i': pillAt } as React.CSSProperties}>
      {active >= 0 && <span className="tabbar__pill" aria-hidden />}
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} aria-label={label} className={({ isActive }) => (isActive ? 'on' : undefined)}>
          {({ isActive }) => (
            <i>
              <Icon size={23} weight={isActive ? 'fill' : 'regular'} />
            </i>
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
  // แถบล่างหดตอนเลื่อนลง ขยายตอนเลื่อนขึ้น — ธงอยู่บน .phone เพราะแถบเป็นพี่น้องของตัวที่เลื่อน
  // ขยับเกิน 6px ถึงนับ กันนิ้วสั่นแล้วแถบกระตุกไปมา · ใกล้บนสุดขยายเสมอ
  const last = Number(el.dataset.lastTop ?? 0);
  const top = el.scrollTop;
  const phone = el.parentElement;
  if (phone) {
    if (top < 40) phone.dataset.tabCompact = 'false';
    else if (top - last > 6) phone.dataset.tabCompact = 'true';
    else if (last - top > 6) phone.dataset.tabCompact = 'false';
  }
  if (Math.abs(top - last) > 6 || top < 40) el.dataset.lastTop = String(top);
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
