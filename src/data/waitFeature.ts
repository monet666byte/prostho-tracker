import { useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '../lib/cloud';

/**
 * ปุ่ม "รอคนไข้" ใช้คอลัมน์ใหม่ของ migration 0033 (wait_reason · wait_until · wait_since ในตาราง workpieces)
 *
 * เซิร์ฟเวอร์ที่ยังไม่ได้รัน 0033 จะปฏิเสธแถวที่มีคอลัมน์พวกนี้ → แถวถูกกักในคิว ส่งไม่ขึ้น
 * จึงเช็คก่อนหนึ่งครั้งว่าคอลัมน์มีจริง แล้วค่อยโชว์ปุ่ม · โหมดในเครื่อง/เดโมไม่มีเซิร์ฟเวอร์ = ใช้ได้เลย
 * เช็คไม่ผ่านเพราะเน็ต (ไม่ใช่เพราะไม่มีคอลัมน์) = ยังไม่จำผล เปิดหน้าใหม่ค่อยลองอีกรอบ
 */
let known: boolean | null = cloudEnabled ? null : true;
let inflight: Promise<boolean> | null = null;

function checkWaitColumns(): Promise<boolean> {
  if (known !== null) return Promise.resolve(known);
  if (!supabase) return Promise.resolve(false);
  inflight ??= (async () => {
    const { error } = await supabase.from('workpieces').select('wait_reason').limit(1);
    if (!error) known = true;
    else if (error.code === '42703' || error.code === 'PGRST204') known = false;
    inflight = null;
    return known ?? false;
  })();
  return inflight;
}

export function useWaitFeature(): boolean {
  const [ready, setReady] = useState(known ?? false);
  useEffect(() => {
    let alive = true;
    void checkWaitColumns().then((ok) => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, []);
  return ready;
}
