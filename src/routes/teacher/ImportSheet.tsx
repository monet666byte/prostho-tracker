/**
 * หน้านำเข้าข้อมูลตั้งต้นจากชีตของภาค — เห็นเฉพาะหัวหน้าภาค
 *
 * ขั้นตอน: เลือกนักศึกษา → วางไฟล์ CSV (export จากแท็บ PTn) → ดูรายงานตรวจสอบ → ยืนยันนำเข้า
 * ปรัชญา: ไม่เดามั่ว แถวที่อ่านไม่ออกจะขึ้นรายงานพร้อมเหตุผล ให้คนตัดสินเอง
 */
import { CheckCircle, FileArrowUp, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../data/db';
import { useAllStudents } from '../../hooks/data';
import { importSheetCsv, type ImportResult } from '../../lib/sheetImport';
import { logAudit } from '../../data/repo';
import { t } from '../../lib/i18n';
import { currentActor, useApp } from '../../store/app';
import { thaiShort } from '../../lib/date';
import { fetchCohortTabs, importGroupCsv, parseStudentList, sheetIdFromUrl, type GroupImportResult, type RosterEntry } from '../../lib/sheetImport';
import { replaceWithRoster } from '../../data/repo';
import { TYPES } from '../../domain/catalog';
import { groupShort } from '../../domain/group';

export function ImportSheetBody() {
  const { cloudUser, showToast, touch } = useApp();
  const students = useAllStudents();
  /* เดิมล็อกเฉพาะหัวหน้าภาค — ผู้ใช้ให้เปิดกว้าง (1 ก.ย.) เพราะทุกการนำเข้าถูกบันทึกใน audit log
     งานนี้แก้ "ข้อมูลงาน" ไม่ใช่ "สิทธิ์เข้าถึง" จึงเปิดให้อาจารย์ทุกคนได้ */
  void cloudUser;

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
      // ⚠️ เดิมการนำเข้านี้ไม่ทิ้งร่องรอยเลย — พอเปิดให้อาจารย์ทุกคนใช้ ต้องรู้ว่าใครนำเข้าให้ใคร
      // (การนำเข้าเขียนทับงานเดิมของนักศึกษาได้ จึงต้องตามย้อนได้เสมอ)
      const who = students.find((st) => st.id === studentId);
      await logAudit(
        t('นำเข้าจากชีตให้ {name}: {p} ผู้ป่วย · {w} ชิ้นงาน', {
          name: t(who?.name ?? ''), p: result.patients.length, w: result.workpieces.length,
        }),
        currentActor(),
        { studentId },
      );
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

  const rep = result?.report;

  return (
    <>
      <p className="sub" style={{ margin: '0 0 14px' }}>
        {t('ย้ายงานที่ค้างอยู่ในชีตเข้าระบบ — ทีละคน ดูรายงานก่อนยืนยันทุกครั้ง')}
      </p>

      <WholeCohortImport />

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
    </>
  );
}


/* ── นำเข้าทั้งรุ่นจากชีตจริง (Google Sheet → CSV รายแท็บ) ─────────────────
   เลือกไฟล์ทีเดียวหลายไฟล์: Student list + PT1–PT12 — ระบบแยกเองจากเนื้อไฟล์
   ใช้กับ local เท่านั้นตอนนี้ (โหมดเดโมไม่มีการเชื่อมเซิร์ฟเวอร์อยู่แล้ว) */
function WholeCohortImport() {
  const { showToast, touch, session, signOut } = useApp();
  const [roster, setRoster] = useState<{ entries: RosterEntry[]; issues: number } | null>(null);
  const [groups, setGroups] = useState<Array<{ name: string; res: GroupImportResult }>>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // ดึงจากลิงก์ชีตโดยตรง — ข้อมูลจริงวิ่งจากชีตเข้าเบราว์เซอร์เครื่องนี้เท่านั้น
  const [sheetUrl, setSheetUrl] = useState('');
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  async function pullFromSheet() {
    const id = sheetIdFromUrl(sheetUrl);
    setPullError(null);
    setDone(null);
    if (!id) { setPullError(t('ลิงก์ไม่ถูกต้อง — วางลิงก์ Google Sheet ทั้งอัน')); return; }
    setPulling(t('กำลังดึง…'));
    try {
      const res = await fetchCohortTabs(id, (d, total) => setPulling(t('กำลังดึง {d}/{t} แท็บ…', { d, t: total })));
      if (!res.groups.length) {
        setPullError(t('ดึงไม่ได้ — ชีตต้องเปิดสิทธิ์ให้ “ผู้ที่มีลิงก์” อ่านได้ และมีแท็บ PT1–PT12'));
        return;
      }
      let entries: RosterEntry[] = [];
      if (res.roster) {
        const r = parseStudentList(res.roster);
        entries = r.entries;
        setRoster({ entries, issues: r.issues.length });
      } else {
        setRoster(null);
        setPullError(t('ไม่พบแท็บรายชื่อ (Student list) — นำเข้างานได้แต่จับคู่นักศึกษาไม่ได้'));
      }
      const byCode = new Map(entries.map((e) => [e.code, `st-r55-${e.code}`]));
      setGroups(res.groups.map((g) => ({ name: g.tab, res: importGroupCsv(g.csv, (code) => byCode.get(code) ?? null) })));
    } finally {
      setPulling(null);
    }
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setDone(null);
    // อ่านทุกไฟล์ แล้วแยกชนิดจากเนื้อใน: มีหัว Group = รายชื่อ · มีหัว HN = แท็บกลุ่ม
    const texts = await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() })));
    const rosterFile = texts.find((f) => /(^|,)"?Group"?(,|$)/im.test(f.text.split('\n').slice(0, 5).join('\n')));
    let entries: RosterEntry[] = [];
    if (rosterFile) {
      const r = parseStudentList(rosterFile.text);
      entries = r.entries;
      setRoster({ entries, issues: r.issues.length });
    } else {
      setRoster(null);
    }
    const byCode = new Map(entries.map((e) => [e.code, `st-r55-${e.code}`]));
    const gs = texts
      .filter((f) => f !== rosterFile && /(^|,)"?HN"?(,|$)/im.test(f.text.split('\n').slice(0, 5).join('\n')))
      .map((f) => ({ name: f.name.replace(/\.csv$/i, ''), res: importGroupCsv(f.text, (code) => byCode.get(code) ?? null) }));
    setGroups(gs);
  }

  const totals = groups.reduce(
    (a, g) => {
      g.res.blocks.forEach((b) => {
        a.students += b.studentId ? 1 : 0;
        a.unmatched += b.studentId ? 0 : 1;
        a.patients += b.result.patients.length;
        a.works += b.result.workpieces.length;
        a.issues += b.result.report.issues.length;
      });
      a.issues += g.res.fileIssues.length;
      return a;
    },
    { students: 0, unmatched: 0, patients: 0, works: 0, issues: 0 },
  );
  const allIssues = groups.flatMap((g) =>
    [...g.res.fileIssues.map((i) => ({ g: g.name, code: '-', i })),
     ...g.res.blocks.flatMap((b) => b.result.report.issues.map((i) => ({ g: g.name, code: b.studentCode, i })))],
  );

  async function confirmAll() {
    if (!roster?.entries.length || !groups.length || busy) return;
    setBusy(true);
    try {
      const r = await replaceWithRoster(roster.entries, currentActor());
      let pats = 0;
      let wks = 0;
      for (const g of groups) {
        for (const b of g.res.blocks) {
          if (!b.studentId) continue;
          await db.transaction('rw', [db.patients, db.workpieces], async () => {
            await db.patients.bulkPut(b.result.patients);
            await db.workpieces.bulkPut(b.result.workpieces);
          });
          pats += b.result.patients.length;
          wks += b.result.workpieces.length;
        }
      }
      await logAudit(
        t('นำเข้าทั้งรุ่นจากชีต: {s} คน · {g} กลุ่ม · {p} ผู้ป่วย · {w} ชิ้นงาน', { s: r.students, g: r.groups, p: pats, w: wks }),
        currentActor(),
        {},
      );
      touch();
      setDone(t('นำเข้าเสร็จ: {s} คน · {p} ผู้ป่วย · {w} ชิ้นงาน — ข้อมูลเดโมถูกแทนที่แล้ว', { s: r.students, p: pats, w: wks }));
      showToast({ message: t('นำเข้าทั้งรุ่นเรียบร้อย'), tone: 'success' });
      setGroups([]);
      setRoster(null);
      if (fileRef.current) fileRef.current.value = '';
      // ล้างข้อมูลแล้ว นักศึกษาเดโมหายไป — ถ้า session ฝั่งนักศึกษาค้างอยู่ให้ออกจากระบบกันหน้าเปล่า
      if (session?.role === 'student') await signOut();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 16, border: '1.5px solid var(--accent)' }}>
      <h3>{t('นำเข้าทั้งรุ่นจากชีตจริง (ทีเดียวทุกกลุ่ม)')}</h3>
      <p className="sub" style={{ margin: '4px 0 10px' }}>
        {t('วางลิงก์ชีตแล้วกดดึง — หรือเลือกไฟล์ CSV ที่ export ไว้ (Student list + PT1–PT12)')}<br />
        <b>{t('🔒 ข้อมูลวิ่งจากชีตเข้าเบราว์เซอร์เครื่องนี้โดยตรง ไม่ถูกอัปขึ้นเว็บและไม่ออกจากเครื่อง')}</b><br />
        {t('⚠️ การยืนยันจะล้างข้อมูลเดโมทั้งหมดแล้วแทนด้วยรุ่นจริง — ใช้กับเครื่องทดลอง local เท่านั้น')}
      </p>
      {/* ทางที่ง่ายที่สุด: วางลิงก์ชีต — ไม่ต้อง export ไฟล์เอง */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input
          className="input"
          style={{ flex: '1 1 320px', height: 40, fontSize: 12.5 }}
          placeholder={t('วางลิงก์ Google Sheet ของภาคที่นี่')}
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void pullFromSheet(); }}
        />
        <button
          className="btn"
          style={{ width: 'auto', height: 40, padding: '0 16px', fontSize: 12.5, flex: 'none' }}
          disabled={!!pulling || !sheetUrl.trim()}
          onClick={() => void pullFromSheet()}
        >
          {pulling ?? t('ดึงข้อมูลจากชีต')}
        </button>
      </div>
      {pullError && (
        <p style={{ margin: '0 0 10px', font: '500 11.5px/1.6 var(--font-body)', color: 'var(--warning-dark)' }}>{pullError}</p>
      )}
      <p className="sub" style={{ margin: '0 0 8px' }}>{t('หรือเลือกไฟล์ CSV ที่ export ไว้แล้ว')}</p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        onChange={(e) => void onFiles(e.target.files)}
      />
      {roster && (
        <p style={{ margin: '10px 0 0', font: '500 12px var(--font-body)' }}>
          📋 {t('รายชื่อ')}: {roster.entries.length} {t('คน')}{roster.issues ? ` · ${t('ปัญหา')} ${roster.issues}` : ''}
        </p>
      )}
      {groups.length > 0 && (
        <>
          <p style={{ margin: '4px 0 0', font: '500 12px var(--font-body)' }}>
            🗂 {groups.length} {t('กลุ่ม')} · {totals.students} {t('คน')} · {totals.patients} {t('ผู้ป่วย')} · {totals.works} {t('ชิ้นงาน')}
            {totals.unmatched ? ` · ⚠️ ${t('จับคู่ไม่ได้')} ${totals.unmatched}` : ''}
            {totals.issues ? ` · ${t('ติดธงให้ตรวจ')} ${totals.issues}` : ''}
          </p>
          {allIssues.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
              {allIssues.slice(0, 60).map((x, i) => (
                <div key={i} style={{ font: '400 10.5px/1.6 var(--font-mono)', color: 'var(--text-muted)' }}>
                  [{x.g} · {x.code}] {t('แถว')}{x.i.row} {x.i.column}: {x.i.value.slice(0, 28)} → {x.i.problem}
                </div>
              ))}
              {allIssues.length > 60 && <div className="sub">… {allIssues.length - 60} {t('รายการ')}</div>}
            </div>
          )}
          <button
            className="btn"
            style={{ marginTop: 12, height: 46, width: 'auto', padding: '0 18px' }}
            disabled={busy || !roster?.entries.length}
            onClick={confirmAll}
          >
            {busy ? t('กำลังนำเข้า…') : t('ยืนยัน — ล้างเดโมแล้วนำเข้ารุ่นจริงทั้งหมด')}
          </button>
          {!roster?.entries.length && (
            <p className="sub" style={{ marginTop: 6 }}>{t('ต้องมีไฟล์ Student list ด้วย — ใช้จับคู่รหัสนักศึกษา')}</p>
          )}
        </>
      )}
      {done && <p style={{ margin: '10px 0 0', font: '600 12px var(--font-body)', color: 'var(--success-dark)' }}>✓ {done}</p>}
    </div>
  );
}
