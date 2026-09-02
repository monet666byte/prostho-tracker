import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';

type Zoom = 'md' | 'lg' | 'xl';

const LEVELS: Array<{ key: Zoom; label: string; size: number }> = [
  { key: 'md', label: t('ก'), size: 13 },
  { key: 'lg', label: t('ก'), size: 16 },
  { key: 'xl', label: t('ก'), size: 19 },
];

function apply(zoom: Zoom) {
  document.documentElement.setAttribute('data-zoom', zoom);
  try { localStorage.setItem('uiZoom', zoom); } catch { /* private mode */ }
}

export function initTextSize() {
  // ค่าเริ่มต้น = เล็กสุด (md) ทุกเครื่องรวมถึง iPad · ตั้ง attribute ให้ชัดเจนเสมอ
  // เพื่อให้ CSS คาดเดาได้ · ที่ทำให้ iPad ตัวโตกว่าที่ตั้งไว้คือ text auto-sizing ของ iOS
  // ซึ่งล็อกไว้แล้วใน base.css (-webkit-text-size-adjust: 100%)
  let zoom: Zoom = 'md';
  try {
    zoom = (localStorage.getItem('uiZoom') as Zoom | null) ?? 'md';
  } catch { /* private mode */ }
  document.documentElement.setAttribute('data-zoom', zoom);
}

/** ปุ่มปรับขนาดตัวหนังสือ ก ก ก — สำหรับอาจารย์ที่ต้องการตัวใหญ่ */
export function TextSizeControl() {
  const [zoom, setZoom] = useState<Zoom>(() => {
    try { return (localStorage.getItem('uiZoom') as Zoom) || 'md'; } catch { return 'md'; }
  });

  useEffect(() => apply(zoom), [zoom]);

  return (
    <div className="textsize">
      <span className="textsize__label">{t('ขนาดตัวหนังสือ')}</span>
      <div className="textsize__btns">
        {LEVELS.map((l) => (
          <button key={l.key} data-on={zoom === l.key} style={{ fontSize: l.size }} onClick={() => setZoom(l.key)} aria-label={`${t('ขนาด')} ${l.key}`}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
