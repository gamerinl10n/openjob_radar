export const COLLECTION_SOURCES = Object.freeze([
  { id: 'worldjob', name: '월드잡플러스', mode: 'manual', url: 'https://www.worldjob.or.kr/advnc/cnttNewList.do?showItemListCount=30' },
  { id: 'culture', name: '재외한국문화원', mode: 'manual', url: 'https://www.korean-culture.org/recruitmentNoti.do' },
  { id: 'kotra', name: 'KOTRA 본사 채용', mode: 'manual', url: 'https://www.kotra.or.kr/subList/20000005817' },
]);
export const statusLabel = (status) => ({
  draft: '검토 대기', published: '게시 중', rejected: '게시 취소',
  sourceRemoved: '원문 삭제', duplicate: '중복',
}[status] || '확인 필요');
export const safeSourceUrl = (value) => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};
