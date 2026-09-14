/**
 * ระบบสองภาษา ไทย/อังกฤษ — ศัพท์อังกฤษอิงตามสมุดจริง
 * "Clinical Performance Portfolio — Clinical rotation assessment logbook"
 *
 * วิธีใช้: ห่อข้อความไทยด้วย t('ข้อความไทย') — โหมดไทยคืนค่าเดิม
 * โหมดอังกฤษเปิดพจนานุกรมใน i18n.dict.ts (ไม่เจอ = คืนไทยไว้ก่อน จะได้เห็นว่ายังแปลไม่ครบ)
 * สลับภาษาแล้วรีโหลดหน้า — ง่ายและชัวร์กว่าไล่ re-render ทุกจุด
 */
export type Lang = 'th' | 'en';

export const LANG_KEY = 'pt-lang';

export function currentLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
}

/** ภาษา ณ ตอนโหลดหน้า — คงที่ทั้งเซสชันจนกว่าจะสลับ (ซึ่งรีโหลด) */
export const lang: Lang = currentLang();

/**
 * พจนานุกรมหนัก 62 KB และโหมดไทยไม่ได้เปิดอ่านสักคำ (t() คืนคีย์เดิม)
 * เพราะภาษาคงที่ทั้งเซสชัน (สลับแล้วรีโหลด) จึงตัดสินตรงนี้ครั้งเดียวได้เลย
 *
 * ใช้ await ระดับบนสุดเพื่อให้พจนานุกรมมาถึงก่อนโมดูลอื่นเริ่มทำงาน —
 * หลายไฟล์เรียก t() ตั้งแต่ตอน import (เช่นตาราง NAV ใน Shell)
 * ถ้าโหลดแบบไม่รอ ผู้ใช้อังกฤษจะเห็นเมนูเป็นไทยค้างอยู่
 */
const DICT: Record<string, string> = lang === 'en' ? (await import('./i18n.dict')).DICT : {};

export function setLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* private mode */
  }
  window.location.reload();
}

const TH_LETTER_LATIN: Record<string, string> = {
  'ก': 'A', 'ข': 'B', 'ค': 'C', 'ง': 'D', 'จ': 'E', 'ฉ': 'F', 'ช': 'G', 'ซ': 'H', 'ฌ': 'I', 'ญ': 'J', 'ฎ': 'K', 'ฏ': 'L',
};

/** ชื่อสมมติในซีดสร้างจากพยัญชนะไทย ("นศ. ช", "อ. ข.", "ผู้ป่วย C") — แปลงตามแพตเทิร์นแทนการไล่ใส่พจนานุกรม */
function trMockName(s: string): string | null {
  const m = s.match(/^(นศ\.|อ\.|ผู้ป่วย)\s*(\S+?)\.?$/);
  if (!m) return null;
  const letter = TH_LETTER_LATIN[m[2]] ?? m[2];
  const prefix = m[1] === 'นศ.' ? 'Student' : m[1] === 'อ.' ? 'Instr.' : 'Patient';
  return `${prefix} ${letter}`;
}

/** แปลข้อความ + แทนค่า {ตัวแปร} เช่น t('เหลืออีก {n} ชิ้น', { n: 2 }) */
export function t(s: string, params?: Record<string, string | number>): string {
  let out = lang === 'en' ? (DICT[s] ?? trMockName(s) ?? s) : s;
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/**
 * ชื่อคน (นักศึกษา / อาจารย์) ตามภาษาที่เลือก — ใช้แทน t(x.name) ทุกที่ที่ "แสดง" ชื่อ
 * โหมดอังกฤษ: ชื่ออังกฤษถ้ามี · ไม่มีก็ใช้ชื่อไทย (ผ่าน t() เพื่อให้ชื่อสมมติในเดโมยังแปลได้)
 * ⚠️ ห้ามใช้กับข้อความที่ "เก็บ" (audit · ชื่อผู้ประเมิน) — ของที่เก็บใช้ name ไทยเสมอ
 */
export function personName(p: { name: string; nameEn?: string | null } | null | undefined, fallback = ''): string {
  if (!p) return t(fallback);
  if (lang === 'en') return p.nameEn?.trim() || t(p.name);
  return p.name;
}

let sortedKeys: string[] | null = null;

/**
 * แปลข้อความ "ผสม" ที่ประกอบจากข้อมูล เช่น detail ของชิ้นงาน "CD/- (Upper) (ไม่เหลือฟันแม้แต่ซี่เดียว)"
 * — หาท่อนไทยที่รู้จักในพจนานุกรมแล้วแทนที่ทีละท่อน (ยาวก่อนสั้น, ข้ามคีย์สั้นกว่า 4 ตัวกันแทนผิด)
 */
export function tText(s: string): string {
  if (lang !== 'en' || !s) return s;
  if (DICT[s]) return DICT[s];
  if (!sortedKeys) sortedKeys = Object.keys(DICT).sort((a, b) => b.length - a.length);
  let out = s;
  for (const k of sortedKeys) {
    if (k.length < 4) continue;
    if (out.includes(k)) out = out.split(k).join(DICT[k]);
  }
  return out;
}

/** เพศ/อายุจากชีต เช่น "ญ 68 ปี" → "F 68 yr" */
export function tSexAge(s: string): string {
  if (lang !== 'en' || !s) return s;
  return s.replace('ญ', 'F').replace('ช', 'M').replace('ปี', 'yr').replace('ไม่ระบุ', 'N/A');
}
