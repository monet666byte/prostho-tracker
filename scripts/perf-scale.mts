/**
 * วัดความเร็วแอปกับข้อมูลขนาดจริงทั้งปี · รันด้วย `npm run perf:scale [-- --students=200 --weeks=40]`
 *
 * ไม่ใช่เทสต์ผ่าน/ตก — เป็นเครื่องวัด พิมพ์ตัวเลขออกมาให้เทียบก่อน/หลังแก้
 * (ไม่อยู่ใน `npm test` เพราะใช้เวลาหลายนาที และตัวเลขขึ้นกับเครื่องที่รัน)
 *
 * ทำไมต้องมี (13 ก.ย. 69): ข้อมูลที่เคยลองใช้มีแค่ช่วงต้นเทอม (สำเนา 29 ส.ค. = คาบ 1,215 แถว)
 * แต่ปลายปีการศึกษาจะมีคาบ ~16,000 แถว · step ~20,000 แถว · บันทึก audit หลายหมื่นแถว
 * บนมือถือรุ่นเก่าและไวไฟคลินิก — ไม่มีใครเคยเห็นแอปตอนข้อมูลเต็มปีเลย
 *
 * วิธีวัด:
 *   · เซิร์ฟเวอร์ = local-supabase (Postgres จริง) เติมข้อมูลสังเคราะห์ตามรูปแถวจริงจากสำเนา
 *   · แอป = production build ตัวจริง ใน Chromium · หน่วง CPU 4 เท่า (ประมาณมือถือรุ่นเก่า)
 *     และจำลองเน็ตคลินิก (หน่วง 150 ms · 2 Mbps)
 *   · เปิดแอปครั้งแรก (ลิ้นชักว่าง) → รอ sync ครบ → ใช้งานนิ่ง ๆ 60 วิ ขณะที่ "คนอื่น" เช็คอินทุก 5 วิ
 *     → เปิดหน้าหนัก ๆ ของอาจารย์ → เปิดแอปครั้งที่สอง
 *
 * ผลวัดครั้งแรก 13 ก.ย. 69 (200 คน · 40 สัปดาห์ · เครื่องอาจารย์หัวหน้าภาค เห็นทุกแถว):
 *   ① เปิดครั้งแรก 181 วิ · 34.8 MB · main thread ค้างรวม ~4 วิ (ช่วง bulkPut)
 *   ② ระหว่างคาบ: **601 MB/ชม.** → แก้แล้วเหลือ **~3 MB/ชม.** (ดึงเฉพาะแถวที่ขยับ + pullAll ห้ามซ้อน)
 *   ③ หน้าอาจารย์ทุกหน้า เฟรมแรก < 0.4 วิ · ไม่มีหน้าไหนค้างเกิน 0.2 วิ
 *   ④ เปิดครั้งที่สอง: หัวข้อขึ้น 6.6 วิ แล้วยังดึงทั้งตารางใหม่ทุกครั้งที่เปิดแอป (ยังไม่ได้แก้)
 * ⚠️ updated_at ของข้อมูลสังเคราะห์ต้องกระจายตามอายุแถว — ดูคอมเมนต์ตอนเติมข้อมูล
 */
import { chromium, type CDPSession, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANON_KEY, startLocalSupabase } from './local-supabase.mts';
import { procList } from '../src/domain/rules.ts';
import type { WorkType } from '../src/domain/types.ts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const N_STUDENTS = arg('students', 200);
const WEEKS = arg('weeks', 40);
const CPU = arg('cpu', 4);
const BUILD = process.argv.find((a) => a.startsWith('--build='))?.split('=')[1];
const API_PORT = 54398;
const WEB_PORT = 5391;

/* ── ข้อมูลสังเคราะห์ ─────────────────────────────────────────────────────── */
let seed = 20260913;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const TODAY = new Date('2026-09-13T03:00:00Z');
const dayISO = (daysAgo: number) => new Date(TODAY.getTime() - daysAgo * 86400_000).toISOString().slice(0, 10);
const stamp = (daysAgo: number) => new Date(TODAY.getTime() - daysAgo * 86400_000).toISOString();

const backup = (t: string) => JSON.parse(readFileSync(join(root, 'backups/2026-08-29', t + '.json'), 'utf8')) as Record<string, unknown>[];
const ACTIVITIES = ['Oral examination', 'Primary impression', 'Final impression', 'Bite registration', 'Tooth preparation', 'Try in / Delivery', 'Laboratory work'];

function generate() {
  const tplWorks = backup('workpieces');
  const rows: Record<string, Record<string, unknown>[]> = { teachers: [], groups: [], students: [], patients: [], workpieces: [], updates: [], checkins: [], audit: [] };
  const groups = Math.ceil(N_STUDENTS / 8);
  let sIdx = 0;
  for (let g = 1; g <= groups; g++) {
    const code = `TH-PX${g}`;
    const adv = [`tc-px${g}-a`, `tc-px${g}-b`];
    adv.forEach((id, i) => rows.teachers.push({ id, name: `อ. กลุ่ม ${g}${'ab'[i]}`, title: 'อาจารย์ที่ปรึกษากลุ่ม' }));
    const ids: string[] = [];
    for (let k = 0; k < 8 && sIdx < N_STUDENTS; k++, sIdx++) {
      const sid = `st-${code}-${6600000 + sIdx}`;
      ids.push(sid);
      const year = sIdx % 2 ? 6 : 5;
      rows.students.push({ id: sid, code: String(6600000 + sIdx), name: `นศ. ทดสอบ ${sIdx}`, group: code, year, entry_year: year === 6 ? 2568 : 2569, advisor_ids: adv });
      const pats: string[] = [];
      for (let p = 0; p < 8; p++) {
        const pid = `${sid}-p${p}`;
        pats.push(pid);
        rows.patients.push({ id: pid, name: `ผู้ป่วย ${sIdx}-${p}`, hn: `HN-X-${sIdx}-${p}`, sex_age: 'ญ 60 ปี', owner_student_id: sid });
      }
      for (let w = 0; w < 12; w++) {
        const t = pick(tplWorks);
        const list = procList({ type: t.type as WorkType, variant: (t.variant ?? undefined) as never });
        const acceptedAgo = Math.floor(rnd() * WEEKS * 7);
        const proc = list.length ? Math.floor(rnd() * list.length) - (rnd() < 0.1 ? 1 : 0) : -1;
        const wid = `${sid}-w${w}`;
        rows.workpieces.push({ ...t, id: wid, student_id: sid, patient_id: pick(pats), pair_id: null, accepted_date: dayISO(acceptedAgo), proc_index: proc, last_updated_at: stamp(acceptedAgo / 2), completed_at: proc === list.length - 1 ? dayISO(1) : null });
        for (let s = 0; s <= proc; s++) {
          const ago = Math.max(0, Math.floor(acceptedAgo * (1 - (s + 1) / (proc + 2))));
          rows.updates.push({ id: `${wid}-u${s}`, workpiece_id: wid, proc_index: s, progression: list[s]?.[0] ?? 0, performed_at: dayISO(ago), self_performed: false, photo_ids: [], reversal: false, created_by: `นศ. ทดสอบ ${sIdx}`, created_at: stamp(ago), synced_at: stamp(ago) });
          rows.audit.push({ id: `${wid}-a${s}`, text: `ผ่าน ${list[s]?.[1] ?? ''}`, who: `นศ. ทดสอบ ${sIdx}`, at_when: stamp(ago), student_id: sid, group_code: code });
        }
      }
      for (let wk = 0; wk < WEEKS; wk++) {
        for (const off of [0, 3]) {
          const ago = wk * 7 + off + 1;
          const evaluated = wk > 0 || rnd() < 0.5;
          rows.checkins.push({
            id: `ci-${sid}-${dayISO(ago)}`, student_id: sid, date: dayISO(ago), punctual: rnd() > 0.1, checkin_at: '08:55', no_patient: rnd() < 0.1,
            activities: [pick(ACTIVITIES)], status: evaluated ? 'evaluated' : 'pending',
            scores: evaluated ? { time: 3, chart: 3, skill: 2, conduct: 3, knowledge: 3, instrument: 3, precaution: 3, communication: 3 } : null,
            evaluated_by: evaluated ? adv[0] : null, evaluated_at: evaluated ? stamp(ago - 0.2) : null, created_at: stamp(ago), score_history: [],
          });
          rows.audit.push({ id: `a-ci-${sid}-${ago}`, text: 'เช็คอินคาบคลินิก', who: `นศ. ทดสอบ ${sIdx}`, at_when: stamp(ago), student_id: sid, group_code: code });
        }
      }
    }
    rows.groups.push({ code, advisor_ids: adv, student_ids: ids });
  }
  return rows;
}

/* ── build + เว็บ ─────────────────────────────────────────────────────────── */
function build(): string {
  if (BUILD) return BUILD;
  const out = mkdtempSync(join(tmpdir(), 'prostho-perf-'));
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
    cwd: root, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_ANON_KEY: ANON_KEY },
  });
  return out;
}
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

/* ── วัด ──────────────────────────────────────────────────────────────────── */
interface Net { requests: number; bytes: number }
function meter(page: Page): Net {
  const n: Net = { requests: 0, bytes: 0 };
  page.on('requestfinished', async (r) => {
    if (!r.url().includes(`:${API_PORT}/rest/`)) return;
    n.requests++;
    if (process.env.PERF_DEBUG) console.log('   req', decodeURIComponent(r.url()).split('/rest/v1/')[1]?.slice(0, 140)); // PERF_DEBUG=1 ดูว่ายิงอะไรบ้าง
    const s = await r.sizes().catch(() => null);
    if (s) n.bytes += s.responseBodySize + s.responseHeadersSize + s.requestBodySize;
  });
  return n;
}
async function throttle(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 250_000, uploadThroughput: 125_000 });
  return cdp;
}
/** เวลาที่ main thread ถูกบล็อก (long task > 50ms) ในช่วงหนึ่ง — ตัวเลขที่ผู้ใช้รู้สึกว่า "ค้าง" */
const installLongTasks = (page: Page) => page.addInitScript(() => {
  (window as never as { __lt: number[] }).__lt = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as never as { __lt: number[] }).__lt.push(e.duration))).observe({ type: 'longtask', buffered: true });
});
const takeLongTasks = (page: Page) => page.evaluate(() => { const w = window as never as { __lt: number[] }; const a = w.__lt; w.__lt = []; return { blockingMs: Math.round(a.reduce((s, d) => s + d - 50, 0)), longest: Math.round(Math.max(0, ...a)), count: a.length }; });
const localCount = (page: Page, table: string) => page.evaluate((t) => new Promise<number>((ok) => {
  const r = indexedDB.open('prostho-tracker');
  r.onsuccess = () => { try { const c = r.result.transaction(t).objectStore(t).count(); c.onsuccess = () => ok(c.result); } catch { ok(-1); } };
  r.onerror = () => ok(-1);
}), table);
const heapMB = (page: Page) => page.evaluate(() => Math.round(((performance as never as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6));

const S = await startLocalSupabase(API_PORT, { quiet: true });
const dist = build();
const web = createServer((req, res) => {
  let f = join(dist, decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise<void>((ok) => web.listen(WEB_PORT, '127.0.0.1', ok));
const profile = mkdtempSync(join(tmpdir(), 'prostho-perf-profile-'));

try {
  const t0 = Date.now();
  const data = generate();
  /* updated_at ต้องกระจายตามอายุแถวเหมือนของจริง — รอบแรกที่ใส่ "เวลาที่เติม" ให้ทุกแถว
     ทุกแถวตกอยู่ในช่วงเผื่อ 2 นาทีของการดึงเฉพาะที่ขยับ แล้วตัวเลขข้อ ② ออกมาเหมือนดึงทั้งตาราง */
  /* ปิด trigger ตอนเติม — ข้อมูลสังเคราะห์ใส่คะแนนย้อนหลังในนามเซิร์ฟเวอร์ ไม่ได้ผ่านสิทธิ์ของใคร
     (ตราเวลา updated_at จึงเป็นค่า default now() ของคอลัมน์ ไม่ใช่ของ trigger — ผลต่อการวัดเท่ากัน) */
  await S.db.exec(`set session_replication_role = replica`);
  for (const [table, list] of Object.entries(data)) {
    for (let i = 0; i < list.length; i += 2000) {
      await S.db.query(`insert into "${table}" select * from jsonb_populate_recordset(null::"${table}", $1::jsonb) on conflict do nothing`, [JSON.stringify(list.slice(i, i + 2000).map((r) => ({ ...r, updated_at: String(r.created_at ?? r.at_when ?? stamp(30)) })))]);
    }
  }
  await S.db.exec(`set session_replication_role = origin`);
  const sizes = Object.fromEntries(await Promise.all([...Object.keys(data)].map(async (t) => [t, (await S.db.query<{ n: number }>(`select count(*)::int n from "${t}"`)).rows[0].n])));
  console.log(`ข้อมูลบนเซิร์ฟเวอร์ (${N_STUDENTS} คน · ${WEEKS} สัปดาห์ · เติมใน ${((Date.now() - t0) / 1000).toFixed(0)} วิ):`, sizes);

  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 390, height: 844 }, bypassCSP: true, serviceWorkers: 'block' });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await installLongTasks(page);
  const sess = await (await fetch(`${S.url}/auth/v1/dev-session?email=head@test.local`, { headers: { apikey: S.anonKey } })).json();
  await page.goto(`http://127.0.0.1:${WEB_PORT}/login`);
  await page.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 7200 })), sess);
  await throttle(page);
  const net = meter(page);

  /* ① เปิดครั้งแรก — ลิ้นชักว่าง ต้องดึงทุกอย่าง */
  let t = Date.now();
  await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  /* ต้องรอครบทุกตารางใหญ่ — audit อยู่ท้าย TABLES และใหญ่ที่สุด (~10 MB)
     รอบแรกที่เขียนสคริปต์นี้รอแค่ checkins แล้วข้อ ② ไปวัดหางของการดึงครั้งแรกแทน */
  let synced = -1;
  for (let i = 0; i < 600; i++) {
    const [c, u, a] = [await localCount(page, 'checkins'), await localCount(page, 'updates'), await localCount(page, 'audit')];
    if (c >= sizes.checkins && u >= sizes.updates && a >= sizes.audit) { synced = Date.now() - t; break; }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  console.log('\n① เปิดครั้งแรก (ลิ้นชักว่าง)');
  console.log('   ข้อมูลลงเครื่องครบใน', synced < 0 ? 'ไม่ครบใน 10 นาที' : `${(synced / 1000).toFixed(1)} วิ`, '·', net.requests, 'คำขอ ·', (net.bytes / 1e6).toFixed(1), 'MB');
  console.log('   main thread ค้าง:', await takeLongTasks(page), '· heap', await heapMB(page), 'MB');
  const est = await page.evaluate(() => navigator.storage.estimate());
  console.log('   พื้นที่ในเครื่อง', ((est.usage ?? 0) / 1e6).toFixed(1), 'MB');

  /* ② ใช้งานนิ่ง ๆ 60 วิ ขณะที่คนอื่นเช็คอินทุก 5 วิ (คาบคลินิกจริง) */
  net.requests = 0; net.bytes = 0;
  let k = 0;
  const others = setInterval(() => {
    const sid = `st-TH-PX1-${6600000 + (k % 8)}`;
    void S.db.query(`insert into checkins (id, student_id, date, activities, created_at) values ($1, $2, '2026-09-13', array['Laboratory work'], now()::text)`, [`ci-live-${k++}`, sid]);
  }, 5000);
  await page.waitForTimeout(60_000);
  clearInterval(others);
  console.log('\n② ใช้งานนิ่ง 60 วิ ระหว่างคาบ (คนอื่นเช็คอิน', k, 'ครั้ง)');
  console.log('   เน็ตที่ใช้:', net.requests, 'คำขอ ·', (net.bytes / 1e6).toFixed(1), 'MB  → ต่อชั่วโมง ≈', ((net.bytes / 1e6) * 60).toFixed(0), 'MB');
  console.log('   main thread ค้าง:', await takeLongTasks(page));

  /* ③ หน้าหนักของอาจารย์ */
  console.log('\n③ เปิดหน้า (หน่วง CPU', CPU, 'เท่า)');
  for (const path of ['/teacher', '/teacher/analytics', '/teacher/group', '/teacher/evaluate', '/teacher/roster', '/teacher/alumni']) {
    await takeLongTasks(page);
    t = Date.now();
    await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    const firstFrame = Date.now() - t;
    await page.waitForTimeout(2500);
    console.log(`   ${path.padEnd(20)} เฟรมแรก ${String(firstFrame).padStart(5)} ms · ค้างรวม`, await takeLongTasks(page));
  }

  /* ④ เปิดแอปครั้งที่สอง (ข้อมูลอยู่ในเครื่องแล้ว) */
  net.requests = 0; net.bytes = 0;
  t = Date.now();
  await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await page.getByRole('heading').first().waitFor({ timeout: 120_000 });
  const firstHeading = Date.now() - t;
  await page.waitForTimeout(20_000);
  console.log('\n④ เปิดแอปครั้งที่สอง');
  console.log('   หัวข้อแรกขึ้นใน', firstHeading, 'ms · 20 วิแรกใช้เน็ต', net.requests, 'คำขอ ·', (net.bytes / 1e6).toFixed(1), 'MB');
  console.log('   main thread ค้าง:', await takeLongTasks(page), '· heap', await heapMB(page), 'MB');
  await ctx.close();
} finally {
  web.close();
  await S.close();
  rmSync(profile, { recursive: true, force: true });
  if (!BUILD) rmSync(dist, { recursive: true, force: true });
}
