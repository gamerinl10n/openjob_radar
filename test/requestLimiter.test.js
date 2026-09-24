import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestLimiter } from '../src/requestLimiter.js';

test('요청 제한기는 동시에 실행되는 작업 수를 제한한다', async () => {
  const limit = createRequestLimiter(3);
  let active = 0;
  let maximum = 0;

  const values = await Promise.all(Array.from({ length: 12 }, (_, index) => limit(async () => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return index;
    } finally {
      active--;
    }
  })));

  assert.equal(maximum, 3);
  assert.deepEqual(values, Array.from({ length: 12 }, (_, index) => index));
});

test('실패한 요청 뒤에도 대기 중인 작업을 계속 실행한다', async () => {
  const limit = createRequestLimiter(1);
  await assert.rejects(limit(async () => {
    throw new Error('출처 요청 실패');
  }), /출처 요청 실패/);
  assert.equal(await limit(async () => '다음 요청 완료'), '다음 요청 완료');
});

test('잘못된 동시 요청 수와 작업을 거부한다', async () => {
  assert.throws(() => createRequestLimiter(0), /1 이상의 정수/);
  await assert.rejects(createRequestLimiter(1)(null), /요청 함수/);
});
