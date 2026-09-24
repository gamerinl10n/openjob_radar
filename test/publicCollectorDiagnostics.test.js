import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHtml, explainFetchError, inspectPublicListing, nextListingPages, SOURCES, collectPublicJobCandidates, koreaDate } from '../src/publicJobSources.js';
const source = SOURCES.find((item) => item.id === 'culture');
const link = '/recruitmentNoti/view.do?seq=123';
const row = (title, date='2099.01.01', href=link) => '<tr><td><a href="'+href+'">'+title+'</a></td><td>2026.09.01</td><td>'+date+'</td></tr>';
test('safe same-origin redirect follows and loops terminate', async () => {
 let calls = 0;
 const html = await fetchHtml(source.url, async () => ++calls === 1 ? new Response(null,{status:302,headers:{location:'/recruitmentNoti.do?page=1'}}) : new Response('<table></table>'));
 assert.equal(calls,2);assert.match(html,/table/);
 await assert.rejects(fetchHtml(source.url,async()=>new Response(null,{status:302,headers:{location:source.url}})),/redirect_loop/);
});
test('external redirects never followed', async () => {
 let calls=0;
 await assert.rejects(fetchHtml(source.url,async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.example/'}});}),/redirect_blocked/);
 assert.equal(calls,1);
});
test('official board POST keeps request body and never follows redirects', async () => {
 let options;
 const request={method:'POST',body:'nttSeq=29423',headers:{'Content-Type':'application/x-www-form-urlencoded'}};
 const html=await fetchHtml(source.url,async(_url,received)=>{options=received;return new Response('<table></table>');},{request});
 assert.match(html,/table/);
 assert.equal(options.method,'POST');assert.equal(options.body,'nttSeq=29423');
 await assert.rejects(fetchHtml(source.url,async()=>new Response(null,{status:302,headers:{location:'/next'}}),{request}),/redirect_blocked/);
});
test('network errors carry distinct reason', () => {
 assert.match(explainFetchError({message:'fetch failed',cause:{code:'ENOTFOUND'}}),/DNS/);
 assert.match(explainFetchError({name:'TimeoutError'}),/timeout/);
});
test('transient HTML failures retry once and honor bounded Retry-After', async () => {
 let calls=0,retry;
 const html=await fetchHtml(source.url,async()=>++calls===1
  ? new Response(null,{status:503,headers:{'retry-after':'1'}})
  : new Response('<table></table>'),{
   sleep:async()=>{},
   onRetry:(value)=>{retry=value;},
  });
 assert.equal(calls,2);assert.equal(retry.attempt,1);assert.equal(retry.delayMs,1000);assert.match(html,/table/);
});
test('non-transient HTTP failures do not retry', async () => {
 let calls=0;
 await assert.rejects(fetchHtml(source.url,async()=>{calls++;return new Response(null,{status:404});},{sleep:async()=>{}}),/404/);
 assert.equal(calls,1);
});
test('listing counts separate filters and bad URLs', () => {
 const r=inspectPublicListing('<table>'+row('주중국문화원 채용')+row('주일본문화원 채용')+row('주중국문화원 채용','2020.01.01')+row('주중국문화원 채용','2099.01.01','javascript:void(0)')+'</table>',source,'2026-09-06');
 assert.deepEqual(r.stats,{read:4,unrelated:1,expired:1,invalid:1});assert.equal(r.candidates.length,1);
});
test('page navigation bounded and same-path only', () => {
 assert.deepEqual(nextListingPages('<a href="?page=2">2</a><a href="?page=99">99</a><a href="https://evil.example/?page=3">3</a>',source),[source.url+'?page=2']);
});
test('unrecognized table is not a successful empty result', async () => {
 const {results}=await collectPublicJobCandidates(['culture'],{fetcher:async()=>new Response('<table><tr><td>로그인</td></tr></table>')});
 assert.match(results[0].error,/list_parse_failed/);
});
test('real empty filtered page is distinguished and second page read', async () => {
 const {results}=await collectPublicJobCandidates(['culture'],{fetcher:async(url)=>new Response(url.includes('/view.do')
   ? '<div class="viewCon">담당 업무: 현지 행사 운영 및 행정 업무 지원입니다.</div>'
   : '<table>'+row('주일본문화원 채용')+'</table>'+(!url.includes('page=2')?'<a href="?page=2">2</a>':''))});
 assert.equal(results[0].stats.pages,2);assert.equal(results[0].stats.unrelated,1);
 assert.match(results[0].emptyReason,/조건에 맞는/);
});

test('HTML downloads reject unsupported types and oversized bodies', async () => {
 await assert.rejects(fetchHtml(source.url,async()=>new Response('<html></html>',{
  headers:{'content-type':'application/json'}
 })),/content_type/);
 await assert.rejects(fetchHtml(source.url,async()=>new Response('',{
  headers:{'content-type':'text/html','content-length':String(2*1024*1024+1)}
 })),/body_limit/);
});
test('deadline checks use the Korean calendar date', () => {
 assert.equal(koreaDate(Date.parse('2026-09-15T14:59:59Z')),'2026-09-15');
 assert.equal(koreaDate(Date.parse('2026-09-15T15:00:00Z')),'2026-09-16');
});
