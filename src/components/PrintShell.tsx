/**
 * ของที่หน้าพิมพ์ทุกหน้าใช้ร่วมกัน (แบบประเมินตนเอง · สมุด portfolio)
 *   PrintEmpty   — ยังไม่มีอะไรให้พิมพ์: ข้อความ + ปุ่มย้อนกลับ กลางจอ
 *   PrintToolbar — แถบปุ่มย้อนกลับ/พิมพ์ + คำแนะนำใต้ปุ่ม · ติด `noprint` ทั้งชุด
 *                  เพราะเอกสารที่จะเซ็นจริงต้องไม่มีปุ่มของแอปหลุดไปบนกระดาษ
 *
 * ข้อความต่างกันตามชนิดเอกสาร จึงรับเป็น props (ผ่าน t() มาจากหน้าที่เรียกแล้ว)
 */
import { ArrowLeft, Printer } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';

export function PrintEmpty({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <div style={{ padding: 28, display: 'grid', gap: 12, placeItems: 'center', minHeight: '100vh', alignContent: 'center' }}>
      <span style={{ font: '600 14px var(--font-head)', color: 'var(--text-muted)' }}>
        {message}
      </span>
      <button className="btn btn--sec" style={{ height: 42, width: 180 }} onClick={() => navigate(-1)}>
        <ArrowLeft size={15} /> {t('ย้อนกลับ')}
      </button>
    </div>
  );
}

export function PrintToolbar({ hint }: { hint: string }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="noprint" style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 780, margin: '0 auto 14px' }}>
        <button className="btn btn--sec" style={{ height: 40, flex: '0 0 120px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> {t('ย้อนกลับ')}
        </button>
        <button className="btn" style={{ height: 40, flex: 1 }} onClick={() => window.print()}>
          <Printer size={16} weight="fill" /> {t('พิมพ์ / บันทึกเป็น PDF')}
        </button>
      </div>
      <p className="noprint" style={{ maxWidth: 780, margin: '0 auto 12px', font: '400 11px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
        {hint}
      </p>
    </>
  );
}
