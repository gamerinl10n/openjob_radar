import { Worker } from 'node:worker_threads';
import { httpResponseError, withTransientRetry } from './fetchRetry.js';

export const MAX_PDF_BYTES = 6 * 1024 * 1024;
const origin = 'https://www.korean-culture.org';
export function extractPdfText(bytes, { timeoutMs = 6000 } = {}) {
  if (bytes.length > MAX_PDF_BYTES || Buffer.from(bytes).subarray(0, 5).toString() !== '%PDF-')
    return Promise.reject(new Error('PDF 형식 또는 파일 크기(6MB)를 확인해 주세요.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdfTextWorker.js', import.meta.url), {
      workerData: bytes, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const timer = setTimeout(() => finish(new Error('PDF 분석 시간이 초과되었습니다.')), timeoutMs);
    let done = false;
    function finish(error, text) {
      if (done) return;
      done = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(text);
    }
    worker.once('message', (value) => finish(value.error ? new Error(value.error) : null, value.text));
    worker.once('error', (error) => finish(error));
    worker.once('exit', () => { if (!done) finish(new Error('PDF 분석을 완료하지 못했습니다.')); });
  });
}

async function fetchPdfOnce(file, { fetcher = fetch, timeoutMs = 8000 } = {}) {
  const target = new URL(file.download?.url || file.url);
  if (target.origin !== origin || target.username || target.password)
    throw new Error('공식 첨부파일 주소가 아닙니다.');
  if (!file.download && !target.pathname.toLowerCase().endsWith('.pdf'))
    throw new Error('PDF 다운로드 주소를 확인하지 못했습니다.');
  const signal = AbortSignal.timeout(timeoutMs);
  let current = target.href;
  let method = file.download ? 'POST' : 'GET';
  let body;
  if (file.download) {
    const fields = file.download.fields;
    if (target.pathname !== '/file/download.do' || !/^[\w.-]+\.pdf$/i.test(fields?.serverFileName || '')
      || !/^\d+$/.test(fields?.fileIdx || '') || fields.menuCode !== 'menu0213' || fields.langCode !== 'lang001')
      throw new Error('PDF 다운로드 정보를 확인하지 못했습니다.');
    body = new URLSearchParams(fields).toString();
  }
  const visited = new Set();
  for (let hop = 0; hop < 4; hop++) {
    if (visited.has(current)) throw new Error('PDF 주소 이동이 반복됩니다.');
    visited.add(current);
    const response = await fetcher(current, { method, body, signal, redirect: 'manual',
      headers: { Accept: 'application/pdf', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) } });
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('PDF 이동 주소가 없습니다.');
      const next = new URL(location, current);
      if (next.origin !== origin || next.username || next.password) throw new Error('외부 PDF 주소로 이동하여 중단했습니다.');
      if ([301,302,303].includes(response.status)) { method = 'GET'; body = undefined; }
      current = next.href; continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw httpResponseError('PDF 다운로드 실패', response);
    }
    if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) {
      await response.body?.cancel(); throw new Error('PDF가 6MB를 초과합니다.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('PDF 응답이 비어 있습니다.');
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_PDF_BYTES) throw new Error('PDF가 6MB를 초과합니다.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('첨부 응답이 PDF 형식이 아닙니다.');
    return bytes;
  }
  throw new Error('PDF 주소 이동이 너무 많습니다.');
}

export async function fetchPdf(file, options = {}) {
  return withTransientRetry(() => fetchPdfOnce(file, options), options);
}

export async function readJobPdf(job, { fetcher = fetch, extract = extractPdfText, runRequest, onRetry, sleep, retries = 1 } = {}) {
  const candidates = job.attachments.filter((file) => /\.pdf(?:$|[?#])/i.test(file.name || file.url)
    && !/지원서|동의서|자기소개서|양식/.test(file.name));
  const file = candidates.find((item) => /공고|모집|채용/.test(item.name)) || candidates[0];
  if (!file) return { reason: '읽을 수 있는 공고 PDF가 없습니다. HWP·이미지 등 첨부파일을 확인해 주세요.' };
  try {
    const request = () => fetchPdf(file, { fetcher, onRetry, sleep, retries });
    const bytes = await (runRequest ? runRequest(request) : request());
    const text = await extract(bytes);
    return { text, file: { name: file.name, url: file.url } };
  } catch (error) {
    return { reason: /timeout/i.test(error.name) ? 'PDF 다운로드 시간이 초과되었습니다.' : error.message };
  }
}
