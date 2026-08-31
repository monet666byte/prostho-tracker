/**
 * สั่นเบาๆ ตอนกดปุ่มสำคัญ (ยืนยัน step · เช็คอิน)
 *
 * ความจริงที่ต้องรู้: iPhone ทำไม่ได้ — Safari บน iOS ไม่เปิด API สั่นให้เว็บเลย
 * (เป็นข้อจำกัดของ Apple ไม่ใช่ของเรา แอปเว็บทุกตัวโดนเหมือนกัน)
 * โค้ดนี้จึงมีผลเฉพาะ Android ส่วน iPhone เป็น no-op เงียบๆ ไม่ error
 */
export function tapFeedback(ms = 10): void {
  try { navigator.vibrate?.(ms); } catch { /* บางเบราว์เซอร์ block ก็เงียบไป */ }
}
