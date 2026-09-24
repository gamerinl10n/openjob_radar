export const JOB_STATUSES = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  SOURCE_REMOVED: 'sourceRemoved',
  DUPLICATE: 'duplicate',
  REJECTED: 'rejected',
});

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const VALID_STATUSES = new Set(Object.values(JOB_STATUSES));

export const validateJob = (job) => {
  const errors = [];
  if (!hasText(job?.id)) errors.push('id');
  if (!hasText(job?.radarId)) errors.push('radarId');
  if (!hasText(job?.slug)) errors.push('slug');
  if (!hasText(job?.title)) errors.push('title');
  if (!hasText(job?.company?.name)) errors.push('company.name');
  if (!hasText(job?.category)) errors.push('category');
  if (!hasText(job?.source?.name)) errors.push('source.name');
  if (!hasText(job?.source?.url)) errors.push('source.url');
  if (!VALID_STATUSES.has(job?.status)) errors.push('status');
  return errors;
};
