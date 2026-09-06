import { chromium } from 'playwright';
const URL='http://localhost:5173', OUT=process.argv[2];
const T=['/teacher','/teacher/group','/teacher/evaluate','/teacher/review','/teacher/settings','/teacher/analytics','/teacher/portfolio','/teacher/sa','/teacher/roster','/teacher/alumni'];
const S=['/app','/app/patients','/app/criteria','/app/checkin','/app/search','/app/photos','/app/achievements','/app/self-assessment','/app/export','/app/sync'];
const b=await chromium.launch(); const bad=[]; let checked=0;
for (const langv of ['th','en']) {
 for (const zoom of ['md','xl']) {
  for (const [w,h,lb] of [[402,874,'iPhone'],[320,568,'SE'],[1024,768,'iPadนอน'],[820,1180,'iPadตั้ง'],[1440,900,'เดสก์ท็อป']]) {
   for (const role of ['teacher','student']) {
    const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:w<1200,hasTouch:w<1200});
    const p=await ctx.newPage();
    p.on('pageerror',e=>bad.push(`[${langv}/${zoom}/${lb}/${role}] PAGEERROR ${e.message.slice(0,60)}`));
    p.on('console',m=>{if(m.type()==='error')bad.push(`[${langv}/${zoom}/${lb}/${role}] CONSOLE ${m.text().slice(0,60)}`)});
    await p.goto(URL,{waitUntil:'networkidle'}); await p.waitForTimeout(1600);
    await p.evaluate(async([r,l,z])=>{ localStorage.setItem('pt-lang',l); localStorage.setItem('uiZoom',z);
      const d=await new Promise(x=>{const q=indexedDB.open('prostho-tracker');q.onsuccess=()=>x(q.result);});
      await new Promise(x=>{const tx=d.transaction('kv','readwrite');tx.objectStore('kv').put({key:'session',value:{role:r,studentId:'st-TH-PT7-1',teacherId:'tc-TH-PT7-1'}});tx.oncomplete=()=>x();});},[role,langv,zoom]);
    await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(1400);
    for (const route of (role==='teacher'?T:S)) {
      checked++;
      await p.goto(`${URL}/#${route}`,{waitUntil:'networkidle'}); await p.waitForTimeout(620);
      await p.evaluate(()=>document.querySelectorAll('.backdrop').forEach(x=>x.click()));
      const r = await p.evaluate(()=>{
        const m=document.querySelector('main')||document.querySelector('.screen')||document.body;
        const txt=document.body.innerText;
        const ph=document.querySelector('.phone');
        const small=[...document.querySelectorAll('button')]
          .filter(x=>{const b=x.getBoundingClientRect();return b.height>0&&b.width>0&&b.height<32;})
          .map(x=>(x.innerText||x.getAttribute('aria-label')||'').trim().replace(/\n/g,'/').slice(0,14))
          .filter(t=>t&&!/มุมมอง|Achievement|ไทย|น้ำเงิน|รีเซ็ต|login|DEMO|^นักศึกษา$|^อาจารย์$|Student$|Teacher$|View|Reset|Blue|Thai/.test(t));
        const cut=[...document.querySelectorAll('button')]
          .filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!=='auto'&&(e.innerText||'').trim())
          .map(e=>(e.innerText||'').trim().slice(0,12));
        return { ov:m.scrollWidth-m.clientWidth, undef:/\bundefined\b|\bNaN\b|\[object Object\]/.test(txt),
          empty:txt.trim().length<40, small:[...new Set(small)].slice(0,2), cut:[...new Set(cut)].slice(0,2),
          phoneOver: ph? Math.round(ph.getBoundingClientRect().bottom - window.innerHeight):0 };
      });
      const tag=`[${langv}/${zoom}/${lb}/${role}] ${route}`;
      if (r.ov>1) bad.push(`${tag}: ล้น ${r.ov}px`);
      if (r.undef) bad.push(`${tag}: undefined/NaN/[object Object] บนจอ`);
      if (r.empty) bad.push(`${tag}: หน้าว่าง`);
      if (r.phoneOver>4) bad.push(`${tag}: กรอบเกินจอ ${r.phoneOver}px`);
      if (r.cut.length) bad.push(`${tag}: ตัวหนังสือถูกตัด ${r.cut.join(',')}`);
      if (r.small.length && (w<1200)) bad.push(`${tag}: ปุ่มเตี้ย ${r.small.join(',')}`);
    }
    await ctx.close();
   }
  }
 }
}
console.log(`ตรวจ ${checked} หน้า-ครั้ง (ไทย/อังกฤษ × ตัวปกติ/ใหญ่สุด × 5 ขนาดจอ × 2 บทบาท)`);
console.log(bad.length? '\n'+[...new Set(bad)].join('\n') : '\n✅ ไม่พบปัญหาเลย');
await b.close();
