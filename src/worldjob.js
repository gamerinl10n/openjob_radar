import { workLocationDecision } from './workLocationPolicy.js';
// Public WorldJob pages only; never evaluate the site's JavaScript links.
const ORIGIN = 'https://www.worldjob.or.kr';
const text = (html = '') => html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|button)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
 .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
const lines = html => html.replace(/<br\s*\/?>|<\/(?:p|li|div)>/gi,'\n').split(/[\r\n]+/).map(text).filter(Boolean);
export function canonicalWorldjobUrl(value) {
 try {
  const u = new URL(value);
  if(u.origin!==ORIGIN || u.username || u.password || u.pathname!=='/advnc/epmtLink.do') return '';
  const no=u.searchParams.get('joCrtfcNo'),dsp=u.searchParams.get('joCrtfcDsp'),sn=u.searchParams.get('joCrtfcDspSn');
  return /^E\d{11}$/.test(no||'') && /^\d{1,3}$/.test(dsp||'') && /^\d{1,3}$/.test(sn||'')
   ? `${ORIGIN}/advnc/epmtLink.do?joCrtfcNo=${no}&joCrtfcDsp=${dsp}&joCrtfcDspSn=${sn}` : '';
 }catch{return '';}
}
export function parseWorldjobListing(html) {
 if(!/class=["'][^"']*posting-list-wrap/.test(html)) throw new Error('월드잡 채용 목록 구조를 확인하지 못했습니다.');
 const jobs=new Map();
 for(const block of html.split(/<div\b[^>]*class=["']post-box["'][^>]*>/i).slice(1)) {
  const heading=block.match(/<h5\b[^>]*>([\s\S]*?)<\/h5>/i)?.[1] || '';
  const args=heading.match(/goView1\('([^']+)','(\d+)','(\d+)','1'\)/);
  if(!args) continue;
  const sourceUrl=canonicalWorldjobUrl(`${ORIGIN}/advnc/epmtLink.do?joCrtfcNo=${args[1]}&joCrtfcDsp=${args[2]}&joCrtfcDspSn=${args[3]}`);
  if(sourceUrl)jobs.set(sourceUrl,{title:text(heading),sourceUrl});
 }
 if(!jobs.size && !/(?:총\s*(?:<[^>]*>\s*)*0\s*(?:<[^>]*>\s*)*개|공고가\s*없|검색된.*없)/.test(html))
  throw new Error('월드잡 공고 주소를 읽지 못했습니다. 공고 없음으로 처리하지 않았습니다.');
 return [...jobs.values()].slice(0,30);
}
export function parseWorldjobDetail(html, sourceUrl) {
 if(!canonicalWorldjobUrl(sourceUrl)) throw new Error('지원하지 않는 월드잡 공고 주소입니다.');
 let posting;
 for(const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  try {const data=JSON.parse(script[1]);posting=(Array.isArray(data)?data:[data,...(data['@graph']||[])]).find(x=>x['@type']==='JobPosting');if(posting)break;}catch{}
 }
 if(!posting?.title)throw new Error('월드잡 상세 공고 구조를 확인하지 못했습니다.');
 const cells=new Map();
 for(const table of html.matchAll(/<table\b[^>]*class=["'][^"']*table-default[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi)) {
  for(const m of table[1].replace(/<!--[\s\S]*?-->/g,'').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi))cells.set(text(m[1]),m[2]);
 }
 if(!cells.has('주요업무내용') || !cells.has('자격요건')) throw new Error('업무·자격 표를 읽지 못했습니다.');
 const get=key=>text(cells.get(key)||'');
 const qualification=cells.get('자격요건');
 const qual=label=>[...qualification.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m=>text(m[1]))
  .find(v=>v.startsWith(label))?.slice(label.length).trim() || '';
 const languageText=qual('외국어능력');
 const extra=lines(cells.get('그 외 자격요건')||'').filter(v=>!/^ㅇ?\s*자격\s*요건$/.test(v));
 const languages=['한국어','중국어'].filter(v=>languageText.includes(v) || extra.some(s=>s.includes(v)&&/능통|가능|필수|우대|언어|구사/.test(s)));
 const country=text((cells.get('국가')||'').split(/<ul\b/i)[0]) || posting.jobLocation?.address?.addressRegion || '';
 let duties=lines(cells.get('주요업무내용'));
 const heading=duties.findIndex(v=>/^[ㅇ○\s\[【]*(?:주요\s*업무(?:\s*내용)?|담당\s*업무|업무\s*내용)[\]】\s:：]*$/.test(v));
 if(heading>=0)duties=duties.slice(heading+1);
 const stop=duties.findIndex(v=>/^[ㅇ○\s\[【]*(?:회사\s*소개|기업\s*(?:소개|PR|HP)|지원\s*자격|자격\s*요건)/.test(v));
 if(stop>=0)duties=duties.slice(0,stop);
 duties=duties.map(v=>v.replace(/^[ㅇ○•\-]\s*/,''));
 const requirements=[qual('학력')&&'학력: '+qual('학력'),qual('경력')&&'경력: '+qual('경력'),languageText,...extra].filter(Boolean);
 const period=[...cells].find(([key])=>key.startsWith('모집기간'))?.[1] || '';
 const dates=text(period).match(/\d{4}-\d{2}-\d{2}/g)||[];
 const deadline=dates.at(-1) || (typeof posting.validThrough==='string'?posting.validThrough.slice(0,10):'');
 const contract=get('계약기간');
 const title=text(posting.title);
 const city=title.match(/(?:중국|홍콩|마카오)\s*\(([^)]+)\)/)?.[1] || '';
 const salary=get('급여사항(년)') || get('급여사항');
 return {title,company:get('기업명') || text(posting.hiringOrganization?.name||''),country,city,workplace:get('근무지주소'),
  sourceName:'월드잡플러스',sourceUrl:canonicalWorldjobUrl(sourceUrl),externalId:new URL(sourceUrl).searchParams.get('joCrtfcNo'),
  educationLevel:qual('학력'),experienceLevel:qual('경력'),employmentType:contract.match(/\[([^\]]+)\]/)?.[1] || '',
  employmentNotes:/개월|년|일까지/.test(contract)?[contract]:[],
  languages,responsibilities:duties,requirements,preferred:[],
  summary:[get('직종'),salary&&'급여(년): '+salary,get('근무시간')&&'근무시간: '+get('근무시간')].filter(Boolean).join(' · '),
  postedAt:dates[0] || posting.datePosted || '',deadline,
  application:{url:canonicalWorldjobUrl(sourceUrl),method:'월드잡 원문에서 지원 방법과 제출서류 확인'},
  attachments:[],warnings:['월드잡 공개 상세표에서 수집했습니다. 지원 전 원문 조건을 확인해 주세요.'],
  relevant:workLocationDecision({country},{structuredCountry:true}).state==='ready',
  needsAttachment:!duties.length || !requirements.length || !/^\d{4}-\d{2}-\d{2}$/.test(deadline),
 };
}
async function collectWorldjobPage(source, {fetchHtml, page=1, known=new Set()}) {
 const result={id:source.id,name:source.name,found:0,candidates:[],warnings:[],exclusions:[],pending:[],
  stats:{pages:0,read:0,unrelated:0,expired:0,invalid:0,detailFailed:0,attachmentPending:0,pdfRead:0},scope:`${page}페이지 최대 30건 · 완료한 페이지 다음부터 이어서 조회`};
 const stopAt=Date.now()+35000;
 const pending=(job,reason)=>{result.pending.push({title:job.title,url:job.sourceUrl,reason,attachments:[]});result.stats.attachmentPending++;};
 try {
  const listUrl=new URL(source.url);listUrl.searchParams.set('pageIndex',String(page));
  const html=await fetchHtml(listUrl.href);
  const returnedPage=html.match(/name="pageIndex"[^>]*value="(\d+)"/)?.[1];
  if(returnedPage && Number(returnedPage)!==page)throw new Error('요청한 월드잡 페이지와 응답 페이지가 다릅니다. 진행 위치를 유지합니다.');
  const listed=parseWorldjobListing(html);
  const jobs=listed.filter(j=>!known.has(j.sourceUrl));
  result.stats.pages=1;result.stats.read=listed.length;result.stats.skipped=listed.length-jobs.length;
  const pages=[...html.matchAll(/goList\(\s*['"]1['"]\s*,\s*(\d+)\s*\)/g)].map(m=>Number(m[1]));
  const hasNext=pages.includes(page+1);
  if(listed.length===30 && !pages.length)throw new Error('월드잡 페이지 이동 구조를 확인하지 못했습니다. 진행 위치를 유지합니다.');
  result.progress={page,nextPage:hasNext?page+1:1,processedUrls:[],cycleComplete:!hasNext};
  for(let i=0;i<jobs.length;i+=10) {
   if(Date.now()+10000>stopAt){jobs.slice(i).forEach(j=>pending(j,'조회 시간이 부족합니다. 개별 재분석을 이용해 주세요.'));break;}
   const results=await Promise.allSettled(jobs.slice(i,i+10).map(async j=>parseWorldjobDetail(await fetchHtml(j.sourceUrl),j.sourceUrl)));
   results.forEach((r,n)=>{
    const seed=jobs[i+n];
    if(r.status==='rejected'){result.stats.detailFailed++;pending(seed,r.reason.message);return;}
    const {relevant,needsAttachment,...job}=r.value;
    const location=workLocationDecision(job,{structuredCountry:true});
    const expired=job.deadline && job.deadline<new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    if(expired || location.state==='excluded'){result.stats[expired?'expired':'unrelated']++;result.exclusions.push({title:job.title,url:job.sourceUrl,reason:expired?'모집기간이 끝난 공고입니다.':location.reason});}
    else if(location.state==='pending')pending(job,location.reason);
    else if(needsAttachment)pending(job,'업무·자격·마감일 중 확인이 필요한 정보가 있습니다.');
    else result.candidates.push(job);
   });
  }
  result.progress.processedUrls=[...result.candidates.map(j=>j.sourceUrl),...result.exclusions.map(j=>j.url)];
  result.found=result.candidates.length;
  if(!result.found)result.emptyReason=result.pending.length?'확인이 필요한 공고가 대기함에 있습니다.':'조회 범위에 조건에 맞는 진행 중 공고가 없습니다.';
 }catch(error){result.error=error.message;}
 return result;
}

// Check new notices every time, while backfilling one older page per run.
export async function collectWorldjob(source, options) {
 const page=options.page || 1;
 if(page===1)return collectWorldjobPage(source,options);
 const [fresh,older]=await Promise.all([collectWorldjobPage(source,{...options,page:1}),collectWorldjobPage(source,options)]);
 const unique=(items,key)=>[...new Map(items.map(item=>[item[key],item])).values()];
 const pageErrors=[
  fresh.error && `최신 목록 조회 실패: ${fresh.error}`,
  older.error && `이어보기 ${page}페이지 조회 실패: ${older.error}`,
 ].filter(Boolean);
 const result={...older,candidates:unique([...fresh.candidates,...older.candidates],'sourceUrl'),
  pending:unique([...fresh.pending,...older.pending],'url'),exclusions:unique([...fresh.exclusions,...older.exclusions],'url'),
  warnings:[...fresh.warnings,...older.warnings,...(pageErrors.length===1?pageErrors:[])],
  scope:`최신 1페이지와 이어보기 ${page}페이지 · 최대 60건`,
  error:pageErrors.length===2?pageErrors.join('\n'):undefined};
 result.stats=Object.fromEntries([...new Set([...Object.keys(fresh.stats),...Object.keys(older.stats)])].map(key=>[key,(fresh.stats[key]||0)+(older.stats[key]||0)]));
 result.found=result.candidates.length;
 if(result.progress)result.progress.processedUrls=[...new Set([...(fresh.progress?.processedUrls||[]),...result.progress.processedUrls])];
 return result;
}
