#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectPublicJobCandidates, SOURCES } from './publicJobSources.js';
import { canonicalKotraUrl } from './kotra.js';
import { canonicalWorldjobUrl } from './worldjob.js';
import { JOB_STATUSES, validateJob } from './contract.js';
import { runRadarPipeline } from './runPipeline.js';
import { pendingId, readJson, sourceUrlOf, writeJson } from './storage.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const defaults = {
  review: resolve(repoRoot, 'collector/data/review.json'),
  rejected: resolve(repoRoot, 'collector/data/rejected.json'),
  lastRun: resolve(repoRoot, 'collector/data/last-run.json'),
  state: resolve(repoRoot, 'collector/data/state.json'),
  published: resolve(repoRoot, 'src/data/jobs.json'),
};

const help = `DREAMDURIM 공개 공고 수집기

사용법:
  dreamdurim-collect collect [--source culture,kotra,worldjob] [--dry-run]
  dreamdurim-collect list
  dreamdurim-collect approve --id <공고 ID>[,<공고 ID>]
  dreamdurim-collect reject --id <공고 ID>[,<공고 ID>]

기본 파일:
  collector/data/review.json   수집 후 사람이 검토할 공고
  collector/data/last-run.json 최근 실행 보고서
  collector/data/state.json    월드잡 이어보기 위치
  src/data/jobs.json           홈페이지에 공개되는 공고

collect는 자동 게시하지 않습니다. approve를 실행하기 전에 review.json과 원문을 확인하세요.
`;

const args = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    source: { type: 'string' },
    id: { type: 'string' },
    review: { type: 'string' },
    rejected: { type: 'string' },
    report: { type: 'string' },
    state: { type: 'string' },
    published: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const command = args.positionals[0] || 'help';
const paths = {
  review: resolve(args.values.review || defaults.review),
  rejected: resolve(args.values.rejected || defaults.rejected),
  lastRun: resolve(args.values.report || defaults.lastRun),
  state: resolve(args.values.state || defaults.state),
  published: resolve(args.values.published || defaults.published),
};

const emptyReview = () => ({ schemaVersion: 1, updatedAt: null, ready: [], needsReview: [] });
const uniqueBy = (items, key) => [...new Map(items.filter(Boolean).map((item) => [key(item), item])).values()];
const requestedIds = () => String(args.values.id || '').split(',').map((value) => value.trim()).filter(Boolean);
const matchesId = (item, ids) => ids.includes(item?.id) || ids.includes(item?.radarId) || ids.includes(item?.slug);

async function collect() {
  const selected = String(args.values.source || SOURCES.map(({ id }) => id).join(','))
    .split(',').map((value) => value.trim()).filter(Boolean);
  const unknown = selected.filter((id) => !SOURCES.some((source) => source.id === id));
  if (unknown.length) throw new Error('지원하지 않는 출처입니다: ' + unknown.join(', '));

  const now = new Date().toISOString();
  const review = await readJson(paths.review, emptyReview());
  const published = await readJson(paths.published, []);
  const state = await readJson(paths.state, { schemaVersion: 1, worldjob: { nextPage: 1 } });
  const knownItems = [...published, ...(review.ready || []), ...(review.needsReview || [])];
  const knownUrls = new Set(knownItems.map(sourceUrlOf).filter(Boolean));
  const worldjobKnown = new Set([...knownUrls].map(canonicalWorldjobUrl).filter(Boolean));
  const knownKotraUrls = [...knownUrls].map(canonicalKotraUrl).filter(Boolean);

  const { results } = await collectPublicJobCandidates(selected, {
    worldjobProgress: { page: state.worldjob?.nextPage || 1, known: worldjobKnown },
    knownKotraUrls,
  });

  const existing = [...published, ...(review.ready || [])];
  const normalized = runRadarPipeline(results.flatMap((result) => result.candidates || []), existing, { collectedAt: now });
  const newReady = normalized
    .filter(({ job, errors }) => !errors.length && job.status !== JOB_STATUSES.DUPLICATE)
    .map(({ job }) => job);
  const invalid = normalized.filter(({ errors }) => errors.length);
  const ready = uniqueBy([...(review.ready || []), ...newReady], sourceUrlOf);

  const pending = results.flatMap((result) => (result.pending || []).map((item) => ({
    id: pendingId(item.url),
    sourceId: result.id,
    title: item.title,
    url: item.url,
    reason: item.reason,
    attachments: item.attachments || [],
    firstSeenAt: now,
    lastSeenAt: now,
  })));
  const previousPending = new Map((review.needsReview || []).map((item) => [item.url, item]));
  for (const item of pending) {
    const previous = previousPending.get(item.url);
    previousPending.set(item.url, previous ? { ...previous, ...item, firstSeenAt: previous.firstSeenAt || now } : item);
  }

  const nextReview = {
    schemaVersion: 1,
    updatedAt: now,
    ready,
    needsReview: [...previousPending.values()],
  };
  const report = {
    schemaVersion: 1,
    ranAt: now,
    selectedSources: selected,
    results: results.map(({ id, name, found, stats, exclusions, warnings, error, emptyReason, progress }) => ({
      id, name, found, stats, exclusions, warnings, error, emptyReason, progress,
    })),
    invalidCandidates: invalid.map(({ job, errors }) => ({ id: job.id, title: job.title, errors })),
  };

  const worldjob = results.find((result) => result.id === 'worldjob');
  const nextState = {
    schemaVersion: 1,
    updatedAt: now,
    worldjob: worldjob?.error || !worldjob?.progress
      ? state.worldjob || { nextPage: 1 }
      : { nextPage: worldjob.progress.nextPage, cycleComplete: worldjob.progress.cycleComplete },
  };

  if (!args.values['dry-run']) {
    await writeJson(paths.review, nextReview);
    await writeJson(paths.lastRun, report);
    await writeJson(paths.state, nextState);
  }

  for (const result of results) {
    console.log(`${result.name}: 등록 검토 ${result.candidates.length}건, 확인 필요 ${result.pending.length}건, 제외 ${result.exclusions.length}건`);
    if (result.error) console.error('  실패: ' + result.error);
  }
  console.log(args.values['dry-run'] ? '미리보기 실행이라 파일을 변경하지 않았습니다.' : '자동 게시하지 않았습니다. collector/data/review.json을 검토하세요.');
  if (results.some((result) => result.error)) process.exitCode = 1;
}

async function approve() {
  const ids = requestedIds();
  if (!ids.length) throw new Error('--id에 승인할 공고 ID를 지정하세요.');
  const review = await readJson(paths.review, emptyReview());
  const published = await readJson(paths.published, []);
  const selected = (review.ready || []).filter((item) => matchesId(item, ids));
  if (selected.length !== ids.length) throw new Error('검토 목록에서 승인할 ID를 모두 찾지 못했습니다.');

  const knownUrls = new Set(published.map(sourceUrlOf));
  const approvedAt = new Date().toISOString();
  const approved = selected.map((job) => {
    const errors = validateJob(job);
    if (errors.length) throw new Error(job.id + ' 필수 필드가 없습니다: ' + errors.join(', '));
    if (knownUrls.has(sourceUrlOf(job))) throw new Error(job.id + ' 공고는 이미 공개 목록에 있습니다.');
    knownUrls.add(sourceUrlOf(job));
    return { ...job, status: JOB_STATUSES.PUBLISHED, verifiedAt: approvedAt };
  });
  const selectedKeys = new Set(selected.map((item) => item.id));
  const nextReview = { ...review, updatedAt: approvedAt, ready: review.ready.filter((item) => !selectedKeys.has(item.id)) };
  const nextPublished = [...published, ...approved].sort((a, b) =>
    String(b.postedAt || b.verifiedAt || '').localeCompare(String(a.postedAt || a.verifiedAt || '')));

  await writeJson(paths.review, nextReview);
  await writeJson(paths.published, nextPublished);
  console.log(`${approved.length}건을 승인했습니다. Git diff로 확인한 뒤 커밋하세요.`);
}

async function reject() {
  const ids = requestedIds();
  if (!ids.length) throw new Error('--id에 제외할 공고 ID를 지정하세요.');
  const review = await readJson(paths.review, emptyReview());
  const candidates = [
    ...(review.ready || []).map((item) => ({ ...item, queue: 'ready' })),
    ...(review.needsReview || []).map((item) => ({ ...item, queue: 'needsReview' })),
  ];
  const selected = candidates.filter((item) => matchesId(item, ids));
  if (selected.length !== ids.length) throw new Error('검토 목록에서 제외할 ID를 모두 찾지 못했습니다.');
  const selectedKeys = new Set(selected.map((item) => item.id));
  const rejectedAt = new Date().toISOString();
  const rejected = await readJson(paths.rejected, []);
  await writeJson(paths.rejected, [...rejected, ...selected.map((item) => ({ ...item, rejectedAt }))]);
  await writeJson(paths.review, {
    ...review,
    updatedAt: rejectedAt,
    ready: review.ready.filter((item) => !selectedKeys.has(item.id)),
    needsReview: review.needsReview.filter((item) => !selectedKeys.has(item.id)),
  });
  console.log(`${selected.length}건을 공개 제외 기록으로 이동했습니다.`);
}

async function list() {
  const review = await readJson(paths.review, emptyReview());
  console.log(`등록 검토 ${review.ready.length}건 · 확인 필요 ${review.needsReview.length}건`);
  for (const item of review.ready) console.log(`[ready] ${item.id} · ${item.title}`);
  for (const item of review.needsReview) console.log(`[needs-review] ${item.id} · ${item.title}`);
}

try {
  if (args.values.help || command === 'help') console.log(help);
  else if (command === 'collect') await collect();
  else if (command === 'approve') await approve();
  else if (command === 'reject') await reject();
  else if (command === 'list') await list();
  else throw new Error('알 수 없는 명령입니다: ' + command);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
