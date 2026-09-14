import { Check, IdentificationCard, WarningCircle, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudEnabled } from '../../lib/cloud';
import { decideLink, pendingLinkRequests, type PendingLink } from '../../lib/link';
import { t } from '../../lib/i18n';
import { thaiShort } from '../../lib/date';
import { groupShort } from '../../domain/group';
import { useApp } from '../../store/app';

/**
 * นักศึกษาที่ขอผูกบัญชีรออาจารย์ยืนยัน (0023_link_requests.sql)
 * เซิร์ฟเวอร์กรองให้แล้วว่าใครเห็นอะไร: อาจารย์ที่ปรึกษาเห็นกลุ่มตัวเอง · หัวหน้าภาคเห็นทั้งหมด
 * ไม่มีคำขอ = ไม่แสดงอะไรเลย (ไม่กินที่หน้าภาพรวม)
 */
export function LinkRequestsPanel() {
  const showToast = useApp((s) => s.showToast);
  const [rows, setRows] = useState<PendingLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: PendingLink; approve: boolean } | null>(null);
  const guard = useRef(false);

  const load = useCallback(async () => {
    const r = await pendingLinkRequests();
    if (r.ok) { setRows(r.value); setError(null); }
    else setError(r.error);
  }, []);

  useEffect(() => {
    if (!cloudEnabled) return;
    void load();
    const id = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [load]);

  async function decide() {
    if (!confirm || guard.current) return;
    guard.current = true;
    try {
      const r = await decideLink(confirm.row.id, confirm.approve);
      setConfirm(null);
      if (!r.ok) { setError(r.error); return; }
      showToast({
        message: confirm.approve
          ? t('ยืนยันแล้ว — {name} เข้าแอปได้เลย', { name: confirm.row.studentName })
          : t('ปฏิเสธคำขอแล้ว'),
        tone: confirm.approve ? 'success' : 'default',
      });
      await load();
    } finally {
      guard.current = false;
    }
  }

  if (!cloudEnabled || (rows.length === 0 && !error)) return null;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3>
        <IdentificationCard size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
        {t('นักศึกษารอยืนยันบัญชี')} · {rows.length}
      </h3>
      <p className="sub">{t('ตรวจว่าอีเมลเป็นของนักศึกษาคนนั้นจริง ก่อนกดยืนยัน — ยืนยันแล้วเขาจะเห็นเคสและคนไข้ของนักศึกษาคนนั้น')}</p>

      {error && (
        <div role="alert" style={{ display: 'flex', gap: 8, marginTop: 10, borderRadius: 12, padding: '10px 12px', background: 'var(--danger-tint)', color: 'var(--danger-dark)', font: '500 12px var(--font-body)' }}>
          <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--border-2)', borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ font: '600 13px var(--font-body)' }}>
                {r.studentName} <span style={{ font: '400 11.5px var(--font-body)', color: 'var(--text-muted)' }}>· {r.studentCode} · {t('กลุ่ม')} {groupShort(r.groupCode)}</span>
              </div>
              <div className="mono" style={{ font: '400 11.5px var(--font-mono, monospace)', color: 'var(--text-body)', overflowWrap: 'anywhere' }}>{r.email}</div>
              <div style={{ font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>{t('ส่งคำขอ')} {thaiShort(new Date(r.createdAt))}</div>
              {r.sameStudent > 1 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, font: '600 11px var(--font-body)', color: 'var(--warning-dark)' }}>
                  <WarningCircle size={14} weight="fill" />
                  {t('มี {n} บัญชีขอผูกรหัสนี้ — มีคนใส่รหัสของคนอื่น ตรวจกับตัวนักศึกษาก่อน', { n: r.sameStudent })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--sec" style={{ width: 'auto', padding: '0 14px', height: 38 }} onClick={() => setConfirm({ row: r, approve: false })}>
                <X size={15} weight="bold" />{t('ปฏิเสธ')}
              </button>
              <button className="btn" style={{ width: 'auto', padding: '0 14px', height: 38 }} onClick={() => setConfirm({ row: r, approve: true })}>
                <Check size={15} weight="bold" />{t('ยืนยัน')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirm && (
        <div className="confirmwrap" onClick={() => setConfirm(null)}>
          <div className="confirmbox" onClick={(e) => e.stopPropagation()}>
            <div className="confirmbox__q">{confirm.approve ? t('ยืนยันว่าบัญชีนี้เป็นของ') : t('ปฏิเสธคำขอผูกบัญชีของ')}</div>
            <div className="confirmbox__who">{confirm.row.studentName}</div>
            <div className="confirmbox__meta" style={{ overflowWrap: 'anywhere' }}>{confirm.row.studentCode} · {confirm.row.email}</div>
            <p className="confirmbox__note">
              {confirm.approve
                ? t('บัญชีนี้จะเห็นเคสและคนไข้ของนักศึกษาคนนี้ทั้งหมด')
                : t('นักศึกษาส่งคำขอใหม่ได้ ถ้าใส่รหัสผิด')}
            </p>
            <div className="confirmbox__actions">
              <button className="btn btn--sec" onClick={() => setConfirm(null)}>{t('ยกเลิก')}</button>
              <button className="btn" onClick={decide}>
                {confirm.approve ? <Check size={16} weight="bold" /> : <X size={16} weight="bold" />}
                {confirm.approve ? t('ยืนยัน') : t('ปฏิเสธ')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
