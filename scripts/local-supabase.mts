/**
 * Supabase จำลองในเครื่อง — ให้ "หน้าจอแอปตัวจริง" ต่อ cloud ได้โดยไม่แตะเซิร์ฟเวอร์จริง
 *
 * ทำไมต้องมี (13 ก.ย. 69): เส้นทางหลายเส้นในแอปไม่เคยถูกลองกับเซิร์ฟเวอร์เลย เพราะเครื่องพัฒนา
 * ไม่มี .env.local และห้ามเอาข้อมูลทดสอบไปยิงเซิร์ฟเวอร์จริง:
 *   · อัปโหลดรูปจริงขึ้นบักเก็ต · ลิงก์รูปแบบมีอายุ
 *   · ออกจากระบบตอนยังมีงานค้างส่ง (ล้างเครื่อง / ไม่ล้าง)
 *   · ส่งออกไฟล์ผ่าน log_export · ตั้งค่า PDPA · จัดการรายชื่อเชิญ
 * `test:sync-pg` ทดสอบชั้นข้อมูลบน Postgres จริงแล้ว — ไฟล์นี้ต่อ "ทั้งแอป" เข้าไปด้วย
 *
 * วิธีใช้: เปิดผ่าน Browser pane ด้วย launch config `local-supabase` แล้วเปิดแอปด้วย
 *          `prostho-cloud-local` (ตั้ง VITE_SUPABASE_URL ชี้มาที่นี่ให้เอง ไม่ต้องสร้าง .env.local)
 *
 * ── ข้างในคืออะไร ────────────────────────────────────────────────────────────
 * Postgres ตัวจริง (PGlite) ที่รัน migration ทุกไฟล์ · กฎ RLS / trigger / สิทธิ์ของจริงทุกบรรทัด
 * ที่เขียนเลียนแบบเอง (ลอกรูปแบบคำขอ/คำตอบจากโค้ดของ supabase-js ใน node_modules):
 *   /auth/v1     token (password / refresh_token) · user · logout
 *   /rest/v1     GET/HEAD/POST/PATCH/DELETE ตาราง + rpc · ตัวกรอง eq/neq/in/is/gt/gte/lt/lte
 *   /storage/v1  อัปโหลด (multipart) · ลบ · ขอลิงก์แบบมีอายุ · เปิดไฟล์จากลิงก์
 *                สิทธิ์ใช้กฎ RLS ของ storage.objects จริง (0018) · ขนาด/ชนิดไฟล์ตามบักเก็ตจริง
 * ไม่มี: realtime (ปฏิเสธ websocket — แอปถอยไปดึงทุก 15 วิเอง) · อีเมลยืนยัน · รหัสผ่านเข้ารหัส
 *
 * ⚠️ ของทดสอบในเครื่องเท่านั้น — รหัสผ่านเก็บเป็นข้อความธรรมดา token ไม่ได้เซ็นลายเซ็น
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase } from './pg-supabase.mts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.LOCAL_SUPABASE_PORT ?? 54321);

/* ── token แบบไม่เซ็น (ของทดสอบ) — รูปทรง JWT เพราะ supabase-js อ่าน exp/sub จากตัวมัน ── */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.local`;
export const ANON_KEY = jwt({ role: 'anon', iss: 'local-supabase', exp: 4102444800 });
/** กุญแจ service_role — ข้าม RLS ทั้งหมดแบบ Supabase จริง · ใช้ในสคริปต์ดูแลระบบเท่านั้น ห้ามอยู่ในแอป */
export const SERVICE_KEY = jwt({ role: 'service_role', iss: 'local-supabase', exp: 4102444800 });

type Who = { uid: string } | 'anon' | 'service';
function identityOf(req: IncomingMessage): Who {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer || bearer === ANON_KEY) return 'anon';
  if (bearer === SERVICE_KEY) return 'service';
  try {
    const p = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString());
    if (p.role === 'authenticated' && typeof p.sub === 'string' && p.exp * 1000 > Date.now()) return { uid: p.sub };
  } catch { /* token เสีย = คนไม่ได้ล็อกอิน */ }
  return 'anon';
}

/* ── ข้อมูลตั้งต้น: หนึ่งกลุ่มจริงขนาดย่อ พอให้กดได้ทุกหน้า ─────────────────────── */
async function seed(db: PGlite) {
  await db.exec(`
    alter table auth.users add column if not exists password text;
    alter table storage.objects add constraint objects_bucket_name unique (bucket_id, name);

    insert into teachers (id, name) values ('t1', 'อ. ทดสอบ หนึ่ง'), ('t2', 'อ. ทดสอบ สอง'), ('thead', 'หัวหน้าภาค ทดสอบ');
    insert into groups (code, advisor_ids, student_ids) values ('TH-PT7', array['t1'], array['s1','s2','s3']);
    insert into students (id, code, name, "group", year, entry_year) values
      ('s1', '6604048', 'นศ. ทดสอบ หนึ่ง', 'TH-PT7', 5, 2569),
      ('s2', '6604049', 'นศ. ทดสอบ สอง',  'TH-PT7', 5, 2569),
      ('s3', '6604050', 'นศ. ทดสอบ สาม',  'TH-PT7', 5, 2569);
    insert into invites (email, role, student_id, teacher_id, is_admin) values
      ('s1@test.local', 'student', 's1', null, false),
      ('s2@test.local', 'student', 's2', null, false),
      ('t1@test.local', 'teacher', null, 't1', false),
      ('head@test.local', 'teacher', null, 'thead', true);
    insert into patients (id, name, hn, sex_age, owner_student_id) values
      ('p1', 'ผู้ป่วยทดสอบ ก', 'HN-T-0001', 'ชาย 67', 's1'),
      ('p2', 'ผู้ป่วยทดสอบ ข', 'HN-T-0002', 'หญิง 58', 's2');
    insert into workpieces (id, patient_id, student_id, type, arch, detail, accepted_date, proc_index, last_updated_at) values
      ('w1', 'p1', 's1', 'CD', 'upper', 'CD/- (Upper)', '2026-06-03', 3, '2026-09-10T02:00:00Z'),
      ('w2', 'p2', 's2', 'RPD', 'lower', '-/RPD (Lower)', '2026-06-10', 1, '2026-09-10T02:00:00Z');
    insert into checkins (id, student_id, date, activities, created_at) values
      ('c1', 's1', '2026-09-12', array['Primary impression'], '2026-09-12T01:55:00Z'),
      ('c2', 's2', '2026-09-12', array['Laboratory work'], '2026-09-12T01:58:00Z');
  `);
  /* id คงที่ต่ออีเมล (md5 → uuid) — รีสตาร์ตเซิร์ฟเวอร์แล้วเครื่องที่ล็อกอินค้างไว้ต้องยัง "เป็นบัญชีเดิม"
     ไม่งั้นแอปเห็น uid ใหม่ แล้วล้างลิ้นชักทิ้งเองตอนผูกบัญชี = ทดสอบเส้นทางของเครื่องเดิมไม่ได้ */
  for (const email of ['s1@test.local', 's2@test.local', 't1@test.local', 'head@test.local']) {
    await db.query(`insert into auth.users (id, email, password) values (md5($1)::uuid, $1, 'test1234')`, [email]);
  }
}

/* ── ตัวช่วย HTTP ───────────────────────────────────────────────────────────── */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range, x-total-count',
};
function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  const isBytes = body instanceof Uint8Array;
  res.writeHead(status, {
    ...CORS,
    ...(body === undefined ? {} : { 'content-type': isBytes ? 'image/jpeg' : 'application/json' }),
    ...headers,
  });
  res.end(body === undefined ? undefined : isBytes ? body : JSON.stringify(body));
}
const readBody = (req: IncomingMessage) => new Promise<Buffer>((ok, bad) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', bad);
});

/** SQLSTATE → สถานะ HTTP แบบที่ PostgREST ใช้ */
const httpStatusOf = (code: string) =>
  code === '42501' ? 403 : code === '23505' ? 409 : code.startsWith('PGRST') ? 400 : code === 'P0001' ? 400 : 400;

/* ── รันคำสั่งในนามผู้ใช้ ───────────────────────────────────────────────────── */
async function asUser<T>(db: PGlite, who: Who, fn: (q: PGlite['query']) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local timezone = 'UTC';`);
    if (who === 'service') {
      await tx.exec(`set local role service_role;`); // bypassrls — แบบเดียวกับกุญแจ service_role จริง
    } else if (who === 'anon') {
      await tx.exec(`set local role anon; select set_config('request.jwt.claim.sub', '', true);`);
    } else {
      await tx.exec(`set local role authenticated;`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.uid]);
    }
    return fn(tx.query.bind(tx) as PGlite['query']);
  });
}

const types = new Map<string, Map<string, string>>();
async function columnsOf(db: PGlite, table: string) {
  let m = types.get(table);
  if (!m) {
    const r = await db.query<{ column_name: string; udt_name: string }>(
      `select column_name, udt_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table]);
    m = new Map(r.rows.map((x) => [x.column_name, x.udt_name]));
    types.set(table, m);
  }
  return m;
}
const castOf = (udt: string) => (udt.startsWith('_') ? `${udt.slice(1)}[]` : udt);
const encode = (udt: string, v: unknown) =>
  v === null || v === undefined ? null : udt === 'jsonb' || udt === 'json' ? JSON.stringify(v) : v;
const pgErr = (e: unknown) => {
  const x = e as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: x?.message ?? String(e), code: x?.code ?? '', details: x?.detail ?? null, hint: x?.hint ?? null };
};

/* ── PostgREST ส่วนที่แอปใช้ ────────────────────────────────────────────────── */
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

function whereOf(url: URL, known: Map<string, string>, params: unknown[]): string {
  const parts: string[] = [];
  for (const [col, raw] of url.searchParams) {
    if (RESERVED.has(col)) continue;
    if (!known.has(col)) throw { code: 'PGRST204', message: `Could not find the '${col}' column` };
    const m = raw.match(/^(not\.)?(eq|neq|in|is|gt|gte|lt|lte|like|ilike)\.(.*)$/s);
    if (!m) throw { code: 'PGRST100', message: `ตัวกรองที่ยังไม่รองรับ: ${col}=${raw}` };
    const [, not, op, val] = m;
    const cast = castOf(known.get(col)!);
    let expr: string;
    if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      params.push(items);
      expr = `"${col}" = any($${params.length}::${cast.endsWith('[]') ? cast : cast + '[]'})`;
    } else if (op === 'is') {
      expr = `"${col}" is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
    } else {
      const sqlOp = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }[op]!;
      params.push(op.endsWith('like') ? val.replace(/\*/g, '%') : val);
      expr = `"${col}" ${sqlOp} $${params.length}::${op.endsWith('like') ? 'text' : cast}`;
    }
    parts.push(not ? `not (${expr})` : expr);
  }
  return parts.length ? 'where ' + parts.join(' and ') : '';
}

function projection(select: string | null, alias = 't'): string {
  if (!select || select === '*') return `to_jsonb(${alias}.*)`;
  const cols = select.split(',').map((c) => c.trim()).filter(Boolean);
  return `jsonb_build_object(${cols.map((c) => `'${c}', ${alias}."${c}"`).join(', ')})`;
}

async function rest(db: PGlite, req: IncomingMessage, res: ServerResponse, url: URL) {
  const who = identityOf(req);
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const prefer = String(req.headers.prefer ?? '');
  const accept = String(req.headers.accept ?? '');
  const wantsObject = accept.includes('vnd.pgrst.object+json');
  const reply = (rows: unknown[], extra: Record<string, string> = {}) => {
    if (wantsObject) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${rows.length} rows`, hint: null });
      return send(res, 200, rows[0], extra);
    }
    return send(res, 200, rows, extra);
  };

  try {
    /* ── rpc ── */
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4);
      const args = JSON.parse((await readBody(req)).toString() || '{}') as Record<string, unknown>;
      const meta = await db.query<{ retset: boolean; names: string[] | null; types: string[] }>(
        `select p.proretset as retset, p.proargnames as names,
                array(select format_type(t, null) from unnest(p.proargtypes) t) as types
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
      if (!meta.rows.length) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
      const { retset, names, types: argTypes } = meta.rows[0];
      const params: unknown[] = [];
      const named = Object.entries(args).map(([k, v]) => {
        const i = (names ?? []).indexOf(k);
        const t = i >= 0 ? argTypes[i] : 'text';
        params.push(t === 'jsonb' ? JSON.stringify(v) : v);
        return `"${k}" => $${params.length}::${t}`;
      }).join(', ');
      const rows = await asUser(db, who, (q) => q<{ r: unknown }>(
        retset ? `select to_jsonb(x.*) as r from public."${fn}"(${named}) x` : `select to_jsonb(public."${fn}"(${named})) as r`, params));
      const out = rows.rows.map((x) => x.r);
      return send(res, 200, retset ? out : out[0] ?? null);
    }

    const table = path;
    const known = await columnsOf(db, table);
    if (!known.size) return send(res, 404, { code: '42P01', message: `relation "public.${table}" does not exist` });
    const select = url.searchParams.get('select');

    if (req.method === 'GET' || req.method === 'HEAD') {
      const params: unknown[] = [];
      const where = whereOf(url, known, params);
      const order = url.searchParams.get('order');
      const orderSql = order
        ? 'order by ' + order.split(',').map((o) => { const [c, dir] = o.split('.'); return `t."${c}" ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ')
        : '';
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      const r = await asUser(db, who, async (q) => {
        const total = prefer.includes('count=exact')
          ? (await q<{ n: number }>(`select count(*)::int as n from "${table}" t ${where}`, params)).rows[0].n
          : null;
        const rows = req.method === 'HEAD' ? [] : (await q<{ r: unknown }>(
          `select ${projection(select)} as r from "${table}" t ${where} ${orderSql} ${limit ? `limit ${Number(limit)}` : ''} ${offset ? `offset ${Number(offset)}` : ''}`, params)).rows.map((x) => x.r);
        return { total, rows };
      });
      const range = { 'content-range': `0-${Math.max(r.rows.length - 1, 0)}/${r.total ?? '*'}` };
      if (req.method === 'HEAD') return send(res, 200, undefined, range);
      return reply(r.rows, range);
    }

    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '[]');
      const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const colsParam = url.searchParams.get('columns');
      const cols = colsParam ? colsParam.split(',').map((c) => c.replace(/"/g, '')) : [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const bad = cols.find((c) => !known.has(c));
      if (bad) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` });
      const missingDefault = prefer.includes('missing=default');
      const params: unknown[] = [];
      const tuples = rows.map((r) => '(' + cols.map((c) => {
        if (!(c in r)) {
          if (missingDefault) return 'default';
          params.push(null);
          return `$${params.length}::${castOf(known.get(c)!)}`;
        }
        params.push(encode(known.get(c)!, r[c]));
        return `$${params.length}::${castOf(known.get(c)!)}`;
      }).join(', ') + ')');
      const pk = (await db.query<{ col: string }>(
        `select a.attname as col from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = ('public."' || $1 || '"')::regclass and i.indisprimary`, [table])).rows.map((x) => x.col);
      let conflict = '';
      if (prefer.includes('resolution=ignore-duplicates')) conflict = `on conflict (${pk.map((c) => `"${c}"`).join(',')}) do nothing`;
      else if (prefer.includes('resolution=merge-duplicates')) {
        const upd = cols.filter((c) => !pk.includes(c)).map((c) => `"${c}" = excluded."${c}"`);
        conflict = `on conflict (${pk.map((c) => `"${c}"`).join(',')}) do ${upd.length ? 'update set ' + upd.join(', ') : 'nothing'}`;
      }
      const returning = prefer.includes('return=representation') ? `returning ${projection(select, `"${table}"`)} as r` : '';
      const out = await asUser(db, who, (q) => q<{ r: unknown }>(
        `insert into "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values ${tuples.join(', ')} ${conflict} ${returning}`, params));
      return returning ? reply(out.rows.map((x) => x.r)) : send(res, 201, undefined);
    }

    if (req.method === 'PATCH') {
      const patch = JSON.parse((await readBody(req)).toString() || '{}') as Record<string, unknown>;
      const cols = Object.keys(patch);
      const bad = cols.find((c) => !known.has(c));
      if (bad) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` });
      const params: unknown[] = [];
      const sets = cols.map((c) => { params.push(encode(known.get(c)!, patch[c])); return `"${c}" = $${params.length}::${castOf(known.get(c)!)}`; });
      const where = whereOf(url, known, params);
      const returning = prefer.includes('return=representation') ? `returning ${projection(select, `"${table}"`)} as r` : '';
      const out = await asUser(db, who, (q) => q<{ r: unknown }>(`update "${table}" set ${sets.join(', ')} ${where} ${returning}`, params));
      return returning ? reply(out.rows.map((x) => x.r)) : send(res, 204);
    }

    if (req.method === 'DELETE') {
      const params: unknown[] = [];
      const where = whereOf(url, known, params);
      if (!where) return send(res, 400, { code: '21000', message: 'DELETE requires a WHERE clause' });
      await asUser(db, who, (q) => q(`delete from "${table}" ${where}`, params));
      return send(res, 204);
    }

    return send(res, 405, { message: 'method not allowed' });
  } catch (e) {
    const err = pgErr(e);
    return send(res, httpStatusOf(err.code), err);
  }
}

/* ── Storage ──────────────────────────────────────────────────────────────── */
const bytes = new Map<string, { data: Uint8Array; type: string }>();
const signed = new Map<string, { key: string; exp: number }>();

async function storage(db: PGlite, req: IncomingMessage, res: ServerResponse, url: URL) {
  const who = identityOf(req);
  const rest = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ''));
  const storageErr = (status: number, error: string, message: string) =>
    send(res, status, { statusCode: String(status), error, message });

  try {
    // เปิดไฟล์จากลิงก์แบบมีอายุ
    if (req.method === 'GET' && rest.startsWith('object/sign/')) {
      const tok = url.searchParams.get('token') ?? '';
      const s = signed.get(tok);
      if (!s || s.exp < Date.now()) return storageErr(400, 'InvalidJWT', 'ลิงก์หมดอายุหรือไม่ถูกต้อง');
      const f = bytes.get(s.key);
      return f ? send(res, 200, f.data, { 'content-type': f.type }) : storageErr(404, 'not_found', 'Object not found');
    }

    // ดาวน์โหลดตรงด้วย token ของผู้ใช้ (backup.ts ใช้ทางนี้) — ต้องมองเห็นตามกฎ RLS จริง
    if (req.method === 'GET' && rest.startsWith('object/') && !rest.startsWith('object/sign/')) {
      const tail = rest.slice('object/'.length).replace(/^(authenticated|public)\//, '');
      const [bucket, ...parts] = tail.split('/');
      const name = parts.join('/');
      const seen = await asUser(db, who, (q) => q(
        `select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]));
      const f = bytes.get(`${bucket}/${name}`);
      if (!seen.rows.length || !f) return storageErr(404, 'not_found', 'Object not found');
      return send(res, 200, f.data, { 'content-type': f.type });
    }

    // ขอลิงก์แบบมีอายุ — ออกให้เฉพาะไฟล์ที่คนขอ "มองเห็น" ตามกฎ RLS จริง
    if (req.method === 'POST' && rest.startsWith('object/sign/')) {
      const bucket = rest.slice('object/sign/'.length);
      const { expiresIn, paths } = JSON.parse((await readBody(req)).toString()) as { expiresIn: number; paths: string[] };
      const visible = await asUser(db, who, (q) => q<{ name: string }>(
        `select name from storage.objects where bucket_id = $1 and name = any($2::text[])`, [bucket, paths]));
      const ok = new Set(visible.rows.map((r) => r.name));
      return send(res, 200, paths.map((p) => {
        if (!ok.has(p)) return { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' };
        const token = randomUUID();
        signed.set(token, { key: `${bucket}/${p}`, exp: Date.now() + expiresIn * 1000 });
        return { path: p, signedURL: `/object/sign/${bucket}/${p}?token=${token}`, error: null };
      }));
    }

    // อัปโหลด
    if ((req.method === 'POST' || req.method === 'PUT') && rest.startsWith('object/')) {
      const [bucket, ...parts] = rest.slice('object/'.length).split('/');
      const name = parts.join('/');
      const raw = await readBody(req);
      const ctype = String(req.headers['content-type'] ?? '');
      let file: Uint8Array = raw;
      let fileType = ctype;
      if (ctype.startsWith('multipart/form-data')) {
        const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': ctype }, body: raw }).formData();
        const blob = [...form.values()].find((v) => typeof v !== 'string') as Blob | undefined;
        if (!blob) return storageErr(400, 'invalid_request', 'ไม่มีไฟล์ในคำขอ');
        file = new Uint8Array(await blob.arrayBuffer());
        fileType = blob.type || 'application/octet-stream';
      }
      const b = (await db.query<{ file_size_limit: number | null; allowed_mime_types: string[] | null }>(
        `select file_size_limit, allowed_mime_types from storage.buckets where id = $1`, [bucket])).rows[0];
      if (!b) return storageErr(404, 'Bucket not found', 'Bucket not found');
      if (b.file_size_limit && file.byteLength > Number(b.file_size_limit)) {
        return storageErr(413, 'Payload too large', 'The object exceeded the maximum allowed size');
      }
      if (b.allowed_mime_types?.length && !b.allowed_mime_types.includes(fileType)) {
        return storageErr(415, 'invalid_mime_type', `mime type ${fileType} is not supported`);
      }
      const upsert = String(req.headers['x-upsert'] ?? 'false') === 'true';
      const owner = who === 'anon' || who === 'service' ? null : who.uid;
      await asUser(db, who, (q) => q(
        `insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3::uuid)
         ${upsert ? 'on conflict (bucket_id, name) do update set owner = excluded.owner' : ''}`, [bucket, name, owner]));
      bytes.set(`${bucket}/${name}`, { data: file, type: fileType });
      return send(res, 200, { Id: randomUUID(), Key: `${bucket}/${name}` });
    }

    // ลบ
    if (req.method === 'DELETE' && rest.startsWith('object/')) {
      const bucket = rest.slice('object/'.length);
      const { prefixes } = JSON.parse((await readBody(req)).toString()) as { prefixes: string[] };
      const gone = await asUser(db, who, (q) => q<{ name: string }>(
        `delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`, [bucket, prefixes]));
      for (const r of gone.rows) bytes.delete(`${bucket}/${r.name}`);
      return send(res, 200, gone.rows.map((r) => ({ name: r.name, bucket_id: bucket })));
    }

    return storageErr(404, 'not_found', 'ยังไม่รองรับคำขอนี้ในตัวจำลอง');
  } catch (e) {
    const err = pgErr(e);
    // RLS ของ storage ตอบเป็น 403 แบบ Storage API จริง
    return err.code === '42501'
      ? storageErr(403, 'Unauthorized', 'new row violates row-level security policy')
      : storageErr(400, 'Error', err.message);
  }
}

/* ── Auth ─────────────────────────────────────────────────────────────────── */
async function auth(db: PGlite, req: IncomingMessage, res: ServerResponse, url: URL) {
  const sub = url.pathname.replace(/^\/auth\/v1\//, '');
  const userOf = (id: string, email: string) => ({
    id, email, aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-13T00:00:00Z',
  });
  const session = (id: string, email: string) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return {
      access_token: jwt({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp }),
      refresh_token: Buffer.from(JSON.stringify({ id, email })).toString('base64url'),
      token_type: 'bearer', expires_in: 3600, expires_at: exp, user: userOf(id, email),
    };
  };

  if (sub === 'token' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    if (url.searchParams.get('grant_type') === 'password') {
      const r = await db.query<{ id: string; email: string }>(
        `select id, email from auth.users where lower(email) = lower($1) and password = $2`, [body.email ?? '', body.password ?? '']);
      if (!r.rows.length) return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(r.rows[0].id, r.rows[0].email));
    }
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      try {
        const { id, email } = JSON.parse(Buffer.from(body.refresh_token, 'base64url').toString());
        return send(res, 200, session(id, email));
      } catch {
        return send(res, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      }
    }
  }
  if (sub === 'user' && req.method === 'GET') {
    const who = identityOf(req);
    if (who === 'anon' || who === 'service') return send(res, 401, { code: 'no_authorization', msg: 'This endpoint requires a valid Bearer token' });
    const r = await db.query<{ id: string; email: string }>(`select id, email from auth.users where id = $1`, [who.uid]);
    return r.rows.length ? send(res, 200, userOf(r.rows[0].id, r.rows[0].email)) : send(res, 404, { msg: 'User not found' });
  }
  if (sub === 'logout') return send(res, 204);
  /* ของทดสอบในเครื่องเท่านั้น: ออก session ของบัญชีทดสอบโดยไม่ต้องพิมพ์รหัสผ่านในหน้าเว็บ
     (ตัวขับเบราว์เซอร์อัตโนมัติไม่พิมพ์รหัสผ่านลงฟอร์มล็อกอิน) · Supabase จริงไม่มีเส้นทางนี้ */
  if (sub === 'dev-session' && req.method === 'GET') {
    const r = await db.query<{ id: string; email: string }>(
      `select id, email from auth.users where lower(email) = lower($1) and email like '%@test.local'`, [url.searchParams.get('email') ?? '']);
    return r.rows.length ? send(res, 200, session(r.rows[0].id, r.rows[0].email)) : send(res, 404, { msg: 'ไม่มีบัญชีทดสอบนี้' });
  }
  return send(res, 404, { msg: `ตัวจำลองยังไม่รองรับ /auth/v1/${sub}` });
}

/* ── เริ่ม ─────────────────────────────────────────────────────────────────── */

export interface LocalSupabase {
  url: string;
  anonKey: string;
  db: PGlite;
  close: () => Promise<void>;
}

/**
 * เปิดเซิร์ฟเวอร์ — เรียกได้ทั้งจาก Browser pane (รันไฟล์นี้ตรงๆ) และจากชุดทดสอบ
 * port 0 = ให้ระบบเลือกพอร์ตว่างเอง (ชุดทดสอบใช้ จะได้ไม่ชนกับตัวที่เปิดค้างใน Browser pane)
 */
export async function startLocalSupabase(port = PORT, opts: { quiet?: boolean } = {}): Promise<LocalSupabase> {
  const { db, results } = await freshDatabase(root);
  const broken = results.filter((r) => !r.ok);
  if (broken.length) throw new Error('migration พัง: ' + JSON.stringify(broken));
  await seed(db);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (req.method === 'OPTIONS') return send(res, 204);
    const started = Date.now();
    try {
      if (url.pathname.startsWith('/rest/v1/')) await rest(db, req, res, url);
      else if (url.pathname.startsWith('/storage/v1/')) await storage(db, req, res, url);
      else if (url.pathname.startsWith('/auth/v1/')) await auth(db, req, res, url);
      else send(res, 404, { message: 'local-supabase: ไม่รู้จักเส้นทางนี้' });
    } catch (e) {
      send(res, 500, pgErr(e));
    }
    // บันทึกคำขอที่ไม่สำเร็จไว้ให้อ่านใน preview_logs — ของที่ล้มคือของที่ต้องดู
    if (res.statusCode >= 400 && !opts.quiet) {
      console.log(`${req.method} ${url.pathname}${url.search.slice(0, 80)} → ${res.statusCode} (${Date.now() - started}ms)`);
    }
  });
  // realtime: ปฏิเสธ websocket — แอปถอยไปดึงข้อมูลทุก 15 วิเอง (ดู cloudSync.ts)
  server.on('upgrade', (_req, socket) => socket.destroy());

  await new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actual}`,
    anonKey: ANON_KEY,
    db,
    close: async () => {
      await new Promise<void>((ok) => server.close(() => ok()));
      await db.close();
    },
  };
}

/* รันไฟล์นี้ตรงๆ (Browser pane) = เปิดเซิร์ฟเวอร์ค้างไว้ · ถูก import จากชุดทดสอบ = ไม่ทำอะไรเอง */
if ((process.argv[1] ?? '').endsWith('local-supabase.mts')) {
  const s = await startLocalSupabase();
  console.log(`local-supabase พร้อมที่ ${s.url}`);
  console.log(`VITE_SUPABASE_ANON_KEY=${s.anonKey}`);
  console.log('บัญชีทดสอบ (รหัส test1234): s1@test.local · s2@test.local · t1@test.local · head@test.local (หัวหน้าภาค)');
}
