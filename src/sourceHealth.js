export function updateSourceHealth(previous, results, ranAt) {
  const next = { ...previous };
  for (const result of results) {
    const state = result.error ? 'failed' : result.warnings?.length || result.stats?.detailFailed ? 'partial' : 'success';
    next[result.id] = {
      name: result.name, state, lastAttemptAt: ranAt,
      lastSuccessAt: state === 'success' ? ranAt : previous[result.id]?.lastSuccessAt || null,
      found: result.found || 0, error: result.error || null, warnings: result.warnings || [],
    };
  }
  return next;
}
