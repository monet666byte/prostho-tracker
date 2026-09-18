import { addCheckIn, type CheckInInput } from '../../data/repo';
import { checkInStamp } from '../../domain/checkin';

/**
 * เช็คอิน "ตอนนี้" — ทุกปุ่มเช็คอินฝั่งนักศึกษา (เช็คอินด่วน · แผ่นถามบนหน้าแรก · ฟอร์มหน้าคาบ) เรียกตัวนี้
 * เวลาเช็คอิน = เวลาระบบตอนกด แก้เองไม่ได้ — เกณฑ์ตรงเวลา/สายอยู่ที่ domain/checkin.ts ที่เดียว
 * คืนตราเวลากลับไปด้วย เพราะข้อความยืนยันบนหน้าแรกต้องบอกเวลาที่ประทับ
 */
export async function checkInNow(input: Omit<CheckInInput, 'checkinAt' | 'punctual'>): Promise<{ checkinAt: string; punctual: boolean }> {
  const stamp = checkInStamp();
  await addCheckIn({ ...input, ...stamp });
  return stamp;
}
