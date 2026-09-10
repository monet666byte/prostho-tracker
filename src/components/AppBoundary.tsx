/**
 * ตาข่ายชั้นสุดท้ายของทั้งแอป — อะไรพังตอนวาดหน้าก็ต้องไม่กลายเป็น "จอขาว"
 *
 * ทำไมต้องมี (เจอจริง 10 ก.ย. 69): ใส่ชิ้นงานที่มี `type` ซึ่ง catalog รุ่นนี้ไม่รู้จัก
 * ลงเครื่องหนึ่งแถว แล้วเปิดหน้าคนไข้ → `#root` ว่างเปล่าสนิท ไม่มีข้อความ ไม่มีปุ่ม
 * และ **รีโหลดก็ไม่หาย** เพราะแถวนั้นยังอยู่ใน IndexedDB — แอปตายถาวรจากมุมผู้ใช้
 *
 * ต้นเหตุตัวนั้นแก้ที่ `domain/rules.ts` ไปแล้ว แต่ปัญหาจริงคือ "ไม่มีตาข่าย"
 * แถวข้อมูลรูปแบบแปลกเกิดได้เสมอ (sync ลงมาจากแอปรุ่นใหม่กว่า · แถวที่ถูกแก้มือใน
 * ตู้กลาง · ชีตที่นำเข้ามาแล้วมีค่าที่ไม่คาด) และหน้าอาจารย์มี 14 หน้า
 * เดาให้ครบทุกทางไม่ได้ — สิ่งที่ทำได้คือ **พังแล้วยังบอกทางออกได้**
 *
 * ⚠️ ปุ่มล้างข้อมูลในเครื่องเป็นทางออกสุดท้ายจริง ๆ จึงต้องกดสองครั้งและบอกความเสี่ยงตรง ๆ
 *    ของที่ยังไม่ขึ้นตู้กลางจะหายไปด้วย — แต่ทางเลือกอีกทางคือแอปใช้ไม่ได้ตลอดกาล
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../lib/i18n';

interface Props { children: ReactNode }
interface State { err: Error | null; wiping: boolean; armed: boolean }

async function wipeLocalData(): Promise<void> {
  /* ลบตรง ๆ ด้วย indexedDB API ไม่เรียกผ่าน repo/store — ตอนนี้อะไรก็พังได้
     ถ้าทางออกต้องพึ่งโมดูลที่อาจเป็นต้นเหตุ มันจะพังตามไปด้วย */
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    const names = dbs.map((d) => d.name).filter((n): n is string => !!n);
    // เผื่อเบราว์เซอร์ที่ไม่มี databases() — ลบชื่อที่แอปนี้ใช้เอง
    for (const n of names.length ? names : ['prostho-tracker', 'prostho-tracker-demo']) {
      await new Promise<void>((res) => {
        const req = indexedDB.deleteDatabase(n);
        req.onsuccess = () => res();
        req.onerror = () => res();
        req.onblocked = () => res(); // แท็บอื่นเปิดค้าง — ปล่อยไป reload ข้างล่างจะจัดการ
      });
    }
  } catch {
    // ลบไม่ได้ก็ยังต้องรีโหลด ดีกว่าค้างอยู่หน้าเดิม
  }
  try {
    localStorage.clear();
  } catch { /* หน้าต่างส่วนตัวบางตัวห้ามแตะ */ }
}

export class AppBoundary extends Component<Props, State> {
  state: State = { err: null, wiping: false, armed: false };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // ให้ร่องรอยไว้ใน console เสมอ — คนที่ช่วยไล่บั๊กต้องเห็นว่าพังที่ component ไหน
    console.error('[แอปพังตอนวาดหน้า]', err, info.componentStack);
  }

  render() {
    const { err, armed, wiping } = this.state;
    if (!err) return this.props.children;

    return (
      <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 380, display: 'grid', gap: 12, textAlign: 'center' }}>
          <div style={{ font: '700 17px var(--font-head)', color: 'var(--text)' }}>
            {t('หน้านี้เปิดไม่ขึ้น')}
          </div>
          <div style={{ font: '400 13px/1.7 var(--font-body)', color: 'var(--text-body)' }}>
            {t('ข้อมูลที่ทำให้พังยังอยู่ในเครื่อง โหลดใหม่แล้วอาจเจอหน้าเดิมอีก — ถ้าเป็นแบบนั้นให้ล้างข้อมูลในเครื่องแล้วเริ่มใหม่')}
          </div>

          <button className="btn" onClick={() => location.reload()} disabled={wiping}>
            {t('โหลดใหม่')}
          </button>

          {!armed ? (
            <button
              className="btn btn--sec"
              onClick={() => this.setState({ armed: true })}
              disabled={wiping}
            >
              {t('ยังเปิดไม่ได้ — ล้างข้อมูลในเครื่อง')}
            </button>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{
                font: '500 12px/1.6 var(--font-body)', color: 'var(--danger-dark)',
                background: 'var(--danger-tint)', borderRadius: 10, padding: '9px 11px', textAlign: 'left',
              }}>
                {t('ของที่ยังไม่ได้ขึ้นเซิร์ฟเวอร์จะหายไปด้วย ถ้ายังกดได้อยู่ ให้ลอง sync ก่อน')}
              </div>
              <button
                className="btn"
                style={{ background: 'var(--danger)' }}
                disabled={wiping}
                onClick={() => {
                  this.setState({ wiping: true });
                  void wipeLocalData().then(() => location.reload());
                }}
              >
                {wiping ? t('กำลังล้าง…') : t('ยืนยัน ล้างข้อมูลในเครื่องแล้วเริ่มใหม่')}
              </button>
            </div>
          )}

          <div style={{
            font: '400 10.5px/1.6 var(--font-mono)', color: 'var(--text-faint)',
            wordBreak: 'break-word', marginTop: 4, textAlign: 'left',
          }}>
            {String(err?.message ?? err)}
          </div>
          <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
            {t('ถ้าเจอซ้ำ ๆ ช่วยถ่ายหน้าจอนี้ส่งให้ผู้พัฒนาด้วยครับ')}
          </div>
        </div>
      </div>
    );
  }
}
