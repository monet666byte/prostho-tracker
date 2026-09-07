/**
 * ซิงก์ "ค่าตั้งของภาค" ขึ้นตู้กลาง — แยกออกมาจาก cloudSync.ts โดยตั้งใจ
 *
 * ทำไมต้องมีไฟล์นี้: ค่าตั้ง (เกณฑ์ขั้นต่ำ · ชั้นปีที่เปิดแบบประเมินตนเอง · วันเตือน)
 * เก็บอยู่ในตาราง kv ซึ่ง cloudSync ไม่แตะเลย ผลคืออาจารย์กด "เปิดฟอร์มปี 5"
 * บนเครื่องตัวเอง แล้วนักศึกษาทุกคนยังเห็นว่าปิดอยู่ — ตัวนี้บล็อกการใช้จริง
 *
 * ทำไมไม่ยัด kv เข้าไปใน TABLES ของ cloudSync ให้จบ: kv มี session ที่ล็อกอินอยู่
 * กับ cloudBoundUid ปนอยู่ ซึ่งเป็นของ "เครื่องนี้" ไม่ใช่ของภาค ถ้า sync ทั้งตาราง
 * session ของอาจารย์จะไหลไปโผล่บนเครื่องนักศึกษา จึงยกขึ้นเฉพาะก้อน settings ก้อนเดียว
 *
 * กติกาชนกัน: คนเขียนทีหลังชนะ (เหมือนที่เหลือทั้งระบบ) โดยใช้เวลาจากเซิร์ฟเวอร์
 * ไม่ใช่นาฬิกาเครื่องผู้ใช้ — trigger ฝั่ง Postgres ประทับ updated_at ให้เอง
 */
import { kvGet, kvSet } from './db';
import { cloudEnabled, supabase } from '../lib/cloud';

const ROW_ID = 'app';
/** updated_at ของฉบับที่เรารับมาแล้ว — ใช้เช็คว่า "มีของใหม่มั้ย" โดยไม่ต้องเขียนทับทุก 15 วิ */
const SEEN_KEY = 'settingsSyncedAt';

type Bag = Record<string, unknown>;

/**
 * ยังมีของที่แก้ในเครื่องแต่ส่งขึ้นไม่สำเร็จ (ออฟไลน์/เน็ตสะดุด)
 * ตราบใดที่ยังค้าง ห้ามให้ของจากตู้กลางทับ ไม่งั้นสิ่งที่อาจารย์เพิ่งกดหายเงียบๆ
 * — บั๊กแบบเดียวกับที่เจอใน cloudSync คืนแรก
 */
let pending: { value: Bag; by?: string } | null = null;
/**
 * ส่งไม่ผ่านติดกันกี่ครั้งแล้ว — ครบโควตาแล้วยอมทิ้งคิว
 *
 * ⚠️ จุดนี้สำคัญกว่าที่คิด: ตราบใดที่ pending ค้าง pullSettings จะไม่รับของใหม่เลย
 * เครื่องนักศึกษาไม่มีสิทธิ์เขียนตารางนี้ (RLS) ถ้าไม่มีโควตา มันจะค้างถาวร
 * แล้วนักศึกษาจะไม่มีวันเห็นว่าอาจารย์เปิดฟอร์ม — เงียบสนิท ไม่มี error ให้ใครเห็น
 * กติกาเดียวกับ MAX_PUSH_RETRY ใน cloudSync.ts
 */
let failCount = 0;
const MAX_PUSH_RETRY = 3;

/* ── สถานะการส่ง: หน้าตั้งค่าต้องบอกให้เห็น ────────────────────────────────────
   ถ้าอาจารย์กด "เปิดฟอร์มปี 5" แล้วส่งไม่ขึ้น (เน็ตหลุด/ไม่มีสิทธิ์) หน้าจอตัวเอง
   จะขึ้นว่าเปิดแล้วทันที เพราะค่าลงเครื่องไปแล้ว — แต่นักศึกษาไม่เห็นอะไรเลย
   อาจารย์จะไม่มีทางรู้ว่าพลาด นี่คือความเงียบแบบเดียวกับบั๊กคอลัมน์หายตอน sync */
export type SettingsSyncState = 'off' | 'pending' | 'synced' | 'failed';
let state: SettingsSyncState = 'off';
const stateListeners = new Set<() => void>();

function setState(next: SettingsSyncState) {
  if (state === next) return;
  state = next;
  stateListeners.forEach((fn) => fn());
}

export const settingsSyncState = (): SettingsSyncState => state;

export function onSettingsSyncState(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

/* ── ผู้ฟัง: หน้าจอที่เปิดค้างอยู่ต้องเปลี่ยนตามทันที ── */
type Listener = (value: Bag) => void;
const listeners = new Set<Listener>();

/** สมัครฟังค่าตั้งที่ไหลลงมาจากตู้กลาง (store เรียกครั้งเดียวตอนแอปเปิด) */
export function onRemoteSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function applyRemote(value: Bag, stamp: string): Promise<void> {
  await kvSet('settings', value);
  await kvSet(SEEN_KEY, stamp);
  listeners.forEach((fn) => fn(value));
}

/**
 * ดึงค่าตั้งจากตู้กลางลงเครื่อง
 * คืน true เมื่อค่าเปลี่ยนจริง (ผู้เรียกจะได้รู้ว่าต้องรีเฟรชหน้าจอ)
 */
export async function pullSettings(): Promise<boolean> {
  if (!cloudEnabled || !supabase) return false;
  if (pending) return false; // ของเราค้างอยู่ ยังไม่รับของใหม่ทับ

  const { data, error } = await supabase
    .from('app_settings')
    .select('value, updated_at')
    .eq('id', ROW_ID)
    .maybeSingle();
  // ตารางยังไม่ถูกสร้าง (ยังไม่ได้รัน 0014) — เงียบไว้ แอปใช้ค่าในเครื่องต่อได้
  if (error || !data) return false;

  const stamp = String((data as { updated_at?: string }).updated_at ?? '');
  if (!stamp || (await kvGet<string | null>(SEEN_KEY, null)) === stamp) return false;

  const value = ((data as { value?: Bag }).value ?? {}) as Bag;
  /**
   * แถวตั้งต้นจาก migration เป็น {} ว่างเปล่า
   * ถ้าเอามาทับดื้อๆ เครื่องแรกที่เข้ามาจะลบค่าที่ภาคตั้งไว้ทิ้งทั้งหมด
   * กรณีนี้ให้ดันของในเครื่องขึ้นไปตั้งต้นแทน
   */
  if (!Object.keys(value).length) {
    const local = await kvGet<Bag | null>('settings', null);
    // ประทับเวลาไว้ก่อนเสมอ — ถ้าเราไม่มีสิทธิ์เขียน (นักศึกษา) จะได้ไม่วนลองทุก 15 วิ
    await kvSet(SEEN_KEY, stamp);
    /**
     * ⚠️ ต้องส่งแบบ "ไม่เข้าคิว" เท่านั้น
     *
     * ถ้าใช้ pushSettings ปกติ ใบนี้จะไปจอง pending ไว้ ซึ่ง pullSettings เช็คเป็นอย่างแรก
     * เครื่องนักศึกษาไม่มีสิทธิ์เขียนตารางนี้ (RLS) ใบจึงค้างและปิดทางรับค่าจากอาจารย์
     * ตัวนี้เป็นแค่การ "ตั้งต้นให้ตู้ที่ยังว่าง" ไม่ใช่สิ่งที่ผู้ใช้กด — ส่งไม่ผ่านก็ปล่อยไป
     * เดี๋ยวอาจารย์กดบันทึกครั้งหน้าก็ขึ้นเอง
     */
    if (local && Object.keys(local).length) await sendOne({ value: local }, false);
    return false;
  }

  await applyRemote(value, stamp);
  return true;
}

/**
 * ส่งค่าตั้งขึ้นตู้กลาง — เรียกทุกครั้งที่อาจารย์กดบันทึกในหน้าตั้งค่า
 * ส่งไม่ผ่าน (ออฟไลน์ / ไม่ใช่อาจารย์) = พักไว้ในคิว รอบ sync ถัดไปลองใหม่
 */
export async function pushSettings(value: Bag, by?: string): Promise<void> {
  if (!cloudEnabled || !supabase) return;
  const job = { value, by };
  pending = job;
  setState('pending');
  /**
   * ต่อคิวทีละใบ ห้ามยิงพร้อมกัน
   *
   * อาจารย์กด "ปี 5" แล้วกด "ทั้งสองชั้นปี" ต่อทันทีเป็นเรื่องปกติมาก
   * ถ้าปล่อยให้สองคำขอวิ่งขนานกัน ใบไหนถึงเซิร์ฟเวอร์ทีหลังก็ชนะ — ซึ่งอาจเป็นใบเก่า
   * ผลคือหน้าจออาจารย์ขึ้น "ทั้งสองชั้นปี" แต่ตู้กลางเก็บ "ปี 5"
   * แล้วนักศึกษาปี 6 ไม่เห็นฟอร์ม โดยที่ไม่มีใครรู้ว่าพลาดตรงไหน
   */
  const run = () => sendOne(job);
  chain = chain.then(run, run);
  await chain;
}

let chain: Promise<void> = Promise.resolve();

/** `track` = ใบนี้เป็นของที่ผู้ใช้กด ต้องคุมคิว/สถานะ · false = แค่ตั้งต้นตู้ที่ยังว่าง */
async function sendOne(job: { value: Bag; by?: string }, track = true): Promise<void> {
  if (!supabase) return;
  // มีใบใหม่กว่ารออยู่ในคิวแล้ว — ใบนี้ตกรุ่น ข้ามไปเลย ประหยัดรอบเน็ตและกันของเก่าทับ
  if (track && pending !== job) return;
  const { data, error } = await supabase
    .from('app_settings')
    .upsert({ id: ROW_ID, value: job.value, updated_by: job.by ?? null })
    .select('updated_at')
    .maybeSingle();
  if (error) {
    if (!track) return; // ตั้งต้นไม่สำเร็จก็ช่างมัน ห้ามไปแตะคิวของผู้ใช้
    // ครบโควตาแล้วยังไม่ผ่าน = เขียนไม่ได้จริงๆ ปล่อยคิวทิ้ง (ค่าในเครื่องยังอยู่ครบ)
    // ต้องปล่อย ไม่งั้น pullSettings ถูกล็อกถาวรตามคอมเมนต์ที่ failCount
    if (++failCount >= MAX_PUSH_RETRY) {
      if (pending === job) pending = null;
      failCount = 0;
      setState('failed');
    }
    return;
  }
  if (track) {
    // เคลียร์เฉพาะใบของตัวเอง — ถ้ามีใบใหม่กว่าเข้าคิวระหว่างรอเน็ต ห้ามไปล้างของเขา
    if (pending === job) pending = null;
    failCount = 0;
    setState('synced');
  }
  // จำเวลาที่เซิร์ฟเวอร์ประทับให้ ไม่งั้น pull รอบหน้าจะดึงค่าที่เราเพิ่งส่งกลับลงมาเปล่าๆ
  const stamp = (data as { updated_at?: string } | null)?.updated_at;
  if (stamp) await kvSet(SEEN_KEY, String(stamp));
}

/** ลองส่งของค้างขึ้นอีกรอบ — cloudSync เรียกใน loop 15 วิ และตอนเน็ตกลับมา */
export async function flushSettings(): Promise<void> {
  const job = pending;
  if (!job) return;
  const run = () => sendOne(job); // ใบเดิม ไม่ใช่ใบใหม่ — ไม่งั้น pending !== job แล้วจะถูกข้ามทิ้ง
  chain = chain.then(run, run);
  await chain;
}
