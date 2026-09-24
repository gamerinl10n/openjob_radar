// Language, company nationality and company-description text are not work locations.
const countries = [
 ['한국', /^(?:한국|대한민국|남한|South Korea|Republic of Korea|KR|KOR)$/i],
 ['중국', /^(?:중국|중화인민공화국|China|CN|CHN|홍콩|Hong Kong|HK|마카오|Macau|Macao|MO)$/i],
];
function place(value) {
 const s=String(value||'').trim();
 if(!s)return '';
 for(const [country,re] of countries)if(re.test(s))return country;
 if(/^(?:대한민국|한국)(?:\s|$)|^(?:서울|부산|인천|대전|대구|광주|울산|세종|경기도|제주)/.test(s))return '한국';
 if(/중국(?!어)|베이징|북경|상하이|상해|광저우|선전|칭다오|청도|청두|선양|다롄|홍콩|마카오/.test(s))return '중국';
 return '';
}
export function workLocationDecision(job, { structuredCountry=false }={}) {
 if(structuredCountry) {
  const raw=String(job.country||'').trim();
  if(!raw)return {state:'pending',reason:'실제 근무 국가를 확인할 수 없습니다. 원문에서 한국·중국 근무 여부를 확인해 주세요.'};
  const country=countries.find(([,re])=>re.test(raw))?.[0];
  return country?{state:'ready',country,reason:''}:{state:'excluded',reason:`근무 국가가 수집 대상(한국·중국)이 아닙니다: ${raw}`};
 }
 // Culture notices identify their physical overseas institution in the title.
 // Never match the "한국" inside "한국문화원" as a Korean workplace.
 const institution=String(job.title||'').match(/주([^\s()[\]]+?)(?:한국문화원|문화원|대사관|총영사관)/)?.[1];
 const location=String(job.workplace||'').trim();
 const country=place(location) || (!location && institution ? place(institution) : '');
 if(country)return {state:'ready',country,reason:''};
 if(institution && !place(institution))return {state:'excluded',reason:`한국·중국 외 지역의 기관 채용입니다: ${institution}`};
 return {state:'pending',reason:'실제 근무지가 불명확합니다. 한국·중국 근무 여부를 원문에서 확인해 주세요.'};
}
