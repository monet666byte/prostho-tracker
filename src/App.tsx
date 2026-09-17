import { Suspense, lazy, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store/app';
import { t } from './lib/i18n';

import Login from './routes/Login';

/**
 * แยกโค้ดตามกลุ่มหน้า — ตอนเปิดแอปจึงโหลดแค่โครงกับกลุ่มที่บทบาทนั้นเปิดถึง
 * (นักศึกษาไม่เคยเห็นหน้าอาจารย์ แต่เดิมต้องโหลดมาทั้งหมดก่อนถึงจะวาดหน้าแรกได้)
 *
 * ตัว `load*` เรียกซ้ำได้ไม่เปลืองอะไร — ครั้งที่สองได้ก้อนเดิมจากแคชโมดูลของเบราว์เซอร์
 * เลยใช้ทั้งเป็นตัวโหลดจริงและตัวดึงล่วงหน้า (ดู usePrefetchPages ข้างล่าง)
 */
const loadStudent = () => import('./routes/student');
const loadTeacher = () => import('./routes/teacher');
const loadPrint = () => import('./routes/print');

function page<M, K extends keyof M>(load: () => Promise<M>, key: K) {
  return lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType })));
}

const Home = page(loadStudent, 'Home');
const Patients = page(loadStudent, 'Patients');
const WorkpieceDetail = page(loadStudent, 'WorkpieceDetail');
const Criteria = page(loadStudent, 'Criteria');
const NewWorkpiece = page(loadStudent, 'NewWorkpiece');
const Search = page(loadStudent, 'Search');
const Photos = page(loadStudent, 'Photos');
const Sync = page(loadStudent, 'Sync');
const ExportScreen = page(loadStudent, 'Export');
const Achievements = page(loadStudent, 'Achievements');
const CheckInPage = page(loadStudent, 'CheckIn');
const SelfAssess = page(loadStudent, 'SelfAssess');
const StudentPortfolio = page(loadStudent, 'Portfolio');

const Dashboard = page(loadTeacher, 'Dashboard');
const Review = page(loadTeacher, 'Review');
const TeacherSettings = page(loadTeacher, 'Settings');
const Roster = page(loadTeacher, 'Roster');
const Analytics = page(loadTeacher, 'Analytics');
const MyGroup = page(loadTeacher, 'MyGroup');
const Evaluate = page(loadTeacher, 'Evaluate');
const SelfAssessments = page(loadTeacher, 'SelfAssessments');
const Portfolio = page(loadTeacher, 'Portfolio');
const Exams = page(loadTeacher, 'Exams');

const PortfolioPrint = page(loadPrint, 'PortfolioPrint');
const SaPrint = page(loadPrint, 'SaPrint');

function Guard({ role, children }: { role: 'student' | 'teacher'; children: React.ReactNode }) {
  const session = useApp((s) => s.session);
  if (!session) return <Navigate to="/login" replace />;
  if (session.role !== role) return <Navigate to={session.role === 'student' ? '/app' : '/teacher'} replace />;
  return <>{children}</>;
}

/**
 * เปิดฐานข้อมูลในเครื่องไม่ได้ — บอกสาเหตุที่เป็นไปได้เป็นภาษาคน
 * เดิมกรณีนี้ค้างที่จอโหลดตลอดไปโดยไม่บอกอะไร นักศึกษาจะรายงานได้แค่ "เปิดไม่ขึ้น"
 */
function StorageError({ detail }: { detail: string }) {
  /* สาเหตุ "มีแท็บอื่นเปิดค้าง" ต้องมีข้อความของตัวเอง — วิธีแก้คนละเรื่องกับที่เก็บข้อมูลไม่ได้
     และเป็นสาเหตุที่ผู้ใช้แก้เองได้ในสิบวินาที ถ้าบอกให้ถูก (ดูตัวจับเวลาใน store/app.ts) */
  const otherTab = detail === 'OTHER_TAB';
  /* 'STUCK' = เตรียมข้อมูลไม่เสร็จในเวลาที่ควร แต่ยังไม่รู้สาเหตุแน่
     สองสาเหตุที่พบจริง: มีแท็บอื่นของแอปนี้เปิดค้าง · หรือเบราว์เซอร์ไม่ยอมให้เก็บข้อมูล
     เล่าทั้งสองทางพร้อมวิธีแก้ ดีกว่าเดาผิดทาง */
  const stuck = detail === 'STUCK';
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 340, display: 'grid', gap: 12, textAlign: 'center' }}>
        <div style={{ font: '700 17px var(--font-head)', color: 'var(--text)' }}>
          {otherTab ? t('มีแอปนี้เปิดอยู่อีกแท็บ')
            : stuck ? t('เตรียมข้อมูลไม่เสร็จ')
            : t('เปิดแอปไม่ได้ในเบราว์เซอร์นี้')}
        </div>
        <div style={{ font: '400 13px/1.7 var(--font-body)', color: 'var(--text-body)' }}>
          {otherTab
            ? t('แท็บที่เปิดอยู่ถือฐานข้อมูลรุ่นก่อนไว้ ทำให้แท็บนี้เตรียมข้อมูลไม่เสร็จ')
            : stuck
              ? t('รอนานเกินปกติแล้วยังไม่เสร็จ ลองตามลำดับนี้')
              : t('แอปต้องเก็บข้อมูลไว้ในเครื่องเพื่อให้ใช้ตอนเน็ตหลุดได้ แต่เบราว์เซอร์นี้ไม่ยอมให้เก็บ')}
        </div>
        <ul style={{ textAlign: 'left', margin: 0, paddingLeft: 20, font: '400 12.5px/1.8 var(--font-body)', color: 'var(--text-body)' }}>
          {otherTab || stuck ? (
            <>
              <li>{t('ปิดแท็บอื่นที่เปิดแอปนี้ไว้ แล้วกดโหลดใหม่')}</li>
              <li>{t('ถ้าไม่แน่ใจว่าเปิดไว้ที่ไหน ปิดเบราว์เซอร์แล้วเปิดใหม่ก็ได้')}</li>
              {stuck && <li>{t('ถ้าเปิดใน "หน้าต่างส่วนตัว" ให้ลองเปิดในหน้าต่างปกติแทน')}</li>}
            </>
          ) : (
            <>
              <li>{t('ถ้าเปิดใน "หน้าต่างส่วนตัว" ให้ลองเปิดในหน้าต่างปกติแทน')}</li>
              <li>{t('ถ้าเครื่องเต็ม ลองลบไฟล์บางส่วนแล้วเปิดใหม่')}</li>
              <li>{t('ถ้ายังไม่ได้ ลองเบราว์เซอร์อื่นแล้วแจ้งผู้พัฒนา')}</li>
            </>
          )}
        </ul>
        <button className="btn" onClick={() => location.reload()}>{t('โหลดใหม่')}</button>
        {!otherTab && !stuck && (
          <div style={{ font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)', wordBreak: 'break-all', marginTop: 4 }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function Splash() {
  // skeleton แทนจอขาว — ช่วง reseed ข้อมูลตัวอย่างใช้เวลา ~1 วินาที
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 300, display: 'grid', gap: 12, justifyItems: 'center' }}>
        <div className="skel" style={{ width: 52, height: 52, borderRadius: 14 }} />
        <div className="skel" style={{ width: 180, height: 14, borderRadius: 7 }} />
        <div className="skel" style={{ width: 240, height: 10, borderRadius: 5 }} />
        <div className="skel" style={{ width: 210, height: 10, borderRadius: 5 }} />
        <div style={{ font: '500 11px var(--font-body)', color: 'var(--text-faint)', marginTop: 4 }}>{t('กำลังเตรียมข้อมูล…')}</div>
        {/* เปิดครั้งแรกต้องสร้างข้อมูลตัวอย่างหลายพันแถว วัดจริงได้ ~6 วินาที ครั้งต่อไป ~2
            ถ้าไม่บอก คนเปิดครั้งแรก (โดยเฉพาะอาจารย์ที่เปิดจากลิงก์เดโม) จะนึกว่าค้าง */}
        {/* ข้อความนี้มีไว้ให้คนที่กำลังรออ่าน — ใช้สีของปุ่มที่กดไม่ได้แล้วอ่านไม่ออก (1.60 : 1) */}
        <div style={{ font: '400 10px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('ครั้งแรกใช้เวลาสักครู่ · เปิดครั้งต่อไปจะเร็วขึ้น')}
        </div>
      </div>
    </div>
  );
}

/**
 * ดึงก้อนหน้าที่เหลือมาไว้ล่วงหน้าหลังวาดหน้าแรกเสร็จ
 *
 * ถ้าไม่ทำ การกดเปลี่ยนหน้าครั้งแรกของแต่ละกลุ่มจะต้องรอเน็ตก่อน ซึ่งบนเน็ตคลินิก
 * แปลว่าจอว่างค้างเป็นวินาที — คือสิ่งที่งานลดขนาดนี้ตั้งใจไม่ให้เกิด
 * ดึงเฉพาะกลุ่มที่บทบาทนี้เปิดถึงจริง อีกฝั่งไม่ต้องเสียเน็ตโหลด
 */
function usePrefetchPages(role: 'student' | 'teacher' | undefined) {
  useEffect(() => {
    if (!role) return;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 200));
    const id = idle(() => {
      void (role === 'teacher' ? loadTeacher() : loadStudent());
      void loadPrint();
    });
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id as number);
  }, [role]);
}

export default function App() {
  const { ready, init, session, initError } = useApp();

  usePrefetchPages(ready ? (session?.role ?? 'student') : undefined);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const on = () => useApp.getState().setOffline(false);
    const off = () => useApp.getState().setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (!navigator.onLine) off();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!ready) return <Splash />;
  if (initError) return <StorageError detail={initError} />;

  return (
    <HashRouter>
      {/* ระหว่างรอก้อนหน้า ปล่อยพื้นหลังว่างเปล่า ไม่ใส่ตัวหมุนหรือ skeleton
          เพราะหน้าโหลดดักไว้แล้ว (usePrefetchPages) กรณีที่เห็นจริงคือเสี้ยววินาทีตอนเน็ตช้ามาก
          ถ้าใส่อะไรกะพริบตรงนี้จะกลายเป็นของใหม่ที่ผู้ใช้ไม่เคยเห็น */}
      <Suspense fallback={<div style={{ height: '100%' }} />}>
      <Routes>
        <Route path="/" element={<Navigate to={session ? (session.role === 'student' ? '/app' : '/teacher') : '/login'} replace />} />
        <Route path="/login" element={<Login />} />

        <Route path="/app" element={<Guard role="student"><Home /></Guard>} />
        <Route path="/app/patients" element={<Guard role="student"><Patients /></Guard>} />
        <Route path="/app/criteria" element={<Guard role="student"><Criteria /></Guard>} />
        <Route path="/app/checkin" element={<Guard role="student"><CheckInPage /></Guard>} />
        <Route path="/app/work/:id" element={<Guard role="student"><WorkpieceDetail /></Guard>} />
        <Route path="/app/new" element={<Guard role="student"><NewWorkpiece /></Guard>} />
        <Route path="/app/search" element={<Guard role="student"><Search /></Guard>} />
        <Route path="/app/photos" element={<Guard role="student"><Photos /></Guard>} />
        <Route path="/app/sync" element={<Guard role="student"><Sync /></Guard>} />
        <Route path="/app/export" element={<Guard role="student"><ExportScreen /></Guard>} />
        <Route path="/app/achievements" element={<Guard role="student"><Achievements /></Guard>} />
        <Route path="/app/self-assessment" element={<Guard role="student"><SelfAssess /></Guard>} />
        <Route path="/app/self-assessment/print" element={<Guard role="student"><SaPrint /></Guard>} />
        {/* สมุดของฉัน — นักศึกษาเปิดดู portfolio ตัวเองทั้งเล่ม (อ่านอย่างเดียว) */}
        <Route path="/app/portfolio" element={<Guard role="student"><StudentPortfolio /></Guard>} />
        <Route path="/app/portfolio/print" element={<Guard role="student"><PortfolioPrint /></Guard>} />

        <Route path="/teacher" element={<Guard role="teacher"><Dashboard /></Guard>} />
        <Route path="/teacher/review" element={<Guard role="teacher"><Review /></Guard>} />
        <Route path="/teacher/settings" element={<Guard role="teacher"><TeacherSettings /></Guard>} />
        <Route path="/teacher/alumni" element={<Guard role="teacher"><Dashboard /></Guard>} />
        <Route path="/teacher/roster" element={<Guard role="teacher"><Roster /></Guard>} />
        {/* ลิงก์เก่ายังใช้ได้ — รวมเข้าหน้ารายชื่อแล้ว */}
        <Route path="/teacher/import" element={<Navigate to="/teacher/roster" replace />} />
        <Route path="/teacher/analytics" element={<Guard role="teacher"><Analytics /></Guard>} />
        <Route path="/teacher/group" element={<Guard role="teacher"><MyGroup /></Guard>} />
        <Route path="/teacher/evaluate" element={<Guard role="teacher"><Evaluate /></Guard>} />
        <Route path="/teacher/sa" element={<Guard role="teacher"><SelfAssessments /></Guard>} />
        {/* Section II กับ III แยกเมนู — หน้าเดียวกัน อ่านจาก path ว่าเปิดหัวข้อไหน */}
        <Route path="/teacher/sect2" element={<Guard role="teacher"><Portfolio /></Guard>} />
        <Route path="/teacher/sect3" element={<Guard role="teacher"><Portfolio /></Guard>} />
        {/* OSCE + สอบ RPD design — แค่ช่องติ๊ก ไม่มีฟอร์ม */}
        <Route path="/teacher/exams" element={<Guard role="teacher"><Exams /></Guard>} />
        <Route path="/teacher/portfolio" element={<Navigate to="/teacher/sect2" replace />} />
        <Route path="/teacher/portfolio/:studentId/print" element={<Guard role="teacher"><PortfolioPrint /></Guard>} />
        <Route path="/teacher/sa/:studentId/print" element={<Guard role="teacher"><SaPrint /></Guard>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </HashRouter>
  );
}
