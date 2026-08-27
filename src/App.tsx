import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './store/app';

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
import Analytics from './routes/teacher/Analytics';
import MyGroup from './routes/teacher/MyGroup';
import Evaluate from './routes/teacher/Evaluate';

function Guard({ role, children }: { role: 'student' | 'teacher'; children: React.ReactNode }) {
  const session = useApp((s) => s.session);
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.role !== role) return <Navigate to={session.role === 'student' ? '/app' : '/teacher'} replace />;
  return <>{children}</>;
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
        <div style={{ font: '500 11px var(--font-body)', color: 'var(--text-faint)', marginTop: 4 }}>กำลังเตรียมข้อมูล…</div>
      </div>
    </div>
  );
}

export default function App() {
  const { ready, init, session } = useApp();

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

        <Route path="/teacher" element={<Guard role="teacher"><Dashboard /></Guard>} />
        <Route path="/teacher/review" element={<Guard role="teacher"><Review /></Guard>} />
        <Route path="/teacher/settings" element={<Guard role="teacher"><TeacherSettings /></Guard>} />
        <Route path="/teacher/analytics" element={<Guard role="teacher"><Analytics /></Guard>} />
        <Route path="/teacher/group" element={<Guard role="teacher"><MyGroup /></Guard>} />
        <Route path="/teacher/evaluate" element={<Guard role="teacher"><Evaluate /></Guard>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
