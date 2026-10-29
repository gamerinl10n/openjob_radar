import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCandidates, sourceSnapshot, changedFields } from '../src/reviewInsights.js';
import { createCandidateFingerprint, normalizeSourceUrl } from '../src/normalizeCandidate.js';

// Previous linear scan is a behavioral oracle, not production code.
const url = (job) => normalizeSourceUrl(job.source?.url || job.sourceUrl || job.url);
const sameContent = (a, b) => Boolean(a.company?.name && b.company?.name && a.title && b.title && a.deadline && b.deadline && a.location?.country && b.location?.country)
  && createCandidateFingerprint(a) === createCandidateFingerprint(b)
  && (a.location?.country || '') === (b.location?.country || '') && a.deadline === b.deadline;

// Never replace human edits or published fields with freshly scraped values.
function reconcileByScan(candidates, ready = [], approved = [], now = new Date().toISOString()) {
  const records = [...ready, ...approved].map((job) => structuredClone(job));
  const added = []; let duplicates = 0; let changed = 0;
  for (const job of candidates) {
    const old = [...records, ...added].find((item) => url(item) === url(job) || sameContent(item, job));
    if (!old) {
      added.push({ ...job, radar: { ...job.radar, sourceSnapshot: sourceSnapshot(job), lastCheckedAt: now } });
      continue;
    }
    duplicates++;
    old.radar ||= {};
    if (url(old) !== url(job)) {
      old.radar.relatedSources = [...new Map([...(old.radar.relatedSources || []), job.source].map((source) => [source.url, source])).values()];
      continue;
    }
    const snapshot = sourceSnapshot(job);
    // Existing installations have no raw baseline: start one without mistaking edits for source changes.
    if (old.radar.sourceSnapshot) {
      const baseline = old.radar.changeBaseline || old.radar.sourceSnapshot;
      const changes = changedFields(baseline, snapshot);
      old.radar.sourceChanges = changes;
      old.radar.changeBaseline = changes.length ? baseline : null;
      if (changes.length) { old.radar.changedAt = now; changed++; }
    }
    old.radar.sourceSnapshot = snapshot;
    old.radar.lastCheckedAt = now;
  }
  return { ready: [...records.slice(0, ready.length), ...added], approved: records.slice(ready.length), duplicates, changed };
}


function job(id, overrides = {}) {
  return { id, title: `Role ${id}`, company: { name: 'Example' },
    location: { country: 'KR', city: 'Seoul' }, deadline: '2030-01-01',
    source: { url: `https://example.com/${id}` }, ...overrides };
}

function compare(candidates, ready = [], approved = []) {
  const input = structuredClone({ candidates, ready, approved });
  const expected = reconcileByScan(...[candidates, ready, approved].map((value) => structuredClone(value)), 'now');
  assert.deepEqual(reconcileCandidates(candidates, ready, approved, 'now'), expected);
  assert.deepEqual({ candidates, ready, approved }, input, 'does not mutate input records');
}

test('earliest content match wins over a later URL match and human edits survive', () => {
  const first = job('first', { title: 'Same', summary: 'Human edit' });
  const second = job('second');
  compare([job('second', { title: 'Same' })], [first], [second]);
});

test('URL match wins when earlier, tracked URLs normalize, and added records are indexed', () => {
  compare([job('first', { title: 'Same', source: { url: 'https://example.com/first?utm_source=x' } }),
    job('new'), job('new', { summary: 'Updated source' })], [job('first')], [job('last', { title: 'Same' })]);
});

test('empty URLs, incomplete content, strict country and deadline, and repeated identities', () => {
  compare([job('missing', { source: {} }), job('other', { source: {} }),
    job('x', { deadline: null }), job('y', { deadline: null }),
    job('n', { deadline: 123 }), job('s', { deadline: '123' })],
    [job('ready', { source: {}, company: {} })]);
  compare([job('changed', { summary: 'new' }), job('changed', { summary: 'old' })],
    [job('changed', { summary: 'Human edit', radar: { sourceSnapshot: sourceSnapshot(job('changed', { summary: 'old' })) } })]);
});

test('deterministic mixed batches match the original scan', () => {
  let seed = 123456;
  const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const make = () => {
    const id = random(20);
    const item = job(id, { title: `Role ${random(12)}`, summary: `Text ${random(8)}`,
      company: { name: random(5) ? 'Example' : '' },
      location: { country: random(3) ? 'KR' : 'CN', city: `City ${random(3)}` },
      deadline: random(4) ? `2030-01-${random(3) + 1}` : null,
      source: { url: random(6) ? `https://example.com/${id}?utm_source=${random(5)}` : '' } });
    if (random(2)) item.radar = { sourceSnapshot: sourceSnapshot(item) };
    return item;
  };
  for (let batch = 0; batch < 100; batch++) {
    compare(Array.from({ length: 40 }, make), Array.from({ length: 15 }, make), Array.from({ length: 10 }, make));
  }
});
