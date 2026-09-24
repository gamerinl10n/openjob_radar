# OpenJob Radar 출력 데이터 계약

이 문서는 OpenJob Radar의 공고 출력 형식을 정의한다. 수집기는 원문을 이 구조로 정규화하고, 운영진이 CLI와 Git diff로 확인한 데이터만 `data/approved.json`에 기록한다.

## 기본 원칙

- 모든 날짜는 ISO 8601 문자열을 사용한다.
- 날짜만 제공하는 마감일(`YYYY-MM-DD`)은 중국 표준시(UTC+8) 23:59:59까지 유효하다.
- 레코드 ID(`id`)와 수집기 내부 ID(`radarId`)를 분리한다.
- 후속 소비자가 사용할 수 있도록 안정적인 `slug`를 만든다.
- 선택 필드가 없으면 빈 문자열보다 `null` 또는 빈 배열을 사용한다.
- 수집 결과를 곧바로 승인하지 않고 원문을 확인한 뒤 승인한다.

## 스키마

| 필드 | 형식 | 필수 | 설명 |
|---|---|---:|---|
| `id` | string | 예 | 공고 레코드의 안정적인 식별자 |
| `radarId` | string | 예 | 수집기 내부 레코드 식별자 |
| `slug` | string | 예 | 후속 소비자가 사용할 URL-safe 값 |
| `title` | string | 예 | 공고 제목 |
| `company.name` | string | 예 | 회사명 |
| `company.logoUrl` | string/null | 아니요 | https 회사 로고 주소 |
| `category` | string | 예 | 정규화된 직무 분류 |
| `location.country` | string/null | 아니요 | 국가 |
| `location.city` | string/null | 아니요 | 도시 |
| `location.workplace` | string/null | 아니요 | 공항·캠퍼스 등 세부 근무지 |
| `location.remote` | boolean | 아니요 | 원격 근무 가능 여부 |
| `educationLevel` | string/null | 아니요 | 최소 학력 |
| `experienceLevel` | string/null | 아니요 | 신입·경력 등 |
| `employmentType` | string/null | 아니요 | 정규직·인턴·계약직 등 |
| `languages` | string[] | 아니요 | 요구 언어 |
| `visaSupport` | enum | 아니요 | `supported`, `notSupported`, `unknown` |
| `postedAt` | ISO 8601/null | 아니요 | 원문 게시일 |
| `deadline` | ISO 8601/null | 아니요 | 마감일. null은 상시 또는 미확인 |
| `verifiedAt` | ISO 8601/null | 아니요 | 운영진이 마지막으로 원문을 확인한 시각 |
| `summary` | string/null | 아니요 | 목록과 상세 상단에 사용할 짧은 요약 |
| `responsibilities` | string[] | 아니요 | 주요 업무 |
| `requirements` | string[] | 아니요 | 필수 자격 |
| `preferred` | string[] | 아니요 | 우대 사항 |
| `application.method` | string/null | 아니요 | 원문 지원, 이메일 등 |
| `application.url` | string/null | 아니요 | 실제 지원 주소 |
| `source.name` | string | 예 | 51job 등 출처명 |
| `source.url` | string | 예 | 확인 가능한 원문 주소 |
| `status` | enum | 예 | 아래 저장 상태 |
| `sharing.wechatOverride` | string/null | 아니요 | 운영진이 확정한 위챗 공유 문구 |

## 상태

저장 상태는 다음 다섯 가지만 사용한다.

- `draft`: 수집 또는 검토 중
- `published`: 운영진 승인 완료. 호환성을 위해 유지하는 상태명이며 웹사이트 게시를 뜻하지 않음
- `sourceRemoved`: 원문 삭제 확인
- `duplicate`: 다른 공고와 중복
- `rejected`: 게시 제외

마감된 레코드는 삭제하지 않아 이후 통계와 중복 판정에 활용할 수 있다.

권장 전이:

```text
draft → published → sourceRemoved
draft → duplicate
draft → rejected
published → sourceRemoved
```

## 예시

```js
{
  id: 'job-2026-001',
  radarId: 'radar-51job-170307846',
  slug: 'korean-air-cargo-shanghai',
  title: '화물 지상직',
  company: { name: '대한항공', logoUrl: null },
  category: 'operations',
  location: {
    country: '중국',
    city: '상하이',
    workplace: '푸둥공항',
    remote: false
  },
  educationLevel: '학사 이상',
  experienceLevel: '경력 무관',
  employmentType: '정규직',
  languages: ['한국어', '중국어'],
  visaSupport: 'unknown',
  postedAt: null,
  deadline: null,
  verifiedAt: '2026-09-05',
  summary: '상하이 푸둥공항 화물 부문 지상 업무',
  responsibilities: ['항공 화물 현장 운영', '고객·협력사 대응'],
  requirements: [],
  preferred: [],
  application: {
    method: '원문 지원',
    url: 'https://jobs.example.com/1'
  },
  source: {
    name: '51job',
    url: 'https://jobs.example.com/1'
  },
  status: 'published',
  sharing: { wechatOverride: null }
}
```
