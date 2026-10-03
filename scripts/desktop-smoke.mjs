import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = await mkdtemp(join(tmpdir(), 'radar-packaged-'));
await mkdir(join(root, 'data'));
await writeFile(join(root, 'data/review.json'), JSON.stringify({ ready: [], needsReview: [
  { id: 'pending-smoke', title: '[샘플] 한국어 번역가', sourceId: 'worldjob', url: 'https://example.com/job/1', reason: '업무·자격 확인 필요' },
] }));
const application = await electron.launch({
  executablePath: resolve('dist/win-unpacked/OpenJob Radar.exe'),
  env: { ...process.env, OPENJOB_RADAR_HOME: root }, timeout: 60000,
});
try {
  const page = await application.firstWindow();
  await page.locator('#review-count').filter({ hasText: '1' }).waitFor();
  await page.getByRole('tab', { name: '확인 필요' }).click();
  await page.getByRole('button', { name: '상세 · 수정' }).click();
  await page.getByRole('textbox', { name: '회사 · 기관' }).fill('검증용 스튜디오');
  await page.getByRole('textbox', { name: '국가', exact: true }).fill('중국');
  await page.getByRole('textbox', { name: '도시', exact: true }).fill('상하이');
  await page.getByRole('textbox', { name: '담당 업무' }).fill('게임 한국어 번역');
  await page.getByRole('textbox', { name: '지원 자격' }).fill('한국어와 중국어 능통');
  await page.getByRole('button', { name: '수정 후 등록 검토로 저장' }).click();
  await page.locator('#editor').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: '등록 검토' }).click();
  await page.getByRole('checkbox', { name: '[샘플] 한국어 번역가 선택' }).check();
  await page.getByRole('button', { name: '선택 승인' }).click();
  await page.locator('#approved-count').filter({ hasText: '1' }).waitFor();
  await page.getByRole('tab', { name: '승인 기록' }).click();
  await page.getByRole('heading', { name: '[샘플] 한국어 번역가' }).waitFor();
  const approved = JSON.parse(await readFile(join(root, 'data/approved.json'), 'utf8'));
  assert.equal(approved[0].company.name, '검증용 스튜디오');
  await page.screenshot({ path: 'dist/windows-desktop-smoke.png', fullPage: true });
  console.log('Packaged Windows app: render → edit → approve → persisted history passed.');
} finally { await application.close(); }
