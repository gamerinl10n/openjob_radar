import { validateJob } from './contract.js';
import { dedupeCandidates } from './dedupeCandidates.js';
import { normalizeCandidate } from './normalizeCandidate.js';

/** 한 수집 배치를 검토 큐로 변환한다. 잘못된 항목은 오류와 함께 격리한다. */
export const runRadarPipeline = (rawCandidates, existingJobs = [], options) => {
  const normalized = rawCandidates.map((candidate) => normalizeCandidate(candidate, options));
  const records = dedupeCandidates(normalized, existingJobs);
  return records.map((job) => ({ job, errors: validateJob(job) }));
};
