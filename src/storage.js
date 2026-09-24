import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(path + ' 파일을 읽지 못했습니다: ' + error.message);
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export const pendingId = (url) =>
  'pending-' + createHash('sha256').update(String(url)).digest('hex').slice(0, 20);

export const sourceUrlOf = (item) => item?.source?.url || item?.sourceUrl || item?.url || '';
