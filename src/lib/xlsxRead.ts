/**
 * อ่านไฟล์ Excel (.xlsx) เป็นตารางข้อความ — ใช้กับแบบฟอร์มขอรายชื่อจากภาคเท่านั้น (15 ก.ย. 69)
 *
 * ทำไมเขียนเอง ไม่ใช้ไลบรารี: `xlsx` บน npm ค้างที่รุ่นที่มีช่องโหว่ตอนอ่านไฟล์จากคนอื่น
 * ส่วนตัวอื่นลากแพ็กเกจที่ไม่รู้จักมาอีกหลายตัว — ไฟล์ที่เราอ่านมาจากภายนอก (ภาคส่งมา)
 * และเราต้องการแค่ "ข้อความในเซลล์" ไม่ต้องการสูตร/สไตล์/วันที่
 *
 * ขอบเขต: zip ธรรมดา (stored / deflate) · shared strings · inline strings · ตัวเลข · true/false
 * ไม่รองรับ: zip64 · ไฟล์ที่ตั้งรหัสผ่าน · .xls รุ่นเก่า — เจอแล้ว throw ข้อความไทยที่บอกว่าต้องทำอะไร
 * ไม่ใช้ DOMParser เพื่อให้เทสต์รันใน Node ได้ (XML ส่วนที่อ่านมีรูปแบบตายตัว)
 */

export interface SheetTable {
  name: string;
  /** แถว × คอลัมน์ · เซลล์ว่าง = '' · แถวว่างตรงกลางคงไว้ (เลขบรรทัดในรายงานจะได้ตรงกับ Excel) */
  rows: string[][];
}

const FAIL = 'อ่านไฟล์นี้ไม่ได้ — ต้องเป็นไฟล์ .xlsx จากแบบฟอร์มขอรายชื่อ (ถ้าเป็น .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx)';

/* ── zip ─────────────────────────────────────────────────────────────────── */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** คืนไฟล์ในซิปตามชื่อที่ขอ (อ่านเฉพาะที่ต้องใช้) */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(FAIL);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error(FAIL);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (flags & 1) throw new Error('ไฟล์นี้ตั้งรหัสผ่านไว้ — เปิดใน Excel แล้วเอารหัสผ่านออกก่อน');
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error(FAIL);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + compSize);
    if (method === 0) out.set(name, dec.decode(raw));
    else if (method === 8) out.set(name, dec.decode(await inflateRaw(raw)));
    else throw new Error(FAIL);
  }
  return out;
}

/* ── xml ─────────────────────────────────────────────────────────────────── */

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[k];
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : undefined;
}

/** ข้อความของ <si> หรือ <is> — รวมทุก <t> (ข้อความหลายสไตล์ในเซลล์เดียว) · ข้ามคำอ่าน (rPh) */
function runText(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => unescapeXml(m[1])).join('');
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1], 'r')) || nextRow + 1;
    nextRow = r;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = ref ? colIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = attr(cm[1], 't');
      const body = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = runText(body);
      else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) text = unescapeXml(v);
      /* ตัวเลขที่ Excel เก็บเป็น 6604001.0 / 56.000000001 — รหัสกับรุ่นเป็นจำนวนเต็มเสมอ */
      if ((type === undefined || type === 'n') && /^-?\d+\.\d+$/.test(text) && Math.abs(Number(text) - Math.round(Number(text))) < 1e-6) {
        text = String(Math.round(Number(text)));
      }
      while (cells.length < col) cells.push('');
      cells[col] = text.trim();
    }
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = cells;
  }
  return rows;
}

/** อ่านทุกแผ่นงานตามลำดับในไฟล์ */
export async function readXlsx(buf: ArrayBuffer): Promise<SheetTable[]> {
  const files = await unzip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels'
    || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error(FAIL);

  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const tg = attr(m[0], 'Target');
    if (id && tg) target.set(id, tg.startsWith('/') ? tg.slice(1) : `xl/${tg}`);
  }
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1]));

  const sheets: SheetTable[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? '';
    const rid = attr(m[0], 'r:id');
    const xml = rid ? files.get(target.get(rid) ?? '') : undefined;
    if (xml) sheets.push({ name, rows: readSheet(xml, shared) });
  }
  if (!sheets.length) throw new Error(FAIL);
  return sheets;
}

/** ตาราง → ข้อความคั่นแท็บ (รูปเดียวกับที่ก๊อปจาก Excel) ให้ตัวอ่านรายชื่อเดิมใช้ต่อได้เลย */
export function tableToTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}
