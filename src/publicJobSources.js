import { workLocationDecision } from './workLocationPolicy.js';
import { canonicalKotraUrl, collectKotra } from './kotra.js';
import { canonicalWorldjobUrl, collectWorldjob } from './worldjob.js';
import { detailFields, detailAttachments } from './publicJobDetail.js';
import { readJobPdf } from './publicJobPdf.js';
import { createRequestLimiter } from './requestLimiter.js';
import { httpResponseError, withTransientRetry } from './fetchRetry.js';
import { createHash } from 'node:crypto';
import { COLLECTION_SOURCES } from './sources.js';

export const SOURCES = COLLECTION_SOURCES;
const CHINA = /(중국(?!어)|주중(?:국|\s)|베이징|북경|상하이|상해|선양|심양|광저우|칭다오|청도|청두|성도|시안|서안|우한|무한|다롄|대련|홍콩|마카오)/;
const LANGUAGE = /(중국어|한국어|韩语|朝鲜语)/;
const RECRUIT = /(채용|모집)/;
const SKIP = /(합격자|결과\s*발표|면접\s*(안내|대상)|채용\s*취소)/;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_REQUESTS = 8;
export const koreaDate = (now = Date.now()) =>
  new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const clean = (value = '') => value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&quot;|&ldquo;|&rdquo;/gi, '"').replace(/&#39;|&apos;|&lsquo;|&rsquo;/gi, "'").replace(/\s+/g, ' ').trim();
const dates = (text) => [...text.matchAll(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/g)]
  .map((m) => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'));
export function canonicalPublicUrl(value) {
  const kotra = canonicalKotraUrl(value);
  if (kotra) return kotra;
  const worldjob = canonicalWorldjobUrl(value);
  if (worldjob) return worldjob;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return '';
    const supported = (u.hostname === 'www.mofa.go.kr' && /^\/www\/brd\/m_4079\/view.do$/.test(u.pathname))
      || (u.hostname === 'www.korean-culture.org' && u.pathname === '/recruitmentNoti/view.do');
    const seq = u.searchParams.get('seq');
    return supported && /^\d+$/.test(seq || '') ? u.origin + u.pathname + '?seq=' + seq : '';
  } catch { return ''; }
}
export const candidateIdentity = (url) => 'public-' + createHash('sha256').update(canonicalPublicUrl(url)).digest('hex').slice(0, 24);
const cityFromTitle = (title) => {
  const cities = [['상하이', /상하이|상해/], ['베이징', /베이징|북경|주중국대사관/], ['홍콩', /홍콩/],
    ['칭다오', /칭다오|청도/], ['광저우', /광저우/], ['선양', /선양|심양/], ['청두', /청두|성도/],
    ['시안', /시안|서안/], ['우한', /우한|무한/], ['다롄', /다롄|대련/], ['마카오', /마카오/]];
  return cities.find(([, pattern]) => pattern.test(title))?.[0] || '';
};
export function inspectPublicListing(html, source, today = koreaDate(), { deferRelevance = false } = {}) {
  const stats = { read: 0, unrelated: 0, expired: 0, invalid: 0 };
  const exclusions = [];
  const exclude = (title, reason, href) => {
    if (exclusions.length >= 60) return;
    let url = '';
    try { url = canonicalPublicUrl(new URL(href.replace(/&amp;/g, '&'), source.url).href); } catch {}
    exclusions.push({ title: title.slice(0, 300), reason, url });
  };
  const candidates = new Map();
  // Only recruitment board rows; never navigation/footer anchors.
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    for (const a of row[1].matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const title = clean(a[2]);
      if (!RECRUIT.test(title)) continue;
      stats.read++;
      if (SKIP.test(title)) { stats.unrelated++; exclude(title, '합격 발표·결과 안내 등 모집 공고가 아님', a[1]); continue; }
      if (!deferRelevance && !(CHINA.test(title) || LANGUAGE.test(title))) { stats.unrelated++; exclude(title, '제목에 중국 지역 또는 한국어·중국어 조건이 없음', a[1]); continue; }
      let url;
      try { url = canonicalPublicUrl(new URL(a[1].replace(/&amp;/g, '&'), source.url).href); } catch { stats.invalid++; exclude(title, '상세주소 해석 실패', a[1]); continue; }
      if (!url || new URL(url).hostname !== new URL(source.url).hostname) { stats.invalid++; exclude(title, '공식 상세주소 형식과 맞지 않음', a[1]); continue; }
      const rowDates = dates(clean(row[1]));
      const deadline = source.id === 'culture' ? rowDates[1] || '' : '';
      if (deadline && deadline < today) { stats.expired++; exclude(title, '명시된 마감일이 지남: ' + deadline, a[1]); continue; }
      candidates.set(url, {
        radarId: candidateIdentity(url), externalId: new URL(url).searchParams.get('seq'),
        title, company: title.match(/주[^\s()[\]]*(?:총영사관|대사관|한국문화원)/)?.[0] || source.name,
        country: CHINA.test(title) ? '중국' : '', city: cityFromTitle(title), category: 'other',
        sourceName: source.name, sourceUrl: url, postedAt: rowDates[0] || '', deadline,
        educationLevel: '', experienceLevel: '', employmentType: '', languages: [],
        responsibilities: [], requirements: [], preferred: [],
      });
    }
  }
  return { candidates: [...candidates.values()], stats, exclusions };
}
export function parsePublicListing(html, source, today) {
  return inspectPublicListing(html, source, today).candidates;
}
// Extract one balanced content container, excluding footer and previous/next postings.
export function contentContainer(html) {
  const start = /<(div|article)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:view_cont|view-con|viewCon|board_view_content|board-view-content|board_txt|view_txt|bbs_content|board-content)[^"']*["'][^>]*>/i.exec(html);
  if (!start) return '';
  const tag = start[1]; const rest = html.slice(start.index + start[0].length);
  const tags = new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi'); let depth = 1;
  for (const match of rest.matchAll(tags)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (!depth) return rest.slice(0, match.index);
  }
  return '';
}
export function parsePublicDetail(html, candidate) {
  const body = contentContainer(html);
  if (!body) throw new Error('상세 본문 구조를 확인하지 못해 저장하지 않았습니다.');
  const lines = body.replace(/<\/(?:p|div|li|tr|h[1-6])>|<br\s*\/?>/gi, '\n').split('\n').map(clean).filter(Boolean);
  const text = lines.join('\n');
  if (text.length < 20) throw new Error('상세 본문이 비어 있어 저장하지 않았습니다.');
  const fields = detailFields(lines, candidate);
  const attachments = detailAttachments(html, body, candidate.sourceUrl, clean);
  const warnings = [];
  if (attachments.length || /첨부|붙임/.test(text)) warnings.push('첨부파일 본문은 자동 해석하지 않았습니다. 원문의 첨부파일을 확인해 주세요.');
  if (!fields.requirements.length) warnings.push('지원 자격은 원문 확인이 필요합니다.');
  if (!fields.responsibilities.length) warnings.push('업무 내용은 원문 확인이 필요합니다.');
  const relevant = CHINA.test(candidate.title) || LANGUAGE.test(candidate.title)
    || CHINA.test(fields.workplace) || fields.languages.length > 0;
  return { ...candidate, ...fields,
    country: candidate.country || (CHINA.test(candidate.title) || CHINA.test(fields.workplace) ? '중국' : ''),
    city: candidate.city || cityFromTitle(candidate.title) || cityFromTitle(fields.workplace),
    summary: lines.slice(0, 6).join(' ').slice(0, 1800),
    relevant, attachments, warnings,
    needsAttachment: (/첨부|붙임/.test(text) || attachments.length > 0)
      && (!fields.requirements.length || !fields.responsibilities.length) };
}

export async function enrichPublicDetail(job, options = {}) {
  if (!job.needsAttachment) return job;
  const pdf = options.skipPdf ? { reason: '이번 실행의 PDF 조회 시간이 부족하여 직접 확인이 필요합니다.' }
    : await readJobPdf(job, options);
  if (!pdf.text) return { ...job, attachmentReason: pdf.reason };
  const lines = pdf.text.split('\n').map((line) => line.trim()).filter(Boolean);
  const fields = detailFields(lines, job);
  const merged = { ...job };
  for (const key of ['responsibilities', 'requirements', 'preferred', 'languages', 'employmentNotes'])
    if (fields[key].length) merged[key] = fields[key];
  for (const key of ['deadline', 'educationLevel', 'experienceLevel', 'employmentType', 'workplace'])
    if (fields[key]) merged[key] = fields[key];
  if (fields.application.method !== '원문 지원') merged.application = fields.application;
  merged.relevant = job.relevant || CHINA.test(fields.workplace) || fields.languages.length > 0;
  merged.country ||= CHINA.test(fields.workplace) ? '중국' : '';
  merged.city ||= cityFromTitle(fields.workplace);
  merged.pdfSource = pdf.file;
  merged.summary = lines.slice(0, 6).join(' ').slice(0, 1800);
  merged.needsAttachment = !merged.requirements.length || !merged.responsibilities.length;
  merged.attachmentReason = merged.needsAttachment ? 'PDF는 읽었지만 업무·자격을 충분히 분류하지 못했습니다.' : '';
  merged.warnings = ['PDF에서 추출한 정보입니다. 표·글꼴에 따른 누락이 있을 수 있으므로 원문과 대조해 주세요.'];
  return merged;
}

export function explainFetchError(error) {
  const code = error?.cause?.code || error?.code;
  if (error?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT')
    return '출처 연결 시간이 초과되었습니다. (timeout)';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '출처 도메인을 찾지 못했습니다. (DNS)';
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED') return '출처 서버가 연결을 종료하거나 거부했습니다. (' + code + ')';
  if (/CERT|TLS|SSL/.test(code || '')) return '출처 보안 연결 검증에 실패했습니다. (' + code + ')';
  if (error?.message === 'fetch failed') return '출처 네트워크 요청 실패' + (code ? ' (' + code + ')' : ' (세부 네트워크 코드 없음)');
  return error?.message || '출처 요청 실패';
}
async function limitedHtml(response) {
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && !['text/html','application/xhtml+xml','text/plain'].includes(contentType)) {
    await response.body?.cancel();
    throw new Error('HTML 문서가 아닌 응답을 받아 중단했습니다. (content_type)');
  }
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_HTML_BYTES) {
    await response.body?.cancel();
    throw new Error('HTML 응답이 2MB 크기 제한을 초과했습니다. (body_limit)');
  }
  if (!response.body?.getReader) {
    const html = await response.text();
    if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES)
      throw new Error('HTML 응답이 2MB 크기 제한을 초과했습니다. (body_limit)');
    return html;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let html = '';
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new Error('HTML 응답이 2MB 크기 제한을 초과했습니다. (body_limit)');
      }
      html += decoder.decode(value,{stream:true});
    }
    return html + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
async function fetchHtmlOnce(url, fetcher, request = {}) {
  const origin = new URL(url).origin;
  const signal = AbortSignal.timeout(10000);
  const visited = new Set();
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    if (visited.has(current)) throw new Error('출처 주소 이동이 반복됩니다. (redirect_loop)');
    visited.add(current);
    const response = await fetcher(current, { redirect: 'manual', signal,
      ...(request.method ? { method: request.method } : {}),
      ...(request.body !== undefined ? { body: request.body } : {}),
      headers: { Accept: 'text/html', 'User-Agent': 'OpenJobRadar/0.1 (+https://github.com/gamerinl10n/openjob_radar)', ...request.headers } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (request.method === 'POST') {
        await response.body?.cancel();
        throw new Error('게시판 요청이 이동되어 중단했습니다. (redirect_blocked)');
      }
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('이동할 주소가 없는 응답입니다. (redirect_missing)');
      const next = new URL(location, current);
      if (next.origin !== origin || next.protocol !== 'https:' || next.username || next.password)
        throw new Error('허용되지 않은 외부 주소로 이동하여 중단했습니다. (redirect_blocked)');
      current = next.href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw httpResponseError('출처 응답 오류', response);
    }
    const html = await limitedHtml(response);
    if (!html.includes('<')) throw new Error('HTML 응답이 아닙니다.');
    return html;
  }
  throw new Error('출처 주소 이동이 너무 많습니다. (redirect_limit)');
}
export async function fetchHtml(url, fetcher = fetch, options = {}) {
  try {
    return await withTransientRetry(() => fetchHtmlOnce(url, fetcher, options.request), options);
  } catch (error) {
    throw new Error(explainFetchError(error));
  }
}
export function nextListingPages(html, source) {
  const base = new URL(source.url);
  const pages = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), base);
      const page = Number(url.searchParams.get('page'));
      if (url.origin === base.origin && url.pathname === base.pathname && Number.isInteger(page) && page >= 2 && page <= 3)
        pages.set(page, url.href);
    } catch { /* Ignore JavaScript and invalid navigation. */ }
  }
  return [...pages].sort((a,b) => a[0] - b[0]).map(([,url]) => url);
}
export async function collectPublicJobCandidates(sourceIds = SOURCES.map((s) => s.id), { fetcher = fetch, worldjobProgress = {}, knownKotraUrls = [] } = {}) {
  const runRequest = createRequestLimiter(MAX_CONCURRENT_REQUESTS);
  const results = await Promise.all(SOURCES.filter((s) => sourceIds.includes(s.id)).map(async (source) => {
    let requestRetries = 0;
    const onRetry = () => { requestRetries++; };
    const limitedFetchHtml = (url, request) => runRequest(() => fetchHtml(url, fetcher, { onRetry, request }));
    if (source.id === 'worldjob') {
      const result = await collectWorldjob(source, { ...worldjobProgress, fetchHtml: limitedFetchHtml });
      result.stats.requestRetries = requestRetries;
      return result;
    }
    if (source.id === 'kotra') {
      const result = await collectKotra(source, { fetchHtml: limitedFetchHtml, knownUrls: knownKotraUrls });
      result.stats.requestRetries = requestRetries;
      return result;
    }
    const result = { id: source.id, name: source.name, found: 0, candidates: [], warnings: [], exclusions: [], pending: [],
      stats: { pages: 0, read: 0, unrelated: 0, expired: 0, invalid: 0, detailFailed: 0, attachmentPending: 0, pdfRead: 0 }, scope: '첫 페이지 및 링크로 확인된 2~3페이지' };
    const stopAt = Date.now() + 40000;
    const pending = (job, reason) => {
      result.stats.attachmentPending++;
      result.pending.push({ title: job.title, url: job.sourceUrl, reason,
        attachments: (job.attachments || []).map(({ name, url }) => ({ name, url })) });
    };
    try {
      const first = await limitedFetchHtml(source.url);
      const queue = [source.url, ...nextListingPages(first, source)];
      const unique = new Map();
      for (let i = 0; i < queue.length; i++) {
        try {
          const html = i === 0 ? first : await limitedFetchHtml(queue[i]);
          if (!/<table\b/i.test(html)) throw new Error('채용 목록 구조를 확인하지 못했습니다.');
          const listing = inspectPublicListing(html, source, undefined, { deferRelevance: true });
          if (!listing.stats.read && !/등록된\s*(게시물|글|공고).*없|검색\s*결과.*없/.test(clean(html)))
            throw new Error('채용 제목을 읽지 못했습니다. 공고 없음으로 판정하지 않았습니다. (list_parse_failed)');
          result.stats.pages++;
          result.exclusions.push(...listing.exclusions.slice(0, 60 - result.exclusions.length));
          for (const key of ['read','unrelated','expired','invalid']) result.stats[key] += listing.stats[key];
          listing.candidates.forEach((item) => unique.set(item.sourceUrl, item));
        } catch (error) {
          if (i === 0) throw error;
          result.warnings.push((i + 1) + '페이지: ' + error.message);
        }
      }
      const listing = [...unique.values()];
      // At most 30 rows across three pages; batches contain ten rows while all outbound requests share one cap.
      for (let offset = 0; offset < Math.min(listing.length, 30); offset += 10) {
        if (Date.now() + 10000 > stopAt) {
          for (const item of listing.slice(offset, 30)) pending(item, '이번 실행의 조회 시간이 부족합니다. 다시 수집하거나 원문을 확인해 주세요.');
          break;
        }
        const batch = listing.slice(offset, offset + 10);
        const details = await Promise.allSettled(batch.map(async (item) => {
          const job = parsePublicDetail(await limitedFetchHtml(item.sourceUrl), item);
          return enrichPublicDetail(job, { fetcher, runRequest, onRetry, skipPdf: Date.now() + 14000 > stopAt });
        }));
        details.forEach((r, index) => {
          const item = batch[index];
          if (r.status === 'rejected') {
            result.stats.detailFailed++; result.warnings.push(item.title + ': ' + r.reason.message);
            pending(item, '본문 재확인 필요: ' + r.reason.message);
            return;
          }
          const { relevant, needsAttachment, attachmentReason, ...job } = r.value;
          if (job.pdfSource) result.stats.pdfRead++;
          const expired = job.deadline && job.deadline < koreaDate();
          const location = workLocationDecision(job);
          if (!expired && location.state === 'pending') {
            pending(job, location.reason);
          } else if (!expired && location.state === 'ready' && needsAttachment) {
            pending(job, attachmentReason || '첨부파일 확인이 필요합니다.');
          } else if (location.state === 'excluded' || expired) {
            result.stats[expired ? 'expired' : 'unrelated']++;
            if (result.exclusions.length < 60) result.exclusions.push({ title: item.title, url: item.sourceUrl,
              reason: expired ? '본문에 명시된 마감일이 지남: ' + job.deadline
                : location.reason });
          } else result.candidates.push({ ...job, country: location.country });
        });
      }
      result.found = result.candidates.length;
      if (listing.length > 30) result.warnings.push('상세 조회는 이번 실행에서 30건으로 제한되었습니다.');
      if (result.stats.invalid) result.warnings.push('상세주소를 해석하지 못한 공고가 있습니다.');
      result.emptyReason = result.candidates.length || result.stats.detailFailed ? '' : result.stats.invalid ? '주소 분석 실패로 수집 대상 여부를 확정하지 못했습니다.'
        : '조회한 범위에서 조건에 맞는 진행 중 공고가 없습니다.';
    } catch (error) { result.error = error.message; }
    result.stats.requestRetries = requestRetries;
    return result;
  }));
  return { results };
}
