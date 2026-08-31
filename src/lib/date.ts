import { lang } from './i18n';

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

/** "25 ส.ค. 69" (พ.ศ.) / โหมดอังกฤษ "25 Aug 26" (ค.ศ.) — รูปแบบที่ใช้ในการ์ดและตาราง */
export function thaiShort(v: string | Date): string {
  const d = asDate(v);
  if (lang === 'en') return `${d.getDate()} ${EN_MONTHS[d.getMonth()]} ${String(d.getFullYear() % 100).padStart(2, '0')}`;
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${String((d.getFullYear() + 543) % 100).padStart(2, '0')}`;
}

/** "28 ส.ค. 2569" / "28 Aug 2026" — รูปแบบเต็มสำหรับรอบส่งรายงาน */
export function thaiLong(v: string | Date): string {
  const d = asDate(v);
  if (lang === 'en') return `${d.getDate()} ${EN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** "14:32" */
export function clock(v: string | Date): string {
  const d = asDate(v);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "เมื่อครู่" / "3 ชม.ที่แล้ว" / "2 วันที่แล้ว" */
export function relative(v: string | Date, now = new Date()): string {
  const diff = now.getTime() - asDate(v).getTime();
  const min = Math.floor(diff / 60_000);
  const en = lang === 'en';
  if (min < 2) return en ? 'just now' : 'เมื่อครู่';
  if (min < 60) return en ? `${min} min ago` : `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return en ? `${hr} hr ago` : `${hr} ชม.ที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day === 1) return en ? 'yesterday' : 'เมื่อวาน';
  return en ? `${day} days ago` : `${day} วันที่แล้ว`;
}

/** จำนวนวันจากวันนี้ถึงวันที่กำหนด (ลบ = เลยกำหนดแล้ว) */
export function daysUntil(v: string | Date, now = new Date()): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d = asDate(v);
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function toISODate(v: string | Date): string {
  const d = asDate(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


/** จันทร์ของสัปดาห์ที่วันนั้นอยู่ — ใช้เป็นคีย์นับ "สัปดาห์ที่มาคลินิก" (เวลาท้องถิ่น ห้ามใช้ toISOString เพราะ UTC เลื่อนวัน) */
export function weekMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00`);
  const day = (d.getDay() + 6) % 7; // จันทร์ = 0
  d.setDate(d.getDate() - day);
  return toISODate(d);
}

/** ISO date → "25/8/69" สำหรับ CSV ที่ต้องตรงคอลัมน์ชีตเดิม */
export function toSheetDate(v: string | Date): string {
  const d = asDate(v);
  return `${d.getDate()}/${d.getMonth() + 1}/${String((d.getFullYear() + 543) % 100).padStart(2, '0')}`;
}

/**
 * ปีการศึกษา (พ.ศ.) — เริ่มเดือนมิถุนายน
 * ส.ค. 2026 → 2569 · ก.พ. 2027 → 2569 (ยังอยู่ปีการศึกษาเดิม) · มิ.ย. 2027 → 2570
 */
export function academicYear(v: string | Date): number {
  const d = asDate(v);
  const be = d.getFullYear() + 543;
  return d.getMonth() >= 5 ? be : be - 1;
}
