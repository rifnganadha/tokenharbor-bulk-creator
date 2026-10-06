<p align="center"><a href="../README.md">
  <img src="../docs/assets/logo.svg" alt="tokenharbor-bulk-creator" width="150">
</a></p>

<p align="center"><img src="../docs/assets/banner.svg" alt="tokenharbor-bulk-creator banner"></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node"></a>
  <a href="https://playwright.dev/"><img src="https://img.shields.io/badge/playwright-%E2%9C%94-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-22e6a5?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/tests-9%20passed-39d0ff?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Tests">
</p>

# Token Harbor 대량 계정 생성기

> 일회용 이메일로 Token Harbor 계정을 대량 생성하고, 무작위 이름의 API 키를 자동으로 만듭니다.

<p><a href="../README.md">English</a> · <a href="README.id.md">Indonesia</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.es.md">Español</a></p>

---

`tokenharbor-bulk-creator`는 세 가지를 하나의 재현 가능한 파이프라인으로 묶습니다:
일회용 메일 제공자([temp-email.dev](https://www.temp-email.dev)), 사람처럼 Token Harbor 가입과
이메일 인증을 수행하는 실제 브라우저, 그리고 Token Harbor 대시보드의 API 키 생성
흐름입니다. 개수를 주면 바로 쓸 수 있는 `thk_live_…` 키의 JSON 표를 돌려줍니다.

> 이 도구는 정당한 자동화, 내부 테스트, 그리고 본인 소유 계정에 대한 연구를 위한
> 것입니다. Token Harbor 이용약관과 관련 법규 준수는 사용자의 책임입니다.

---

## 왜 브라우저인가

Token Harbor([tokenharbor.ai](https://tokenharbor.ai))는 Next.js 앱으로, 가입은 자체 HTTPS
API(`/api/auth/signup-precheck`)로 진행되고 세션 쿠키가 설정됩니다. 이메일 인증은
**클릭 링크**로 오며, API 키는 인증된 대시보드에서 생성됩니다. 가입이나 키 발급용
공개 REST API가 없으므로, 실제 UI를 [Playwright](https://playwright.dev)로 구동하는 것이
가장 확실하고 정직한 방법입니다.

## 기능

- **일회용 메일함** – 계정마다 고유한 temp-email.dev 메일함 생성.
- **전체 온보딩** – 가입 → 이메일 인증 → API 키.
- **무작위 신원** – 이메일, 비밀번호(12자 이상), 키 라벨을 무작위화.
- **자동 API 키** – `prod-token-7421` 같은 이름, `thk_live_` 접두사.
- **레이트 리밋 인식** – "take a breath" 스로틀을 감지해 백오프.
- **증분 출력** – 계정마다 JSON 파일을 다시 씁니다.
- **동시성** – 선택적 병렬 워커.
- **재시도** – 실패 시 새 신원으로 재시도.
- **교체 가능한 메일함** – `temp-email-dev` 또는 일반 `custom` REST.
- **구조화 로깅** – 색상과 타임스탬프가 있는 콘솔 출력.

## 구조

```
src/
├── index.mjs             # CLI 진입점 (플래그, 브라우저, 워커 풀)
├── core/provision.mjs    # 종단 간 흐름, 재시도, 결과 레코드
├── tokenharbor/client.mjs# 가입·인증·API 키 생성 (Playwright)
├── inbox/index.mjs       # temp-email.dev 리더 + REST + 링크 파싱
└── utils/                # config, random, logger
```

## 요구 사항

- **Node.js 18+**
- Playwright용 Chromium/Firefox/WebKit
- `tokenharbor.ai`와 `www.temp-email.dev`에 접근 가능한 네트워크

## 설치

```bash
git clone https://github.com/0xgetz/tokenharbor-bulk-creator.git
cd tokenharbor-bulk-creator
npm install
npx playwright install --with-deps chromium
```

## 빠른 시작

```bash
# 계정 1개, 브라우저 표시
node src/index.mjs --headful

# 계정 5개, ./output 에 출력
node src/index.mjs -n 5 -o output/accounts.json

# 계정 10개, 워커 2개
node src/index.mjs -n 10 -c 2

# 환경 점검
node src/index.mjs --doctor
```

### CLI 레퍼런스

| 플래그 | 기본 | 설명 |
| --- | --- | --- |
| `-n, --count` | `1` | 계정 수 |
| `-c, --concurrency` | `1` | 병렬 워커 |
| `-o, --out` | `tokenharbor-accounts-<ts>.json` | 결과 JSON 경로 |
| `-t, --timeout` | `180000` | 인증 메일 대기 상한 (ms) |
| `--turnstile-timeout` | `150000` | Cloudflare 대기 상한 (현재 no-op) |
| `--retries` | `3` | 계정당 시도 횟수 |
| `--inbox-provider` | `temp-email-dev` | `temp-email-dev` \| `custom` |
| `--mail-base-url` | – | `custom` 메일함 기본 URL |
| `--password` | 무작위 | 고정 비밀번호 (>= 12자) |
| `--key-name` | 무작위 | 고정 API 키 라벨 |
| `--proxy` | – | 브라우저 프록시 URL |
| `--headful` | 끔 | 브라우저 표시 |
| `-q, --quiet` | 끔 | 최종 요약만 출력 |
| `--doctor` | – | 환경 점검 후 종료 |

## 메일함 제공자

| 제공자 | 값 | 방식 |
| --- | --- | --- |
| temp-email.dev *(기본)* | `temp-email-dev` | 브라우저로 사이트 UI를 구동하며 사이트가 주소를 생성. |
| 사용자 REST | `custom` | 일반 임시 메일 JSON API (`/domains`, `/accounts`, `/messages`). |

## 레이트 리밋

Token Harbor는 소프트한 악용 방지 스로틀이 있습니다. 가입이 *"You're doing that a bit
fast — take a breath and try again."* 를 반환하면 45초 대기 후 한 번 재시도하고,
그래도 실패하면 `rate-limit`으로 실패 처리합니다. 대량 실행 시 `--concurrency`를 1~2로
유지하세요.

## 출력

```json
{
  "ok": true,
  "email": "swiftfox482913@swiftemail.dev",
  "api_key": "thk_live_…",
  "key_name": "prod-token-7421",
  "api_base": "https://api.tokenharbor.ai/v1",
  "email_provider": "temp-email.dev"
}
```

## 라이선스

[MIT 라이선스](../LICENSE)로 배포됩니다.
