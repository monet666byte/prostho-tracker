import { chromium } from 'playwright';
const URL='http://localhost:5173';
const TEACHER=['/teacher','/teacher/group','/teacher/evaluate','/teacher/sa','/teacher/portfolio','/teacher/analytics','/teacher/roster','/teacher/settings','/teacher/alumni','/teacher/review'];
const STUDENT=['/app','/app/patients','/app/criteria','/app/checkin','/app/search','/app/photos','/app/achievements','/app/self-assessment','/app/export','/app/sync'];
const b=await chromium.launch();
const problems=[];

async function setup(p, role) {
  await p.goto(URL,{waitUntil:'networkidle'}); await p.waitForTimeout(2200);
  await p.evaluate(async(role)=>{const d=await new Promise(r=>{const q=indexedDB.open('prostho-tracker');q.onsuccess=()=>r(q.result);});
    await new Promise(r=>{const tx=d.transaction('kv','readwrite');
      tx.objectStore('kv').put({key:'session',value:{role,studentId:'st-TH-PT7-1',teacherId:'tc-TH-PT7-1'}});tx.oncomplete=()=>r();});}, role);
  await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(1800);
}

async function scan(p, route, label) {
  await p.goto(`${URL}/#${route}`,{waitUntil:'networkidle'}); await p.waitForTimeout(1100);
  await p.evaluate(()=>document.querySelectorAll('.backdrop').forEach(x=>x.click()));
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => {
    const main = document.querySelector('main') || document.querySelector('.screen') || document.body;
    const txt = document.body.innerText;
    // ล้นแนวนอนจริง = ไม่มี parent ไหนเลื่อนแนวนอนได้
    const scrollableUp = (el) => { let n = el; while (n && n !== document.body) { const cs = getComputedStyle(n);
      if (/auto|scroll/.test(cs.overflowX)) return true; n = n.parentElement; } return false; };
    const over = [...document.querySelectorAll('main *,.screen *')]
      .filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !scrollableUp(e))
      .slice(0,3).map(e => e.tagName + '.' + (e.className||'').toString().slice(0,30));
    // ตัวอักษรไทยถูกบีบตกบรรทัดทีละตัว
    const squeezed = [...document.querySelectorAll('main *,.screen *')]
      .filter(e => { const b=e.getBoundingClientRect(); return b.width>0 && b.width<70 && b.height>90 && !e.children.length; })
      .slice(0,3).map(e => (e.textContent||'').slice(0,20));
    // ปุ่มเล็กกว่ามาตรฐานนิ้ว
    const small = [...document.querySelectorAll('button')]
      .filter(x => { const b=x.getBoundingClientRect(); return b.width>0 && b.height>0 && b.height<32 && !x.className.includes('iconbtn'); })
      .slice(0,3).map(x => `${(x.textContent||'').trim().slice(0,14)}=${Math.round(x.getBoundingClientRect().height)}px`);
    // แถวปุ่มตกบรรทัด
    const wrapped = [...document.querySelectorAll('.seg')].filter(s => s.getBoundingClientRect().height > 60).length;
    return {
      undef: /\bundefined\b/.test(txt), nan: /\bNaN\b/.test(txt), objobj: txt.includes('[object Object]'),
      pageOverflow: main.scrollWidth - main.clientWidth, over, squeezed, small, wrapped,
      empty: txt.trim().length < 40,
    };
  });
  const bad=[];
  if (r.undef) bad.push('มีคำว่า undefined บนจอ');
  if (r.nan) bad.push('มี NaN บนจอ');
  if (r.objobj) bad.push('[object Object]');
  if (r.pageOverflow > 1) bad.push(`ทั้งหน้าล้น ${r.pageOverflow}px`);
  if (r.over.length) bad.push('ล้นขอบ: '+r.over.join(','));
  if (r.squeezed.length) bad.push('ตัวอักษรถูกบีบ: '+r.squeezed.join(','));
  if (r.small.length) bad.push('ปุ่มเตี้ยกว่า 32px: '+r.small.join(','));
  if (r.wrapped) bad.push(`แถวปุ่มตกบรรทัด ${r.wrapped} แถว`);
  if (r.empty) bad.push('หน้าว่าง');
  if (bad.length) problems.push(`${label} ${route} → ${bad.join(' · ')}`);
}

for (const [w,h,label] of [[1440,900,'เดสก์ท็อป'],[402,874,'iPhone'],[320,568,'iPhone SE']]) {
  for (const role of ['teacher','student']) {
    const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:w<800,hasTouch:w<800,deviceScaleFactor:1});
    const p=await ctx.newPage();
    const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120))});
    p.on('pageerror',e=>errs.push('PAGEERROR '+e.message.slice(0,120)));
    await setup(p, role);
    for (const route of (role==='teacher'?TEACHER:STUDENT)) await scan(p, route, `[${label}/${role==='teacher'?'อจ':'นศ'}]`);
    if (errs.length) problems.push(`[${label}/${role}] console error: ${[...new Set(errs)].slice(0,3).join(' | ')}`);
    await ctx.close();
  }
}
console.log(problems.length ? problems.join('\n') : '✅ ไม่เจอปัญหาในรอบสแกนหน้าจอ');
await b.close();
