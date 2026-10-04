import { COLLECTION_SOURCES } from './sources.js';
import { detailFields } from './publicJobDetail.js';
import { workLocationDecision } from './workLocationPolicy.js';
import { normalizeCandidate } from './normalizeCandidate.js';

const ORIGIN = 'https://www.mofa.go.kr';
const aliases = new Set(['www.mofa.go.kr', 'overseas.mofa.go.kr', 'cn.mofa.go.kr', 'shanghai.mofa.go.kr']);
const sources = () => COLLECTION_SOURCES.filter(source => source.kind === 'mofa');
const text = (html = '') => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
const todayKorea = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const resultNotice = /합격|결과\s*발표|면접\s*(?:안내|대상)|채용\s*취소/;
const date = value => {
  const match = [...value.matchAll(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/g)].at(-1);
  if (!match || /\d{1,2}[.\/월]\s*\d{1,2}/.test(value.slice(match.index + match[0].length))) return '';
  const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const timestamp = Date.parse(result);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === result ? result : '';
};
function container(html, name) {
  const start = new RegExp('<div\\b[^>]*class=["\'][^"\']*\\b' + name + '\\b[^"\']*["\'][^>]*>', 'i').exec(html);
  if (!start) return null;
  const rest = html.slice(start.index + start[0].length); let depth = 1;
  for (const tag of rest.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) return rest.slice(0, tag.index);
  }
  return null;
}
export function canonicalMofaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !aliases.has(url.hostname) || url.port || url.username || url.password) return '';
    if (!sources().some(source => url.pathname === new URL(source.url).pathname.replace('list.do', 'view.do'))) return '';
    const seq = url.searchParams.get('seq');
    return /^\d+$/.test(seq || '') ? `${ORIGIN}${url.pathname}?seq=${seq}` : '';
  } catch { return ''; }
}
export function mofaSourceFor(value) {
  const url = canonicalMofaUrl(value);
  return url && sources().find(source => new URL(source.url).pathname.replace('list.do', 'view.do') === new URL(url).pathname);
}
const urlFor = (source, seq) => source.url.replace('list.do', 'view.do') + '?seq=' + seq;
export function parseMofaListing(html, source, today = todayKorea()) {
  const table = html.match(/<table\b[^>]*class=["'][^"']*\btableB\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error('공관 채용 목록 표를 확인하지 못했습니다. (list_parse_failed)');
  const items = new Map(); const exclusions = []; const stats = { read: 0, unrelated: 0, expired: 0, invalid: 0 };
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const anchor = [...row[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].find(a => /f_view\(/.test(a[1]));
    if (!anchor) continue;
    const seq = anchor[1].match(/\bf_view\(\s*['"](\d+)['"]\s*\)/)?.[1];
    if (!seq) { stats.invalid++; continue; }
    stats.read++;
    const title = text(anchor[2]); const sourceUrl = urlFor(source, seq);
    const deadline = /限|까지|마감/.test(title) ? date(title) : '';
    const reason = !/채용|모집/.test(title) || resultNotice.test(title) ? '모집 공고가 아닌 전형·결과 안내'
      : deadline && deadline < today ? '제목에 명시된 마감일이 지남: ' + deadline : '';
    if (reason) { stats[reason.startsWith('제목') ? 'expired' : 'unrelated']++; exclusions.push({ title, url: sourceUrl, reason }); continue; }
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
    const postedAt = cells.find(value => /^20\d{2}[-.]\d{2}[-.]\d{2}$/.test(value)) || '';
    items.set(sourceUrl, { title, sourceUrl, sourceName: source.name, externalId: `${source.id}-${seq}`, postedAt, deadline });
  }
  if (!stats.read && !/등록된.*없|검색.*결과.*없|게시물.*없/.test(text(table))) throw new Error('공관 공고 행을 읽지 못했습니다. 공고 없음으로 처리하지 않았습니다. (list_parse_failed)');
  return { items: [...items.values()], stats, exclusions };
}
export function mofaPages(html, source, maxPages) {
  const base = new URL(source.url); const pages = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), base); const page = Number(url.searchParams.get('page'));
      if (url.origin === base.origin && url.pathname === base.pathname && Number.isInteger(page) && page >= 2 && page <= maxPages) pages.set(page, url.href);
    } catch {}
  }
  return [...pages].sort((a,b) => a[0]-b[0]).map(([,url]) => url);
}
export function parseMofaDetail(html, item, today = todayKorea()) {
  const head = container(html, 'bo_head'); const body = container(html, 'bo_con');
  const title = text(head?.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  if (!title || body === null) throw new Error('공관 공고 제목 또는 본문 구조를 확인하지 못했습니다. (detail_parse_failed)');
  const files = [];
  for (const a of (container(html, 'bo_file') || '').matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = a[1].match(/^javascript:f_down\('([^']+)'\);?$/)?.[1];
    if (!href) continue;
    const url = new URL(href.replace(/&amp;/g, '&'), item.sourceUrl); const source = new URL(item.sourceUrl);
    if (url.origin !== source.origin || url.pathname !== source.pathname.replace('view.do', 'down.do') || url.searchParams.get('seq') !== source.searchParams.get('seq')) continue;
    if (!/^\d+$/.test(url.searchParams.get('brd_id') || '') || !/^\d+$/.test(url.searchParams.get('file_seq') || '') || url.searchParams.get('data_tp') !== 'A') continue;
    files.push({ name: text(a[2]) || '첨부파일', url: url.href });
  }
  const lines = body.replace(/<\/(?:p|li|div|tr)>|<br\s*\/?>/gi, '\n').split('\n').map(text).filter(Boolean);
  const seed = { ...item, title, deadline: /限|까지|마감/.test(title) ? date(title) : '' };
  const fields = detailFields(lines, seed);
  const company = title.match(/주[^\s()[\]]*(?:총영사관|대사관|한국문화원)/)?.[0] || '';
  const candidate = { ...seed, ...fields, company, summary: lines.slice(0,6).join(' ').slice(0,1800), attachments: files };
  const location = workLocationDecision(candidate); candidate.country = location.country || '';
  candidate.city = /상하이|상해/.test(company) ? '상하이' : /주중국대사관|베이징|북경/.test(company) ? '베이징' : '';
  if (resultNotice.test(title)) return { outcome: 'excluded', candidate, reason: '모집 공고가 아닌 전형·결과 안내' };
  if (candidate.deadline && candidate.deadline < today) return { outcome: 'excluded', candidate, reason: '명시된 마감일이 지남: ' + candidate.deadline };
  if (location.state === 'excluded') return { outcome: 'excluded', candidate, reason: location.reason };
  const reasons = [/<img\b/i.test(body) && '이미지 본문 확인', (files.length || /첨부|붙임/.test(lines.join(' '))) && '첨부파일 확인',
    !candidate.deadline && '마감일 확인', location.state === 'pending' && location.reason,
    !company && '채용 기관 확인', !candidate.responsibilities.length && '담당 업무 확인', !candidate.requirements.length && '지원 자격 확인'].filter(Boolean);
  return { outcome: reasons.length ? 'pending' : 'ready', candidate, reason: reasons.join(' · ') };
}
export async function collectMofa(source, { fetchHtml, maxPages = 3 }) {
  const result = { id: source.id, name: source.name, candidates: [], pending: [], exclusions: [], warnings: [], found: 0,
    stats: { pages: 0, read: 0, unrelated: 0, expired: 0, invalid: 0, detailFailed: 0, attachmentPending: 0 },
    scope: `공식 채용 게시판 링크로 확인된 최대 ${maxPages}페이지 · 상세 최대 50건` };
  const pending = (item, reason, draft) => result.pending.push({ title: item.title, url: item.sourceUrl, reason, attachments: item.attachments || [], ...(draft ? { draft: normalizeCandidate(item) } : {}) });
  try {
    const first = await fetchHtml(source.url); const queue = [source.url, ...mofaPages(first, source, maxPages)]; const items = new Map();
    for (let i=0;i<queue.length;i++) {
      try {
        const listing = parseMofaListing(i === 0 ? first : await fetchHtml(queue[i]), source);
        result.stats.pages++; for (const [key,value] of Object.entries(listing.stats)) result.stats[key] += value;
        result.exclusions.push(...listing.exclusions);
        listing.items.forEach(item => items.set(item.sourceUrl, item));
      } catch (error) { if (i === 0) throw error; result.warnings.push(`${i+1}페이지: ${error.message}`); }
    }
    const jobs = [...items.values()].slice(0,50); const stopAt = Date.now() + 120000;
    for (let i=0;i<jobs.length;i+=4) {
      if (Date.now()+10000 > stopAt) { jobs.slice(i).forEach(item => pending(item, '조회 시간이 부족합니다. 다음 수집에서 다시 확인합니다.')); result.warnings.push('일부 상세 조회 시간이 부족했습니다.'); break; }
      const batch = jobs.slice(i,i+4);
      const details = await Promise.allSettled(batch.map(async item => parseMofaDetail(await fetchHtml(item.sourceUrl), item)));
      details.forEach((detail,index) => {
        if (detail.status === 'rejected') { result.stats.detailFailed++; pending(batch[index], '본문 조회·분석 실패: ' + detail.reason.message); return; }
        const { outcome, candidate, reason } = detail.value;
        if (outcome === 'ready') result.candidates.push(candidate);
        else if (outcome === 'pending') pending(candidate, reason, true);
        else { result.stats[candidate.deadline && candidate.deadline < todayKorea() ? 'expired' : 'unrelated']++; result.exclusions.push({title:candidate.title,url:candidate.sourceUrl,reason}); }
      });
    }
    result.stats.attachmentPending = result.pending.length; result.found = result.candidates.length;
    if (!result.found && !result.pending.length) result.emptyReason = '조회 범위에 조건에 맞는 진행 중 공고가 없습니다.';
  } catch (error) { result.error = error.message; }
  return result;
}
