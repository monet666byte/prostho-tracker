/**
 * หน้านำเข้าข้อมูลตั้งต้นจากชีตของภาค — เห็นเฉพาะหัวหน้าภาค
 *
 * ขั้นตอน: เลือกนักศึกษา → วางไฟล์ CSV (export จากแท็บ PTn) → ดูรายงานตรวจสอบ → ยืนยันนำเข้า
 * ปรัชญา: ไม่เดามั่ว แถวที่อ่านไม่ออกจะขึ้นรายงานพร้อมเหตุผล ให้คนตัดสินเอง
 */
import { CheckCircle, FileArrowUp, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TeacherShell } from '../../components/teacher/TeacherShell';
import { db } from '../../data/db';
import { useAllStudents } from '../../hooks/data';
import { importSheetCsv, type ImportResult } from '../../lib/sheetImport';
import { t } from '../../lib/i18n';
import { useApp } from '../../store/app';
import { thaiShort } from '../../lib/date';
import { TYPES } from '../../domain/catalog';
import { groupShort } from '../../domain/group';

export default function ImportSheet() {
  const { cloudUser, showToast, touch } = useApp();
  const students = useAllStudents();
  const isAdmin = !!cloudUser?.isAdmin;

  const [studentId, setStudentId] = useState('');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  // จะทับของเดิมกี่ชิ้น — id นำเข้าคงที่จากเนื้อหา นำเข้าซ้ำจึงทับ ไม่ใช่เพิ่มซ้ำ
  const [dupes, setDupes] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...students].sort((a, b) => a.code.localeCompare(b.code)),
    [students],
  );

  function preview(text: string, sid: string) {
    setCsv(text);
    if (!sid) { setResult(null); return; }
    setResult(importSheetCsv(text, sid));
  }

  // เช็คว่าชิ้นงานในไฟล์นี้มีอยู่ในระบบแล้วกี่ชิ้น
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!result?.workpieces.length) { setDupes(0); return; }
      const found = await db.workpieces.bulkGet(result.workpieces.map((w) => w.id));
      if (alive) setDupes(found.filter(Boolean).length);
    })();
    return () => { alive = false; };
  }, [result]);

  async function onFile(file: File) {
    // อ่านไฟล์ไม่ได้ (ไฟล์เสีย/เข้ารหัสแปลก) เดิมเงียบสนิท หน้าจอไม่ขยับ คนกดไม่รู้ว่าเกิดอะไร
    setReadError(null);
    try {
      const text = await file.text();
      preview(text, studentId);
    } catch (e) {
      setReadError(t('อ่านไฟล์นี้ไม่ได้ — ต้องเป็นไฟล์ CSV ที่ export จากชีต') + ' · ' + String((e as Error)?.message ?? e));
    }
  }

  async function confirmImport() {
    if (!result || !result.workpieces.length) return;
    setSaving(true);
    try {
      await db.transaction('rw', [db.patients, db.workpieces], async () => {
        await db.patients.bulkPut(result.patients);
        await db.workpieces.bulkPut(result.workpieces);
      });
      touch();
      showToast({
        message: t('นำเข้าแล้ว {p} ผู้ป่วย · {w} ชิ้นงาน', { p: result.patients.length, w: result.workpieces.length }),
        tone: 'success',
      });
      setResult(null);
      setCsv('');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <TeacherShell active="import">
        <main className="main">
          <div className="main__head"><div style={{ flex: 1 }}><h1>{t('นำเข้าจากชีต')}</h1></div></div>
          <div className="dashed" style={{ padding: '28px 20px', textAlign: 'center', font: '500 12.5px var(--font-body)', color: 'var(--text-muted)' }}>
            {t('หน้านี้สำหรับหัวหน้าภาคเท่านั้น')}
          </div>
        </main>
      </TeacherShell>
    );
  }

  const rep = result?.report;

  return (
    <TeacherShell active="import">
      <main className="main">
        <div className="main__head">
          <div style={{ flex: 1 }}>
            <h1>{t('นำเข้าจากชีต')}</h1>
            <p>{t('ย้ายงานที่ค้างอยู่ในชีตเข้าระบบ — ทีละคน ดูรายงานก่อนยืนยันทุกครั้ง')}</p>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>{t('① เลือกนักศึกษาเจ้าของงาน')}</h3>
          <p className="sub">{t('ชีตหนึ่งแท็บ = นักศึกษาหนึ่งคน — เลือกให้ตรงก่อนวางไฟล์')}</p>
          <select
            className="input"
            style={{ maxWidth: 380, marginTop: 10 }}
            value={studentId}
            onChange={(e) => { setStudentId(e.target.value); preview(csv, e.target.value); }}
          >
            <option value="">{t('— เลือก —')}</option>
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>{s.code} · {s.name} · {groupShort(s.group)}</option>
            ))}
          </select>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>{t('② วางไฟล์ CSV จากชีต')}</h3>
          <p className="sub">{t('ในชีต: File → Download → Comma-separated values (.csv) แล้วลากไฟล์มาวางที่นี่')}</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              disabled={!studentId}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              style={{ font: '400 12px var(--font-body)' }}
            />
            <span className="faint" style={{ font: '400 11px var(--font-body)' }}>
              {t('หรือวางข้อความ CSV ในช่องด้านล่างก็ได้')}
            </span>
          </div>
          {readError && (
            <p style={{ margin: '10px 0 0', font: '500 11.5px/1.6 var(--font-body)', color: 'var(--danger-dark)', background: 'var(--danger-tint)', borderRadius: 10, padding: '9px 12px' }}>
              {readError}
            </p>
          )}
          <textarea
            className="input"
            style={{ minHeight: 90, marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11 }}
            placeholder={t('วางเนื้อหา CSV ที่นี่…')}
            disabled={!studentId}
            value={csv}
            onChange={(e) => preview(e.target.value, studentId)}
          />
        </div>

        {rep && (
          <>
            <div className="panel" style={{ marginBottom: 16 }}>
              <h3>{t('③ รายงานตรวจสอบ')}</h3>
              <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)', margin: '12px 0 0' }}>
                <div className="kpi">
                  <div className="kpi__label"><CheckCircle size={14} /> {t('นำเข้าได้')}</div>
                  <div className="kpi__value" style={{ color: 'var(--success)' }}>{rep.imported}</div>
                  <div className="kpi__hint">{t('จาก {n} แถว', { n: rep.totalRows })}</div>
                </div>
                <div className="kpi">
                  <div className="kpi__label">{t('ข้ามไป')}</div>
                  <div className="kpi__value">{rep.skipped}</div>
                  <div className="kpi__hint">{t('แถวว่าง/แถวสรุป/อ่านไม่ออก')}</div>
                </div>
                <div className="kpi" style={{ borderColor: dupes ? 'var(--warning-border)' : undefined }}>
                  <div className="kpi__label">{t('ทับของเดิม')}</div>
                  <div className="kpi__value" style={{ color: dupes ? 'var(--warning)' : undefined }}>{dupes}</div>
                  <div className="kpi__hint">{t('เคยนำเข้าไปแล้ว')}</div>
                </div>
                <div className="kpi" style={{ borderColor: rep.issues.length ? 'var(--warning-border)' : undefined }}>
                  <div className="kpi__label"><WarningCircle size={14} /> {t('ต้องตรวจ')}</div>
                  <div className="kpi__value" style={{ color: rep.issues.length ? 'var(--warning)' : undefined }}>{rep.issues.length}</div>
                  <div className="kpi__hint">{t('จุดที่ระบบไม่กล้าเดาเอง')}</div>
                </div>
              </div>

              {rep.issues.length > 0 && (
                <div className="tblwrap" style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>{t('แถวที่')}</th>
                        <th style={{ width: 130 }}>{t('ช่อง')}</th>
                        <th style={{ width: 150 }}>{t('ค่าที่เจอ')}</th>
                        <th>{t('ปัญหา')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rep.issues.map((i, k) => (
                        <tr key={k}>
                          <td className="mono">{i.row}</td>
                          <td style={{ font: '500 11.5px var(--font-body)' }}>{i.column}</td>
                          <td className="mono" style={{ fontSize: 11, color: 'var(--danger-dark)' }}>{i.value}</td>
                          <td style={{ font: '400 11.5px/1.5 var(--font-body)', color: 'var(--text-muted)' }}>{i.problem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="panel">
              <h3>{t('④ ตรวจก่อนยืนยัน')} · {result!.workpieces.length} {t('ชิ้นงาน')}</h3>
              <p className="sub">{t('อ่านทานสักรอบว่าแปลงถูก โดยเฉพาะ step ที่ผ่านและวันรับเคส')}</p>
              <div className="tblwrap" style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('ผู้ป่วย')}</th>
                      <th style={{ width: 90 }}>HN</th>
                      <th style={{ width: 80 }}>{t('ประเภท')}</th>
                      <th>{t('ชิ้นงาน')}</th>
                      <th style={{ width: 90 }}>{t('รับเคส')}</th>
                      <th style={{ width: 70 }}>step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result!.workpieces.map((w) => {
                      const p = result!.patients.find((x) => x.id === w.patientId);
                      return (
                        <tr key={w.id}>
                          <td style={{ font: '500 11.5px var(--font-body)' }}>{p?.name}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{p?.hn}</td>
                          <td>
                            <span className="badge" style={{ background: TYPES[w.type].tint, color: TYPES[w.type].ink }}>
                              {TYPES[w.type].short}
                            </span>
                          </td>
                          <td style={{ font: '400 11.5px var(--font-body)' }}>{w.detail}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{thaiShort(w.acceptedDate)}</td>
                          <td className="mono" style={{ fontSize: 11 }}>
                            {w.procIndex < 0 ? '—' : `#${w.procIndex}`}
                            {w.completedAt ? ' ✓' : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                className="btn"
                style={{ marginTop: 14, height: 48 }}
                disabled={saving || !result!.workpieces.length}
                onClick={confirmImport}
              >
                <UploadSimple size={18} weight="bold" />
                {saving
                  ? t('กำลังนำเข้า…')
                  : t('ยืนยันนำเข้า {n} ชิ้นงาน', { n: result!.workpieces.length })}
              </button>
              <p style={{ margin: '8px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
                <FileArrowUp size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                {dupes > 0
                  ? t('นำเข้าซ้ำได้ไม่เกิดข้อมูลซ้ำ — {n} ชิ้นที่เคยนำเข้าจะถูกเขียนทับด้วยค่าจากไฟล์นี้', { n: dupes })
                  : t('นำเข้าแล้วข้อมูลจะขึ้นตู้กลางเองภายในไม่กี่วินาที · นำเข้าไฟล์เดิมซ้ำจะทับของเดิม ไม่เพิ่มซ้ำ')}
              </p>
            </div>
          </>
        )}
      </main>
    </TeacherShell>
  );
}
