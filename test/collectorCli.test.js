import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = new URL('../src/cli.js', import.meta.url);
const json = (path, value) => writeFile(path, JSON.stringify(value), 'utf8');
const job = {
  id: 'radar-1',
  radarId: 'source:1',
  slug: 'sample-job',
  title: '샘플 공고',
  company: { name: '샘플 회사', logoUrl: null },
  category: 'other',
  location: { country: '중국', city: '상하이', workplace: null, remote: false },
  languages: [],
  responsibilities: ['업무'],
  requirements: ['자격'],
  preferred: [],
  application: { method: '원문 지원', url: 'https://example.com/job/1' },
  source: { name: '샘플 출처', url: 'https://example.com/job/1', externalId: '1' },
  status: 'draft',
};

test('CLI approval records reviewed JSON without a database or website', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openjob-radar-'));
  const review = join(dir, 'review.json');
  const approved = join(dir, 'approved.json');
  await json(review, { schemaVersion: 1, updatedAt: null, ready: [job], needsReview: [] });
  await json(approved, []);

  const { stdout } = await run(process.execPath, [fileURLToPath(cli), 'approve', '--id', job.id, '--review', review, '--approved', approved]);
  assert.match(stdout, /1건을 승인/);
  const jobs = JSON.parse(await readFile(approved, 'utf8'));
  const queue = JSON.parse(await readFile(review, 'utf8'));
  assert.equal(jobs[0].status, 'published');
  assert.match(jobs[0].verifiedAt, /^20\d{2}-/);
  assert.equal(queue.ready.length, 0);
});

test('CLI rejection keeps an auditable file record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openjob-radar-'));
  const review = join(dir, 'review.json');
  const rejected = join(dir, 'rejected.json');
  const pending = { id: 'pending-1', title: '이미지 공고', url: 'https://example.com/job/2', reason: '이미지 확인' };
  await json(review, { schemaVersion: 1, updatedAt: null, ready: [], needsReview: [pending] });
  await json(rejected, []);

  await run(process.execPath, [fileURLToPath(cli), 'reject', '--id', pending.id, '--review', review, '--rejected', rejected]);
  const queue = JSON.parse(await readFile(review, 'utf8'));
  const archive = JSON.parse(await readFile(rejected, 'utf8'));
  assert.equal(queue.needsReview.length, 0);
  assert.equal(archive[0].id, pending.id);
  assert.match(archive[0].rejectedAt, /^20\d{2}-/);
});

test('package is standalone, attributed and database-free', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'openjob-radar');
  assert.equal(pkg.dependencies?.['@supabase/supabase-js'], undefined);
  for (const file of ['../src/cli.js', '../src/publicJobSources.js']) {
    assert.doesNotMatch(await readFile(new URL(file, import.meta.url), 'utf8'), /supabase|AuthProvider|ADMIN_REVIEW/);
  }
  assert.match(await readFile(new URL('../README.md', import.meta.url), 'utf8'), /github\.com\/gamerinl10n\/dreamdurim/);
  assert.match(await readFile(new URL('../NOTICE', import.meta.url), 'utf8'), /originated from.*DREAMDURIM/is);
});
