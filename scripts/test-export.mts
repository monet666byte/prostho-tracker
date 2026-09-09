/**
 * เทสต์ชุดที่ 11 — ประตูส่งออกข้อมูล · รันด้วย `npm run test:export`
 *
 * ทำไมต้องมี: `lib/export.ts` คือจุดเดียวที่ข้อมูลผู้ป่วย "ออกจากระบบ" ไปเป็นไฟล์
 * ไฟล์ที่ออกไปแล้วเรียกคืนไม่ได้ ไม่มี undo ไม่มี audit ย้อนหลัง
 * สามเรื่องที่ต้องจริงเสมอ:
 *   ① ไม่มีสิทธิ์ = ไม่มีไฟล์ · ขอแบบมีชื่อแต่ไม่มีสิทธิ์ = ได้ไฟล์ปิดบัง ไม่ใช่ปฏิเสธทิ้ง
 *   ② จด audit ให้ผ่านก่อน ค่อยสร้างไฟล์ — จดไม่ผ่านต้องไม่มีไฟล์หลุดออกไป
 *   ③ ไฟล์แบบปิดบัง ต้องไม่มีชื่อเต็มหรือ HN อยู่ในเนื้อไฟล์เลยแม้แต่ที่เดียว
 *
 * วิธีทำงาน (แบบเดียวกับ test-conflict.mts): ก๊อป export.ts ตัวจริงไป temp
 * แล้วสับ import ที่เป็นของเบราว์เซอร์ล้วน (pdpaSync / cloud / repo) เป็นของปลอม
 * ส่วนที่เหลือคือโค้ดจริงทุกบรรทัด — ไม่ได้เขียนตรรกะซ้ำในเทสต์
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { procList } from '../src/domain/rules.ts';
import type { Patient, WorkpieceView, WorkType } from '../src/domain/types.ts';

let bad = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra !== '' ? '  → ' + String(extra) : ''));
  if (!cond) bad++;
};

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ── ① สร้างสำเนา export.ts ที่สับ import เบราว์เซอร์ออก ──────────────────── */
const dir = mkdtempSync(join(tmpdir(), 'prostho-export-'));
const abs = (rel: string) => pathToFileURL(join(root, 'src', rel)).href;

let src = readFileSync(join(root, 'src/lib/export.ts'), 'utf8');
const swap = (needle: string, replacement: string) => {
  if (!src.includes(needle)) {
    console.log(`❌ หา import ไม่เจอใน export.ts: ${needle}\n   (export.ts เปลี่ยนโครงแล้ว — ต้องมาแก้ test-export.mts ด้วย)`);
    bad++;
    return;
  }
  src = src.replace(needle, replacement);
};

swap(
  "import { TYPES } from '../domain/catalog';",
  `import { TYPES } from '${abs('domain/catalog.ts')}';`,
);
swap(
  "import { currentProc, maxProgression, percentCompleted, procLabel, progression } from '../domain/rules';",
  `import { currentProc, maxProgression, percentCompleted, procLabel, progression } from '${abs('domain/rules.ts')}';`,
);
swap(
  "import type { WorkpieceView } from '../domain/types';",
  `import type { WorkpieceView } from '${abs('domain/types.ts')}';`,
);
swap("import { toSheetDate } from './date';", `import { toSheetDate } from '${abs('lib/date.ts')}';`);
swap(
  "import { caseCode, maskedHn, maskedName } from './privacy';",
  `import { caseCode, maskedHn, maskedName } from '${abs('lib/privacy.ts')}';`,
);
swap(
  "import { pdpaPolicy, type PdpaRole } from '../data/pdpaSync';",
  `type PdpaRole = 'student' | 'teacher' | 'admin';
const pdpaPolicy = () => (globalThis as any).__POLICY__;`,
);
swap(
  "import { cloudEnabled, supabase } from './cloud';",
  `const cloudEnabled = (globalThis as any).__CLOUD_ENABLED__;
const supabase = (globalThis as any).__SUPABASE__;`,
);
swap(
  "import { logAudit } from '../data/repo';",
  `const logAudit = (...args: unknown[]) => { (globalThis as any).__AUDIT__.push(args); return Promise.resolve(); };`,
);

const modPath = join(dir, 'export.mts');
writeFileSync(modPath, src, 'utf8');

/* ── ② ของปลอมฝั่งเบราว์เซอร์ที่ downloadCsv ต้องใช้ ────────────────────── */
const G = globalThis as any;
G.__FILES__ = [] as Array<{ name: string; body: string }>;
let lastBlobBody = '';
G.Blob = class {
  constructor(parts: string[]) { lastBlobBody = parts.join(''); }
};
G.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
G.document = {
  createElement: () => ({
    set href(_v: string) {},
    download: '',
    click() { G.__FILES__.push({ name: this.download, body: lastBlobBody }); },
  }),
};

const POLICY = (exportRoles: string[], identifiedRoles: string[]) => ({
  retentionEnabled: false, retentionCohorts: 5,
  exportRoles, exportIdentifiedRoles: identifiedRoles, maskByDefault: true,
});

let bust = 0;
async function load() {
  return await import(`${pathToFileURL(modPath).href}?v=${++bust}`);
}

/* ── ③ ข้อมูลตัวอย่าง ───────────────────────────────────────────────────── */
const PATIENT: Patient = {
  id: 'pt-secret', name: 'สมชาย ใจดี', hn: 'HN-778899', sex: 'ช', age: 66, studentId: 's1',
} as Patient;

function work(type: WorkType, prog: number, over: Partial<WorkpieceView> = {}): WorkpieceView {
  const base = {
    id: 'w1', patientId: PATIENT.id, studentId: 's1', type, detail: 'CD/- (Upper)',
    acceptedDate: '2026-06-15', minimumRequirement: true, payment: 'ชำระแล้ว',
    sect2Removable: true, sect2Fixed: false, procIndex: -1,
    lastUpdatedAt: '2026-09-10T09:00:00+07:00', catalogVersion: 'DTPT502-2569',
    patient: PATIENT, ...over,
  } as WorkpieceView;
  return { ...base, procIndex: procList(base).findIndex((p) => p[0] === prog) };
}

const W = [work('CD', 5)];

/* ═══ เริ่มเทสต์ ═══════════════════════════════════════════════════════════ */

console.log('\n① รูปแบบไฟล์ต้องตรงกับชีตเดิม');
{
  const m = await load();
  // 14 คอลัมน์ข้อมูล + 11 ช่องติ๊ก 0–10 = 25 · ต้องเรียงตรงกับ tab PTn ของชีตเดิม
  ok('หัวคอลัมน์ครบ 25 ช่อง (14 + ช่องติ๊ก 0–10)',
    m.CSV_COLUMNS.length === 25 && m.PROGRESSION_COLUMNS.length === 11,
    `${m.CSV_COLUMNS.length} คอลัมน์`);
  ok('ช่องติ๊กแทรกอยู่หลัง "Step งานที่ผ่านแล้ว" ตามชีต',
    m.CSV_COLUMNS[6] === 'Step งานที่ผ่านแล้ว' && m.CSV_COLUMNS[7] === '0' && m.CSV_COLUMNS[17] === '10',
    m.CSV_COLUMNS.slice(6, 9).join(' | '));
  ok('ไฟล์ขึ้นต้นด้วย BOM (ไม่งั้น Excel อ่านภาษาไทยเป็นขยะ)',
    m.buildCsv(W, { identified: true }).charCodeAt(0) === 0xfeff);

  const passed = m.passedProgressions(work('CD', 5));
  ok('ช่องติ๊ก 0–5 ติ๊ก · 6–10 ว่าง',
    passed.slice(0, 6).every(Boolean) && passed.slice(6).every((x: boolean) => !x), passed.map(Number).join(''));
  const recall = m.passedProgressions(work('RRM', 2));
  ok('งาน Recall จบที่ขั้น 3 — ช่อง 4–10 ต้องไม่ติ๊ก (ไม่มีขั้นพวกนั้นอยู่จริง)',
    recall.slice(0, 3).every(Boolean) && recall.slice(4).every((x: boolean) => !x), recall.map(Number).join(''));
}

console.log('\n② ไฟล์แบบปิดบัง ต้องไม่มีชื่อ/HN หลุดแม้แต่ที่เดียว');
{
  const m = await load();
  const masked = m.buildCsv(W, { identified: false });
  ok('ไม่มีชื่อเต็มอยู่ในไฟล์', !masked.includes(PATIENT.name));
  ok('ไม่มี HN อยู่ในไฟล์', !masked.includes(PATIENT.hn));
  ok('มีรหัสเคสแทน', masked.includes('PT-'));
  const full = m.buildCsv(W, { identified: true });
  ok('ไฟล์แบบมีชื่อ เห็นครบตามที่ตั้งใจ', full.includes(PATIENT.name) && full.includes(PATIENT.hn));
}

console.log('\n③ ช่องหมายเหตุที่นักศึกษาพิมพ์เอง ต้องไม่ทำร้ายคนเปิดไฟล์');
{
  const m = await load();
  /* CSV formula injection: Excel/Sheets ตีความเซลล์ที่ขึ้นต้นด้วย = + - @ ว่าเป็นสูตร
     ช่อง "หมายเหตุ / สถานะผู้ป่วย" มาจากที่นักศึกษาพิมพ์เอง และไฟล์นี้ทำมาให้เปิดใน Excel โดยตรง
     (ใส่ BOM ไว้เพื่อการนั้นเลย) — อาจารย์เปิดไฟล์แล้วสูตรทำงานทันทีโดยไม่ได้ตั้งใจ */
  for (const evil of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '=HYPERLINK("http://x","คลิก")']) {
    const csv = m.buildCsv([work('CD', 5, { patient: { ...PATIENT, note: evil } as Patient })], { identified: true });
    const cell = csv.split('\n')[1].split(',').find((c: string) => c.includes(evil.slice(1, 5)));
    ok(`หมายเหตุ "${evil}" ไม่ถูกส่งออกเป็นสูตร`, !!cell && !/^"?[=+\-@]/.test(cell), cell);
  }
  /* ขึ้นบรรทัดใหม่ในเซลล์ต้องอยู่ในเครื่องหมายคำพูด ไม่งั้นแถวแตกเป็นสองแถวตอนเปิด
     นับแถวแบบ CSV จริง (ขึ้นบรรทัดที่อยู่นอกคำพูดเท่านั้นที่จบแถว) */
  const countRows = (csv: string) => {
    let rows = 1, inQuote = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (ch === '"') inQuote = !inQuote;
      else if (ch === '\n' && !inQuote && i < csv.length - 1) rows++;
    }
    return rows;
  };
  for (const [label, note] of [['ขึ้นบรรทัดใหม่', 'ก่อน\r\nหลัง'], ['ลูกน้ำ', 'ก่อน, หลัง'], ['คำพูด', 'เขาบอกว่า "ทำต่อ"']] as const) {
    const csv = m.buildCsv([work('CD', 5, { patient: { ...PATIENT, note } as Patient })], { identified: true });
    ok(`หมายเหตุที่มี${label} ไม่ทำให้แถวแตก (หัวตาราง + 1 แถว)`, countRows(csv) === 2, countRows(csv) + ' แถว');
  }
}

console.log('\n④ สิทธิ์ส่งออก — ไม่มีสิทธิ์ต้องไม่มีไฟล์');
{
  G.__POLICY__ = POLICY([], []);
  G.__CLOUD_ENABLED__ = false;
  G.__SUPABASE__ = null;
  G.__AUDIT__ = [];
  G.__FILES__ = [];
  const m = await load();

  ok('นโยบายล็อกอยู่ → ปุ่มต้องกดไม่ได้', !m.exportPermission('teacher').allowed);
  const res = await m.exportCsv({
    scope: 'group', works: W, filename: 'x.csv', wantIdentified: false,
    role: 'teacher', actor: 'อ. ก.',
  });
  ok('ส่งออกถูกปฏิเสธ', res.ok === false, res.reason);
  ok('ไม่มีไฟล์ถูกสร้าง', G.__FILES__.length === 0, G.__FILES__.length);
  ok('ไม่มี audit ถูกจด (ไม่ได้เกิดเหตุการณ์อะไรขึ้น)', G.__AUDIT__.length === 0);
}

console.log('\n⑤ ขอแบบมีชื่อแต่ไม่มีสิทธิ์ → ต้องได้ไฟล์ปิดบัง ไม่ใช่ปฏิเสธทิ้ง');
{
  G.__POLICY__ = POLICY(['teacher'], []);   // ส่งออกได้ แต่ไม่ได้แบบมีชื่อ
  G.__CLOUD_ENABLED__ = false;
  G.__SUPABASE__ = null;
  G.__AUDIT__ = [];
  G.__FILES__ = [];
  const m = await load();
  const res = await m.exportCsv({
    scope: 'group', works: W, filename: 'g.csv', wantIdentified: true,
    role: 'teacher', actor: 'อ. ก.',
  });
  ok('ส่งออกสำเร็จ', res.ok === true);
  ok('แต่ถูกลดเป็นไฟล์ปิดบัง และบอกให้รู้ตัว', res.ok && res.identified === false && res.downgraded === true,
    JSON.stringify(res));
  ok('ไฟล์ที่ได้ไม่มีชื่อจริง', !G.__FILES__[0]?.body.includes(PATIENT.name));
  ok('ไฟล์ที่ได้ไม่มี HN', !G.__FILES__[0]?.body.includes(PATIENT.hn));
  ok('audit ในเครื่องบอกว่าเป็นไฟล์ปิดบัง',
    String(G.__AUDIT__[0]?.[0]).includes('ปิดบัง'), String(G.__AUDIT__[0]?.[0]));
}

console.log('\n⑥ จด audit ที่เซิร์ฟเวอร์ไม่ผ่าน = ต้องไม่มีไฟล์');
{
  G.__POLICY__ = POLICY(['admin'], ['admin']);
  G.__CLOUD_ENABLED__ = true;
  G.__AUDIT__ = [];
  G.__FILES__ = [];
  const calls: unknown[] = [];
  G.__SUPABASE__ = {
    rpc: async (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return { error: { message: 'ภาควิชายังไม่ได้เปิดสิทธิ์นี้ (จากเซิร์ฟเวอร์)' } };
    },
  };
  const m = await load();
  const res = await m.exportCsv({
    scope: 'cohort', works: W, filename: 'all.csv', wantIdentified: true,
    role: 'admin', actor: 'หัวหน้าภาค',
  });
  ok('เซิร์ฟเวอร์ปฏิเสธ → ส่งออกไม่สำเร็จ', res.ok === false, res.reason);
  ok('ไม่มีไฟล์หลุดออกไป', G.__FILES__.length === 0, G.__FILES__.length);
  ok('เรียก log_export ก่อนสร้างไฟล์จริง', (calls[0] as string[])?.[0] === 'log_export');
  ok('ส่งจำนวนแถวและระดับการปิดบังไปให้เซิร์ฟเวอร์ด้วย',
    (calls[0] as any)?.[1]?.p_row_count === W.length && (calls[0] as any)?.[1]?.p_identified === true,
    JSON.stringify((calls[0] as any)?.[1]));
}

console.log('\n⑦ ทางที่ทุกอย่างผ่าน');
{
  G.__POLICY__ = POLICY(['admin'], ['admin']);
  G.__CLOUD_ENABLED__ = true;
  G.__AUDIT__ = [];
  G.__FILES__ = [];
  G.__SUPABASE__ = { rpc: async () => ({ error: null }) };
  const m = await load();
  const res = await m.exportCsv({
    scope: 'cohort', works: W, filename: 'all.csv', wantIdentified: true,
    role: 'admin', actor: 'หัวหน้าภาค',
  });
  ok('ส่งออกสำเร็จแบบมีชื่อ', res.ok === true && res.identified === true && res.downgraded === false);
  ok('ได้ไฟล์ชื่อตามที่ขอ', G.__FILES__[0]?.name === 'all.csv', G.__FILES__[0]?.name);
  ok('เนื้อไฟล์มีข้อมูลจริง', G.__FILES__[0]?.body.includes(PATIENT.hn));
  ok('มีเซิร์ฟเวอร์แล้วไม่จด audit ซ้ำในเครื่อง', G.__AUDIT__.length === 0, G.__AUDIT__.length);
}

console.log(bad ? `\n❌ ไม่ผ่าน ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
