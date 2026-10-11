import { ArrowsClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { lastPullAt, pullAll } from '../../data/cloudSync';
import { cloudEnabled } from '../../lib/cloud';
import { relative } from '../../lib/date';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

/** ดึงล่าสุดนานกว่านี้ = ขึ้นสีส้ม + ปุ่มซิงก์ · การ์ดวันนี้ยังเตือนเต็มบรรทัดที่ 12 ชม. เหมือนเดิม */
const OLD_AFTER_MS = 60 * 60 * 1000;

/**
 * บรรทัด "ข้อมูล ณ …" — บอกว่าตัวเลขบนจอมาจากการดึงรอบไหน (หัวโซนหน้าแรก + ท้ายลิ้นชักที่มาของตัวเลข)
 * นับจากรอบที่ดึงครบทุกตารางจริงเท่านั้น (cloudSync.lastPullAt) · โหมดไม่ต่อเซิร์ฟเวอร์บอกตรงๆ ว่าเป็นข้อมูลในเครื่อง
 */
export function DataAge() {
  const showToast = useApp((st) => st.showToast);
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!cloudEnabled) {
    return <span className="dataage">{t('ข้อมูลในเครื่องนี้ · ไม่ได้ต่อเซิร์ฟเวอร์')}</span>;
  }

  const at = lastPullAt();
  const old = at === null || Date.now() - at >= OLD_AFTER_MS;
  const sync = async () => {
    setBusy(true);
    await pullAll();
    setBusy(false);
    setTick((n) => n + 1);
    const ok = lastPullAt() !== null && Date.now() - (lastPullAt() as number) < 60_000;
    showToast(ok
      ? { message: t('ข้อมูลล่าสุดแล้ว'), tone: 'success' }
      : { message: t('ยังดึงข้อมูลไม่ครบ — ลองใหม่เมื่อเน็ตกลับมา'), tone: 'warning' });
  };

  return (
    <span className="dataage" data-old={old}>
      <i aria-hidden />
      {at === null
        ? t('ยังดึงข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ')
        : t('ข้อมูล ณ {time} · {ago}', {
            time: new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
            ago: relative(new Date(at)),
          })}
      {old && (
        <button className="dataage__sync" onClick={() => void sync()} disabled={busy}>
          <ArrowsClockwise size={11} weight="bold" aria-hidden /> {busy ? t('กำลังดึง…') : t('ซิงก์เลย')}
        </button>
      )}
    </span>
  );
}
