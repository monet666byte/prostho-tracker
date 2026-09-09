/**
 * รวมทางเข้าหน้าฝั่งนักศึกษาไว้จุดเดียว เพื่อให้ทั้งกลุ่มถูกแยกเป็นก้อนเดียว
 * ถ้า React.lazy ชี้ไปที่ไฟล์รายหน้า จะได้ก้อนละหน้า ~13 คำขอ
 * เน็ตคลินิกช้าที่ค่า latency มากกว่าที่ปริมาณ — คำขอเยอะกว่าเจ็บกว่าไฟล์ใหญ่กว่า
 */
export { default as Achievements } from './Achievements';
export { default as CheckIn } from './CheckIn';
export { default as Criteria } from './Criteria';
export { default as Export } from './Export';
export { default as Home } from './Home';
export { default as NewWorkpiece } from './NewWorkpiece';
export { default as Patients } from './Patients';
export { default as Photos } from './Photos';
export { default as Portfolio } from './Portfolio';
export { default as Search } from './Search';
export { default as SelfAssess } from './SelfAssess';
export { default as Sync } from './Sync';
export { default as WorkpieceDetail } from './WorkpieceDetail';
