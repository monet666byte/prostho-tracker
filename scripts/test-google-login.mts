/**
 * เทสต์ "เข้าสู่ระบบด้วย Google" · รันด้วย `npm run test:google-login`
 *
 * ทำไมต้องมี (14 ก.ย. 69): เปลี่ยนการล็อกอินหลักเป็นปุ่ม Google (Supabase OAuth แบบ PKCE)
 * จุดที่พังง่ายและเทสต์ชั้นข้อมูลมองไม่เห็นเลย:
 *   · แอปใช้ HashRouter — ผลที่กลับจาก Google ต้องไม่ชนกับ `#/เส้นทาง`
 *   · อีเมลไม่อยู่ในรายชื่อเชิญ → trigger ไม่ยอมสร้างบัญชี → ต้องขึ้นข้อความภาษาคน ไม่ใช่เงียบ/จอค้าง
 *   · หลังกลับมา URL ต้องสะอาด (ไม่มี code/error ค้าง) และรีเฟรชแล้วยังล็อกอินอยู่
 *
 * วิธีทำ: build แอปรุ่นปัจจุบัน → Chromium จริง → กดปุ่มจริง → หน้า Google จำลองของ local-supabase
 * (รายชื่อเชิญ / trigger / RLS เป็นของจริงบน Postgres · หน้า Google เป็นของปลอม)
 * ⚠️ ไม่ได้ทดสอบ: หน้า Google จริง · การตั้งค่าในหน้า Supabase · iPhone ที่ติดตั้งแอปบนหน้าจอโฮม — ต้องลองมือ
 */
import { chromium, type BrowserContext } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANON_KEY, startLocalSupabase } from './local-supabase.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const API_PORT = 54397;
const WEB_PORT = 5392;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
  if (!ok) failures++;
}

const env = { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_ANON_KEY: ANON_KEY };
const out = mkdtempSync(join(tmpdir(), 'prostho-google-'));
console.log('build รุ่นปัจจุบัน …');
execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: root, env, stdio: 'ignore' });

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
// บัญชีที่ภาคเชิญไว้แต่ยังไม่เคยเข้าระบบเลย — ครั้งแรกต้องถูกสร้างผ่าน Google ได้
await S.db.query(`insert into invites (email, role, student_id) values ('new.student@student.mahidol.edu', 'student', 's3')`);

const profiles: string[] = [];
async function freshBrowser(): Promise<BrowserContext> {
  const p = mkdtempSync(join(tmpdir(), 'prostho-google-profile-'));
  profiles.push(p);
  return chromium.launchPersistentContext(p, { viewport: { width: 390, height: 844 }, bypassCSP: true });
}

/** เปิดแอป → กดปุ่ม Google → เลือกอีเมลในหน้าจำลอง → รอกลับมาถึงแอป */
async function loginWithGoogle(ctx: BrowserContext, email: string) {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(WEB + '/');
  await page.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' }).click({ timeout: 30_000 });
  await page.getByRole('link', { name: email, exact: true }).click({ timeout: 15_000 });
  await page.waitForURL((u) => u.origin === WEB, { timeout: 15_000 });
  await page.waitForTimeout(3000);
  return page;
}

try {
  console.log('\n① นักศึกษาที่มีชื่อในรายชื่อ (เคยมีบัญชีแล้ว)');
  {
    const ctx = await freshBrowser();
    const page = await loginWithGoogle(ctx, 's1@test.local');
    const text = await page.locator('body').innerText();
    check('เข้าถึงหน้านักศึกษา และเป็นคนที่ถูกต้อง', text.includes('นศ. ทดสอบ หนึ่ง'), page.url());
    check('URL สะอาด: ไม่มี code ค้าง', !new URL(page.url()).searchParams.has('code'), page.url());
    check('HashRouter พาไปหน้านักศึกษา', new URL(page.url()).hash.startsWith('#/app'), page.url());
    await page.reload();
    await page.waitForTimeout(3000);
    check('รีเฟรชแล้วยังล็อกอินอยู่', (await page.locator('body').innerText()).includes('นศ. ทดสอบ หนึ่ง'), page.url());
    await ctx.close();
  }

  console.log('\n② ภาคเชิญไว้ แต่ยังไม่เคยมีบัญชี — เข้าครั้งแรกด้วย Google');
  {
    const ctx = await freshBrowser();
    const page = await loginWithGoogle(ctx, 'new.student@student.mahidol.edu');
    check('สร้างบัญชีและผูกกับนักศึกษาถูกคน', (await page.locator('body').innerText()).includes('นศ. ทดสอบ สาม'), page.url());
    const linked = await S.db.query<{ student_id: string }>(`select student_id from app_users where email = 'new.student@student.mahidol.edu'`);
    check('ฐานข้อมูลผูกบัญชีกับ s3', linked.rows[0]?.student_id === 's3', linked.rows);
    await ctx.close();
  }

  console.log('\n③ อีเมลที่ไม่อยู่ในรายชื่อเชิญ');
  {
    const ctx = await freshBrowser();
    const page = await loginWithGoogle(ctx, 'outsider@student.mahidol.edu');
    const text = await page.locator('body').innerText();
    check('กลับมาหน้า login พร้อมข้อความว่าไม่อยู่ในรายชื่อ', text.includes('ยังไม่อยู่ในรายชื่อที่ภาควิชาเชิญ'), text.slice(0, 300));
    const u = new URL(page.url());
    check('URL สะอาด: ไม่มี error ค้าง', !u.searchParams.has('error') && !u.searchParams.has('error_description') && !u.hash.includes('error'), page.url());
    const made = await S.db.query(`select 1 from auth.users where email = 'outsider@student.mahidol.edu'`);
    check('ไม่มีบัญชีถูกสร้างให้คนนอก', made.rows.length === 0, made.rows);
    await page.reload();
    await page.waitForTimeout(2000);
    check('รีเฟรชแล้วข้อความหาย (ไม่ค้างถาวร)', !(await page.locator('body').innerText()).includes('ยังไม่อยู่ในรายชื่อที่ภาควิชาเชิญ'));
    await ctx.close();
  }

  console.log('\n④ อาจารย์');
  {
    const ctx = await freshBrowser();
    const page = await loginWithGoogle(ctx, 't1@test.local');
    check('เข้าหน้าอาจารย์', new URL(page.url()).hash.startsWith('#/teacher'), page.url());
    await ctx.close();
  }
} finally {
  await S.close();
  web.close();
  for (const p of profiles) rmSync(p, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
