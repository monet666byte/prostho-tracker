/**
 * "ซ้อมกู้ข้อมูลจริงครบวงจร" · รันด้วย `npm run test:restore-e2e`
 *
 * ทำไมต้องมี (13 ก.ย. 69): `npm run backup` กับ `npm run restore` ไม่เคยถูกรันคู่กันจริงเลย
 * เพราะเครื่องพัฒนาไม่มี .env.local และห้ามซ้อมบนเซิร์ฟเวอร์จริง · `test:restore` ทดสอบแค่ส่วนย่อย
 * (ตรวจสำเนา / วิธียิง) · สำเนาที่ไม่เคยลองกู้ยังไม่นับว่าเป็นสำเนา
 *
 * ชุดนี้รันสคริปต์ตัวจริงทั้งสองตัวเป็น process แยก (แบบที่คนดูแลรันจริง) กับ Supabase จำลอง
 * ที่ข้างในเป็น Postgres จริง (`scripts/local-supabase.mts`) — กฎ RLS / trigger ของจริงทุกบรรทัด
 *
 * ฉากที่ซ้อม: นักศึกษาคนหนึ่ง "ข้อมูลหาย" (เคส · คาบ · ผู้ป่วย · รูปงานจริง) หลังวันสำรอง
 * ขณะที่อีกคนทำงานต่อไปตามปกติ → กู้เฉพาะคนที่หาย → ของคนอื่นต้องไม่ถูกย้อน
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_KEY, startLocalSupabase } from './local-supabase.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
  if (!ok) failures++;
}

const S = await startLocalSupabase(0, { quiet: true });
const work = mkdtempSync(join(tmpdir(), 'restore-e2e-'));
const env = {
  ...process.env,
  VITE_SUPABASE_URL: S.url, VITE_SUPABASE_ANON_KEY: S.anonKey,
  BACKUP_EMAIL: 'head@test.local', BACKUP_PASSWORD: 'test1234',
  RESTORE_URL: S.url, RESTORE_ANON_KEY: S.anonKey,
  RESTORE_EMAIL: 'head@test.local', RESTORE_PASSWORD: 'test1234',
  RESTORE_STORAGE_SERVICE_KEY: SERVICE_KEY,
  BACKUP_DIR: join(work, 'backups'),
};

/** รันสคริปต์ตัวจริงเป็น process แยก ในโฟลเดอร์ชั่วคราว (ไม่ปนกับ backups/ ของโปรเจกต์)
 *  ⚠️ ต้องเป็น spawn แบบ async — spawnSync บล็อก event loop แล้วเซิร์ฟเวอร์จำลองที่รันใน process นี้
 *     ตอบคำขอของสคริปต์ไม่ได้ = ค้างจนหมดเวลา (ครั้งแรกเขียนแบบ sync แล้วเจอแบบนี้) */
const run = (script: string, args: string[] = []) => new Promise<{ code: number | null; out: string }>((ok) => {
  const child = spawn('npx', ['--yes', 'tsx', join(root, 'scripts', script), ...args], { cwd: work, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill(), 120_000);
  child.on('close', (code) => { clearTimeout(timer); ok({ code, out }); });
});

const token = async (email: string) => {
  const r = await fetch(`${S.url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: S.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test1234' }),
  });
  return (await r.json()).access_token as string;
};
const q = async (sql: string, p: unknown[] = []) => (await S.db.query<Record<string, unknown>>(sql, p)).rows;

try {
  /* ── ① สภาพก่อนเกิดเหตุ: นศ. s1 มีเคส + คาบ + รูปงานจริงบนบักเก็ต ───────── */
  console.log('① ก่อนเกิดเหตุ');
  const s1 = await token('s1@test.local');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7), 0xff, 0xd9]);
  const photoPath = 's1/PT-TEST1/w1/ph-e2e.jpg';
  const form = new FormData();
  form.append('', new Blob([jpeg], { type: 'image/jpeg' }), 'x.jpg');
  const up = await fetch(`${S.url}/storage/v1/object/case-photos/${photoPath}`, {
    method: 'POST', headers: { apikey: S.anonKey, authorization: `Bearer ${s1}`, 'x-upsert': 'true' }, body: form,
  });
  await q(`insert into photos (id, workpiece_id, created_at, storage_path) values ('ph-e2e', 'w1', '2026-09-12', $1)`, [photoPath]);
  check('นศ. s1 อัปรูปงานขึ้นบักเก็ตได้', up.ok, up.status);

  /* ── ② สำรองข้อมูลด้วยสคริปต์ตัวจริง ─────────────────────────────────────── */
  console.log('\n② npm run backup');
  const b = await run('backup.ts');
  check('สำรองข้อมูลสำเร็จ', b.code === 0, b.out.split('\n').slice(-6).join(' | '));
  const sets = readdirSync(join(work, 'backups')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  check('ได้โฟลเดอร์สำเนาหนึ่งชุด', sets.length === 1, sets);
  const files = readdirSync(join(work, 'backups', sets[0]));
  check('สำเนามีครบทุกตารางที่ตัวกู้ต้องใช้', ['workpieces.json', 'checkins.json', 'photos.json', 'sect2_records.json', 'app_settings.json'].every((f) => files.includes(f)), files);
  check('ไฟล์รูปจริงถูกดึงลงสำเนาด้วย', b.out.includes('รูปงาน       1 ใบ'), b.out.match(/รูปงาน[^\n]*/)?.[0]);

  const r0 = await run('restore.ts');
  check('ตัวตรวจสำเนา (ไม่ต่อเน็ต) บอกว่าสำเนาครบ', r0.code === 0 && r0.out.includes('ครบและอ่านได้ทุกไฟล์'), r0.out.split('\n').slice(0, 8).join(' | '));

  /* ── ③ หลังวันสำรอง: s1 ข้อมูลหาย · s2 ทำงานต่อ · s1 เองก็เปลี่ยนชื่อในรายชื่อ ── */
  console.log('\n③ เกิดเหตุหลังวันสำรอง');
  const head = await token('head@test.local');
  await fetch(`${S.url}/storage/v1/object/case-photos`, {
    method: 'DELETE', headers: { apikey: S.anonKey, authorization: `Bearer ${head}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: [photoPath] }),
  });
  await S.db.exec(`
    delete from photos where id = 'ph-e2e';
    delete from workpieces where id = 'w1';
    delete from checkins where id = 'c1';
    delete from patients where id = 'p1';
    update workpieces set proc_index = 7 where id = 'w2';           -- งานของ s2 หลังวันสำรอง
    update students set name = 'นศ. ทดสอบ หนึ่ง (แก้ชื่อหลังสำรอง)' where id = 's1';
  `);
  check('ข้อมูลของ s1 หายจริง', (await q(`select 1 from workpieces where id = 'w1'`)).length === 0);

  /* ── ④ กู้รายคน: ดูก่อน แล้วค่อยกู้ ───────────────────────────────────────── */
  console.log('\n④ npm run restore -- --student=6604048');
  const dry = await run('restore.ts', ['--student=6604048', '--dry-run']);
  check('ดูก่อนกู้ได้ด้วยรหัสนักศึกษา 7 หลัก', dry.code === 0 && dry.out.includes('กู้รายคน: s1'), dry.out.split('\n').slice(-12).join(' | '));
  check('ดูก่อนกู้ ยังไม่เขียนอะไร', (await q(`select 1 from workpieces where id = 'w1'`)).length === 0);

  const r = await run('restore.ts', ['--student=6604048', '--yes']);
  check('กู้รายคนสำเร็จ (exit 0)', r.code === 0, r.out.split('\n').slice(-14).join(' | '));

  /* ── ⑤ ผลที่ต้องได้ ───────────────────────────────────────────────────────── */
  console.log('\n⑤ ผลหลังกู้');
  check('เคสของ s1 กลับมา', (await q(`select proc_index from workpieces where id = 'w1'`))[0]?.proc_index === 3);
  check('คาบของ s1 กลับมา', (await q(`select 1 from checkins where id = 'c1'`)).length === 1);
  check('ผู้ป่วยของ s1 กลับมา', (await q(`select hn from patients where id = 'p1'`))[0]?.hn === 'HN-T-0001');
  check('แถวรูปของ s1 กลับมาพร้อมที่อยู่ไฟล์', (await q(`select storage_path from photos where id = 'ph-e2e'`))[0]?.storage_path === photoPath);

  const dl = await fetch(`${S.url}/storage/v1/object/authenticated/case-photos/${photoPath}`, {
    headers: { apikey: S.anonKey, authorization: `Bearer ${s1}` },
  });
  const bytes = dl.ok ? new Uint8Array(await dl.arrayBuffer()) : new Uint8Array();
  check('ไฟล์รูปจริงกลับขึ้นบักเก็ต และเปิดได้ครบทุกไบต์', dl.ok && bytes.byteLength === jpeg.byteLength, { status: dl.status, bytes: bytes.byteLength });

  check('งานของ s2 ที่ทำหลังวันสำรองไม่ถูกย้อน', (await q(`select proc_index from workpieces where id = 'w2'`))[0]?.proc_index === 7);
  check('แถวของ s1 ที่ยังอยู่ไม่ถูกทับด้วยฉบับเก่า (ค่าเริ่มต้นเติมเฉพาะที่หาย)',
    String((await q(`select name from students where id = 's1'`))[0]?.name).includes('แก้ชื่อหลังสำรอง'));

  /* ── ⑥ กู้ซ้ำต้องปลอดภัย ─────────────────────────────────────────────────── */
  console.log('\n⑥ กู้ซ้ำ');
  const again = await run('restore.ts', ['--student=s1', '--yes']);
  check('กู้ซ้ำไม่พัง และไม่สร้างแถวซ้ำ', again.code === 0 && (await q(`select 1 from workpieces where id = 'w1'`)).length === 1,
    again.out.split('\n').slice(-6).join(' | '));
  const none = await run('restore.ts', ['--student=9999999', '--yes']);
  check('ใส่รหัสที่ไม่มีในสำเนา → หยุด ไม่เขียนอะไร', none.code !== 0 && none.out.includes('ไม่เจอนักศึกษา'), none.out.split('\n').slice(-3).join(' | '));
} finally {
  await S.close();
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
