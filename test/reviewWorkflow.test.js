import test from 'node:test';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeJson, readJson, recoverTransaction, acquireLock } from '../src/storage.js';
import { createRadarServer } from '../src/appServer.js';
const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('pending notice can be edited, approved, and found in history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-review-'));
  const path = join(root, 'data/review.json');
  await writeJson(path, { ready: [], needsReview: [{ id: 'pending-1', sourceId: 'culture', title: '공고', url: 'https://example.com/1' }] });
  const options = { env: { ...process.env, OPENJOB_RADAR_HOME: root } };
  const patch = { title: '한국어 번역가', company: '테스트 회사', country: '중국', city: '상하이', responsibilities: '게임 번역', requirements: '중국어 능통', deadline: '2026-12-31' };
  await run(process.execPath, [cli, 'edit', '--id', 'pending-1', '--patch', JSON.stringify(patch)], options);
  const review = await readJson(path);
  assert.equal(review.needsReview.length, 0);
  assert.equal(review.ready[0].title, patch.title);
  await run(process.execPath, [cli, 'approve', '--id', review.ready[0].id], options);
  assert.equal((await readJson(path)).ready.length, 0);
  assert.equal((await readJson(join(root, 'data/approved.json')))[0].company.name, patch.company);
});

test('interrupted multi-file transaction replays without losing approved records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-recovery-'));
  const review = join(root, 'review.json');
  const approved = join(root, 'approved.json');
  const journal = join(root, 'transaction.json');
  const entry = { id: 'radar-1' };
  await writeJson(review, { ready: [entry] });
  await writeJson(approved, [entry]);
  await writeJson(journal, { entries: [[approved, [entry]], [review, { ready: [] }]] });
  await recoverTransaction(journal);
  await recoverTransaction(journal);
  assert.deepEqual(await readJson(approved), [entry]);
  assert.deepEqual(await readJson(review), { ready: [] });
});

test('concurrent commands cannot take the same workspace lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-lock-'));
  const path = join(root, '.lock');
  const release = await acquireLock(path);
  await assert.rejects(acquireLock(path), /다른 작업/);
  await release();
  await (await acquireLock(path))();
});

test('desktop API requires its token and rejects another host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-token-'));
  const server = createRadarServer({ workspaceRoot: root, authToken: 'test-secret' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/status`;
  try {
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { 'X-Radar-Token': 'test-secret' } })).status, 200);
    const status = await new Promise((resolve, reject) => get(url, { headers: { 'X-Radar-Token': 'test-secret', Host: 'attacker.test' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject));
    assert.equal(status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('rejected ready and pending notices stay excluded on the next collection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-recollect-'));
  const mock = join(root, 'fetch.mjs');
  const { writeFile } = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  await writeFile(mock, `globalThis.fetch = async (url) => new Response(url.includes('/view.do')
    ? '<div class="viewCon"><p>담당 업무: 행사 운영 및 행정 업무 지원</p><p>지원 자격: 중국어 능통자</p></div>'
    : '<table><tr><td><a href="/recruitmentNoti/view.do?seq=1">주상하이한국문화원 채용</a></td><td>2026.09.01</td><td>2099.01.31</td></tr><tr><td><a href="/recruitmentNoti/view.do?seq=2">행정직원 채용</a></td><td>2026.09.01</td><td>2099.01.31</td></tr></table>');`);
  const options = { env: { ...process.env, OPENJOB_RADAR_HOME: root } };
  const collect = () => run(process.execPath, ['--import', pathToFileURL(mock).href, cli, 'collect', '--source', 'culture'], options);
  await collect();
  const before = await readJson(join(root, 'data/review.json'));
  assert.equal(before.ready.length, 1);
  assert.equal(before.needsReview.length, 1);
  await run(process.execPath, [cli, 'reject', '--id', [...before.ready, ...before.needsReview].map((job) => job.id).join(',')], options);
  await collect();
  const after = await readJson(join(root, 'data/review.json'));
  assert.equal(after.ready.length, 0);
  assert.equal(after.needsReview.length, 0);
  assert.equal((await readJson(join(root, 'data/rejected.json'))).length, 2);
});
