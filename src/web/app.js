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

  const history = ['approved', 'rejected'].includes(state.tab);
  const query = $('#search').value.trim().toLowerCase();
  const source = $('#source-filter').value;
  const items = (history ? data[state.tab] || [] : state.tab === 'ready' ? ready : needsReview).filter((item) =>
    [item.title, item.company?.name, locationText(item)].join(' ').toLowerCase().includes(query) &&
    (!source || sourceName(item).includes(source) || ({ worldjob: '월드잡', culture: '문화원', kotra: 'KOTRA' }[item.sourceId] || '').includes(source)));
  $('#report').textContent = data.lastRun ? data.lastRun.results.map((result) => `${result.name} · ${result.error ? '수집 실패: ' + result.error : '등록 후보 ' + (result.found || 0) + '건'}\n${(result.warnings || []).join('\n')}`).join('\n\n') : '아직 수집 기록이 없습니다.';
  state.selected = new Set([...state.selected].filter((id) => items.some((item) => item.id === id)));
  $('#queue').innerHTML = items.length ? items.map((item) => {
    const url = safeUrl(sourceUrl(item));
    return `<article class="job-card">
      <input type="checkbox" ${history ? 'disabled' : ''} data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 선택" ${state.selected.has(item.id) ? 'checked' : ''} />
      <div>
        <h3>${escapeHtml(item.title || '제목 없음')}</h3>
        <div class="job-meta">
          <span>${escapeHtml(item.company?.name || sourceName(item))}</span>
          ${locationText(item) ? `<span>${escapeHtml(locationText(item))}</span>` : ''}
          <span>${escapeHtml(sourceName(item))}</span>
        </div>
        ${item.deadline ? `<p class="job-meta">마감 ${escapeHtml(item.deadline)}</p>` : ''}
        <button type="button" class="ghost detail-button" data-edit="${escapeHtml(item.id)}">${history ? '상세 보기' : '상세 · 수정'}</button>
        ${item.reason ? `<p class="reason">확인 사유: ${escapeHtml(item.reason)}</p>` : ''}
      </div>
      ${url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">원문 열기 ↗</a>` : ''}
    </article>`;
  }).join('') : '<div class="empty">현재 검토할 공고가 없습니다.</div>';

  const selectedCount = state.selected.size;
  $('#selected-count').textContent = `${selectedCount}건 선택`;
  $('#reject').disabled = state.busy || history || !selectedCount;
  $('#approve').disabled = state.busy || !selectedCount || state.tab !== 'ready';
  $('#collect').disabled = state.busy;
  $('#refresh').disabled = state.busy;
};

const refresh = async () => {
  state.data = await request('/api/status');
  state.busy = Boolean(state.data.operation);
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
    return true;
  } catch (error) {
    notice(error.message, true);
    return false;
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

$('#search').addEventListener('input', render);
$('#source-filter').addEventListener('change', render);
let editingId = null;
$('#queue').addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit]');
  if (!button) return;
  const history = ['approved', 'rejected'].includes(state.tab);
  const items = history ? state.data[state.tab] : state.data.review[state.tab];
  const item = items.find((job) => job.id === button.dataset.edit);
  if (!item) return;
  editingId = item.id;
  const values = { title: item.title, company: item.company?.name, country: item.location?.country,
    city: item.location?.city, deadline: item.deadline, summary: item.summary,
    responsibilities: (item.responsibilities || []).join('\n'), requirements: (item.requirements || []).join('\n') };
  for (const [key, value] of Object.entries(values)) {
    const input = $('#edit-form').elements.namedItem(key);
    input.value = value || '';
    input.readOnly = history;
  }
  $('#save-edit').hidden = history;
  $('#editor-source').href = safeUrl(sourceUrl(item)) || '#';
  $('#editor').showModal();
});
$('#close-editor').addEventListener('click', () => $('#editor').close());
$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const patch = Object.fromEntries(new FormData(event.target));
  $('#save-edit').disabled = true;
  const saved = await mutate('/api/edit', { ids: [editingId], patch }, '검토 내용을 저장하고 있습니다…');
  $('#save-edit').disabled = false;
  if (saved) $('#editor').close();
});
setInterval(() => { if (state.data?.operation) refresh().catch(() => {}); }, 2000);
