/**
 * ทดสอบ src/domain/group.ts — รันด้วย `npm run test:groups`
 *
 * ทำไมต้องมี: รหัสกลุ่มมีสองแบบปนกันในระบบเดียว
 *   ข้อมูลเดิม/ตัวอย่าง 'TH6-PT7' ตัวเลข = ชั้นปี
 *   รายชื่อที่นำเข้าจริง 'TH55-PT7' ตัวเลข = เลขรุ่น DTMU
 * ของเดิมมี groupYear() ที่แกะตัวเลขจากรหัสแล้วเรียกว่าชั้นปี พอเจอรหัสแบบที่สอง
 * มันอ่านได้ว่า "ชั้นปีที่ 55" แล้วส่งไปตั้งแท็บเริ่มต้นของหน้าอาจารย์
 * ยืนยันด้วยการรันจริง: หน้าขึ้น "ภาพรวมชั้นปีที่ 55 · 0 คน · 0 กลุ่ม" ทุกตัวเลขเป็นศูนย์
 *
 * ตอนนี้ชั้นปีมาจากสมาชิกเสมอ (studentYear) เทสต์นี้กันไม่ให้กลับไปแกะจากรหัสอีก
 */
import { groupShort, groupYearOf } from '../src/domain/group.ts';

/** ปีของกลุ่ม → แท็บเริ่มต้น (ต้องตรงกับ defaultYearView ใน Dashboard/Analytics) */
const tab = (y: number | undefined) => (y === 5 ? '5' : y === 6 ? '6' : 'all');

let bad = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra ? '  → ' + extra : ''));
  if (!cond) bad++;
};

// รุ่น 2569 ขึ้นคลินิกปีการศึกษา 2569 = ปี 5 ตลอด มิ.ย. 2026 – พ.ค. 2027
const thisYear = new Date('2026-10-01');
const nextYear = new Date('2027-10-01');
const y5 = (g: string) => ({ group: g, year: 5, entryYear: 2569 });
const y6 = (g: string) => ({ group: g, year: 6, entryYear: 2568 });

console.log('\nรหัสกลุ่มสองแบบต้องอ่านได้เหมือนกัน');
ok("'TH-PT7' (เดิม) → ปี 5", groupYearOf('TH-PT7', [y5('TH-PT7'), y5('TH-PT7')], thisYear) === 5);
ok("'TH6-PT7' (เดิม) → ปี 6", groupYearOf('TH6-PT7', [y6('TH6-PT7')], thisYear) === 6);
const g55 = groupYearOf('TH55-PT7', [y5('TH55-PT7'), y5('TH55-PT7')], thisYear);
ok("'TH55-PT7' (นำเข้าจริง) → ปี 5 ไม่ใช่ 55", g55 === 5, String(g55));
ok('แท็บเริ่มต้นเป็นค่าที่มีจริง', tab(g55) === '5', tab(g55));
ok('ชื่อย่อครอบทั้งสองแบบ', ['TH-PT7', 'TH6-PT7', 'TH55-PT7'].every((c) => groupShort(c) === 'PT7'));

console.log('\nขึ้นปีการศึกษาใหม่ กลุ่มเดิมต้องเลื่อนเองโดยรหัสไม่เปลี่ยน');
ok("'TH-PT7' ปีถัดมากลายเป็นปี 6", groupYearOf('TH-PT7', [y5('TH-PT7')], nextYear) === 6);
ok("'TH55-PT7' ปีถัดมาก็เลื่อนตาม", groupYearOf('TH55-PT7', [y5('TH55-PT7')], nextYear) === 6);

console.log('\nขอบที่เคยทำหน้าว่าง');
ok('ยังโหลดนักศึกษาไม่เสร็จ → รวมปี', tab(groupYearOf('TH-PT7', [], thisYear)) === 'all');
ok('อาจารย์ไม่ได้เป็นที่ปรึกษากลุ่มไหน → รวมปี', tab(groupYearOf(undefined, [y5('TH-PT7')], thisYear)) === 'all');
ok('กลุ่มรุ่นที่จบแล้ว → รวมปี ไม่ใช่ "ชั้นปีที่ 7"',
  tab(groupYearOf('TH7-PT1', [{ group: 'TH7-PT1', year: 6, entryYear: 2566 }], thisYear)) === 'all');
ok('กลุ่มมีคนซ้ำชั้นปน → เอาเสียงข้างมาก',
  groupYearOf('TH-PT7', [y5('TH-PT7'), y5('TH-PT7'), y6('TH-PT7')], thisYear) === 5);
ok('นับเฉพาะสมาชิกของกลุ่มนี้ ไม่ปนกลุ่มอื่น',
  groupYearOf('TH-PT7', [y5('TH-PT7'), y6('TH6-PT1'), y6('TH6-PT2')], thisYear) === 5);

console.log(bad ? `\n❌ ตก ${bad} ข้อ` : '\n✅ ผ่านหมด');
process.exit(bad ? 1 : 0);
