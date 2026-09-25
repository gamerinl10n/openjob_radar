import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRadarServer } from '../src/appServer.js';

const json = (path, value) => writeFile(path, JSON.stringify(value), 'utf8');
const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address()));
});
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

test('local app is read-only until a user posts an action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openjob-radar-app-'));
  await mkdir(join(root, 'data'));
  await json(join(root, 'data/review.json'), {
    schemaVersion: 1,
    updatedAt: null,
    ready: [{ id: 'radar-1', title: '검토 공고', source: { url: 'https://example.com/1' } }],
    needsReview: [],
  });
  await json(join(root, 'data/approved.json'), []);
  await json(join(root, 'data/rejected.json'), []);
  const calls = [];
  const server = createRadarServer({ workspaceRoot: root, runner: async (_root, args) => {
    calls.push(args);
    return { stdout: '완료', stderr: '' };
  } });
  const address = await listen(server);
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(base).then((response) => response.text());
    const status = await fetch(`${base}/api/status`).then((response) => response.json());
    assert.match(page, /선택 출처 수집/);
    assert.equal(status.review.ready.length, 1);
    assert.deepEqual(calls, []);

    const response = await fetch(`${base}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ sources: ['kotra'], dryRun: true }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [['collect', '--source', 'kotra', '--dry-run']]);
  } finally {
    await close(server);
  }
});

test('local app rejects cross-origin mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openjob-radar-origin-'));
  const server = createRadarServer({ workspaceRoot: root, runner: async () => ({ stdout: '', stderr: '' }) });
  const address = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://malicious.example' },
      body: JSON.stringify({ sources: ['kotra'] }),
    });
    assert.equal(response.status, 403);
  } finally {
    await close(server);
  }
});
