import { ArrowLeft, CaretDown, CaretUp, PlusCircle } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlainShell } from '../../components/student/Shell';
import { createWorkpieces } from '../../data/repo';
import { DENTURE_CLASSES, DENTURE_CLASSES_FOR, TYPES, isArchWork, isRemovableType, isToothWork, orderOf, typeMeta } from '../../domain/catalog';
import { maxProgression } from '../../domain/rules';
import type { DentureClass, KennedyClass, Payment, WorkType } from '../../domain/types';
import { t } from '../../lib/i18n';
import { usePatientNamesOn } from '../../hooks/data';
import { toISODate } from '../../lib/date';
import { currentActor, useApp } from '../../store/app';

const KENNEDY: KennedyClass[] = ['Kennedy class I', 'Kennedy class II', 'Kennedy class III', 'Kennedy class IV'];
const TYPE_KEYS = (Object.keys(TYPES) as WorkType[]).sort((a, b) => orderOf(a) - orderOf(b));

export default function NewWorkpiece() {
  const navigate = useNavigate();
  // saving (state) ไว้เปลี่ยนหน้าตาปุ่ม · busy (ref) ไว้กันกดรัวจริงๆ
  // setState ไม่ทันงานนี้ — คลิกรัว 4 ทีเกิดก่อน React re-render ทุกที ตัวแปร state จึงยังเป็น false ทั้ง 4 ครั้ง
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const { session, showToast } = useApp();

  const [type, setType] = useState<WorkType>('CD');
  const [pair, setPair] = useState(true);
  const [tooth, setTooth] = useState('');
  const [kennedy, setKennedy] = useState<KennedyClass>('Kennedy class I');
  const [variant, setVariant] = useState<'cast' | 'prefab'>('cast');
  const [acceptedDate, setAcceptedDate] = useState(toISODate(new Date()));
  const [min, setMin] = useState(true);
  const [more, setMore] = useState(false);
  const [name, setName] = useState('');
  /* สวิตช์ "ใช้ชื่อผู้ป่วย" ปิด (นำร่อง · 0026) = ไม่มีช่องชื่อ ไม่บังคับกรอก */
  const namesOn = usePatientNamesOn();
  const [hn, setHn] = useState('');
  // ชื่อกับ HN เป็นตัวระบุผู้ป่วย ขาดไม่ได้ — ตัวนำเข้าจากชีตก็ตีแถวที่ไม่มี HN เป็นใช้ไม่ได้เหมือนกัน
  const [sexAge, setSexAge] = useState('');
  const [payment, setPayment] = useState<Payment>('ยังไม่ชำระ');
  const [sect2Removable, setSect2Removable] = useState(true);
  const [sect2Fixed, setSect2Fixed] = useState(false);
  const [dentureClass, setDentureClass] = useState<DentureClass>('CD');
  const [designRpd, setDesignRpd] = useState('ยังไม่ออกแบบ');

  const meta = typeMeta(type);
  const removable = isArchWork(type);
  const needsTooth = isToothWork(type);
  /* ซี่ฟันขาดไม่ได้สำหรับงานที่ผูกกับซี่ — ฟอร์มเขียนไว้เองว่า "ต้องระบุให้ชัดเจน"
     แต่เดิมไม่ได้บังคับ ผลคือได้แถวที่ชื่อเคสขึ้นว่า "— Recall Fixed" / "— Crown (PFM)"
     ทั้งในหน้าคนไข้ หน้าตรวจงานของอาจารย์ และใบรายงาน A4 ที่เอาไปลงนาม
 — ไม่มีใครรู้ว่าเคสนั้นคือฟันซี่ไหน */
  const canSave = (!namesOn || name.trim().length > 0) && hn.trim().length > 0 && (!needsTooth || tooth.trim().length > 0);

  async function submit() {
    // กันกดรัว — เดิมกด 3 ที ได้ผู้ป่วย 3 คน ชิ้นงาน 6 ชิ้น แล้วนับเข้าเกณฑ์เกินจริง
    if (!session || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
    const created = await createWorkpieces({
      studentId: session.studentId,
      patientName: namesOn ? name : '',
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
      actor: currentActor(),
    });
      showToast({ message: t('สร้าง {n} ชิ้นงานแล้ว', { n: created.length }), tone: 'success' });
      navigate('/app/patients');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <PlainShell
      footer={
        <div className="footer">
          {/* ปุ่มเทาโดยไม่บอกเหตุผล = ทางตัน — ช่องชื่อ/HN อยู่ไกลขึ้นไปบนหน้า
              บนมือถือมองไม่เห็นพร้อมกันกับปุ่ม คนกดแล้วไม่เกิดอะไรจะไม่รู้ว่าต้องทำอะไร */}
          {!canSave && !saving && (
            <div style={{
              font: '500 11px/1.5 var(--font-body)', color: 'var(--text-muted)',
              textAlign: 'center', marginBottom: 7,
            }}>
              {t('ยังกรอกไม่ครบ: {what}', {
                /* ต่อด้วยจุลภาคเท่านั้น — คำเชื่อมภาษาไทยอย่าง " และ " ถ้าใส่ลงพจนานุกรม
                   tText() จะไปแทนที่มันในข้อความอื่นทั้งแอปด้วย */
                what: [
                  namesOn && !name.trim() && t('ชื่อผู้ป่วย'),
                  !hn.trim() && t('HN'),
                  needsTooth && !tooth.trim() && t('ซี่ฟัน'),
                ].filter(Boolean).join(t(', ')),
              })}
            </div>
          )}
          <button className="btn" style={{ height: 56, borderRadius: 16 }} disabled={saving || !canSave} onClick={submit}>
            <PlusCircle size={19} weight="fill" />
            {saving ? t('กำลังสร้าง…') : <>{t('สร้างชิ้นงาน')}{removable && pair ? t(' (2 ชิ้น)') : ''}</>}
          </button>
        </div>
      }
    >
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <h1 className="h2" style={{ flex: 1 }}>{t('เปิดชิ้นงานใหม่')}</h1>
        </div>
      </header>

      {/* ฟอร์มเรียบแบ่งกลุ่ม — กล่องสีหลายกล่องในฟอร์มเดียวอ่านว่า "รก"
          กลุ่ม: ประเภท → ชนิด (สวิตช์) → ผู้ป่วย · ช่องกรอกอยู่ในการ์ดเดียว แถวคั่นเส้น */}
      <div className="newform">
        <div className="homelabel">{t('ประเภทงาน')}</div>
        <div className="typepick" role="radiogroup" aria-label={t('ประเภทงาน')}>
          {TYPE_KEYS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={type === k}
              data-on={type === k}
              onClick={() => {
                setType(k);
                const options = DENTURE_CLASSES_FOR[k];
                if (options?.length) setDentureClass(options[0]);
                setSect2Removable(isRemovableType(k));
                setSect2Fixed(!isRemovableType(k));
              }}
            >
              <i className="dot" style={{ background: typeMeta(k).color }} />
              {typeMeta(k).short}
            </button>
          ))}
        </div>
        <p className="newform__hint">
          {/* ขั้นสุดท้ายของแต่ละประเภทไม่เท่ากัน — Recall จบที่ 3 ไม่ใช่ 10
              เดิมตรึง 10 ไว้ตายตัว คนเปิดเคส Recall จึงถูกบอกว่าจะมี 11 ขั้น แล้วเจอ 4 ขั้น */}
          {meta.full} · {t('ขั้น 0 ถึง {n}', { n: maxProgression({ type, variant }) })}
        </p>

        <div className="homelabel">{t('ชนิด')}</div>
        <div className="card formcard">
          {removable && DENTURE_CLASSES_FOR[type]?.length > 0 && (
            <div className="formrow formrow--stack">
              <div className="minseg" role="radiogroup" aria-label={t('ชนิด')}>
                {DENTURE_CLASSES_FOR[type].map((dc) => (
                  <button key={dc} role="radio" aria-checked={dentureClass === dc} data-on={dentureClass === dc} onClick={() => setDentureClass(dc)}>
                    {t(DENTURE_CLASSES[dc].label)}
                  </button>
                ))}
              </div>
              <span className="formrow__sub">
                {t(DENTURE_CLASSES[dentureClass].teeth)}
                {DENTURE_CLASSES[dentureClass].countsCDA && t(' · นับเข้า Count CDA')}
              </span>
            </div>
          )}

          {type === 'RPD' && (
            <div className="formrow formrow--stack">
              <span className="formrow__label">Kennedy class</span>
              <div className="minseg">
                {KENNEDY.map((k) => (
                  <button key={k} data-on={kennedy === k} aria-pressed={kennedy === k} onClick={() => setKennedy(k)}>
                    {k.replace('Kennedy class ', 'Class ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === 'PC' && (
            <div className="formrow formrow--stack">
              <span className="formrow__label">{t('ชนิด post')}</span>
              <div className="minseg">
                {(['cast', 'prefab'] as const).map((v) => (
                  <button key={v} data-on={variant === v} aria-pressed={variant === v} onClick={() => setVariant(v)}>
                    {v === 'cast' ? 'Cast post' : 'Prefabricated post'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsTooth && (
            <label className="formfield">
              <small>{t('ซี่ฟัน')} · {t('ต้องระบุให้ชัดเจน')}</small>
              <input className="mono" aria-label={t('ซี่ฟัน')} value={tooth} onChange={(e) => setTooth(e.target.value)} placeholder={t('เช่น 46 หรือ 34–36')} />
            </label>
          )}

          {removable && (
            <button className="formrow" role="switch" aria-checked={pair} onClick={() => setPair(!pair)}>
              <span className="formrow__main">
                <b>{t('สร้างคู่ upper + lower')}</b>
                <span className="formrow__sub">{pair ? t('จะได้ 2 ชิ้น progress แยกกัน') : t('ชิ้นเดียว')}</span>
              </span>
              <span className="toggle" data-on={pair}><i /></span>
            </button>
          )}

          <button className="formrow" role="switch" aria-checked={min} onClick={() => setMin(!min)}>
            <span className="formrow__main"><b>{t('นับเข้าเกณฑ์')}</b></span>
            <span className="toggle" data-on={min}><i /></span>
          </button>
        </div>

        <div className="homelabel">{t('ผู้ป่วย')}</div>
        <div className="card formcard">
          {/* aria-label ทุกช่อง — placeholder หายทันทีที่เริ่มพิมพ์ และโปรแกรมอ่านหน้าจอไม่อ่านให้
              คนที่กลับมากรอกต่อจะไม่รู้ว่าช่องไหนคืออะไร (WCAG 1.3.1 · 3.3.2) */}
          {namesOn && <label className="formfield">
            <small>{t('ชื่อผู้ป่วย')}</small>
            <input aria-label={t('ชื่อผู้ป่วย')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('สมมติ เช่น ผู้ป่วย E')} />
          </label>}
          <div className="formpair">
            <label className="formfield">
              <small>HN</small>
              <input className="mono" aria-label="HN" value={hn} onChange={(e) => setHn(e.target.value)} placeholder="67-xxxxx" />
            </label>
            <label className="formfield">
              <small>{t('เพศ/อายุ')}</small>
              <input aria-label={t('เพศ/อายุ')} value={sexAge} onChange={(e) => setSexAge(e.target.value)} placeholder={t('เช่น ญ 65')} />
            </label>
          </div>
          <label className="formfield">
            <small>{t('วันรับเคส')}</small>
            <input className="mono" type="date" aria-label={t('วันรับเคส')} value={acceptedDate} max={toISODate(new Date())} onChange={(e) => setAcceptedDate(e.target.value)} />
          </label>
        </div>

        <div>
          <button className="formmore" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
            {t('ข้อมูลเพิ่มเติม (Sect II, Design RPD)')}
          </button>

          {more && (
            <div className="card formcard" style={{ marginTop: 10 }}>
              <div className="formrow formrow--stack">
                <span className="formrow__label">Payment</span>
                <div className="minseg">
                  {(['ยังไม่ชำระ', 'ชำระแล้ว', 'ยกเว้น'] as Payment[]).map((p) => (
                    <button key={p} data-on={payment === p} aria-pressed={payment === p} onClick={() => setPayment(p)}>{t(p)}</button>
                  ))}
                </div>
              </div>
              {(
                [
                  ['Sect II · Removable', sect2Removable, setSect2Removable],
                  ['Sect II · Fixed', sect2Fixed, setSect2Fixed],
                ] as Array<[string, boolean, (v: boolean) => void]>
              ).map(([label, on, set]) => (
                <button key={label} className="formrow" role="switch" aria-checked={on} onClick={() => set(!on)}>
                  <span className="formrow__main"><b>{label}</b><span className="formrow__sub">Pt. exam &amp; tx. plan</span></span>
                  <span className="toggle" data-on={on}><i /></span>
                </button>
              ))}
              {type === 'RPD' && (
                <label className="formfield">
                  <small>Design RPD</small>
                  <input aria-label={t('Design RPD')} value={designRpd} onChange={(e) => setDesignRpd(e.target.value)} />
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    </PlainShell>
  );
}
