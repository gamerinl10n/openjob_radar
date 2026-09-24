import { separateJobDuties } from './jobText.js';
// Read only the article body supplied by the source parser, never page navigation.
const headingPrefix = /^(?:(?:\d+|[가-힣])[.)]\s*|[ㅇ○◦□■●※\-]\s*)+/;
const stripPrefix = (line) => line.replace(headingPrefix, '').trim();
const headings = [
  ['responsibilities', /^(?:담당\s*업무|주요\s*업무|업무\s*내용)\s*[:：]?\s*/],
  ['requirements', /^(?:지원\s*자격|응시\s*자격|자격\s*요건|직무\s*필수\s*요건)\s*[:：]?\s*/],
  ['preferred', /^(?:우대\s*사항|우대\s*조건|직무\s*우대\s*요건)\s*[:：]?\s*/],
  ['application', /^(?:지원\s*방법|접수\s*방법|서류\s*제출\s*방법|채용\s*응시\s*방법)\s*[:：]?\s*/],
];
const stop = /^(?:근무\s*조건|채용\s*인원|채용\s*분야|제출\s*서류|서류\s*제출\s*시한|접수\s*기간|접수\s*마감(?:일)?|마감일|지원\s*기간|전형|보수|급여|유의\s*사항|기타\s*사항)/;
export function detailFields(lines, candidate) {
  const sections = { responsibilities: [], requirements: [], preferred: [], application: [] };
  let section = '';
  let closed = false;
  for (const raw of lines) {
    const line = stripPrefix(raw);
    if (/^\d+[.)]\s/.test(raw)) closed = /^(?:채용\s*일정|전형|유의\s*사항)/.test(line);
    if (closed) continue;
    if (/담\s*당\s*업\s*무/.test(line) && /채용인원|직종/.test(line)) {
      section = 'responsibilities'; continue;
    }
    const heading = headings.find(([, pattern]) => pattern.test(line));
    if (heading) {
      section = heading[0];
      const remainder = line.replace(heading[1], '');
      if (remainder) sections[section].push(stripPrefix(remainder).slice(0, 1000));
    } else if (stop.test(line) || /^\d+[.)]\s/.test(raw)) section = '';
    else if (section) {
      if (section === 'responsibilities' && !/^[ㅇ○◦●\-]/.test(raw) && /^(?:일반직|예정|\(?20\d{2}년|※)/.test(raw)) continue;
      // An inline preference is not a mandatory qualification.
      const target = section === 'requirements' && /우대/.test(line) ? 'preferred' : section;
      sections[target].push(line.slice(0, 1000));
    }
  }
  const text = lines.map(stripPrefix).join('\n');
  const field = (label) => text.match(new RegExp('(?:^|\\n)(?:' + label + ')\\s*[:：]\\s*([^\\n]{1,160})'))?.[1] || '';
  const deadlineLine = field('서류\\s*제출\\s*시한|접수\\s*기간|지원\\s*기간|접수\\s*마감(?:일)?|마감일')
    || lines.find((line) => /접수.*마감일|제출.*시한/.test(line) && /20\d{2}/.test(line)) || '';
  const dates = [...deadlineLine.matchAll(/(20\d{2})(?:[.\-/]|년)\s*(\d{1,2})(?:[.\-/]|월)\s*(\d{1,2})/g)]
    .map((m) => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'));
  const { application, ...requirements } = sections;
  const periodLines = lines.filter((line) => /까지.*근무|근무\s*예정/.test(line)).map(stripPrefix);
  const separated = separateJobDuties([...requirements.responsibilities, ...periodLines]);
  requirements.responsibilities = separated.duties;
  const languageText = [candidate.title, ...sections.requirements, ...sections.preferred,
    ...lines.filter((line) => /(?:한국어|중국어|韩语|朝鲜语).*(?:능통|가능|구사|능력|우대|필수)/.test(line))].join('\n');
  const languages = [['한국어', /한국어|韩语|朝鲜语/], ['중국어', /중국어/]]
    .filter(([, pattern]) => pattern.test(languageText)).map(([name]) => name);
  return {
    ...requirements, languages, employmentNotes: separated.employmentNotes,
    workplace: field('근무\\s*지역|근무지|근무\\s*장소'),
    educationLevel: field('학력|교육') || text.match(/(?:학사|석사|박사|전문학사)(?:급)?\s*이상\s*학위\s*소지자/)?.[0] || '',
    experienceLevel: field('경력'),
    employmentType: field('고용\\s*형태|계약\\s*형태'),
    deadline: [candidate.deadline, dates.at(-1)].filter(Boolean).sort()[0] || '',
    application: { method: application.join('\n') || '원문 지원', url: candidate.sourceUrl },
  };
}

export function detailAttachments(html, body, sourceUrl, clean) {
  // File metadata lives outside viewCon on the culture board. Restrict it to viewFile.
  const fileBlock = html.match(/<div\b[^>]*class=["']viewFile["'][^>]*>([\s\S]*?)<\/form>/i)?.[1] || '';
  const blocks = [...fileBlock.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  blocks.push(body);
  const files = new Map();
  for (const block of blocks) {
    const anchors = [...block.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)];
    const fileName = anchors.map((a) => clean(a[3])).find((name) => /\.(?:pdf|hwp|hwpx|docx|zip)\b/i.test(name));
    const downloadCall = anchors.map((a) => a[2]).map((href) =>
      /^javascript:filedown\('([\w.-]+\.pdf)',\s*'([^']+)',\s*'(\d+)'\);?$/i.exec(href)).find(Boolean);
    const download = downloadCall && new URL(sourceUrl).origin === 'https://www.korean-culture.org' ? {
      url: 'https://www.korean-culture.org/file/download.do',
      fields: { serverFileName: downloadCall[1], fileName: encodeURIComponent(downloadCall[2]),
        fileIdx: downloadCall[3], menuCode: 'menu0213', langCode: 'lang001' },
    } : undefined;
    for (const a of anchors) {
      const name = clean(a[3]);
      if (!/\.(?:pdf|hwp|hwpx|docx|zip)\b/i.test(name) && !/\/docViewer\/|download|fileDown/i.test(a[2])) continue;
      try {
        const url = new URL(a[2].replace(/&amp;/g, '&'), sourceUrl);
        if (url.protocol !== 'https:' || url.origin !== new URL(sourceUrl).origin || url.username || url.password) continue;
        files.set(url.href, { ...files.get(url.href), name: fileName || name || '첨부파일 바로보기',
          url: url.href, ...(download ? { download } : {}) });
      } catch {}
    }
  }
  return [...files.values()].slice(0, 10);
}
