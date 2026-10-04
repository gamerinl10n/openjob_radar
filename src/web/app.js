import { COLLECTION_SOURCES } from '/sources.js';
const state = { data: null, tab: 'ready', selected: new Set(), busy: false, editingId: null, dirty: false };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const names = Object.fromEntries(COLLECTION_SOURCES.map(source => [source.id, source.name]));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
$('.source-list').innerHTML = COLLECTION_SOURCES.map(source => `<label><input type="checkbox" name="source" value="${escapeHtml(source.id)}" checked /><span>${escapeHtml(source.name)}</span></label>`).join('');
$('#source-filter').innerHTML = '<option value="">모든 출처</option>' + COLLECTION_SOURCES.map(source => `<option>${escapeHtml(source.name)}</option>`).join('');
const sourceUrl = (item) => item.source?.url || item.sourceUrl || item.url || '';
const sourceName = (item) => item.source?.name || names[item.sourceId] || item.sourceId || '출처 확인 필요';
const locationText = (item) => [item.location?.country, item.location?.city].filter(Boolean).join(' · ');
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const dateText = (value) => value ? new Date(value).toLocaleString('ko-KR') : '기록 없음';
const history = () => ['approved','rejected'].includes(state.tab);
const tabItems = () => history() ? state.data?.[state.tab] || [] : state.data?.review[state.tab] || [];
const visibleItems = () => {
  const query = $('#search').value.trim().toLowerCase();
  const source = $('#source-filter').value;
  const keywords = $('#interest-keywords').value.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  const reason = state.tab === 'needsReview' ? $('#reason-filter').value : '';
  const items = tabItems().filter((item) => (!reason || (item.reviewReasons || []).some(value => value.code === reason)) && (!$('#interest-only').checked || !keywords.length || keywords.some(word => JSON.stringify([item.title, item.summary, item.requirements, item.languages, item.location]).toLowerCase().includes(word))) && [item.title, item.company?.name, locationText(item)].join(' ').toLowerCase().includes(query) && (!source || sourceName(item).includes(source)));
  const sort = $('#sort-order').value;
  if (sort === 'deadline') items.sort((a,b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  if (sort === 'changed') items.sort((a,b) => Number(Boolean(b.radar?.sourceChanges?.length || b.radar?.sourceNotice)) - Number(Boolean(a.radar?.sourceChanges?.length || a.radar?.sourceNotice)));
  return items;
};
const notice = (message, error = false) => {
  $('#notice').textContent = message; $('#notice').classList.toggle('error', error); $('#notice').hidden = false;
  clearTimeout(notice.timer); notice.timer = setTimeout(() => { $('#notice').hidden = true; }, 8000);
};
const request = async (path, options) => {
  const response = await fetch(path, { ...options, headers: options?.body ? { 'Content-Type': 'application/json' } : undefined });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.output?.stderr || payload.error || '요청을 완료하지 못했습니다.');
  return payload;
};
function remember() {
  try { localStorage.setItem('radar-view', JSON.stringify({ tab: state.tab, query: $('#search').value, source: $('#source-filter').value, reason: $('#reason-filter').value, sort: $('#sort-order').value, keywords: $('#interest-keywords').value, interestOnly: $('#interest-only').checked, depth: $('#collection-depth').value })); } catch {}
}
function render() {
  const data = state.data; if (!data) return;
  for (const [id, value] of Object.entries({ 'ready-count': data.review.ready.length, 'review-count': data.review.needsReview.length,
    'approved-count': data.approvedCount, 'rejected-count': data.rejectedCount, 'ready-tab-count': data.review.ready.length, 'review-tab-count': data.review.needsReview.length })) $(`#${id}`).textContent = value;
  $('#last-run').textContent = data.lastRun?.ranAt ? `최근 실행 ${dateText(data.lastRun.ranAt)}` : '최근 실행 기록 없음';
  $('#source-health').innerHTML = Object.entries(names).map(([id, name]) => {
    const health = data.sourceHealth?.[id];
    const label = { success: '수집 완료', partial: '일부 확인 필요', failed: '실패' }[health?.state] || '실행 전';
    return `<article class="health-card"><strong>${name}</strong><span class="health-state ${escapeHtml(health?.state || '')}">${label}</span><p>최근 시도 ${escapeHtml(dateText(health?.lastAttemptAt))}<br>최근 성공 ${escapeHtml(dateText(health?.lastSuccessAt))}${health?.error ? `<br>${escapeHtml(health.error)}` : ''}</p></article>`;
  }).join('');
  $('#report').textContent = data.lastRun ? data.lastRun.results.map((result) => `${result.name} · ${result.error ? '수집 실패: ' + result.error : '등록 후보 ' + (result.found || 0) + '건'}\n${result.scope || ''} · 조회 ${result.stats?.read || 0}건 / ${result.stats?.pages || 0}페이지\n${(result.warnings || []).join('\n')}`).join('\n\n') + `\n\n중복 확인 ${data.lastRun.duplicates || 0}건 · 원문 변경 ${data.lastRun.changed || 0}건` : '아직 수집 기록이 없습니다.';
  $('#reason-filter').disabled = state.tab !== 'needsReview';
  const items = visibleItems();
  state.selected = new Set([...state.selected].filter((id) => items.some((item) => item.id === id)));
  $('#queue').innerHTML = items.length ? items.map((item) => {
    const url = safeUrl(sourceUrl(item));
    return `<article class="job-card ${state.editingId === item.id ? 'active' : ''}">
      <input type="checkbox" ${state.tab === 'approved' || state.busy ? 'disabled' : ''} data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 선택" ${state.selected.has(item.id) ? 'checked' : ''} />
      <div><h3>${escapeHtml(item.title || '제목 없음')}</h3><div class="job-meta"><span>${escapeHtml(item.company?.name || sourceName(item))}</span><span>${escapeHtml(locationText(item))}</span><span>${escapeHtml(sourceName(item))}</span></div>
      ${item.deadline ? `<p class="job-meta">마감 ${escapeHtml(item.deadline)}</p>` : ''}
      <button type="button" class="ghost detail-button" data-edit="${escapeHtml(item.id)}">${history() ? '상세 보기' : '상세 · 수정'}</button>
      ${(item.reviewReasons || []).length ? `<div class="insight-badges">${item.reviewReasons.map(reason => `<span>${escapeHtml(reason.label)}</span>`).join('')}</div>` : ''}
      ${item.radar?.sourceChanges?.length ? '<p class="change-notice">원문 변경 감지 · 상세에서 비교하세요</p>' : ''}
      ${item.radar?.sourceNotice ? `<p class="reason">최근 원문 확인: ${escapeHtml(item.radar.sourceNotice)}</p>` : ''}
      ${item.radar?.relatedSources?.length ? `<p class="job-meta">동일 공고 출처 ${item.radar.relatedSources.length + 1}곳</p>` : ''}
      ${item.reason ? `<p class="reason">확인 사유: ${escapeHtml(item.reason)}</p>` : ''}</div>
      ${url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">원문 열기 ↗</a>` : ''}</article>`;
  }).join('') : '<div class="empty">조건에 맞는 공고가 없습니다.</div>';
  $$('.tab').forEach((button) => { const active = button.dataset.tab === state.tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  $('#selected-count').textContent = `${state.selected.size}건 선택`;
  $('#reject').hidden = history(); $('#approve').hidden = history(); $('#unreject').hidden = state.tab !== 'rejected';
  $('#reject').disabled = state.busy || !state.selected.size;
  $('#approve').disabled = state.busy || !state.selected.size || state.tab !== 'ready';
  $('#unreject').disabled = state.busy || !state.selected.size;
  for (const id of ['collect', 'refresh', 'backup', 'restore', 'save-edit']) $(`#${id}`).disabled = state.busy;
  $('#retry').disabled = state.busy || !Object.values(data.sourceHealth || {}).some((value) => value.state === 'failed');
  $('#operation-status').hidden = !state.busy;
  $('#operation-status').textContent = `${data.operation?.label || '요청한 작업'} 진행 중입니다. 완료되면 목록이 갱신됩니다.`;
  const index = items.findIndex((item) => item.id === state.editingId);
  $('#previous-job').disabled = state.busy || index <= 0;
  $('#next-job').disabled = state.busy || index < 0 || index >= items.length - 1;
  $('#detail-position').textContent = index < 0 ? '' : `${index + 1} / ${items.length}`;
}
const refresh = async () => { state.data = await request('/api/status'); state.busy = state.pending || Boolean(state.data.operation); render(); };
const discard = () => !state.dirty || window.confirm('저장하지 않은 수정 내용이 있습니다. 이동할까요?');
function closeEditor() { state.editingId = null; state.dirty = false; $('#editor').hidden = true; }
function openEditor(id) {
  if (!discard()) return;
  const item = tabItems().find((job) => job.id === id); if (!item) return;
  state.editingId = id; state.dirty = false;
  const values = { title: item.title, company: item.company?.name, country: item.location?.country, city: item.location?.city, deadline: item.deadline,
    summary: item.summary, responsibilities: (item.responsibilities || []).join('\n'), requirements: (item.requirements || []).join('\n') };
  for (const [key, value] of Object.entries(values)) { const input = $('#edit-form').elements.namedItem(key); input.value = value || ''; input.readOnly = history(); }
  $('#save-edit').hidden = history(); $('#editor-source').href = safeUrl(sourceUrl(item)) || '#';
  const labels = { title: '제목', company: '회사', location: '근무지', deadline: '마감일', summary: '요약', responsibilities: '담당 업무', requirements: '지원 자격', preferred: '우대 사항', languages: '언어', employmentType: '고용 형태', application: '지원 방법' };
  const showValue = value => escapeHtml(typeof value === 'string' ? value : JSON.stringify(value));
  $('#editor-insights').innerHTML = (item.reason ? `<p class="reason">${escapeHtml(item.reason)}</p>` : '')
    + (item.radar?.sourceNotice ? `<p class="reason">최근 원문 확인: ${escapeHtml(item.radar.sourceNotice)}</p>` : '')
    + (item.radar?.sourceChanges?.length ? '<p class="change-notice">원문이 변경됐습니다. 저장된 검토 내용은 유지했습니다.</p>' + item.radar.sourceChanges.map(change => `<details><summary>${escapeHtml(labels[change.field] || change.field)} 변경</summary><p>이전 원문: ${showValue(change.before)}</p><p>최근 원문: ${showValue(change.after)}</p></details>`).join('') : '')
    + (item.attachments || []).map(file => safeUrl(file.url) ? `<p><a target="_blank" rel="noopener noreferrer" href="${escapeHtml(safeUrl(file.url))}">첨부 · ${escapeHtml(file.name)} ↗</a></p>` : '').join('')
    + (item.radar?.relatedSources || []).map(source => safeUrl(source.url) ? `<p><a target="_blank" rel="noopener noreferrer" href="${escapeHtml(safeUrl(source.url))}">같은 공고 · ${escapeHtml(source.name)} ↗</a></p>` : '').join('');
  $('#editor').hidden = false; render();
  if (matchMedia('(max-width:1000px)').matches) $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function mutate(path, body, message) {
  state.pending = true; state.busy = true; render(); notice(message);
  try {
    const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
    state.data = result.status; state.selected.clear();
    notice([result.output?.stdout, result.output?.stderr].filter(Boolean).join('\n') || '완료했습니다.'); return true;
  } catch (error) { notice(error.message, true); return false; }
  finally { state.pending = false; state.busy = false; await refresh().catch((error) => notice(error.message, true)); }
}
$('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]'); if (!tab || !discard()) return;
  closeEditor(); state.tab = tab.dataset.tab; state.selected.clear(); remember(); render();
});
$('#queue').addEventListener('change', (event) => {
  const input = event.target.closest('[data-id]'); if (!input) return;
  if (input.checked) state.selected.add(input.dataset.id); else state.selected.delete(input.dataset.id); render();
});
$('#queue').addEventListener('click', (event) => { const button = event.target.closest('[data-edit]'); if (button) openEditor(button.dataset.edit); });
$('#close-editor').addEventListener('click', () => { if (discard()) { closeEditor(); render(); } });
$('#edit-form').addEventListener('input', () => { state.dirty = true; });
$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy) return;
  const item = tabItems().find((job) => job.id === state.editingId); if (!item) return;
  const url = sourceUrl(item);
  if (await mutate('/api/edit', { ids: [state.editingId], patch: Object.fromEntries(new FormData(event.target)) }, '검토 내용을 저장하고 있습니다…')) {
    state.dirty = false; state.tab = 'ready'; remember();
    const saved = state.data.review.ready.find((job) => sourceUrl(job) === url); if (saved) openEditor(saved.id); else closeEditor(); render();
  }
});
for (const [button, delta] of [['previous-job', -1], ['next-job', 1]]) $(`#${button}`).addEventListener('click', () => {
  const items = visibleItems(); const next = items[items.findIndex((job) => job.id === state.editingId) + delta]; if (next) openEditor(next.id);
});
$('#collect').addEventListener('click', () => mutate('/api/collect', { sources: $$('input[name="source"]:checked').map((input) => input.value), dryRun: $('#dry-run').checked, depth: $('#collection-depth').value }, '선택한 출처에서 공고를 수집하고 있습니다…'));
$('#retry').addEventListener('click', () => mutate('/api/retry', {}, '실패한 출처만 다시 수집하고 있습니다…'));
for (const [id, path, message] of [['approve','approve','선택한 공고를 승인합니다.'], ['reject','reject','선택한 공고를 제외합니다.'], ['unreject','unreject','제외를 취소하고 원래 목록으로 옮깁니다.']]) {
  $(`#${id}`).addEventListener('click', async () => {
    if (!discard() || (id === 'reject' && !confirm(`${state.selected.size}건을 제외할까요? 제외 기록에서 취소할 수 있습니다.`))) return;
    if (await mutate(`/api/${path}`, { ids: [...state.selected] }, message)) { closeEditor(); render(); }
  });
}
$('#refresh').addEventListener('click', () => refresh().catch((error) => notice(error.message, true)));
for (const id of ['search', 'source-filter', 'reason-filter', 'sort-order', 'interest-keywords', 'interest-only', 'collection-depth']) $(`#${id}`).addEventListener(['search', 'interest-keywords'].includes(id) ? 'input' : 'change', () => { remember(); render(); });
$('#backup').addEventListener('click', async () => {
  state.pending = true; state.busy = true; render();
  try {
    const backup = await request('/api/backup');
    const blob = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = blob; link.download = `OpenJob-Radar-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(blob), 10000);
    notice('백업 파일을 다운로드했습니다.');
  } catch (error) { notice(error.message, true); }
  finally { state.pending = false; state.busy = false; render(); }
});
$('#restore').addEventListener('click', () => { if (discard()) $('#restore-file').click(); });
$('#restore-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('10MB 이하의 백업 파일을 선택하세요.');
    const backup = JSON.parse(await file.text());
    const files = backup.files;
    if (backup.format !== 'openjob-radar-backup' || backup.version !== 1 || !Array.isArray(files?.['review.json']?.ready) || !Array.isArray(files?.['approved.json'])) throw new Error('OpenJob Radar 백업 파일이 아닙니다.');
    if (!confirm(`이 백업으로 현재 데이터를 교체할까요?\n등록 검토 ${files['review.json'].ready.length}건 · 승인 ${files['approved.json'].length}건\n현재 데이터는 복원 직전에 자동으로 백업됩니다.`)) return;
    if (await mutate('/api/restore', backup, '백업을 검사하고 복원하고 있습니다…')) { closeEditor(); render(); }
  } catch (error) { notice(error.message, true); }
});
window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
try { const view = JSON.parse(localStorage.getItem('radar-view') || '{}'); if (['ready','needsReview','approved','rejected'].includes(view.tab)) state.tab = view.tab; $('#search').value = view.query || ''; $('#source-filter').value = view.source || ''; $('#reason-filter').value = view.reason || ''; $('#sort-order').value = view.sort || 'default'; $('#interest-keywords').value = view.keywords || ''; $('#interest-only').checked = Boolean(view.interestOnly); $('#collection-depth').value = view.depth === 'extended' ? 'extended' : 'standard'; } catch {}
refresh().catch((error) => notice(error.message, true));
setInterval(() => { if (state.busy || state.data?.operation) refresh().catch(() => {}); }, 2000);
