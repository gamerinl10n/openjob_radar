import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
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
  const temp = path + '.' + process.pid + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

export const pendingId = (url) =>
  'pending-' + createHash('sha256').update(String(url)).digest('hex').slice(0, 20);

export const sourceUrlOf = (item) => item?.source?.url || item?.sourceUrl || item?.url || '';

// A durable journal makes interrupted multi-file changes replayable on the next command.
export async function recoverTransaction(journal) {
  const transaction = await readJson(journal, null);
  if (!transaction) return;
  for (const [path, value] of transaction.entries) await writeJson(path, value);
  await unlink(journal);
}
export async function commitTransaction(journal, entries) {
  await writeJson(journal, { entries });
  await recoverTransaction(journal);
}
export async function acquireLock(path) {
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, String(process.pid), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(path, 'utf8'));
    try { process.kill(pid, 0); }
    catch (probe) {
      if (probe.code === 'ESRCH') { await unlink(path); return acquireLock(path); }
    }
    throw new Error('다른 작업이 실행 중입니다. 완료 후 다시 시도하세요.');
  }
  return () => unlink(path);
}
