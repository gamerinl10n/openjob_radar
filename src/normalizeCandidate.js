import { createHash } from 'node:crypto';

import { JOB_STATUSES } from './contract.js';

const TRACKING_PARAMS = new Set([
  'from', 'ref', 'source', 'spm',
  'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term',
]);

const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const cleanList = (value) => {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map(cleanText).filter(Boolean))];
};

const dateOnly = (value) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10);
};

export const normalizeSourceUrl = (value) => {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return '';
  }
};

const slugify = (value) => cleanText(value)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 80);

export const createCandidateFingerprint = (candidate) => {
  const identity = [
    cleanText(candidate?.company?.name || candidate?.company),
    cleanText(candidate?.title),
    cleanText(candidate?.location?.city || candidate?.city),
  ].map((item) => item.toLocaleLowerCase('ko-KR')).join('|');
  return createHash('sha256').update(identity).digest('hex').slice(0, 20);
};

/** 외부 수집 결과를 공개 계약의 draft 레코드로 바꾼다. 자동 공개는 하지 않는다. */
export const normalizeCandidate = (candidate, { collectedAt = new Date().toISOString() } = {}) => {
  const sourceUrl = normalizeSourceUrl(candidate?.source?.url || candidate?.sourceUrl);
  const fingerprint = createCandidateFingerprint(candidate);
  const sourceName = cleanText(candidate?.source?.name || candidate?.sourceName);
  const externalId = cleanText(candidate?.source?.externalId || candidate?.externalId);
  const companyName = cleanText(candidate?.company?.name || candidate?.company);
  const title = cleanText(candidate?.title);
  const stableId = externalId || fingerprint;

  return {
    id: `radar-${stableId}`,
    radarId: `${slugify(sourceName) || 'source'}:${stableId}`,
    slug: slugify(`${companyName}-${title}-${stableId.slice(0, 8)}`),
    title,
    company: { name: companyName, logoUrl: candidate?.company?.logoUrl || null },
    category: cleanText(candidate?.category) || 'other',
    location: {
      country: cleanText(candidate?.location?.country || candidate?.country),
      city: cleanText(candidate?.location?.city || candidate?.city),
      workplace: cleanText(candidate?.location?.workplace || candidate?.workplace) || null,
      remote: Boolean(candidate?.location?.remote ?? candidate?.remote),
    },
    educationLevel: cleanText(candidate?.educationLevel),
    experienceLevel: cleanText(candidate?.experienceLevel || candidate?.experience),
    employmentType: cleanText(candidate?.employmentType),
    languages: cleanList(candidate?.languages),
    visaSupport: cleanText(candidate?.visaSupport) || 'unknown',
    postedAt: dateOnly(candidate?.postedAt),
    deadline: dateOnly(candidate?.deadline),
    verifiedAt: null,
    summary: cleanText(candidate?.summary),
    responsibilities: cleanList(candidate?.responsibilities),
    requirements: cleanList(candidate?.requirements),
    preferred: cleanList(candidate?.preferred),
    application: {
      method: cleanText(candidate?.application?.method) || '원문 지원',
      url: normalizeSourceUrl(candidate?.application?.url) || sourceUrl,
    },
    source: { name: sourceName, url: sourceUrl, externalId: externalId || null },
    status: JOB_STATUSES.DRAFT,
    radar: { collectedAt, fingerprint },
  };
};
