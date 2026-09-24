import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorldjobListing,parseWorldjobDetail,collectWorldjob} from '../src/worldjob.js';
import {canonicalPublicUrl,candidateIdentity} from '../src/publicJobSources.js';
import {analyzePublicUrl} from '../src/publicJobAnalysis.js';
const url='https://www.worldjob.or.kr/advnc/epmtLink.do?joCrtfcNo=E20260904004&joCrtfcDsp=1&joCrtfcDspSn=1';
const listing=`<div class="posting-list-wrap"><div class="post-box"><h5><a href="javascript:goView1('E20260904004','1','1','1');">담당자</a></h5></div></div>`;
const detail=(country='중국',language='',deadline='2099-01-01')=>`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'담당자',validThrough:deadline})}</script><table class="table-default">${Object.entries({'국가':country,'기업명':'예시 기업','자격요건':`<ul><li><strong>학력</strong>대졸</li><li><strong>외국어능력</strong>${language}</li></ul>`,'주요업무내용':'ㅇ주요 업무 내용<br>- 시장 분석<br>ㅇ 회사소개<br>중국 지사 운영','모집기간 (한국시간 기준)':`2026-01-01 ~ ${deadline}`}).map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
test('WorldJob literal list links and canonical identities preserve recruitment rounds',()=>{
 assert.equal(parseWorldjobListing(listing)[0].sourceUrl,url);
 assert.equal(candidateIdentity(url+'&menuId=other'),candidateIdentity(url));
 assert.notEqual(candidateIdentity(url.replace('DspSn=1','DspSn=2')),candidateIdentity(url));
 assert.equal(canonicalPublicUrl(url.replace('www.worldjob.or.kr','evil.example')),'');
 assert.throws(()=>parseWorldjobListing('<html>blocked</html>'));
});
test('WorldJob classifies only workplace and explicit language requirements, separates company prose',()=>{
 const job=parseWorldjobDetail(detail(),url);assert.equal(job.relevant,true);assert.deepEqual(job.responsibilities,['시장 분석']);
 assert.equal(parseWorldjobDetail(detail('일본'),url).relevant,false);
 assert.equal(parseWorldjobDetail(detail('일본','필수 중국어 능통'),url).relevant,false);
 assert.throws(()=>parseWorldjobDetail('<html>blocked</html>',url));
});
test('WorldJob collector excludes expired notices and keeps detail failures pending',async()=>{
 const source={id:'worldjob',name:'월드잡플러스',url:'https://www.worldjob.or.kr/list'};
 let r=await collectWorldjob(source,{fetchHtml:async u=>u.startsWith(source.url+'?')?listing:detail('중국','','2000-01-01')});
 assert.equal(r.candidates.length,0);assert.equal(r.stats.expired,1);
 r=await collectWorldjob(source,{fetchHtml:async u=>{if(u.startsWith(source.url+'?'))return listing;throw Error('timeout');}});
 assert.equal(r.pending.length,1);assert.equal(r.stats.detailFailed,1);
 r=await collectWorldjob(source,{fetchHtml:async u=>u.startsWith(source.url+'?')?listing:detail()});assert.equal(r.candidates.length,1);
 r=await collectWorldjob(source,{fetchHtml:async u=>u.startsWith(source.url+'?')?listing:detail('일본','한국어 중국어 필수')});assert.equal(r.candidates.length,0);assert.equal(r.stats.unrelated,1);
 r=await collectWorldjob(source,{fetchHtml:async u=>u.startsWith(source.url+'?')?listing:detail('','한국어 필수')});assert.equal(r.pending.length,1);
});
test('WorldJob saved source URL supports individual reanalysis',async()=>{
 const result=await analyzePublicUrl(url,{fetcher:async()=>new Response(detail())});
 assert.equal(result.outcome,'ready');assert.equal(result.proposed_data.company.name,'예시 기업');
});
