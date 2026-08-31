import { create } from 'zustand';
import { db, kvGet, kvSet } from '../data/db';
import { getSettings, logAudit, saveSettings } from '../data/repo';
import { cloudReset, initCloudSync, stopCloudSync } from '../data/cloudSync';
import { DEFAULT_SETTINGS, DEMO, DEMO_STUDENT_NAME, resetDemoData, seedIfEmpty } from '../data/seed';
import { cloudEnabled } from '../lib/cloud';
import { toISODate } from '../lib/date';
import { getAppUser, hasCloudSession, signInWithPassword, signOutCloud, type AppUser } from '../lib/auth';
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
  /** กลุ่มที่อาจารย์คนนี้เป็นที่ปรึกษาจริง — null ถ้ายังไม่รู้/ไม่ใช่อาจารย์ */
  myGroup: string | null;
  /** bump ทุกครั้งที่เขียนข้อมูล เพื่อให้ view ที่ไม่ได้ใช้ liveQuery รีเฟรช */
  revision: number;

  /** ชื่อคนที่ล็อกอินอยู่ — ไว้ลง audit log (อัปเดตทุกครั้งที่ session เปลี่ยน) */
  actorName: string;
  /** โหมด cloud: บัญชีที่ล็อกอินอยู่ (null = ยังไม่ล็อกอิน) · โหมด local ไม่ใช้ */
  cloudUser: AppUser | null;
  /** ล็อกอินแล้วแต่อีเมลไม่อยู่ในรายชื่อที่ภาคเชิญ — เข้าใช้งานไม่ได้ ต้องติดต่อภาค */
  cloudUnlinked: boolean;

  init: () => Promise<void>;
  /** ข้อความอธิบายเมื่อเปิดฐานข้อมูลในเครื่องไม่ได้ (โหมดส่วนตัว / เครื่องเต็ม) */
  initError: string | null;
  signIn: (role: Role) => Promise<void>;
  signInCloud: (email: string, password: string) => Promise<{ error?: string }>;
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

/**
 * สลับบทบาท นศ.↔อาจารย์ ได้ไหม — โหมดเดโมได้เสมอ (ไว้สาธิต)
 * โหมด cloud ได้เฉพาะบัญชีที่ผูกไว้ทั้งสองฝั่ง เพราะของจริงคนละคนคนละบัญชี
 */
/**
 * ชื่อคนที่กำลังทำรายการ — ใช้ลง audit log / ช่อง "ใครกด"
 * เดิม hard-code 'นศ. ก' ทุกที่ พอมีล็อกอินจริงแล้วต้องเป็นชื่อคนที่ล็อกอินอยู่จริง
 */
export function currentActor(): string {
  const st = useApp.getState();
  return st.actorName;
}

export function useCanSwitchRole(): boolean {
  const user = useApp((s) => s.cloudUser);
  if (!cloudEnabled) return true;
  return !!(user?.studentId && user?.teacherId);
}

/** กลุ่มที่อาจารย์คนนี้เป็นที่ปรึกษา — ใช้เป็นหน้าเริ่มต้น จะได้ไม่เผลอทำงานผิดกลุ่ม */
async function findMyGroup(teacherId: string): Promise<string | null> {
  const groups = await db.groups.toArray();
  return groups.find((g) => g.advisorIds.includes(teacherId))?.code ?? null;
}

/** อ่านชื่อจริงของคนใน session จากฐานข้อมูล (นศ. หรืออาจารย์ ตามบทบาท) */
async function actorNameFor(session: Session): Promise<string> {
  const row = session.role === 'teacher'
    ? await db.teachers.get(session.teacherId)
    : await db.students.get(session.studentId);
  return row?.name ?? DEMO_STUDENT_NAME;
}

/** แปลงบัญชีที่ล็อกอิน → session ที่ UI ใช้ (ยึด id จาก app_users ไม่ใช่ค่า DEMO) */
function sessionFromUser(u: AppUser): Session {
  return {
    role: u.role,
    studentId: u.studentId ?? DEMO.studentId,
    teacherId: u.teacherId ?? DEMO.teacherId,
  };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  initError: null,
  session: null,
  settings: DEFAULT_SETTINGS,
  offline: false,
  toast: null,
  sheet: null,
  installPrompt: false,
  actorName: DEMO_STUDENT_NAME,
  myGroup: null,
  cloudUser: null,
  cloudUnlinked: false,
  teacherGroup: (() => {
    try { return localStorage.getItem('teacherGroup') || 'TH-PT7'; } catch { return 'TH-PT7'; }
  })(),
  revision: 0,

  async init() {

    try {
      await seedIfEmpty();
      const settings = await getSettings();

      if (cloudEnabled) {
        // โหมด cloud: ยามต้องปล่อยผ่านก่อน ถึงจะ sync ได้ (RLS ฝั่งตู้กลางบังคับอยู่แล้ว)
        const user = await getAppUser();
        if (user) {
          const session = sessionFromUser(user);
          await kvSet('session', session);
          const mine = await findMyGroup(session.teacherId);
          set({
            ready: true, settings, session, cloudUser: user, cloudUnlinked: false,
            actorName: await actorNameFor(session),
            myGroup: mine,
            teacherGroup: mine ?? get().teacherGroup,
          });
          void initCloudSync();
        } else {
          // ยังไม่ล็อกอิน (หรือล็อกอินแล้วแต่ไม่ได้ถูกเชิญ) → ค้างที่หน้า login ไม่แตะตู้กลาง
          const signedIn = await hasCloudSession();
          set({ ready: true, settings, session: null, cloudUser: null, cloudUnlinked: signedIn });
        }
        return;
      }

      // โหมด local/แชร์เดโม: ล็อกอินปลอมแบบเดิม ทุกคนเห็นป้าย DEMO และเลือกบทบาทเอง
      const session = await kvGet<Session | null>('session', null);
      // เชิญเพิ่มลงหน้าจอโฮมเฉพาะบนจอมือถือ และเสนอครั้งเดียว
      let invite = false;
      try { invite = !session && window.innerWidth < 780 && !localStorage.getItem('installDismissed'); } catch { /* private mode */ }
      const mineLocal = session ? await findMyGroup(session.teacherId) : null;
      set({
        ready: true, settings, session, installPrompt: invite,
        actorName: session ? await actorNameFor(session) : DEMO_STUDENT_NAME,
        myGroup: mineLocal,
        teacherGroup: mineLocal ?? get().teacherGroup,
      });
  

    } catch (e) {

      // เปิด IndexedDB ไม่ได้ = ใช้แอปไม่ได้เลย ต้องบอกให้รู้ ไม่ใช่ค้างที่จอโหลด

      console.error('init failed', e);

      set({ ready: true, initError: String((e as Error)?.message ?? e) });

    }

  },

  async signInCloud(email, password) {
    const res = await signInWithPassword(email, password);
    if (res.error) return res;
    const user = await getAppUser();
    if (!user) {
      set({ cloudUnlinked: true });
      return { error: 'บัญชีนี้ยังไม่ได้ผูกกับนักศึกษา/อาจารย์ — ติดต่อภาควิชาเพื่อเพิ่มรายชื่อ' };
    }
    const session = sessionFromUser(user);
    await kvSet('session', session);
    try { localStorage.removeItem('loggedOut'); } catch { /* private mode */ }
    const myGroup = await findMyGroup(session.teacherId);
    set({
      session, cloudUser: user, cloudUnlinked: false,
      actorName: await actorNameFor(session),
      myGroup,
      teacherGroup: myGroup ?? get().teacherGroup,
    });
    void initCloudSync();
    return {};
  },

  async signIn(role) {
    const session: Session = { role, studentId: DEMO.studentId, teacherId: DEMO.teacherId };
    await kvSet('session', session);
    try { localStorage.removeItem('loggedOut'); } catch { /* private mode */ }
    set({ session, actorName: await actorNameFor(session) });
  },

  async signOut() {
    if (cloudEnabled) {
      stopCloudSync();
      await signOutCloud();
    }
    await kvSet('session', null);
    try { localStorage.setItem('loggedOut', '1'); } catch { /* private mode */ }
    set({ session: null, sheet: null, toast: null, cloudUser: null, cloudUnlinked: false });
  },

  async switchRole() {
    const cur = get().session;
    const role: Role = cur?.role === 'student' ? 'teacher' : 'student';
    const user = get().cloudUser;
    // โหมด cloud: สลับได้เฉพาะบัญชีที่ผูกไว้ทั้งสองฝั่ง (บัญชีทดสอบ/สาธิต) — ของจริงคนละคนคนละบัญชี
    if (cloudEnabled && user && !(user.studentId && user.teacherId)) return cur?.role ?? 'student';
    const session: Session = cloudEnabled && user
      ? { role, studentId: user.studentId ?? DEMO.studentId, teacherId: user.teacherId ?? DEMO.teacherId }
      : { role, studentId: DEMO.studentId, teacherId: DEMO.teacherId };
    await kvSet('session', session);
    set({ session, sheet: null, toast: null, actorName: await actorNameFor(session) });
    return role;
  },

  async resetDemo() {
    const session = get().session;
    // โหมด cloud: รีเซ็ต = ดึงความจริงจากตู้กลางลงมาใหม่ (ไม่ seed ทับ — ตู้กลางเป็นของทุกคน)
    if (cloudEnabled) await cloudReset();
    else await resetDemoData();
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
      sheet: { workpieceId, performedAt: toISODate(new Date()), withPhoto: false },
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
    const mine = get().myGroup;
    try { localStorage.setItem('teacherGroup', code); } catch { /* private mode */ }
    set({ teacherGroup: code });
    // เปิดดูกลุ่มที่ไม่ใช่ของตัวเอง = จดไว้ใน audit log
    // (ไม่ได้ห้าม เพราะอาจารย์เวรต้องข้ามกลุ่มได้จริง — แต่ต้องมีร่องรอยว่าใครดูอะไร)
    if (mine && code !== mine) {
      void logAudit(
        `เปิดดูข้อมูลกลุ่ม ${code.replace('TH-', '')} (ไม่ใช่กลุ่มที่ปรึกษาของตัวเอง)`,
        get().actorName,
        { group: code },
      );
    }
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
