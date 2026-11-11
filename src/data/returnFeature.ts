import { useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '../lib/cloud';

/**
 * ปุ่ม "ขอให้แก้" คาบ ใช้คอลัมน์ใหม่ของ migration 0034 (return_* ในตาราง checkins)
 *
 * เซิร์ฟเวอร์ที่ยังไม่ได้รัน 0034 จะปฏิเสธแถวที่มีคอลัมน์พวกนี้ → แถวถูกกักในคิว ส่งไม่ขึ้น
 * จึงเช็คก่อนหนึ่งครั้งว่าคอลัมน์มีจริง แล้วค่อยโชว์ปุ่ม · โหมดในเครื่อง/เดโมไม่มีเซิร์ฟเวอร์ = ใช้ได้เลย
 * วิธีเดียวกับ waitFeature.ts (0033)
 */
let known: boolean | null = cloudEnabled ? null : true;
let inflight: Promise<boolean> | null = null;

function checkReturnColumns(): Promise<boolean> {
  if (known !== null) return Promise.resolve(known);
  if (!supabase) return Promise.resolve(false);
  inflight ??= (async () => {
    const { error } = await supabase.from('checkins').select('returned_at').limit(1);
    if (!error) known = true;
    else if (error.code === '42703' || error.code === 'PGRST204') known = false;
    inflight = null;
    return known ?? false;
  })();
  return inflight;
}

export function useReturnFeature(): boolean {
  const [ready, setReady] = useState(known ?? false);
  useEffect(() => {
    let alive = true;
    void checkReturnColumns().then((ok) => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, []);
  return ready;
}
