import { workLocationDecision } from './workLocationPolicy.js';
import { parseWorldjobDetail } from './worldjob.js';
import { assessKotraDetail, fetchKotraDetail } from './kotra.js';
import { SOURCES, canonicalPublicUrl, candidateIdentity, clean, fetchHtml, parsePublicDetail, enrichPublicDetail } from './publicJobSources.js';
import { normalizeCandidate } from './normalizeCandidate.js';

export function candidateData(candidate) {
 const job = normalizeCandidate(candidate);
 const { id, radarId, slug, source, status, verifiedAt, ...data } = job;
 return { ...data, source: { name: source.name, externalId: candidate.externalId },
  employmentNotes: candidate.employmentNotes || [],
  attachments: (candidate.attachments || []).map(({ name, url }) => ({ name, url })),
  radar: { ...data.radar, warnings: candidate.warnings || [], pdfSource: candidate.pdfSource || null } };
}
export async function analyzePublicUrl(sourceUrl, { fetcher = fetch, pdfOptions = {} } = {}) {
 const url = canonicalPublicUrl(sourceUrl);
 const source = SOURCES.find(s => url && new URL(s.url).origin === new URL(url).origin);
 if (!source) throw new Error('현재 수집을 지원하는 사이트의 상세 공고만 재분석할 수 있습니다.');
 if (source.id === 'kotra') {
  const item = { sourceUrl: url, externalId: new URL(url).searchParams.get('nttSeq'), postedAt: '' };
  const detail = await fetchKotraDetail(url, (target, request) => fetchHtml(target, fetcher, { request }));
  const { outcome, candidate, reason } = assessKotraDetail(detail, item);
  return { identity: candidateIdentity(url), proposed_data: candidateData(candidate), outcome, reason };
 }
 const html = await fetchHtml(url, fetcher);
 if (source.id === 'worldjob') {
  const candidate = parseWorldjobDetail(html, url);
  const expired = candidate.deadline && candidate.deadline < new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const location=workLocationDecision(candidate,{structuredCountry:true});
  const outcome = expired || location.state==='excluded' ? 'excluded' : location.state==='pending' || candidate.needsAttachment ? 'pending' : 'ready';
  return { identity: candidateIdentity(url), proposed_data: candidateData(candidate), outcome,
   reason: expired ? '모집기간이 끝났습니다.' : location.reason || (outcome === 'pending' ? '업무·자격·마감일 확인이 필요합니다.' : outcome === 'excluded' ? '근무 국가를 확인해 주세요.' : '') };
 }
 // Never use an administrator-edited title to decide source relevance.
 const title = clean(html.match(/<h[1-6]\b[^>]*id=["']viewTitle["'][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || '');
 if (!title || !/채용|모집/.test(title)) throw new Error('원문 공고 제목을 확인하지 못했습니다.');
 const seed = { title, company: title.match(/주[^\s()[\]]*(?:총영사관|대사관|한국문화원)/)?.[0] || source.name,
  sourceName: source.name, sourceUrl: url, externalId: new URL(url).searchParams.get('seq') };
 const candidate = await enrichPublicDetail(parsePublicDetail(html, seed), { fetcher, ...pdfOptions });
 const expired = candidate.deadline && candidate.deadline < new Date().toISOString().slice(0,10);
 const location=workLocationDecision(candidate);
 if(location.country) candidate.country=location.country;
 const outcome = expired || location.state==='excluded' || /합격자|결과\s*발표|채용\s*취소/.test(title) ? 'excluded'
  : location.state==='pending' || candidate.needsAttachment ? 'pending' : 'ready';
 const reason = expired ? '명시된 마감일이 지났습니다.' : location.reason || (outcome === 'pending'
  ? candidate.attachmentReason || '첨부파일 확인이 필요합니다.' : outcome === 'excluded'
  ? '현재 수집 조건에 맞는 모집 공고인지 확인이 필요합니다.' : '');
 return { identity: candidateIdentity(url), proposed_data: candidateData(candidate), outcome, reason };
}
