/**
 * เครื่องยนต์ sync — สะพานระหว่าง "ลิ้นชักในเครื่อง" (IndexedDB) กับ "ตู้แฟ้มกลาง" (Supabase)
 *
 * สถาปัตยกรรม: local-first
 *   - UI ทั้งแอปอ่าน/เขียน IndexedDB เหมือนเดิมทุกประการ (ไฟล์นี้ไม่แตะ UI เลย)
 *   - middleware ดัก "ทุกการเขียน" ลง IndexedDB → เข้าคิวส่งขึ้นตู้กลาง (debounce)
 *   - ตอนเปิดแอป: ดึงทั้งตู้ลงมาทับลิ้นชัก (remote-wins) แล้วดันของท้องถิ่นขึ้นไป (upsert)
 *   - realtime: มีใครแก้ตู้กลาง → แถวนั้นไหลลงลิ้นชักเราทันที (อาจารย์เห็น นศ. กด step สดๆ)
 *
 * ระดับความเชื่อถือ = pilot: ชนกันใช้ "คนเขียนทีหลังชนะ" · ยังไม่มี auth (ดู TODO ใน 0001_init.sql)
 */
import { db, kvGet, kvSet } from './db';
import { cloudEnabled, supabase } from '../lib/cloud';

/* ── ตารางที่ sync + กติกาแปลงชื่อคอลัมน์ camelCase ↔ snake_case ── */

interface TableDef {
  local: string; // ชื่อตารางใน Dexie
  remote: string; // ชื่อตารางใน Postgres
  pk: string; // primary key ฝั่ง local (camelCase)
  rename?: Record<string, string>; // ชื่อพิเศษ local → remote (นอกเหนือ snake_case อัตโนมัติ)
}

const TABLES: TableDef[] = [
  { local: 'teachers', remote: 'teachers', pk: 'id' },
  { local: 'students', remote: 'students', pk: 'id' },
  { local: 'groups', remote: 'groups', pk: 'code' },
  { local: 'patients', remote: 'patients', pk: 'id' },
  { local: 'workpieces', remote: 'workpieces', pk: 'id' },
  { local: 'updates', remote: 'updates', pk: 'id' },
  { local: 'photos', remote: 'photos', pk: 'id' },
  { local: 'checkins', remote: 'checkins', pk: 'id' },
  { local: 'reviews', remote: 'reviews', pk: 'id', rename: { by: 'by_who', at: 'at_when' } },
  { local: 'submissions', remote: 'submissions', pk: 'id' },
  { local: 'issues', remote: 'issues', pk: 'studentId' },
  { local: 'audit', remote: 'audit', pk: 'id', rename: { at: 'at_when' } },
];

const byLocal = new Map(TABLES.map((t) => [t.local, t]));
const byRemote = new Map(TABLES.map((t) => [t.remote, t]));

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

function toRow(def: TableDef, obj: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'updated_at') continue;
    row[def.rename?.[k] ?? toSnake(k)] = v === undefined ? null : v;
  }
  row.updated_at = new Date().toISOString();
  return row;
}

function fromRow(def: TableDef, row: Record<string, unknown>): Record<string, unknown> {
  const back = new Map(Object.entries(def.rename ?? {}).map(([l, r]) => [r, l]));
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'updated_at') {
      obj.updated_at = v; // เก็บไว้ — ตัวบอกว่าแถวนี้ฉบับไหน (toRow จะทิ้งแล้วประทับใหม่ตอนส่งขึ้น)
      continue;
    }
    const localKey = back.get(k) ?? k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    obj[localKey] = v === null ? undefined : v;
  }
  return obj;
}

/* ── คิวส่งขึ้น (in-memory + pushAll ตอนเปิดแอปกันตกหล่น) ── */

let paused = false; // ปิดชั่วคราวระหว่าง seed/reset — กันข้อมูล fixture ไหลมั่ว
// กัน echo แบบระบุรายแถว: เฉพาะ "แถวที่กำลัง apply จากตู้กลาง" เท่านั้นที่ไม่ต้องส่งกลับ
// (เคยใช้ธงคลุมทั้งระบบ → งานที่ผู้ใช้กดระหว่างจังหวะ apply หายไปเฉยๆ — บั๊กคืนแรก)
const applyingKeys = new Set<string>();
const keyOf = (local: string, pk: unknown) => local + '|' + String(pk);
const dirty = new Map<string, Set<unknown>>(); // local table → set ของ pk ที่ค้างส่ง
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function setSyncPaused(v: boolean) {
  paused = v;
}

function markDirty(local: string, keys: unknown[]) {
  if (!cloudEnabled || paused || !byLocal.has(local)) return;
  let set = dirty.get(local);
  if (!set) dirty.set(local, (set = new Set()));
  keys.forEach((k) => k !== undefined && !applyingKeys.has(keyOf(local, k)) && set!.add(k));
  if (set.size && !flushTimer) flushTimer = setTimeout(() => void flush(), 1500);
}

/** middleware ดักทุกการเขียนของ Dexie — จดว่าแถวไหนต้องส่งขึ้นตู้กลาง */
db.use({
  stack: 'dbcore',
  name: 'cloud-outbox',
  create(down) {
    return {
      ...down,
      table(name: string) {
        const t = down.table(name);
        const def = byLocal.get(name);
        return {
          ...t,
          mutate(req) {
            if (def && !paused && cloudEnabled) {
              if (req.type === 'add' || req.type === 'put') {
                markDirty(name, (req.values as Record<string, unknown>[]).map((v) => v[def.pk]));
              } else if (req.type === 'delete') {
                markDelete(name, req.keys as unknown[]);
              }
              // deleteRange (เช่น table.clear) เกิดเฉพาะตอน reset ซึ่ง paused อยู่แล้ว
            }
            return t.mutate(req);
          },
        };
      },
    };
  },
});

const pendingDeletes = new Map<string, Set<unknown>>();

function markDelete(local: string, keys: unknown[]) {
  let set = pendingDeletes.get(local);
  if (!set) pendingDeletes.set(local, (set = new Set()));
  keys.forEach((k) => !applyingKeys.has(keyOf(local, k)) && set!.add(k));
  if (set.size && !flushTimer) flushTimer = setTimeout(() => void flush(), 1500);
}

/** ตารางไหนส่งไม่ผ่านซ้ำๆ (ยามปฏิเสธถาวร) — เลิกลองหลังครบโควตา ไม่วนรบกวนเน็ตทุก 15 วิ */
const failCount = new Map<string, number>();
const MAX_PUSH_RETRY = 3;

/** ส่งของค้างขึ้นตู้กลาง */
async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!supabase) return;
  // ลบก่อน (แถวที่ถูกลบ local)
  for (const [local, keys] of [...pendingDeletes]) {
    const def = byLocal.get(local)!;
    const ids = [...keys];
    if (!ids.length) continue;
    const { error } = await supabase.from(def.remote).delete().in(def.rename?.[def.pk] ?? toSnake(def.pk), ids);
    if (!error) pendingDeletes.delete(local);
  }
  // แล้วค่อย upsert แถวที่แก้ (อ่านสถานะล่าสุดจาก dexie ตอนส่งจริง)
  for (const [local, keys] of [...dirty]) {
    const def = byLocal.get(local)!;
    const ids = [...keys];
    if (!ids.length) continue;
    const objs = (await db.table(local).bulkGet(ids as never[])).filter(Boolean) as Record<string, unknown>[];
    if (objs.length) {
      const { error } = await supabase.from(def.remote).upsert(objs.map((o) => toRow(def, o)));
      if (error) {
        const n = (failCount.get(local) ?? 0) + 1;
        failCount.set(local, n);
        if (n < MAX_PUSH_RETRY) continue; // เก็บไว้ลองใหม่รอบหน้า
        // ครบโควตาแล้วยังไม่ผ่าน = ไม่มีสิทธิ์เขียนตารางนี้จริงๆ ทิ้งคิวไป (ข้อมูลยังอยู่ในเครื่อง)
      } else {
        failCount.delete(local);
      }
    }
    dirty.delete(local);
  }
}

/* ── ดึงลง / ดันขึ้น ทั้งตู้ ── */

async function applyRemote(local: string, pks: unknown[], fn: () => Promise<void>) {
  pks.forEach((k) => applyingKeys.add(keyOf(local, k)));
  try {
    await fn();
  } finally {
    pks.forEach((k) => applyingKeys.delete(keyOf(local, k)));
  }
}

const lastPulled = new Map<string, string>(); // remote table → max updated_at ที่ดึงล่าสุด

export async function pullAll(): Promise<void> {
  if (!supabase) return;
  for (const def of TABLES) {
    // เช็คก่อนว่าตารางนี้มีอะไรใหม่มั้ย — ส่วนใหญ่ไม่มี จะได้ไม่ต้องดึง/เขียนทับให้เสี่ยง
    const head = await supabase.from(def.remote).select('updated_at').order('updated_at', { ascending: false }).limit(1);
    if (head.error) continue;
    const remoteMax = (head.data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? '';
    if (remoteMax && lastPulled.get(def.remote) === remoteMax) continue;

    // ⚠️ เซิร์ฟเวอร์ตัดผลลัพธ์ที่ 1,000 แถวเสมอ (ไม่ว่าจะขอเท่าไหร่) — ต้องดึงทีละหน้า
    // ไม่งั้นข้อมูลหายเงียบๆ พอโตเกินพัน (เจอตอนทดสอบ: มี 1,215 คาบ ดึงได้ 1,000)
    const remotePkCol = def.rename?.[def.pk] ?? toSnake(def.pk);
    const PAGE = 1000;
    const data: Record<string, unknown>[] = [];
    let failed = false;
    for (let from = 0; ; from += PAGE) {
      const page = await supabase
        .from(def.remote)
        .select('*')
        .order(remotePkCol, { ascending: true })
        .range(from, from + PAGE - 1);
      if (page.error) { failed = true; break; }
      data.push(...((page.data ?? []) as Record<string, unknown>[]));
      if ((page.data?.length ?? 0) < PAGE) break;
      if (from > 200_000) break; // กันวนไม่รู้จบถ้ามีอะไรผิดปกติ
    }
    if (failed) continue;
    // ห้ามทับแถวที่มีงานค้างส่งอยู่ — ไม่งั้น pull ฉบับเก่าจะกลืนสิ่งที่ผู้ใช้เพิ่งกด (บั๊กที่เจอคืนแรก)
    const skip = new Set([...(dirty.get(def.local) ?? []), ...(pendingDeletes.get(def.local) ?? [])]);
    const rows = data.filter((r) => !skip.has(r[remotePkCol]));
    await applyRemote(def.local, rows.map((r) => r[remotePkCol]), async () => {
      await db.table(def.local).bulkPut(rows.map((r) => fromRow(def, r)) as never[]);
    });
    lastPulled.set(def.remote, remoteMax);
  }
}

export async function pushAll(): Promise<void> {
  if (!supabase) return;
  for (const def of TABLES) {
    const objs = (await db.table(def.local).toArray()) as Record<string, unknown>[];
    if (!objs.length) continue;
    // ชุดใหญ่แบ่งก้อนละ 500 กัน payload บวม
    for (let i = 0; i < objs.length; i += 500) {
      await supabase.from(def.remote).upsert(objs.slice(i, i + 500).map((o) => toRow(def, o)));
    }
  }
}

/* ── realtime: ตู้กลางขยับ → ลิ้นชักเราขยับตาม ── */

function subscribeRealtime() {
  if (!supabase) return;
  supabase
    .channel('prostho-db')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      const def = byRemote.get(payload.table);
      if (!def) return;
      const remotePk = def.rename?.[def.pk] ?? toSnake(def.pk);
      const key = ((payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>)[remotePk];
      if (key === undefined) return;
      void applyRemote(def.local, [key], async () => {
        if (payload.eventType === 'DELETE') await db.table(def.local).delete(key as never);
        else await db.table(def.local).put(fromRow(def, payload.new as Record<string, unknown>) as never);
      });
    })
    .subscribe();
}

/* ── จุดสตาร์ท ── */

let started = false;

/**
 * ผูกลิ้นชักในเครื่องเข้ากับบัญชีที่ล็อกอิน
 *
 * จำเป็นเพราะพอมี RLS รายแถวแล้ว "ลิ้นชักต้องเป็นกระจกสะท้อนสิ่งที่บัญชีนี้มีสิทธิ์เห็น" เท่านั้น
 * - ข้อมูลตัวอย่าง (fixture 96 คน) ที่ seed ไว้ ไม่ใช่ของเรา → ต้องล้างทิ้ง ไม่งั้น push ขึ้นไปก็โดนปฏิเสธ
 * - สลับบัญชีบนเครื่องเดียวกัน → ของคนก่อนต้องไม่ค้าง
 * ล้างเฉพาะตอน "บัญชีเปลี่ยน" — ล็อกอินคนเดิมซ้ำไม่ล้าง งานที่ทำค้างไว้ตอนออฟไลน์จึงไม่หาย
 */
/**
 * เลขรุ่นของ "กติกาสิทธิ์" — ขยับเลขนี้เมื่อ policy เปลี่ยนจนสิ่งที่แต่ละคนมองเห็นเปลี่ยนไป
 * ผลคือทุกเครื่องล้างลิ้นชักแล้วดึงใหม่ครั้งเดียว (ของเก่าที่ไม่มีสิทธิ์เห็นแล้วจะหายไปด้วย)
 * v2 = migration 0004 (per-row RLS: นศ. เห็นเฉพาะของตัวเอง)
 */
const POLICY_VERSION = 'v2';

async function bindToUser(uid: string): Promise<boolean> {
  const key = `${uid}@${POLICY_VERSION}`;
  const bound = await kvGet<string | null>('cloudBoundUid', null);
  if (bound === key) return false;
  setSyncPaused(true);
  try {
    for (const def of TABLES) await db.table(def.local).clear();
    dirty.clear();
    pendingDeletes.clear();
    lastPulled.clear();
  } finally {
    setSyncPaused(false);
  }
  await kvSet('cloudBoundUid', key);
  return true;
}

/** เรียกครั้งเดียวตอนแอปเปิด (หลังล็อกอินสำเร็จ) — ไม่มีกุญแจ/ไม่ได้ล็อกอิน = ไม่ทำอะไรเลย */
export async function initCloudSync(): Promise<void> {
  if (!cloudEnabled || started) return;
  started = true;
  try {
    const { data: auth } = await supabase!.auth.getUser();
    if (!auth.user) {
      started = false;
      return; // ยังไม่ล็อกอิน — ไม่แตะตู้กลาง
    }
    const freshBind = await bindToUser(auth.user.id);

    const { count, error } = await supabase!.from('students').select('*', { count: 'exact', head: true });
    if (error) {
      // ตารางยังไม่ถูกสร้าง (migration ยังไม่รัน) หรือต่อไม่ได้ — เงียบไว้ แอปทำงาน local ต่อ
      started = false;
      return;
    }
    if ((count ?? 0) === 0 && !freshBind) {
      // ตู้กลางยังว่างจริงๆ (ครั้งแรกสุดของทั้งระบบ) → เอา fixture ในเครื่องขึ้นไปตั้งต้น
      await pushAll();
    } else {
      await pullAll();
      // เพิ่งผูกบัญชีใหม่ = ลิ้นชักเพิ่งล้าง ไม่มีอะไรต้องดันขึ้น (และกันดัน fixture ของคนอื่น)
      if (!freshBind) await pushAll(); // ดันของท้องถิ่นที่ตู้ยังไม่มี (กันงานหายช่วงออฟไลน์)
    }
    subscribeRealtime();
    // polling สำรอง: ตารางที่ยังไม่ได้สมัคร realtime publication (0002) ก็ยังเห็นกันภายใน ~15 วิ
    // ลำดับสำคัญ: ดันของค้างขึ้นก่อนค่อยดึงลง — กันของที่เพิ่งพิมพ์ถูกฉบับเก่าบนตู้ทับ
    setInterval(() => {
      void (async () => {
        await flush();
        await pullAll();
      })();
    }, 15_000);
    window.addEventListener('online', () => void flush());
    // เปิดจอ/สลับกลับมาที่แอป → sync ทันที (สำคัญกับมือถือที่พักหน้าจอบ่อย — ตอนพักเบราว์เซอร์หน่วง timer)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void (async () => {
          await flush();
          await pullAll();
        })();
      }
    });
  } catch {
    // ต่อตู้กลางไม่ได้ (เน็ตล่ม ฯลฯ) — แอปทำงาน local ต่อได้ปกติ
  }
}

/** ออกจากระบบ — ปลดสถานะ sync ให้ล็อกอินรอบหน้าเริ่มใหม่สะอาดๆ */
export function stopCloudSync(): void {
  started = false;
  dirty.clear();
  pendingDeletes.clear();
  lastPulled.clear();
  supabase?.removeAllChannels();
}

/** รีเซ็ตในโหมด cloud = ล้างลิ้นชักแล้วดึงความจริงจากตู้กลางลงมาใหม่ (ไม่ seed ทับ) */
export async function cloudReset(): Promise<void> {
  setSyncPaused(true);
  try {
    for (const def of TABLES) await db.table(def.local).clear();
    lastPulled.clear(); // ไม่งั้นตัวเช็ค "ไม่มีอะไรใหม่" จะข้ามการดึงกลับ
  } finally {
    setSyncPaused(false);
  }
  await pullAll();
}
