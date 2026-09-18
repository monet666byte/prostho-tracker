/**
 * ช่องลงนามท้ายใบพิมพ์ — เส้นให้เซ็นด้วยปากกาบนกระดาษ (แอปไม่เก็บลายเซ็น)
 *
 * คำใต้เส้นรับเป็น props เพราะตั้งใจให้ต่างภาษากัน: ใบ portfolio ใช้อังกฤษตามสมุดของภาค
 * ส่วนแบบประเมินตนเองใช้ข้อความผ่าน t() — ห้ามรวมคำไว้ที่นี่
 *
 * `dated` = ช่องสุดท้ายที่พิมพ์วันที่ประเมินลงบนเส้นให้เลย (ใบ portfolio)
 * ใบที่ให้เขียนวันที่ด้วยมือ ส่งคำว่า "วันที่" มาเป็นช่องธรรมดาใน `captions` แทน
 */
export function SignatureBlock({ captions, dated }: {
  captions: string[];
  dated?: { caption: string; text: string; maxWidth: number };
}) {
  return (
    <div className="sign">
      {captions.map((caption) => (
        <div key={caption}>
          <div className="line" />
          <div className="cap">{caption}</div>
        </div>
      ))}
      {dated && (
        <div style={{ maxWidth: dated.maxWidth }}>
          <div className="line" style={{ textAlign: 'center', font: '400 9px var(--font-body)', paddingTop: 16 }}>
            {dated.text}
          </div>
          <div className="cap">{dated.caption}</div>
        </div>
      )}
    </div>
  );
}
