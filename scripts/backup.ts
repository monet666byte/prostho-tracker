/**
 * สำรองข้อมูลจากตู้แฟ้มกลาง → ไฟล์ในเครื่อง
 *
 * ทำไมต้องมี: Supabase แผนฟรีไม่มี backup อัตโนมัติ — ถ้าใครลบผิด หรือโปรเจคมีปัญหา
 * ข้อมูลหายถาวร ระบบที่เป็น "ทะเบียนงานจริงของ 96 คน" รับความเสี่ยงแบบนั้นไม่ได้
 *
 * วิธีใช้:  npm run backup
 * ตั้งเวลาอัตโนมัติ (แนะนำวันละครั้ง) ดูวิธีท้ายไฟล์
 *
 * ต้องมีใน .env.local:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY  (มีอยู่แล้ว)
 *   BACKUP_EMAIL, BACKUP_PASSWORD              ← บัญชีที่เป็นหัวหน้าภาค (เห็นข้อมูลครบ)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** ตาราง → คอลัมน์ที่ใช้เรียงตอนดึงทีละหน้า (ต้องเรียงคงที่ ไม่งั้นแถวซ้ำ/ตกหล่น) */
const TABLES: Array<[table: string, orderBy: string]> = [
  ['teachers', 'id'], ['students', 'id'], ['groups', 'code'], ['patients', 'id'],
  ['workpieces', 'id'], ['updates', 'id'], ['photos', 'id'], ['checkins', 'id'],
  ['reviews', 'id'], ['submissions', 'id'], ['issues', 'student_id'], ['audit', 'id'],
  ['invites', 'email'], ['app_users', 'uid'],
];

/** เก็บย้อนหลังกี่วัน — เกินนี้ลบทิ้งอัตโนมัติ กันดิสก์เต็ม */
const KEEP_DAYS = 30;
const PAGE = 1000;

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

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('✗ ไม่เจอ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน .env.local');
    process.exit(1);
  }

  // ต้องล็อกอินก่อน — ยามที่ฐานข้อมูลไม่ปล่อยให้คนที่ไม่ล็อกอินอ่านอะไรเลย (ตั้งใจให้เป็นแบบนั้น)
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (env.SUPABASE_SERVICE_KEY) {
    // ถ้ามีกุญแจแม่บ้าน (service key) ใช้ตัวนั้นตรงๆ ได้เลย ไม่ต้องล็อกอิน
    headers.Authorization = `Bearer ${env.SUPABASE_SERVICE_KEY}`;
    headers.apikey = env.SUPABASE_SERVICE_KEY;
  } else {
    if (!env.BACKUP_EMAIL || !env.BACKUP_PASSWORD) {
      console.error('✗ ต้องใส่ BACKUP_EMAIL / BACKUP_PASSWORD ใน .env.local (บัญชีหัวหน้าภาค)');
      console.error('  หรือใส่ SUPABASE_SERVICE_KEY แทนก็ได้');
      process.exit(1);
    }
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: env.BACKUP_EMAIL, password: env.BACKUP_PASSWORD }),
    });
    const auth = await res.json();
    if (!auth.access_token) {
      console.error('✗ ล็อกอินไม่ผ่าน:', auth.error_description ?? auth.msg ?? JSON.stringify(auth));
      process.exit(1);
    }
    headers.Authorization = `Bearer ${auth.access_token}`;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const dir = join('backups', stamp);
  mkdirSync(dir, { recursive: true });

  let total = 0;
  const summary: Record<string, number> = {};

  for (const [table, orderBy] of TABLES) {
    const rows: unknown[] = [];
    // ดึงทีละหน้า — เซิร์ฟเวอร์ตัดที่ 1,000 แถวเสมอ (บทเรียนจากบั๊กที่เจอ 29 ส.ค.)
    for (let from = 0; ; from += PAGE) {
      const res = await fetch(
        `${url}/rest/v1/${table}?select=*&order=${orderBy}.asc&limit=${PAGE}&offset=${from}`,
        { headers },
      );
      if (!res.ok) {
        console.warn(`  ⚠ ${table}: ${res.status} ${(await res.text()).slice(0, 80)}`);
        break;
      }
      const page = (await res.json()) as unknown[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows, null, 1), 'utf8');
    summary[table] = rows.length;
    total += rows.length;
  }

  writeFileSync(
    join(dir, '_meta.json'),
    JSON.stringify({ takenAt: new Date().toISOString(), url, tables: summary, total }, null, 1),
    'utf8',
  );

  console.log(`✓ สำรองข้อมูลแล้ว → ${dir}`);
  for (const [t, n] of Object.entries(summary)) console.log(`   ${t.padEnd(12)} ${n}`);
  console.log(`   รวม ${total} แถว`);

  // ลบชุดเก่าเกิน KEEP_DAYS
  const all = existsSync('backups') ? readdirSync('backups').filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  const drop = all.slice(0, Math.max(0, all.length - KEEP_DAYS));
  for (const d of drop) {
    rmSync(join('backups', d), { recursive: true, force: true });
    console.log(`   (ลบชุดเก่า ${d})`);
  }
}

main().catch((e) => {
  console.error('✗ สำรองข้อมูลล้มเหลว:', e);
  process.exit(1);
});

/*
 ── ตั้งให้สำรองอัตโนมัติทุกวันบน Mac ──────────────────────────────────────────
 เปิด Terminal แล้วพิมพ์:   crontab -e
 เพิ่มบรรทัดนี้ (สำรองทุกวัน 21:00 น. — เครื่องต้องเปิดอยู่):

   0 21 * * * cd "/Users/livphatchara/Desktop/prosth clinic prog/prostho-tracker" && /Users/livphatchara/.local/node/bin/npx tsx scripts/backup.ts >> backups/cron.log 2>&1

 ตรวจว่าทำงานไหม:  ดูไฟล์ backups/cron.log และโฟลเดอร์ backups/<วันที่>
 ─────────────────────────────────────────────────────────────────────────────
*/
