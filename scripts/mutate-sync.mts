/**
 * "เทสต์จับบั๊กได้จริงไหม" — ใส่บั๊กลง src/data/cloudSync.ts ทีละจุด แล้วรันชุดเทสต์ sync
 * รันด้วย `npm run mutate:sync` (ช้า ~10–20 นาที · ไม่อยู่ใน `npm test`)
 *
 * ทำไมต้องมี (13 ก.ย. 69): ทุกชุดใน npm test ผ่าน บอกได้แค่ว่า "โค้ดตอนนี้ไม่ขัดกับเทสต์"
 * ไม่ได้บอกว่าถ้ามีคนแก้พลาดวันหน้า เทสต์จะร้องไหม · บั๊กแต่ละจุดในรายการนี้คือ
 * **บั๊กที่เคยเกิดจริงหรือเกือบเกิด** ในโปรเจกต์นี้ (ดูคอมเมนต์ใน cloudSync.ts ตรงจุดนั้น)
 * ถ้าใส่กลับเข้าไปแล้วเทสต์ยังเขียวหมด = ตาข่ายมีรู · บั๊กตัวนั้นกลับมาได้โดยไม่มีใครรู้
 *
 * ⚠️ แก้ไฟล์ต้นฉบับจริงชั่วคราว (ชุดเทสต์ก๊อปจาก path นี้) · คืนไฟล์เดิมเสมอ ทั้งตอนจบ ตอนล้ม และตอนกด Ctrl+C
 *    ห้ามแก้ cloudSync.ts ในหน้าต่างอื่นระหว่างที่รัน
 *
 * `npm run mutate:sync -- M12 M20` = รันเฉพาะบางตัว
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FILE = join(root, 'src/data/cloudSync.ts');
const ORIGINAL = readFileSync(FILE, 'utf8');
const restore = () => writeFileSync(FILE, ORIGINAL);
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130); });

/** เร็วก่อน — ชุดแรกที่ตกก็พอรู้ว่าจับได้ ไม่ต้องรันที่เหลือ */
const SUITES = ['test-sync-gaps', 'test-sync-button', 'test-conflict', 'test-offline', 'test-clinic-day', 'test-sync-pg', 'test-photo-storage'];

/** `layered` = มีด่านถัดไปรับไว้ ใส่บั๊กจุดเดียวแล้วผลที่ผู้ใช้เห็นไม่เปลี่ยน (เสียแค่เน็ต/คำขอ)
 *  ตรวจแล้วตอนรันครั้งแรก 13 ก.ย. 69 · ไม่นับเป็นรู แต่ถ้าวันหนึ่งด่านถัดไปถูกเอาออก ต้องมาเขียนเทสต์ */
interface Mutant { id: string; what: string; find: string; replace: string; layered?: string }
const M: Mutant[] = [
  { id: 'M01', what: 'รวมคิว: แถวใหม่ (ทั้งแถว) ถูกกลืนเป็นรายช่อง', find: 'if (prev === null || next === null) return null;', replace: 'if (prev === null) return null;', layered: 'ช่องที่ส่งไม่ครบจะ PATCH ไม่โดนแถว → ถอยไปส่งทั้งแถวเอง · ตอนนี้ restoreOutbox วิ่งตอนคิวยังว่างเสมอ' },
  { id: 'M02', what: 'แถวใหม่ถูกส่งแบบ PATCH แทนทั้งแถว', find: 'if (!before) return null; // แถวใหม่', replace: 'if (!before) return new Set(Object.keys(after)); // แถวใหม่', layered: 'PATCH แถวที่ตู้ยังไม่มี = ไม่โดนอะไร → ถอยไป upsert ทั้งแถว (เสียคำขอเพิ่มหนึ่งครั้ง)' },
  { id: 'M03', what: 'ช่องที่ถูกลบค่า (หายจากฉบับใหม่) ไม่นับว่าแก้', find: 'for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {', replace: 'for (const k of new Set(Object.keys(after))) {' },
  { id: 'M04', what: 'คิวไม่ถูกเขียนลงดิสก์ตอนโต', find: '    m.set(k, mergeFields(m.get(k), fields));\n  }\n  persistOutboxSoon();', replace: '    m.set(k, mergeFields(m.get(k), fields));\n  }' },
  { id: 'M05', what: 'ของที่กำลังรับจากตู้ถูกส่งกลับขึ้นไป (echo)', find: 'if (k === undefined || applyingKeys.has(keyOf(local, k))) continue;', replace: 'if (k === undefined) continue;' },
  { id: 'M06', what: 'อ่านฉบับเดิมไม่ได้ → ถือว่าไม่มีอะไรแก้', find: 'before = keys.map(() => undefined);', replace: 'before = values;' },
  { id: 'M07', what: 'การลบในเครื่องไม่เข้าคิว', find: '                markDelete(name, req.keys as unknown[]);', replace: '' },
  { id: 'M08', what: 'ตัวลบ: ส่งไม่ผ่านก็ล้างคิวทิ้ง', find: '    if (!error) {\n      deleteFail.delete(local);', replace: '    {\n      deleteFail.delete(local);' },
  { id: 'M09', what: 'ตัวลบ: ล้างทั้งชุด รวมคีย์ที่เพิ่งเข้าคิวระหว่างรอเน็ต', find: 'sent.forEach((k) => keys.delete(k));', replace: 'keys.clear();' },
  { id: 'M10', what: 'ส่งรายช่องเสร็จ → ลบทั้งแถว (ช่องที่แก้ระหว่างรอเน็ตหาย)', find: '      for (const f of sentFields) now.delete(f);\n      if (now.size === 0) m.delete(pk);', replace: '      m.delete(pk);' },
  { id: 'M11', what: 'PATCH: เน็ตหลุดนับเป็นการปฏิเสธ (ถูกกัก)', find: '        if (!isRefusal(res.error)) continue;\n        const fk', replace: '        const fk' },
  { id: 'M12', what: 'PATCH: ถูกปฏิเสธแล้ววนส่งตลอดกาล ไม่กัก', find: '        if (n < MAX_PUSH_RETRY) { patchFail.set(fk, n); continue; }', replace: '        patchFail.set(fk, n); continue;' },
  { id: 'M13', what: 'PATCH ไม่โดนแถวไหน (ตู้ไม่มีแถว) → ถือว่าส่งแล้ว', find: 'if ((res.data?.length ?? 0) > 0) { patched.push([pk, fields]); continue; }', replace: '{ patched.push([pk, fields]); continue; }' },
  { id: 'M14', what: 'ส่งทั้งแถวแบบก้อน: ช่องที่ไม่มีกลายเป็น NULL', find: "objs.map((o) => toRow(def, o)), { defaultToNull: false },\n    );\n    if (!error) {", replace: "objs.map((o) => toRow(def, o)),\n    );\n    if (!error) {" },
  { id: 'M15', what: 'ก้อนทั้งแถว: เน็ตหลุดนับรอบ (ครบ 3 = กัก)', find: '    if (!isRefusal(error)) continue;\n    const n = (failCount', replace: '    const n = (failCount', layered: 'ก้อนที่ตกครบ 3 รอบจะแยกส่งรายแถว ซึ่งยังเช็ค isRefusal ของตัวเอง (M16) → เน็ตหลุดไม่ถูกกัก' },
  { id: 'M16', what: 'ก้อนทั้งแถว: ส่งรายแถวแล้วเน็ตหลุดก็กัก', find: 'if (one.error && !isRefusal(one.error)) continue;', replace: '', layered: 'ก้อนที่เน็ตหลุดไม่เคยมาถึงการแยกส่งรายแถว เพราะด่าน M15 continue ไปก่อน' },
  { id: 'M17', what: 'isRefusal: ทุก error คือการปฏิเสธ', find: "return /^[0-9A-Z]{5}$/.test(c) || /^PGRST\\d+$/.test(c);", replace: 'return true;' },
  { id: 'M18', what: 'isRefusal: ไม่มีอะไรเป็นการปฏิเสธ', find: "return /^[0-9A-Z]{5}$/.test(c) || /^PGRST\\d+$/.test(c);", replace: 'return false && !!c;' },
  { id: 'M19', what: 'กด "ลองส่งใหม่" แต่ตัวนับ PATCH ไม่ถูกล้าง', find: '  patchFail.clear(); // ไม่ล้าง', replace: '  // ไม่ล้าง', layered: 'แถวที่ถูกกักถูก patchFail.delete ไปแล้วตั้งแต่ตอนกัก — clear ตอนลองใหม่จึงซ้ำซ้อน' },
  { id: 'M20', what: 'คิวรุ่นเก่า (v1) อ่านแล้วทิ้ง', find: '            m.set(row, null);\n          }', replace: '            continue;\n          }' },
  { id: 'M21', what: 'ไม่อ่านคิวจากดิสก์ก่อน pull ครั้งแรก', find: '    await restoreOutbox();\n\n    const { count, error }', replace: '\n    const { count, error }' },
  { id: 'M22', what: 'pull ทับแถวที่ยังค้างส่ง', find: '      ...(dirty.get(def.local)?.keys() ?? []),\n', replace: '' },
  { id: 'M23', what: 'pull ทับแถวที่ถูกกัก', find: '      ...[...quarantine.values()].filter((q) => q.table === def.local).map((q) => q.key),\n', replace: '' },
  { id: 'M24', what: 'pull ดึงแค่หน้าแรก 1,000 แถว', find: 'if ((page.data?.length ?? 0) < PAGE) break;', replace: 'break;' },
  { id: 'M25', what: 'ตราเวลาอนาคตทำให้หยุดดึง', find: 'const stampIsSane = remoteMax && remoteMax <= new Date().toISOString();', replace: 'const stampIsSane = remoteMax;' },
  { id: 'M26', what: 'pushAll ส่งทุกแถวที่ตู้มีแล้ว', find: '.filter((o) => !onServer || !onServer.has(o[def.pk]));', replace: ';' },
  { id: 'M27', what: 'pushAll เขียนทับแถวบนตู้ (merge แทน do nothing)', find: '{ ignoreDuplicates: true, defaultToNull: false },\n      );\n    }\n  }\n}', replace: '{ defaultToNull: false },\n      );\n    }\n  }\n}' },
  { id: 'M28', what: 'สลับบัญชีแล้วคิวของคนก่อนไม่ถูกล้าง', find: '    await clearOutbox();\n    lastPulled.clear();\n    serverKeys.clear();', replace: '    lastPulled.clear();\n    serverKeys.clear();' },
  { id: 'M29', what: 'ออกจากระบบแล้วเข้าใหม่ ไม่อ่านคิวซ้ำ', find: '  outboxRestored = false;\n  lastPulled.clear();', replace: '  lastPulled.clear();' },
  { id: 'M30', what: 'pushAll ลืมว่าตู้มีอะไร: serverKeys ไม่ถูกบันทึกหลังดึงทั้งตาราง', find: 'else serverKeys.set(def.local, new Set(data.map((r) => r[remotePkCol])));', replace: 'else {}' },
  { id: 'M31', what: 'หยุด sync ซ้อนกัน: งานแรกจบแล้วปลดทั้งหมด', find: 'pauseDepth = Math.max(0, pauseDepth + (v ? 1 : -1));', replace: 'pauseDepth = v ? 1 : 0;' },
  { id: 'M32', what: 'ก้อนทั้งแถวถูกปฏิเสธครั้งแรกก็แยกกักทันที', find: '    if (n < MAX_PUSH_RETRY) continue; // ปฏิเสธรอบเดียว', replace: '    // ปฏิเสธรอบเดียว' },
  { id: 'M33', what: 'PATCH ส่งทั้งแถวแทนเฉพาะช่อง', find: '      const patch = toRowFields(def, obj, fields);', replace: '      const patch = toRow(def, obj);' },
  { id: 'M34', what: 'ส่งตราเวลาของเครื่องขึ้นตู้', find: "    if (k === 'updated_at' || k === 'updatedAt') continue;\n    row[def.rename?.[k] ?? toSnake(k)] = v === undefined ? null : v;\n  }\n  return row;\n}\n\n/**\n * แปลงเฉพาะ", replace: "    row[def.rename?.[k] ?? toSnake(k)] = v === undefined ? null : v;\n  }\n  return row;\n}\n\n/**\n * แปลงเฉพาะ", layered: 'trigger zz_touch_updated_at (0017) เขียนทับตราเวลาทุกแถวที่เข้าตู้ · toRow ตัดทิ้งเป็นด่านแรก' },
  { id: 'M35', what: 'ค่าว่างจากตู้ (null) เก็บเป็น null แทน undefined', find: 'obj[localKey] = v === null ? undefined : v;', replace: 'obj[localKey] = v;' },
  { id: 'M37', what: 'ดึงเฉพาะที่ขยับ: ไม่เผื่อแถวที่ commit ช้า', find: 'new Date(sinceMs - PULL_OVERLAP_MS)', replace: 'new Date(sinceMs)' },
  { id: 'M38', what: 'กลุ่ม/รายชื่อขยับแล้วไม่ดึงทั้งตาราง', find: "if (incremental && data.length && (def.local === 'students' || def.local === 'groups')) scopeChanged = true;", replace: '' },
  { id: 'M39', what: 'เชื่อตราเวลาอนาคตในการดึงเฉพาะที่ขยับ', find: 'const incremental = !!(stampIsSane && known &&', replace: 'const incremental = !!(known &&' },
  { id: 'M40', what: 'pullAll วิ่งซ้อนกันได้', find: 'export function pullAll(): Promise<void> {\n  if (pullQueued) return pullQueued;', replace: 'export function pullAll(): Promise<void> {\n  if (Math.random() < 2) return pullAllOnce();' },
  { id: 'M41', what: 'แถวที่ดึงแบบเฉพาะที่ขยับ ไม่ถูกจำว่าอยู่บนตู้', find: 'if (incremental) data.forEach((r) => known!.add(r[remotePkCol]));', replace: '' },
  { id: 'M42', what: 'ตัวลบ: ตู้ปฏิเสธแล้ววนลบตลอดกาล ไม่บอกผู้ใช้', find: '    if (n < MAX_PUSH_RETRY) { deleteFail.set(local, n); continue; }', replace: '    deleteFail.set(local, n); continue;' },
  { id: 'M43', what: 'ตัวลบ: เน็ตหลุดนับเป็นการปฏิเสธ', find: '    if (!isRefusal(error)) continue;\n    const n = (deleteFail', replace: '    const n = (deleteFail', layered: 'ครบโควตาแล้วแยกลบทีละแถว ซึ่งเช็ค isRefusal ของตัวเอง → เน็ตหลุดยังคาอยู่ในคิว ไม่ถูกแจ้งเป็นปัญหา' },
  { id: 'M44', what: 'ตัวลบ: แถวที่ตู้ไม่ยอมให้ลบ ไม่ถูกดึงกลับลงเครื่อง', find: '  if (row) {\n    await applyRemote(def.local, [pk], async () => {', replace: '  if (row && Math.random() > 2) {\n    await applyRemote(def.local, [pk], async () => {' },
  { id: 'M45', what: 'แถวที่ดึงกลับหลังลบไม่ผ่าน ถูกแช่แข็งเหมือนแถวที่ถูกกัก', find: "return !!q && q.kind !== 'delete';", replace: 'return !!q;' },
  { id: 'M36', what: 'realtime ทับแถวที่ยังค้างส่ง', find: '      if (dirty.get(def.local)?.has(key) || pendingDeletes.get(def.local)?.has(key)) return;', replace: '' },
];

function run(suite: string): Promise<boolean> {
  return new Promise((ok) => {
    const child = spawn('npx', ['--yes', 'tsx', join(root, 'scripts', suite + '.mts')], { cwd: root, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); ok(false); }, 240_000); // ค้าง = ถือว่าจับได้ (เทสต์ไม่เขียว)
    child.on('close', (code) => { clearTimeout(timer); ok(code === 0); });
  });
}

const only = process.argv.slice(2);
const list = M.filter((m) => !only.length || only.includes(m.id));

if (process.env.DRY) {
  for (const m of list) console.log(m.id, ORIGINAL.split(m.find).length - 1);
  process.exit(0);
}

console.log('ตัวคุม: โค้ดจริงต้องผ่านทุกชุดก่อน…');
for (const s of SUITES) {
  if (!(await run(s))) { console.log(`❌ ${s} ตกตั้งแต่ยังไม่ใส่บั๊ก — แก้ให้เขียวก่อน`); process.exit(1); }
}

const survivors: Mutant[] = [];
for (const m of list) {
  const hits = ORIGINAL.split(m.find).length - 1;
  if (hits !== 1) { console.log(`⚠️  ${m.id} หาจุดที่จะใส่ไม่เจอ/เจอหลายที่ (${hits}) — โค้ดเปลี่ยนแล้ว แก้รายการนี้`); survivors.push(m); continue; }
  writeFileSync(FILE, ORIGINAL.replace(m.find, m.replace));
  let caughtBy = '';
  for (const s of SUITES) {
    if (!(await run(s))) { caughtBy = s; break; }
  }
  restore();
  if (caughtBy) console.log(`✅ ${m.id} จับได้ (${caughtBy}) · ${m.what}`);
  else if (m.layered) console.log(`➖ ${m.id} รอด แต่มีด่านซ้อน · ${m.what} — ${m.layered}`);
  else { console.log(`❌ ${m.id} รอด! · ${m.what}`); survivors.push(m); }
}

console.log(`\nรูในตาข่าย ${survivors.length} จุด จาก ${list.length}`);
if (survivors.length) console.log('รูในตาข่าย:\n' + survivors.map((m) => `  ${m.id} ${m.what}`).join('\n'));
process.exit(survivors.length ? 1 : 0);
