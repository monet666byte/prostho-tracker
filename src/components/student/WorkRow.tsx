/**
 * ชิ้นส่วนของ "แถวชิ้นงาน" ฝั่งนักศึกษา — หน้าคนไข้ (แถวคู่ upper/lower · แถวชิ้นเดี่ยว) และหน้าค้นหา
 *
 * แชร์เฉพาะส่วนที่เหมือนกันจริง: หลอด + "n/m" · ป้ายท้ายแถว · ตัวแถวชิ้นเดี่ยว
 * กรอบนอกของแต่ละแถว (pairrow · singlerow · การ์ดผลค้นหา) ยังอยู่ที่หน้าจอ เพราะ markup ต่างกัน
 * จุดที่ทั้งสามแถวเดิมทำไม่เหมือนกัน คงไว้ผ่าน props — อย่ารวบให้เหมือนกันโดยไม่ได้ตัดสินเรื่องหน้าตาก่อน
 */
import { Trash } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { typeMeta } from '../../domain/catalog';
import { daysSinceUpdate, isReturned, maxProgression, progression, stepFraction } from '../../domain/rules';
import type { WorkpieceView } from '../../domain/types';
import { t, tText } from '../../lib/i18n';
import { Bar, PendingBadge, StaleBadge, TypeBadge } from '../ui/Bits';

/**
 * หลอดความคืบหน้า + ป้าย "n/m" — หลอดอ่านจาก stepFraction(w) ตัวเดียว ห้ามคำนวณสัดส่วนเองในหน้าจอ
 *
 * doneGreen: ครบขั้นแล้วเปลี่ยนหลอด/ตัวเลขเป็นเขียวไหม
 *  - ไม่ใส่    = สีประเภทงานเสมอ (แถวคู่ upper/lower)
 *  - 'raw'     = เทียบ progression ดิบกับขั้นสุดท้าย (แถวชิ้นเดี่ยวหน้าคนไข้)
 *  - 'clamped' = เทียบเลขที่โชว์ (ไม่ต่ำกว่า 0) กับขั้นสุดท้าย (หน้าค้นหา)
 *  สองแบบหลังต่างกันกรณีเดียว: ประเภทงานที่ catalog ไม่รู้จัก (ขั้นสุดท้าย = 0) และยังไม่เริ่ม
 */
export function WorkProgress({
  w, labelSize, doneGreen,
}: {
  w: WorkpieceView;
  /** ขนาดตัวเลข "n/m" (px) — แถวคู่ใช้ 10 · แถวชิ้นเดี่ยวใช้ 11.5 */
  labelSize: number;
  doneGreen?: 'raw' | 'clamped';
}) {
  const prog = progression(w);
  const max = maxProgression(w);
  const done = doneGreen === 'raw' ? prog >= max : doneGreen === 'clamped' ? Math.max(prog, 0) >= max : false;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
      <Bar value={stepFraction(w) * 100} color={done ? 'var(--success)' : typeMeta(w.type).color} height={5} />
      <span style={{ font: `500 ${labelSize}px var(--font-mono)`, color: done ? 'var(--success-dark)' : 'var(--text-faint)', flex: 'none' }}>
        {Math.max(prog, 0)}/{max}
      </span>
    </span>
  );
}

/**
 * ป้ายท้ายแถว: คืนเคส · รอ sync · ค้าง n วัน · ปุ่มลบ (เฉพาะโหมดแก้ไข)
 * เคสที่คืนแล้วไม่ขึ้นป้ายรอ sync — ส่วนป้าย "ค้าง" คุมด้วย staleOnReturned
 * (แถวคู่ซ่อนป้ายค้างเมื่อคืนเคสแล้ว · แถวชิ้นเดี่ยวไม่ซ่อน)
 * ปุ่มลบต้อง preventDefault เพราะแถวทั้งแถวเป็นลิงก์ — ไม่งั้นแตะถังขยะแล้วเด้งเข้าหน้าเคส
 */
export function WorkBadges({
  w, pending, stale, staleOnReturned, editing, onDelete,
}: {
  w: WorkpieceView;
  pending: boolean;
  stale: boolean;
  staleOnReturned: boolean;
  editing: boolean;
  onDelete: (w: WorkpieceView) => void;
}) {
  const returned = isReturned(w);
  return (
    <>
      {returned && <span className="returnedtag">{t('คืนเคส')}</span>}
      {pending && !returned && <PendingBadge />}
      {stale && (staleOnReturned || !returned) && <StaleBadge days={daysSinceUpdate(w)} />}
      {editing && (
        <button
          className="delbtn"
          onClick={(e) => { e.preventDefault(); onDelete(w); }}
          aria-label={`${t('ลบ')} ${w.detail}`}
        >
          <Trash size={15} />
        </button>
      )}
    </>
  );
}

/**
 * ตัวแถวชิ้นเดี่ยว: ป้ายประเภทงาน · รายละเอียดชิ้นงาน · หลอด — หน้าคนไข้กับหน้าค้นหาหน้าตาเดียวกัน
 * children = บรรทัดเสริมใต้หลอด (หน้าค้นหาใส่ "ขั้นล่าสุด")
 */
export function SingleWorkBody({
  w, doneGreen, children,
}: {
  w: WorkpieceView;
  doneGreen: 'raw' | 'clamped';
  children?: ReactNode;
}) {
  return (
    <>
      <TypeBadge type={w.type} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block', font: '400 13px var(--font-body)', color: 'var(--text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {tText(w.detail)}
        </span>
        <WorkProgress w={w} labelSize={11.5} doneGreen={doneGreen} />
        {children}
      </span>
    </>
  );
}
