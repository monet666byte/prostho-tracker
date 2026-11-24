import { useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '../lib/cloud';

/**
 * ปุ่ม "ยังไม่เสร็จ" ใช้คอลัมน์ใหม่ checkins.wip ของ migration 0035
 *
 * เซิร์ฟเวอร์ที่ยังไม่ได้รัน 0035 จะปฏิเสธแถวคาบที่มีช่อง wip → คาบนั้นถูกกักในคิว ส่งไม่ขึ้น
 * จึงเช็คก่อนหนึ่งครั้งว่าคอลัมน์มีจริง แล้วค่อยโชว์ปุ่ม · โหมดในเครื่อง/เดโมไม่มีเซิร์ฟเวอร์ = ใช้ได้เลย
 * วิธีเดียวกับ returnFeature.ts (0034)
 */
let known: boolean | null = cloudEnabled ? null : true;
let inflight: Promise<boolean> | null = null;

function checkWipColumn(): Promise<boolean> {
  if (known !== null) return Promise.resolve(known);
  if (!supabase) return Promise.resolve(false);
  inflight ??= (async () => {
    const { error } = await supabase.from('checkins').select('wip').limit(1);
    if (!error) known = true;
    else if (error.code === '42703' || error.code === 'PGRST204') known = false;
    inflight = null;
    return known ?? false;
  })();
  return inflight;
}

/** ชั้นข้อมูลใช้ตัวนี้ — ยังไม่รู้ผล = ถือว่ายังใช้ไม่ได้ (ไม่เขียนช่อง wip) */
export function wipReady(): Promise<boolean> {
  return checkWipColumn();
}

export function useWipFeature(): boolean {
  const [ready, setReady] = useState(known ?? false);
  useEffect(() => {
    let alive = true;
    void checkWipColumn().then((ok) => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, []);
  return ready;
}
