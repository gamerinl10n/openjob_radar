const state = { data: null, tab: 'ready', selected: new Set(), busy: false };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character]);

const notice = (message, error = false) => {
  const element = $('#notice');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  window.clearTimeout(notice.timer);
  notice.timer = window.setTimeout(() => { element.hidden = true; }, 6500);
};

const request = async (path, options) => {
  const response = await fetch(path, {
    ...options,
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '요청을 완료하지 못했습니다.');
  return payload;
};

const sourceUrl = (item) => item.source?.url || item.sourceUrl || item.url || '';
const sourceName = (item) => item.source?.name || item.sourceId || '출처 확인 필요';
const locationText = (item) => [item.location?.country, item.location?.city].filter(Boolean).join(' · ');
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const render = () => {
  const data = state.data;
  if (!data) return;
  const ready = data.review.ready || [];
  const needsReview = data.review.needsReview || [];
  $('#ready-count').textContent = ready.length;
  $('#review-count').textContent = needsReview.length;
  $('#approved-count').textContent = data.approvedCount;
  $('#rejected-count').textContent = data.rejectedCount;
  $('#ready-tab-count').textContent = ready.length;
  $('#review-tab-count').textContent = needsReview.length;
  $('#last-run').textContent = data.lastRun?.ranAt
    ? `최근 실행 ${new Date(data.lastRun.ranAt).toLocaleString('ko-KR')}`
    : '최근 실행 기록 없음';

  const items = state.tab === 'ready' ? ready : needsReview;
  state.selected = new Set([...state.selected].filter((id) => items.some((item) => item.id === id)));
  $('#queue').innerHTML = items.length ? items.map((item) => {
    const url = safeUrl(sourceUrl(item));
    return `<article class="job-card">
      <input type="checkbox" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 선택" ${state.selected.has(item.id) ? 'checked' : ''} />
      <div>
        <h3>${escapeHtml(item.title || '제목 없음')}</h3>
        <div class="job-meta">
          <span>${escapeHtml(item.company?.name || sourceName(item))}</span>
          ${locationText(item) ? `<span>${escapeHtml(locationText(item))}</span>` : ''}
          <span>${escapeHtml(item.id)}</span>
        </div>
        ${item.reason ? `<p class="reason">확인 사유: ${escapeHtml(item.reason)}</p>` : ''}
      </div>
      ${url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">원문 열기 ↗</a>` : ''}
    </article>`;
  }).join('') : '<div class="empty">현재 검토할 공고가 없습니다.</div>';

  const selectedCount = state.selected.size;
  $('#selected-count').textContent = `${selectedCount}건 선택`;
  $('#reject').disabled = state.busy || !selectedCount;
  $('#approve').disabled = state.busy || !selectedCount || state.tab !== 'ready';
  $('#collect').disabled = state.busy;
  $('#refresh').disabled = state.busy;
};

const refresh = async () => {
  state.data = await request('/api/status');
  render();
};

const mutate = async (path, body, pendingMessage) => {
  state.busy = true;
  render();
  notice(pendingMessage);
  try {
    const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
    state.data = result.status;
    state.selected.clear();
    const output = [result.output?.stdout, result.output?.stderr].filter(Boolean).join('\n');
    notice(output || '작업을 완료했습니다.');
  } catch (error) {
    notice(error.message, true);
  } finally {
    state.busy = false;
    await refresh().catch((error) => notice(error.message, true));
  }
};

$('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  state.tab = tab.dataset.tab;
  state.selected.clear();
  $$('.tab').forEach((button) => {
    const active = button === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  render();
});

$('#queue').addEventListener('change', (event) => {
  const input = event.target.closest('[data-id]');
  if (!input) return;
  if (input.checked) state.selected.add(input.dataset.id);
  else state.selected.delete(input.dataset.id);
  render();
});

$('#collect').addEventListener('click', () => {
  const sources = $$('input[name="source"]:checked').map((input) => input.value);
  mutate('/api/collect', { sources, dryRun: $('#dry-run').checked }, '선택한 출처에서 공고를 수집하고 있습니다…');
});
$('#approve').addEventListener('click', () => mutate('/api/approve', { ids: [...state.selected] }, '선택한 공고를 승인하고 있습니다…'));
$('#reject').addEventListener('click', () => {
  if (window.confirm(`${state.selected.size}건을 제외 기록으로 이동할까요?`)) {
    mutate('/api/reject', { ids: [...state.selected] }, '선택한 공고를 제외하고 있습니다…');
  }
});
$('#refresh').addEventListener('click', () => refresh().catch((error) => notice(error.message, true)));

refresh().catch((error) => notice(error.message, true));
