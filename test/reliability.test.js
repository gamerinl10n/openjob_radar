import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { exportBackup, restoreBackup } from '../src/backup.js';
import { readJson, writeJson, acquireLock } from '../src/storage.js';
import { updateSourceHealth } from '../src/sourceHealth.js';
import { createRadarServer } from '../src/appServer.js';
const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const pending = { id: 'pending-1', title: '검토 공고', url: 'https://example.com/1', sourceId: 'culture' };

test('failed and partial attempts preserve last successful collection per source', () => {
  let health = updateSourceHealth({}, [{ id: 'culture', name: '문화원', found: 0 }], '2026-10-01');
  health = updateSourceHealth(health, [{ id: 'culture', error: 'DNS' }, { id: 'worldjob', warnings: ['일부 상세 실패'] }], '2026-10-02');
  assert.equal(health.culture.lastSuccessAt, '2026-10-01');
  assert.equal(health.culture.state, 'failed');
  assert.equal(health.worldjob.state, 'partial');
  health = updateSourceHealth(health, [{ id: 'worldjob' }], '2026-10-03');
  assert.equal(health.culture.lastAttemptAt, '2026-10-02');
  assert.equal(health.worldjob.lastSuccessAt, '2026-10-03');
});

test('backup restore preserves pre-restore data and rejects malformed files without mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-backup-'));
  await writeJson(join(root, 'data/review.json'), { ready: [], needsReview: [pending] });
  const backup = await exportBackup(root);
  await writeJson(join(root, 'data/review.json'), { ready: [], needsReview: [] });
  const restored = await restoreBackup(root, backup);
  assert.equal((await readJson(join(root, 'data/review.json'))).needsReview.length, 1);
  const safety = await readJson(join(root, 'data/backups', restored.safetyName));
  assert.equal(safety.files['review.json'].needsReview.length, 0);
  const malformed = structuredClone(backup);
  malformed.files['../outside.json'] = {};
  await assert.rejects(restoreBackup(root, malformed), /구성/);
  malformed.files = structuredClone(backup.files);
  malformed.files['review.json'].needsReview[0].requirements = {};
  await assert.rejects(restoreBackup(root, malformed), /세부/);
  assert.equal((await readJson(join(root, 'data/review.json'))).needsReview.length, 1);
  assert.equal((await readdir(join(root, 'data/backups'))).length, 1);
  const release = await acquireLock(join(root, 'data/.operation.lock'));
  try { await assert.rejects(exportBackup(root), /다른 작업/); } finally { await release(); }
});

test('excluding then undoing exclusion restores original queue and removes exclusion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-unreject-'));
  await writeJson(join(root, 'data/review.json'), { ready: [], needsReview: [pending] });
  const options = { env: { ...process.env, OPENJOB_RADAR_HOME: root } };
  await run(process.execPath, [cli, 'reject', '--id', pending.id], options);
  await run(process.execPath, [cli, 'unreject', '--id', pending.id], options);
  assert.equal((await readJson(join(root, 'data/rejected.json'))).length, 0);
  assert.deepEqual((await readJson(join(root, 'data/review.json'))).needsReview, [pending]);
});

test('retry API selects only failed sources; backup API restores exported data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radar-api-'));
  const health = updateSourceHealth({}, [{ id: 'culture', error: 'DNS' }, { id: 'kotra' }], new Date().toISOString());
  await writeJson(join(root, 'data/source-health.json'), health);
  const calls = [];
  const server = createRadarServer({ workspaceRoot: root, runner: async (_, args) => { calls.push(args); return { stdout: '완료' }; } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
    assert.equal((await post('/api/retry', {})).status, 200);
    assert.deepEqual(calls, [['collect', '--source', 'culture']]);
    const response = await fetch(base + '/api/backup');
    assert.match(response.headers.get('content-disposition'), /attachment/);
    assert.equal((await post('/api/restore', await response.json())).status, 200);
    assert.equal((await fetch(base + '/api/restore', { method: 'POST', headers: { Origin: 'https://example.com' }, body: '{}' })).status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
