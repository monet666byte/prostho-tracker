import { useEffect, useState } from 'react';

/** จอโทรศัพท์ — เส้นเดียวกับ @media (max-width: 780px) ใน teacher.css ที่เปลี่ยนเลย์เอาต์ฝั่งอาจารย์ */
const PHONE_QUERY = '(max-width: 780px)';

export function usePhone(): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;
  const [phone, setPhone] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
