/**
 * ⓘ อธิบายสีเสี่ยงในตารางกลุ่ม
 *
 * ทำไมต้องมี: ผู้ใช้ถามซ้ำ 3 รอบว่า "ทำไมคนนี้แดง/ส้ม" (2 ก.ย.) — บรรทัดสั้นใต้หัวตาราง
 * อธิบายไม่พอ แต่ถ้าเขียนยาวก็รกทั้งหน้า จึงพับไว้หลังปุ่ม ⓘ กดดูเมื่ออยากรู้
 *
 * ตัวเลขคาบดึงสดจากระบบ (periodsLeftNow) — คนอ่านจะได้เห็นว่ามาจากไหนจริงๆ
 */
import { useState } from 'react';
import { Info, X } from '@phosphor-icons/react';
import { periodsLeftNow } from '../../domain/analytics';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

const DOT: Record<string, string> = {
  ok: 'var(--success)',
  medium: 'var(--warning)',
  high: 'var(--danger-chart)',
};

function Row({ level, title, body }: { level: keyof typeof DOT; title: string; body: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <span style={{ width: 9, height: 9, borderRadius: 99, background: DOT[level], flex: 'none', marginTop: 4 }} />
      <span style={{ font: '400 11.5px/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
        <b style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</b> — {body}
      </span>
    </div>
  );
}

export function RiskLegend() {
  const { settings } = useApp();
  const [open, setOpen] = useState(false);
  const left = periodsLeftNow(settings);
  const amber = Math.round(left * 0.7);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', font: '500 11.5px var(--font-body)', color: 'var(--accent)',
        }}
      >
        <Info size={14} weight="fill" />
        {open ? t('ซ่อนคำอธิบายสี') : t('สีพวกนี้คิดยังไง?')}
      </button>

      {open && (
        <div
          style={{
            marginTop: 9, padding: '12px 14px', borderRadius: 12,
            background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 9 }}>
            <div style={{ flex: 1, font: '600 12px var(--font-head)' }}>{t('สีบอกว่า “ปิดเกณฑ์รายปีทันไหม”')}</div>
            <button className="iconbtn iconbtn--plain" style={{ width: 24, height: 24 }} onClick={() => setOpen(false)} aria-label={t('ปิด')}>
              <X size={12} weight="bold" />
            </button>
          </div>

          {/* คิดเป็น "งบเวลา": มีคาบอยู่เท่านี้ งานกินไปเท่าไหร่ เหลือเผื่อเท่าไหร่
             (เดิมเขียนเป็น % ของคาบที่ใช้ — ผู้ใช้อ่านแล้วงงสองรอบ 2 ก.ย.) */}
          <div style={{ font: '400 11px/1.6 var(--font-body)', color: 'var(--text-muted)', marginBottom: 9 }}>
            {t('คิดเหมือนงบเวลา: ตอนนี้มีคาบเหลือ ~{n} คาบ · งานที่ต้องทำแปลงเป็นคาบแล้วเทียบว่าเหลือเผื่อเท่าไหร่', { n: left })}
          </div>
          <div style={{ display: 'grid', gap: 7 }}>
            <Row level="ok" title={t('เขียว')} body={t('ยังเหลือคาบเผื่อสบายๆ (เกิน 30% ของที่มี)')} />
            <Row level="medium" title={t('ส้ม')} body={t('เหลือเผื่อน้อยแล้ว (ไม่ถึง 30%) — ทันแต่ห้ามสะดุด')} />
            <Row
              level="high"
              title={t('แดง')}
              body={t('งานกินคาบเกินที่มี · หรือยังไม่มีเคสในมือเลย · หรือมาคลินิกแล้ว step ไม่ขยับ 3 คาบติด')}
            />
          </div>

          <div style={{ marginTop: 11, paddingTop: 10, borderTop: '1px solid var(--divider)' }}>
            <div style={{ font: '600 11px var(--font-head)', color: 'var(--text-secondary)', marginBottom: 4 }}>
              {t('วิธีคิด')}
            </div>
            <div className="pretty" style={{ font: '400 11px/1.7 var(--font-body)', color: 'var(--text-muted)' }}>
              {t('① นับเฉพาะเคสที่ใกล้จบสุดเท่าที่ต้องใช้ปิดเกณฑ์ปีนี้ — เคสที่รับเผื่อไว้ปีหน้าไม่ถูกนับ')}<br />
              {t('② รวม step ที่เหลือของเคสเหล่านั้น × ~1.5 คาบ/step = คาบที่ต้องใช้')}<br />
              {t('③ เทียบกับคาบที่เหลือถึงปลายปีการศึกษา — ตอนนี้ ~{n} คาบ (เกิน ~{a} คาบเมื่อไหร่ = ส้ม)', { n: left, a: amber })}
            </div>
            <div style={{ marginTop: 7, padding: '7px 10px', borderRadius: 8, background: 'var(--fill)', font: '400 10.5px/1.7 var(--font-mono)', color: 'var(--text-muted)' }}>
              {t('ตัวอย่าง')}: {t('งานเหลือ 24 ขั้น × 1.5 = 36 คาบ · มีอยู่ {n} คาบ → เหลือเผื่อ {b} คาบ = เขียว', { n: left, b: left - 36 })}
            </div>
            <div style={{ marginTop: 8, font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
              {t('⚠️ เลขคาบเป็นค่าประมาณจากสมมติฐาน (คาบ/สัปดาห์ ปรับได้ที่ “ตั้งค่าเกณฑ์”) — ใช้จัดลำดับว่าควรดูใครก่อน ไม่ใช่คำตัดสิน')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
