const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
]);

function retryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.min(2000, Math.max(0, delay)) : undefined;
}

export function httpResponseError(label, response) {
  const error = new Error(label + ' (HTTP ' + response.status + ')');
  if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
    error.transient = true;
    error.retryAfterMs = retryAfterMs(response);
  }
  return error;
}

export function isTransientRequestError(error) {
  const code = error?.cause?.code || error?.code;
  return error?.transient === true || error?.name === 'TimeoutError' || TRANSIENT_NETWORK_CODES.has(code);
}

export async function withTransientRetry(task, {
  retries = 1,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  onRetry,
} = {}) {
  if (typeof task !== 'function') throw new TypeError('재시도할 요청 함수가 필요합니다.');
  if (!Number.isInteger(retries) || retries < 0 || retries > 2)
    throw new TypeError('재시도 횟수는 0~2 사이의 정수여야 합니다.');

  for (let attempt = 0; ; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= retries || !isTransientRequestError(error)) throw error;
      const delayMs = error.retryAfterMs ?? Math.min(1000, 250 * (2 ** attempt));
      await onRetry?.({ error, attempt: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }
}
