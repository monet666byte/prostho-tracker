/**
 * กู้ข้อมูลจากสำเนา → ตู้แฟ้มกลาง  (ตรงข้ามกับ scripts/backup.ts)
 *
 * ทำไมต้องมี (12 ก.ย. 69): เรามี `npm run backup` มาตั้งแต่ ส.ค. แต่ **ไม่มีอะไรกู้กลับเลย**
 * สำเนาที่ไม่เคยลองกู้ยังไม่นับว่าเป็นสำเนา — วันที่ข้อมูลหายจริงคือวันที่แย่ที่สุด
 * ที่จะมาค้นว่ากู้ยังไง · ตอนนี้ระบบยังไม่มีข้อมูลผู้ป่วยจริง = ซ้อมพังได้ฟรี
 *
 * ─── วิธีใช้ ────────────────────────────────────────────────────────────────
 *   npm run restore                    ตรวจสำเนาชุดล่าสุดว่ากู้ได้จริงไหม (ไม่แตะเซิร์ฟเวอร์)
 *   npm run restore -- --dry-run       ต่อเซิร์ฟเวอร์ เทียบว่าจะเขียนอะไรทับอะไร (ยังไม่เขียน)
 *   npm run restore -- --yes           เขียนจริง
 *   npm run restore -- 2026-08-29      เลือกชุดสำเนา (ค่าเริ่มต้น = ชุดล่าสุด)
 *   npm run restore -- --tables=patients,workpieces     กู้เฉพาะบางตาราง
 *
 * ─── กู้เข้าเซิร์ฟเวอร์ "คนละตัว" (ซ้อมกู้ / ย้ายเข้าเซิร์ฟเวอร์ภาค) ─────────
 * ใส่ใน .env.local แล้วสคริปต์จะเขียนไปที่ปลายทางใหม่ ไม่แตะตัวจริง:
 *   RESTORE_URL=https://xxxx.supabase.co
 *   RESTORE_ANON_KEY=...
 *   RESTORE_EMAIL=...        ← ต้องเป็นบัญชี "อาจารย์" บนปลายทาง (เหตุผล ⓷ ข้างล่าง)
 *   RESTORE_PASSWORD=...
 *
 * ─── สามเรื่องที่ทำให้การกู้ข้อมูลไม่ใช่แค่ "ยัดแถวกลับ" ───────────────────
 * ⓵ **ห้ามใช้ service key กู้ตาราง `checkins`** — trigger `checkin_scoring_guard` (0017)
 *    เช็ค `is_teacher()` ซึ่งอ่านจาก `auth.uid()` · service key ไม่มี uid → นับเป็น "ไม่ใช่อาจารย์"
 *    ผล: แถวที่มีคะแนนถูก **raise exception ตอน insert** และตอน update จะถูก
 *    **คงค่าเดิมไว้เงียบๆ** (คะแนน/ผู้ประเมิน/เวลาเช็คอินหายโดยไม่มี error)
 *    — คือการกู้ที่ดูว่าสำเร็จ แต่คะแนนของ 1,215 คาบหายไป
 *    จึงบังคับให้ล็อกอินด้วยอีเมล/รหัสของอาจารย์เท่านั้น
 * ⓶ **`audit` เขียนซ้ำไม่ได้** — trigger `audit_no_change` (0009) ห้าม update/delete
 *    ต้องยิงแบบ "มีแล้วข้าม" (ignore-duplicates) ไม่ใช่ upsert
 *    และ `audit_stamp` จะประทับ `actor_uid` เป็นคนที่กู้ข้อมูล ไม่ใช่คนเดิม — บันทึกไว้ในรายงาน
 * ⓷ **กู้เข้าโปรเจกต์ว่างเปล่าไม่ได้ทันที** — `app_users.uid` อ้างถึง `auth.users` ซึ่ง
 *    โปรเจกต์ใหม่ยังไม่มี และ `is_teacher()` ก็อ่านจาก `app_users` ที่ยังว่าง
 *    ลำดับที่ใช้ได้จริง: สร้างบัญชีอาจารย์ในหน้า Authentication ก่อน → ล็อกอิน →
 *    ค่อยกู้ที่เหลือ · สคริปต์ตรวจให้และบอกตรงๆ ถ้าปลายทางยังไม่พร้อม
 *
 * ⚠️ `updated_at` ของทุกแถวจะกลายเป็นเวลาที่กู้ (trigger `zz_touch_updated_at` ของ 0017)
 *    ไม่ใช่บั๊ก — และจำเป็น เพราะเครื่องของนักศึกษาดูค่านี้เพื่อรู้ว่าต้องดึงอะไรลงใหม่
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ลำดับการกู้ — ตารางแม่ก่อนตารางลูก
 *
 * ตารางของแอปไม่มี foreign key ระหว่างกัน (ตรวจ 12 ก.ย. 69 — มีแค่ `app_users.uid`
 * ที่อ้าง `auth.users`) จึงไม่มีอะไร "พัง" ถ้าสลับลำดับ แต่ยังเรียงตามความหมายไว้
 * เพื่อให้คนที่นั่งดูจอตอนกู้ข้อมูลเห็นของสำคัญกลับมาก่อน และถ้าต้องหยุดกลางทาง
 * ของที่ได้กลับมาแล้วยังใช้งานเป็นเรื่องเป็นราว
 *
 * `mode` บอกวิธียิง:
 *   'upsert' = ทับด้วยของในสำเนา (ค่าเริ่มต้น)
 *   'insert-missing' = เขียนเฉพาะแถวที่ยังไม่มี (สำหรับ audit ที่แก้ไม่ได้ตามการออกแบบ)
 */
export const PLAN: Array<{ table: string; pk: string; mode: 'upsert' | 'insert-missing'; note?: string }> = [
  { table: 'teachers', pk: 'id', mode: 'upsert' },
  { table: 'students', pk: 'id', mode: 'upsert',
    note: 'trigger students_merge_gates (0017) "รวม" ช่อง gates ตอน update ไม่ได้ทับ — ประตูที่เคยติ๊กไว้บนเซิร์ฟเวอร์จะไม่ถูกลบโดยการกู้' },
  { table: 'groups', pk: 'code', mode: 'upsert' },
  { table: 'patients', pk: 'id', mode: 'upsert' },
  { table: 'workpieces', pk: 'id', mode: 'upsert' },
  { table: 'updates', pk: 'id', mode: 'upsert' },
  { table: 'checkins', pk: 'id', mode: 'upsert',
    note: 'ต้องล็อกอินเป็นอาจารย์ ไม่งั้นคะแนนหายเงียบ (ดูหัวไฟล์ ⓵)' },
  { table: 'reviews', pk: 'id', mode: 'upsert' },
  { table: 'submissions', pk: 'id', mode: 'upsert' },
  { table: 'issues', pk: 'student_id', mode: 'upsert' },
  { table: 'self_assessments', pk: 'id', mode: 'upsert' },
  { table: 'sect2_records', pk: 'id', mode: 'upsert' },
  { table: 'sect3_records', pk: 'id', mode: 'upsert' },
  { table: 'app_settings', pk: 'id', mode: 'upsert' },
  { table: 'pdpa_policy', pk: 'id', mode: 'upsert' },
  { table: 'invites', pk: 'email', mode: 'upsert' },
  { table: 'audit', pk: 'id', mode: 'insert-missing',
    note: 'trigger audit_no_change (0009) ห้ามแก้ · actor_uid จะถูกประทับเป็นคนที่กู้ (ดูหัวไฟล์ ⓶)' },
  { table: 'app_users', pk: 'uid', mode: 'upsert',
    note: 'อ้าง auth.users — แถวที่บัญชีถูกลบไปแล้วจะกู้ไม่ได้ ต้องเชิญใหม่ (ดูหัวไฟล์ ⓷)' },
];

const PHOTO_BUCKET = 'case-photos';
const CHUNK = 500;

/** ตารางที่ backup.ts เก็บ — ใช้เตือนว่าสำเนาชุดนี้เก่ากว่ารายการปัจจุบันไหม */
const EXPECTED_TABLES = PLAN.map((p) => p.table);

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

/** เดินหาไฟล์รูปทั้งหมดใต้โฟลเดอร์ (คืน path แบบอ้างอิงจากโฟลเดอร์นั้น) */
function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

export interface SetCheck {
  dir: string;
  takenAt?: string;
  sourceUrl?: string;
  /** ตาราง → จำนวนแถวที่อ่านได้จริงจากไฟล์ */
  rows: Record<string, number>;
  /** ตารางที่ควรมีแต่ไม่มีไฟล์ — สำเนาชุดนี้กู้กลับไม่ครบ */
  missingTables: string[];
  /** ไฟล์ที่อ่านไม่ออก (JSON เสีย) — อันตรายที่สุด เพราะเงียบที่สุด */
  brokenFiles: string[];
  /** _meta บอกไว้เท่าไหร่ แต่ไฟล์มีจริงเท่าไหร่ — ไม่ตรงคือสำเนาถูกแก้/ก๊อปไม่ครบ */
  countMismatch: Array<{ table: string; meta: number; actual: number }>;
  /** แถว photos ที่มี storage_path แต่ไม่มีไฟล์จริงในโฟลเดอร์ */
  photoRowsWithoutFile: number;
  photoFiles: number;
  total: number;
}

/**
 * ตรวจว่าสำเนาชุดนี้ "กู้ได้จริง" ไหม — ทำได้โดยไม่ต่อเน็ต
 *
 * ต้องเป็นฟังก์ชันแยกและไม่แตะเซิร์ฟเวอร์ เพราะนี่คือสิ่งเดียวที่ควรรันบ่อยๆ
 * ทุกเดือนได้โดยไม่มีความเสี่ยง · `test:restore` เรียกตัวนี้กับสำเนาปลอมด้วย
 */
export function checkSet(dir: string): SetCheck {
  const res: SetCheck = {
    dir, rows: {}, missingTables: [], brokenFiles: [],
    countMismatch: [], photoRowsWithoutFile: 0, photoFiles: 0, total: 0,
  };

  let meta: { takenAt?: string; url?: string; tables?: Record<string, number> } = {};
  const metaPath = join(dir, '_meta.json');
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      res.takenAt = meta.takenAt;
      res.sourceUrl = meta.url;
    } catch {
      res.brokenFiles.push('_meta.json');
    }
  } else {
    res.brokenFiles.push('_meta.json (ไม่มีไฟล์)');
  }

  for (const table of EXPECTED_TABLES) {
    const file = join(dir, `${table}.json`);
    if (!existsSync(file)) {
      res.missingTables.push(table);
      continue;
    }
    let rows: unknown[];
    try {
      rows = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(rows)) throw new Error('ไม่ใช่ array');
    } catch {
      res.brokenFiles.push(`${table}.json`);
      continue;
    }
    res.rows[table] = rows.length;
    res.total += rows.length;
    const expected = meta.tables?.[table];
    if (expected != null && expected !== rows.length) {
      res.countMismatch.push({ table, meta: expected, actual: rows.length });
    }
  }

  /* รูปงาน — ของชิ้นเดียวในระบบที่หายแล้วสร้างใหม่ไม่ได้ (ถ่ายซ้ำในปากคนไข้เดิมไม่ได้)
     จึงต้องนับว่า "แถวบอกว่ามีรูป แต่โฟลเดอร์ไม่มีไฟล์" กี่ใบ ไม่ใช่แค่ว่ามีโฟลเดอร์ */
  const onDisk = new Set(walk(join(dir, 'photos')));
  res.photoFiles = onDisk.size;
  const photoFile = join(dir, 'photos.json');
  if (existsSync(photoFile)) {
    try {
      const photoRows = JSON.parse(readFileSync(photoFile, 'utf8')) as
        Array<{ storage_path?: string | null }>;
      for (const r of photoRows) {
        if (r.storage_path && !onDisk.has(r.storage_path)) res.photoRowsWithoutFile++;
      }
    } catch { /* นับเป็นไฟล์เสียไปแล้วข้างบน */ }
  }

  return res;
}

/** ชุดสำเนาล่าสุดในโฟลเดอร์ backups/ */
export function latestSet(root = 'backups'): string | null {
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return dirs.length ? join(root, dirs[dirs.length - 1]) : null;
}

export interface Target {
  url: string;
  headers: Record<string, string>;
  /** อีเมลที่ล็อกอินเข้าไป — ใส่ในรายงานให้รู้ว่ากู้ในนามใคร */
  as: string;
  isTeacher: boolean;
}

/**
 * ล็อกอินเข้าปลายทาง — **ไม่รับ service key โดยเจตนา**
 *
 * เหตุผลอยู่ในหัวไฟล์ ⓵: service key ทำให้ `is_teacher()` เป็น false แล้ว trigger
 * ของ `checkins` จะกลืนคะแนนทิ้งเงียบๆ · ยอมให้กู้ยากขึ้นหนึ่งขั้น
 * ดีกว่าได้ผลลัพธ์ที่ดูเหมือนสำเร็จแต่ข้อมูลไม่ครบ
 */
async function signIn(env: Record<string, string>): Promise<Target> {
  const url = env.RESTORE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.RESTORE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  const email = env.RESTORE_EMAIL ?? env.BACKUP_EMAIL;
  const password = env.RESTORE_PASSWORD ?? env.BACKUP_PASSWORD;

  if (!url || !key) throw new Error('ไม่เจอ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน .env.local');
  if (!email || !password) {
    throw new Error(
      'ต้องใส่ BACKUP_EMAIL / BACKUP_PASSWORD (หรือ RESTORE_EMAIL / RESTORE_PASSWORD) ใน .env.local\n' +
      '  ต้องเป็นบัญชีอาจารย์ — service key ใช้กู้ไม่ได้ เพราะ trigger ของตาราง checkins\n' +
      '  จะกลืนคะแนนทิ้งเงียบๆ (ดูคำอธิบายหัวไฟล์ scripts/restore.ts)',
    );
  }

  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  });
  const auth = await res.json();
  if (!auth.access_token) {
    throw new Error(`ล็อกอินไม่ผ่าน: ${auth.error_description ?? auth.msg ?? JSON.stringify(auth)}`);
  }
  headers.Authorization = `Bearer ${auth.access_token}`;

  /* ตรวจว่าบัญชีนี้เป็นอาจารย์จริงไหม ก่อนเริ่มเขียนอะไร — ถ้าไม่ใช่ ต้องหยุดที่นี่
     ไม่ใช่ไปรู้ตอนแถวที่ 900 ว่าคะแนนไม่ขึ้น · `app_users` อ่านได้เฉพาะเจ้าตัว/อาจารย์
     ถ้าอ่านไม่ได้เลยก็ถือว่าไม่ใช่อาจารย์ (ปลอดภัยกว่าเดาว่าใช่) */
  let isTeacher = false;
  const me = await fetch(`${url}/rest/v1/app_users?select=teacher_id&limit=5`, { headers });
  if (me.ok) {
    const rows = (await me.json()) as Array<{ teacher_id?: string | null }>;
    isTeacher = rows.some((r) => r.teacher_id != null);
  }
  return { url, headers, as: email, isTeacher };
}

/** จำนวนแถวที่ปลายทางมีอยู่ตอนนี้ — ใช้บอกว่าจะ "เติม" หรือ "ทับ" */
async function liveCount(t: Target, table: string): Promise<number | null> {
  const res = await fetch(`${t.url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...t.headers, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok) return null;
  const range = res.headers.get('content-range'); // รูปแบบ "0-0/1234"
  const n = range?.split('/')[1];
  return n && n !== '*' ? Number(n) : null;
}

export interface WriteReport {
  table: string;
  sent: number;
  ok: number;
  failed: number;
  /** ข้อความ error แรกที่เจอ — พอสำหรับตัดสินใจว่าติดที่อะไร */
  firstError?: string;
}

export async function writeTable(
  t: Target, table: string, rows: unknown[], mode: 'upsert' | 'insert-missing',
): Promise<WriteReport> {
  const rep: WriteReport = { table, sent: rows.length, ok: 0, failed: 0 };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    /* upsert = merge-duplicates · audit = ignore-duplicates เพราะ trigger ห้าม update
       (ถ้ายิง merge-duplicates ใส่ audit จะได้ exception "audit log แก้ไขหรือลบไม่ได้"
        ทั้งก้อน — 500 แถวตกเพราะแถวเดียวที่มีอยู่แล้ว) */
    const resolution = mode === 'insert-missing' ? 'ignore-duplicates' : 'merge-duplicates';
    const res = await fetch(`${t.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...t.headers, Prefer: `resolution=${resolution},return=minimal` },
      body: JSON.stringify(chunk),
    });
    if (res.ok) {
      rep.ok += chunk.length;
      continue;
    }
    const text = (await res.text()).slice(0, 200);
    /* ยิงก้อนไม่ผ่าน → ลองทีละแถว เพื่อให้ได้ "แถวไหนพัง" ไม่ใช่ "ตารางนี้พัง"
       เหตุผลเดียวกับ pushAll ใน cloudSync.ts — แถวเสียแถวเดียวห้ามลากของดีตกไปด้วย */
    for (const row of chunk) {
      const one = await fetch(`${t.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...t.headers, Prefer: `resolution=${resolution},return=minimal` },
        body: JSON.stringify([row]),
      });
      if (one.ok) rep.ok++;
      else {
        rep.failed++;
        rep.firstError ??= (await one.text()).slice(0, 200) || text;
      }
    }
  }
  return rep;
}

async function uploadPhotos(t: Target, dir: string): Promise<{ ok: number; failed: number }> {
  const files = walk(join(dir, 'photos'));
  let ok = 0;
  let failed = 0;
  for (const path of files) {
    const body = readFileSync(join(dir, 'photos', path));
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${t.url}/storage/v1/object/${PHOTO_BUCKET}/${encoded}`, {
      method: 'POST',
      headers: {
        apikey: t.headers.apikey,
        Authorization: t.headers.Authorization,
        'x-upsert': 'true', // กู้ซ้ำได้ ไม่ต้องล้างบักเก็ตก่อน
      },
      body: new Uint8Array(body),
    });
    if (res.ok) ok++;
    else failed++;
  }
  return { ok, failed };
}

function printCheck(c: SetCheck): boolean {
  console.log(`สำเนา: ${c.dir}`);
  if (c.takenAt) console.log(`  ทำเมื่อ    ${c.takenAt}`);
  if (c.sourceUrl) console.log(`  มาจาก      ${c.sourceUrl}`);
  console.log(`  อ่านได้    ${c.total} แถว จาก ${Object.keys(c.rows).length} ตาราง`);
  console.log(`  ไฟล์รูป    ${c.photoFiles} ใบ`);

  let fatal = false;
  if (c.brokenFiles.length) {
    console.error(`  ✗ ไฟล์อ่านไม่ออก: ${c.brokenFiles.join(', ')}`);
    fatal = true;
  }
  if (c.countMismatch.length) {
    for (const m of c.countMismatch) {
      console.error(`  ✗ ${m.table}: _meta บอก ${m.meta} แถว แต่ไฟล์มี ${m.actual} — สำเนาถูกแก้หรือก๊อปไม่ครบ`);
    }
    fatal = true;
  }
  if (c.missingTables.length) {
    console.warn(`  ⚠ ไม่มีไฟล์ของ ${c.missingTables.length} ตาราง: ${c.missingTables.join(', ')}`);
    console.warn('    สำเนาชุดนี้ทำก่อนที่ backup.ts จะครอบตารางพวกนี้ — กู้กลับได้ไม่ครบ');
  }
  if (c.photoRowsWithoutFile) {
    console.warn(`  ⚠ มีแถวรูป ${c.photoRowsWithoutFile} ใบที่ไม่มีไฟล์จริงในสำเนา — รูปพวกนี้กู้ไม่ได้`);
  }
  if (!fatal && !c.missingTables.length && !c.photoRowsWithoutFile) {
    console.log('  ✓ สำเนาชุดนี้ครบและอ่านได้ทุกไฟล์');
  }
  return !fatal;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirmed = args.includes('--yes');
  const tableFilter = args.find((a) => a.startsWith('--tables='))?.slice(9).split(',').filter(Boolean);
  const picked = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const dir = picked ? join('backups', picked) : latestSet();

  if (!dir || !existsSync(dir)) {
    console.error('✗ ไม่เจอสำเนาใน backups/ — รัน npm run backup ก่อน');
    process.exit(1);
  }

  const check = checkSet(dir);
  const readable = printCheck(check);
  if (!readable) {
    console.error('\n✗ หยุดที่นี่ — สำเนาชุดนี้เชื่อถือไม่ได้ ห้ามเอาไปทับของจริง');
    process.exit(1);
  }

  if (!dryRun && !confirmed) {
    console.log('\n(ตรวจสำเนาเท่านั้น ยังไม่ได้ต่อเซิร์ฟเวอร์)');
    console.log('  ขั้นต่อไป:  npm run restore -- --dry-run    เทียบกับเซิร์ฟเวอร์ ยังไม่เขียน');
    console.log('              npm run restore -- --yes        เขียนจริง');
    return;
  }

  const env = loadEnv();
  const t = await signIn(env);
  const targetIsLive = !env.RESTORE_URL;
  console.log(`\nปลายทาง: ${t.url}${targetIsLive ? '  ← เซิร์ฟเวอร์ตัวจริง' : '  (ปลายทางซ้อม/ย้าย)'}`);
  console.log(`ล็อกอินเป็น: ${t.as}  ${t.isTeacher ? '· เป็นอาจารย์ ✓' : '· ไม่ใช่อาจารย์ ✗'}`);

  if (!t.isTeacher) {
    console.error('\n✗ บัญชีนี้ไม่ใช่อาจารย์บนปลายทางนี้ — กู้ข้อมูลไม่ได้');
    console.error('  ตาราง checkins จะรับแถวที่มีคะแนนไม่ได้ และตอน update จะทิ้งคะแนนเงียบๆ');
    console.error('  ถ้าปลายทางเป็นโปรเจกต์ใหม่: สร้างบัญชีในหน้า Authentication → Users');
    console.error('  แล้วเพิ่มแถวใน teachers + app_users (uid ↔ teacher_id) ด้วย SQL Editor ก่อน');
    process.exit(1);
  }

  const plan = PLAN.filter((p) => !tableFilter || tableFilter.includes(p.table))
    .filter((p) => check.rows[p.table] != null);

  if (dryRun) {
    console.log('\nจะเขียนอะไร (ยังไม่เขียน):');
    for (const p of plan) {
      const live = await liveCount(t, p.table);
      const n = check.rows[p.table];
      const now = live == null ? 'อ่านไม่ได้' : `${live} แถว`;
      const verb = p.mode === 'insert-missing' ? 'เติมที่ยังไม่มี' : 'ทับด้วยสำเนา';
      console.log(`  ${p.table.padEnd(17)} สำเนา ${String(n).padStart(5)} → ปลายทางมี ${now.padEnd(12)} (${verb})`);
      if (p.note) console.log(`      ⓘ ${p.note}`);
    }
    console.log(`\n  ไฟล์รูป ${check.photoFiles} ใบ → บักเก็ต ${PHOTO_BUCKET}`);
    console.log('\n(ยังไม่ได้เขียนอะไรเลย — ใส่ --yes ถ้าจะกู้จริง)');
    return;
  }

  console.log('\nเริ่มกู้…');
  const reports: WriteReport[] = [];
  for (const p of plan) {
    const rows = JSON.parse(readFileSync(join(dir, `${p.table}.json`), 'utf8')) as unknown[];
    if (!rows.length) continue;
    const rep = await writeTable(t, p.table, rows, p.mode);
    reports.push(rep);
    const mark = rep.failed ? '⚠' : '✓';
    console.log(`  ${mark} ${p.table.padEnd(17)} ${rep.ok}/${rep.sent}`);
    if (rep.firstError) console.log(`      ${rep.firstError}`);
  }

  const photos = check.photoFiles ? await uploadPhotos(t, dir) : { ok: 0, failed: 0 };
  if (check.photoFiles) console.log(`  ${photos.failed ? '⚠' : '✓'} รูปงาน            ${photos.ok}/${check.photoFiles}`);

  const totalOk = reports.reduce((s, r) => s + r.ok, 0);
  const totalFailed = reports.reduce((s, r) => s + r.failed, 0);
  console.log(`\nกู้แล้ว ${totalOk} แถว`);
  if (totalFailed || photos.failed) {
    console.error(`✗ ยังไม่ครบ — แถวที่เขียนไม่ได้ ${totalFailed} · รูปที่อัปไม่ได้ ${photos.failed}`);
    console.error('  ห้ามถือว่ากู้เสร็จ ต้องอ่าน error ข้างบนแล้วแก้ที่ต้นเหตุก่อน');
    process.exit(1);
  }
  console.log('✓ ครบทุกแถวที่มีในสำเนา');
  console.log('  จำไว้: updated_at ของทุกแถวเป็นเวลาที่กู้ · actor_uid ของแถว audit ที่เติมใหม่คือคนที่กู้');
  console.log('  ขั้นต่อไป: เปิดแอปด้วยบัญชีนักศึกษาหนึ่งคน ตรวจว่าเคสกับคาบกลับมาจริง');
}

/* รันเป็นสคริปต์เท่านั้น — ถ้าถูก import (test:restore) ห้ามยิงอะไรทั้งนั้น
   ⚠️ ต้องเทียบด้วย basename ที่ "ขึ้นต้น" ด้วย restore — ไฟล์เทสต์ชื่อ test-restore.mts
   ซึ่ง .includes('restore') ก็จริงด้วย = เทสต์จะยิงของจริงใส่เซิร์ฟเวอร์ */
if ((process.argv[1] ?? '').split('/').pop()?.startsWith('restore')) {
  main().catch((e) => {
    console.error('✗ กู้ข้อมูลล้มเหลว:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
