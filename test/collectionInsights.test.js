import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidate } from '../src/normalizeCandidate.js';
import { reconcileCandidates, reviewReasons } from '../src/reviewInsights.js';
import { nextListingPages } from '../src/publicJobSources.js';
import { collectWorldjob } from '../src/worldjob.js';
import { collectKotra, KOTRA_LIST_URL } from '../src/kotra.js';

const job = (patch = {}) => normalizeCandidate({ title: '번역 담당자', company: '예시', country: '중국', city: '상하이', deadline: '2099-12-31', sourceName: '출처', sourceUrl: 'https://example.com/job/1', ...patch });
test('source amendments persist until review and never overwrite human or published fields', () => {
  let state = reconcileCandidates([job()]);
  state.ready[0].title = '사람이 다듬은 제목';
  state = reconcileCandidates([job({ deadline: '2099-11-30' })], state.ready);
  assert.equal(state.ready[0].title, '사람이 다듬은 제목');
  assert.equal(state.ready[0].deadline, '2099-12-31');
  assert.deepEqual(state.ready[0].radar.sourceChanges.map(c => c.field), ['deadline']);
  const again = reconcileCandidates([job({ deadline: '2099-11-30' })], [], [{ ...state.ready[0], status: 'published' }]);
  assert.equal(again.ready.length, 0);
  assert.equal(again.approved[0].status, 'published');
  assert.equal(again.approved[0].radar.sourceChanges.length, 1);
  const reverted = reconcileCandidates([job()], state.ready);
  assert.equal(reverted.ready[0].radar.sourceChanges.length, 0);
});
test('old installations establish baseline without interpreting manual edits as a source amendment', () => {
  const existing = job({ title: '검수한 제목' });
  const result = reconcileCandidates([job()], [existing]);
  assert.equal(result.changed, 0);
  assert.equal(result.ready[0].title, '검수한 제목');
  assert.equal(result.ready[0].radar.sourceSnapshot.title, '번역 담당자');
});
test('matching cross-source postings retain alternate links while different deadlines remain separate', () => {
  const result = reconcileCandidates([job(), job({ sourceName: '다른 출처', sourceUrl: 'https://example.org/job/2' }), job({ sourceUrl: 'https://example.org/job/3', deadline: '2099-10-10' })]);
  assert.equal(result.ready.length, 2);
  assert.equal(result.ready[0].radar.relatedSources[0].name, '다른 출처');
});
test('review reasons expose all applicable fields without inventing missing information', () => {
  assert.deepEqual(reviewReasons('PDF 첨부파일에서 업무·자격을 확인하지 못했습니다.').map(r => r.code), ['attachment', 'duties', 'qualifications']);
  assert.deepEqual(reviewReasons('이미지 본문').map(r => r.code), ['image']);
  assert.equal(reviewReasons('원문 검토')[0].code, 'other');
});
test('culture extended pagination stays on the official board and caps at five', () => {
  const source = { url: 'https://www.korean-culture.org/recruitmentNoti.do' };
  const html = [2,3,4,5,6].map(p => `<a href="?page=${p}">${p}</a>`).join('') + '<a href="https://evil.example/?page=2">x</a>';
  assert.equal(nextListingPages(html, source).length, 2);
  assert.equal(nextListingPages(html, source, 5).length, 4);
});
test('worldjob extended scan caps pages and resumes at the next page', async () => {
  const pages = [];
  const result = await collectWorldjob({ id: 'worldjob', name: '월드잡', url: 'https://www.worldjob.or.kr/advnc/cnttNewList.do' }, {
    page: 3, maxPages: 5, fetchHtml: async url => {
      const p = Number(new URL(url).searchParams.get('pageIndex')); pages.push(p);
      return `<div class="posting-list-wrap">총 0개</div><a href="javascript:goList('1',${p + 1})">다음</a>`;
    },
  });
  assert.deepEqual(pages, [1,3,4,5,6]);
  assert.equal(result.progress.nextPage, 7);
  assert.equal(result.stats.pages, 5);
});
test('KOTRA stops repeated pages without duplicating stats or detail requests', async () => {
  const shell = '<form id="bbsFrm"><input name="siteSeq" value="1"><input name="bbsSeq" value="2"><input name="menuSeq" value="20000005817"><input name="sitecntntsSeq" value="3"></form>';
  const rows = Array.from({length:30}, (_,i) => `<tr><td><a onclick="fnView('${i+1}')">합격자 발표</a></td></tr>`).join('');
  let lists = 0;
  const result = await collectKotra({id:'kotra', name:'KOTRA', url:'https://www.kotra.or.kr/subList/20000005817'}, { maxPages: 5, fetchHtml: async url => {
    if (url === KOTRA_LIST_URL) { lists++; return `<form id="listFrm"></form><table class="basic-table01">${rows}</table>`; }
    return shell;
  }});
  assert.equal(lists, 2);
  assert.equal(result.stats.read, 30);
  assert.match(result.warnings.join(' '), /반복/);
});
