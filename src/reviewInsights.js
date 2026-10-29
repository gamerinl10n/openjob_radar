import { createCandidateFingerprint, normalizeSourceUrl } from './normalizeCandidate.js';

export const REVIEW_REASONS = {
  image: '이미지 본문 확인', attachment: '첨부파일 확인', deadline: '마감일 확인',
  location: '근무지 확인', duties: '담당 업무 확인', qualifications: '지원 자격 확인',
  timeout: '조회 시간 부족', fetch: '본문 조회·분석 실패', other: '원문 확인',
};
export function reviewReasons(reason = '') {
  const rules = { image: /이미지/, attachment: /첨부|PDF|HWP/, deadline: /마감|모집기간/,
    location: /근무지|근무 국가|근무국|국가.*확인|지역/, duties: /업무/, qualifications: /자격/,
    timeout: /시간.*부족|시간.*초과|timeout/, fetch: /실패|구조|읽지 못|DNS|응답|네트워크/ };
  const codes = Object.entries(rules).filter(([, pattern]) => pattern.test(reason)).map(([code]) => code);
  return (codes.length ? codes : ['other']).map((code) => ({ code, label: REVIEW_REASONS[code] }));
}
const fields = ['title', 'company', 'location', 'deadline', 'summary', 'responsibilities', 'requirements', 'preferred', 'languages', 'employmentType', 'application'];
export const sourceSnapshot = (job) => Object.fromEntries(fields.map((key) => [key, job[key] ?? null]));
export const changedFields = (before, after) => fields.filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
  .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
const url = (job) => normalizeSourceUrl(job.source?.url || job.sourceUrl || job.url);
// Only fully identified postings can match across URLs. Keep country and deadline
// as Map keys so their original strict-equality semantics are preserved.
const contentIdentity = (job) => job.company?.name && job.title && job.deadline && job.location?.country
  ? [createCandidateFingerprint(job), job.location.country, job.deadline] : null;

function createCandidateIndex(records) {
  const byUrl = new Map();
  const byContent = new Map();
  let nextOrder = 0;

  function contentBucket(identity, create = false) {
    if (!identity) return undefined;
    let bucket = byContent;
    for (const key of identity.slice(0, -1)) {
      if (!bucket.has(key)) {
        if (!create) return undefined;
        bucket.set(key, new Map());
      }
      bucket = bucket.get(key);
    }
    return bucket;
  }

  function add(job, sourceUrl = url(job), identity = contentIdentity(job)) {
    const entry = { job, sourceUrl, order: nextOrder++ };
    // First occurrence wins, including empty URLs, matching the previous find().
    if (!byUrl.has(sourceUrl)) byUrl.set(sourceUrl, entry);
    const bucket = contentBucket(identity, true);
    if (bucket && !bucket.has(identity[2])) bucket.set(identity[2], entry);
  }

  function find(job) {
    const sourceUrl = url(job);
    const identity = contentIdentity(job);
    const urlMatch = byUrl.get(sourceUrl);
    const contentMatch = contentBucket(identity)?.get(identity[2]);
    const match = !urlMatch ? contentMatch : !contentMatch ? urlMatch
      : urlMatch.order < contentMatch.order ? urlMatch : contentMatch;
    return { match, sourceUrl, identity };
  }

  records.forEach((job) => add(job));
  return { add, find };
}

// Never replace human edits or published fields with freshly scraped values.
export function reconcileCandidates(candidates, ready = [], approved = [], now = new Date().toISOString()) {
  const records = [...ready, ...approved].map((job) => structuredClone(job));
  const added = []; let duplicates = 0; let changed = 0;
  const index = createCandidateIndex(records);
  for (const job of candidates) {
    const { match, sourceUrl, identity } = index.find(job);
    if (!match) {
      const record = { ...job, radar: { ...job.radar, sourceSnapshot: sourceSnapshot(job), lastCheckedAt: now } };
      added.push(record);
      index.add(record, sourceUrl, identity);
      continue;
    }
    const old = match.job;
    duplicates++;
    old.radar ||= {};
    if (match.sourceUrl !== sourceUrl) {
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

// A transient parse failure must not erase useful fields from an earlier attempt.
export function mergePendingRecord(previous, next) {
  const merged = { ...previous, ...next, firstSeenAt: previous.firstSeenAt || next.firstSeenAt };
  for (const key of ['company', 'location', 'summary', 'responsibilities', 'requirements', 'preferred', 'languages', 'deadline', 'employmentType', 'educationLevel', 'experienceLevel']) {
    const value = next[key];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
      if (previous[key] !== undefined) merged[key] = previous[key];
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...previous[key], ...Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== '' && entry !== null)) };
    }
  }
  return merged;
}
