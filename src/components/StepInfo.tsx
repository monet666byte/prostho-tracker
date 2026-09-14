import { X } from '@phosphor-icons/react';
import { REQ_TYPES, typeMeta } from '../domain/catalog';
import { procList } from '../domain/rules';
import { t } from '../lib/i18n';
import type { WorkType } from '../domain/types';

/** procedure ทั้งหมดที่อยู่ใน progression นั้นของงานประเภทหนึ่ง */
export function proceduresAt(type: WorkType, progression: number, variant?: 'cast' | 'prefab') {
  return procList({ type, variant })
    .filter((p) => p[0] === progression)
    .map((p) => ({ name: p[1], self: !!p[2] }));
}

/* แถวละประเภท: ชื่อประเภทตัวหนังสือสี · ขั้นตอนตัวปกติต่อกันบรรทัดเดียว (ผู้ใช้เลือก mock 14 ก.ย. 69)
   เดิมชิปสีประเภท + ชื่อขั้นตัวโมโนทีละบรรทัด */
function Procs({ list }: { list: Array<{ name: string; self: boolean }> }) {
  return (
    <>
      {list.map((p, i) => (
        <span key={p.name}>
          {i > 0 && ' · '}
          {p.name}
          {p.self && <span className="stepinfo__self"> {t('ทำเอง')}</span>}
        </span>
      ))}
    </>
  );
}

function TypeBlock({ type, progression }: { type: WorkType; progression: number }) {
  const meta = typeMeta(type);
  const cast = proceduresAt(type, progression, 'cast');
  const prefab = type === 'PC' ? proceduresAt(type, progression, 'prefab') : [];
  const differs = type === 'PC' && JSON.stringify(cast) !== JSON.stringify(prefab);

  return (
    <div className="stepinfo__type">
      <b style={{ color: meta.ink }}>{meta.short}</b>
      <span>
        {!cast.length && !prefab.length ? (
          <span className="faint">{t('ไม่มีขั้นตอนที่ progression นี้')}</span>
        ) : differs ? (
          <>
            <span className="stepinfo__variant">Cast post: </span><Procs list={cast} />
            <br />
            <span className="stepinfo__variant">Prefabricated post: </span><Procs list={prefab} />
          </>
        ) : (
          <Procs list={cast} />
        )}
      </span>
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>Step {progression}</b>
          {type && <span className="faint"> · {typeMeta(type).full}</span>}
          {meta && <span className="stepinfo__meta">{meta}</span>}
        </div>
        {onClose && (
          <button className="textbtn" style={{ color: 'var(--text-faint)' }} onClick={onClose} aria-label={t('ปิด')}>
            {t('ปิด')} <X size={12} weight="bold" />
          </button>
        )}
      </div>
      {types.map((ty) => (
        <TypeBlock key={ty} type={ty} progression={progression} />
      ))}
    </div>
  );
}
