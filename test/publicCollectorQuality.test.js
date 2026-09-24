import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicListing, parsePublicDetail, canonicalPublicUrl, candidateIdentity, SOURCES } from '../src/publicJobSources.js';
import { runRadarPipeline } from '../src/runPipeline.js';
import { statusLabel, safeSourceUrl } from '../src/sources.js';

const source = SOURCES.find((item) => item.id === 'culture');
const url = 'https://www.korean-culture.org/recruitmentNoti/view.do?seq=123';
const title = '주중국한국문화원 행정직원 채용 공고';
const row = (href, text) => '<tr><td><a href="' + href + '">' + text + '</a></td><td>2026.09.01</td><td>2026.09.30</td></tr>';

test('navigation and footer links are not jobs', () => {
 const html = '<a href="https://china.korean-culture.org/ko">중국 - 베이징</a>' +
 row('https://china.korean-culture.org/ko', '중국 채용 공고') + row(url, title);
 assert.equal(parsePublicListing(html, source, '2026-09-06').length, 1);
});
test('filters results, expired posts and unrelated countries', () => {
 assert.equal(parsePublicListing(row(url, '주중국한국문화원 최종합격자 발표'), source).length, 0);
 assert.equal(parsePublicListing(row(url, '주이집트한국문화원 직원 채용'), source).length, 0);
 assert.equal(parsePublicListing(row(url, title), source, '2026-10-01').length, 0);
});
test('canonical identity ignores paging and rejects unsafe/non-detail links', () => {
 assert.equal(canonicalPublicUrl(url + '&page=3&utm_source=x'), url);
 assert.equal(candidateIdentity(url), candidateIdentity(url + '&page=1'));
 assert.equal(canonicalPublicUrl('javascript:alert(1)'), '');
 assert.equal(canonicalPublicUrl('https://china.korean-culture.org/ko'), '');
});
test('details are separated; attachment-only text is not invented', () => {
 const candidate = parsePublicListing(row(url, title), source, '2026-09-06')[0];
 const job = parsePublicDetail('<div class="view_cont"><p>담당 업무: 행정 지원</p><p>지원 자격: 중국어 가능자</p><p>우대 사항: 관련 경력</p><p>첨부파일을 확인하세요.</p></div><footer>학력: 박사</footer>', candidate);
 assert.match(job.responsibilities[0], /행정 지원/);
 assert.match(job.requirements[0], /중국어/);
 assert.equal(job.educationLevel, '');
 assert.ok(job.warnings.length);
 assert.throws(() => parsePublicDetail('<html>로그인 안내</html>', candidate));
});
test('safe links and Korean labels', () => {
 assert.equal(statusLabel('draft'), '검토 대기');
 assert.equal(safeSourceUrl('javascript:alert(1)'), '');
});
test('Git review pipeline marks repeat source URLs as duplicates without a database', () => {
 const raw = { title, company: '주중국한국문화원', country: '중국', sourceName: source.name,
  sourceUrl: url, responsibilities: ['행정 지원'], requirements: ['중국어 가능자'] };
 const [first] = runRadarPipeline([raw], [], { collectedAt: '2026-09-24T00:00:00Z' });
 const [repeat] = runRadarPipeline([raw], [first.job], { collectedAt: '2026-09-24T01:00:00Z' });
 assert.equal(first.job.status, 'draft');
 assert.equal(repeat.job.status, 'duplicate');
});
