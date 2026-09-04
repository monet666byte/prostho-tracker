import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './store/app';
import { t } from './lib/i18n';

import Login from './routes/Login';
import Home from './routes/student/Home';
import Patients from './routes/student/Patients';
import WorkpieceDetail from './routes/student/WorkpieceDetail';
import Criteria from './routes/student/Criteria';
import NewWorkpiece from './routes/student/NewWorkpiece';
import Search from './routes/student/Search';
import Photos from './routes/student/Photos';
import Sync from './routes/student/Sync';
import ExportScreen from './routes/student/Export';
import Achievements from './routes/student/Achievements';
import CheckInPage from './routes/student/CheckIn';
import Dashboard from './routes/teacher/Dashboard';
import Review from './routes/teacher/Review';
import TeacherSettings from './routes/teacher/Settings';
import Roster from './routes/teacher/Roster';
import Analytics from './routes/teacher/Analytics';
import MyGroup from './routes/teacher/MyGroup';
import Evaluate from './routes/teacher/Evaluate';
import SelfAssess from './routes/student/SelfAssess';
import SelfAssessments from './routes/teacher/SelfAssessments';

function Guard({ role, children }: { role: 'student' | 'teacher'; children: React.ReactNode }) {
  const session = useApp((s) => s.session);
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.role !== role) return <Navigate to={session.role === 'student' ? '/app' : '/teacher'} replace />;
  return <>{children}</>;
}

/**
 * เปิดฐานข้อมูลในเครื่องไม่ได้ — บอกสาเหตุที่เป็นไปได้เป็นภาษาคน
 * เดิมกรณีนี้ค้างที่จอโหลดตลอดไปโดยไม่บอกอะไร นักศึกษาจะรายงานได้แค่ "เปิดไม่ขึ้น"
 */
function StorageError({ detail }: { detail: string }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 340, display: 'grid', gap: 12, textAlign: 'center' }}>
        <div style={{ font: '700 17px var(--font-head)', color: 'var(--text)' }}>
          {t('เปิดแอปไม่ได้ในเบราว์เซอร์นี้')}
        </div>
        <div style={{ font: '400 13px/1.7 var(--font-body)', color: 'var(--text-body)' }}>
          {t('แอปต้องเก็บข้อมูลไว้ในเครื่องเพื่อให้ใช้ตอนเน็ตหลุดได้ แต่เบราว์เซอร์นี้ไม่ยอมให้เก็บ')}
        </div>
        <ul style={{ textAlign: 'left', margin: 0, paddingLeft: 20, font: '400 12.5px/1.8 var(--font-body)', color: 'var(--text-body)' }}>
          <li>{t('ถ้าเปิดใน "หน้าต่างส่วนตัว" ให้ลองเปิดในหน้าต่างปกติแทน')}</li>
          <li>{t('ถ้าเครื่องเต็ม ลองลบไฟล์บางส่วนแล้วเปิดใหม่')}</li>
          <li>{t('ถ้ายังไม่ได้ ลองเบราว์เซอร์อื่นแล้วแจ้งผู้พัฒนา')}</li>
        </ul>
        <div style={{ font: '400 10.5px var(--font-mono)', color: 'var(--text-faint)', wordBreak: 'break-all', marginTop: 4 }}>
          {detail}
        </div>
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
      </div>
    </div>
  );
}

export default function App() {
  const { ready, init, session, initError } = useApp();

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

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
