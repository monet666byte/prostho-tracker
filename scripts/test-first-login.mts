/**
 * เทสต์ "เครื่องใหม่ ล็อกอินครั้งแรก" · รันด้วย `npm run test:first-login`
 *
 * ทำไมต้องมี (14 ก.ย. 69): เครื่องที่เพิ่งล็อกอินครั้งแรกยังไม่มีรายชื่อ นศ./อาจารย์ ในลิ้นชักตอน init
 * แอปจึงตั้ง "ชื่อคนทำรายการ" เป็นชื่อเดโม "นศ. Liv" แล้วค้างอยู่อย่างนั้นจนกว่าจะปิดแอปเปิดใหม่
 * ชื่อนั้นถูกจดลง audit (แก้/ลบไม่ได้) · ประวัติ step · ช่อง by ของใบประเมิน
 * พิสูจน์บนเซิร์ฟเวอร์จำลอง: audit.who = "นศ. Liv" ทั้งที่ actor_uid เป็นของ s1
 *
 * ทุกชุดเดิมไม่จับ เพราะเทสต์ชั้นข้อมูลรับชื่อเป็นพารามิเตอร์ และ test:upgrade ไม่ได้ดูช่อง who
 *
 * วิธีทำ: build แอปรุ่นปัจจุบัน → Chromium จริง profile ใหม่เอี่ยม → ล็อกอิน → กดผ่านหน้าจอจริง
 * → อ่านชื่อที่เซิร์ฟเวอร์ (local-supabase · Postgres จริง) ได้รับ
 *
 * `--commit=<sha>` build รุ่นนั้นจาก git แทน — ใช้พิสูจน์ว่าเทสต์ตกกับรุ่นก่อนแก้จริง
 * ช้า (~1 นาที + build) จึงไม่อยู่ใน `npm test` · รันเมื่อแตะ store/app.ts หรือลำดับ init/sync
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANON_KEY, startLocalSupabase } from './local-supabase.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const API_PORT = 54398;
const WEB_PORT = 5391;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice('--commit='.length);

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
  if (!ok) failures++;
}

/* ── build ─────────────────────────────────────────────────────────────────── */
const env = { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_ANON_KEY: ANON_KEY };
const out = mkdtempSync(join(tmpdir(), 'prostho-first-login-'));
console.log(commit ? `build รุ่น ${commit} …` : 'build รุ่นปัจจุบัน …');
if (commit) {
  const src = mkdtempSync(join(tmpdir(), `prostho-wt-${commit}-`));
  execFileSync('git', ['worktree', 'add', '--detach', src, commit], { cwd: root, stdio: 'ignore' });
  try {
    symlinkSync(join(root, 'node_modules'), join(src, 'node_modules'));
    execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: src, env, stdio: 'ignore' });
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', src], { cwd: root, stdio: 'ignore' });
  }
} else {
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: root, env, stdio: 'ignore' });
}

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const web = createServer((req, res) => {
  let f = join(out, decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(out, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(f));
});
await new Promise<void>((r) => web.listen(WEB_PORT, '127.0.0.1', r));

const S = await startLocalSupabase(API_PORT, { quiet: true });
const q = async <T,>(sql: string) => (await S.db.query<T>(sql)).rows;
const profile = mkdtempSync(join(tmpdir(), 'prostho-first-login-profile-'));
const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 390, height: 844 }, bypassCSP: true });

try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(WEB + '/');
  const sess = await (await fetch(`${S.url}/auth/v1/dev-session?email=s1@test.local`, { headers: { apikey: S.anonKey } })).json();
  await page.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 })), sess);
  await page.goto(WEB + '/');

  /* ① เช็คอินทันทีที่แผ่นถามโผล่ — sync รอบแรกอาจยังไม่จบ (ชื่อยังอ่านจากลิ้นชักไม่ได้) */
  await page.getByRole('button', { name: 'Laboratory work', exact: true }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: 'เช็คอินเลย', exact: true }).click();
  await page.waitForTimeout(5000); // ให้ sync รอบแรกจบ + ส่งเช็คอินขึ้นไป

  /* ② กด step หลัง sync รอบแรกจบ — ต้องได้ชื่อจริงแน่นอน */
  await page.getByRole('button', { name: 'ทำขั้นนี้เสร็จแล้ว' }).first().click();
  await page.getByRole('button', { name: /บันทึกเลย/ }).click();
  await page.waitForTimeout(4000);

  const audit = await q<{ who: string; text: string }>(`select who, text from audit where student_id = 's1' order by at_when`);
  const upd = await q<{ created_by: string }>(`select created_by from updates where workpiece_id = 'w1'`);
  console.log('   audit:', JSON.stringify(audit), '· updates:', JSON.stringify(upd));

  const checkin = audit.find((a) => a.text.startsWith('เช็คอิน'));
  const step = audit.find((a) => a.text.startsWith('ผ่าน'));
  check('เช็คอินขึ้นเซิร์ฟเวอร์', !!checkin, audit);
  check('กด step ขึ้นเซิร์ฟเวอร์', !!step && upd.length === 1, { audit, upd });
  check('ไม่มีรายการไหนจดชื่อเดโม "นศ. Liv"', !audit.some((a) => a.who === 'นศ. Liv') && !upd.some((u) => u.created_by === 'นศ. Liv'), { audit, upd });
  check('เช็คอินที่ทำก่อน sync รอบแรกจบ จดเป็นชื่อจริงหรืออีเมลของเจ้าตัว',
    !!checkin && ['นศ. ทดสอบ หนึ่ง', 's1@test.local'].includes(checkin.who), checkin);
  check('step ที่ทำหลัง sync รอบแรก จดเป็นชื่อจริง', step?.who === 'นศ. ทดสอบ หนึ่ง' && upd[0]?.created_by === 'นศ. ทดสอบ หนึ่ง', { step, upd });
} finally {
  await ctx.close();
  await S.close();
  web.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
