import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION_SOURCES } from '../src/sources.js';
import { canonicalMofaUrl, mofaSourceFor, parseMofaListing, parseMofaDetail, mofaPages, collectMofa } from '../src/mofa.js';
import { fetchHtml, canonicalPublicUrl } from '../src/publicJobSources.js';
import { analyzePublicUrl } from '../src/publicJobAnalysis.js';
import { validateBackup } from '../src/backup.js';
const source = COLLECTION_SOURCES.find(s => s.id === 'mofa-china');
const shanghai = COLLECTION_SOURCES.find(s => s.id === 'mofa-shanghai');
const url = source.url.replace('list.do','view.do') + '?seq=12';
const row = (id,title) => `<tr><td><div><a href="#" onclick="f_view('${id}'); return false;">${title}</a></div></td><td>2026-09-23</td></tr>`;
const table = rows => `<table class="tableB type3">${rows}</table>`;
const listing = table(row(12,'주중국대사관 행정직원 채용공고'));
const detail = (body, extra = '', title = '주중국대사관 행정직원 채용공고') => `<div class="board_detail"><div class="bo_head"><h2>${title}</h2></div>${extra}<div class="bo_con"><div>${body}</div></div><nav>담당 업무: 다른 공고의 업무</nav></div>`;
const textBody = '<p>담당 업무: 통번역</p><p>지원 자격: 중국어 능통</p><p>마감일: 2099.12.31</p>';
const seed = {title:'목록 제목',sourceUrl:url,sourceName:source.name,externalId:'mofa-china-12'};

test('public same-URL redirect session cookie is scoped to one request chain', async () => {
  const seen = []; let calls=0;
  const fetcher=async(_url,options)=>{seen.push(options.headers.Cookie);return ++calls%2 ? new Response(null,{status:307,headers:{Location:'https://www.mofa.go.kr/list','Set-Cookie':'TMOSHCooKie=sample; Path=/; Secure; HttpOnly'}}) : new Response('<html>ok</html>');};
  await fetchHtml('https://www.mofa.go.kr/list',fetcher);
  await fetchHtml('https://www.mofa.go.kr/list',fetcher);
  assert.deepEqual(seen,[undefined,'TMOSHCooKie=sample',undefined,'TMOSHCooKie=sample']);
});
test('session cookie never permits foreign redirects and identical cookie loops stop', async () => {
  let calls=0;
  await assert.rejects(fetchHtml('https://www.mofa.go.kr/list',async()=>{calls++;return new Response(null,{status:307,headers:{Location:'https://evil.example/','Set-Cookie':'session=sample'}});}),/redirect_blocked/);
  assert.equal(calls,1);
  await assert.rejects(fetchHtml('https://www.mofa.go.kr/list',async()=>new Response(null,{status:307,headers:{Location:'https://www.mofa.go.kr/list','Set-Cookie':'session=same'}})),/redirect_loop/);
});
test('mission identity is board-scoped and canonical aliases do not admit unrelated hosts', () => {
  assert.equal(canonicalMofaUrl(url.replace('www.','cn.')+'&page=2'),url);
  assert.equal(canonicalPublicUrl(url),url);
  for (const invalid of [url.replace('www.mofa.go.kr','evil.example'),url.replace('m_1276','m_999'),url.replace('https:','http:'),url.replace('www.','user@www.')]) assert.equal(canonicalMofaUrl(invalid),'');
  assert.equal(mofaSourceFor(shanghai.url.replace('list.do','view.do')+'?seq=12').id,shanghai.id);
});
test('official f_view list links are parsed literally and posting dates are not deadlines', () => {
  const parsed=parseMofaListing(table(row(12,'주중국대사관 채용공고')+row(13,'주중국대사관 채용 최종 합격자')+row(14,'주중국대사관 채용공고 (2020.1.1 限)')),source);
  assert.equal(parsed.items.length,1);assert.equal(parsed.items[0].deadline,'');assert.equal(parsed.items[0].postedAt,'2026-09-23');
  assert.equal(parsed.stats.expired,1);assert.equal(parsed.stats.unrelated,1);
  assert.notEqual(parseMofaListing(listing,shanghai).items[0].externalId,parsed.items[0].externalId);
  assert.equal(parseMofaListing(table('<tr><td>등록된 게시물이 없습니다.</td></tr>'),source).items.length,0);
  assert.throws(()=>parseMofaListing('<html>로그인</html>',source),/list_parse_failed/);
  assert.throws(()=>parseMofaListing(table('<tr><td>다른 문서</td></tr>'),source),/list_parse_failed/);
});
test('image-only mission posting stays pending with safe official HWP attachment and title deadline', () => {
  const attachment=`<div class="bo_file"><a href="javascript:f_down('./down.do?brd_id=1&amp;seq=12&amp;data_tp=A&amp;file_seq=1');"><span>공고.hwp</span></a><a href="javascript:f_down('https://evil.example/down.do?seq=12');">가짜.hwp</a></div>`;
  const result=parseMofaDetail(detail('<img src="/upload/post.jpg">',attachment,'주중국대사관 채용공고(2099.10.12 12:00 限)'),seed);
  assert.equal(result.outcome,'pending');assert.equal(result.candidate.deadline,'2099-10-12');
  assert.match(result.reason,/이미지/);assert.match(result.reason,/지원 자격/);assert.equal(result.candidate.attachments.length,1);
  assert.match(result.candidate.attachments[0].url,/https:\/\/www.mofa.go.kr\/cn-ko\/brd\/m_1276\/down.do/);
});
test('mission detail only accepts explicit fields and excludes expired or foreign workplaces', () => {
  const ready=parseMofaDetail(detail(textBody),seed);
  assert.equal(ready.outcome,'ready');assert.deepEqual(ready.candidate.responsibilities,['통번역']);assert.equal(ready.candidate.country,'중국');
  assert.equal(parseMofaDetail(detail(textBody.replace('2099.12.31','2020.01.01')),seed).outcome,'excluded');
  assert.equal(parseMofaDetail(detail(textBody,'','주프랑스대사관 채용공고'),seed).outcome,'excluded');
  assert.throws(()=>parseMofaDetail('<html>다른 페이지</html>',seed),/detail_parse_failed/);
});
test('mission pagination is official, board-scoped, deduplicated and bounded', () => {
  const html='<a href="?page=2">2</a><a href="?page=2">다음</a><a href="?page=5">5</a><a href="?page=999">끝</a><a href="https://evil.example/?page=3">x</a>';
  assert.equal(mofaPages(html,source,3).length,1);assert.equal(mofaPages(html,source,5).length,2);
});
test('collector retains readable fields and attachments without converting detail failure into zero jobs', async () => {
  const result=await collectMofa(source,{fetchHtml:async target=>target===source.url ? listing : detail('<p>담당 업무: 번역</p>')});
  assert.equal(result.pending.length,1);assert.deepEqual(result.pending[0].draft.responsibilities,['번역']);
  const failed=await collectMofa(source,{fetchHtml:async target=>{if(target===source.url)return listing;throw Error('offline');}});
  assert.equal(failed.stats.detailFailed,1);assert.match(failed.pending[0].reason,/offline/);
  const noList=await collectMofa(source,{fetchHtml:async()=>{throw Error('offline');}});assert.match(noList.error,/offline/);assert.equal(noList.emptyReason,undefined);
});
test('individual reanalysis resolves the correct mission sharing the same hostname', async () => {
  const target=shanghai.url.replace('list.do','view.do')+'?seq=12';
  const result=await analyzePublicUrl(target,{fetcher:async()=>new Response(detail(textBody,'','주상하이대한민국총영사관 채용공고'))});
  assert.equal(result.outcome,'ready');assert.equal(result.proposed_data.source.name,shanghai.name);assert.equal(result.proposed_data.source.externalId,'mofa-shanghai-12');
});
test('backups accept all registered mission health records and reject unknown sources', () => {
  const backup={format:'openjob-radar-backup',version:1,files:{'review.json':{ready:[],needsReview:[]},'approved.json':[],'rejected.json':[],'last-run.json':null,'state.json':{worldjob:{nextPage:1}},'source-health.json':{'mofa-china':{state:'success',warnings:[]},'mofa-shanghai':{state:'partial',warnings:['본문 확인']}}}};
  assert.ok(validateBackup(backup));backup.files['source-health.json'].unknown={state:'success',warnings:[]};assert.throws(()=>validateBackup(backup),/출처 상태/);
});

test('title date ranges use the explicit end date without guessing a partial-year deadline', () => {
  const full=parseMofaListing(table(row(12,'주중국대사관 채용공고 (2020.1.1 ~ 2099.12.31까지)')),source);
  assert.equal(full.items[0].deadline,'2099-12-31');
  const partial=parseMofaListing(table(row(12,'주중국대사관 채용공고 (2020.1.1 ~ 12.31까지)')),source);
  assert.equal(partial.items[0].deadline,'');assert.equal(partial.stats.expired,0);
});
