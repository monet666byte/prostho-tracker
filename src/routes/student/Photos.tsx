import { ArrowLeft, Camera, Images, WarningCircle } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { Empty, PhotoSlot } from '../../components/ui/Bits';
import { PlainShell } from '../../components/student/Shell';
import { addPhoto, retryPhoto } from '../../data/repo';
import { usePhotos, useWorkpieces } from '../../hooks/data';
import { thaiShort } from '../../lib/date';
import { useApp } from '../../store/app';
import type { PhotoStatus } from '../../domain/types';

const CHIP: Record<PhotoStatus, { label: string; bg: string; fg: string }> = {
  ok: { label: 'อัปโหลดแล้ว', bg: 'var(--success-tint)', fg: 'var(--success)' },
  queue: { label: 'รออัปโหลด', bg: 'var(--warning-tint)', fg: 'var(--warning)' },
  fail: { label: 'ส่งไม่สำเร็จ', bg: 'var(--danger-tint)', fg: 'var(--danger-dark)' },
};

export default function Photos() {
  const navigate = useNavigate();
  const { session, offline, showToast } = useApp();
  const photos = usePhotos(session?.studentId);
  const works = useWorkpieces(session?.studentId);

  async function shoot() {
    const target = works.find((w) => w.procIndex >= 0);
    if (!target) return;
    await addPhoto(target.id, offline);
    showToast({ message: offline ? 'เก็บรูปในเครื่อง · รอ sync' : 'อัปโหลดรูปแล้ว', tone: offline ? 'warning' : 'default' });
  }

  return (
    <PlainShell>
      <header className="s-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label="ย้อนกลับ">
            <ArrowLeft size={17} />
          </button>
          <h2 className="h2" style={{ flex: 1 }}>รูปต่อ step</h2>
        </div>
        <p style={{ margin: '6px 0 0', font: '400 11.5px var(--font-body)', color: 'var(--text-faint)' }}>
          บีบอัดอัตโนมัติ · เข้าคิวเมื่อออฟไลน์
        </p>
      </header>

      <div style={{ display: 'flex', gap: 11, padding: '14px 16px 0' }}>
        <button className="card" style={bigBtn} onClick={shoot}>
          <Camera size={24} weight="fill" color="var(--accent)" />
          ถ่ายรูป
        </button>
        <button className="card" style={bigBtn} onClick={shoot}>
          <Images size={24} weight="fill" color="var(--accent)" />
          เลือกจากคลัง
        </button>
      </div>

      <div className="sectiontitle">
        <h4>รูปทั้งหมด · {photos.length} รูป</h4>
      </div>

      <div style={{ padding: '0 16px', display: 'grid', gap: 9 }}>
        {photos.length === 0 && (
          <Empty icon={<Images size={26} />} title="ยังไม่มีรูปในเคสนี้" hint="แนบรูปตอนบันทึก step เสร็จได้เลย" />
        )}
        {photos.map((p) => {
          const chip = CHIP[p.status];
          return (
            <button
              key={p.id}
              className="card"
              style={{ padding: 10, display: 'flex', gap: 11, alignItems: 'center', textAlign: 'left' }}
              onClick={async () => {
                if (p.status !== 'fail') return;
                await retryPhoto(p.id, offline);
                showToast({ message: 'ลองส่งรูปใหม่แล้ว', tone: 'default' });
              }}
            >
              <PhotoSlot size={74} filled />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: '500 11px var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {p.stepLabel}
                </span>
                <span style={{ display: 'block', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)', marginTop: 3 }}>
                  {p.detail}
                </span>
                <span style={{ display: 'block', font: '400 10px var(--font-body)', color: 'var(--text-faint)', marginTop: 4 }}>
                  {thaiShort(p.createdAt)} · {p.sizeLabel} · บีบอัดอัตโนมัติ
                </span>
              </span>
              <span className="chip" style={{ background: chip.bg, color: chip.fg, flex: 'none' }}>
                {p.status === 'fail' && <WarningCircle size={12} weight="fill" />}
                {chip.label}
              </span>
            </button>
          );
        })}
      </div>
    </PlainShell>
  );
}

const bigBtn: React.CSSProperties = {
  flex: 1, height: 80, display: 'grid', placeItems: 'center', gap: 6, borderRadius: 14,
  font: '600 12.5px var(--font-body)', color: 'var(--text-secondary)',
};
