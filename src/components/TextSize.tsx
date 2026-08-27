import { useEffect, useState } from 'react';

type Zoom = 'md' | 'lg' | 'xl';

const LEVELS: Array<{ key: Zoom; label: string; size: number }> = [
  { key: 'md', label: 'ก', size: 13 },
  { key: 'lg', label: 'ก', size: 16 },
  { key: 'xl', label: 'ก', size: 19 },
];

function apply(zoom: Zoom) {
  document.documentElement.setAttribute('data-zoom', zoom);
  try { localStorage.setItem('uiZoom', zoom); } catch { /* private mode */ }
}

export function initTextSize() {
  try {
    const saved = localStorage.getItem('uiZoom') as Zoom | null;
    if (saved) document.documentElement.setAttribute('data-zoom', saved);
  } catch { /* private mode */ }
}

/** ปุ่มปรับขนาดตัวหนังสือ ก ก ก — สำหรับอาจารย์ที่ต้องการตัวใหญ่ */
export function TextSizeControl() {
  const [zoom, setZoom] = useState<Zoom>(() => {
    try { return (localStorage.getItem('uiZoom') as Zoom) || 'md'; } catch { return 'md'; }
  });

  useEffect(() => apply(zoom), [zoom]);

  return (
    <div className="textsize">
      <span className="textsize__label">ขนาดตัวหนังสือ</span>
      <div className="textsize__btns">
        {LEVELS.map((l) => (
          <button key={l.key} data-on={zoom === l.key} style={{ fontSize: l.size }} onClick={() => setZoom(l.key)} aria-label={`ขนาด ${l.key}`}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
