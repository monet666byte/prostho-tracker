/**
 * เทสต์ "หน้าเว็บจริงที่ CSP ทำงาน" · รันด้วย `npm run test:csp-live`
 *
 * ทำไมต้องมี (14 ก.ย. 69): เทสต์ในเบราว์เซอร์ทุกชุดเปิด `bypassCSP: true` เพราะเซิร์ฟเวอร์จำลองอยู่ที่
 * http://127.0.0.1 ซึ่ง CSP ของแอป (ยอมแค่ *.supabase.co) ไม่ยอม · ผลคือ CSP ของจริงไม่เคยถูกทดสอบเลย
 * แล้ววันเดียวกันก็เจอว่า CSP บล็อกรูปงานทุกใบบนเครื่องอาจารย์ (img-src ไม่มี supabase.co)
 *
 * วิธีทำ: build แอปโดยตั้งที่อยู่เซิร์ฟเวอร์เป็น https://csp-test.supabase.co (ผ่านกฎ CSP เหมือนของจริง)
 * แล้วให้ playwright ส่งต่อทุกคำขอไปที่นั้นเข้า local-supabase · หน้าแอปเสิร์ฟที่ https://app.test
 * **ไม่เปิด bypassCSP** — อะไรที่ CSP บล็อกบนเว็บจริง จะถูกบล็อกที่นี่ด้วย
 * ไล่: ปุ่ม Google · นักศึกษาแนบรูป · อาจารย์เปิดรูป (ลิงก์ที่เซ็น) · เปิดทุกหน้าหลักทั้งสองฝั่ง
 * ⚠️ realtime (websocket) ส่งต่อไม่ได้ — แอปถอยไปดึงทุก 15 วิเอง ไม่นับเป็นความผิด
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANON_KEY, startLocalSupabase } from './local-supabase.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const API_PORT = 54396;
const FAKE_API = 'https://csp-test.supabase.co';
const APP = 'https://app.test';

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
  if (!ok) failures++;
}

const out = mkdtempSync(join(tmpdir(), 'prostho-csp-'));
console.log('build รุ่นปัจจุบัน (ชี้ไปที่ *.supabase.co) …');
execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
  cwd: root, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_URL: FAKE_API, VITE_SUPABASE_ANON_KEY: ANON_KEY },
});
const csp = /Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(join(out, 'index.html'), 'utf8'))?.[1];
check('หน้าเว็บที่ build มี CSP จริง', !!csp, csp ?? '');

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

const S = await startLocalSupabase(API_PORT, { quiet: true });
const violations: string[] = [];
const profiles: string[] = [];

async function freshBrowser(): Promise<BrowserContext> {
  const p = mkdtempSync(join(tmpdir(), 'prostho-csp-profile-'));
  profiles.push(p);
  // ⚠️ ห้ามใส่ bypassCSP — นี่คือทั้งหมดของเทสต์นี้
  const ctx = await chromium.launchPersistentContext(p, { viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  await ctx.route(`${APP}/**`, (route) => {
    let f = join(out, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(out, 'index.html');
    return route.fulfill({ status: 200, contentType: MIME[extname(f)] ?? 'application/octet-stream', body: readFileSync(f) });
  });
  await ctx.route(`${FAKE_API}/**`, async (route) => {
    const u = new URL(route.request().url());
    const target = `http://127.0.0.1:${API_PORT}${u.pathname}${u.search}`;
    try {
      const res = await route.fetch({ url: target, maxRedirects: 0 });
      return route.fulfill({ response: res });
    } catch {
      return route.abort();
    }
  });
  return ctx;
}

function watch(page: Page, who: string) {
  page.on('console', (m) => {
    const txt = m.text();
    if (/Content Security Policy|violates the following/i.test(txt)) violations.push(`[${who} ${new URL(page.url()).hash || '/'}] ${txt.slice(0, 220)}`);
  });
}

async function login(ctx: BrowserContext, email: string, who: string): Promise<Page> {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  watch(page, who);
  await page.goto(APP + '/');
  const sess = await (await fetch(`${S.url}/auth/v1/dev-session?email=${email}`, { headers: { apikey: S.anonKey } })).json();
  await page.evaluate((s) => localStorage.setItem('sb-csp-test-auth-token', JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 })), sess);
  await page.goto(APP + '/');
  await page.waitForTimeout(5000);
  return page;
}

async function visit(page: Page, hash: string) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1800);
}

try {
  console.log('\n① ปุ่ม Google (พาออกไปหน้า /authorize แล้วกลับมา)');
  {
    const ctx = await freshBrowser();
    const page = ctx.pages()[0] ?? await ctx.newPage();
    watch(page, 'google');
    await page.goto(APP + '/');
    await page.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' }).click({ timeout: 30_000 });
    await page.getByRole('link', { name: 's2@test.local', exact: true }).click({ timeout: 15_000 });
    await page.waitForURL((u) => u.origin === APP, { timeout: 15_000 });
    await page.waitForTimeout(4000);
    check('กลับมาเข้าหน้านักศึกษาได้ภายใต้ CSP จริง', (await page.locator('body').innerText()).includes('นศ. ทดสอบ สอง'), page.url());
    await ctx.close();
  }

  console.log('\n② นักศึกษาแนบรูป + เปิดทุกหน้า');
  {
    const ctx = await freshBrowser();
    const page = await login(ctx, 's1@test.local', 'นศ.');
    check('หน้าแรกนักศึกษาขึ้น (sync ผ่าน CSP)', (await page.locator('body').innerText()).includes('นศ. ทดสอบ หนึ่ง'));
    await visit(page, '#/app/work/w1');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(5000);
    const uploaded = await S.db.query<{ storage_path: string | null }>(`select storage_path from photos where workpiece_id = 'w1'`);
    check('รูปขึ้นบักเก็ต', uploaded.rows.some((r) => !!r.storage_path), uploaded.rows);
    for (const h of ['#/app', '#/app/patients', '#/app/criteria', '#/app/checkin', '#/app/photos', '#/app/sync', '#/app/export', '#/app/portfolio', '#/app/self-assessment']) {
      await visit(page, h);
    }
    await ctx.close();
  }

  console.log('\n③ อาจารย์ (เครื่องที่ไม่มีสำเนารูป) เปิดรูปจากลิงก์ที่เซ็น + เปิดทุกหน้า');
  {
    const ctx = await freshBrowser();
    const page = await login(ctx, 't1@test.local', 'อจ.');
    await visit(page, '#/teacher/review?student=s1');
    await page.getByRole('button', { name: /รูป · คอมเมนต์/ }).first().click({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    const imgs = await page.evaluate(() => [...document.images]
      .filter((i) => i.src.includes('/storage/v1/object/sign/'))
      .map((i) => ({ src: i.src.slice(0, 60), ok: i.complete && i.naturalWidth > 0 })));
    check('หน้าตรวจงานมีรูปจากลิงก์ที่เซ็น', imgs.length > 0, imgs);
    check('รูปโหลดขึ้นจริง (CSP ไม่บล็อก)', imgs.length > 0 && imgs.every((i) => i.ok), imgs);
    for (const h of ['#/teacher', '#/teacher/group', '#/teacher/evaluate', '#/teacher/sect2', '#/teacher/sect3', '#/teacher/exams',
      '#/teacher/sa', '#/teacher/analytics', '#/teacher/alumni', '#/teacher/settings']) {
      await visit(page, h);
    }
    await ctx.close();
  }

  console.log('\n④ หัวหน้าภาค');
  {
    const ctx = await freshBrowser();
    const page = await login(ctx, 'head@test.local', 'หัวหน้าภาค');
    for (const h of ['#/teacher', '#/teacher/roster', '#/teacher/settings']) await visit(page, h);
    await ctx.close();
  }

  const unique = [...new Set(violations)];
  check('ตลอดการไล่ ไม่มีอะไรถูก CSP บล็อก', unique.length === 0, unique.slice(0, 8));
} finally {
  await S.close();
  for (const p of profiles) rmSync(p, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
