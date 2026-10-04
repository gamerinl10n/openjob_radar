import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { exportBackup, restoreBackup } from './backup.js';
import { readJson } from './storage.js';

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
const webRoot = fileURLToPath(new URL('./web/', import.meta.url));
const sourceIds = new Set(['culture', 'kotra', 'worldjob']);
const emptyReview = () => ({ schemaVersion: 1, updatedAt: null, ready: [], needsReview: [] });

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

const json = (response, status, value) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  response.end(JSON.stringify(value));
};

const bodyOf = async (request, limit = 16_384) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new Error('요청이 너무 큽니다.');
  }
  return body ? JSON.parse(body) : {};
};

const idsOf = (value) => {
  if (!Array.isArray(value)) throw new Error('공고 ID 목록이 필요합니다.');
  const ids = [...new Set(value.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length || ids.length > 100 || ids.some((id) => id.length > 200)) {
    throw new Error('공고 ID를 1~100개 선택하세요.');
  }
  return ids;
};

const sameOrigin = (request) => {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === `http://${request.headers.host}`;
};

export const readRadarStatus = async (workspaceRoot) => {
  const dataRoot = resolve(workspaceRoot, 'data');
  const [review, approved, rejected, lastRun, sourceHealth] = await Promise.all([
    readJson(resolve(dataRoot, 'review.json'), emptyReview()),
    readJson(resolve(dataRoot, 'approved.json'), []),
    readJson(resolve(dataRoot, 'rejected.json'), []),
    readJson(resolve(dataRoot, 'last-run.json'), null),
    readJson(resolve(dataRoot, 'source-health.json'), {}),
  ]);

  return {
    review,
    approved, rejected,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
    lastRun, sourceHealth,
  };
};

export const runCli = async (workspaceRoot, args) => {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    env: { ...process.env, OPENJOB_RADAR_HOME: workspaceRoot, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    timeout: 10 * 60 * 1000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
};

export const createRadarServer = ({ workspaceRoot = process.cwd(), runner = runCli, authToken = null } = {}) => {
  const root = resolve(workspaceRoot);
  let operation = null;

  const server = createServer(async (request, response) => {
    try {
      const expectedHost = `127.0.0.1:${server.address()?.port}`;
      if (authToken && (request.headers['x-radar-token'] !== authToken || request.headers.host !== expectedHost)) {
        json(response, 403, { error: '앱에서만 접근할 수 있습니다.' }); return;
      }
      const url = new URL(request.url || '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/status') {
        json(response, 200, { ...(await readRadarStatus(root)), operation });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/backup') {
        if (operation) { json(response, 409, { error: '작업이 끝난 뒤 백업해 주세요.' }); return; }
        operation = { label: '백업', startedAt: new Date().toISOString() };
        try {
          const backup = await exportBackup(root);
          response.setHeader('Content-Disposition', 'attachment; filename="OpenJob-Radar-backup.json"');
          json(response, 200, backup);
        } finally { operation = null; }
        return;
      }

      if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (!sameOrigin(request)) {
          json(response, 403, { error: '다른 사이트에서 보낸 요청은 허용하지 않습니다.' });
          return;
        }
        if (operation) {
          json(response, 409, { error: `${operation.label} 작업이 이미 실행 중입니다.` });
          return;
        }

        const body = await bodyOf(request, url.pathname === '/api/restore' ? 10 * 1024 * 1024 : 16_384);
        if (operation) { json(response, 409, { error: '다른 작업이 실행 중입니다.' }); return; }
        if (url.pathname === '/api/restore') {
          operation = { label: '복원', startedAt: new Date().toISOString() };
          try {
            const restored = await restoreBackup(root, body);
            json(response, 200, { ok: true, output: { stdout: '백업을 복원했습니다. 복원 직전 데이터도 backups 폴더에 보관했습니다.' }, status: await readRadarStatus(root), ...restored });
          } finally { operation = null; }
          return;
        }
        let args;
        let label;
        if (url.pathname === '/api/retry') {
          const health = (await readRadarStatus(root)).sourceHealth;
          const sources = [...sourceIds].filter((id) => health[id]?.state === 'failed');
          if (!sources.length) throw new Error('재시도할 실패 출처가 없습니다.');
          args = ['collect', '--source', sources.join(',')];
          label = '실패 출처 재수집';
        } else if (url.pathname === '/api/unreject') {
          args = ['unreject', '--id', idsOf(body.ids).join(',')]; label = '제외 취소';
        } else if (url.pathname === '/api/collect') {
          const sources = Array.isArray(body.sources)
            ? [...new Set(body.sources.map(String).filter((id) => sourceIds.has(id)))]
            : [];
          if (!sources.length) throw new Error('수집할 출처를 하나 이상 선택하세요.');
          args = ['collect', '--source', sources.join(',')];
          if (body.dryRun === true) args.push('--dry-run');
          label = '공고 수집';
        } else if (url.pathname === '/api/edit') {
          args = ['edit', '--id', idsOf(body.ids).join(','), '--patch', JSON.stringify(body.patch || {})];
          label = '수정';
        } else if (url.pathname === '/api/approve') {
          args = ['approve', '--id', idsOf(body.ids).join(',')];
          label = '승인';
        } else if (url.pathname === '/api/reject') {
          args = ['reject', '--id', idsOf(body.ids).join(',')];
          label = '제외';
        } else {
          json(response, 404, { error: '요청한 기능을 찾지 못했습니다.' });
          return;
        }

        if (operation) { json(response, 409, { error: '다른 작업이 실행 중입니다.' }); return; }
        operation = { label, startedAt: new Date().toISOString() };
        try {
          const output = await runner(root, args);
          json(response, 200, { ok: true, output, status: await readRadarStatus(root) });
        } finally {
          operation = null;
        }
        return;
      }

      const staticFile = request.method === 'GET' ? staticFiles.get(url.pathname) : null;
      if (staticFile) {
        const [file, contentType] = staticFile;
        response.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
        });
        response.end(await readFile(resolve(webRoot, file)));
        return;
      }

      json(response, 404, { error: '페이지를 찾지 못했습니다.' });
    } catch (error) {
      json(response, 500, {
        error: error.message || '작업을 완료하지 못했습니다.',
        output: { stdout: error.stdout?.trim?.() || '', stderr: error.stderr?.trim?.() || '' },
      });
    }
  });
  server.radarBusy = () => Boolean(operation);
  return server;
};
