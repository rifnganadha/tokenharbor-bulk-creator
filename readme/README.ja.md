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

# Token Harbor 一括アカウント作成ツール

> 使い捨てメールで Token Harbor アカウントを一括作成し、ランダム名の API キーを自動生成します。

<p><a href="../README.md">English</a> · <a href="README.id.md">Indonesia</a> · <a href="README.zh.md">简体中文</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

---

`tokenharbor-bulk-creator` は三つを一つの再現可能なパイプラインにまとめます: 使い捨て
メールサービス ([temp-email.dev](https://www.temp-email.dev))、人間と同じように Token Harbor の
登録とメール認証を行う実ブラウザ、そして Token Harbor ダッシュボードの API キー作成
フローです。数を与えると、すぐ使える `thk_live_…` キーの JSON 表を返します。

> 本ツールは正当な自動化、内部テスト、および保有アカウントの研究を目的とします。
> Token Harbor の利用規約および適用法の遵守は利用者の責任です。

---

## なぜブラウザが必要か

Token Harbor ([tokenharbor.ai](https://tokenharbor.ai)) は Next.js アプリで、登録は自身の
HTTPS API（`/api/auth/signup-precheck`）に対して行われ、その後セッション Cookie が
設定されます。メール認証は**クリックするリンク**で、API キーは認証済みダッシュボードで
作成されます。登録やキー発行の公開 REST API は存在しないため、実 UI を
[Playwright](https://playwright.dev) で操作するのが確実で誠実な方法です。

## 機能

- **使い捨てメール** – アカウントごとに固有の temp-email.dev 受信箱を作成。
- **全工程** – 登録 → メール認証 → API キー。
- **ランダムな識別子** – メール、パスワード（12 文字以上）、キー名をランダム化。
- **自動 API キー** – `prod-token-7421` のような名前、`thk_live_` 接頭辞。
- **レート制限を考慮** – "take a breath" スロットルを検知してバックオフ。
- **逐次出力** – 1 アカウントごとに JSON を書き直し。
- **並行処理** – 任意の並列ワーカー。
- **リトライ** – 失敗時は新しい識別子で再試行。
- **差し替え可能な受信箱** – `temp-email-dev` または汎用 `custom` REST。
- **構造化ログ** – 色付き・タイムスタンプ付きのコンソール出力。

## 構成

```
src/
├── index.mjs             # CLI エントリ（フラグ、ブラウザ、ワーカープール）
├── core/provision.mjs    # 全工程、リトライ、結果レコード
├── tokenharbor/client.mjs# 登録・認証・API キー作成（Playwright）
├── inbox/index.mjs       # temp-email.dev リーダー + REST + リンク解析
└── utils/                # config, random, logger
```

## 要件

- **Node.js 18+**
- Playwright 用の Chromium/Firefox/WebKit
- `tokenharbor.ai` と `www.temp-email.dev` に到達できるネットワーク

## インストール

```bash
git clone https://github.com/0xgetz/tokenharbor-bulk-creator.git
cd tokenharbor-bulk-creator
npm install
npx playwright install --with-deps chromium
```

## クイックスタート

```bash
# 1 アカウント、ブラウザを表示
node src/index.mjs --headful

# 5 アカウント、./output に出力
node src/index.mjs -n 5 -o output/accounts.json

# 10 アカウント、2 ワーカー
node src/index.mjs -n 10 -c 2

# 環境チェック
node src/index.mjs --doctor
```

### CLI リファレンス

| フラグ | 既定 | 説明 |
| --- | --- | --- |
| `-n, --count` | `1` | アカウント数 |
| `-c, --concurrency` | `1` | 並列ワーカー |
| `-o, --out` | `tokenharbor-accounts-<ts>.json` | 結果 JSON のパス |
| `-t, --timeout` | `180000` | 認証メール待ちの上限 (ms) |
| `--turnstile-timeout` | `150000` | Cloudflare 待ち上限（現在は no-op） |
| `--retries` | `3` | アカウントごとの試行回数 |
| `--inbox-provider` | `temp-email-dev` | `temp-email-dev` \| `custom` |
| `--mail-base-url` | – | `custom` 受信箱のベース URL |
| `--password` | ランダム | 固定パスワード（>= 12 文字） |
| `--key-name` | ランダム | 固定 API キー名 |
| `--proxy` | – | ブラウザ用プロキシ URL |
| `--headful` | オフ | ブラウザを表示 |
| `-q, --quiet` | オフ | 最終サマリのみ表示 |
| `--doctor` | – | 環境を確認して終了 |

## 受信箱プロバイダ

| プロバイダ | 値 | 仕組み |
| --- | --- | --- |
| temp-email.dev *(既定)* | `temp-email-dev` | ブラウザでサイト UI を操作し、サイトがアドレスを生成。 |
| カスタム REST | `custom` | 汎用の一時メール JSON API（`/domains`、`/accounts`、`/messages`）。 |

## レート制限

Token Harbor にはソフトな不正防止スロットルがあります。登録が *"You're doing that a bit
fast — take a breath and try again."* を返した場合、45 秒待って一度だけ再試行し、
なお失敗すれば `rate-limit` として失敗扱いにします。大量実行時は `--concurrency` を
1〜2 に保ってください。

## 出力

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

## ライセンス

[MIT ライセンス](../LICENSE) の下で公開されています。
