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

  console.log('\n⑥ ขึ้นปีการศึกษาใหม่ → ล้างที่ปรึกษา → อาจารย์ติ๊กเลือกใหม่ได้หลายกลุ่ม · หัวหน้าภาคแก้ได้ (0024)');
  {
    const y = (await S.db.query<{ y: number }>(`select current_academic_year() as y`)).rows[0].y;
    await S.db.exec(`
      insert into groups (code, advisor_ids, student_ids) values ('TH56-PT1', array['',''], array['n1']), ('TH56-PT2', array['',''], array['n2']);
      insert into students (id, code, name, "group", year, entry_year, advisor_ids) values
        ('n1', '6704001', 'นศ. รุ่นใหม่ หนึ่ง', 'TH56-PT1', 5, 2570, array['','']),
        ('n2', '6704002', 'นศ. รุ่นใหม่ สอง', 'TH56-PT2', 5, 2570, array['',''])`);
    // จำลองว่าที่ปรึกษาของ PT7 (อ. ทดสอบ หนึ่ง) ตั้งไว้ปีก่อน
    await S.db.exec(`update groups set advisor_year = ${y - 1} where code = 'TH-PT7'`);

    const tctx = await freshBrowser();
    const tp = await loginWithGoogle(tctx, 't1@test.local');
    const dialog = tp.getByRole('dialog', { name: 'เลือกกลุ่มที่ปรึกษา' });
    await dialog.waitFor({ timeout: 15_000 }).catch(() => {});
    const pt7 = await S.db.query<{ a: string[]; y: number }>(`select advisor_ids as a, advisor_year as y from groups where code = 'TH-PT7'`);
    check('เปิดแอป → ล้างที่ปรึกษาของปีก่อนบนเซิร์ฟเวอร์', JSON.stringify(pt7.rows[0]?.a) === '["",""]' && pt7.rows[0]?.y === y, pt7.rows);
    check('อาจารย์ที่ยังไม่มีกลุ่มในปีนี้ ถูกถามให้เลือก', await dialog.isVisible());
    const text = await dialog.innerText();
    check('กล่องแบ่งตามชั้นปี', text.includes('ปี 5') && text.includes('รุ่นที่ยังไม่ขึ้นคลินิก'), text.slice(0, 300));

    await dialog.getByRole('checkbox', { name: 'ปี 5 PT7' }).click();
    await tp.waitForTimeout(2500);
    await dialog.getByRole('checkbox', { name: 'รุ่นที่ยังไม่ขึ้นคลินิก PT1' }).click();
    await tp.waitForTimeout(2500);
    check('ติ๊กแล้วขึ้นว่าเลือกไว้', await dialog.getByRole('checkbox', { name: 'ปี 5 PT7' }).getAttribute('aria-checked') === 'true'
      && await dialog.getByRole('checkbox', { name: 'รุ่นที่ยังไม่ขึ้นคลินิก PT1' }).getAttribute('aria-checked') === 'true');
    const picked = await S.db.query<{ code: string; a: string[] }>(`select code, advisor_ids as a from groups where code in ('TH-PT7', 'TH56-PT1') order by code`);
    const pickedS = await S.db.query<{ n: number }>(`select count(*)::int as n from students where "group" in ('TH-PT7', 'TH56-PT1') and not ('t1' = any(advisor_ids))`);
    check('เลือกได้หลายกลุ่ม ลงเซิร์ฟเวอร์ครบทั้ง groups และ students', picked.rows.every((r) => r.a.includes('t1')) && picked.rows.length === 2 && pickedS.rows[0].n === 0, { g: picked.rows, sMissing: pickedS.rows });
    await dialog.getByRole('button', { name: /เสร็จแล้ว/ }).click();
    await tp.reload();
    await tp.waitForTimeout(5000);
    check('เปิดแอปใหม่ ไม่ถามซ้ำ (ปีนี้เลือกแล้ว)', !(await tp.getByRole('dialog', { name: 'เลือกกลุ่มที่ปรึกษา' }).isVisible()));
    await tctx.close();

    const hctx = await freshBrowser();
    const hp = await loginWithGoogle(hctx, 'head@test.local');
    const hd = hp.getByRole('dialog', { name: 'เลือกกลุ่มที่ปรึกษา' });
    await hd.waitFor({ timeout: 15_000 }).catch(() => {});
    check('หัวหน้าภาค (ยังไม่มีกลุ่มในปีนี้) ถูกถามด้วย', await hd.isVisible());
    await hd.getByRole('button', { name: 'ปีนี้ไม่ได้เป็นที่ปรึกษากลุ่มไหน' }).click();
    await hp.reload();
    await hp.waitForTimeout(5000);
    check('ตอบว่าปีนี้ไม่ได้เป็นที่ปรึกษา → ไม่ถามอีกในปีนี้', !(await hp.getByRole('dialog', { name: 'เลือกกลุ่มที่ปรึกษา' }).isVisible()));

    await hp.evaluate(() => { location.hash = '#/teacher/roster'; });
    await hp.getByText(/อาจารย์ที่ปรึกษาแต่ละกลุ่ม/).waitFor({ timeout: 15_000 });
    const row = hp.locator('[data-group="TH56-PT1"]');
    await row.getByRole('combobox').selectOption('t2');
    await row.getByRole('button', { name: 'บันทึก' }).click();
    await hp.waitForTimeout(3000);
    const g = await S.db.query<{ a: string[] }>(`select advisor_ids as a from groups where code = 'TH56-PT1'`);
    const st = await S.db.query<{ a: string[] }>(`select advisor_ids as a from students where id = 'n1'`);
    check('หัวหน้าภาคเพิ่มที่ปรึกษาท่านที่สองจากหน้ารายชื่อได้', JSON.stringify(g.rows[0]?.a) === '["t1","t2"]' && JSON.stringify(st.rows[0]?.a) === '["t1","t2"]', { g: g.rows, s: st.rows });
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
