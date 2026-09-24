import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupeCandidates } from '../src/dedupeCandidates.js';
import { normalizeCandidate, normalizeSourceUrl } from '../src/normalizeCandidate.js';
import { runRadarPipeline } from '../src/runPipeline.js';

const raw = {
  title: '  화물   지상직 ',
  company: '대한항공',
  category: 'operations',
  city: '상하이',
  country: '중국',
  responsibilities: [' 현장 운영 ', '현장 운영', '고객 대응'],
  deadline: '2026-10-20T10:00:00+08:00',
  sourceName: '51job',
  sourceUrl: 'https://jobs.51job.com/a/123/?utm_source=wechat#apply',
};

test('tracking parameters are removed from source URLs', () => {
  assert.equal(normalizeSourceUrl(raw.sourceUrl), 'https://jobs.51job.com/a/123');
});

test('normalization creates a deterministic draft matching the collector contract', () => {
  const first = normalizeCandidate(raw, { collectedAt: '2026-09-06T00:00:00.000Z' });
  const second = normalizeCandidate(raw, { collectedAt: '2026-09-07T00:00:00.000Z' });
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'draft');
  assert.equal(first.title, '화물 지상직');
  assert.deepEqual(first.responsibilities, ['현장 운영', '고객 대응']);
  assert.equal(first.deadline, '2026-10-20');
  assert.equal(runRadarPipeline([raw])[0].errors.length, 0);
});

test('duplicates are detected by canonical URL across batches', () => {
  const existing = normalizeCandidate(raw);
  const duplicate = normalizeCandidate({ ...raw, sourceUrl: `${raw.sourceUrl}&utm_medium=chat` });
  const [result] = dedupeCandidates([duplicate], [existing]);
  assert.equal(result.status, 'duplicate');
  assert.equal(result.radar.duplicateOf, existing.id);
});

test('same-batch content duplicates are marked after the first record', () => {
  const records = [normalizeCandidate(raw), normalizeCandidate({ ...raw, sourceUrl: 'https://example.com/other' })];
  const [first, second] = dedupeCandidates(records);
  assert.equal(first.status, 'draft');
  assert.equal(second.status, 'duplicate');
});
