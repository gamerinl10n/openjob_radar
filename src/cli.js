#!/usr/bin/env node
import { reconcileCandidates, reviewReasons, mergePendingRecord } from './reviewInsights.js';
import { updateSourceHealth } from './sourceHealth.js';
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';

import { collectPublicJobCandidates, SOURCES } from './publicJobSources.js';
import { canonicalKotraUrl } from './kotra.js';
import { canonicalWorldjobUrl } from './worldjob.js';
import { JOB_STATUSES, validateJob } from './contract.js';
import { runRadarPipeline } from './runPipeline.js';
import { pendingId, readJson, sourceUrlOf, writeJson, acquireLock, recoverTransaction, commitTransaction } from './storage.js';

const workspaceRoot = resolve(process.env.OPENJOB_RADAR_HOME || process.cwd());
const defaults = {
  review: resolve(workspaceRoot, 'data/review.json'),
  rejected: resolve(workspaceRoot, 'data/rejected.json'),
  lastRun: resolve(workspaceRoot, 'data/last-run.json'),
  state: resolve(workspaceRoot, 'data/state.json'),
  approved: resolve(workspaceRoot, 'data/approved.json'),
};

const help = `OpenJob Radar 공개 공고 수집기

사용법:
  openjob-radar collect [--source culture,kotra,worldjob] [--depth standard|extended] [--dry-run]
  openjob-radar list
  openjob-radar approve --id <공고 ID>[,<공고 ID>]
  openjob-radar reject --id <공고 ID>[,<공고 ID>]
  openjob-radar unreject --id <공고 ID>[,<공고 ID>]

기본 파일:
  data/review.json   수집 후 사람이 검토할 공고
  data/last-run.json 최근 실행 보고서
  data/state.json    월드잡 이어보기 위치
  data/approved.json 사람이 승인한 공고 기록

현재 작업 디렉터리의 data/를 사용합니다. OPENJOB_RADAR_HOME으로 다른 위치를 지정할 수 있습니다.
collect는 자동 게시하지 않습니다. approve를 실행하기 전에 review.json과 원문을 확인하세요.
`;

const args = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    source: { type: 'string' },
    depth: { type: 'string', default: 'standard' },
    patch: { type: 'string' },
    id: { type: 'string' },
    review: { type: 'string' },
    rejected: { type: 'string' },
    report: { type: 'string' },
    state: { type: 'string' },
    approved: { type: 'string' },
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
  approved: resolve(args.values.approved || defaults.approved),
};

const emptyReview = () => ({ schemaVersion: 1, updatedAt: null, ready: [], needsReview: [] });
const requestedIds = () => String(args.values.id || '').split(',').map((value) => value.trim()).filter(Boolean);
const matchesId = (item, ids) => ids.includes(item?.id) || ids.includes(item?.radarId) || ids.includes(item?.slug);

async function collect() {
  const selected = String(args.values.source || SOURCES.map(({ id }) => id).join(','))
    .split(',').map((value) => value.trim()).filter(Boolean);
  const unknown = selected.filter((id) => !SOURCES.some((source) => source.id === id));
  if (unknown.length) throw new Error('지원하지 않는 출처입니다: ' + unknown.join(', '));

  const depth = args.values.depth;
  if (!['standard', 'extended'].includes(depth)) throw new Error('수집 범위는 standard 또는 extended입니다.');
  const now = new Date().toISOString();
  const review = await readJson(paths.review, emptyReview());
  const approved = await readJson(paths.approved, []);
  const state = await readJson(paths.state, { schemaVersion: 1, worldjob: { nextPage: 1 } });
  const rejected = await readJson(paths.rejected, []);
  const rejectedUrls = new Set(rejected.map(sourceUrlOf));
  const knownItems = rejected; // Revisit active and approved sources to detect amendments.
  const knownUrls = new Set(knownItems.map(sourceUrlOf).filter(Boolean));
  const worldjobKnown = new Set([...knownUrls].map(canonicalWorldjobUrl).filter(Boolean));
  const knownKotraUrls = [...knownUrls].map(canonicalKotraUrl).filter(Boolean);

  const { results } = await collectPublicJobCandidates(selected, {
    worldjobProgress: { page: state.worldjob?.nextPage || 1, known: worldjobKnown },
    knownKotraUrls, depth,
  });

  const normalized = runRadarPipeline(results.flatMap((result) => result.candidates || []), [], { collectedAt: now });
  const newReady = normalized
    .filter(({ job, errors }) => !rejectedUrls.has(sourceUrlOf(job)) && !errors.length)
    .map(({ job }) => ({ ...job, status: JOB_STATUSES.DRAFT }));
  const invalid = normalized.filter(({ errors }) => errors.length);
  const reconciled = reconcileCandidates(newReady, review.ready || [], approved, now);
  const observations = new Map(results.flatMap(result => [...(result.exclusions || []), ...(result.pending || [])]).map(item => [item.url, item.reason]));
  for (const job of [...reconciled.ready, ...reconciled.approved]) {
    if (observations.has(sourceUrlOf(job))) job.radar = { ...job.radar, sourceNotice: observations.get(sourceUrlOf(job)), lastCheckedAt: now };
    else if (newReady.some(fresh => sourceUrlOf(fresh) === sourceUrlOf(job))) delete job.radar.sourceNotice;
  }
  const ready = reconciled.ready;

  const pending = results.flatMap((result) => (result.pending || []).map((item) => ({
    ...(item.draft || {}),
    source: { ...(item.draft?.source || {}), name: item.draft?.source?.name || result.name, url: item.url },
    id: pendingId(item.url),
    sourceId: result.id,
    title: item.title,
    url: item.url,
    reason: item.reason,
    reviewReasons: reviewReasons(item.reason),
    attachments: item.attachments || [],
    firstSeenAt: now,
    lastSeenAt: now,
  })));
  const previousPending = new Map((review.needsReview || []).map((item) => [item.url, item]));
  for (const item of pending) {
    if (rejectedUrls.has(item.url)) continue;
    const previous = previousPending.get(item.url);
    previousPending.set(item.url, previous ? mergePendingRecord(previous, item) : item);
  }

  const nextReview = {
    schemaVersion: 1,
    updatedAt: now,
    ready,
    needsReview: [...previousPending.values()].filter((item) => ![...ready, ...approved].some((job) => sourceUrlOf(job) === item.url)),
  };
  const report = {
    schemaVersion: 1,
    ranAt: now,
    selectedSources: selected, depth, duplicates: reconciled.duplicates, changed: reconciled.changed,
    results: results.map(({ id, name, found, stats, exclusions, warnings, error, emptyReason, progress, scope }) => ({
      id, name, found, stats, exclusions, warnings, error, emptyReason, progress, scope,
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
    const healthPath = resolve(dirname(paths.review), 'source-health.json');
    const health = updateSourceHealth(await readJson(healthPath, {}), results, now);
    await commitTransaction(journal, [[paths.review, nextReview], [paths.approved, reconciled.approved], [paths.lastRun, report], [paths.state, nextState], [healthPath, health]]);
  }

  for (const result of results) {
    console.log(`${result.name}: 등록 검토 ${result.candidates.length}건, 확인 필요 ${result.pending.length}건, 제외 ${result.exclusions.length}건`);
    if (result.error) console.error('  실패: ' + result.error);
  }
  console.log(args.values['dry-run'] ? '미리보기 실행이라 파일을 변경하지 않았습니다.' : '자동 게시하지 않았습니다. data/review.json을 검토하세요.');
  if (results.some((result) => result.error)) process.exitCode = 1;
}

async function approve() {
  const ids = requestedIds();
  if (!ids.length) throw new Error('--id에 승인할 공고 ID를 지정하세요.');
  const review = await readJson(paths.review, emptyReview());
  const approvedRecords = await readJson(paths.approved, []);
  const selected = (review.ready || []).filter((item) => matchesId(item, ids));
  if (selected.length !== ids.length) throw new Error('검토 목록에서 승인할 ID를 모두 찾지 못했습니다.');

  const knownUrls = new Set(approvedRecords.map(sourceUrlOf));
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
  const nextApproved = [...approvedRecords, ...approved].sort((a, b) =>
    String(b.postedAt || b.verifiedAt || '').localeCompare(String(a.postedAt || a.verifiedAt || '')));

  await commitTransaction(journal, [[paths.approved, nextApproved], [paths.review, nextReview]]);
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
  await commitTransaction(journal, [[paths.rejected, [...rejected, ...selected.map((item) => ({ ...item, rejectedAt }))]], [paths.review, {
    ...review,
    updatedAt: rejectedAt,
    ready: review.ready.filter((item) => !selectedKeys.has(item.id)),
    needsReview: review.needsReview.filter((item) => !selectedKeys.has(item.id)),
  }]]);
  console.log(`${selected.length}건을 공개 제외 기록으로 이동했습니다.`);
}

async function unreject() {
  const ids = [...new Set(requestedIds())];
  if (!ids.length) throw new Error('제외를 취소할 공고를 선택하세요.');
  const review = await readJson(paths.review, emptyReview());
  const rejected = await readJson(paths.rejected, []);
  const approved = await readJson(paths.approved, []);
  const selected = rejected.filter((item) => matchesId(item, ids));
  if (new Set(selected.map((item) => item.id)).size !== ids.length) throw new Error('제외 기록에서 공고를 찾지 못했습니다.');
  const known = [...approved, ...review.ready, ...review.needsReview];
  for (const item of selected) {
    if (known.some((old) => old.id === item.id || sourceUrlOf(old) === sourceUrlOf(item))) throw new Error('이미 다른 목록에 같은 공고가 있습니다.');
    const { queue, rejectedAt, ...job } = item;
    if (!['ready', 'needsReview'].includes(queue)) throw new Error('원래 목록을 확인할 수 없습니다.');
    review[queue].push(job);
    known.push(job);
  }
  review.updatedAt = new Date().toISOString();
  await commitTransaction(journal, [[paths.review, review], [paths.rejected, rejected.filter((item) => !matchesId(item, ids))]]);
  console.log(`${selected.length}건의 제외를 취소했습니다. 원래 검토 목록으로 돌아갔습니다.`);
}

async function list() {
  const review = await readJson(paths.review, emptyReview());
  console.log(`등록 검토 ${review.ready.length}건 · 확인 필요 ${review.needsReview.length}건`);
  for (const item of review.ready) console.log(`[ready] ${item.id} · ${item.title}`);
  for (const item of review.needsReview) console.log(`[needs-review] ${item.id} · ${item.title}`);
}

async function edit() {
  const ids = requestedIds();
  if (ids.length !== 1) throw new Error('수정할 공고를 하나 선택하세요.');
  const patch = JSON.parse(args.values.patch || '{}');
  const review = await readJson(paths.review, emptyReview());
  const item = [...review.ready, ...review.needsReview].find((job) => matchesId(job, ids));
  if (!item) throw new Error('공고를 찾지 못했습니다.');
  const text = (key) => String(patch[key] ?? '').trim().slice(0, 10000);
  if (!text('title') || !text('company') || !text('requirements') || !text('responsibilities')) {
    throw new Error('제목, 회사, 업무, 자격을 입력하세요.');
  }
  const { normalizeCandidate } = await import('./normalizeCandidate.js');
  const job = normalizeCandidate({
    ...item, title: text('title'), company: text('company'),
    source: item.source || { name: SOURCES.find((source) => source.id === item.sourceId)?.name || item.sourceId || '수동 검토', url: item.url },
    location: { ...item.location, country: text('country'), city: text('city') },
    deadline: text('deadline'), summary: text('summary'),
    responsibilities: text('responsibilities').split('\n').filter(Boolean),
    requirements: text('requirements').split('\n').filter(Boolean),
  });
  job.radar = { ...item.radar, ...job.radar, sourceSnapshot: item.radar?.sourceSnapshot, sourceChanges: [], changeBaseline: null };
  if (item.radarId) { job.id = item.id; job.radarId = item.radarId; job.slug = item.slug; }
  const errors = validateJob(job);
  if (errors.length) throw new Error('필수 정보 확인: ' + errors.join(', '));
  await commitTransaction(journal, [[paths.review, {
    ...review, updatedAt: new Date().toISOString(),
    ready: [...review.ready.filter((old) => old.id !== item.id && sourceUrlOf(old) !== sourceUrlOf(job)), job],
    needsReview: review.needsReview.filter((old) => old.id !== item.id && sourceUrlOf(old) !== sourceUrlOf(job)),
  }]]);
  console.log('수정했습니다. 등록 검토에서 내용을 확인하고 승인하세요.');
}
const journal = resolve(dirname(paths.review), 'transaction.json');
let release;

try {
  if (['collect', 'approve', 'reject', 'edit', 'unreject', 'list'].includes(command)) {
    release = await acquireLock(resolve(dirname(paths.review), '.operation.lock'));
    await recoverTransaction(journal);
  }
  if (args.values.help || command === 'help') console.log(help);
  else if (command === 'collect') await collect();
  else if (command === 'edit') await edit();
  else if (command === 'approve') await approve();
  else if (command === 'unreject') await unreject();
  else if (command === 'reject') await reject();
  else if (command === 'list') await list();
  else throw new Error('알 수 없는 명령입니다: ' + command);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

finally { if (release) await release(); }
