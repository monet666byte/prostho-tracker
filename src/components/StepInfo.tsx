import { HandTap, X } from '@phosphor-icons/react';
import { REQ_TYPES, TYPES } from '../domain/catalog';
import { procList } from '../domain/rules';
import { t } from '../lib/i18n';
import type { WorkType } from '../domain/types';

/** procedure ทั้งหมดที่อยู่ใน progression นั้นของงานประเภทหนึ่ง */
export function proceduresAt(type: WorkType, progression: number, variant?: 'cast' | 'prefab') {
  return procList({ type, variant })
    .filter((p) => p[0] === progression)
    .map((p) => ({ name: p[1], self: !!p[2] }));
}

function TypeBlock({ type, progression }: { type: WorkType; progression: number }) {
  const meta = TYPES[type];
  const cast = proceduresAt(type, progression, 'cast');
  const prefab = type === 'PC' ? proceduresAt(type, progression, 'prefab') : [];
  const differs = type === 'PC' && JSON.stringify(cast) !== JSON.stringify(prefab);

  if (!cast.length && !prefab.length) {
    return (
      <div className="stepinfo__type">
        <span className="badge" style={{ background: meta.tint, color: meta.ink }}>{meta.short}</span>
        <span className="faint" style={{ font: '400 11px var(--font-body)' }}>{t('ไม่มีขั้นตอนที่ progression นี้')}</span>
      </div>
    );
  }

  const render = (list: typeof cast, label?: string) => (
    <ul className="stepinfo__list">
      {label && <li className="stepinfo__variant">{label}</li>}
      {list.map((p) => (
        <li key={p.name}>
          <span className="mono">{p.name}</span>
          {p.self && (
            <span className="badge" style={{ background: 'var(--self-tint)', color: 'var(--self)' }}>
              <HandTap size={10} weight="fill" /> {t('ทำเอง')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="stepinfo__type">
      <span className="badge" style={{ background: meta.tint, color: meta.ink, flex: 'none' }}>{meta.short}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {differs ? (
          <>
            {render(cast, 'Cast post')}
            {render(prefab, 'Prefabricated post')}
          </>
        ) : (
          render(cast)
        )}
      </div>
    </div>
  );
}

/**
 * กล่องอธิบายว่า step นั้นคืออะไร — ใช้ตอนคลิกเลข progression จากกราฟหรือ timeline
 * ถ้าไม่ระบุ type จะแสดงเทียบทั้ง 4 ประเภทหลัก เพราะ progression เดียวกันหมายถึงคนละขั้นตอน
 */
export function StepInfo({
  progression,
  type,
  meta,
  onClose,
}: {
  progression: number;
  type?: WorkType;
  meta?: string;
  onClose?: () => void;
}) {
  const types = type ? [type] : ([...REQ_TYPES] as WorkType[]);
  return (
    <div className="stepinfo">
      <div className="stepinfo__head">
        <span className="stepinfo__num">{progression}</span>
        <div style={{ flex: 1 }}>
          <div style={{ font: '600 13px var(--font-head)' }}>
            Step {progression}
            {type && <span className="faint" style={{ fontWeight: 400 }}> · {TYPES[type].full}</span>}
          </div>
          {meta && (
            <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>{meta}</div>
          )}
          {!type && (
            <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>
              {t('เลขเดียวกันหมายถึงคนละขั้นตอนในแต่ละประเภทงาน')}
            </div>
          )}
        </div>
        {onClose && (
          <button className="iconbtn iconbtn--plain" style={{ width: 28, height: 28 }} onClick={onClose} aria-label={t('ปิด')}>
            <X size={14} weight="bold" />
          </button>
        )}
      </div>

      <div className="stepinfo__body">
        {types.map((ty) => (
          <TypeBlock key={ty} type={ty} progression={progression} />
        ))}
      </div>
    </div>
  );
}
