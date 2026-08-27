import type { CSSProperties, ReactNode } from 'react';
import { TYPES } from '../../domain/catalog';
import type { WorkType } from '../../domain/types';

export function TypeBadge({ type, style }: { type: WorkType; style?: CSSProperties }) {
  const t = TYPES[type];
  return (
    <span className="badge" style={{ background: t.tint, color: t.color, ...style }}>
      {t.short}
    </span>
  );
}

export function ArchBadge({ arch }: { arch?: 'upper' | 'lower' }) {
  if (!arch) return null;
  return (
    <span className="badge mono" style={{ background: 'var(--fill)', color: 'var(--text-muted)', fontWeight: 500 }}>
      {arch === 'upper' ? 'Upper' : 'Lower'}
    </span>
  );
}

export function SelfBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="badge" style={{ background: 'var(--self-tint)', color: 'var(--self)' }}>
      {compact ? 'ทำเอง' : 'ทำเอง (self-performed)'}
    </span>
  );
}

export function Bar({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  return (
    <span className="bar" style={{ height }}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? 'var(--accent)' }} />
    </span>
  );
}

export function StaleBadge({ days }: { days: number }) {
  return (
    <span className="badge" style={{ background: 'var(--danger-tint)', color: 'var(--danger-dark)' }}>
      ค้าง {days} วัน
    </span>
  );
}

export function PendingBadge() {
  return (
    <span className="badge" style={{ background: 'var(--warning-tint)', color: 'var(--warning-dark)' }}>
      รอ sync
    </span>
  );
}

export function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div
      className="dashed"
      style={{ padding: '26px 16px', display: 'grid', placeItems: 'center', gap: 7, textAlign: 'center' }}
    >
      <span style={{ color: 'var(--text-disabled)', fontSize: 26, display: 'grid' }}>{icon}</span>
      <span style={{ font: '600 13px var(--font-body)', color: 'var(--text-muted)' }}>{title}</span>
      {hint && <span style={{ font: '400 11.5px/1.5 var(--font-body)', color: 'var(--text-faint)' }}>{hint}</span>}
    </div>
  );
}

export function PhotoSlot({ size = 52, filled }: { size?: number; filled?: boolean }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: filled ? 'var(--border)' : 'var(--fill)',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--text-faint)',
        flex: 'none',
      }}
    >
      <svg width={size * 0.34} height={size * 0.34} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-4.5 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM4 17v-2.6l3.3-3.3 4.4 4.4L9.9 17H4Zm16 0h-7.3l4.2-4.2L20 15.9V17Z" />
      </svg>
    </span>
  );
}
