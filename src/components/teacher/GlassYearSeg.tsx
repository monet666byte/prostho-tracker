import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { YearView } from '../../hooks/useYearView';
import { t } from '../../lib/i18n';

const OPTIONS: Array<[YearView, () => string]> = [
  ['5', () => `${t('ปี')} 5`],
  ['6', () => `${t('ปี')} 6`],
  ['all', () => t('รวมปี')],
];

/**
 * แถบเลือกปีบนมือถืออาจารย์ — ตัวเลือกที่เลือกอยู่มีเม็ดกระจกหักเหแสง (liquid-glass-js) ทับ
 *
 * ภาพที่เลนส์หักเหคือแถบ `.gseg__track` (พื้นทึบ + ป้ายปี) · เม็ดกระจกเป็นพี่น้องของแถบ ไม่ใช่ลูก
 * (ถ้าอยู่ในแถบ ตอนโคลนจะโคลนเลนส์ตัวเองซ้อนเข้าไปด้วย) · เลนส์ทึบจึงบังป้ายจริงข้างใต้ เห็นแต่ป้ายที่ขยายผ่านกระจก
 * เปลี่ยนปี → โคลนแถบใหม่ (สีป้ายเปลี่ยน) แล้ววางเลนส์ตามเม็ดที่เลื่อนไปทุกเฟรมจนเลื่อนเสร็จ
 *
 * สร้างกระจกไม่สำเร็จ / ผู้ใช้ตั้งลดความโปร่งใส = เม็ดขาวโปร่งจาก CSS กดได้เหมือนเดิม
 */
export function GlassYearSeg({ view, onChange }: { view: YearView; onChange: (v: YearView) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const glassRef = useRef<{ refresh: () => void; place: () => void; resize: (w: number, h: number) => void } | null>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  // รุ่นที่จบแล้ว ('alumni') ไม่มีช่องในแถบนี้ → ไม่มีเม็ด
  const idx = OPTIONS.findIndex(([v]) => v === view);

  // วางเม็ดตามปุ่มที่เลือกจริง (ความกว้างป้ายไม่เท่ากันได้ในภาษาอังกฤษ)
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const btn = idx < 0 ? undefined : (track.children[idx] as HTMLElement | undefined);
      setBox(btn ? { x: btn.offsetLeft, w: btn.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [idx]);

  useEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb || !box) return;
    if (glassRef.current) return;
    if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return;

    let glass: import('liquid-glass-js').LiquidGlass | null = null;
    let dead = false;
    void import('liquid-glass-js').then(({ LiquidGlass }) => {
      if (dead) return;
      const w = thumb.offsetWidth;
      const h = thumb.offsetHeight;
      try {
        glass = new LiquidGlass({
          background: track, width: w, height: h, radius: h / 2, zIndex: 0, draggable: false,
          // scale สูงกว่านี้ ขอบบน-ล่างของเม็ดดึงเศษป้ายปีมาเป็นเส้นสีรุ้ง (เม็ดเตี้ยแค่ 38px)
          scale: 12, depth: 12, chroma: 0.05, edge: 0.8, glow: 0.6, tint: 0,
        });
      } catch {
        return;
      }
      const g = glass as unknown as {
        lensEl: HTMLElement; lensInner: HTMLElement; glassEl: HTMLElement; margin: number;
        params: { width: number; height: number; radius: number };
        placeLens: () => void;
      };
      // วางเองในเม็ด แทนการวางแบบ fixed ตามจอของไลบรารี
      g.placeLens = () => {
        const m = g.margin;
        const b = thumb.getBoundingClientRect();
        const tr = track.getBoundingClientRect();
        const r = Math.min(g.params.radius, g.params.width / 2, g.params.height / 2);
        Object.assign(g.lensEl.style, {
          position: 'absolute', left: `${-m}px`, top: `${-m}px`, clipPath: `inset(${m}px round ${r}px)`,
        });
        g.lensInner.style.left = `${m - (b.left - tr.left)}px`;
        g.lensInner.style.top = `${m - (b.top - tr.top)}px`;
        Object.assign(g.glassEl.style, {
          position: 'absolute', left: '0', top: '0', transform: 'none', pointerEvents: 'none', touchAction: 'auto',
          width: `${g.params.width}px`, height: `${g.params.height}px`, borderRadius: `${r}px`,
        });
      };
      thumb.prepend(g.lensEl, g.glassEl);
      g.placeLens();
      thumb.dataset.glass = 'on';
      glassRef.current = {
        refresh: () => glass?.refresh(),
        place: () => g.placeLens(),
        resize: (nw, nh) => {
          if (nw !== g.params.width || nh !== g.params.height) glass?.set({ width: nw, height: nh, radius: nh / 2 });
          else g.placeLens();
        },
      };
    });
    return () => {
      dead = true;
      glass?.destroy();
      glassRef.current = null;
      delete thumb.dataset.glass;
    };
    // สร้างครั้งเดียวเมื่อรู้ตำแหน่งเม็ดแล้ว — การเปลี่ยนปี/ขนาดจัดการใน effect ข้างล่าง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box !== null]);

  // เปลี่ยนปีหรือขนาด → โคลนแถบใหม่ แล้วตามเม็ดที่กำลังเลื่อนไปจนเลื่อนเสร็จ
  useEffect(() => {
    const thumb = thumbRef.current;
    const g = glassRef.current;
    if (!thumb || !g || !box) return;
    g.resize(thumb.offsetWidth, thumb.offsetHeight);
    g.refresh();
    let raf = 0;
    const until = performance.now() + 420;
    const follow = () => {
      g.place();
      if (performance.now() < until) raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [box]);

  return (
    <div className="gseg">
      <div ref={trackRef} className="gseg__track" role="group" aria-label={t('ชั้นปี')}>
        {OPTIONS.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={v === view} data-on={v === view || undefined} onClick={() => onChange(v)}>
            {label()}
          </button>
        ))}
      </div>
      <span
        ref={thumbRef}
        className="gseg__thumb"
        aria-hidden
        inert
        style={box ? { width: box.w, transform: `translateX(${box.x}px)` } : { opacity: 0 }}
      />
    </div>
  );
}
