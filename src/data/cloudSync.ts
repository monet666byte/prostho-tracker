/**
 * เครื่องยนต์ sync — สะพานระหว่าง "ลิ้นชักในเครื่อง" (IndexedDB) กับ "ตู้แฟ้มกลาง" (Supabase)
 *
 * สถาปัตยกรรม: local-first
 *   - UI ทั้งแอปอ่าน/เขียน IndexedDB เหมือนเดิมทุกประการ (ไฟล์นี้ไม่แตะ UI เลย)
 *   - middleware ดัก "ทุกการเขียน" ลง IndexedDB → เข้าคิวส่งขึ้นตู้กลาง (debounce)
 *   - ตอนเปิดแอป: ส่งของค้างขึ้นก่อน (flush) → ดึงตู้ลงมา (pullAll ข้ามแถวที่ยังค้างส่ง)
 *     → ดันแถวที่ตู้ยังไม่มีขึ้นไป (pushAll แบบ ignoreDuplicates — ไม่ทับของบนตู้)
 *   - รอบ 15 วิ + realtime: มีใครแก้ตู้กลาง → แถวนั้นไหลลงลิ้นชักเรา (อาจารย์เห็น นศ. กด step สดๆ)
 *   - คิวส่งอยู่รอดข้ามการปิดแท็บ (สำเนาใน kv.syncOutbox)
 *
 * ชนกัน: แถวเดียวกันแก้สองเครื่อง ใช้กติกาใน domain/conflict.ts + trigger 0017/0020 บนเซิร์ฟเวอร์
 * สิทธิ์ว่าใครเห็น/เขียนแถวไหน = RLS บน Supabase (0004 เป็นต้นไป) ไฟล์นี้ไม่ตัดสินเอง
 */
import { db, kvGet, kvSet } from './db';
import { cloudEnabled, supabase } from '../lib/cloud';
import { flushSettings, pullSettings } from './settingsSync';
import { loadCachedPolicy, pullPdpaPolicy } from './pdpaSync';

/* ── ตารางที่ sync + กติกาแปลงชื่อคอลัมน์ camelCase ↔ snake_case ── */

interface TableDef {
  local: string; // ชื่อตารางใน Dexie
  remote: string; // ชื่อตารางใน Postgres
  pk: string; // primary key ฝั่ง local (camelCase)
  rename?: Record<string, string>; // ชื่อพิเศษ local → remote (นอกเหนือ snake_case อัตโนมัติ)
}

const TABLES: TableDef[] = [
  { local: 'teachers', remote: 'teachers', pk: 'id' },
  { local: 'students', remote: 'students', pk: 'id' },
  { local: 'groups', remote: 'groups', pk: 'code' },
  { local: 'patients', remote: 'patients', pk: 'id' },
  { local: 'workpieces', remote: 'workpieces', pk: 'id' },
  { local: 'updates', remote: 'updates', pk: 'id' },
  { local: 'photos', remote: 'photos', pk: 'id' },
  { local: 'checkins', remote: 'checkins', pk: 'id' },
  { local: 'reviews', remote: 'reviews', pk: 'id', rename: { by: 'by_who', at: 'at_when' } },
  { local: 'submissions', remote: 'submissions', pk: 'id' },
  { local: 'issues', remote: 'issues', pk: 'studentId' },
  { local: 'audit', remote: 'audit', pk: 'id', rename: { at: 'at_when' } },
  { local: 'selfAssessments', remote: 'self_assessments', pk: 'id' },
  { local: 'sect2', remote: 'sect2_records', pk: 'id', rename: { by: 'by_who', at: 'at_when' } },
  { local: 'sect3', remote: 'sect3_records', pk: 'id', rename: { by: 'by_who', at: 'at_when' } },
];

const byLocal = new Map(TABLES.map((t) => [t.local, t]));
const byRemote = new Map(TABLES.map((t) => [t.remote, t]));

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/**
 * แปลงเป็นแถวสำหรับส่งขึ้นตู้กลาง
 *
 * ⚠️ ห้ามใส่ updated_at ลงไป — ตราเวลาต้องมาจากนาฬิกาเซิร์ฟเวอร์เท่านั้น (trigger ใน 0017)
 *
 * เดิมตรงนี้ประทับ new Date() ของเครื่องผู้ใช้ ซึ่งพังแบบที่มองไม่เห็น:
 * pullAll ตัดสินใจว่า "จะดึงหรือข้าม" จากค่า updated_at สูงสุดบนตู้กลาง
 * เครื่องเดียวที่นาฬิกาเดินเร็วชั่วโมงเดียว เขียนแถวเดียว → ค่าสูงสุดค้างอยู่ที่เวลาอนาคต
 * → เครื่องอื่นทั้งหมดข้ามการดึงตารางนั้นไปเรื่อยๆ อาจารย์เห็นข้อมูลเก่าค้างโดยไม่มีอะไรบอก
 *
 */
function toRow(def: TableDef, obj: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    /* ต้องตัดทั้งสองสะกด — แถวที่ pullAll ดึงลงมาผ่าน fromRow() จะมีช่องชื่อ `updatedAt`
       ติดมาด้วย ถ้าตัดแค่ `updated_at` มันจะถูกแปลงกลับเป็น updated_at ตอนส่งขึ้น
       = เอาตราเวลาฝั่ง client ยัดกลับเข้าตู้กลาง ซึ่งเป็นต้นทางของบั๊ก
       "เครื่องนาฬิกาเพี้ยนทำให้ทุกเครื่องหยุดดึงข้อมูล"
       (ตอนนี้ trigger ของ 0017 เขียนทับให้ แต่ห้ามพึ่งด่านเดียว) */
    if (k === 'updated_at' || k === 'updatedAt') continue;
    row[def.rename?.[k] ?? toSnake(k)] = v === undefined ? null : v;
  }
  return row;
}

/**
 * แปลงเฉพาะ "ช่องที่แก้" เป็นคอลัมน์สำหรับ PATCH — ไม่ใช่ทั้งแถว
 *
 * ทำไมต้องมี: คิวเดิมจำแค่ว่าแถวไหนแก้ แล้วส่งขึ้นทั้งแถว
 * เครื่องที่ถือฉบับเก่าของช่องที่ตัวเองไม่ได้แตะ จึงเขียนค่าเก่านั้นทับของใหม่
 * (พิสูจน์ด้วย `test:clinic` ข้อ ④ — นักศึกษาคนเดียวเปิดมือถือ+ไอแพด แล้ว step ถูกย้อน)
 */
function toRowFields(
  def: TableDef, obj: Record<string, unknown>, fields: ReadonlySet<string>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const k of fields) {
    /* เหตุผลเดียวกับ toRow — ตราเวลาต้องมาจากนาฬิกาเซิร์ฟเวอร์เท่านั้น */
    if (k === 'updated_at' || k === 'updatedAt') continue;
    const v = obj[k];
    row[def.rename?.[k] ?? toSnake(k)] = v === undefined ? null : v;
  }
  return row;
}

function fromRow(def: TableDef, row: Record<string, unknown>): Record<string, unknown> {
  const back = new Map(Object.entries(def.rename ?? {}).map(([l, r]) => [r, l]));
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'updated_at') {
      obj.updated_at = v; // เก็บไว้ — ตัวบอกว่าแถวนี้ฉบับไหน (toRow จะทิ้งแล้วประทับใหม่ตอนส่งขึ้น)
      continue;
    }
    const localKey = back.get(k) ?? k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    obj[localKey] = v === null ? undefined : v;
  }
  return obj;
}

/* ── คิวส่งขึ้น (ในหน่วยความจำ + สำเนาใน kv.syncOutbox — ดู persistOutbox ด้านล่าง) ── */

/**
 * หยุด sync ชั่วคราวระหว่าง seed/reset — กันข้อมูล fixture ไหลขึ้นตู้กลาง
 *
 * ⚠️ ต้องนับชั้น ไม่ใช่สวิตช์เปิด/ปิดตัวเดียว:
 * งานสองงานหยุด sync ซ้อนกัน (เช่น React StrictMode สั่ง init สองรอบพร้อมกันตอนพัฒนา
 * หรือ seed กับการโหลดรุ่นที่จบแล้วคาบกัน) → งานแรกจบแล้วสั่ง "เปิด" ขณะที่งานที่สองยังเขียนอยู่
 * → แถวที่เหลือของงานที่สองเข้าคิวส่งขึ้นตู้กลาง · ตอนนั้นยิงคำขอขยะหลายพันคำขอตั้งแต่ยังไม่ล็อกอิน
 */
let pauseDepth = 0;
let paused = false;
// กัน echo แบบระบุรายแถว: เฉพาะ "แถวที่กำลัง apply จากตู้กลาง" เท่านั้นที่ไม่ต้องส่งกลับ
// (เคยใช้ธงคลุมทั้งระบบ → งานที่ผู้ใช้กดระหว่างจังหวะ apply หายไปเฉยๆ — บั๊กคืนแรก)
const applyingKeys = new Set<string>();
const keyOf = (local: string, pk: unknown) => local + '|' + String(pk);
/* ══════════════════════════════════════════════════════════════════════════════
   คิวจำ "ช่องที่แก้" ไม่ใช่แค่ "แถวที่แก้"

   บั๊กที่เคยเกิดจริง (`test:clinic` ข้อ ④ · ก่อนแก้ข้อนั้นตก):
   คิวเดิมเก็บแค่ pk แล้วตอนส่งจริงอ่านแถวล่าสุดจากลิ้นชักมา upsert **ทั้งแถว**
   นักศึกษาคนเดียวเปิดมือถือ + ไอแพดค้างทั้งคู่ · กด step บนไอแพด → ขึ้นตู้กลาง
   แล้วพิมพ์โน้ตบนมือถือที่ยังถือ procIndex เก่า → มือถือเขียน procIndex เก่าทับ
   = step ที่เพิ่งกดหายไปโดยไม่มี error ไม่มีป้าย

   `0020` ปิดช่องนี้ได้เฉพาะตาราง `checkins` เพราะที่นั่นมีเจ้าของช่องแยกตามบทบาท
   แต่ `workpieces` ทุกช่องเป็นของนักศึกษา กฎฝั่งเซิร์ฟเวอร์ช่วยไม่ได้
   (ทั้งสองเครื่องคือคนเดียวกัน) — ต้องแก้ที่คิว

   ค่าใน map ชั้นใน:
     · `Set<string>` = แก้เฉพาะช่องพวกนี้ → ส่งแบบ PATCH เฉพาะคอลัมน์นั้น
     · `null`        = **ส่งทั้งแถว** ใช้เมื่อเป็นแถวใหม่ (ตอนเขียนยังไม่มีของเดิม)
                       หรือเมื่อไม่รู้ว่าแก้ช่องไหน (คิวที่กู้มาจากสำเนารุ่นเก่า)
                       การส่งทั้งแถวยังจำเป็น เพราะ PATCH สร้างแถวใหม่ไม่ได้
   ══════════════════════════════════════════════════════════════════════════════ */
type FieldSet = Set<string> | null;
const dirty = new Map<string, Map<unknown, FieldSet>>(); // local table → pk → ช่องที่แก้
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function setSyncPaused(v: boolean) {
  pauseDepth = Math.max(0, pauseDepth + (v ? 1 : -1));
  paused = pauseDepth > 0;
}

/** รวมของเดิมกับของใหม่ — ถ้าฝ่ายใดฝ่ายหนึ่งเป็น "ทั้งแถว" ผลคือทั้งแถว */
function mergeFields(prev: FieldSet | undefined, next: FieldSet): FieldSet {
  if (prev === undefined) return next;
  if (prev === null || next === null) return null;
  const out = new Set(prev);
  for (const f of next) out.add(f);
  return out;
}

/**
 * ช่องที่ต่างกันระหว่างฉบับเดิมในเครื่องกับฉบับที่กำลังเขียน
 *
 * เทียบด้วย JSON เพราะช่องหลายตัวเป็น object/array (`scores`, `activities`, `gates`)
 * ช่องที่ "หายไป" จากฉบับใหม่ก็นับว่าแก้ — ต้องส่ง null ขึ้นไปลบค่าบนตู้กลางด้วย
 */
function changedFields(
  before: Record<string, unknown> | undefined, after: Record<string, unknown>,
): FieldSet {
  if (!before) return null; // แถวใหม่ — PATCH สร้างแถวไม่ได้ ต้องส่งทั้งแถว
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'updated_at' || k === 'updatedAt') continue;
    let same: boolean;
    try {
      same = JSON.stringify(before[k]) === JSON.stringify(after[k]);
    } catch {
      same = false; // มีของที่ stringify ไม่ได้ (Blob ฯลฯ) — ถือว่าต่าง ปลอดภัยกว่าเดา
    }
    if (!same) out.add(k);
  }
  return out;
}

function markDirty(local: string, entries: Array<[pk: unknown, fields: FieldSet]>) {
  if (!cloudEnabled || paused || !byLocal.has(local)) return;
  let m = dirty.get(local);
  if (!m) dirty.set(local, (m = new Map()));
  for (const [k, fields] of entries) {
    if (k === undefined || applyingKeys.has(keyOf(local, k))) continue;
    /* ช่องว่างเปล่า = เขียนทับด้วยของเดิมทุกช่อง (Dexie put ซ้ำค่าเดิม เกิดบ่อยกว่าที่คิด)
       ไม่ต้องเข้าคิว — แต่ถ้าแถวนั้นอยู่ในคิวอยู่แล้ว ห้ามถอดออก */
    if (fields && fields.size === 0 && !m.has(k)) continue;
    m.set(k, mergeFields(m.get(k), fields));
  }
  persistOutboxSoon();
  if (m.size && !flushTimer) flushTimer = setTimeout(() => void flush(), 1500);
}

/** middleware ดักทุกการเขียนของ Dexie — จดว่าแถวไหนต้องส่งขึ้นตู้กลาง */
db.use({
  stack: 'dbcore',
  name: 'cloud-outbox',
  create(down) {
    return {
      ...down,
      table(name: string) {
        const t = down.table(name);
        const def = byLocal.get(name);
        return {
          ...t,
          async mutate(req) {
            if (def && !paused && cloudEnabled) {
              if (req.type === 'add' || req.type === 'put') {
                const values = req.values as Record<string, unknown>[];
                const keys = values.map((v) => v[def.pk]);
                /* ต้องอ่านฉบับเดิม **ก่อน** เขียน เพื่อรู้ว่าแก้ช่องไหน
                   อ่านตารางเดิมใน transaction เดิมปลอดภัย — ของที่ห้ามทำคือไปเขียน
                   ตารางอื่น (เช่น kv) ซ้อนเข้าไป ซึ่งจะค้าง · จึงส่ง req.trans ต่อไป
                   ⚠️ อ่านไม่ได้ = ถือว่า "ทั้งแถว" ไม่ใช่ "ไม่มีอะไรแก้"
                      เดาผิดทางนี้เสียแค่แบนด์วิดท์ เดาผิดทางกลับคือข้อมูลหาย */
                let before: Array<Record<string, unknown> | undefined>;
                try {
                  before = (await t.getMany({
                    trans: req.trans, keys: keys as never[],
                  })) as Array<Record<string, unknown> | undefined>;
                } catch {
                  before = keys.map(() => undefined);
                }
                markDirty(name, values.map((v, i) => {
                  const prev = req.type === 'add' ? undefined : before[i];
                  return [keys[i], changedFields(prev, v)] as [unknown, FieldSet];
                }));
              } else if (req.type === 'delete') {
                markDelete(name, req.keys as unknown[]);
              }
              // deleteRange (เช่น table.clear) เกิดเฉพาะตอน reset ซึ่ง paused อยู่แล้ว
            }
            return t.mutate(req);
          },
        };
      },
    };
  },
});

const pendingDeletes = new Map<string, Set<unknown>>();

function markDelete(local: string, keys: unknown[]) {
  let set = pendingDeletes.get(local);
  if (!set) pendingDeletes.set(local, (set = new Set()));
  keys.forEach((k) => !applyingKeys.has(keyOf(local, k)) && set!.add(k));
  persistOutboxSoon();
  if (set.size && !flushTimer) flushTimer = setTimeout(() => void flush(), 1500);
}

/* ══════════════════════════════════════════════════════════════════════════════
   คิวรอส่งต้องทนการปิดแท็บ — ไม่ใช่อยู่แค่ในหน่วยความจำ

   บั๊กที่เคยเกิดจริง (ดู scripts/test-offline.mts ข้อ ①):
   `dirty` / `pendingDeletes` เป็น Map ธรรมดา หายไปพร้อมแท็บ · ไม่มีตัว flush ตอน pagehide
   พอเปิดแอปรอบหน้า `pullAll()` ทำงานก่อนแล้ว bulkPut ทับแถวท้องถิ่นด้วยฉบับบนเซิร์ฟเวอร์
   (ตัวกัน `skip` อ่านจาก `dirty` ที่ตอนนี้ว่างเปล่า)

   ผลที่เกิดจริง: นักศึกษากด step ตอนออฟไลน์ในคลินิก → ปิดแท็บ/iOS เก็บแท็บพื้นหลัง →
   เปิดใหม่ตอนมีเน็ต → step หายไปเฉยๆ **แต่แถว `updates` เป็นแถวใหม่จึงรอด**
   จึงได้สภาพที่แย่กว่าข้อมูลหายเฉยๆ คือ "ประวัติบอกว่าทำแล้ว แต่เคสบอกว่ายังไม่ทำ"
   และหน้าต่างของปัญหาไม่ใช่ 1.5 วิ แต่คือ **ทั้งช่วงที่ออฟไลน์** เพราะ flush ที่ล้ม
   จะคาคิวไว้ลองใหม่ทุก 15 วิ

   กติกาที่ยึดตอนนี้: **คิวคือของที่ต้องอยู่รอดเท่ากับข้อมูล** จึงเขียนลง IndexedDB (ตาราง kv)
   ทุกครั้งที่คิวขยับ แล้วอ่านกลับมา *ก่อน* pullAll รอบแรกเสมอ

   ⚠️ เขียนแบบเลื่อนไป macrotask ถัดไป (setTimeout 0) ไม่เขียนใน mutate ตรงๆ —
   ตอน mutate ยังอยู่ใน transaction ของ Dexie การเปิดเขียนตารางอื่นซ้อนเข้าไปจะค้าง
   ⚠️ ตาราง kv ไม่อยู่ใน TABLES จึงไม่ถูก middleware ดัก (ไม่เกิดวงวนคิวเขียนคิว)
   ══════════════════════════════════════════════════════════════════════════════ */
const OUTBOX_KEY = 'syncOutbox';

/**
 * สำเนาคิวบนดิสก์
 *
 * `v: 2` พร้อมคิวรายช่อง — `dirty` เก็บเป็นคู่ `[pk, ช่องที่แก้]`
 * โดย `null` หมายถึง "ทั้งแถว" · รูปแบบเดิม (`v` ไม่มี · `dirty` เป็นแค่รายการ pk)
 * ยังอ่านได้ เพราะผู้ใช้ที่อัปเดตแอปกลางคาบมีสำเนารุ่นเก่าค้างอยู่ในเครื่อง
 * และคิวที่อ่านไม่ออก = งานที่ผู้ใช้ทำแล้วหายไปเลย ห้ามเกิด
 */
interface OutboxSnapshot {
  v?: number;
  dirty: Array<[string, unknown[]]>;
  deletes: Array<[string, unknown[]]>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let outboxRestored = false;

/** เก็บเฉพาะตารางที่มีคีย์จริง — markDirty ทิ้ง Set ว่างไว้ใน map เป็นปกติ
 *  ถ้าเก็บด้วยจะได้ snapshot ที่ "ไม่ว่าง" ทั้งที่ไม่มีอะไรค้าง คนอ่านโค้ดต่อจะเข้าใจผิด */
function snapshotOutbox(): OutboxSnapshot {
  const pickDeletes = (m: Map<string, Set<unknown>>): Array<[string, unknown[]]> =>
    [...m].filter(([, keys]) => keys.size > 0).map(([t, keys]) => [t, [...keys]]);
  const pickDirty = (): Array<[string, unknown[]]> =>
    [...dirty].filter(([, m]) => m.size > 0).map(([t, m]) => [
      t,
      [...m].map(([pk, fields]) => [pk, fields ? [...fields] : null]),
    ]);
  return { v: 2, dirty: pickDirty(), deletes: pickDeletes(pendingDeletes) };
}

/** เขียนคิวลงเครื่องเดี๋ยวนี้ — ใช้ตอน pagehide ที่ไม่มีเวลาให้รอ macrotask */
export async function persistOutboxNow(): Promise<void> {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  // ยังไม่ได้อ่านคิวเก่าจากดิสก์ (หรือเพิ่งออกจากระบบ) — เขียนทับตอนนี้ = ลบคิวที่ยังไม่เคยเห็น
  if (!outboxRestored) return;
  try {
    await kvSet(OUTBOX_KEY, snapshotOutbox());
  } catch {
    /* เขียนไม่ได้ (ดิสก์เต็ม/หน้าต่างส่วนตัว) — คิวในหน่วยความจำยังทำงานต่อได้ */
  }
}

function persistOutboxSoon(): void {
  if (persistTimer || !outboxRestored) return;
  persistTimer = setTimeout(() => { persistTimer = null; void persistOutboxNow(); }, 0);
}

/**
 * อ่านคิวของเซสชันก่อนกลับเข้าหน่วยความจำ — **ต้องเรียกก่อน pullAll ครั้งแรก**
 * ไม่ใช่แค่เพื่อส่งของค้าง แต่เพราะ `skip` ของ pullAll อ่านจากคิวนี้
 * ถ้าอ่านทีหลัง pull รอบแรกจะทับของที่ยังไม่ได้ส่งไปแล้ว
 */
export async function restoreOutbox(): Promise<void> {
  if (outboxRestored) return;
  try {
    const snap = await kvGet<OutboxSnapshot | null>(OUTBOX_KEY, null);
    if (snap) {
      for (const [t, rows] of snap.dirty ?? []) {
        if (!byLocal.has(t) || !rows.length) continue;
        const m = dirty.get(t) ?? new Map<unknown, FieldSet>();
        for (const row of rows) {
          /* รุ่น 2 เก็บเป็นคู่ [pk, ช่อง] · รุ่นเก่าเก็บแค่ pk เดี่ยวๆ
             รุ่นเก่า → ไม่รู้ว่าแก้ช่องไหน จึงต้องถือว่า "ทั้งแถว" (ปลอดภัยกว่าเดา) */
          if (snap.v === 2 && Array.isArray(row)) {
            const [pk, fields] = row as [unknown, string[] | null];
            m.set(pk, mergeFields(m.get(pk), Array.isArray(fields) ? new Set(fields) : null));
          } else {
            m.set(row, null);
          }
        }
        dirty.set(t, m);
      }
      for (const [t, keys] of snap.deletes ?? []) {
        if (!byLocal.has(t) || !keys.length) continue;
        pendingDeletes.set(t, new Set([...(pendingDeletes.get(t) ?? []), ...keys]));
      }
    }
  } catch {
    /* อ่านไม่ได้ = เริ่มด้วยคิวว่าง ซึ่งเป็นสภาพเดิมก่อนมีไฟล์นี้ */
  }
  outboxRestored = true;
}

/** ล้างคิวทั้งในหน่วยความจำและในเครื่อง — ใช้ตอนผูกบัญชีใหม่/รีเซ็ต ที่ลิ้นชักถูกล้างไปด้วย */
async function clearOutbox(): Promise<void> {
  dirty.clear();
  pendingDeletes.clear();
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  try {
    await kvSet(OUTBOX_KEY, { dirty: [], deletes: [] });
  } catch { /* ไม่เป็นไร */ }
}

/** ตารางไหนส่งไม่ผ่านซ้ำๆ (ยามปฏิเสธถาวร) — เลิกลองหลังครบโควตา ไม่วนรบกวนเน็ตทุก 15 วิ */
const failCount = new Map<string, number>();
const MAX_PUSH_RETRY = 3;
/**
 * ตัวนับของทางส่งแบบ PATCH รายช่อง — นับ **รายแถว** (คีย์ `ตาราง|pk`) ไม่ใช่รายตาราง
 *
 * บั๊กที่เคยเกิดตอนทำคิวรายช่อง (จับได้ด้วย `test:clinic` ข้อ ⑫):
 * ทางส่ง PATCH เดิมเขียนว่า `if (res.error) continue` เฉยๆ ไม่นับ ไม่กัก
 * แถวที่ตู้ปฏิเสธถาวร (trigger raise · WITH CHECK ของ RLS) จึงวนส่งทุก 15 วิ ไปตลอดกาล
 * ไม่ขึ้นรายการปัญหาในหน้า sync · ป้ายค้างส่งไม่หาย · ปุ่มออกจากระบบไม่ยอมล้างเครื่อง
 * และไม่มีอะไรบอกผู้ใช้ว่าทำไม — ทางส่งทั้งแถวมีกติกา "ตกครบ 3 รอบ → กัก" มาตั้งนานแล้ว
 * ทางใหม่ต้องได้กติกาเดียวกัน
 */
const patchFail = new Map<string, number>();

/**
 * ตู้กลาง "ตอบกลับมาแล้วปฏิเสธ" จริงไหม — ต่างจาก "เน็ตหลุดส่งไม่ถึง" โดยสิ้นเชิง
 *
 * บั๊กที่เคยเกิดจริง (`test:offline` "เน็ตหลุดนานกว่า 3 รอบ"):
 * ทั้งสองทางส่งนับ error ทุกแบบรวมกัน · ไวไฟห้องคลินิกหลุด ~45 วิ = ล้ม 3 รอบ = ถูกกัก
 * แล้วของที่ถูกกักถูกเอาออกจากคิว → **เคสใหม่ที่เปิดตอนเน็ตหลุดไม่ขึ้นตู้กลางเลย**
 * แม้เน็ตจะกลับมาแล้ว และหน้าจอขึ้นว่า "ส่งไม่ได้" ทั้งที่ไม่ใช่ความผิดของแถว
 * ซ้ำร้าย pull ไม่ได้ข้ามแถวที่ถูกกัก → ฉบับบนตู้ทับฉบับในเครื่องที่ยังไม่ได้ส่ง
 *
 * กติกา: **กักได้เฉพาะเมื่อตู้ตอบรหัสปฏิเสธมา** (SQLSTATE 5 ตัว เช่น 42501 RLS / P0001
 * trigger raise / 23505 ซ้ำ · หรือรหัสของ PostgREST เอง PGRSTxxx)
 * error ที่ไม่มีรหัส = ส่งไม่ถึง (supabase-js ห่อ fetch ที่ล้มเป็น code ว่าง) → **รอส่งต่อไป
 * เรื่อยๆ ไม่มีกำหนด** ซึ่งคือคำสัญญาของแอปออฟไลน์
 *
 * ถ้าเดาผิดทาง "ไม่ใช่การปฏิเสธ" = แถวค้างคิวให้เห็นเป็นตัวเลข เสียแค่เน็ต
 * ถ้าเดาผิดทาง "ปฏิเสธ" = งานของผู้ใช้หาย · จึงเลือกทางแรกเสมอเมื่อไม่แน่ใจ
 */
export function isRefusal(err: { code?: string | null } | null | undefined): boolean {
  const c = err?.code ?? '';
  return /^[0-9A-Z]{5}$/.test(c) || /^PGRST\d+$/.test(c);
}

/* ── ของที่ส่งขึ้นไม่ได้จริงๆ — ต้องบอกผู้ใช้ ห้ามทิ้งเงียบ ─────────────────────
 *
 * บั๊กเดิม: upsert ยิงเป็นก้อน ถ้าแถวเดียวถูกฐานข้อมูลปฏิเสธ ทั้งก้อนตก
 * ครบ 3 ครั้งแล้ว clearSent ล้าง "ทุก id" ในคิว — คาบอื่นของนักศึกษาที่ไม่เกี่ยวข้องเลย
 * หายไปพร้อมกัน และ failCount ไม่เคยถูกรีเซ็ตหลังยอมแพ้ (n โตขึ้นเรื่อยๆ)
 * ทำให้หลังจากนั้นตารางนั้นทิ้งคิวทันทีที่พลาดครั้งเดียว = ยิ่งหายเยอะขึ้นเรื่อยๆ
 *
 * ตอนนี้: ก้อนตก → ลองรายแถว → กักเฉพาะแถวที่ผิดจริง ที่เหลือขึ้นได้ตามปกติ
 * แถวที่ถูกกักจะโผล่ในหน้า sync ให้ผู้ใช้เห็นว่า "อันนี้ยังไม่ขึ้น เพราะอะไร"
 */
export interface SyncProblem {
  table: string;
  key: unknown;
  reason: string;
  at: string;
}
const quarantine = new Map<string, SyncProblem>();
const problemListeners = new Set<() => void>();

/**
 * จำนวนแถวที่ยัง "ค้างส่ง" อยู่ในเครื่องนี้ ณ วินาทีนี้ (นับทั้งของที่จะ upsert และที่จะลบ)
 *
 * มีเพราะปุ่ม "sync ทันที" ต้องบอกความจริงได้ว่าของขึ้นครบหรือยัง
 * เดิมปุ่มนั้นล้างรายการ "รอส่ง" กับประทับ syncedAt ให้ทุกแถวโดยไม่รู้ผลจริง
 * ถ้าเน็ตคลินิกต่อติดแต่ยิงไม่ถึง (captive portal / เซิร์ฟเวอร์ล่ม) navigator.onLine ยังเป็น true
 * ปุ่มจึงกดได้ แล้วขึ้นว่าสำเร็จ ทั้งที่ไม่มีอะไรออกจากเครื่อง — ผู้ใช้เสียสัญญาณเดียวที่มี
 *
 * โหมด local/เดโมไม่ได้ติดตั้ง middleware (initCloudSync คืนก่อน) จึงได้ 0 เสมอ ซึ่งถูกต้อง
 */
export function pendingPushCount(): number {
  let n = 0;
  for (const keys of dirty.values()) n += keys.size;
  for (const keys of pendingDeletes.values()) n += keys.size;
  return n;
}

/** รายการที่ส่งขึ้นตู้กลางไม่สำเร็จและเลิกลองแล้ว — หน้า sync อ่านจากตรงนี้ */
export const syncProblems = (): SyncProblem[] => [...quarantine.values()];

export function onSyncProblems(fn: () => void): () => void {
  problemListeners.add(fn);
  return () => problemListeners.delete(fn);
}

function quarantineRow(local: string, key: unknown, reason: string) {
  quarantine.set(keyOf(local, key), { table: local, key, reason, at: new Date().toISOString() });
  problemListeners.forEach((fn) => fn());
}

/**
 * ให้โมดูลอื่นแจ้ง "ของชิ้นนี้ส่งขึ้นไม่ได้จริงๆ" เข้ารายการเดียวกับที่หน้า sync แสดงอยู่แล้ว
 *
 * ตอนนี้มีผู้ใช้รายเดียวคือ photoStore — ไฟล์รูปไม่ได้ขึ้นทางเดียวกับแถวข้อมูล (คนละ API)
 * แต่ผู้ใช้ไม่ควรต้องรู้เรื่องนั้น ถ้ารูปไม่ขึ้นก็ต้องโผล่ที่การ์ดเตือนใบเดิม
 * ไม่ใช่สร้าง UI คู่ขนานอีกชุดให้พลาดคนละที่
 */
export function reportSyncProblem(table: string, key: unknown, reason: string): void {
  quarantineRow(table, key, reason);
}

/** ผู้ใช้กด "ลองส่งใหม่" ในหน้า sync — เอาของที่กักไว้กลับเข้าคิว */
export function retryQuarantined(): void {
  const items = [...quarantine.values()];
  quarantine.clear();
  failCount.clear();
  patchFail.clear(); // ไม่ล้าง = กด "ลองส่งใหม่" แล้วถูกกักกลับทันทีในรอบแรก
  problemListeners.forEach((fn) => fn());
  /* ของที่ถูกกักไว้ไม่รู้แล้วว่าตอนนั้นแก้ช่องไหน — ส่งทั้งแถว (null)
     ปลอดภัยกว่าเดาช่อง และของที่ถูกกักมีไม่กี่แถวอยู่แล้ว */
  for (const it of items) markDirty(it.table, [[it.key, null]]);
  // ของที่ไม่ได้ขึ้นทางคิวแถว (ไฟล์รูป) ต้องถูกปลุกด้วย ไม่งั้นปุ่มนี้โกหกครึ่งเดียว
  retryListeners.forEach((fn) => fn());
}

/* ── จุดต่อขยาย: งานส่งขึ้นที่ไม่ได้อยู่ในรูปของ "แถวในตาราง" ─────────────────
 *
 * ไฟล์รูปขึ้นผ่าน Storage API คนละทางกับ upsert แต่ต้องถูกปลุกจังหวะเดียวกันเป๊ะ
 * (รอบ 15 วิ · event online · เปิดจอกลับมา · ปุ่ม sync) ไม่งั้นจะมีสภาพแบบ
 * "แถวขึ้นแล้วแต่ไฟล์ยังไม่ขึ้น" ค้างอยู่จนกว่าผู้ใช้จะบังเอิญเปิดหน้าคลังรูป
 *
 * ทำเป็นตัวลงทะเบียนแทน import ตรงๆ เพราะ photoStore ต้องใช้ reportSyncProblem จากไฟล์นี้
 * ถ้าไฟล์นี้ import photoStore กลับไปด้วยจะเป็นวงกลม (vite ยอม แต่ลำดับ init จะเดาไม่ได้)
 */
type PumpHook = () => Promise<void>;
const pumpHooks = new Set<PumpHook>();
const retryListeners = new Set<() => void>();

export function onSyncPump(fn: PumpHook): () => void {
  pumpHooks.add(fn);
  return () => pumpHooks.delete(fn);
}

export function onRetryRequested(fn: () => void): () => void {
  retryListeners.add(fn);
  return () => retryListeners.delete(fn);
}

/** เรียกงานที่ลงทะเบียนไว้ — ตัวไหนพังไม่ลากตัวอื่นตก */
async function runPumpHooks(): Promise<void> {
  for (const fn of pumpHooks) {
    try {
      await fn();
    } catch (e) {
      console.error('sync pump hook ล้ม', e);
    }
  }
}

/** ส่งของค้างขึ้นตู้กลาง */
async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!supabase) return;
  /**
   * ⚠️ ห้ามล้างทั้งชุดหลัง await
   *
   * ระหว่างรอเน็ต (bulkGet + upsert กินเวลาเป็นวินาทีบนเน็ตคลินิก) ผู้ใช้กดบันทึกเพิ่มได้
   * markDirty จะใส่คีย์ใหม่ลง Set ก้อนเดิมที่ยังอยู่ใน map — ถ้าจบด้วย dirty.delete(local)
   * คีย์ที่เพิ่งเข้าคิวจะถูกทิ้งไปทั้งที่ยังไม่เคยส่งขึ้นเลย
   * แล้ว pullAll รอบถัดไปจะไม่ skip แถวนั้น (เพราะไม่อยู่ใน dirty แล้ว) → ของเก่าจากเซิร์ฟเวอร์
   * ทับสิ่งที่ผู้ใช้เพิ่งกด = ข้อมูลหายจริงโดยไม่มีใครรู้
   * จึงต้องเอาออกเฉพาะคีย์ที่ "ส่งไปแล้วจริง" เท่านั้น
   */
  const clearSent = (map: Map<string, Set<unknown>>, local: string, keys: Set<unknown>, sent: unknown[]) => {
    sent.forEach((k) => keys.delete(k));
    if (!keys.size) map.delete(local);
    else if (!flushTimer) flushTimer = setTimeout(() => void flush(), 1500); // ของที่เข้าคิวระหว่างทาง ส่งต่อรอบหน้า
    // คิวหดก็ต้องบันทึก ไม่ใช่บันทึกแค่ตอนโต — ไม่งั้นเปิดใหม่จะส่งของที่ขึ้นไปแล้วซ้ำ
    persistOutboxSoon();
  };

  /**
   * เอาแถวที่ส่งไปแล้วออกจากคิวรายช่อง
   *
   * ⚠️ ต้องเทียบ "ช่อง" ที่ส่งไปกับที่อยู่ในคิว **ตอนนี้** ไม่ใช่ลบทิ้งทั้งแถว
   * เหตุผลเดียวกับคอมเมนต์ข้างบน: ระหว่างรอเน็ต ผู้ใช้กดแก้ช่องอื่นของแถวเดิมได้
   * ลบทั้งแถว = ช่องที่เพิ่งแก้หายจากคิวโดยไม่เคยถูกส่ง แล้ว pullAll รอบหน้าทับทิ้ง
   */
  const clearSentFields = (
    local: string, m: Map<unknown, FieldSet>, sent: Array<[unknown, FieldSet]>,
  ) => {
    for (const [pk, sentFields] of sent) {
      const now = m.get(pk);
      if (now === undefined) continue;
      if (sentFields === null || now === null) {
        /* ส่งทั้งแถวไปแล้ว = ทุกช่องที่ค้างถูกครอบไปด้วย · หรือคิวกลายเป็น "ทั้งแถว"
           ระหว่างทาง (มีคนสร้างแถวใหม่ทับ) ซึ่งกรณีหลังต้องเก็บไว้ส่งรอบหน้า */
        if (sentFields === null) m.delete(pk);
        continue;
      }
      for (const f of sentFields) now.delete(f);
      if (now.size === 0) m.delete(pk);
    }
    if (!m.size) dirty.delete(local);
    else if (!flushTimer) flushTimer = setTimeout(() => void flush(), 1500);
    persistOutboxSoon();
  };

  // ลบก่อน (แถวที่ถูกลบ local)
  for (const [local, keys] of [...pendingDeletes]) {
    const def = byLocal.get(local)!;
    const ids = [...keys];
    if (!ids.length) { pendingDeletes.delete(local); continue; }
    const { error } = await supabase.from(def.remote).delete().in(def.rename?.[def.pk] ?? toSnake(def.pk), ids);
    if (!error) clearSent(pendingDeletes, local, keys, ids);
  }
  // แล้วค่อยส่งแถวที่แก้ (อ่านสถานะล่าสุดจาก dexie ตอนส่งจริง)
  for (const [local, fieldMap] of [...dirty]) {
    const def = byLocal.get(local)!;
    const remotePk = def.rename?.[def.pk] ?? toSnake(def.pk);
    if (!fieldMap.size) { dirty.delete(local); continue; }

    /* แยกสองกอง:
       · "ทั้งแถว" (แถวใหม่ / คิวรุ่นเก่า) → upsert เป็นก้อนเหมือนเดิม เร็วและสร้างแถวได้
       · "เฉพาะช่อง" → PATCH ทีละแถว เพื่อไม่ไปแตะช่องที่เครื่องอื่นเพิ่งแก้ */
    const fullIds = [...fieldMap].filter(([, f]) => f === null).map(([pk]) => pk);
    const patchRows = [...fieldMap].filter(([, f]) => f !== null) as Array<[unknown, Set<string>]>;

    /* ── กอง PATCH ──
       ทำก่อนกอง "ทั้งแถว" โดยเจตนา: ถ้าแถวหายจากตู้กลาง (ใครลบไป) PATCH จะไม่โดนอะไรเลย
       ซึ่งต้องรู้ให้ได้ ไม่ใช่เงียบ — จึงขอ pk กลับมาด้วยแล้วเช็คว่าโดนจริงไหม */
    const patched: Array<[unknown, FieldSet]> = [];
    for (const [pk, fields] of patchRows) {
      const obj = (await db.table(local).get(pk as never)) as Record<string, unknown> | undefined;
      if (!obj) {
        /* แถวหายจากเครื่องไปแล้วระหว่างรอส่ง (ผู้ใช้ลบ) — ตัวลบมีคิวของตัวเอง
           ตรงนี้แค่เอาออกจากคิวแก้ ไม่ต้องทำอะไรกับตู้กลาง */
        patched.push([pk, fields]);
        continue;
      }
      const patch = toRowFields(def, obj, fields);
      if (!Object.keys(patch).length) { patched.push([pk, fields]); continue; }

      const res = await supabase.from(def.remote).update(patch).eq(remotePk, pk).select(remotePk);
      if (res.error) {
        /* เน็ตหลุด → รอส่งต่อ ไม่นับ ไม่กัก (ดู isRefusal)
           ตู้ปฏิเสธจริง → ให้โอกาสเท่าทางส่งทั้งแถว แล้วกักไว้ให้ผู้ใช้เห็น ห้ามวนเงียบๆ ตลอดกาล */
        if (!isRefusal(res.error)) continue;
        const fk = keyOf(local, pk);
        const n = (patchFail.get(fk) ?? 0) + 1;
        if (n < MAX_PUSH_RETRY) { patchFail.set(fk, n); continue; }
        patchFail.delete(fk);
        quarantineRow(local, pk, res.error.message ?? 'ปฏิเสธโดยไม่บอกเหตุผล');
        patched.push([pk, fields]); // ออกจากคิว — ไปอยู่ในรายการที่ผู้ใช้เห็นแทน
        continue;
      }
      patchFail.delete(keyOf(local, pk));
      if ((res.data?.length ?? 0) > 0) { patched.push([pk, fields]); continue; }

      /* PATCH ไม่โดนแถวไหนเลย = ตู้กลางไม่มีแถวนี้ (ยังไม่เคยขึ้น หรือถูกลบไป)
         ต้องส่งทั้งแถวเพื่อสร้างใหม่ ไม่ใช่ปล่อยให้งานของผู้ใช้หายเงียบ */
      const up = await supabase.from(def.remote).upsert([toRow(def, obj)]);
      if (!up.error) patched.push([pk, null]);
      else if (isRefusal(up.error)) {
        quarantineRow(local, pk, up.error.message ?? 'ปฏิเสธโดยไม่บอกเหตุผล');
        patched.push([pk, fields]);
      }
      // เน็ตหลุดกลางทาง → คาไว้ในคิว รอบหน้าลองใหม่
    }
    if (patched.length) clearSentFields(local, fieldMap, patched);

    /* ── กอง "ทั้งแถว" ── (ตรรกะเดิมทั้งหมด รวมถึงการแยกส่งทีละแถวเมื่อก้อนตกซ้ำ) */
    if (!fullIds.length) continue;
    const objs = (await db.table(local).bulkGet(fullIds as never[])).filter(Boolean) as Record<string, unknown>[];
    const asSent = (ids: unknown[]): Array<[unknown, FieldSet]> => ids.map((k) => [k, null]);
    if (!objs.length) { clearSentFields(local, fieldMap, asSent(fullIds)); continue; }

    /* defaultToNull: false — ก้อนนี้คือแถวใหม่หลายแถวที่ช่องอาจไม่เท่ากัน (ดูคอมเมนต์ของ pushAll)
       supabase-js ค่าเริ่มต้นจะยัด NULL ให้ช่องที่แถวนั้นไม่มี แล้วช่อง NOT NULL ทำให้ทั้งก้อนตก */
    const { error } = await supabase.from(def.remote).upsert(
      objs.map((o) => toRow(def, o)), { defaultToNull: false },
    );
    if (!error) {
      failCount.delete(local);
      clearSentFields(local, fieldMap, asSent(fullIds));
      continue;
    }

    /* เน็ตหลุด → ไม่นับรอบ รอส่งต่อไปเรื่อยๆ (ดู isRefusal)
       เดิมนับทุก error รวมกัน ไวไฟหลุดครึ่งนาทีก็พอให้ทั้งก้อนถูกกัก */
    if (!isRefusal(error)) continue;
    const n = (failCount.get(local) ?? 0) + 1;
    failCount.set(local, n);
    if (n < MAX_PUSH_RETRY) continue; // ปฏิเสธรอบเดียวอาจเป็นจังหวะชน — เก็บทั้งชุดไว้ลองใหม่รอบหน้า

    /**
     * ครบโควตาแล้วยังไม่ผ่าน = น่าจะมีแถวเสียอยู่ในก้อน ไม่ใช่เน็ต
     * แยกส่งทีละแถวเพื่อหาว่าแถวไหนผิด — ที่เหลือจะได้ขึ้นตามปกติ
     * (เดิมทิ้งทั้งก้อน ทำให้งานที่ไม่เกี่ยวข้องหายไปด้วยแบบไม่มีใครรู้)
     */
    failCount.delete(local);
    const sent: unknown[] = [];
    for (const o of objs) {
      const pk = o[def.pk];
      const one = await supabase.from(def.remote).upsert([toRow(def, o)]);
      if (one.error && !isRefusal(one.error)) continue; // เน็ตหลุดกลางทาง — แถวนี้รอรอบหน้า
      if (one.error) quarantineRow(local, pk, one.error.message ?? 'ปฏิเสธโดยไม่บอกเหตุผล');
      sent.push(pk); // ผ่านหรือถูกกัก ก็ออกจากคิวทั้งคู่ — ที่ถูกกักไปอยู่ในรายการที่ผู้ใช้เห็น
    }
    clearSentFields(local, fieldMap, asSent(sent));
  }
}

/**
 * ส่งของค้างขึ้นเดี๋ยวนี้ — ไม่รอ debounce 1.5 วิ และไม่รอรอบ 15 วิ
 * ใช้ตอนผู้ใช้กด sync เอง และในเทสต์ (ก้อนที่ตกไปแล้วไม่ได้ตั้งเวลาลองใหม่ให้ตัวเอง
 * ในแอปจริงรอบ 15 วิ กับ event 'online' เป็นคนพามันกลับมา)
 */
export const flushNow = async (): Promise<void> => {
  await flush();
  await runPumpHooks();
};

/* ── ดึงลง / ดันขึ้น ทั้งตู้ ── */

async function applyRemote(local: string, pks: unknown[], fn: () => Promise<void>) {
  pks.forEach((k) => applyingKeys.add(keyOf(local, k)));
  try {
    await fn();
  } finally {
    pks.forEach((k) => applyingKeys.delete(keyOf(local, k)));
  }
}

const lastPulled = new Map<string, string>(); // remote table → max updated_at ที่ดึงล่าสุด

/**
 * เวลาที่ "ดึงครบทุกตารางโดยไม่มีตารางไหนพลาด" ครั้งล่าสุด — หน้าภาพรวมใช้เตือนว่าข้อมูลบนจอเก่าแล้ว
 * ⚠️ ต้องตั้งหลังรอบที่ไม่มี error เท่านั้น (กติกา "ห้ามมีป้ายหลอก") — ดึงพลาดบางตารางแล้วบอกว่าสดคือโกหก
 */
let lastFullPullAt: number | null = null;
export const lastPullAt = (): number | null => lastFullPullAt;
/**
 * pk ที่ "เห็นอยู่บนตู้กลาง" จากการดึงครบทั้งตารางครั้งล่าสุด — local table → ชุด pk
 *
 * ใช้ให้ pushAll ส่งเฉพาะแถวที่ตู้ยังไม่มี · วัดจากสำเนาจริง: เดิมเครื่องอาจารย์
 * ส่งทุกแถวในเครื่องขึ้นไปใหม่ทุกครั้งที่เปิดแอป ≈ 1 MB ทั้งที่แทบทุกแถวเพิ่งดึงลงมาเมื่อวินาทีก่อน
 * และคาบคลินิกสะสมทั้งเทอม (96 คน × 2 ต่อสัปดาห์) ขนาดนี้โตขึ้นทุกสัปดาห์บนเน็ตคลินิก
 *
 * ⚠️ มีค่าเฉพาะตารางที่ดึงครบจริงเท่านั้น (ไม่มี error ระหว่างทาง) · ไม่มีค่า = pushAll ส่งทุกแถวเหมือนเดิม
 *    ดีกว่าเดาว่า "ตู้มีแล้ว" แล้วงานที่ไม่เคยขึ้นตู้ไม่ถูกส่ง
 */
const serverKeys = new Map<string, Set<unknown>>();

/**
 * ดึงทั้งตาราง หรือดึงเฉพาะแถวที่ขยับ — ตัดสินรายตารางทุกรอบ
 *
 * บั๊กที่เคยเกิดจริง (`npm run perf:scale` ข้อมูลเต็มปี 200 คน):
 * เดิมตารางไหน "มีอะไรใหม่แม้แถวเดียว" จะดึงลงมาใหม่ **ทั้งตาราง** ทุกรอบ 15 วิ
 * ระหว่างคาบมีคนเช็คอินตลอด → เครื่องอาจารย์ดึงคาบ 16,000 แถวซ้ำทุกรอบ
 * = **11.6 MB ต่อนาที ≈ 700 MB ต่อชั่วโมง ต่อหนึ่งเครื่อง** (โควตาแผนฟรีทั้งเดือน 5 GB)
 * และ bulkPut หมื่นแถวทุก 15 วิ บนมือถือรุ่นเก่า
 *
 * ตอนนี้: ดึงทั้งตารางครั้งแรกของการเปิดแอป (ยังไม่รู้ว่าตู้มีอะไร) แล้วรอบถัดไปขอเฉพาะ
 * `updated_at >= ค่าสูงสุดที่เคยเห็น - 2 นาที`
 *   · ตราเวลามาจากนาฬิกาเซิร์ฟเวอร์เท่านั้น (0017) นาฬิกาเครื่องผู้ใช้ไม่เกี่ยว
 *   · เผื่อ 2 นาที เพราะ now() ของ Postgres คือเวลา "เริ่ม" transaction — แถวที่เขียนช้า
 *     อาจ commit หลังรอบที่แล้วแต่ตราเวลาเก่ากว่าค่าสูงสุดที่เห็นไปแล้ว (ดึงซ้ำนิดหน่อยไม่เสียหาย)
 *   · ตราเวลาอนาคต (ตู้ที่ยังไม่รัน 0017) → ดึงทั้งตารางเหมือนเดิม ไม่เชื่อค่านั้น
 *   · รายชื่อ/กลุ่มขยับ → สิทธิ์การมองเห็นอาจเปลี่ยน (อาจารย์ได้กลุ่มใหม่ = แถวเก่าที่ตราเวลาเก่า
 *     เพิ่งมองเห็น) → ตารางที่เหลือในรอบนั้นดึงทั้งตาราง
 *     (TABLES เรียง students / groups ไว้ก่อนตารางข้อมูลงาน จึงรู้ทันในรอบเดียวกัน)
 *
 * ⚠️ แถวที่ถูกลบบนตู้ **ไม่เคย** ถูกลบจากเครื่องด้วย pull ทั้งแบบเก่าและแบบนี้ — มีแค่ realtime
 *    ที่ลบให้ · เรื่องนี้ไม่ได้แย่ลง แต่ก็ยังไม่ได้แก้
 */
const PULL_OVERLAP_MS = 120_000;

/**
 * pullAll ห้ามวิ่งซ้อนกัน — วิ่งอยู่ได้หนึ่งรอบ + รอคิวได้อีกหนึ่งรอบ
 *
 * บั๊กที่เคยเกิดจริง (`npm run perf:scale` · CPU ช้า 4 เท่า + เน็ต 2 Mbps):
 * ดึงครั้งแรกของข้อมูลเต็มปีใช้ ~110 วิ แต่รอบ 15 วิ / เปิดจอกลับมา / ปุ่ม sync เรียก pullAll ซ้ำ
 * โดยไม่รอรอบก่อน → ระหว่างที่รอบแรกยังดึงอยู่ มีอีก 6–7 รอบดึงทั้งตารางชุดเดียวกันพร้อมกัน
 * (ยังไม่มี serverKeys ให้รอบหลังรู้ว่าดึงเฉพาะที่ขยับได้) · เน็ตคลินิกยิ่งช้า ยิ่งซ้อนมาก
 *
 * คนที่เรียกระหว่างที่มีรอบวิ่งอยู่ ได้ promise ของ "รอบถัดไป" ซึ่งเริ่มหลังรอบปัจจุบันจบ
 * (ไม่ใช่รอบที่วิ่งอยู่ — cloudReset ล้างลิ้นชักแล้วเรียก pullAll ต้องได้การดึงที่เริ่มหลังล้างจริง)
 */
let pullRunning: Promise<void> = Promise.resolve();
let pullQueued: Promise<void> | null = null;

export function pullAll(): Promise<void> {
  if (pullQueued) return pullQueued;
  const next = pullRunning.then(async () => {
    pullQueued = null;
    await pullAllOnce();
  });
  pullQueued = next;
  pullRunning = next.catch(() => {});
  return next;
}

async function pullAllOnce(): Promise<void> {
  if (!supabase) return;
  let scopeChanged = false;
  let missed = false;
  // ค่าตั้งของภาคอยู่คนละตารางและมีกติกาของตัวเอง (แถวเดียว · เขียนได้เฉพาะอาจารย์)
  await pullSettings();
  // นโยบาย PDPA ก็แถวเดียวเหมือนกัน แต่เขียนได้เฉพาะหัวหน้าภาค (0016)
  // ต้องดึงทุกรอบ ไม่ใช่แค่ตอนเปิดแอป — หัวหน้าภาคปิดสิทธิ์ส่งออกแล้วต้องมีผลกับทุกเครื่องภายใน 15 วิ
  await pullPdpaPolicy();
  for (const def of TABLES) {
    // เช็คก่อนว่าตารางนี้มีอะไรใหม่มั้ย — ส่วนใหญ่ไม่มี จะได้ไม่ต้องดึง/เขียนทับให้เสี่ยง
    const head = await supabase.from(def.remote).select('updated_at').order('updated_at', { ascending: false }).limit(1);
    if (head.error) { missed = true; continue; }
    const remoteMax = (head.data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? '';
    /**
     * ⚠️ ตราเวลาที่อยู่ "ในอนาคต" ห้ามใช้เป็นเหตุผลข้ามการดึง
     *
     * ตั้งแต่ 0017 เซิร์ฟเวอร์เป็นคนประทับเวลา ค่านี้จึงไม่ควรเกินเวลาปัจจุบัน
     * แต่ถ้ายังไม่ได้รัน 0017 (หรือมีแถวเก่าที่เครื่องนาฬิกาเพี้ยนเขียนไว้)
     * ค่าสูงสุดจะค้างอยู่ที่อนาคตถาวร แล้วตัวเช็ค "เท่าเดิม = ไม่มีอะไรใหม่" จะเป็นจริงตลอด
     * ผลคือตารางนั้นหยุดไหลลงเครื่องนี้ไปเลย โดยไม่มี error ให้ใครเห็น
     * ตรงนี้จึงยอมดึงซ้ำ (เปลืองเน็ตนิดหน่อย) ดีกว่าเงียบแล้วข้อมูลไม่ตรงกัน
     */
    const stampIsSane = remoteMax && remoteMax <= new Date().toISOString();
    if (stampIsSane && lastPulled.get(def.remote) === remoteMax) continue;

    // ⚠️ เซิร์ฟเวอร์ตัดผลลัพธ์ที่ 1,000 แถวเสมอ (ไม่ว่าจะขอเท่าไหร่) — ต้องดึงทีละหน้า
    // ไม่งั้นข้อมูลหายเงียบๆ พอโตเกินพัน (เจอตอนทดสอบ: มี 1,215 คาบ ดึงได้ 1,000)
    const remotePkCol = def.rename?.[def.pk] ?? toSnake(def.pk);
    const since = lastPulled.get(def.remote);
    const sinceMs = since ? Date.parse(since) : NaN;
    const known = serverKeys.get(def.local);
    const incremental = !!(stampIsSane && known && !scopeChanged && Number.isFinite(sinceMs));
    const from0 = incremental ? new Date(sinceMs - PULL_OVERLAP_MS).toISOString() : '';
    const PAGE = 1000;
    const data: Record<string, unknown>[] = [];
    let failed = false;
    for (let from = 0; ; from += PAGE) {
      const base = supabase.from(def.remote).select('*');
      const page = await (incremental ? base.gte('updated_at', from0) : base)
        .order(remotePkCol, { ascending: true })
        .range(from, from + PAGE - 1);
      if (page.error) { failed = true; break; }
      data.push(...((page.data ?? []) as Record<string, unknown>[]));
      if ((page.data?.length ?? 0) < PAGE) break;
      if (from > 200_000) break; // กันวนไม่รู้จบถ้ามีอะไรผิดปกติ
    }
    if (failed) { missed = true; continue; }
    // ห้ามทับแถวที่มีงานค้างส่งอยู่ — ไม่งั้น pull ฉบับเก่าจะกลืนสิ่งที่ผู้ใช้เพิ่งกด (บั๊กที่เจอคืนแรก)
    /* ⚠️ `dirty` ชั้นในเป็น Map (pk → ช่องที่แก้) — ต้องเอา **คีย์**
       ถ้าเผลอ spread ทั้ง Map จะได้คู่ [pk, ช่อง] แล้ว skip ไม่ตรงกับ pk ของแถวเลย
       ผลคือ pull ทับแถวที่ยังค้างส่งอยู่ = บั๊กข้อมูลหายตัวเดิมที่แก้ไปแล้วกลับมา */
    const skip = new Set([
      ...(dirty.get(def.local)?.keys() ?? []),
      ...(pendingDeletes.get(def.local) ?? []),
      /* แถวที่ถูกกัก = ฉบับในเครื่องที่ยังไม่เคยขึ้นตู้ · ถ้า pull ทับ ผู้ใช้กด
         "ลองส่งใหม่" แล้วจะส่งฉบับบนตู้กลับขึ้นไปแทนงานของตัวเอง
         ยอมให้แถวนั้นไม่ได้ของใหม่จนกว่าจะแก้ปัญหา ดีกว่าลบงานทิ้งเงียบๆ */
      ...[...quarantine.values()].filter((q) => q.table === def.local).map((q) => q.key),
    ]);
    const rows = data.filter((r) => !skip.has(r[remotePkCol]));
    await applyRemote(def.local, rows.map((r) => r[remotePkCol]), async () => {
      await db.table(def.local).bulkPut(rows.map((r) => fromRow(def, r)) as never[]);
    });
    if (incremental) data.forEach((r) => known!.add(r[remotePkCol]));
    else serverKeys.set(def.local, new Set(data.map((r) => r[remotePkCol])));
    if (incremental && data.length && (def.local === 'students' || def.local === 'groups')) scopeChanged = true;
    lastPulled.set(def.remote, remoteMax);
  }
  if (!missed) lastFullPullAt = Date.now();
}

/**
 * ดันแถวที่ **ตู้กลางยังไม่มี** ขึ้นไป — ตาข่ายกันงานหาย ไม่ใช่ตัวส่งของที่แก้
 *
 * บั๊กที่พิสูจน์บน Postgres จริง (`test:sync-pg` ข้อ ⑨ ⑩):
 * เดิมเป็น upsert แบบ merge ธรรมดา = **เขียนทับทุกแถวที่มีอยู่แล้วด้วยฉบับในเครื่อง**
 * ทั้งที่มันถูกเรียกหลัง pullAll ทุกครั้งที่เปิดแอป และคอมเมนต์ที่จุดเรียกบอกว่า
 * "ดันของท้องถิ่นที่ตู้ยังไม่มี" · ผลที่เกิดจริง:
 *   · นักศึกษากด step บนไอแพด ระหว่างที่มือถือกำลังเปิดแอป → มือถือดัน step เก่ากลับขึ้นไป
 *     (pullAll กับ pushAll ห่างกันเป็นวินาทีบนเน็ตคลินิก — 15 ตาราง ตารางละหลายร้อยแถว)
 *   · supabase-js รวมชื่อช่องของทุกแถวในก้อน แล้วแถวที่ไม่มีช่องนั้นได้ **NULL** (ไม่ใช่ default)
 *     → "คืนเคสแล้ว" ที่อยู่บนตู้ ถูกทับเป็นค่าว่างจากสำเนาเก่าที่ไม่มีช่อง `returned`
 * ตู้กลางปลอมในเทสต์เดิมไม่รู้จักพฤติกรรมข้อหลังเลย จึงไม่เคยจับได้
 *
 * ของที่ส่ง "แก้แล้ว" มีทางของมันเองอยู่แล้ว คือคิวรายช่อง (flush) ซึ่งทนการปิดแท็บได้
 * ตัวนี้จึงเหลือหน้าที่เดียว: แถวที่ไม่เคยขึ้นตู้เลย ให้ขึ้นไป · แถวที่มีแล้วห้ามแตะ
 *   · `ignoreDuplicates` → ON CONFLICT DO NOTHING
 *   · `defaultToNull: false` → แถวใหม่ที่ไม่มีบางช่อง ได้ค่า default ของคอลัมน์ ไม่ใช่ NULL
 *     (ไม่งั้นช่อง NOT NULL ที่มี default ทำให้ทั้งก้อน 500 แถวตก)
 *
 * ⚠️ error ยังไม่ถูกอ่าน (เหมือนเดิม) — เครื่องนักศึกษาดันตาราง teachers / students ที่ตัวเอง
 *    ไม่มีสิทธิ์เขียนด้วย แล้วโดน RLS ปฏิเสธเป็นเรื่องปกติ · งานที่หายจริงถูกคิวรายช่องคุมอยู่แล้ว
 */
export async function pushAll(): Promise<void> {
  if (!supabase) return;
  for (const def of TABLES) {
    /* ส่งเฉพาะแถวที่การดึงครั้งล่าสุด "ไม่เห็นบนตู้" (ดู serverKeys)
       ผลพลอยได้: แถวที่คนอื่นเพิ่งลบบนตู้ระหว่างดึงกับส่ง ไม่ถูกเครื่องนี้ฟื้นกลับขึ้นไป */
    const onServer = serverKeys.get(def.local);
    const objs = ((await db.table(def.local).toArray()) as Record<string, unknown>[])
      .filter((o) => !onServer || !onServer.has(o[def.pk]));
    if (!objs.length) continue;
    // ชุดใหญ่แบ่งก้อนละ 500 กัน payload บวม
    for (let i = 0; i < objs.length; i += 500) {
      await supabase.from(def.remote).upsert(
        objs.slice(i, i + 500).map((o) => toRow(def, o)),
        { ignoreDuplicates: true, defaultToNull: false },
      );
    }
  }
}

/* ── realtime: ตู้กลางขยับ → ลิ้นชักเราขยับตาม ── */

function subscribeRealtime() {
  if (!supabase) return;
  supabase
    .channel('prostho-db')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      if (payload.table === 'app_settings') {
        void pullSettings(); // แถวเดียว ดึงใหม่ทั้งแถวง่ายกว่าแกะ payload
        return;
      }
      if (payload.table === 'pdpa_policy') {
        void pullPdpaPolicy();
        return;
      }
      const def = byRemote.get(payload.table);
      if (!def) return;
      const remotePk = def.rename?.[def.pk] ?? toSnake(def.pk);
      const key = ((payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>)[remotePk];
      if (key === undefined) return;
      /**
       * ⚠️ แถวที่เรายังส่งไม่ขึ้น ห้ามให้ของจากเซิร์ฟเวอร์ทับ
       *
       * pullAll กันไว้แล้ว (ตัวแปร skip) แต่ทาง realtime ไม่เคยกัน — ของที่ผู้ใช้เพิ่งกด
       * ยังรออยู่ในคิว 1.5 วิ ถ้ามี event ของแถวเดียวกันเข้ามาพอดี จะถูกเขียนทับทันที
       * แล้ว flush ก็จะส่งค่าที่โดนทับแล้วขึ้นไปอีก = สิ่งที่ผู้ใช้กดหายไปเงียบๆ
       * ปล่อยให้ flush ส่งของเราขึ้นก่อน แล้วค่อยรับของใหม่จากรอบถัดไป
       */
      if (dirty.get(def.local)?.has(key) || pendingDeletes.get(def.local)?.has(key)) return;
      // แถวที่ถูกกักคือฉบับในเครื่องที่ยังไม่ได้ขึ้นตู้ — เหตุผลเดียวกับตัวกัน skip ของ pullAll
      if (quarantine.has(keyOf(def.local, key))) return;
      void applyRemote(def.local, [key], async () => {
        if (payload.eventType === 'DELETE') await db.table(def.local).delete(key as never);
        else await db.table(def.local).put(fromRow(def, payload.new as Record<string, unknown>) as never);
      });
    })
    .subscribe();
}

/* ── จุดสตาร์ท ── */

let started = false;

/**
 * ผูกลิ้นชักในเครื่องเข้ากับบัญชีที่ล็อกอิน
 *
 * จำเป็นเพราะพอมี RLS รายแถวแล้ว "ลิ้นชักต้องเป็นกระจกสะท้อนสิ่งที่บัญชีนี้มีสิทธิ์เห็น" เท่านั้น
 * - ข้อมูลตัวอย่าง (fixture 96 คน) ที่ seed ไว้ ไม่ใช่ของเรา → ต้องล้างทิ้ง ไม่งั้น push ขึ้นไปก็โดนปฏิเสธ
 * - สลับบัญชีบนเครื่องเดียวกัน → ของคนก่อนต้องไม่ค้าง
 * ล้างเฉพาะตอน "บัญชีเปลี่ยน" — ล็อกอินคนเดิมซ้ำไม่ล้าง งานที่ทำค้างไว้ตอนออฟไลน์จึงไม่หาย
 */
/**
 * เลขรุ่นของ "กติกาสิทธิ์" — ขยับเลขนี้เมื่อ policy เปลี่ยนจนสิ่งที่แต่ละคนมองเห็นเปลี่ยนไป
 * ผลคือทุกเครื่องล้างลิ้นชักแล้วดึงใหม่ครั้งเดียว (ของเก่าที่ไม่มีสิทธิ์เห็นแล้วจะหายไปด้วย)
 * v2 = migration 0004 (per-row RLS: นศ. เห็นเฉพาะของตัวเอง)
 * v3 = 0021 (นศ. ไม่เห็น audit ของเพื่อนแล้ว) + 0024 (ขอบเขตอาจารย์ที่ปรึกษา) — แถวที่เคยดึงมาแล้วต้องถูกล้าง
 */
const POLICY_VERSION = 'v3';

async function bindToUser(uid: string): Promise<boolean> {
  const key = `${uid}@${POLICY_VERSION}`;
  const bound = await kvGet<string | null>('cloudBoundUid', null);
  if (bound === key) return false;
  setSyncPaused(true);
  try {
    for (const def of TABLES) await db.table(def.local).clear();
    // บัญชีใหม่ = ลิ้นชักถูกล้าง คิวของบัญชีก่อนหน้าจึงชี้ไปที่แถวที่ไม่มีอยู่แล้ว
    // ต้องล้างสำเนาในเครื่องด้วย ไม่ใช่แค่ในหน่วยความจำ ไม่งั้นรอบหน้าอ่านกลับมาแล้วส่งของคนอื่น
    await clearOutbox();
    lastPulled.clear();
    serverKeys.clear();
    quarantine.clear(); // ของที่กักไว้เป็นของบัญชีก่อนหน้า ไม่ใช่ของคนที่เพิ่งล็อกอิน
    patchFail.clear();  // ตัวนับชี้ไปแถวของบัญชีก่อนหน้าเหมือนกัน
  } finally {
    setSyncPaused(false);
  }
  await kvSet('cloudBoundUid', key);
  return true;
}

/**
 * รอบ 15 วิ + ผู้ฟัง online / visibilitychange / pagehide ของเซสชันที่ล็อกอินอยู่
 *
 * ต้องเก็บไว้ถอดตอนออกจากระบบ — เดิม stopCloudSync ไม่ถอด:
 * ออกจากระบบแล้วเครื่องยังยิงคำขอทุก 15 วิ และล็อกอินใหม่แต่ละครั้งเพิ่มรอบซ้อนอีกชุด
 * (iPad กลางคลินิกที่หลายคนสลับกันใช้ = ดึงถี่ขึ้นเรื่อยๆ ทั้งวัน)
 */
const loop: {
  timer: ReturnType<typeof setInterval> | null;
  online: (() => void) | null;
  visibility: (() => void) | null;
  pagehide: (() => void) | null;
} = { timer: null, online: null, visibility: null, pagehide: null };

function detachLoop(): void {
  if (loop.timer) clearInterval(loop.timer);
  if (loop.online) window.removeEventListener('online', loop.online);
  if (loop.visibility) document.removeEventListener('visibilitychange', loop.visibility);
  if (loop.pagehide) window.removeEventListener('pagehide', loop.pagehide);
  loop.timer = loop.online = loop.visibility = loop.pagehide = null;
}

/** เรียกครั้งเดียวตอนแอปเปิด (หลังล็อกอินสำเร็จ) — ไม่มีกุญแจ/ไม่ได้ล็อกอิน = ไม่ทำอะไรเลย */
export async function initCloudSync(): Promise<void> {
  if (!cloudEnabled || started) return;
  started = true;
  // สำเนานโยบายรอบก่อนจากเครื่อง — ให้หน้าจอวาดปุ่มส่งออกถูกตั้งแต่วินาทีแรก
  // ไม่มีสำเนา = ใช้ค่าที่ล็อกไว้ (ส่งออกไม่ได้) ซึ่งเป็นฝั่งที่ถูกต้องที่จะพลาด
  await loadCachedPolicy();
  try {
    const { data: auth } = await supabase!.auth.getUser();
    if (!auth.user) {
      started = false;
      return; // ยังไม่ล็อกอิน — ไม่แตะตู้กลาง
    }
    const freshBind = await bindToUser(auth.user.id);
    /* อ่านคิวของเซสชันก่อนกลับมา **ก่อน** pullAll รอบแรกเสมอ
       (bindToUser ล้างคิวให้แล้วถ้าเป็นบัญชีใหม่ — ตรงนี้จึงอ่านเฉพาะของบัญชีเดิม) */
    await restoreOutbox();

    const { count, error } = await supabase!.from('students').select('*', { count: 'exact', head: true });
    if (error) {
      // ตารางยังไม่ถูกสร้าง (migration ยังไม่รัน) หรือต่อไม่ได้ — เงียบไว้ แอปทำงาน local ต่อ
      started = false;
      return;
    }
    if ((count ?? 0) === 0 && !freshBind) {
      // ตู้กลางยังว่างจริงๆ (โปรเจกต์ใหม่) → ดันของในเครื่องขึ้นไปตั้งต้น
      // (โหมด cloud ไม่ seed ข้อมูลตัวอย่างลงเครื่อง จึงเป็นได้แค่งานจริงที่ทำไว้ก่อนตู้พร้อม)
      await pushAll();
    } else {
      /* ⚠️ ลำดับสำคัญ: ส่งของค้างขึ้นก่อน แล้วค่อยดึงลง — เหมือนรอบ 15 วิ
         ถ้าดึงก่อน ฉบับเก่าบนตู้จะทับงานที่ทำไว้ตอนออฟไลน์ (ซึ่ง pullAll กันไว้ด้วย skip
         แต่ส่งขึ้นก่อนได้ผลตรงกว่า: เซิร์ฟเวอร์ได้ของใหม่ แถวที่ดึงลงมาก็เป็นฉบับที่ถูกแล้ว) */
      if (!freshBind) await flush();
      await pullAll();
      // เพิ่งผูกบัญชีใหม่ = ลิ้นชักเพิ่งล้าง ไม่มีอะไรต้องดันขึ้น (และกันดัน fixture ของคนอื่น)
      if (!freshBind) await pushAll(); // ดันของท้องถิ่นที่ตู้ยังไม่มี (กันงานหายช่วงออฟไลน์)
    }
    subscribeRealtime();
    // polling สำรอง: ตารางที่ยังไม่ได้สมัคร realtime publication (0002) ก็ยังเห็นกันภายใน ~15 วิ
    // ลำดับสำคัญ: ดันของค้างขึ้นก่อนค่อยดึงลง — กันของที่เพิ่งพิมพ์ถูกฉบับเก่าบนตู้ทับ
    detachLoop(); // กันซ้อน — ปกติ stopCloudSync ถอดไปแล้ว
    loop.timer = setInterval(() => {
      void (async () => {
        await flush();
        await flushSettings();
        await runPumpHooks();
        await pullAll();
      })();
    }, 15_000);
    loop.online = () => void (async () => {
      await flush();
      await flushSettings();
      await runPumpHooks();
    })();
    window.addEventListener('online', loop.online);
    // เปิดจอ/สลับกลับมาที่แอป → sync ทันที (สำคัญกับมือถือที่พักหน้าจอบ่อย — ตอนพักเบราว์เซอร์หน่วง timer)
    loop.visibility = () => {
      if (!document.hidden) {
        void (async () => {
          await flush();
          await runPumpHooks();
          await pullAll();
        })();
      } else {
        // ซ่อนจอ = จังหวะที่มือถืออาจไม่กลับมาอีกเลย เขียนคิวลงเครื่องให้เสร็จก่อน
        void persistOutboxNow();
        void flush();
      }
    };
    document.addEventListener('visibilitychange', loop.visibility);
    /* ปิดแท็บ/สลับแอปบน iOS — pagehide คือ event สุดท้ายที่เชื่อถือได้
       (beforeunload ไม่ยิงบน iOS · unload ถูก browser รุ่นใหม่เลิกรองรับ)
       เขียนคิวลงเครื่องเป็นงานแรก แล้วค่อยพยายามส่ง — ถ้าแท็บตายกลางทางอย่างน้อยคิวอยู่รอด */
    loop.pagehide = () => {
      void persistOutboxNow();
      void flush();
    };
    window.addEventListener('pagehide', loop.pagehide);
  } catch {
    // ต่อตู้กลางไม่ได้ (เน็ตล่ม ฯลฯ) — แอปทำงาน local ต่อได้ปกติ
  }
}

/** ออกจากระบบ — ปลดสถานะ sync ให้ล็อกอินรอบหน้าเริ่มใหม่สะอาดๆ */
export function stopCloudSync(): void {
  started = false;
  detachLoop();
  // ตัวเขียนสำเนาคิวที่ค้างอยู่ต้องไม่ยิงหลังจากนี้ — ไม่งั้นเขียนคิวว่างทับสำเนาในเครื่อง
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  /* ล้างเฉพาะในหน่วยความจำ — **ห้ามล้างสำเนาในเครื่อง**
     ออกจากระบบแล้วเข้าใหม่ด้วยบัญชีเดิม งานที่ยังไม่ขึ้นต้องยังได้ส่ง
     (ถ้าเป็นบัญชีอื่น bindToUser จะล้างทั้งลิ้นชักและคิวให้เองตอนผูกใหม่)
     และต้องปลดธง restored ไม่งั้น init รอบหน้าจะคิดว่าอ่านคิวมาแล้วทั้งที่ยังไม่ได้อ่าน */
  dirty.clear();
  pendingDeletes.clear();
  outboxRestored = false;
  lastPulled.clear();
  serverKeys.clear();
  quarantine.clear();
  patchFail.clear();
  problemListeners.forEach((fn) => fn());
  supabase?.removeAllChannels();
}

/** รีเซ็ตในโหมด cloud = ล้างลิ้นชักแล้วดึงความจริงจากตู้กลางลงมาใหม่ (ไม่ seed ทับ) */
export async function cloudReset(): Promise<void> {
  setSyncPaused(true);
  try {
    for (const def of TABLES) await db.table(def.local).clear();
    // ลิ้นชักว่างแล้ว คิวที่ชี้ไปที่แถวที่ไม่มีอยู่จึงต้องหายไปด้วย (ทั้งในเครื่อง)
    await clearOutbox();
    lastPulled.clear(); // ไม่งั้นตัวเช็ค "ไม่มีอะไรใหม่" จะข้ามการดึงกลับ
    serverKeys.clear();
  } finally {
    setSyncPaused(false);
  }
  await pullAll();
}
