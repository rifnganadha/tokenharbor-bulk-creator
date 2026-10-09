<p align="center"><a href="README.md">
  <img src="docs/assets/logo.svg" alt="tokenharbor-bulk-creator" width="150">
</a></p>

<p align="center"><img src="docs/assets/banner.svg" alt="tokenharbor-bulk-creator banner"></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node"></a>
  <a href="https://playwright.dev/"><img src="https://img.shields.io/badge/playwright-%E2%9C%94-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22e6a5?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/tests-18%20passed-39d0ff?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Tests">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-7c5cff?style=for-the-badge" alt="Platform">
</p>

# Token Harbor Bulk Account Creator

> Bulk-provision Token Harbor accounts with disposable inboxes and auto-generate API keys that carry random names.

<p><strong>English</strong> · <a href="readme/README.id.md">Indonesia</a> · <a href="readme/README.zh.md">简体中文</a> · <a href="readme/README.ja.md">日本語</a> · <a href="readme/README.ko.md">한국어</a> · <a href="readme/README.es.md">Español</a></p>

---

`tokenharbor-bulk-creator` ties three things together in one reproducible pipeline: a
disposable mailbox provider ([temp-email.dev](https://www.temp-email.dev) by default,
or [smtp.dev](https://smtp.dev/docs/api)), a real browser that
runs Token Harbor's signup and email verification exactly as a person would, and the
Token Harbor dashboard API-key flow. Feed it a count, and it returns a JSON table of
ready-to-use `thk_live_…` keys.

> This tool is intended for legitimate automation, internal testing and
> research on accounts you own. You are responsible for complying with
> Token Harbor's terms of service and any applicable law.

---

## Why a browser?

Token Harbor ([tokenharbor.ai](https://tokenharbor.ai)) is a Next.js application whose
signup runs against its own HTTPS API (`/api/auth/signup-precheck`) and then sets a
session cookie. Email verification is a **click-through link** mailed to the account
address, and API keys are created from the authenticated dashboard. There is no
documented public REST endpoint to register or to mint keys, so the reliable,
honest approach is to drive the real UI with [Playwright](https://playwright.dev):
the page does the work, and the results are scraped from the rendered dashboard.

## Features

- **Disposable mailboxes** – creates a unique temp-email.dev (or smtp.dev) inbox per account.
- **Full onboarding** – signup → free-models opt-in → email verification → API key, end to end.
- **Random identity** – emails, passwords (12+ chars) and key labels are unpredictable.
- **Auto API keys** – named like `prod-token-7421`, prefix `thk_live_`.
- **9Router hand-off** *(optional)* – logs into a [9Router](https://github.com/decolua/9router)
  gateway and attaches each new key to its Token Harbor provider automatically.
- **Session wiped** – once a key is minted, the browser's cookies and site data
  are cleared and each account runs in its own isolated context.
- **Rate-limit aware** – detects Token Harbor's "take a breath" throttle and backs off.
- **Incremental output** – the JSON file is flushed after every account, so a
  crash never loses completed work.
- **Concurrency** – optional parallel workers.
- **Retries** – per-account attempts with fresh identities on failure.
- **Pluggable inbox** – `temp-email-dev` (browser), `smtp-dev` (API key), or any classic `custom` temp-mail REST API.
- **Structured logging** – colourised, timestamped console output.

## Architecture

```
src/
├── index.mjs             # CLI entry point (flags, browser boot, worker pool)
├── core/
│   └── provision.mjs     # end-to-end flow, retries, result record
├── tokenharbor/
│   └── client.mjs        # signup, verification, API-key creation (Playwright)
├── ninerouter/
│   └── client.mjs        # 9Router login + Token Harbor add-key flow (Playwright)
├── inbox/
│   └── index.mjs         # temp-email.dev + smtp.dev + REST readers, link parsing
└── utils/
    ├── config.mjs        # flags > .env > defaults, proxy parsing
    ├── random.mjs        # random emails, passwords, key labels
    └── logger.mjs        # shared logger
```

## Requirements

- **Node.js 18+**
- A Chromium/Firefox/WebKit browser installed for Playwright
- A network that can reach `tokenharbor.ai` and `www.temp-email.dev`

## Installation

```bash
git clone https://github.com/0xgetz/tokenharbor-bulk-creator.git
cd tokenharbor-bulk-creator
npm install
npx playwright install --with-deps chromium
```

## Quick start

```bash
# One account, watch the browser work
node src/index.mjs --headful

# Five accounts, JSON in ./output
node src/index.mjs -n 5 -o output/accounts.json

# Headless batch of ten with two workers
node src/index.mjs -n 10 -c 2

# Check the environment first
node src/index.mjs --doctor
```

### CLI reference

| Flag | Default | Description |
| --- | --- | --- |
| `-n, --count` | `1` | Number of accounts to create |
| `-c, --concurrency` | `1` | Parallel workers |
| `-o, --out` | `tokenharbor-accounts-<ts>.json` | JSON result path |
| `-t, --timeout` | `180000` | Max ms to wait for the verification email |
| `--turnstile-timeout` | `150000` | Max ms to wait for Cloudflare (no-op; kept for parity) |
| `--retries` | `3` | Attempts per account |
| `--inbox-provider` | `temp-email-dev` | `temp-email-dev` \| `smtp-dev` \| `custom` |
| `--mail-base-url` | – | Base URL for the `smtp-dev` (default `https://api.smtp.dev`) or `custom` inbox provider |
| `--mailbox-domain` | auto | Pin a mail domain for the `smtp-dev` / `custom` provider |
| `--inbox-api-key` | – | API key for the `smtp-dev` provider (or `TH_INBOX_API_KEY`) |
| `--password` | random | Fixed password (>= 12 characters) for all accounts |
| `--key-name` | random | Fixed API-key label |
| `--connect-9router` | off | Connect each new key to a 9Router gateway (or `TH_CONNECT_9ROUTER=1`) |
| `--9router-url` | `http://localhost:20128` | 9Router dashboard URL (or `TH_9ROUTER_URL`) |
| `--9router-password` | `123456` | 9Router dashboard password (or `TH_9ROUTER_PASSWORD`) |
| `--proxy` | – | Proxy URL for the browser |
| `--headful` | off | Show the browser |
| `--keep-browser` | off | Leave the browser open at the end (debugging) |
| `-q, --quiet` | off | Print only the final summary |
| `--doctor` | – | Check the environment and exit |
| `-v, --version` | – | Print the version |

Environment variables mirror every flag (`TH_COUNT`, `TH_PROXY`, …). See
[`.env.example`](.env.example).

## Inbox providers

| Provider | Flag value | How it works |
| --- | --- | --- |
| temp-email.dev *(default)* | `temp-email-dev` | Drives the site's UI in a browser; the site generates the address, which the script reads back. |
| smtp.dev | `smtp-dev` | Uses the [smtp.dev email-testing API](https://smtp.dev/docs/api). Picks an active domain, creates an account, and polls its INBOX. Needs `--inbox-api-key` (create one at [smtp.dev/tokens](https://smtp.dev/tokens/)). |
| Custom REST | `custom` | Any classic temp-mail JSON API (`GET /domains`, `POST /accounts`, `GET /messages`), e.g. mail.tm / mail.gw. Set `--mail-base-url`. |

With `temp-email-dev` a fresh browser context is used per account, so each run gets
its own inbox even though the site persists the address in `localStorage`.

### smtp.dev

Grab an API key from [smtp.dev/tokens](https://smtp.dev/tokens/), then:

```bash
node src/index.mjs -n 3 --inbox-provider smtp-dev --inbox-api-key smtplabs_xxx
```

Or set `TH_INBOX_PROVIDER=smtp-dev` and `TH_INBOX_API_KEY=smtplabs_xxx` in `.env`.
The reader calls `GET /domains`, `POST /accounts`, and
`GET /accounts/{id}/mailboxes/{mailboxId}/messages` (auth via the `X-API-KEY`
header) and deletes the account when it is done. No browser is needed for the
inbox, though the Token Harbor side still runs through Playwright.

## Rate limits

Token Harbor applies a soft anti-abuse throttle. When signup answers with
*"You're doing that a bit fast — take a breath and try again."* the run backs off
for 45 seconds and retries once; if it persists, the account is marked failed with
kind `rate-limit` and is **not** retried further. For large batches keep
`--concurrency` low (1–2) and expect a few seconds between accounts.

## Output

`accounts.json`:

```json
{
  "generated_at": "2026-01-01T12:00:00+00:00",
  "total": 1,
  "succeeded": 1,
  "failed": 0,
  "accounts": [
    {
      "ok": true,
      "email": "swiftfox482913@swiftemail.dev",
      "password": "…",
      "api_key": "thk_live_…",
      "key_name": "prod-token-7421",
      "free_models": true,
      "api_base": "https://api.tokenharbor.ai/v1",
      "email_provider": "temp-email.dev",
      "nine_router": { "ok": true, "url": "http://localhost:20128", "name": "swiftfox482913@swiftemail.dev", "elapsed_ms": 5210 },
      "elapsed_ms": 41230,
      "created_at": "2026-01-01T12:00:00+00:00"
    }
  ]
}
```

The file is rewritten after every account, so an interrupted batch still contains
everything finished up to that point. The optional `nine_router` object is added
only when `--connect-9router` is used (see below).

## Connecting to 9Router

[9Router](https://github.com/decolua/9router) is a self-hosted AI gateway that
fronts provider API keys. With `--connect-9router` the tool signs into your
9Router dashboard and registers each freshly minted Token Harbor key as a
connection, so a new account is usable from the gateway immediately.

```bash
# Local 9Router (defaults: http://localhost:20128, password 123456)
node src/index.mjs -n 5 --connect-9router

# Remote / custom install
node src/index.mjs -n 5 --connect-9router \
  --9router-url https://9router.example.com --9router-password 's3cret'
```

Or set it once in `.env` and just pass the flag:

```dotenv
TH_CONNECT_9ROUTER=0
TH_9ROUTER_URL=https://9router.example.com
TH_9ROUTER_PASSWORD=change-me
```

The connection mirrors the dashboard by hand:

1. **Login** – opens `{url}/login`, fills the password and submits.
2. **Token Harbor provider** – deep-links straight to
   `/dashboard/providers/tokenharbor` (the provider grid is skipped).
3. **Add** – clicks **+ Add** to open *“Add Token Harbor API Key”*.
4. **Fill** – sets **Name** to the created account email and **API Key** to its
   `thk_live_…` secret (Priority and Proxy Pool keep their defaults).
5. **Save** – submits the dialog.

The step is **best-effort**: if 9Router is unreachable or the password is wrong
the account is still reported as created (`ok: true`) and the failure is recorded
in its `nine_router` object, e.g. `{ "ok": false, "error_kind": "auth", … }`.
Each account connects in its own browser context, so parallel workers never share
an authenticated 9Router session.

## Using a generated key

Token Harbor is OpenAI-compatible with base URL `https://api.tokenharbor.ai/v1`
(with a fallback of `https://tokenharbor.ai/v1`; verify the exact host in your
dashboard's **Connect** page):

```bash
curl https://api.tokenharbor.ai/v1/chat/completions \
  -H "Authorization: Bearer thk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hello"}]}'
```

## Programmatic use

```js
import { chromium } from "playwright";
import { provisionOne } from "./src/core/provision.mjs";

const browser = await chromium.launch({ headless: true });
const platform = await browser.newContext();
const inbox = await browser.newContext();

const result = await provisionOne(platform, inbox, { timeout: 180000, retries: 2 });
console.log(result.email, result.api_key);
await browser.close();
```

## Development

```bash
node tests/smoke.mjs
```

## License

Released under the [MIT License](LICENSE).
