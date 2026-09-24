import test from 'node:test';import assert from 'node:assert/strict';
import {workLocationDecision as decide} from '../src/workLocationPolicy.js';
import {analyzePublicUrl} from '../src/publicJobAnalysis.js';
test('only Korea and China workplaces qualify regardless of language',()=>{
 for(const country of ['한국','대한민국','중국','China','KR','홍콩','마카오'])assert.equal(decide({country},{structuredCountry:true}).state,'ready');
 for(const country of ['일본','미국','싱가포르','대만'])assert.equal(decide({country,languages:['한국어','중국어']},{structuredCountry:true}).state,'excluded');
 assert.equal(decide({country:''},{structuredCountry:true}).state,'pending');
 assert.equal(decide({title:'주로스앤젤레스한국문화원 한국어 담당 채용'}).state,'excluded');
 assert.equal(decide({title:'주상하이한국문화원 채용'}).state,'ready');
 assert.equal(decide({title:'한국어 중국어 가능자 채용'}).state,'pending');
 assert.equal(decide({title:'담당자 채용',workplace:'서울 강남구'}).country,'한국');
});
test('reanalysis rejects foreign institutions even with Korean language requirements',async()=>{
 const html='<h3 id="viewTitle">주로스앤젤레스한국문화원 채용</h3><div class="viewCon"><p>담당 업무</p><p>문화행사 운영 및 현장 지원</p><p>지원 자격</p><p>한국어 능통자</p><p>접수 마감일: 2099.12.31</p></div>';
 const result=await analyzePublicUrl('https://www.korean-culture.org/recruitmentNoti/view.do?seq=9',{fetcher:async()=>new Response(html)});
 assert.equal(result.outcome,'excluded');assert.match(result.reason,/외 지역/);
});
