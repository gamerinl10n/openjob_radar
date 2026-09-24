import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildGitHubSummary } from '../scripts/githubSummary.js';

test('manual workflow never schedules, commits or publishes collected data', async () => {
  const workflow = await readFile(new URL('../.github/workflows/collect.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /^run-name: "Collect .*#\$\{\{ github\.run_number \}\}"$/m);
  assert.doesNotMatch(workflow, /^\s+(?:schedule|push):/m);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /OUTPUT_DIRECTORY\/data\/last-run\.json/);
  assert.doesNotMatch(workflow, /git\s+(?:commit|push)|npm\s+publish/);
});

test('GitHub summary reports review counts and escapes table content', () => {
  const summary = buildGitHubSummary(
    {
      ranAt: '2026-09-25T00:00:00.000Z',
      selectedSources: ['kotra'],
      results: [{
        id: 'kotra',
        name: 'KOTRA | 본사',
        found: 3,
        exclusions: [{ reason: 'expired' }],
        warnings: ['changed'],
        error: null,
      }],
    },
    { ready: [{ id: 'one' }], needsReview: [{ id: 'two' }, { id: 'three' }] },
  );

  assert.match(summary, /등록 검토: 1건/);
  assert.match(summary, /확인 필요: 2건/);
  assert.match(summary, /KOTRA \\| 본사/);
  assert.match(summary, /\| 3 \| 1 \| 1 \| 완료 \|/);
  assert.match(summary, /자동 반영되지 않습니다/);
});
