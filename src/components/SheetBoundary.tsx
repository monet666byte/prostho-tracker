/**
 * กันใบเดียวพังแล้วลากหน้าพิมพ์ว่างทั้งหน้า
 *
 * ที่มา: ตอนไล่บั๊ก 7 ก.ย. 69 ยัดแถวที่ grades เป็น null เข้าฐานข้อมูล
 * ปรากฏว่า React ล้มทั้งต้นไม้ หน้าพิมพ์เลยว่างเปล่าโดยไม่บอกอะไรเลย
 * ซึ่งเป็นความล้มเหลวที่แย่ที่สุดของหน้าพิมพ์ — อาจารย์ยืนอยู่หน้าเครื่องพิมพ์แล้วไม่ได้อะไร
 *
 * มีตัวนี้แล้ว ใบที่พังจะกลายเป็นกรอบแจ้งเตือนหนึ่งใบ ใบที่เหลือยังพิมพ์ได้ตามปกติ
 */
import { Component, type ReactNode } from 'react';
import { t } from '../lib/i18n';

export class SheetBoundary extends Component<
  { label: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error('[หน้าพิมพ์: ใบนี้วาดไม่ได้]', this.props.label, err);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="a4 a4--pf">
        <p style={{ font: '600 11px var(--font-body)', color: '#B42318', margin: 0 }}>
          {t('ใบนี้พิมพ์ไม่ได้ — ข้อมูลไม่สมบูรณ์')}: {this.props.label}
        </p>
        <p style={{ font: '400 10px var(--font-body)', color: '#667085', margin: '4px 0 0' }}>
          {t('ใบอื่นยังพิมพ์ได้ตามปกติ · ลองเปิดใบนี้ในหน้าประเมินแล้วบันทึกใหม่อีกครั้ง')}
        </p>
      </section>
    );
  }
}
