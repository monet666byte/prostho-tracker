/**
 * Postgres ตัวจริงในเครื่อง + ของที่ Supabase มีให้ แต่ Postgres เปล่าไม่มี
 *
 * ทำไมต้องมี (13 ก.ย. 69): เทสต์เดิมทุกชุดใช้ "ตู้กลางปลอม" ที่เขียนเลียนแบบกฎของ migration ด้วยมือ
 * ซึ่งเพี้ยนจากของจริงได้โดยไม่มีใครรู้ (CLAUDE.md เตือนไว้หลายที่) และกฎ RLS / trigger / สิทธิ์ฟังก์ชัน
 * ทดสอบด้วยการอ่านอย่างเดียวมาตลอด · ไฟล์นี้รัน migration ของจริงทุกบรรทัดบน PGlite
 * (Postgres ที่คอมไพล์เป็น WASM) แล้วสลับตัวตนเป็นนักศึกษา/อาจารย์/คนนอก ด้วย role จริงของ Postgres
 *
 * ที่จำลองเอง (ของ Supabase ที่ไม่ได้อยู่ใน Postgres):
 *   · role `anon` / `authenticated` / `service_role` และสิทธิ์เริ่มต้นที่ Supabase ให้
 *   · `auth.users` + `auth.uid()` อ่านจาก `request.jwt.claim.sub` แบบเดียวกับ Supabase
 *   · schema `storage` (buckets / objects / foldername)
 *   · publication `supabase_realtime`
 * ⚠️ ถ้าวันหน้า migration ใช้ของ Supabase อย่างอื่นเพิ่ม ต้องมาเติมที่นี่
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase ให้สิทธิ์ตารางและฟังก์ชันใหม่ใน public กับทั้งสาม role ตรงๆ
-- (ตัวนี้แหละที่ทำให้ revoke from public อย่างเดียวไม่พอ)
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text not null);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text not null, owner uuid
);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated, anon, service_role;
grant select on storage.buckets to authenticated, anon, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create publication supabase_realtime;
`;

export interface MigrationResult { file: string; ok: boolean; error?: string }

/** สร้างฐานข้อมูลใหม่เอี่ยม แล้วรัน migration ทุกไฟล์ตามลำดับ — ไฟล์ละ transaction เหมือน SQL Editor */
export async function freshDatabase(root: string): Promise<{ db: PGlite; results: MigrationResult[] }> {
  const db = new PGlite();
  await db.exec(SHIM);
  const dir = join(root, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const results: MigrationResult[] = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    try {
      await db.exec('begin;\n' + sql + '\ncommit;');
      results.push({ file, ok: true });
    } catch (e) {
      await db.exec('rollback;').catch(() => {});
      results.push({ file, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { db, results };
}
