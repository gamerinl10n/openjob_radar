import { COLLECTION_SOURCES } from './sources.js';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, writeJson, acquireLock, recoverTransaction, commitTransaction, sourceUrlOf } from './storage.js';
import { validateJob } from './contract.js';

const defaults = {
  'review.json': { schemaVersion: 1, ready: [], needsReview: [], updatedAt: null },
  'approved.json': [], 'rejected.json': [], 'last-run.json': null,
  'state.json': { schemaVersion: 1, worldjob: { nextPage: 1 } }, 'source-health.json': {},
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (item) => object(item) && typeof item.id === 'string' && item.id.length > 0 && typeof item.title === 'string' && Boolean(sourceUrlOf(item));
export function validateBackup(backup) {
  if (!object(backup) || backup.format !== 'openjob-radar-backup' || backup.version !== 1 || !object(backup.files)) throw new Error('OpenJob Radar 백업 파일이 아닙니다.');
  const files = backup.files;
  if (Object.keys(files).some((key) => !Object.hasOwn(defaults, key)) || Object.keys(defaults).some((key) => !Object.hasOwn(files, key))) throw new Error('백업 파일 구성이 올바르지 않습니다.');
  const review = files['review.json'];
  if (!object(review) || !Array.isArray(review.ready) || !Array.isArray(review.needsReview)) throw new Error('검토 목록 형식이 올바르지 않습니다.');
  for (const list of [review.ready, review.needsReview, files['approved.json'], files['rejected.json']]) {
    if (!Array.isArray(list) || list.some((item) => !record(item))) throw new Error('공고 데이터 형식이 올바르지 않습니다.');
  }
  for (const item of [...review.ready, ...files['approved.json']]) {
    if (validateJob(item).length || !object(item.location) || !Array.isArray(item.responsibilities) || !Array.isArray(item.requirements)) throw new Error('공고 필수 정보가 누락됐습니다.');
  }
  if (files['rejected.json'].some((item) => !['ready','needsReview'].includes(item.queue))) throw new Error('제외 기록의 원래 목록 정보가 없습니다.');
  for (const item of [...review.ready, ...review.needsReview, ...files['approved.json'], ...files['rejected.json']]) {
    if (item.source !== undefined && (!object(item.source) || (item.source.name !== undefined && typeof item.source.name !== 'string'))) throw new Error('공고 출처 정보가 올바르지 않습니다.');
    for (const key of ['responsibilities', 'requirements']) if (item[key] !== undefined && (!Array.isArray(item[key]) || item[key].some((v) => typeof v !== 'string'))) throw new Error('공고 세부 내용 형식이 올바르지 않습니다.');
  }
  const state = files['state.json'];
  if (!object(state) || !object(state.worldjob) || !Number.isInteger(state.worldjob.nextPage) || state.worldjob.nextPage < 1) throw new Error('수집 위치 정보가 올바르지 않습니다.');
  const health = files['source-health.json'];
  if (!object(health) || Object.entries(health).some(([id, value]) => !COLLECTION_SOURCES.some(source => source.id === id) || !object(value) || !['failed','partial','success'].includes(value.state) || !Array.isArray(value.warnings))) throw new Error('출처 상태 정보가 올바르지 않습니다.');
  const report = files['last-run.json'];
  if (report !== null && (!object(report) || !Array.isArray(report.results) || report.results.some((entry) => !object(entry) || (entry.warnings !== undefined && !Array.isArray(entry.warnings))))) throw new Error('수집 보고서 형식이 올바르지 않습니다.');
  return files;
}
async function withDataLock(root, action) {
  const data = resolve(root, 'data');
  const release = await acquireLock(resolve(data, '.operation.lock'));
  try { await recoverTransaction(resolve(data, 'transaction.json')); return await action(data); }
  finally { await release(); }
}
async function snapshot(data) {
  const files = {};
  for (const [name, fallback] of Object.entries(defaults)) files[name] = await readJson(resolve(data, name), fallback);
  return { format: 'openjob-radar-backup', version: 1, createdAt: new Date().toISOString(), files };
}
export const exportBackup = (root) => withDataLock(root, snapshot);
export async function restoreBackup(root, backup) {
  const files = validateBackup(backup);
  return withDataLock(root, async (data) => {
    const safetyName = `before-restore-${Date.now()}-${randomUUID()}.json`;
    await writeJson(resolve(data, 'backups', safetyName), await snapshot(data));
    await commitTransaction(resolve(data, 'transaction.json'), Object.entries(files).map(([name, value]) => [resolve(data, name), value]));
    return { safetyName };
  });
}
