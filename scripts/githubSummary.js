import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const listLength = (value) => (Array.isArray(value) ? value.length : 0);
const tableCell = (value) => String(value ?? '-').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');

export const buildGitHubSummary = (report = {}, review = {}) => {
  const selected = Array.isArray(report.selectedSources) ? report.selectedSources.join(', ') : '-';
  const ready = listLength(review.ready);
  const needsReview = listLength(review.needsReview);
  const lines = [
    '# OpenJob Radar 수집 결과',
    '',
    `- 실행 시각: ${tableCell(report.ranAt)}`,
    `- 선택 출처: ${tableCell(selected)}`,
    `- 등록 검토: ${ready}건`,
    `- 확인 필요: ${needsReview}건`,
    '',
    '| 출처 | 발견 | 제외 | 경고 | 상태 |',
    '| --- | ---: | ---: | ---: | --- |',
  ];

  for (const result of Array.isArray(report.results) ? report.results : []) {
    const status = result.error ? `실패: ${result.error}` : result.emptyReason || '완료';
    lines.push(
      `| ${tableCell(result.name || result.id)} | ${Number(result.found) || 0} | ${listLength(result.exclusions)} | ${listLength(result.warnings)} | ${tableCell(status)} |`,
    );
  }

  lines.push('', '결과 파일은 이 실행의 Artifacts에서 내려받을 수 있으며 저장소나 웹사이트에는 자동 반영되지 않습니다.', '');
  return lines.join('\n');
};

const main = async () => {
  const [reportPath, reviewPath] = process.argv.slice(2);
  if (!reportPath || !reviewPath) throw new Error('실행 보고서와 검토 파일 경로가 필요합니다.');
  const [report, review] = await Promise.all([
    readFile(resolve(reportPath), 'utf8').then(JSON.parse),
    readFile(resolve(reviewPath), 'utf8').then(JSON.parse),
  ]);
  const summary = buildGitHubSummary(report, review);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  else process.stdout.write(summary);
};

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
