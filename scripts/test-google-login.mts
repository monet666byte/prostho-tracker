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
await S.db.exec(`insert into students (id, code, name, "group", year, entry_year) values ('s5', '6604052', 'นศ. ทดสอบ ห้า', 'TH-PT7', 5, 2569);
  insert into invites (email, role, student_id) values ('invited.first@student.mahidol.edu', 'student', 's5')`);

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
    const page = await loginWithGoogle(ctx, 'invited.first@student.mahidol.edu');
    check('สร้างบัญชีและผูกกับนักศึกษาถูกคน', (await page.locator('body').innerText()).includes('นศ. ทดสอบ ห้า'), page.url());
    const linked = await S.db.query<{ student_id: string }>(`select student_id from app_users where email = 'invited.first@student.mahidol.edu'`);
    check('ฐานข้อมูลผูกบัญชีกับ s5', linked.rows[0]?.student_id === 's5', linked.rows);
    await ctx.close();
  }

  console.log('\n③ อีเมลนอกมหาลัยที่ไม่อยู่ในรายชื่อเชิญ');
  {
    const ctx = await freshBrowser();
    const page = await loginWithGoogle(ctx, 'stranger@gmail.com');
    const text = await page.locator('body').innerText();
    check('กลับมาหน้า login พร้อมข้อความว่าไม่อยู่ในรายชื่อ', text.includes('ยังไม่อยู่ในรายชื่อที่ภาควิชาเชิญ'), text.slice(0, 300));
    const u = new URL(page.url());
    check('URL สะอาด: ไม่มี error ค้าง', !u.searchParams.has('error') && !u.searchParams.has('error_description') && !u.hash.includes('error'), page.url());
    const made = await S.db.query(`select 1 from auth.users where email = 'stranger@gmail.com'`);
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

  console.log('\n⑤ นักศึกษาที่ไม่มีในรายชื่อเชิญ ผูกบัญชีเองด้วยรหัส → อาจารย์ที่ปรึกษายืนยัน (0023)');
  {
    const sctx = await freshBrowser();
    const sp = await loginWithGoogle(sctx, 'new.student@student.mahidol.edu');
    let text = await sp.locator('body').innerText();
    check('ขึ้นหน้าผูกบัญชี ไม่ใช่ข้อความ error', text.includes('ผูกบัญชีกับรายชื่อนักศึกษา') && !text.includes('ยังไม่อยู่ในรายชื่อที่ภาควิชาเชิญ'), text.slice(0, 300));
    check('ยังไม่เข้าหน้านักศึกษา', !new URL(sp.url()).hash.startsWith('#/app'), sp.url());

    await sp.getByLabel('รหัสนักศึกษา').fill('9999999');
    await sp.getByRole('button', { name: 'ส่งคำขอให้อาจารย์ยืนยัน' }).click();
    await sp.getByText('ไม่พบรหัสนักศึกษานี้').waitFor({ timeout: 10_000 }).catch(() => {});
    check('รหัสผิด → บอกว่าไม่พบรหัส', (await sp.locator('body').innerText()).includes('ไม่พบรหัสนักศึกษานี้'));

    await sp.getByLabel('รหัสนักศึกษา').fill('6604051');
    await sp.getByRole('button', { name: 'ส่งคำขอให้อาจารย์ยืนยัน' }).click();
    await sp.getByText('รออาจารย์ที่ปรึกษายืนยัน').waitFor({ timeout: 10_000 }).catch(() => {});
    text = await sp.locator('body').innerText();
    check('ส่งคำขอแล้ว เห็นชื่อตัวเองให้ตรวจ', text.includes('รออาจารย์ที่ปรึกษายืนยัน') && text.includes('นศ. ทดสอบ สี่'), text.slice(0, 400));

    const tctx = await freshBrowser();
    const tp = await loginWithGoogle(tctx, 't1@test.local');
    await tp.getByText('นักศึกษารอยืนยันบัญชี').waitFor({ timeout: 15_000 }).catch(() => {});
    const ttext = await tp.locator('body').innerText();
    check('อาจารย์ที่ปรึกษาเห็นคำขอในหน้าภาพรวม', ttext.includes('นักศึกษารอยืนยันบัญชี') && ttext.includes('new.student@student.mahidol.edu'), ttext.slice(0, 300));
    check('อาจารย์ที่ดูแลกลุ่มอยู่แล้ว ไม่ถูกถามเรื่องกลุ่มที่ปรึกษา (ตอนข้อมูลยังลงไม่ครบ)', !(await tp.locator('.confirmwrap').isVisible()));
    await tp.locator('.panel', { hasText: 'นักศึกษารอยืนยันบัญชี' }).getByRole('button', { name: 'ยืนยัน' }).click();
    await tp.locator('.confirmbox').getByRole('button', { name: 'ยืนยัน' }).click();
    await tp.waitForTimeout(2500);
    check('ยืนยันแล้วการ์ดคำขอหายไป', !(await tp.locator('body').innerText()).includes('นักศึกษารอยืนยันบัญชี'));
    await tctx.close();

    await sp.getByRole('button', { name: 'ตรวจสถานะ' }).click();
    await sp.waitForTimeout(5000);
    text = await sp.locator('body').innerText();
    check('นักศึกษาเข้าแอปได้ในชื่อตัวเอง', new URL(sp.url()).hash.startsWith('#/app') && text.includes('นศ. ทดสอบ สี่'), sp.url());
    await sctx.close();
  }

  console.log('\n⑥ รุ่นใหม่ยังไม่มีที่ปรึกษา → อาจารย์เลือกเอง · หัวหน้าภาคแก้ได้ (0024)');
  {
    await S.db.exec(`
      insert into groups (code, advisor_ids, student_ids) values ('TH56-PT1', array['',''], array['n1']), ('TH56-PT2', array['',''], array['n2']);
      insert into students (id, code, name, "group", year, entry_year, advisor_ids) values
        ('n1', '6704001', 'นศ. รุ่นใหม่ หนึ่ง', 'TH56-PT1', 5, 2570, array['','']),
        ('n2', '6704002', 'นศ. รุ่นใหม่ สอง', 'TH56-PT2', 5, 2570, array['',''])`);

    const tctx = await freshBrowser();
    const tp = await loginWithGoogle(tctx, 't1@test.local');
    await tp.getByText('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?').waitFor({ timeout: 15_000 }).catch(() => {});
    check('อาจารย์ถูกถามเรื่องกลุ่มที่ปรึกษาของรุ่นใหม่', await tp.getByText('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?').isVisible());
    await tp.locator('.confirmbox div', { hasText: /^PT1/ }).getByRole('button', { name: 'ฉันดูแลกลุ่มนี้' }).first().click();
    await tp.waitForTimeout(3000);
    const g1 = await S.db.query<{ a: string[] }>(`select advisor_ids as a from groups where code = 'TH56-PT1'`);
    const s1 = await S.db.query<{ a: string[] }>(`select advisor_ids as a from students where id = 'n1'`);
    check('เลือกแล้ว ลงเซิร์ฟเวอร์ทั้ง groups และ students', g1.rows[0]?.a.includes('t1') && s1.rows[0]?.a.includes('t1'), { g: g1.rows, s: s1.rows });
    check('กล่องถามปิดเอง', !(await tp.getByText('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?').isVisible()));
    await tp.reload();
    await tp.waitForTimeout(5000);
    check('เปิดแอปใหม่ ไม่ถามซ้ำ (ดูแลกลุ่มในรุ่นนั้นแล้ว)', !(await tp.getByText('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?').isVisible()));
    await tctx.close();

    const hctx = await freshBrowser();
    const hp = await loginWithGoogle(hctx, 'head@test.local');
    await hp.getByText('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?').waitFor({ timeout: 15_000 }).catch(() => {});
    check('หัวหน้าภาค (ยังไม่ได้ดูแลกลุ่มไหนในรุ่นนั้น) ถูกถามด้วย', await hp.getByText('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?').isVisible());
    await hp.getByRole('button', { name: 'ไม่ได้เป็นที่ปรึกษากลุ่มในรุ่นนี้' }).click();
    await hp.reload();
    await hp.waitForTimeout(5000);
    check('ตอบว่าไม่ได้เป็นที่ปรึกษา → ไม่ถามรุ่นนั้นอีก', !(await hp.getByText('คุณเป็นอาจารย์ที่ปรึกษากลุ่มไหน?').isVisible()));

    await hp.evaluate(() => { location.hash = '#/teacher/roster'; });
    await hp.getByText('อาจารย์ที่ปรึกษาแต่ละกลุ่ม').waitFor({ timeout: 15_000 });
    await hp.getByLabel('PT2 ที่ปรึกษา 1').selectOption('t2');
    await hp.getByLabel('PT2 ที่ปรึกษา 1').locator('xpath=..').getByRole('button', { name: 'บันทึก' }).click();
    await hp.waitForTimeout(3000);
    const g2 = await S.db.query<{ a: string[] }>(`select advisor_ids as a from groups where code = 'TH56-PT2'`);
    const s2 = await S.db.query<{ a: string[] }>(`select advisor_ids as a from students where id = 'n2'`);
    check('หัวหน้าภาคตั้งที่ปรึกษาจากหน้ารายชื่อได้', JSON.stringify(g2.rows[0]?.a) === '["t2",""]' && JSON.stringify(s2.rows[0]?.a) === '["t2",""]', { g: g2.rows, s: s2.rows });
    await hctx.close();
  }
} finally {
  await S.close();
  web.close();
  for (const p of profiles) rmSync(p, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
