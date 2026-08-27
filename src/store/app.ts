import { create } from 'zustand';
import { kvGet, kvSet } from '../data/db';
import { getSettings, saveSettings } from '../data/repo';
import { DEFAULT_SETTINGS, DEMO, resetDemoData, seedIfEmpty } from '../data/seed';
import type { Role, Settings } from '../domain/types';

export interface Session {
  role: Role;
  studentId: string;
  teacherId: string;
}

export interface Toast {
  message: string;
  tone: 'default' | 'success' | 'warning';
  undoWorkpieceId?: string;
}

export interface SheetState {
  workpieceId: string;
  performedAt: string; // ISO date
  withPhoto: boolean;
}

interface AppState {
  ready: boolean;
  session: Session | null;
  settings: Settings;
  offline: boolean;
  toast: Toast | null;
  sheet: SheetState | null;
  installPrompt: boolean;
  /** กลุ่มที่อาจารย์กำลังดู — ตั้งครั้งเดียว ใช้ทุกหน้า (ของจริงมาจากตาราง advisor) */
  teacherGroup: string;
  setTeacherGroup: (code: string) => void;
  /** bump ทุกครั้งที่เขียนข้อมูล เพื่อให้ view ที่ไม่ได้ใช้ liveQuery รีเฟรช */
  revision: number;

  init: () => Promise<void>;
  signIn: (role: Role) => Promise<void>;
  signOut: () => Promise<void>;
  switchRole: () => Promise<Role>;
  resetDemo: () => Promise<void>;
  setOffline: (v: boolean) => void;
  showToast: (t: Toast) => void;
  hideToast: () => void;
  openSheet: (workpieceId: string) => void;
  patchSheet: (patch: Partial<SheetState>) => void;
  closeSheet: () => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  dismissInstall: () => void;
  openInstall: () => void;
  touch: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  session: null,
  settings: DEFAULT_SETTINGS,
  offline: false,
  toast: null,
  sheet: null,
  installPrompt: false,
  teacherGroup: (() => {
    try { return localStorage.getItem('teacherGroup') || 'TH-PT7'; } catch { return 'TH-PT7'; }
  })(),
  revision: 0,

  async init() {
    await seedIfEmpty();
    // เวอร์ชันแชร์ก็ผ่านหน้า login เหมือนกัน — ทุกคนจะได้เห็นป้าย DEMO และเลือกบทบาทเอง
    const [settings, session] = await Promise.all([getSettings(), kvGet<Session | null>('session', null)]);
    // เชิญเพิ่มลงหน้าจอโฮมเฉพาะบนจอมือถือ และเสนอครั้งเดียว
    let invite = false;
    try { invite = !session && window.innerWidth < 780 && !localStorage.getItem('installDismissed'); } catch { /* private mode */ }
    set({ ready: true, settings, session, installPrompt: invite });
  },

  async signIn(role) {
    const session: Session = { role, studentId: DEMO.studentId, teacherId: DEMO.teacherId };
    await kvSet('session', session);
    try { localStorage.removeItem('loggedOut'); } catch { /* private mode */ }
    set({ session });
  },

  async signOut() {
    await kvSet('session', null);
    try { localStorage.setItem('loggedOut', '1'); } catch { /* private mode */ }
    set({ session: null, sheet: null, toast: null });
  },

  async switchRole() {
    const cur = get().session;
    const role: Role = cur?.role === 'student' ? 'teacher' : 'student';
    const session: Session = { role, studentId: DEMO.studentId, teacherId: DEMO.teacherId };
    await kvSet('session', session);
    set({ session, sheet: null, toast: null });
    return role;
  },

  async resetDemo() {
    const session = get().session;
    await resetDemoData();
    if (session) await kvSet('session', session);
    const settings = await getSettings();
    set({ settings, sheet: null, toast: null, offline: false, revision: get().revision + 1 });
  },

  setOffline(v) {
    set({ offline: v });
  },

  showToast(t) {
    clearTimeout(toastTimer);
    set({ toast: t });
    toastTimer = setTimeout(() => set({ toast: null }), 4200);
  },

  hideToast() {
    clearTimeout(toastTimer);
    set({ toast: null });
  },

  openSheet(workpieceId) {
    set({
      sheet: { workpieceId, performedAt: new Date().toISOString().slice(0, 10), withPhoto: false },
      toast: null,
    });
  },

  patchSheet(patch) {
    const sheet = get().sheet;
    if (sheet) set({ sheet: { ...sheet, ...patch } });
  },

  closeSheet() {
    set({ sheet: null });
  },

  async updateSettings(patch) {
    const settings = await saveSettings(patch);
    set({ settings, revision: get().revision + 1 });
  },

  setTeacherGroup(code) {
    try { localStorage.setItem('teacherGroup', code); } catch { /* private mode */ }
    set({ teacherGroup: code });
  },

  dismissInstall() {
    localStorage.setItem('installDismissed', '1');
    set({ installPrompt: false });
  },

  openInstall() {
    set({ installPrompt: true });
  },

  touch() {
    set({ revision: get().revision + 1 });
  },
}));
