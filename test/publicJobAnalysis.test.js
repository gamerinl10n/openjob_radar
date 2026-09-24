import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePublicUrl} from '../src/publicJobAnalysis.js';
const url='https://www.korean-culture.org/recruitmentNoti/view.do?seq=9';
const html=`<h3 id="viewTitle">주상하이한국문화원 채용 공고</h3><div class="viewCon"><p>담당 업무</p><p>문화행사 운영 및 현장 지원</p><p>지원 자격</p><p>중국어 능통자</p><p>접수 마감일: 2099.12.31</p></div>`;
test('reanalysis uses fresh source title, classifies and never invents missing fields',async()=>{
 const result=await analyzePublicUrl(url,{fetcher:async()=>new Response(html)});
 assert.equal(result.outcome,'ready');assert.equal(result.proposed_data.location.city,'상하이');
 assert.deepEqual(result.proposed_data.responsibilities,['문화행사 운영 및 현장 지원']);
 assert.equal(result.proposed_data.educationLevel,'');assert.equal(result.proposed_data.deadline,'2099-12-31');
 await assert.rejects(analyzePublicUrl('https://evil.example/test'),/지원/);
 await assert.rejects(analyzePublicUrl(url,{fetcher:async()=>new Response('<div>제목 구조 변경</div>')}),/제목/);
});
test('expired or insufficient documents remain unapplied proposals',async()=>{
 const expired=await analyzePublicUrl(url,{fetcher:async()=>new Response(html.replace('2099.12.31','2000.01.01'))});
 assert.equal(expired.outcome,'excluded');
 const missing=await analyzePublicUrl(url,{fetcher:async()=>new Response('<h3 id="viewTitle">한국어 강사 모집</h3><div class="viewCon"><p>지원 요건과 담당 업무의 자세한 내용은 첨부파일을 참고하시기 바랍니다.</p></div>')});
 assert.equal(missing.outcome,'pending');
});
test('KOTRA reanalysis uses official detail POST and preserves image-only notices as pending', async () => {
 const kotraUrl='https://www.kotra.or.kr/kp/subList/20000005817?nttSeq=29423&pmode=detail';
 const calls=[];
 const shell='<form id="bbsFrm"><input name="siteSeq" value="20000002134"><input name="bbsSeq" value="20000026831"><input name="menuSeq" value="20000005817"><input name="sitecntntsSeq" value="20000004887"></form>';
 const detail='<form id="detailFrm"><input name="nttSeq" type="hidden" value="29423"></form><div class="list_tit"><h5>2026년 4기 체험형 청년인턴 모집공고</h5></div><div class="conM_txt"><img src="/upload/recruit.jpg"></div>';
 const result=await analyzePublicUrl(kotraUrl,{fetcher:async(target,options={})=>{
  calls.push({target,options});return new Response(target.includes('DetailAjax')?detail:shell);
 }});
 assert.equal(result.outcome,'pending');
 assert.equal(result.proposed_data.title,'2026년 4기 체험형 청년인턴 모집공고');
 assert.deepEqual(calls.map(({target})=>target),[
  'https://www.kotra.or.kr/subList/20000005817',
  'https://www.kotra.or.kr/module/ntt/unity/selectNttDetailAjax.do',
 ]);
 assert.equal(calls[1].options.method,'POST');
});
