import { createHash } from 'node:crypto';
import { detailFields } from './publicJobDetail.js';
import { workLocationDecision } from './workLocationPolicy.js';

const ORIGIN = 'https://www.kotra.or.kr';
const MENU_ID = '20000005817';
export const KOTRA_LIST_URL = ORIGIN + '/module/ntt/unity/selectNttListAjax.do';
export const KOTRA_DETAIL_URL = ORIGIN + '/module/ntt/unity/selectNttDetailAjax.do';
const RECRUITMENT_NOTICE = /(?:채용|모집)[^\n]{0,50}(?:공고|모집)|(?:공고)[^\n]{0,50}(?:채용|모집)/;
const PROCESS_NOTICE = /서류\s*반환|성적\s*공개|필기\s*시험|인성\s*검사|면접\s*(?:안내|대상)|합격|결과\s*발표|전형\s*안내|채용\s*(?:취소|이의|일정|사전)/;

const text = (html = '') => String(html)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
  .replace(/&#39;|&apos;|&lsquo;|&rsquo;/gi, "'")
  .replace(/\s+/g, ' ').trim();

const attribute = (tag, name) => tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i'))?.[2] || '';
const isoDate = (value) => {
  const match = String(value).match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  return match ? match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0') : '';
};
const todayKorea = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const identity = (url) => 'public-' + createHash('sha256').update(url).digest('hex').slice(0, 24);

export function canonicalKotraUrl(value) {
  try {
    const url = new URL(String(value).replace(/&amp;/g, '&'), ORIGIN);
    if (url.protocol !== 'https:' || !['www.kotra.or.kr', 'kotra.or.kr'].includes(url.hostname)) return '';
    if (!new RegExp('^/(?:kp/)?subList/' + MENU_ID + '/?$').test(url.pathname)) return '';
    const sequence = url.searchParams.get('nttSeq');
    if (!/^\d+$/.test(sequence || '') || url.searchParams.get('pmode') !== 'detail') return '';
    return ORIGIN + '/kp/subList/' + MENU_ID + '?nttSeq=' + sequence + '&pmode=detail';
  } catch { return ''; }
}

const urlFor = (sequence) => ORIGIN + '/kp/subList/' + MENU_ID + '?nttSeq=' + sequence + '&pmode=detail';

export function parseKotraBoardForm(html) {
  const form = html.match(/<form\b[^>]*id=["']bbsFrm["'][^>]*>([\s\S]*?)<\/form>/i)?.[1];
  if (!form) throw new Error('KOTRA 채용 게시판 설정을 찾지 못했습니다. (board_parse_failed)');
  const fields = {};
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gi)) {
    const name = attribute(tag, 'name');
    if (name) fields[name] = attribute(tag, 'value');
  }
  if (!/^\d+$/.test(fields.siteSeq || '') || !/^\d+$/.test(fields.bbsSeq || '')
    || fields.menuSeq !== MENU_ID || !/^\d+$/.test(fields.sitecntntsSeq || ''))
    throw new Error('KOTRA 채용 게시판 식별자가 변경되었습니다. (board_parse_failed)');
  return fields;
}

export function kotraBoardRequest(fields, { sequence = '', page = 1 } = {}) {
  if (sequence && !/^\d+$/.test(sequence)) throw new Error('KOTRA 공고 번호가 올바르지 않습니다.');
  const body = new URLSearchParams({
    siteSeq: fields.siteSeq, bbsSeq: fields.bbsSeq, pageIndex: String(page),
    searchCondition: '', searchKeyword: '', menuSeq: MENU_ID, nttSeq: sequence,
    sitecntntsSeq: fields.sitecntntsSeq, tabTyCode: 'dataManage', mngrAt: 'N',
    listCount: '30',
  });
  return { method: 'POST', body: body.toString(), headers: {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: ORIGIN + '/subList/' + MENU_ID,
  } };
}

export function parseKotraListing(html, today = todayKorea()) {
  if (!/<form\b[^>]*id=["']listFrm["']/i.test(html))
    throw new Error('KOTRA 목록 응답 형식을 확인하지 못했습니다. (list_parse_failed)');
  const table = html.match(/<table\b[^>]*class=["'][^"']*basic-table01[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error('KOTRA 채용 목록 표를 찾지 못했습니다. (list_parse_failed)');
  const stats = { read: 0, unrelated: 0, expired: 0, invalid: 0 };
  const exclusions = [];
  const items = new Map();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const anchor = row[1].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const sequence = anchor[1].match(/fnView\(\s*['"](\d+)['"]/i)?.[1];
    if (!sequence) { stats.invalid++; continue; }
    stats.read++;
    const title = text(anchor[2]).slice(0, 300);
    const sourceUrl = urlFor(sequence);
    const postedAt = isoDate(text(row[1]));
    if (!title) { stats.invalid++; continue; }
    if (!RECRUITMENT_NOTICE.test(title) || PROCESS_NOTICE.test(title)) {
      stats.unrelated++;
      if (exclusions.length < 60) exclusions.push({ title, url: sourceUrl, reason: '모집 공고가 아닌 전형·결과·사전 안내' });
      continue;
    }
    if (postedAt > today) {
      stats.invalid++;
      if (exclusions.length < 60) exclusions.push({ title, url: sourceUrl, reason: '게시일이 현재 날짜보다 늦습니다: ' + postedAt });
      continue;
    }
    items.set(sourceUrl, { title, sourceUrl, externalId: sequence, postedAt });
  }
  if (!stats.read && !/등록된\s*(게시물|글|공고).*없|검색\s*결과.*없|데이터가\s*없|게시물이\s*없/.test(text(table)))
    throw new Error('KOTRA 공고 행을 읽지 못했습니다. 공고 없음으로 판정하지 않았습니다. (list_parse_failed)');
  return { items: [...items.values()], stats, exclusions };
}

// KOTRA inserts the detail body through AJAX. Match its container, not navigation or adjacent posts.
function detailBody(html) {
  const start = /<div\b[^>]*class=["'][^"']*conM_txt[^"']*["'][^>]*>/i.exec(html);
  if (!start) return '';
  const rest = html.slice(start.index + start[0].length);
  let depth = 1;
  for (const tag of rest.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) return rest.slice(0, tag.index);
  }
  return '';
}

export function assessKotraDetail(html, item, today = todayKorea()) {
  const detailForm = html.match(/<form\b[^>]*id=["']detailFrm["'][^>]*>([\s\S]*?)<\/form>/i)?.[1] || '';
  const sequenceInput = [...detailForm.matchAll(/<input\b[^>]*>/gi)]
    .map(([tag]) => tag).find((tag) => attribute(tag, 'name') === 'nttSeq');
  if (!sequenceInput || attribute(sequenceInput, 'value') !== item.externalId)
    throw new Error('KOTRA 상세 응답의 공고 번호를 확인하지 못했습니다. (detail_parse_failed)');
  const title = text(html.match(/<div\b[^>]*class=["'][^"']*list_tit[^"']*["'][^>]*>[\s\S]*?<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || '');
  const body = detailBody(html);
  if (!title || !body) throw new Error('KOTRA 공고 제목 또는 본문을 확인하지 못했습니다. (detail_parse_failed)');
  const lines = body.replace(/<\/(?:p|div|li|tr|h[1-6])>|<br\s*\/?>/gi, '\n')
    .split('\n').map(text).filter(Boolean);
  const seed = {
    radarId: identity(item.sourceUrl), title, company: 'KOTRA', country: '', city: '',
    category: 'other', sourceName: 'KOTRA 본사 채용', sourceUrl: item.sourceUrl,
    externalId: item.externalId, postedAt: item.postedAt, deadline: '',
    educationLevel: '', experienceLevel: '', employmentType: '', languages: [],
    responsibilities: [], requirements: [], preferred: [], attachments: [], warnings: [],
  };
  const fields = detailFields(lines, seed);
  const candidate = { ...seed, ...fields, summary: lines.slice(0, 6).join(' ').slice(0, 1800) };
  const location = workLocationDecision(candidate);
  if (location.country) candidate.country = location.country;
  if (candidate.deadline && candidate.deadline < today)
    return { outcome: 'excluded', candidate, reason: '본문에 명시된 마감일이 지남: ' + candidate.deadline };
  if (/<img\b/i.test(body))
    return { outcome: 'pending', candidate, reason: '공고 본문에 이미지가 있어 마감일·근무조건을 자동 확정하지 않았습니다. 원문을 확인해 주세요.' };
  if (/첨부|붙임/.test(lines.join(' ')))
    return { outcome: 'pending', candidate, reason: '첨부파일에 채용 조건이 있을 수 있어 원문 확인이 필요합니다.' };
  if (!candidate.deadline)
    return { outcome: 'pending', candidate, reason: '본문에서 명시된 접수 마감일을 확인하지 못했습니다.' };
  if (location.state !== 'ready')
    return { outcome: location.state, candidate, reason: location.reason };
  if (!candidate.responsibilities.length || !candidate.requirements.length)
    return { outcome: 'pending', candidate, reason: '본문에서 담당 업무와 지원 자격을 모두 확인하지 못했습니다.' };
  return { outcome: 'ready', candidate, reason: '' };
}

export async function fetchKotraDetail(sourceUrl, fetchHtml) {
  const canonical = canonicalKotraUrl(sourceUrl);
  if (!canonical) throw new Error('KOTRA 공식 채용 공고 주소가 아닙니다.');
  const fields = parseKotraBoardForm(await fetchHtml(ORIGIN + '/subList/' + MENU_ID));
  const sequence = new URL(canonical).searchParams.get('nttSeq');
  return fetchHtml(KOTRA_DETAIL_URL, kotraBoardRequest(fields, { sequence }));
}

export async function collectKotra(source, { fetchHtml, knownUrls = [] }) {
  const result = {
    id: source.id, name: source.name, found: 0, candidates: [], warnings: [], exclusions: [], pending: [],
    stats: { pages: 0, read: 0, unrelated: 0, expired: 0, invalid: 0, skipped: 0,
      detailFailed: 0, attachmentPending: 0, pdfRead: 0 },
    scope: 'KOTRA 공식 채용 게시판 최신 30건의 원문 확인',
  };
  try {
    const fields = parseKotraBoardForm(await fetchHtml(source.url));
    const listing = parseKotraListing(await fetchHtml(KOTRA_LIST_URL, kotraBoardRequest(fields)));
    result.stats.pages = 1;
    for (const key of ['read', 'unrelated', 'expired', 'invalid']) result.stats[key] += listing.stats[key];
    result.exclusions.push(...listing.exclusions);
    const known = new Set([...knownUrls].map(canonicalKotraUrl).filter(Boolean));
    const fresh = listing.items.filter((item) => {
      if (!known.has(item.sourceUrl)) return true;
      result.stats.skipped++;
      return false;
    });
    const stopAt = Date.now() + 40000;
    for (let offset = 0; offset < fresh.length; offset += 8) {
      if (Date.now() + 10000 > stopAt) {
        for (const item of fresh.slice(offset)) result.pending.push({
          title: item.title, url: item.sourceUrl, postedAt: item.postedAt,
          reason: '이번 실행의 조회 시간이 부족하여 상세 공고를 확인하지 못했습니다.', attachments: [],
        });
        break;
      }
      const batch = fresh.slice(offset, offset + 8);
      const details = await Promise.allSettled(batch.map(async (item) => {
        const html = await fetchHtml(KOTRA_DETAIL_URL, kotraBoardRequest(fields, { sequence: item.externalId }));
        return assessKotraDetail(html, item);
      }));
      details.forEach((detail, index) => {
        const item = batch[index];
        if (detail.status === 'rejected') {
          result.stats.detailFailed++;
          result.pending.push({ title: item.title, url: item.sourceUrl, postedAt: item.postedAt,
            reason: '본문 조회·분석 실패: ' + detail.reason.message, attachments: [] });
          return;
        }
        const { outcome, candidate, reason } = detail.value;
        if (outcome === 'ready') result.candidates.push(candidate);
        else if (outcome === 'pending') result.pending.push({
          title: candidate.title, url: item.sourceUrl, postedAt: item.postedAt, reason, attachments: [],
        });
        else {
          result.stats[candidate.deadline && candidate.deadline < todayKorea() ? 'expired' : 'unrelated']++;
          if (result.exclusions.length < 60)
            result.exclusions.push({ title: candidate.title, url: item.sourceUrl, reason });
        }
      });
    }
    result.stats.attachmentPending = result.pending.length;
    result.found = result.candidates.length;
    result.emptyReason = result.found || result.pending.length ? ''
      : result.stats.skipped ? '이번 목록의 모집 공고는 이미 처리 이력이 있습니다.'
      : '조회한 범위에서 진행 중인 모집 공고를 찾지 못했습니다.';
  } catch (error) { result.error = error.message; }
  return result;
}
