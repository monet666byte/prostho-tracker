import { ArrowLeft, CaretDown, CaretUp, LinkSimple, PlusCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlainShell } from '../../components/student/Shell';
import { createWorkpieces } from '../../data/repo';
import { DENTURE_CLASSES, DENTURE_CLASSES_FOR, ORDER, TYPES } from '../../domain/catalog';
import type { DentureClass, KennedyClass, Payment, WorkType } from '../../domain/types';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';

const KENNEDY: KennedyClass[] = ['Kennedy class I', 'Kennedy class II', 'Kennedy class III', 'Kennedy class IV'];
const TYPE_KEYS = (Object.keys(TYPES) as WorkType[]).sort((a, b) => ORDER[a] - ORDER[b]);

export default function NewWorkpiece() {
  const navigate = useNavigate();
  const { session, showToast } = useApp();

  const [type, setType] = useState<WorkType>('CD');
  const [pair, setPair] = useState(true);
  const [tooth, setTooth] = useState('');
  const [kennedy, setKennedy] = useState<KennedyClass>('Kennedy class I');
  const [variant, setVariant] = useState<'cast' | 'prefab'>('cast');
  const [acceptedDate, setAcceptedDate] = useState(new Date().toISOString().slice(0, 10));
  const [min, setMin] = useState(true);
  const [more, setMore] = useState(false);
  const [name, setName] = useState('');
  const [hn, setHn] = useState('');
  const [sexAge, setSexAge] = useState('');
  const [payment, setPayment] = useState<Payment>('ยังไม่ชำระ');
  const [sect2Removable, setSect2Removable] = useState(true);
  const [sect2Fixed, setSect2Fixed] = useState(false);
  const [dentureClass, setDentureClass] = useState<DentureClass>('CD');
  const [designRpd, setDesignRpd] = useState('ยังไม่ออกแบบ');

  const meta = TYPES[type];
  const removable = type === 'CD' || type === 'RPD' || type === 'APD';
  const needsTooth = type === 'PC' || type === 'CB' || type === 'RFX';

  async function submit() {
    if (!session) return;
    const created = await createWorkpieces({
      studentId: session.studentId,
      patientName: name,
      hn,
      sexAge,
      type,
      pair: removable && pair,
      tooth,
      kennedy: type === 'RPD' ? kennedy : undefined,
      variant: type === 'PC' ? variant : undefined,
      dentureClass: removable ? dentureClass : undefined,
      acceptedDate,
      minimumRequirement: min,
      pendingQualification: false,
      payment,
      sect2Removable,
      sect2Fixed,
      designRpd: type === 'RPD' ? designRpd : undefined,
      actor: 'นศ. ก',
    });
    showToast({ message: t('สร้าง {n} ชิ้นงานแล้ว', { n: created.length }), tone: 'success' });
    navigate('/app/patients');
  }

  return (
    <PlainShell
      footer={
        <div className="footer">
          <button className="btn" style={{ height: 56, borderRadius: 16 }} onClick={submit}>
            <PlusCircle size={19} weight="fill" />
            {t('สร้างชิ้นงาน')}{removable && pair ? t(' (2 ชิ้น)') : ''}
          </button>
        </div>
      }
    >
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <h2 className="h2" style={{ flex: 1 }}>{t('เปิดชิ้นงานใหม่')}</h2>
        </div>
      </header>

      <div style={{ padding: '16px 16px 0', display: 'grid', gap: 16 }}>
        <div className="field">
          <label>{t('ประเภทงาน')}</label>
          <div className="seg">
            {TYPE_KEYS.map((k) => (
              <button
                key={k}
                data-on={type === k}
                onClick={() => {
                  setType(k);
                  const options = DENTURE_CLASSES_FOR[k];
                  if (options?.length) setDentureClass(options[0]);
                  const isRemovable = k === 'CD' || k === 'RPD' || k === 'APD';
                  setSect2Removable(isRemovable);
                  setSect2Fixed(!isRemovable);
                }}
                style={type === k ? { background: TYPES[k].ink } : undefined}
              >
                {TYPES[k].short}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`t-${type}`}
          style={{ background: 'var(--type-tint)', borderRadius: 12, padding: '11px 13px' }}
        >
          <div style={{ font: '600 12.5px var(--font-head)', color: meta.ink }}>{meta.full}</div>
          <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 3 }}>
            <span className="mono">{meta.prefix}</span>-0 {t('ถึง')} {meta.prefix}-10
          </div>
        </div>

        {removable && DENTURE_CLASSES_FOR[type]?.length > 0 && (
          <div className="field">
            <label>{t('ชนิดชิ้นงานตามชีต (ช่อง “ชนิดชิ้นงาน UPPER/LOWER denture”)')}</label>
            <div className="seg">
              {DENTURE_CLASSES_FOR[type].map((dc) => (
                <button key={dc} data-on={dentureClass === dc} onClick={() => setDentureClass(dc)}>
                  {t(DENTURE_CLASSES[dc].label)}
                </button>
              ))}
            </div>
            <p style={{ margin: '4px 0 0', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
              {t(DENTURE_CLASSES[dentureClass].teeth)}
              {DENTURE_CLASSES[dentureClass].countsCDA && t(' · นับเข้า Count CDA')}
            </p>
          </div>
        )}

        {removable && (
          <button
            onClick={() => setPair(!pair)}
            style={{
              display: 'flex', gap: 11, alignItems: 'center', padding: '12px 13px', borderRadius: 12,
              border: `1px solid ${pair ? 'var(--accent)' : 'var(--border-2)'}`,
              background: pair ? 'var(--accent-tint)' : '#fff', textAlign: 'left',
            }}
          >
            <LinkSimple size={18} color={pair ? 'var(--accent)' : 'var(--text-muted)'} style={{ flex: 'none' }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', font: '600 12.5px var(--font-body)' }}>{t('สร้างคู่ upper + lower')}</span>
              <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                {t('progress แยกกันคนละแถว')}
              </span>
            </span>
            <span className="toggle" data-on={pair}><i /></span>
          </button>
        )}

        {removable && pair && (
          <div style={{ display: 'flex', gap: 9 }}>
            {['Upper', 'Lower'].map((a) => (
              <div key={a} className="dashed" style={{ flex: 1, padding: '10px 12px' }}>
                <div style={{ font: '600 11.5px var(--font-mono)', color: 'var(--text-secondary)' }}>{a}</div>
                <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 2 }}>{t('ยังไม่เริ่ม')} · step 0</div>
              </div>
            ))}
          </div>
        )}

        {type === 'RPD' && (
          <div className="field">
            <label>Kennedy class</label>
            <div className="seg">
              {KENNEDY.map((k) => (
                <button key={k} data-on={kennedy === k} onClick={() => setKennedy(k)}>
                  {k.replace('Kennedy class ', 'Class ')}
                </button>
              ))}
            </div>
          </div>
        )}

        {type === 'PC' && (
          <div className="field">
            <label>{t('ชนิด post')}</label>
            <div className="seg">
              {(['cast', 'prefab'] as const).map((v) => (
                <button key={v} data-on={variant === v} onClick={() => setVariant(v)}>
                  {v === 'cast' ? 'Cast post' : 'Prefabricated post'}
                </button>
              ))}
            </div>
          </div>
        )}

        {needsTooth && (
          <label className="field">
            <span>{t('ซี่ฟัน')} <span className="faint" style={{ fontWeight: 400 }}>{t('— ต้องระบุให้ชัดเจน')}</span></span>
            <input className="input mono" value={tooth} onChange={(e) => setTooth(e.target.value)} placeholder={t('เช่น 46 หรือ 34–36')} />
          </label>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Accepted date</span>
            <input className="input mono" type="date" value={acceptedDate} onChange={(e) => setAcceptedDate(e.target.value)} />
          </label>
          <button
            onClick={() => setMin(!min)}
            style={{
              width: 124, marginTop: 22, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', padding: '0 11px',
              border: `1px solid ${min ? 'var(--success)' : 'var(--border-2)'}`,
              background: min ? 'var(--success-tint)' : '#fff',
              font: '600 11.5px var(--font-body)', color: min ? 'var(--success-dark)' : 'var(--text-muted)',
            }}
          >
            {t('นับเข้าเกณฑ์')}
            <span className="toggle" data-on={min} style={{ width: 34, height: 20, background: min ? 'var(--success)' : undefined }}>
              <i style={{ width: 14, height: 14, transform: min ? 'translateX(14px)' : undefined }} />
            </span>
          </button>
        </div>

        <div className="field">
          <label>{t('ผู้ป่วย')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ชื่อผู้ป่วย (สมมติ เช่น ผู้ป่วย E)')} />
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <input className="input mono" value={hn} onChange={(e) => setHn(e.target.value)} placeholder="HN" />
            <input className="input" value={sexAge} onChange={(e) => setSexAge(e.target.value)} placeholder={t('เพศ/อายุ')} />
          </div>
        </div>

        <div>
          <button
            onClick={() => setMore(!more)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', font: '600 12px var(--font-body)', color: 'var(--text-secondary)' }}
          >
            {more ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
            {t('ข้อมูลเพิ่มเติม (Payment, Sect II, Design RPD)')}
            
          </button>

          {more && (
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <div className="field">
                <label>Payment</label>
                <div className="seg">
                  {(['ยังไม่ชำระ', 'ชำระแล้ว', 'ยกเว้น'] as Payment[]).map((p) => (
                    <button key={p} data-on={payment === p} onClick={() => setPayment(p)}>{t(p)}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Sect II · Pt. exam &amp; tx. plan <span className="faint" style={{ fontWeight: 400 }}>{t('— ชีตแยกเป็น 2 ช่อง')}</span></label>
                <div style={{ display: 'flex', gap: 9 }}>
                  {(
                    [
                      ['Removable', sect2Removable, setSect2Removable],
                      ['Fixed', sect2Fixed, setSect2Fixed],
                    ] as Array<[string, boolean, (v: boolean) => void]>
                  ).map(([label, on, set]) => (
                    <button
                      key={label}
                      onClick={() => set(!on)}
                      style={{
                        flex: 1, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '0 11px',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`,
                        background: on ? 'var(--accent-tint)' : '#fff',
                        font: '600 11.5px var(--font-body)', color: on ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      {label}
                      <span className="mono" style={{ fontSize: 10 }}>{on ? 'Yes' : 'No'}</span>
                    </button>
                  ))}
                </div>
              </div>

              {type === 'RPD' && (
                <label className="field">
                  <span>Design RPD</span>
                  <input className="input" value={designRpd} onChange={(e) => setDesignRpd(e.target.value)} />
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    </PlainShell>
  );
}
