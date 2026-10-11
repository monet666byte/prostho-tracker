import { X } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../lib/i18n';
import { DataAge } from './DataAge';

export interface TraceContent {
  eyebrow: string;
  title: string;
  body: ReactNode;
  /** กล่อง "นับยังไง" — กติกาเป็นภาษาคน + ของที่ไม่นับ */
  how?: ReactNode;
}

/**
 * ลิ้นชัก "ตัวเลขนี้มาจากไหน" — กดตัวเลขบนหน้าแรกอาจารย์แล้วเห็นรายการที่รวมกันได้เลขนั้น
 * รายการต้องมาจากฟังก์ชันใน domain/ ชุดเดียวกับที่นับตัวเลข (test:invariants เทียบให้) ห้ามนับใหม่ในหน้าจอ
 * จอกว้างเปิดทางขวา · จอแคบเป็นแผ่นจากล่าง
 */
export function TraceDrawer({ content, onClose }: { content: TraceContent | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const open = !!content;

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!content) return null;
  return (
    <>
      <div className="trace__scrim" onClick={onClose} aria-hidden />
      <aside className="trace" role="dialog" aria-labelledby="trace-title">
        <header className="trace__head">
          <span className="trace__eyebrow">{content.eyebrow}</span>
          <h2 id="trace-title" className="trace__title">{content.title}</h2>
          <button ref={closeRef} className="trace__x" onClick={onClose} aria-label={t('ปิด')}>
            <X size={15} weight="bold" />
          </button>
        </header>
        <div className="trace__body">
          {content.body}
          {content.how && (
            <section className="trace__how">
              <h3>{t('นับยังไง')}</h3>
              {content.how}
            </section>
          )}
        </div>
        <footer className="trace__foot">
          <DataAge />
        </footer>
      </aside>
    </>
  );
}

/** แถวในลิ้นชัก — จุดสี · ชื่อ + บรรทัดรอง · ตัวเลขชิดขวา */
export function TraceRow({
  color, main, sub, value, tone, muted, onClick,
}: {
  color: string;
  main: ReactNode;
  sub?: ReactNode;
  value: ReactNode;
  tone?: 'warn' | 'ok';
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="trace__row" data-muted={muted || undefined}>
      <span className="trace__dot" style={{ background: color }} aria-hidden />
      <span className="trace__main">
        {onClick ? <button className="trace__link" onClick={onClick}>{main}</button> : main}
        {sub && <small>{sub}</small>}
      </span>
      <span className="trace__val" data-tone={tone}>{value}</span>
    </div>
  );
}
