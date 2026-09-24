import test from 'node:test';import assert from 'node:assert/strict';
import {collectWorldjob} from '../src/worldjob.js';
const url='https://www.worldjob.or.kr/advnc/epmtLink.do?joCrtfcNo=E20260904004&joCrtfcDsp=1&joCrtfcDspSn=1';
const html=`<div class="posting-list-wrap"><div class="post-box"><h5><a href="javascript:goView1('E20260904004','1','1','1');">공고</a></h5></div><a href="javascript:goList('1',2)">2</a><a href="javascript:goList('1',3)">3</a></div>`;
test('resumed scan also checks latest page and skips existing details',async()=>{
 const calls=[];const result=await collectWorldjob({id:'worldjob',name:'월드잡',url:'https://www.worldjob.or.kr/advnc/cnttNewList.do'},{page:2,known:new Set([url]),fetchHtml:async u=>{calls.push(u);return html;}});
 assert.equal(calls.length,2);assert.ok(calls.some(u=>u.includes('pageIndex=1')));assert.ok(calls.some(u=>u.includes('pageIndex=2')));
 assert.equal(result.progress.nextPage,3);assert.equal(result.stats.skipped,2);assert.equal(result.candidates.length,0);
});
test('end of list cycles to first page and network failure never fabricates progress',async()=>{
 const source={id:'worldjob',name:'월드잡',url:'https://www.worldjob.or.kr/advnc/cnttNewList.do'};
 const result=await collectWorldjob(source,{page:1,fetchHtml:async()=>'<div class="posting-list-wrap">총 0개</div>'});
 assert.equal(result.progress.nextPage,1);assert.equal(result.progress.cycleComplete,true);
 const failed=await collectWorldjob(source,{fetchHtml:async()=>{throw Error('offline');}});assert.ok(failed.error);assert.equal(failed.progress,undefined);
});

test('resumed scan keeps candidates when only one page fails',async()=>{
 const source={id:'worldjob',name:'월드잡',url:'https://www.worldjob.or.kr/advnc/cnttNewList.do'};
 const detail=`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'담당자',validThrough:'2099-01-01'})}</script>
  <table class="table-default"><tr><th>국가</th><td>중국</td></tr><tr><th>기업명</th><td>예시 기업</td></tr>
  <tr><th>자격요건</th><td><ul><li><strong>학력</strong>대졸</li><li><strong>외국어능력</strong>중국어 가능</li></ul></td></tr>
  <tr><th>주요업무내용</th><td>ㅇ주요 업무 내용<br>- 시장 분석<br>ㅇ 회사소개<br>중국 지사 운영</td></tr>
  <tr><th>모집기간 (한국시간 기준)</th><td>2026-01-01 ~ 2099-01-01</td></tr></table>`;
 const run=failPage=>collectWorldjob(source,{page:2,fetchHtml:async requestUrl=>{
  if(requestUrl.includes('pageIndex='+failPage))throw Error('offline');
  if(requestUrl.includes('pageIndex='))return html;
  return detail;
 }});
 const latestFailed=await run(1);
 assert.equal(latestFailed.error,undefined);
 assert.equal(latestFailed.candidates.length,1);
 assert.equal(latestFailed.progress.nextPage,3);
 assert.match(latestFailed.warnings.join(' '),/최신 목록 조회 실패/);
 const olderFailed=await run(2);
 assert.equal(olderFailed.error,undefined);
 assert.equal(olderFailed.candidates.length,1);
 assert.equal(olderFailed.progress,undefined);
 assert.match(olderFailed.warnings.join(' '),/이어보기 2페이지 조회 실패/);
 const bothFailed=await collectWorldjob(source,{page:2,fetchHtml:async()=>{throw Error('offline');}});
 assert.match(bothFailed.error,/최신 목록 조회 실패/);
 assert.match(bothFailed.error,/이어보기 2페이지 조회 실패/);
});
