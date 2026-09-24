import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanJobText, separateJobDuties } from '../src/jobText.js';
import { detailFields } from '../src/publicJobDetail.js';
test('legacy punctuation is repaired without adding new words', () => {
 assert.equal(cleanJobText('문화 행정 일반 한식 관광 ( , , K-Beauty, 성과관리 등 )'),
   '문화 행정 일반(한식, 관광, K-Beauty, 성과관리 등)');
 assert.equal(cleanJobText('일반 ( 한식 , 관광 , K-Beauty )'), '일반(한식, 관광, K-Beauty)');
});
test('partial dates are not invented and general duties remain in detail only', () => {
 const responsibilities=['행사 운영', '기타 원장이 정하는 업무', '30 까지 근무 예정임'];
 const separated=separateJobDuties(responsibilities);
 assert.deepEqual(separated.duties,['행사 운영','기타 원장이 정하는 업무']);
 assert.deepEqual(separated.employmentNotes,['근무기간은 원문 확인 필요']);
 assert.equal(responsibilities.length,3);
});
test('full employment dates are retained separately from duties and deadlines', () => {
 const fields=detailFields(['담당 업무','행사 운영','※ 상기 임시직 행정직원은 2027.9.30까지 근무 예정임','2. 근로계약 조건'],{deadline:'2026-09-07'});
 assert.deepEqual(fields.responsibilities,['행사 운영']);
 assert.match(fields.employmentNotes[0],/2027\.9\.30/);
 assert.equal(fields.deadline,'2026-09-07');
 assert.equal(separateJobDuties(['계약기간 관리 업무']).duties.length,1);
});
