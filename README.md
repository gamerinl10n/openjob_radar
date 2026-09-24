# DREAMDURIM Job Collector

웹사이트와 독립적으로 사용할 수 있는 수동 실행형 오픈소스 공고 수집기입니다. 원문을 자동으로 배포하지 않고 사람이 검토할 JSON만 만듭니다.

## 지원 출처

- 월드잡플러스
- 재외한국문화원
- KOTRA 본사 채용

각 출처의 공개 페이지에만 접근합니다. 로그인 우회, 브라우저 자동화, JavaScript 실행은 하지 않습니다.

## 사용법

저장소 루트에서 Node.js 22 이상과 npm을 사용합니다.

```bash
npm ci
npm run collect -- --source kotra
npm run collector:list
```

출처를 생략하면 세 출처를 모두 확인합니다. 쉼표로 여러 출처를 지정할 수 있습니다.

```bash
npm run collect -- --source culture,worldjob
npm run collect -- --source kotra --dry-run
```

결과는 어떤 웹사이트에도 자동으로 게시되지 않습니다.

- `collector/data/review.json`: 등록 후보와 사람이 확인해야 할 공고
- `collector/data/last-run.json`: 최근 실행 결과 및 제외 사유
- `collector/data/state.json`: 다음 월드잡 페이지 위치
- `collector/data/approved.json`: 사람이 확인하고 승인한 공고 기록

원문과 `review.json`을 확인한 뒤 다음처럼 승인합니다.

```bash
npm run collector:approve -- --id radar-example
npm run collector:reject -- --id pending-example
npm run check
git diff
```

승인은 `collector/data/approved.json`을 수정합니다. 필요한 서비스가 이 파일을 별도로 가져가 사용할 수 있으며, 수집기 자체는 외부 서비스로 전송하거나 게시하지 않습니다.

## 설계 원칙

- 모든 실행은 사람이 명령을 입력했을 때만 시작합니다.
- 공고는 자동 게시하지 않습니다.
- 원문 URL로 중복을 제거합니다.
- 이미지·HWP·조건 누락 공고는 확인 필요 목록으로 보냅니다.
- 원문 이미지와 첨부파일을 복제하지 않고 링크와 구조화된 사실만 기록합니다.
- 출처 구조를 읽지 못한 경우 공고 0건으로 오인하지 않고 실패로 기록합니다.

## 기여

새 출처는 `src/sources.js`와 전용 파서를 추가하고, 정상 목록·빈 목록·구조 변경·상세 실패 테스트를 포함해야 합니다. 출처의 이용약관과 robots 정책을 확인하고 요청량을 제한하세요.

## 라이선스

수집기 코드는 MIT License로 공개합니다. 수집 대상 사이트의 문서·이미지·상표에 대한 권리는 각 원저작자에게 있습니다.
