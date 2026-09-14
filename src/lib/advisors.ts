/**
 * อาจารย์ที่ปรึกษาของกลุ่ม (0024_group_advisors.sql)
 *
 * อาจารย์เลือกเอง / ถอนตัวเอง · หัวหน้าภาคตั้งให้ได้ทุกกลุ่ม — ทุกอย่างผ่านฟังก์ชันบนเซิร์ฟเวอร์
 * ซึ่งเขียน groups.advisor_ids กับ students.advisor_ids ให้ตรงกันในคำสั่งเดียว
 * เสร็จแล้วดึงข้อมูลลงเครื่องทันที ไม่งั้นหน้าจอยังโชว์ของเดิมจนรอบ 15 วิ
 */
import { supabase } from './cloud';
import { t } from './i18n';
import { pullAll } from '../data/cloudSync';
import { refreshMyGroup } from '../store/app';

type Result = { ok: true } | { ok: false; error: string };

const run = async (fn: string, args: Record<string, unknown>): Promise<Result> => {
  if (!supabase) return { ok: false, error: t('ต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่เมื่อมีเน็ต') };
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.code ? error.message : t('ต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่เมื่อมีเน็ต') };
  await pullAll();
  await refreshMyGroup();
  return { ok: true };
};

export const claimGroup = (code: string) => run('claim_group', { p_group: code });
export const releaseGroup = (code: string) => run('release_group', { p_group: code });
/** หัวหน้าภาคเท่านั้น · ids ว่างได้ · ไม่เกิน 2 */
export const setGroupAdvisors = (code: string, ids: string[]) =>
  run('set_group_advisors', { p_group: code, p_ids: ids.filter(Boolean) });
