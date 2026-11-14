import { useEffect, useRef, type ReactNode } from 'react';

/**
 * ปุ่มกระจกหักเหแสง (liquid-glass-js) สำหรับปุ่มหลักบนแผงน้ำเงินหน้าแรก
 *
 * ไลบรารีออกแบบมาให้กระจกลอยอยู่ใน body แบบ fixed แล้วตามตำแหน่งจอเอง — ใช้กับแผงที่ปัดซ้ายขวา/เลื่อนหน้าไม่ได้
 * (กระจกลอยแยกจากปุ่ม ลอดทับหัวจอ/แถบล่าง) จึงย้ายชั้นเลนส์กับชั้นกระจกมาไว้ "ในตัวปุ่ม" แล้ววางตำแหน่งเอง:
 * ภาพที่เลนส์หักเหคือ `.hp__glassbg` (พื้นแผงเปล่าไม่มีตัวหนังสือ) — ถ้าโคลนทั้งแผง ตัวหนังสือบนแผงถูกบีบที่ขอบปุ่มเป็นเม็ดสีรุ้ง
 *
 * สร้างกระจกไม่สำเร็จ (เบราว์เซอร์ไม่รองรับ / ผู้ใช้ตั้งลดความโปร่งใส) = ปุ่มกระจกฝ้าธรรมดาจาก CSS กดได้เหมือนเดิม
 */
export function GlassButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const btn = ref.current;
    const panel = btn?.closest('.hp');
    const bg = panel?.querySelector<HTMLElement>('.hp__glassbg');
    const page = btn?.closest<HTMLElement>('.hp__page');
    const viewport = panel?.querySelector<HTMLElement>('.hp__viewport');
    if (!btn || !panel || !bg || !page || !viewport) return;
    if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return;

    let glass: import('liquid-glass-js').LiquidGlass | null = null;
    let dead = false;
    let ro: ResizeObserver | null = null;

    // ตำแหน่งปุ่มเทียบกับพื้นแผง — วัดเทียบหน้าเคสของตัวเอง (ไม่ใช่เทียบจอ) แถวเคสที่เลื่อนซ้ายขวาอยู่จึงไม่ทำให้ภาพในกระจกเพี้ยน
    const offset = () => {
      const b = btn.getBoundingClientRect();
      const p = page.getBoundingClientRect();
      const v = viewport.getBoundingClientRect();
      const h = panel.getBoundingClientRect();
      return { x: b.left - p.left + (v.left - h.left), y: b.top - p.top + (v.top - h.top) };
    };

    void import('liquid-glass-js').then(({ LiquidGlass }) => {
      if (dead) return;
      const w = btn.offsetWidth;
      const h = btn.offsetHeight;
      try {
        glass = new LiquidGlass({
          background: bg, width: w, height: h, radius: h / 2, zIndex: 0, draggable: false,
          scale: 30, depth: 14, chroma: 0.04, edge: 0.7, glow: 0.3, tint: 0.16,
        });
      } catch {
        return;
      }
      const g = glass as unknown as {
        lensEl: HTMLElement; lensInner: HTMLElement; glassEl: HTMLElement; margin: number;
        params: { width: number; height: number; radius: number };
        placeLens: () => void;
      };
      // วางเองแทน placeLens ของไลบรารี (ที่วางแบบ fixed ตามจอ)
      g.placeLens = () => {
        const m = g.margin;
        const { x, y } = offset();
        const r = Math.min(g.params.radius, g.params.width / 2, g.params.height / 2);
        Object.assign(g.lensEl.style, {
          position: 'absolute', left: `${-m}px`, top: `${-m}px`,
          // เลนส์กว้างกว่าปุ่มข้างละ m — ตัดให้เหลือแค่รูปปุ่ม ส่วนเกินจะเป็นพื้นแผงนิ่งที่ไม่ตรงกับก้อนสีที่ขยับอยู่
          clipPath: `inset(${m}px round ${r}px)`,
        });
        g.lensInner.style.left = `${m - x}px`;
        g.lensInner.style.top = `${m - y}px`;
        Object.assign(g.glassEl.style, {
          position: 'absolute', left: '0', top: '0', transform: 'none', pointerEvents: 'none', touchAction: 'auto',
          width: `${g.params.width}px`, height: `${g.params.height}px`, borderRadius: `${r}px`,
        });
      };
      btn.prepend(g.lensEl, g.glassEl);
      g.placeLens();
      btn.dataset.glass = 'on';

      // ปุ่มเปลี่ยนขนาด (ข้อความยาวขึ้น · หมุนจอ) หรือเลื่อนที่ในแผง (กางรายการขั้นย่อย) → วางใหม่
      ro = new ResizeObserver(() => {
        if (!glass) return;
        const nw = btn.offsetWidth;
        const nh = btn.offsetHeight;
        if (nw !== g.params.width || nh !== g.params.height) glass.set({ width: nw, height: nh, radius: nh / 2 });
        else g.placeLens();
      });
      ro.observe(btn);
      ro.observe(page);
    });
    // ตอนเปิดแอปปุ่มเลื่อนขึ้นมา (hp-up) — วัดระหว่างเลื่อนจะคลาดไป 8px · วัดใหม่เมื่อจบ
    const settle = () => (glass as unknown as { placeLens?: () => void } | null)?.placeLens?.();
    btn.addEventListener('animationend', settle);

    return () => {
      dead = true;
      btn.removeEventListener('animationend', settle);
      ro?.disconnect();
      glass?.destroy();
      delete btn.dataset.glass;
    };
  }, []);

  return (
    <button ref={ref} className="hp__btn hp__btn--glass" onClick={onClick}>
      <span className="hp__btnlabel">{children}</span>
    </button>
  );
}
