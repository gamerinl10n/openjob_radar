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
const sameContent = (a, b) => Boolean(a.company?.name && b.company?.name && a.title && b.title && a.deadline && b.deadline && a.location?.country && b.location?.country)
  && createCandidateFingerprint(a) === createCandidateFingerprint(b)
  && (a.location?.country || '') === (b.location?.country || '') && a.deadline === b.deadline;

// Never replace human edits or published fields with freshly scraped values.
export function reconcileCandidates(candidates, ready = [], approved = [], now = new Date().toISOString()) {
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
