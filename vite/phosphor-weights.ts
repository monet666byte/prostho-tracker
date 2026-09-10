import type { Plugin } from 'vite';

/**
 * ไอคอน Phosphor ทุกตัวแบกน้ำหนักเส้นมาครบ 6 แบบ (thin/light/regular/bold/fill/duotone)
 * เป็น Map ที่ประกอบตอน import — bundler มองไม่เห็นว่าปลายทางเรียกใช้แค่แบบไหน
 * เลยตัดทิ้งเองไม่ได้ กลายเป็น 273 KB ในบันเดิล ทั้งที่แอปใช้จริงแค่ 3 แบบ
 *
 * ปลั๊กอินนี้ตัดรายการน้ำหนักที่แอปไม่เรียกออกจาก Map ตั้งแต่ตอน transform
 * ทำที่ชั้นนี้เพราะไม่ต้องแตะ import ใน 39 ไฟล์ และ IconContext/props ยังทำงานเหมือนเดิมทุกอย่าง
 *
 * ⚠️ KEEP ต้องครอบคลุมทุกค่าที่ส่งเข้า prop `weight` ในแอป (รวมค่าที่คำนวณตอนรัน
 * เช่น `weight={active ? 'fill' : 'regular'}`) และค่า default ของ IconContext ('regular')
 * ถ้าวันหน้าจะใช้น้ำหนักใหม่ ต้องเติมที่นี่ด้วย ไม่งั้นไอคอนจะหายไปเงียบ ๆ
 * — ตัวปลั๊กอินจะ throw ถ้าตัดแล้วเหลือไม่ครบตามที่สั่ง เพื่อกันกรณี Phosphor เปลี่ยนรูปแบบไฟล์
 */
const KEEP = new Set(['regular', 'bold', 'fill']);

/** หาตำแหน่งวงเล็บปิดที่คู่กับ open โดยข้ามเนื้อในสตริง (path data มีทั้ง , และวงเล็บ) */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
  const stack: string[] = [pairs[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      // ข้ามสตริงทั้งก้อน รวม escape
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === c) break;
      }
      continue;
    }
    if (c in pairs) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

export function phosphorWeights(): Plugin {
  return {
    name: 'prostho:phosphor-weights',
    // ต้องมาก่อน esbuild/minify แต่หลัง resolve — enforce 'pre' พอ
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@phosphor-icons/react') || !id.includes('/defs/')) return null;

      const mapStart = code.indexOf('new Map([');
      if (mapStart < 0) return null;
      const arrOpen = code.indexOf('[', mapStart);
      const arrClose = matchBracket(code, arrOpen);
      if (arrClose < 0) return null;

      // ไล่รายการ [ "weight", element ] ทีละอันในระดับบนสุดของ array
      const kept: string[] = [];
      const seen: string[] = [];
      let i = arrOpen + 1;
      while (i < arrClose) {
        if (code[i] !== '[') { i++; continue; }
        const end = matchBracket(code, i);
        if (end < 0 || end > arrClose) break;
        const entry = code.slice(i, end + 1);
        const weight = entry.match(/^\[\s*["']([a-z]+)["']/)?.[1];
        if (!weight) return null; // รูปแบบไม่ตรงที่คาด — ปล่อยผ่านดีกว่าตัดมั่ว
        seen.push(weight);
        if (KEEP.has(weight)) kept.push(entry);
        i = end + 1;
      }

      if (!seen.length) return null;
      const missing = [...KEEP].filter((w) => seen.includes(w) && !kept.some((e) => e.includes(`"${w}"`) || e.includes(`'${w}'`)));
      if (missing.length) throw new Error(`[phosphor-weights] ${id}: ตัดน้ำหนัก ${missing.join(',')} หายไปโดยไม่ตั้งใจ`);
      if (kept.length === seen.length) return null;

      const next = code.slice(0, arrOpen) + '[\n' + kept.join(',\n') + '\n]' + code.slice(arrClose + 1);
      return { code: next, map: null };
    },
  };
}
