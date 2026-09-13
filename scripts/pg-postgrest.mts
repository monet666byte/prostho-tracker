/**
 * supabase-js ปลอม ที่ข้างหลังเป็น Postgres ตัวจริง (PGlite) — แทน "ตู้กลางปลอม" ในเทสต์ sync
 *
 * ทำไมต้องมี (13 ก.ย. 69): test:clinic / test:conflict / test:offline ใช้ตู้กลางที่เขียนเลียนแบบ
 * trigger ของ 0017/0020 ด้วยมือ · ของที่ตู้ปลอมไม่รู้จัก = ของที่เทสต์ไม่เคยทดสอบ เช่น
 *   · RLS (นักศึกษาเขียนแถวของคนอื่นไม่ได้) — ตู้ปลอมยอมทุกอย่าง
 *   · NOT NULL / ชนิดข้อมูล / คอลัมน์ที่ไม่มีในตาราง — ตู้ปลอมรับทุกช่อง
 *   · พฤติกรรมของ supabase-js ตอน upsert หลายแถวที่มีช่องไม่เท่ากัน (ดูข้างล่าง)
 *
 * ไฟล์นี้เลียนแบบ **เฉพาะชั้นส่งผ่าน** (supabase-js → PostgREST) ซึ่งเป็นโค้ดของคนอื่นที่ไม่เปลี่ยน
 * ส่วนกฎทั้งหมด (RLS / trigger / default / constraint) คือของจริงจาก migration ทุกบรรทัด
 *
 * ── พฤติกรรมที่ลอกมาจากโค้ดจริง ─────────────────────────────────────────────────
 * upsert (node_modules/@supabase/postgrest-js · ตรวจ 13 ก.ย. 69):
 *   · `Prefer: resolution=merge-duplicates` → ON CONFLICT (pk) DO UPDATE ทุกคอลัมน์ที่ส่งมา
 *   · `defaultToNull = true` เป็นค่าเริ่มต้น → แถวที่ **ไม่มี** ช่องที่แถวอื่นในก้อนมี จะได้ **NULL**
 *     ไม่ใช่ค่า default ของคอลัมน์
 *   · คอลัมน์ = ชื่อช่องรวมของทุกแถวในก้อน (`columns=` query param)
 * error: รูปแบบเดียวกับ PostgREST `{ message, code, details, hint }` โดย code = SQLSTATE
 *   และคอลัมน์ที่ไม่มีในตาราง = `PGRST204` (PostgREST ตรวจก่อนถึง Postgres)
 * ตราเวลา: `to_jsonb()` ของ Postgres = รูปแบบเดียวกับที่ PostgREST ส่งออก · session เป็น UTC แบบ Supabase
 *
 * ⚠️ นาฬิกาของ PGlite ละเอียดแค่มิลลิวินาที (Supabase จริงละเอียดไมโครวินาที)
 *    เขียนติดกันเร็วๆ ได้ updated_at ซ้ำกัน ซึ่งไม่เกิดบนเซิร์ฟเวอร์จริง และทำให้
 *    ตัวข้ามการดึงของ pullAll ตัดสินใจเพี้ยน → จึงรอ 2 มิลลิวินาทีหลังทุกคำสั่งเขียน
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';

export type Identity = { uid: string } | 'anon';

interface PgError { message: string; code: string; details: string | null; hint: string | null }

const toError = (e: unknown): PgError => {
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: err?.message ?? String(e), code: err?.code ?? '', details: err?.detail ?? null, hint: err?.hint ?? null };
};

const tick = () => new Promise((r) => setTimeout(r, 2));

/** ชนิดของคอลัมน์ต่อตาราง — ใช้ cast พารามิเตอร์ และตรวจชื่อคอลัมน์แบบ PostgREST */
async function columnTypes(db: PGlite, table: string, cache: Map<string, Map<string, string>>) {
  let m = cache.get(table);
  if (!m) {
    const r = await db.query<{ column_name: string; udt_name: string }>(
      `select column_name, udt_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`, [table]);
    m = new Map(r.rows.map((x) => [x.column_name, x.udt_name]));
    cache.set(table, m);
  }
  return m;
}

const castOf = (udt: string) => (udt.startsWith('_') ? `${udt.slice(1)}[]` : udt);
const encode = (udt: string, v: unknown) =>
  v === null || v === undefined ? null : udt === 'jsonb' || udt === 'json' ? JSON.stringify(v) : v;

/** สร้าง client หนึ่งตัวต่อ "เครื่อง" · ทุกคำขอรันในนามของ identity นั้นด้วย role จริง */
export function pgSupabase(
  db: PGlite, identity: Identity,
  opts: { pkOf: Record<string, string>; networkDown?: () => boolean; onError?: (e: PgError) => void; onUpsert?: (table: string, rows: number) => void; onSelect?: (table: string, rows: number) => void },
) {
  const types = new Map<string, Map<string, string>>();

  /** รันคำสั่งเดียวในนามผู้ใช้ · ห่อ transaction เหมือนหนึ่งคำขอ HTTP ของ PostgREST */
  async function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<{ value?: T; error?: PgError }> {
    /* เน็ตหลุด = คำขอไม่ถึงเซิร์ฟเวอร์เลย · supabase-js ห่อ fetch ที่ล้มเป็น error ที่ code ว่าง
       (ต่างจากการปฏิเสธจริงที่มีรหัส SQLSTATE เสมอ — cloudSync แยกสองอย่างนี้ด้วย isRefusal) */
    if (opts.networkDown?.()) {
      return { error: { message: 'TypeError: Failed to fetch', code: '', details: null, hint: null } };
    }
    try {
      const value = await db.transaction(async (tx) => {
        await tx.exec(`set local timezone = 'UTC';`);
        if (identity === 'anon') {
          await tx.exec(`set local role anon; select set_config('request.jwt.claim.sub', '', true);`);
        } else {
          await tx.exec(`set local role authenticated;`);
          await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [identity.uid]);
        }
        return fn(tx);
      });
      return { value };
    } catch (e) {
      const error = toError(e);
      opts.onError?.(error);
      return { error };
    }
  }

  const unknownColumn = (table: string, cols: string[], known: Map<string, string>): PgError | null => {
    const bad = cols.find((c) => !known.has(c));
    return bad
      ? { message: `Could not find the '${bad}' column of '${table}' in the schema cache`, code: 'PGRST204', details: null, hint: null }
      : null;
  };

  function from(table: string) {
    const pk = opts.pkOf[table];

    return {
      /* ตัวเลือกตรงกับ postgrest-js จริง:
         ignoreDuplicates → `resolution=ignore-duplicates` → ON CONFLICT DO NOTHING
         defaultToNull: false → `missing=default` → ช่องที่แถวนั้นไม่มี ใช้ค่า default ของคอลัมน์ */
      async upsert(
        values: Record<string, unknown> | Record<string, unknown>[],
        o: { ignoreDuplicates?: boolean; defaultToNull?: boolean } = {},
      ) {
        const ignoreDuplicates = o.ignoreDuplicates ?? false;
        const defaultToNull = o.defaultToNull ?? true;
        const rows = Array.isArray(values) ? values : [values];
        if (!rows.length) return { data: null, error: null };
        opts.onUpsert?.(table, rows.length); // ให้เทสต์นับว่า "ส่งขึ้นไปจริงกี่แถว" (ไม่ว่าจะสำเร็จหรือไม่)
        const known = await columnTypes(db, table, types);
        // supabase-js: คอลัมน์ = ชื่อช่องรวมของทุกแถว
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const bad = unknownColumn(table, cols, known);
        if (bad) return { data: null, error: bad };

        const params: unknown[] = [];
        const tuples = rows.map((r) => '(' + cols.map((c) => {
          if (!(c in r)) {
            // แถวที่ไม่มีช่องนี้ → NULL (ค่าเริ่มต้นของ supabase-js) หรือ DEFAULT ถ้าขอ missing=default
            if (!defaultToNull) return 'default';
            params.push(null);
            return `$${params.length}::${castOf(known.get(c)!)}`;
          }
          params.push(encode(known.get(c)!, r[c]));
          return `$${params.length}::${castOf(known.get(c)!)}`;
        }).join(', ') + ')');
        const updates = cols.filter((c) => c !== pk).map((c) => `"${c}" = excluded."${c}"`);
        const onConflict = ignoreDuplicates || !updates.length ? 'nothing' : 'update set ' + updates.join(', ');
        const sql = `insert into "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values ${tuples.join(', ')}
                     on conflict ("${pk}") do ${onConflict}`;
        const res = await run((tx) => tx.query(sql, params));
        await tick();
        return { data: null, error: res.error ?? null };
      },

      update(patch: Record<string, unknown>) {
        return {
          eq(col: string, val: unknown) {
            const exec = async () => {
              const known = await columnTypes(db, table, types);
              const cols = Object.keys(patch);
              const bad = unknownColumn(table, [...cols, col], known);
              if (bad) return { data: null, error: bad };
              const params: unknown[] = [];
              const sets = cols.map((c) => {
                params.push(encode(known.get(c)!, patch[c]));
                return `"${c}" = $${params.length}::${castOf(known.get(c)!)}`;
              });
              params.push(val);
              const sql = `update "${table}" set ${sets.join(', ')}
                           where "${col}" = $${params.length}::${castOf(known.get(col)!)} returning "${col}"`;
              const res = await run((tx) => tx.query(sql, params));
              await tick();
              return res.error
                ? { data: null, error: res.error }
                : { data: (res.value as { rows: unknown[] }).rows, error: null };
            };
            return { select: (_cols?: string) => exec(), then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => exec().then(ok, bad) };
          },
        };
      },

      delete() {
        return {
          async in(col: string, ids: unknown[]) {
            const known = await columnTypes(db, table, types);
            const res = await run((tx) =>
              tx.query(`delete from "${table}" where "${col}" = any($1::${castOf(known.get(col) ?? 'text')}[])`, [ids]));
            await tick();
            return { data: null, error: res.error ?? null };
          },
        };
      },

      select(columns = '*', selOpts?: { count?: string; head?: boolean }) {
        let orderBy: { col: string; asc: boolean } | null = null;
        let gte: { col: string; val: string } | null = null;
        const rowsOf = async (limit: number | null, offset: number) => {
          const cols = columns === '*' ? 't.*' : columns.split(',').map((c) => `t."${c.trim()}"`).join(', ');
          const order = orderBy ? `order by t."${orderBy.col}" ${orderBy.asc ? 'asc' : 'desc'}` : '';
          const lim = limit === null ? '' : `limit ${limit} offset ${offset}`;
          const where = gte ? `where t."${gte.col}" >= $1` : '';
          // to_jsonb = รูปแบบเดียวกับที่ PostgREST ส่งออก (ตราเวลา +00:00 · array · jsonb)
          const sql = columns === '*'
            ? `select to_jsonb(t.*) as r from "${table}" t ${where} ${order} ${lim}`
            : `select jsonb_build_object(${columns.split(',').map((c) => `'${c.trim()}', t."${c.trim()}"`).join(', ')}) as r from "${table}" t ${where} ${order} ${lim}`;
          void cols;
          const res = await run((tx) => tx.query<{ r: Record<string, unknown> }>(sql, gte ? [gte.val] : []));
          if (res.error) return { data: null, error: res.error };
          const data = (res.value as { rows: { r: Record<string, unknown> }[] }).rows.map((x) => x.r);
          if (columns === '*') opts.onSelect?.(table, data.length); // ให้เทสต์นับว่า "ดึงลงมาจริงกี่แถว"
          return { data, error: null };
        };
        const builder = {
          order(col: string, o?: { ascending?: boolean }) { orderBy = { col, asc: o?.ascending !== false }; return builder; },
          gte(col: string, val: string) { gte = { col, val }; return builder; },
          limit: (n: number) => rowsOf(n, 0),
          range: (fromIdx: number, toIdx: number) => rowsOf(toIdx - fromIdx + 1, fromIdx),
          // select('*', { count: 'exact', head: true }) — initCloudSync ใช้เช็คว่าตู้กลางว่างไหม
          then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
            const p = (async () => {
              if (selOpts?.head) {
                const res = await run((tx) => tx.query<{ n: number }>(`select count(*)::int as n from "${table}"`));
                return res.error ? { count: null, error: res.error } : { count: (res.value as { rows: { n: number }[] }).rows[0].n, error: null };
              }
              return rowsOf(null, 0);
            })();
            return p.then(ok, bad);
          },
        };
        return builder;
      },
    };
  }

  return {
    from,
    auth: { getUser: async () => ({ data: { user: identity === 'anon' ? null : { id: identity.uid } } }) },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeAllChannels() {},
  };
}

/** pk ของตารางฝั่งเซิร์ฟเวอร์ — ต้องตรงกับ TABLES ใน src/data/cloudSync.ts */
export const REMOTE_PK: Record<string, string> = {
  teachers: 'id', students: 'id', groups: 'code', patients: 'id', workpieces: 'id',
  updates: 'id', photos: 'id', checkins: 'id', reviews: 'id', submissions: 'id',
  issues: 'student_id', audit: 'id', self_assessments: 'id',
  sect2_records: 'id', sect3_records: 'id',
};
