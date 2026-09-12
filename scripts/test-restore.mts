/**
 * ทดสอบว่า "สำเนาที่เรามี กู้กลับได้จริง และถ้ากู้ไม่ครบต้องมีใครรู้"
 * รันด้วย `npm run test:restore`
 *
 * ทำไมต้องมี (12 ก.ย. 69): เรามี `npm run backup` มาตั้งแต่ ส.ค. โดยไม่มีอะไรกู้กลับ
 * และไม่มีใครเคยลอง · ความเสี่ยงของตัวกู้ข้อมูลไม่ใช่ "พังแล้วมี error"
 * แต่เป็น **กู้เสร็จ ดูเรียบร้อย แต่ข้อมูลไม่ครบ** ซึ่งจะรู้ตัวตอนที่สายไปแล้ว
 * เทสต์ชุดนี้จึงเน้นสามเรื่อง:
 *   ① `checkSet` ต้องจับสำเนาเสียได้ทุกแบบ (ไฟล์หาย · JSON เสีย · จำนวนไม่ตรง · รูปหาย)
 *   ② รายการตารางของตัวสำรองกับตัวกู้ต้องเท่ากันตลอด — ต่างกันคือกู้กลับไม่ครบเงียบๆ
 *   ③ วิธียิงต้องตรงกับ trigger บนเซิร์ฟเวอร์จริง (audit ห้าม upsert · ห้ามใช้ service key)
 *
 * ข้อ ③ เป็นเทสต์ "กันคนแก้ทีหลังโดยไม่รู้เหตุผล" — ถ้าวันหน้าใครเปลี่ยน audit
 * ให้เป็น upsert เพราะดูสมเหตุสมผลกว่า เทสต์จะฟ้องพร้อมเหตุผลว่าทำไมห้าม
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const { checkSet, latestSet, writeTable, PLAN } = await import(join(root, 'scripts/restore.ts'));

let failures = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}`, extra === undefined ? '' : extra);
  }
};

/* ── ตัวช่วยสร้างสำเนาปลอมบนดิสก์ ─────────────────────────────────────────── */

const ALL = PLAN.map((p: { table: string }) => p.table);

/** สร้างโฟลเดอร์สำเนาที่ "ครบและถูกต้อง" แล้วให้ mutate ทำให้เสียตามที่อยากทดสอบ */
function makeSet(opts: {
  rows?: Record<string, number>;
  /** ตารางที่จะ "ไม่สร้างไฟล์" */
  omit?: string[];
  /** ตารางที่จะเขียน JSON เสีย */
  broken?: string[];
  /** _meta บอกตัวเลขอื่น (ตาราง → ตัวเลขที่จะโกหก) */
  metaLies?: Record<string, number>;
  /** ไม่สร้าง _meta.json เลย */
  noMeta?: boolean;
  /** แถว photos ที่มี storage_path + ไฟล์ที่จะวางจริง */
  photos?: { rows: string[]; files: string[] };
} = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'restore-set-'));
  const counts: Record<string, number> = {};
  for (const table of ALL) {
    if (opts.omit?.includes(table)) continue;
    if (opts.broken?.includes(table)) {
      writeFileSync(join(dir, `${table}.json`), '{ นี่ไม่ใช่ JSON', 'utf8');
      counts[table] = 0;
      continue;
    }
    const n = opts.rows?.[table] ?? 1;
    const rows = Array.from({ length: n }, (_, i) => ({ id: `${table}-${i}` }));
    writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows), 'utf8');
    counts[table] = n;
  }
  if (opts.photos) {
    writeFileSync(
      join(dir, 'photos.json'),
      JSON.stringify(opts.photos.rows.map((p, i) => ({ id: `ph${i}`, storage_path: p }))),
      'utf8',
    );
    counts.photos = opts.photos.rows.length;
    for (const f of opts.photos.files) {
      const dest = join(dir, 'photos', f);
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, Buffer.from([0xff, 0xd8, 0xff]));
    }
  }
  if (!opts.noMeta) {
    writeFileSync(join(dir, '_meta.json'), JSON.stringify({
      takenAt: '2026-09-12T00:00:00.000Z',
      url: 'https://fake.supabase.co',
      tables: { ...counts, ...(opts.metaLies ?? {}) },
    }), 'utf8');
  }
  return dir;
}

const trash: string[] = [];
const set = (o?: Parameters<typeof makeSet>[0]) => {
  const d = makeSet(o);
  trash.push(d);
  return d;
};

/* ══ ① สำเนาที่ดี ต้องผ่านสะอาด ════════════════════════════════════════════ */
console.log('สำเนาที่ครบถ้วน');
{
  const c = checkSet(set({ rows: { patients: 389, checkins: 1215 } }));
  check('ไม่มีตารางขาด', c.missingTables.length === 0, c.missingTables);
  check('ไม่มีไฟล์เสีย', c.brokenFiles.length === 0, c.brokenFiles);
  check('จำนวนตรงกับ _meta', c.countMismatch.length === 0, c.countMismatch);
  check('นับแถวรวมถูก', c.total === 389 + 1215 + (ALL.length - 2), c.total);
  check('อ่าน takenAt ได้', c.takenAt === '2026-09-12T00:00:00.000Z');
  check('อ่านต้นทางได้ (กันกู้ข้ามโปรเจกต์โดยไม่รู้ตัว)', c.sourceUrl === 'https://fake.supabase.co');
}

/* ══ ② ตารางขาด — เคสจริงของสำเนา 29 ส.ค. ═══════════════════════════════════
   สำเนาชุดเดียวที่มีอยู่ตอนนี้ทำก่อนที่ backup.ts จะครอบ 5 ตารางที่เพิ่มใน
   migration 0010/0012/0014/0016 · ถ้าเอาไปกู้โดยไม่มีใครเตือน
   คำตอบแบบประเมินตนเองกับสมุด Section II/III ทั้งเล่มจะไม่กลับมา — และไม่มี error */
console.log('\nสำเนาที่ขาดตาราง (เคสจริง 29 ส.ค.)');
{
  const c = checkSet(set({ omit: ['self_assessments', 'sect2_records', 'sect3_records', 'app_settings', 'pdpa_policy'] }));
  check('รายงานว่าขาด 5 ตาราง', c.missingTables.length === 5, c.missingTables);
  check('บอกชื่อตารางที่ขาด', c.missingTables.includes('sect2_records'));
  check('ตารางที่เหลืออ่านได้ปกติ', c.brokenFiles.length === 0);
}

/* ══ ③ ไฟล์เสีย — เงียบที่สุด อันตรายที่สุด ═════════════════════════════════ */
console.log('\nไฟล์ JSON เสีย');
{
  const c = checkSet(set({ broken: ['patients', 'checkins'] }));
  check('รายงานไฟล์ที่อ่านไม่ออก', c.brokenFiles.length === 2, c.brokenFiles);
  check('ไม่นับแถวของไฟล์เสีย', c.rows.patients === undefined);
  check('ไม่นับไฟล์เสียเป็น "ตารางขาด" (คนละอาการ คนละวิธีแก้)', !c.missingTables.includes('patients'));
}
{
  /* ไฟล์ที่เป็น JSON ถูกต้องแต่ไม่ใช่ array — เช่นใครเผลอก๊อป _meta ไปทับ
     JSON.parse ผ่าน แต่ rows.length เป็น undefined แล้วทุกอย่างจะดู "0 แถว" เฉยๆ */
  const dir = set();
  writeFileSync(join(dir, 'patients.json'), '{"id":"p1"}', 'utf8');
  const c = checkSet(dir);
  check('JSON ที่ไม่ใช่ array ก็นับเป็นไฟล์เสีย', c.brokenFiles.includes('patients.json'), c.brokenFiles);
}

/* ══ ④ จำนวนไม่ตรงกับ _meta = สำเนาถูกแก้หรือก๊อปไม่ครบ ════════════════════ */
console.log('\nจำนวนแถวไม่ตรงกับที่ _meta บอก');
{
  const c = checkSet(set({ rows: { patients: 100 }, metaLies: { patients: 389 } }));
  check('จับได้ว่าไม่ตรง', c.countMismatch.length === 1, c.countMismatch);
  check('บอกทั้งสองตัวเลขให้เทียบเอง',
    c.countMismatch[0]?.meta === 389 && c.countMismatch[0]?.actual === 100, c.countMismatch[0]);
}
{
  const c = checkSet(set({ noMeta: true }));
  check('ไม่มี _meta เลยก็ต้องฟ้อง (ไม่มีอะไรให้เทียบ = เชื่อสำเนาไม่ได้)',
    c.brokenFiles.some((f: string) => f.startsWith('_meta')), c.brokenFiles);
}

/* ══ ⑤ รูปงาน — ของชิ้นเดียวที่หายแล้วสร้างใหม่ไม่ได้ ═══════════════════════ */
console.log('\nรูปงานในสำเนา');
{
  const c = checkSet(set({
    photos: { rows: ['st1/w1/a.jpg', 'st1/w1/b.jpg', 'st2/w9/c.jpg'], files: ['st1/w1/a.jpg'] },
  }));
  check('นับไฟล์รูปที่มีจริง', c.photoFiles === 1, c.photoFiles);
  check('จับได้ว่ามี 2 ใบที่แถวบอกว่ามีแต่ไฟล์ไม่อยู่', c.photoRowsWithoutFile === 2, c.photoRowsWithoutFile);
}
{
  const c = checkSet(set({ photos: { rows: [], files: [] } }));
  check('ไม่มีรูปเลยก็ไม่ใช่ความผิดพลาด', c.photoRowsWithoutFile === 0 && c.photoFiles === 0);
}

/* ══ ⑥ latestSet เลือกชุดล่าสุด ═════════════════════════════════════════════ */
console.log('\nเลือกชุดสำเนา');
{
  const fake = mkdtempSync(join(tmpdir(), 'restore-root-'));
  trash.push(fake);
  for (const d of ['2026-08-29', '2026-09-01', '2026-09-12', 'cron.log']) mkdirSync(join(fake, d));
  check('เลือกวันที่ใหม่สุด', latestSet(fake) === join(fake, '2026-09-12'), latestSet(fake));
  const empty = mkdtempSync(join(tmpdir(), 'restore-empty-'));
  trash.push(empty);
  check('ไม่มีสำเนาเลยคืน null', latestSet(empty) === null);
  check('ยังไม่มีโฟลเดอร์ backups ก็ไม่พัง', latestSet(join(empty, 'ไม่มีจริง')) === null);
}

/* ══ ⑦ รายการตารางของตัวสำรอง = ตัวกู้ ═════════════════════════════════════
   กับดักเดิมที่เจอมาแล้วจริง (11 ก.ย.): backup.ts ขาด 5 ตาราง ไม่มี error ให้ใครเห็น
   ตอนนี้มีสองรายการที่ต้องตรงกัน — cloudSync (แอปใช้) · backup (สำรอง) · restore (กู้)
   test:offline ข้อ ⑦ เทียบสองตัวแรกแล้ว ตัวนี้ปิดวงให้ครบ */
console.log('\nรายการตาราง: สำรอง ↔ กู้ ต้องเท่ากัน');
{
  const backupSrc = readFileSync(join(root, 'scripts/backup.ts'), 'utf8');
  const block = backupSrc.slice(backupSrc.indexOf('const TABLES'), backupSrc.indexOf('/** บักเก็ตรูปงาน'));
  /* ⚠️ ต้องมี 0-9 ในคลาส — ชื่อตารางจริงมี `sect2_records` / `sect3_records`
     ครั้งแรกเขียน [a-z_]+ แล้วเทสต์ฟ้องว่าสองตารางนั้น "ไม่เคยถูกสำรอง" ซึ่งผิด
     (บทเรียน: regex ที่อ่านโค้ดเป็นข้อมูล ต้องพิสูจน์ว่าอ่านได้ครบก่อนเชื่อผลมัน) */
  const backupTables = [...block.matchAll(/\['([a-z0-9_]+)',\s*'[a-z0-9_]+'\]/g)].map((m) => m[1]);
  /* `photos` อยู่ในตัวสำรองแต่ไม่อยู่ใน PLAN ของตัวกู้โดยเจตนา — ไบต์รูปกู้ผ่านบักเก็ต
     ส่วนแถวในตารางกู้พร้อมกับ workpieces ไม่ได้ เพราะ storage_path ต้องมีไฟล์อยู่จริงก่อน */
  const restoreTables: string[] = PLAN.map((p: { table: string }) => p.table);

  check('ตัวสำรองอ่านรายการได้ (ไม่ใช่ regex ตกรูป)', backupTables.length >= 14, backupTables.length);
  const missingInRestore = backupTables.filter((t) => t !== 'photos' && !restoreTables.includes(t));
  check('ทุกตารางที่สำรองไว้ มีทางกู้กลับ', missingInRestore.length === 0, missingInRestore);
  const missingInBackup = restoreTables.filter((t) => !backupTables.includes(t));
  check('ไม่มีตารางที่กู้ได้แต่ไม่เคยถูกสำรอง', missingInBackup.length === 0, missingInBackup);
  check('ตัวกู้รู้จัก photos.json (ใช้ตรวจว่าไฟล์รูปครบ)', backupTables.includes('photos'));
}

/* ══ ⑧ วิธียิงต้องตรงกับ trigger จริงบนเซิร์ฟเวอร์ ═════════════════════════ */
console.log('\nวิธียิงต้องตรงกับกติกาของฐานข้อมูล');
{
  const auditPlan = PLAN.find((p: { table: string }) => p.table === 'audit');
  check('audit ยิงแบบ "มีแล้วข้าม" ไม่ใช่ upsert (trigger audit_no_change ห้าม update)',
    auditPlan?.mode === 'insert-missing', auditPlan?.mode);

  const m0009 = readFileSync(join(root, 'supabase/migrations/0009_close_holes.sql'), 'utf8');
  check('trigger ที่ห้ามแก้ audit ยังอยู่จริงใน 0009 (ถ้าถูกถอด กติกาข้างบนก็เปลี่ยนได้)',
    /audit_no_change/.test(m0009) && /before update or delete on audit/.test(m0009));

  const m0017 = readFileSync(join(root, 'supabase/migrations/0017_conflict.sql'), 'utf8');
  check('trigger ของ checkins ยังเช็ค is_teacher() จริง (เหตุผลที่ห้ามใช้ service key)',
    /checkin_scoring_guard/.test(m0017) && /is_teacher\(\)/.test(m0017));

  const restoreSrc = readFileSync(join(root, 'scripts/restore.ts'), 'utf8');
  check('ตัวกู้ไม่รับ SUPABASE_SERVICE_KEY (backup.ts รับได้ แต่ restore รับไม่ได้)',
    !/SUPABASE_SERVICE_KEY/.test(restoreSrc));
  check('ตัวกู้ตรวจว่าล็อกอินเป็นอาจารย์ก่อนเขียน', /isTeacher/.test(restoreSrc));
  check('เขียนจริงต้องใส่ --yes เท่านั้น', /args\.includes\('--yes'\)/.test(restoreSrc));
}

/* ══ ⑨ ยิงจริงใส่เซิร์ฟเวอร์ปลอม — ก้อนตกต้องไม่ลากของดีไปด้วย ════════════
   บทเรียนเดียวกับ pushAll ใน cloudSync.ts: PostgREST ปฏิเสธทั้งก้อนถ้าแถวเดียวผิด
   ตอนกู้ข้อมูลมันแย่กว่าปกติ เพราะคนกดคือคนที่ข้อมูลหายไปแล้ว — จะไม่มีรอบสอง */
console.log('\nเซิร์ฟเวอร์ปฏิเสธบางแถว');
{
  const calls: Array<{ table: string; prefer: string; count: number }> = [];
  const target = {
    url: 'https://fake.supabase.co',
    headers: { apikey: 'k', Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    as: 'head@x', isTeacher: true,
  };

  /** เซิร์ฟเวอร์ปลอม: ปฏิเสธแถวที่ id ลงท้าย -bad */
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Array<{ id: string }>;
    calls.push({
      table: String(u).split('/rest/v1/')[1],
      prefer: init.headers.Prefer,
      count: body.length,
    });
    const bad = body.some((r) => r.id.endsWith('-bad'));
    return bad
      ? { ok: false, text: async () => 'new row violates row-level security policy' }
      : { ok: true, text: async () => '' };
  }) as never;

  try {
    const rows = [{ id: 'a' }, { id: 'b-bad' }, { id: 'c' }];
    const rep = await writeTable(target, 'patients', rows, 'upsert');
    check('แถวดีเข้าได้ทั้งสองแถว', rep.ok === 2, rep);
    check('แถวเสียถูกนับว่าตก 1 แถว', rep.failed === 1, rep);
    check('เก็บข้อความ error ไว้ให้คนอ่าน', /row-level security/.test(rep.firstError ?? ''), rep.firstError);
    check('ยิงก้อนก่อน แล้วค่อยแยกทีละแถว', calls[0].count === 3 && calls.slice(1).every((c) => c.count === 1), calls);
    check('upsert ใช้ merge-duplicates', /merge-duplicates/.test(calls[0].prefer), calls[0].prefer);

    calls.length = 0;
    await writeTable(target, 'audit', [{ id: 'x' }], 'insert-missing');
    check('audit ใช้ ignore-duplicates', /ignore-duplicates/.test(calls[0].prefer), calls[0].prefer);

    calls.length = 0;
    const many = Array.from({ length: 1201 }, (_, i) => ({ id: `r${i}` }));
    const rep2 = await writeTable(target, 'checkins', many, 'upsert');
    check('แบ่งก้อนละ 500 (PostgREST ตัดที่ 1,000 แถว)',
      calls.length === 3 && calls[0].count === 500 && calls[2].count === 201, calls.map((c) => c.count));
    check('1,201 แถวเข้าครบ', rep2.ok === 1201, rep2);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/* ══ ⑩ สำเนาจริงที่มีอยู่ในเครื่อง ═════════════════════════════════════════
   ไม่ได้เทสต์โค้ด — เทสต์ว่า "ของจริงที่เรามีอยู่ตอนนี้ กู้ได้ไหม"
   ถ้าไม่มีสำเนาในเครื่องเลย ข้ามไป (เครื่อง CI / เครื่องคนอื่น) */
console.log('\nสำเนาจริงในเครื่องนี้');
{
  const real = latestSet(join(root, 'backups'));
  if (!real) {
    console.log('  – ไม่มีสำเนาในเครื่องนี้ ข้ามข้อนี้');
  } else {
    const c = checkSet(real);
    check('อ่านได้ทุกไฟล์ที่มี', c.brokenFiles.length === 0, c.brokenFiles);
    check('จำนวนแถวตรงกับ _meta', c.countMismatch.length === 0, c.countMismatch);
    check('ไฟล์รูปครบตามที่แถวบอก', c.photoRowsWithoutFile === 0, c.photoRowsWithoutFile);
    if (c.missingTables.length) {
      console.log(`  – สำเนาชุดนี้ (${c.takenAt?.slice(0, 10)}) ขาด ${c.missingTables.length} ตาราง: ${c.missingTables.join(', ')}`);
      console.log('    ไม่ใช่บั๊ก — ทำก่อนที่ backup.ts จะครอบ · ต้องรัน npm run backup ใหม่ให้ได้ชุดที่ครบ');
    }
  }
}

for (const d of trash) rmSync(d, { recursive: true, force: true });

console.log(failures ? `\n❌ ตก ${failures} ข้อ` : '\n✅ ผ่านหมด');
process.exit(failures ? 1 : 0);
