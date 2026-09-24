import { JOB_STATUSES } from './contract.js';
import { createCandidateFingerprint, normalizeSourceUrl } from './normalizeCandidate.js';

const keysFor = (job) => {
  const keys = [];
  const url = normalizeSourceUrl(job?.source?.url || job?.sourceUrl);
  const source = job?.source?.name || job?.sourceName || '';
  const externalId = job?.source?.externalId || job?.externalId;
  const fingerprint = job?.radar?.fingerprint || createCandidateFingerprint(job);
  if (url) keys.push(`url:${url}`);
  if (source && externalId) keys.push(`external:${source.toLowerCase()}:${externalId}`);
  if (fingerprint) keys.push(`content:${fingerprint}`);
  return keys;
};

export const dedupeCandidates = (candidates, existingJobs = []) => {
  const seen = new Map();
  existingJobs.forEach((job) => keysFor(job).forEach((key) => seen.set(key, job.id || job.radarId)));

  return candidates.map((candidate) => {
    const matchedKey = keysFor(candidate).find((key) => seen.has(key));
    if (matchedKey) {
      return {
        ...candidate,
        status: JOB_STATUSES.DUPLICATE,
        radar: { ...candidate.radar, duplicateOf: seen.get(matchedKey), duplicateKey: matchedKey },
      };
    }
    keysFor(candidate).forEach((key) => seen.set(key, candidate.id || candidate.radarId));
    return candidate;
  });
};
