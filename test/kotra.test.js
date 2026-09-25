import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalKotraUrl, collectKotra, KOTRA_LIST_URL, KOTRA_DETAIL_URL,
  parseKotraBoardForm, kotraBoardRequest, parseKotraListing, assessKotraDetail,
} from '../src/kotra.js';
import { COLLECTION_SOURCES } from '../src/sources.js';

const source = COLLECTION_SOURCES.find((item) => item.id === 'kotra');
const shell = `<form id="bbsFrm">
  <input name="siteSeq" value="20000002134"><input name="bbsSeq" value="20000026831">
  <input name="menuSeq" value="20000005817"><input name="sitecntntsSeq" value="20000004887">
</form><div id="bbs_area"></div>`;
const row = (id, title, date = '2026-09-09') =>
  `<tr><td>${id}</td><td class="txt-l"><a href="javascript:void(0);" onclick="fnView('${id}', '223053', '', '','');">${title}</a></td><td>${date}</td></tr>`;
const listing = (rows) => `<form id="listFrm"></form><table class="basic-table01"><tbody>${rows}</tbody></table>`;
const url = (id) => `https://www.kotra.or.kr/kp/subList/20000005817?nttSeq=${id}&pmode=detail`;
const detail = (id, body) => `<form id="detailFrm"><input name="nttSeq" value="${id}"></form>
  <div class="list_tit"><h5>2026년 KOTRA 행정직 채용 공고</h5></div>
  <div class="conM_txt">${body}</div>`;
const readyBody = '<p>담당 업무: 해외사업 지원</p><p>지원 자격: 관련 업무 가능자</p><p>근무지: 서울</p><p>접수 마감일: 2099.12.31</p>';

test('every public source remains manual-only, and KOTRA URLs stay official', () => {
  assert.ok(COLLECTION_SOURCES.every((item) => item.mode === 'manual'));
  assert.equal(canonicalKotraUrl('https://kotra.or.kr/subList/20000005817?pmode=detail&nttSeq=29423'), url('29423'));
  assert.equal(canonicalKotraUrl('https://evil.example/kp/subList/20000005817?nttSeq=29423&pmode=detail'), '');
});

test('official board form creates bounded same-origin POST fields', () => {
  const fields = parseKotraBoardForm(shell);
  const request = kotraBoardRequest(fields, { sequence: '29423' });
  assert.equal(request.method, 'POST');
  assert.equal(new URLSearchParams(request.body).get('nttSeq'), '29423');
  assert.equal(new URLSearchParams(request.body).get('listCount'), '30');
  assert.throws(() => parseKotraBoardForm('<div id="bbs_area"></div>'), /board_parse_failed/);
});

test('AJAX board rows retain recruitment notices without treating posted age as a deadline', () => {
  const parsed = parseKotraListing(listing(
    row('29427', '2026년 KOTRA 행정직 채용 서류반환 및 성적공개 신청 안내')
    + row('29423', '2026년 4기 체험형 청년인턴 모집공고')
    + row('29237', '2026년 KOTRA 행정직 채용 공고', '2026-06-24')
  ), '2026-09-16');
  assert.deepEqual(parsed.items.map((item) => item.externalId), ['29423', '29237']);
  assert.equal(parsed.items[0].postedAt, '2026-09-09');
  assert.equal(parsed.stats.unrelated, 1);
  assert.equal(parsed.stats.expired, 0);
  assert.throws(() => parseKotraListing('<div id="bbs_area"></div>'), /list_parse_failed/);
  assert.equal(parseKotraListing(listing('<tr><td>등록된 게시물이 없습니다.</td></tr>')).items.length, 0);
});

test('detail requires explicit deadline, workplace, duties and qualifications; image stays pending', () => {
  const item = { sourceUrl: url('29423'), externalId: '29423', postedAt: '2026-09-09' };
  const ready = assessKotraDetail(detail('29423', readyBody), item, '2026-09-16');
  assert.equal(ready.outcome, 'ready');
  assert.equal(ready.candidate.country, '한국');
  assert.equal(ready.candidate.deadline, '2099-12-31');
  assert.equal(assessKotraDetail(detail('29423', '<img src="/upload/recruit.jpg">'), item).outcome, 'pending');
  assert.equal(assessKotraDetail(detail('29423', readyBody.replace('2099.12.31', '2026.09.01')), item, '2026-09-16').outcome, 'excluded');
  assert.equal(assessKotraDetail(detail('29423', readyBody.replace('근무지: 서울', '근무조건 확인')), item).outcome, 'pending');
  assert.throws(() => assessKotraDetail(detail('99999', readyBody), item), /detail_parse_failed/);
});

test('collector uses official list/detail POST, skips handled notices and does not misreport parse failure as zero', async () => {
  const calls = [];
  const fetchHtml = async (target, request) => {
    calls.push({ target, request });
    if (target === source.url) return shell;
    if (target === KOTRA_LIST_URL) return listing(row('29423', '2026년 4기 체험형 청년인턴 모집공고') + row('29237', '2026년 KOTRA 행정직 채용 공고'));
    if (target === KOTRA_DETAIL_URL) return detail('29423', '<img src="/upload/recruit.jpg">');
    throw new Error('Unexpected URL');
  };
  const result = await collectKotra(source, { fetchHtml, knownUrls: [url('29237')] });
  assert.equal(result.error, undefined);
  assert.equal(result.pending.length, 1);
  assert.equal(result.stats.skipped, 1);
  assert.deepEqual(calls.map((call) => call.target), [source.url, KOTRA_LIST_URL, KOTRA_DETAIL_URL]);
  assert.equal(new URLSearchParams(calls[2].request.body).get('nttSeq'), '29423');
  const failure = await collectKotra(source, { fetchHtml: async (target) => target === source.url ? shell : '<div>loading</div>' });
  assert.match(failure.error, /list_parse_failed/);
  assert.equal(failure.emptyReason, undefined);
});
