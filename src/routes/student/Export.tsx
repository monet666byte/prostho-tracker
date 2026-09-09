import { ArrowLeft, FileCsv, FilePdf } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlainShell } from '../../components/student/Shell';
import { CSV_COLUMNS, PROGRESSION_COLUMNS, exportCsv, exportPermission, passedProgressions } from '../../lib/export';
import { currentProc, isComplete, percentCompleted, procLabel } from '../../domain/rules';
import { useStudent, useWorkpieces } from '../../hooks/data';
import { thaiLong, academicYear } from '../../lib/date';
import { t, tText } from '../../lib/i18n';
import { currentActor, currentPdpaRole, useApp } from '../../store/app';
import { onPdpaPolicy } from '../../data/pdpaSync';

export default function ExportScreen() {
  const navigate = useNavigate();
  const { session, showToast } = useApp();
  const works = useWorkpieces(session?.studentId);
  const student = useStudent(session?.studentId);

  const reportWorks = works.filter((w) => !isComplete(w) || w.minimumRequirement);

  /* สิทธิ์ส่งออกมาจากนโยบายของภาค (pdpa_policy · migration 0016) ไม่ใช่ค่าคงที่ในแอป
     หัวหน้าภาคเปลี่ยนแล้วต้องมีผลกับหน้าที่เปิดค้างอยู่ด้วย จึงต้องสมัครฟัง */
  const [perm, setPerm] = useState(() => exportPermission(currentPdpaRole()));
  useEffect(() => onPdpaPolicy(() => setPerm(exportPermission(currentPdpaRole()))), []);
  const [busy, setBusy] = useState(false);

  async function doExportCsv() {
    setBusy(true);
    try {
      const res = await exportCsv({
        scope: 'own-progress',
        works: reportWorks,
        filename: `DTPT502-${student?.code ?? 'student'}-progress.csv`,
        wantIdentified: true,
        role: currentPdpaRole(),
        studentId: session?.studentId,
        actor: currentActor(),
      });
      if (!res.ok) {
        showToast({ message: t(res.reason), tone: 'warning' });
        return;
      }
      showToast({
        message: res.identified
          ? t('ส่งออก CSV แล้ว')
          : t('ส่งออก CSV แล้ว — ไฟล์นี้ปิดบังชื่อและ HN ตามสิทธิ์ที่ภาคกำหนด'),
        tone: 'success',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlainShell>
      <header className="s-header noprint">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="iconbtn iconbtn--plain" onClick={() => navigate(-1)} aria-label={t('ย้อนกลับ')}>
            <ArrowLeft size={17} />
          </button>
          <h2 className="h2" style={{ flex: 1 }}>{t('ส่งออก')}</h2>
        </div>
        <p style={{ margin: '6px 0 0', font: '400 11.5px/1.55 var(--font-body)', color: 'var(--text-faint)' }}>
          {t('พิมพ์ → อาจารย์ลงนาม → ส่งเลขาภาควิชา ชั้น 15')}
        </p>
      </header>

      <div style={{ padding: '14px 16px 0' }}>
        <p className="noprint" style={{ margin: '0 0 8px', font: '400 10.5px var(--font-body)', color: 'var(--text-faint)' }}>
          {t('เลื่อนแนวนอนเพื่อดูช่อง 0–10')}
        </p>
        <div className="a4wrap">
        <div className="a4">
          <h1>{t('รายงานความก้าวหน้าเคส Prosthodontics · DTPT502')}</h1>
          <div className="sub">
            {/* ห้ามใส่ค่าเดโมเป็น fallback — เอกสารนี้พิมพ์ออกไปให้อาจารย์ลงนาม
                ถ้าดึงข้อมูลไม่ได้ ต้องเห็นว่าว่าง ไม่ใช่เห็นรหัสของคนอื่นที่ดูสมจริง */}
            {t(student?.name ?? '—')} · {t('รหัส')} {student?.code ?? '—'} · {t('กลุ่ม')} {student?.group ?? '—'} ·
            {/* เดิมใส่ชื่อ "รอบส่งรายงาน" จากปฏิทินที่ฝังตายไว้ปีเดียว
                — ระบบรายงานถูกถอดออกไปแล้ว และหลัง มี.ค. 2570 ป้ายจะหายไปเฉยๆ ตลอดกาล
                เปลี่ยนเป็นปีการศึกษา + วันที่พิมพ์ ซึ่งจริงเสมอและจำเป็นกว่าบนเอกสารที่เซ็นจริง */}
            {` ${t('ปีการศึกษา')} ${academicYear(new Date())} · ${t('ข้อมูล ณ')} ${thaiLong(new Date())}`}
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: 18 }}>No</th>
                <th>{t('Prosthodontic work / Step ที่ผ่านแล้ว')}</th>
                <th className="mono" style={{ width: 54 }}>HN</th>
                {PROGRESSION_COLUMNS.map((c) => (
                  <th key={c} className="mono tick">{c}</th>
                ))}
                <th className="mono" style={{ width: 30 }}>%</th>
                <th style={{ width: 26 }}>Min</th>
              </tr>
            </thead>
            <tbody>
              {reportWorks.map((w, i) => {
                const cur = currentProc(w);
                return (
                  <tr key={w.id}>
                    <td className="mono">{i + 1}</td>
                    <td>
                      {tText(w.detail)}
                      <div className="mono" style={{ color: '#667085', fontSize: 7.5, marginTop: 1 }}>
                        {cur ? procLabel(w.type, cur) : '—'}
                      </div>
                    </td>
                    <td className="mono">{w.patient.hn}</td>
                    {passedProgressions(w).map((on, j) => (
                      <td key={j} className="tick">{on ? '✓' : ''}</td>
                    ))}
                    <td className="mono">{percentCompleted(w)}%</td>
                    <td style={{ textAlign: 'center' }}>{w.minimumRequirement ? '✓' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="sign">
            <div>
              <div className="line" />
              <div className="cap">{t('ลงนามนักศึกษา')}</div>
            </div>
            <div>
              <div className="line" />
              <div className="cap">{t('ลงนามอาจารย์ที่ปรึกษากลุ่ม')}</div>
            </div>
          </div>
        </div>
        </div>
      </div>

      <div className="noprint" style={{ padding: '14px 16px 0', display: 'grid', gap: 9 }}>
        <button className="btn" onClick={() => window.print()}>
          <FilePdf size={19} weight="fill" />
          {t('สร้าง PDF สำหรับลงนาม')}
        </button>
        <button
          className="btn btn--sec"
          style={{ height: 48 }}
          disabled={!perm.allowed || busy}
          onClick={() => void doExportCsv()}
        >
          <FileCsv size={18} />
          {t('ส่งออก CSV ตามคอลัมน์ชีตเดิม')}
        </button>
        {/* บอกตรงๆ ว่าทำไมกดไม่ได้ / ไฟล์ที่ได้จะหน้าตายังไง — ไม่ปล่อยให้ปุ่มเทาเฉยๆ
            ทุกครั้งที่กดสำเร็จจะมีแถวใน audit log ว่าใครดึงอะไรออกไปเมื่อไหร่ */}
        <p style={{ margin: '-2px 0 0', font: '400 10.5px/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
          {!perm.allowed
            ? t('ภาควิชายังไม่ได้เปิดสิทธิ์ส่งออกให้บทบาทนี้')
            : perm.identified
              ? t('ไฟล์นี้มีชื่อและ HN ผู้ป่วย · การส่งออกทุกครั้งถูกบันทึกใน audit log')
              : t('ไฟล์นี้แสดงรหัสเคสแทนชื่อและ HN · การส่งออกทุกครั้งถูกบันทึกใน audit log')}
        </p>

        <div className="sectiontitle" style={{ padding: '8px 0 6px' }}>
          <h4>{t('คอลัมน์ใน CSV')}</h4>

        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 6 }}>
          {CSV_COLUMNS.map((c) => (
            <span key={c} className="qchip mono" style={{ cursor: 'default' }}>{c}</span>
          ))}
        </div>
      </div>
    </PlainShell>
  );
}
