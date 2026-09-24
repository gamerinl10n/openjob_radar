import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicDetail, collectPublicJobCandidates } from '../src/publicJobSources.js';
const sourceUrl = 'https://www.korean-culture.org/recruitmentNoti/view.do?seq=2088';
const candidate = { title: '주상하이한국문화원 한국인 행정직원 채용공고', sourceUrl };
// Short excerpt of the official 2013-10-18 post, seq=2088; never imported into production.
const excerpt = '<div class="viewCon" id="viewContent">2. 담당업무<br>ㅇ 문화원 공연, 전시, 강좌 등 관련 업무<br>3. 근무조건<br>4. 응시자격<br>ㅇ 한국 국적자<br>ㅇ 중국어 능통자</div>';
test('official culture body excerpt separates sections', () => {
 const job = parsePublicDetail(excerpt, candidate);
 assert.deepEqual(job.responsibilities, ['문화원 공연, 전시, 강좌 등 관련 업무']);
 assert.deepEqual(job.requirements, ['한국 국적자', '중국어 능통자']);
 assert.deepEqual(job.languages, ['중국어']);
});
test('synthetic detail keeps application and dates out of qualifications', () => {
 const html = '<div class="viewCon"><p>지원 자격: 중국어 능통자</p><p>관련 경력 우대</p><p>접수 기간: 2099.01.01 ~ 2099.01.31</p><p>지원 방법: 이메일로 제출</p><p>전형 방법</p><p>면접일 2099.02.10</p></div><footer>한국어 능통자</footer>';
 const job = parsePublicDetail(html, { ...candidate, title: '행정직원 채용' });
 assert.equal(job.relevant, true);
 assert.equal(job.deadline, '2099-01-31');
 assert.deepEqual(job.requirements, ['중국어 능통자']);
 assert.deepEqual(job.preferred, ['관련 경력 우대']);
 assert.deepEqual(job.languages, ['중국어']);
 assert.equal(job.application.method, '이메일로 제출');
});
test('attachment preview uses official href and does not invent qualifications', () => {
 const html = '<form><div class="viewFile"><ul><li><a href="javascript:filedown()">공고.hwp</a><a href="/docViewer/skin/doc.html?fn=sample.hwp">바로보기</a></li></ul></div></form><div class="viewCon">자세한 채용 조건은 상단 붙임파일을 확인하시기 바랍니다.</div><footer><a href="https://evil.example/file.pdf">file.pdf</a></footer>';
 const job = parsePublicDetail(html, candidate);
 assert.equal(job.attachments.length, 1);
 assert.equal(job.attachments[0].name, '공고.hwp');
 assert.match(job.attachments[0].url, /^https:\/\/www.korean-culture.org\/docViewer\//);
 assert.deepEqual(job.requirements, []);
 assert.ok(job.warnings.some((text) => text.includes('첨부파일')));
});
test('collection checks body before excluding and ignores footer languages', async () => {
 const listing = '<table>'+[1,2,3].map((id) => '<tr><td><a href="/recruitmentNoti/view.do?seq='+id+'">행정직원 채용 '+id+'</a></td><td>2026.09.01</td><td>2099.01.31</td></tr>').join('')+'</table>';
 const {results} = await collectPublicJobCandidates(['culture'], { fetcher: async (url) => new Response(
   !url.includes('/view.do') ? listing : '<div class="viewCon"><p>담당 업무: 행사 운영 및 행정 업무 지원</p><p>지원 자격: '+(url.endsWith('1') ? '중국어 능통자' : '행사 운영 경력자')+'</p>'+
   (url.endsWith('3') ? '<p>접수 마감일: 2020.01.01</p>' : '')+'</div><footer>한국어 중국 베이징</footer>'
 )});
 assert.equal(results[0].candidates.length, 0);
 assert.equal(results[0].pending.length, 2);
 assert.equal(results[0].stats.unrelated, 0);
 assert.equal(results[0].stats.expired, 1);
 assert.equal(results[0].stats.detailFailed, 0);
});
test('a missing list deadline is checked in the body before saving', async () => {
 const {results} = await collectPublicJobCandidates(['culture'], {fetcher: async (url) => new Response(
   !url.includes('/view.do') ? '<table><tr><td><a href="/recruitmentNoti/view.do?seq=1">주상하이문화원 채용</a></td><td>2020.01.01</td></tr></table>'
     : '<div class="viewCon">담당 업무: 행사 운영 지원<br>접수 마감일: 2020.01.02</div>'
 )});
 assert.equal(results[0].candidates.length, 0);
 assert.equal(results[0].stats.expired, 1);
});
