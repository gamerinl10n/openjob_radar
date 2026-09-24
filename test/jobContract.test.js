import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJob, JOB_STATUSES } from '../src/contract.js';

test('수집기 승인 경계에 필요한 필드를 검사한다', () => {
  const valid = {
    id: 'public-1',
    radarId: 'radar-1',
    slug: 'sample-job',
    title: '샘플 직무',
    company: { name: '샘플 회사' },
    category: 'operations',
    source: { name: '51job', url: 'https://jobs.example.com/1' },
    status: JOB_STATUSES.PUBLISHED,
  };
  assert.deepEqual(validateJob(valid), []);
  assert.deepEqual(validateJob({ ...valid, slug: '', source: {} }), [
    'slug',
    'source.name',
    'source.url',
  ]);
});
