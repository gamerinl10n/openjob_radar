import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfText, fetchPdf, MAX_PDF_BYTES } from '../src/publicJobPdf.js';
import { parsePublicDetail, enrichPublicDetail, collectPublicJobCandidates } from '../src/publicJobSources.js';
const url = 'https://www.korean-culture.org/recruitmentNoti/view.do?seq=1';
const candidate = { title: '주상하이한국문화원 채용', sourceUrl: url };
const detail = '<form><div class="viewFile"><li><a href="javascript:filedown(\'123.pdf\', \'공고.pdf\', \'12\');">공고.pdf</a><a href="/docViewer/skin/doc.html?fn=123.pdf">바로보기</a></li></div></form><div class="viewCon">자세한 채용 조건은 상단 붙임파일을 확인하시기 바랍니다.</div>';
// A tiny generated PDF exercises the real parser without network or third-party fixtures.
function pdf(text = 'This is a text recruitment document used to verify safe PDF extraction.') {
 const stream = 'BT /F1 12 Tf 20 100 Td (' + text + ') Tj ET';
 const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream',
 ];
 let content='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(content));content+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});
 const start=Buffer.byteLength(content);
 content+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('');
 content+='trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';
 return Buffer.from(content);
}
test('real PDF worker extracts text; empty, corrupt and oversized PDFs fail', async () => {
 assert.match(await extractPdfText(pdf()), /recruitment document/);
 await assert.rejects(extractPdfText(pdf('')), /텍스트/);
 await assert.rejects(extractPdfText(Buffer.from('<html>error</html>')), /형식/);
 await assert.rejects(extractPdfText(Buffer.alloc(MAX_PDF_BYTES+1)), /크기/);
 await assert.rejects(extractPdfText(pdf(),{timeoutMs:1}), /시간/);
});
test('culture POST metadata is parsed without executing JavaScript', async () => {
 const job=parsePublicDetail(detail,candidate);
 assert.equal(job.attachments[0].download.fields.serverFileName,'123.pdf');
 const bytes=await fetchPdf(job.attachments[0],{fetcher:async(target,options)=>{
  assert.equal(target,'https://www.korean-culture.org/file/download.do');
  assert.equal(options.method,'POST');
  assert.equal(new URLSearchParams(options.body).get('fileIdx'),'12');
  return new Response(pdf());
 }});
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
});
test('transient PDF download failures retry once', async () => {
 let calls=0,retries=0;
 const bytes=await fetchPdf({url:'https://www.korean-culture.org/recruitment.pdf'},{
  fetcher:async()=>++calls===1 ? new Response(null,{status:502}) : new Response(pdf()),
  sleep:async()=>{},
  onRetry:()=>{retries++;},
 });
 assert.equal(calls,2);assert.equal(retries,1);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
});
test('PDF enrichment supplies requirements, duties and deadline', async () => {
 let limitedRequests=0;
 const job=await enrichPublicDetail(parsePublicDetail(detail,candidate),{
  fetcher:async()=>new Response(pdf()),
  extract:async()=> '담당 업무\n행사 기획과 운영\n지원 자격\n중국어 능통자\n접수 마감일: 2099년 1월 31일\n지원 방법: 원문에 안내된 이메일로 제출',
  runRequest:async(task)=>{limitedRequests++;return task();},
 });
 assert.equal(limitedRequests,1);assert.equal(job.needsAttachment,false);assert.equal(job.deadline,'2099-01-31');
 assert.deepEqual(job.requirements,['중국어 능통자']);
 assert.equal(job.pdfSource.name,'공고.pdf');
 assert.ok(job.warnings.some(x=>x.includes('PDF')));
});
test('failed PDF goes to pending, not exclusions, failures or publishable candidates', async () => {
 const {results}=await collectPublicJobCandidates(['culture'],{fetcher:async(target)=>
  new Response(target.includes('/download.do') ? '<html>not PDF</html>' : target.includes('/view.do') ? detail
   : '<table><tr><td><a href="/recruitmentNoti/view.do?seq=1">주상하이문화원 채용</a></td><td>2026.01.01</td><td>2099.01.01</td></tr></table>')});
 const r=results[0];assert.equal(r.pending.length,1);assert.equal(r.stats.attachmentPending,1);
 assert.equal(r.exclusions.length,0);assert.equal(r.stats.unrelated,0);assert.equal(r.stats.detailFailed,0);
 assert.equal(r.candidates.length,0);assert.equal(r.pending.length,1);
});
test('external redirects, HTML and oversized streaming responses are rejected', async () => {
 const file={url:'https://www.korean-culture.org/file.pdf'};
 await assert.rejects(fetchPdf({...file,url:'https://evil.example/file.pdf'}),/공식/);
 await assert.rejects(fetchPdf(file,{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/file.pdf'}})}),/외부/);
 await assert.rejects(fetchPdf(file,{fetcher:async()=>new Response('<html>error</html>')}),/PDF 형식/);
 await assert.rejects(fetchPdf(file,{fetcher:async()=>new Response(new Uint8Array(MAX_PDF_BYTES+1))}),/6MB/);
});
test('unsupported attachments remain inspectable', async () => {
 const job=await enrichPublicDetail(parsePublicDetail(detail.replaceAll('.pdf','.hwp'),candidate));
 assert.equal(job.needsAttachment,true);assert.match(job.attachmentReason,/HWP/);
 assert.equal(job.attachments.length,1);
});
