/**
 * เทสต์ชุดที่ 22 — "ซ้อมอัปเดตแอปบนเครื่องที่ใช้งานอยู่" · รันด้วย `npm run test:upgrade`
 *
 * ทำไมต้องมี (13 ก.ย. 69): ทุกชุดก่อนหน้าทดสอบ "แอปรุ่นปัจจุบัน" คุยกับตัวเอง
 * แต่วันจริงที่ภาคให้ทุกคนกดอัปเดต เครื่องของแต่ละคนมีของค้างที่ **แอปรุ่นเก่า** เขียนไว้
 * (ลิ้นชัก IndexedDB · คิวรอส่งรูปแบบเก่า · service worker ที่ยังถือไฟล์รุ่นเก่า)
 * ถ้ารุ่นใหม่อ่านของพวกนี้ไม่ออก งานที่ยังไม่ขึ้นเซิร์ฟเวอร์จะหายตอนอัปเดต — พร้อมกันทุกเครื่อง
 *
 * วิธีทำ: build แอปรุ่นเก่าตัวจริงจาก git (ไม่ใช่ของจำลอง) แล้วเปิดใน Chromium จริงผ่าน playwright
 * เสิร์ฟรุ่นเก่ากับรุ่นใหม่บน origin เดียวกัน (IndexedDB ผูกกับ origin) · เซิร์ฟเวอร์คือ local-supabase
 * (Postgres จริง + migration ครบทุกไฟล์ = เซิร์ฟเวอร์ถูกอัปเกรดก่อนเครื่องผู้ใช้ ตามลำดับจริง)
 *
 * ฉากที่ซ้อม (ผ่านหน้าจอจริงทุกขั้น):
 *   รุ่นเก่า ออนไลน์ → เน็ตหลุด → เช็คอินคาบ + กด step → ปิดแอป
 *   → ภาค deploy รุ่นใหม่ → เปิดแอปตอนมีเน็ต 2 ครั้ง → งานทั้งสองอย่างต้องอยู่บนเซิร์ฟเวอร์
 *
 * สองแบบ:
 *   sw      — service worker ยังอยู่ (ปกติ): เปิดครั้งแรกยังเป็นรุ่นเก่า ครั้งถัดไปเป็นรุ่นใหม่
 *   evicted — เบราว์เซอร์ล้าง cache ของ service worker ทิ้งแต่ลิ้นชักยังอยู่ (Safari ทำได้)
 *             → **รุ่นใหม่เจอคิวรูปแบบเก่าตรง ๆ** ไม่มีรุ่นเก่ามาส่งให้ก่อน
 *
 * ผลที่รู้แล้ว (ปักไว้ไม่ให้ใครตีความผิด):
 *   · รุ่นตั้งแต่ 11 ก.ย. 69 (คิวอยู่บนดิสก์) → ต้องไม่หายสักอย่าง
 *   · รุ่นก่อน 11 ก.ย. 69 → step หาย (บั๊กเก่า c73ff80 เกิดตั้งแต่ตอนรุ่นเก่าเปิด รุ่นใหม่แก้ย้อนไม่ได้)
 *     แต่คาบกลับมาได้ เพราะรุ่นใหม่ส่งแถวที่เซิร์ฟเวอร์ยังไม่มี · และ supabase/check-step-mismatch.sql
 *     ต้องชี้เคสนั้นได้ ไม่งั้นไม่มีใครรู้ว่าต้องตามแก้
 *
 * ช้า (~1 นาทีต่อฉาก + build ครั้งแรก) จึงไม่อยู่ใน `npm test` · รันก่อน deploy รุ่นที่แตะ db.ts / cloudSync.ts
 * build รุ่นเก่าเก็บไว้ที่ $TMPDIR/prostho-upgrade-builds ใช้ซ้ำได้
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANON_KEY, startLocalSupabase } from './local-supabase.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
/* พอร์ตตายตัว เพราะที่อยู่เซิร์ฟเวอร์ถูกฝังลงไฟล์ตอน build — build รุ่นเก่าที่เก็บไว้ใช้ซ้ำต้องชี้ที่เดิม */
const API_PORT = 54399;
const WEB = 'http://127.0.0.1:5390';
const CACHE = join(tmpdir(), 'prostho-upgrade-builds');

/** รุ่นที่ซ้อม — เลือกจุดที่รูปแบบข้อมูลในเครื่องเปลี่ยน · `safe` = คาดว่าต้องไม่หายสักอย่าง */
const RELEASES = [
  { commit: '7d51719', label: '12 ก.ย. 69 · คิวบนดิสก์รูปแบบแรก (v1)', safe: true },
  { commit: 'a3ed159', label: '10 ก.ย. 69 · ลิ้นชัก v7 · คิวอยู่ในหน่วยความจำ', safe: false },
  { commit: '2f54dd5', label: '4 ก.ย. 69 · ลิ้นชัก v4 (อัปเกรด 3 ขั้น)', safe: false },
];

let failures = 0;
function check(name: string, ok: boolean, extra: unknown = '') {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra === '' ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
  if (!ok) failures++;
}

/* ── build ─────────────────────────────────────────────────────────────────── */
const env = { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_ANON_KEY: ANON_KEY };

function buildOld(commit: string): string {
  const out = join(CACHE, commit);
  if (existsSync(join(out, 'index.html'))) return out;
  const src = mkdtempSync(join(tmpdir(), `prostho-wt-${commit}-`));
  execFileSync('git', ['worktree', 'add', '--detach', src, commit], { cwd: root, stdio: 'ignore' });
  try {
    symlinkSync(join(root, 'node_modules'), join(src, 'node_modules'));
    execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: src, env, stdio: 'ignore' });
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', src], { cwd: root, stdio: 'ignore' });
  }
  return out;
}
function buildNew(): string {
  const out = mkdtempSync(join(tmpdir(), 'prostho-upgrade-new-'));
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: root, env, stdio: 'ignore' });
  return out;
}
const entryOf = (dir: string) => (readFileSync(join(dir, 'index.html'), 'utf8').match(/assets\/(index-[^"]+\.js)/) ?? [])[1];

/* ── เว็บเซิร์ฟเวอร์ที่สลับรุ่นได้บน origin เดียว ────────────────────────────── */
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const site = { dir: '' };
const web = createServer((req, res) => {
  let f = join(site.dir, decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(site.dir, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(f));
});

/* ── หนึ่งฉาก ─────────────────────────────────────────────────────────────── */
async function scenario(oldDir: string, newDir: string, mode: 'sw' | 'evicted') {
  const S = await startLocalSupabase(API_PORT, { quiet: true });
  const profile = mkdtempSync(join(tmpdir(), 'prostho-upgrade-profile-'));
  const errors: string[] = [];
  /* bypassCSP: CSP ของแอปอนุญาตแค่ *.supabase.co — เซิร์ฟเวอร์จำลองอยู่ที่ 127.0.0.1 */
  const launch = () => chromium.launchPersistentContext(profile, { viewport: { width: 390, height: 844 }, bypassCSP: true });
  const watch = (p: Page) => p.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes(String(API_PORT))) errors.push(`${r.status()} ${r.request().method()} ${decodeURIComponent(r.url()).split('/rest/v1/')[1]?.split('?')[0] ?? r.url()}`);
  });
  const q = async (sql: string) => (await S.db.query<Record<string, number | string>>(sql)).rows;
  const running = (p: Page) => p.evaluate(() => [...document.scripts].map((s) => s.src).join(' '));
  const counts = async () => ({
    checkins: (await q(`select count(*)::int n from checkins where student_id = 's1'`))[0].n,
    updates: (await q(`select count(*)::int n from updates where workpiece_id = 'w1'`))[0].n,
    step: (await q(`select proc_index from workpieces where id = 'w1'`))[0].proc_index,
  });

  let ctx: BrowserContext | null = null;
  try {
    site.dir = oldDir;
    ctx = await launch();
    let page = ctx.pages()[0] ?? await ctx.newPage();
    watch(page);
    await page.goto(WEB + '/');
    const sess = await (await fetch(`${S.url}/auth/v1/dev-session?email=s1@test.local`, { headers: { apikey: S.anonKey } })).json();
    await page.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 })), sess);
    await page.goto(WEB + '/');
    await page.getByRole('button', { name: 'Laboratory work' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(4000); // ให้ sync รอบแรกของรุ่นเก่าจบ — ของที่ค้างหลังจากนี้คือของที่ทำตอนออฟไลน์เท่านั้น
    check('รุ่นเก่าเปิดขึ้นจริง (ไม่ใช่รุ่นใหม่ปลอมตัว)', (await running(page)).includes(entryOf(oldDir)));
    const before = await counts();

    /* เน็ตหลุดกลางคาบ */
    await ctx.setOffline(true);
    await page.getByRole('button', { name: 'Laboratory work' }).click();
    await page.getByText('เช็คอินเลย', { exact: true }).click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => { history.pushState({}, '', '/app/work/w1'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.locator('button', { hasText: 'ทำขั้นนี้เสร็จแล้ว' }).click();
    await page.getByText('ใช่ · บันทึกเลย', { exact: true }).click();
    await page.waitForTimeout(1500);
    if (mode === 'evicted') {
      await page.evaluate(async () => {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        for (const k of await caches.keys()) await caches.delete(k);
      });
    }
    await page.close({ runBeforeUnload: true });
    await ctx.close();
    ctx = null;

    /* ภาค deploy รุ่นใหม่ · ผู้ใช้เปิดแอปตอนมีเน็ต 2 ครั้ง (ครั้งละหนึ่งรอบ sync เต็ม) */
    site.dir = newDir;
    const seen: boolean[] = [];
    for (let i = 0; i < 2; i++) {
      ctx = await launch();
      page = ctx.pages()[0] ?? await ctx.newPage();
      watch(page);
      await page.goto(WEB + '/');
      await page.waitForTimeout(20_000);
      seen.push((await running(page)).includes(entryOf(newDir)));
      await page.close({ runBeforeUnload: true });
      await ctx.close();
      ctx = null;
    }
    check('เปิดครั้งที่สองได้รุ่นใหม่แน่นอน', seen[1], seen);
    if (mode === 'evicted') check('แบบ cache ถูกล้าง: รุ่นใหม่เปิดตั้งแต่ครั้งแรก (อ่านคิวรุ่นเก่าเอง)', seen[0], seen);

    const after = await counts();
    const mismatch = await q(readFileSync(join(root, 'supabase/check-step-mismatch.sql'), 'utf8'));
    return { before, after, mismatch, errors: [...new Set(errors)] };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
    await S.close();
  }
}

/* ── รัน ──────────────────────────────────────────────────────────────────── */
await new Promise<void>((ok) => web.listen(5390, '127.0.0.1', ok));
let newDir = '';
try {
  console.log('build รุ่นปัจจุบัน + รุ่นเก่า (ครั้งแรกช้า)…');
  newDir = buildNew();
  const only = process.argv.slice(2);
  const plan = [{ commit: 'new', label: 'รุ่นปัจจุบัน → รุ่นปัจจุบัน (ตัวคุม: ถ้าข้อนี้ตก แปลว่าตัวเทสต์เองพัง)', safe: true }, ...RELEASES]
    .filter((r) => !only.length || only.includes(r.commit));

  for (const r of plan) {
    const oldDir = r.commit === 'new' ? newDir : buildOld(r.commit);
    for (const mode of r.commit === 'new' ? (['sw'] as const) : (['sw', 'evicted'] as const)) {
      console.log(`\n▶ ${r.label} · ${mode}`);
      const { before, after, mismatch, errors } = await scenario(oldDir, newDir, mode);
      check('คาบที่เช็คอินตอนออฟไลน์ขึ้นเซิร์ฟเวอร์', after.checkins === before.checkins + 1, { before, after });
      check('แถวประวัติ step ขึ้นเซิร์ฟเวอร์', after.updates === before.updates + 1);
      if (r.safe) {
        check('step ของเคสขึ้นเซิร์ฟเวอร์ (ไม่ถูกย้อน)', after.step === before.step + 1, after.step);
        check('ตัวตรวจ step ไม่ตรงประวัติ: ไม่เจออะไร', mismatch.length === 0, mismatch);
      } else {
        /* บั๊กเก่าที่รู้แล้ว — ถ้าวันหนึ่งข้อนี้ "ผ่านเกินคาด" ให้ดูว่าเปลี่ยนอะไรไป แล้วค่อยย้ายเป็น safe */
        check('(รู้แล้ว) step ถูกรุ่นเก่าย้อนก่อนอัปเดต', after.step === before.step, after.step);
        check('ตัวตรวจ check-step-mismatch.sql ชี้เคสที่โดนได้', mismatch.length === 1 && mismatch[0]['รหัสเคส'] === 'w1', mismatch);
      }
      if (errors.length) console.log('   คำขอที่เซิร์ฟเวอร์ปฏิเสธ (ข้อมูลประกอบ ไม่นับตก):', errors.join(' · '));
    }
  }
} finally {
  web.close();
  if (newDir) rmSync(newDir, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
