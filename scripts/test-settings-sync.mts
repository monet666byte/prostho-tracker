/**
 * ทดสอบ src/data/settingsSync.ts — รันด้วย `npm run test:settings`
 *
 * ทำไมต้องมี: โมดูลนี้พังแบบ "เงียบ" ทั้งหมด ไม่มี error ให้ใครเห็น
 * อาจารย์กดเปิดฟอร์มแล้วคิดว่าเปิดแล้ว · นักศึกษาไม่เห็นฟอร์มแล้วคิดว่าภาคยังไม่เปิด
 * ตอนเขียนรอบแรกมีบั๊กจริงที่เทสต์จับได้: เครื่องนักศึกษาเขียนตารางไม่ได้ (RLS)
 * ใบที่ส่งไม่ผ่านจึงค้างคิว แล้วคิวที่ค้างไปปิดทางรับค่าจากอาจารย์ = ค้างถาวร
 *
 * วิธีทำงาน: ก๊อปไฟล์จริงไปไว้ที่ temp แล้วตัดสอง import ทิ้ง ใส่ของปลอมแทน
 * (โปรเจกต์นี้ยังไม่มี test framework — ถ้าวันหนึ่งใส่ vitest ให้ย้ายมาเป็น .test.ts ปกติ)
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const FAKE = `
export const store: Record<string, unknown> = {};
export const kvGet = async (k: string, f: unknown) => (k in store ? store[k] : f);
export const kvSet = async (k: string, v: unknown) => { store[k] = v; };
export const cloudEnabled = true;
export const log: string[] = [];
let failNext = 0;
export function setFailNext(n: number) { failNext = n; }
/* 'refuse' = ตู้ตอบรหัสปฏิเสธ (RLS 42501) · 'network' = ส่งไม่ถึง (supabase-js ห่อ fetch ที่ล้มเป็น error ไม่มี code) */
let failKind: 'refuse' | 'network' = 'refuse';
export function setFailKind(k: 'refuse' | 'network') { failKind = k; }
let remote: { value: unknown; updated_at: string } | null = null;
export function setRemote(r: typeof remote) { remote = r; }
let clock = 0;
export const supabase = {
  from() {
    return {
      upsert(row: { value: unknown }) {
        const self = {
          select: () => self,
          async maybeSingle() {
            await new Promise((r) => setTimeout(r, 5));
            if (failNext > 0) { failNext--; log.push('FAIL ' + JSON.stringify(row.value)); return { data: null, error: failKind === 'refuse' ? { message: 'denied', code: '42501' } : { message: 'TypeError: Failed to fetch' } }; }
            log.push('OK ' + JSON.stringify(row.value));
            return { data: { updated_at: 't' + (++clock) }, error: null };
          },
        };
        return self;
      },
      select() {
        const self = {
          eq: () => self,
          async maybeSingle() {
            await new Promise((r) => setTimeout(r, 3));
            log.push('PULL');
            return remote ? { data: remote, error: null } : { data: null, error: { message: 'no table' } };
          },
        };
        return self;
      },
    };
  },
};
`;

const real = readFileSync(join(root, 'src/data/settingsSync.ts'), 'utf8')
  .replace("import { kvGet, kvSet } from './db';", '')
  .replace("import { cloudEnabled, supabase } from '../lib/cloud';", '');
const dir = mkdtempSync(join(tmpdir(), 'settings-sync-'));
const mod = join(dir, 'mod.mts');
writeFileSync(mod, FAKE + real);

const m = await import(mod);
const { pushSettings, flushSettings, pullSettings, settingsSyncState, onRemoteSettings,
        store, log, setFailNext, setFailKind, setRemote } = m;

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  → ' + extra : ''));
  if (!ok) failures++;
}

/* ── ① ส่งขึ้นตู้กลาง ───────────────────────────────────────────────────── */
console.log('\nส่งค่าตั้งขึ้นตู้กลาง');
log.length = 0;
await Promise.all([
  pushSettings({ saOpenYears: [5] }),
  pushSettings({ saOpenYears: [6] }),
  pushSettings({ saOpenYears: [5, 6] }),
]);
check('กดรัว 3 ที ตู้กลางจบที่ใบสุดท้าย', log.at(-1) === 'OK {"saOpenYears":[5,6]}', JSON.stringify(log));
check('ใบที่ตกรุ่นไม่ถูกส่ง', log.length === 1, 'ส่งจริง ' + log.length + ' ครั้ง');
check('สถานะขึ้นว่าส่งแล้ว', settingsSyncState() === 'synced');

log.length = 0;
setFailNext(2);
await pushSettings({ stale: 21 });
check('ครั้งแรกพลาด → ยังค้างคิว', settingsSyncState() === 'pending', settingsSyncState());
await flushSettings();
await flushSettings();
check('ลองใหม่จนผ่าน ค่าเดิมไม่หาย', log.at(-1) === 'OK {"stale":21}', JSON.stringify(log));

log.length = 0;
setFailNext(99);
await pushSettings({ stale: 7 });
await flushSettings();
await flushSettings();
check('พลาดครบโควตาแล้วปล่อยคิว', settingsSyncState() === 'failed', settingsSyncState());
setFailNext(0);
await flushSettings();
check('ปล่อยแล้วจริง (flush ไม่ส่งซ้ำ)', !log.some((l: string) => l.startsWith('OK')), JSON.stringify(log));
check('จำ updated_at ของฝั่งเซิร์ฟเวอร์', typeof store.settingsSyncedAt === 'string', String(store.settingsSyncedAt));

/* ── ② ดึงค่าลงเครื่อง ──────────────────────────────────────────────────── */
/* ไวไฟห้องคลินิกหลุด ~45 วิ = ล้ม 3 รอบ · เดิมนับทุก error รวมกัน → คิวถูกทิ้ง ค่าที่อาจารย์ตั้งไม่ขึ้นตู้เลย
   ทั้งที่หน้าจอเขียนว่า "จะลองใหม่เมื่อเน็ตกลับมา" (กติกาเดียวกับ isRefusal ใน cloudSync.ts) */
console.log('\nเน็ตหลุดนานกว่าโควตา แล้วกลับมา');
log.length = 0;
setFailKind('network');
setFailNext(99);
await pushSettings({ stale: 28 }, 'อ. ทดสอบ');
for (let i = 0; i < 5; i++) await flushSettings();
check('เน็ตหลุด 6 รอบ → ยังค้างคิว ไม่ถูกทิ้ง', settingsSyncState() === 'pending', settingsSyncState());
setFailNext(0);
await flushSettings();
check('เน็ตกลับมา → ค่าที่ตั้งไว้ขึ้นตู้จริง', log.at(-1) === 'OK {"stale":28}', JSON.stringify(log.slice(-2)));
check('สถานะขึ้นว่าส่งแล้ว', settingsSyncState() === 'synced', settingsSyncState());
setFailKind('refuse');

console.log('\nดึงค่าตั้งลงเครื่อง');
let heard = 0;
onRemoteSettings(() => heard++);

setRemote(null);
check('ยังไม่ได้รัน migration 0014 → เงียบไว้ ไม่พังแอป', (await pullSettings()) === false);

setRemote({ value: { saOpenYears: [5, 6], stale: 14 }, updated_at: 'r1' });
check('รับค่าใหม่จากตู้กลาง', (await pullSettings()) === true);
check('ค่าลงเครื่องจริง', JSON.stringify((store.settings as { saOpenYears?: number[] })?.saOpenYears) === '[5,6]');
check('หน้าจอที่เปิดค้างได้รับแจ้ง', heard === 1, String(heard));
check('ดึงซ้ำที่ค่าเดิม ไม่ทำอะไร', (await pullSettings()) === false);
check('ไม่แจ้งหน้าจอซ้ำ', heard === 1, String(heard));

store.settings = { saOpenYears: [5], stale: 30 };
delete store.settingsSyncedAt;
setRemote({ value: {}, updated_at: 'r2' });
log.length = 0;
setFailNext(0);
check('แถวตั้งต้นว่าง → ไม่ทับค่าในเครื่อง', (await pullSettings()) === false);
check('ค่าในเครื่องยังอยู่ครบ', JSON.stringify((store.settings as { saOpenYears?: number[] })?.saOpenYears) === '[5]');
check('ดันค่าตั้งต้นขึ้นตู้กลางแทน', log.some((l: string) => l.startsWith('OK')), JSON.stringify(log));

// บั๊กจริงที่เทสต์ชุดนี้จับได้รอบแรก — ห้ามหลุดอีก
store.settings = { saOpenYears: [] };
delete store.settingsSyncedAt;
setRemote({ value: {}, updated_at: 'r3' });
setFailNext(99);
await pullSettings();
setRemote({ value: { saOpenYears: [5, 6] }, updated_at: 'r4' });
let got = false;
for (let i = 0; i < 4; i++) got = (await pullSettings()) || got;
check('เครื่องที่เขียนไม่ได้ (นักศึกษา) ยังรับค่าจากอาจารย์ได้', got, JSON.stringify(store.settings));

/* ── ③ ปิดแท็บตอนค่าตั้งยังค้างส่ง ──────────────────────────────────────────
   อาจารย์กดเปิดฟอร์มตอนเน็ตหลุดแล้วปิดแท็บ — เปิดใหม่ต้องยังส่งค่านั้น และห้ามให้ของบนตู้มาทับก่อน
   "เปิดใหม่" = โหลดโมดูลสำเนาที่สอง (สถานะในหน่วยความจำว่าง) โดยยก kv ของเครื่องเดิมไปให้ */
console.log('\nปิดแท็บตอนค่าตั้งยังค้างส่ง');
setFailNext(1);
await pushSettings({ saOpenYears: [6] });
check('ค้างส่ง → มีสำเนาคิวในเครื่อง', !!store.settingsOutbox, JSON.stringify(store.settingsOutbox));
const mod2 = join(dir, 'mod2.mts');
writeFileSync(mod2, FAKE + real);
const m2 = await import(mod2);
Object.assign(m2.store, store);
m2.setRemote({ value: { saOpenYears: [] }, updated_at: 'r9' });
const pulled = await m2.pullSettings();
check('เปิดใหม่: ของบนตู้ไม่ทับค่าที่ยังค้างส่ง', pulled === false, String(pulled));
await m2.flushSettings();
check('เปิดใหม่: ค่าที่ค้างถูกส่งขึ้นจริง', m2.log.at(-1) === 'OK {"saOpenYears":[6]}', JSON.stringify(m2.log));
check('ส่งแล้วสำเนาคิวว่าง', m2.store.settingsOutbox === null, JSON.stringify(m2.store.settingsOutbox));

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
