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

# Token Harbor 批量账号创建器

> 使用一次性邮箱批量注册 Token Harbor 账号，并自动生成带随机名称的 API 密钥。

<p><a href="../README.md">English</a> · <a href="README.id.md">Indonesia</a> · <strong>简体中文</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

---

`tokenharbor-bulk-creator` 将三件事整合为一条可复现的流水线：一次性邮箱服务
([temp-email.dev](https://www.temp-email.dev))、像真人一样完成 Token Harbor 注册与邮箱验证的
真实浏览器，以及 Token Harbor 控制台的 API 密钥创建流程。输入数量，即可得到一份
可直接使用的 `thk_live_…` 密钥 JSON 表。

> 本工具用于合法自动化、内部测试，以及对你自有账号的研究。你有责任遵守
> Token Harbor 的服务条款及适用法律。

---

## 为什么需要浏览器？

Token Harbor ([tokenharbor.ai](https://tokenharbor.ai)) 是一个 Next.js 应用，注册通过其自身的
HTTPS 接口（`/api/auth/signup-precheck`）完成并设置会话 Cookie。邮箱验证是一封**点击链接**
的邮件，API 密钥在已登录的控制台中创建。官方没有公开的注册或签发密钥 REST 接口，因此
可靠且诚实的做法是用 [Playwright](https://playwright.dev) 驱动真实界面。

## 功能

- **一次性邮箱** – 每个账号创建一个独有的 temp-email.dev 收件箱。
- **完整流程** – 注册 → 邮箱验证 → API 密钥，端到端。
- **随机身份** – 邮箱、密码（12 位以上）与密钥标签均为随机。
- **自动 API 密钥** – 形如 `prod-token-7421`，前缀 `thk_live_`。
- **限流感知** – 识别 Token Harbor 的 "take a breath" 限流并退避。
- **增量输出** – 每完成一个账号即重写 JSON 文件。
- **并发** – 可选并行 worker。
- **重试** – 每个账号使用新身份重试。
- **可插拔收件箱** – `temp-email-dev` 或通用 `custom` 临时邮箱 REST 接口。
- **结构化日志** – 带颜色与时间戳的控制台输出。

## 架构

```
src/
├── index.mjs             # CLI 入口（参数、浏览器、worker 池）
├── core/provision.mjs    # 端到端流程、重试、结果记录
├── tokenharbor/client.mjs# 注册、验证、创建 API 密钥（Playwright）
├── inbox/index.mjs       # temp-email.dev 读取器 + REST + 链接解析
└── utils/                # config、random、logger
```

## 环境要求

- **Node.js 18+**
- Playwright 所需的 Chromium/Firefox/WebKit 浏览器
- 可访问 `tokenharbor.ai` 与 `www.temp-email.dev` 的网络

## 安装

```bash
git clone https://github.com/0xgetz/tokenharbor-bulk-creator.git
cd tokenharbor-bulk-creator
npm install
npx playwright install --with-deps chromium
```

## 快速开始

```bash
# 单个账号，观察浏览器运作
node src/index.mjs --headful

# 五个账号，输出到 ./output
node src/index.mjs -n 5 -o output/accounts.json

# 十个账号，两个 worker
node src/index.mjs -n 10 -c 2

# 先检查环境
node src/index.mjs --doctor
```

### CLI 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `-n, --count` | `1` | 账号数量 |
| `-c, --concurrency` | `1` | 并行 worker |
| `-o, --out` | `tokenharbor-accounts-<ts>.json` | 结果 JSON 路径 |
| `-t, --timeout` | `180000` | 等待验证邮件的毫秒上限 |
| `--turnstile-timeout` | `150000` | Cloudflare 等待上限（当前为空操作） |
| `--retries` | `3` | 每账号尝试次数 |
| `--inbox-provider` | `temp-email-dev` | `temp-email-dev` \| `custom` |
| `--mail-base-url` | – | `custom` 收件箱服务的基础 URL |
| `--password` | 随机 | 固定密码（>= 12 位） |
| `--key-name` | 随机 | 固定 API 密钥标签 |
| `--proxy` | – | 浏览器代理 URL |
| `--headful` | 关 | 显示浏览器 |
| `-q, --quiet` | 关 | 仅输出最终摘要 |
| `--doctor` | – | 检查环境后退出 |

## 收件箱服务

| 服务 | 参数值 | 说明 |
| --- | --- | --- |
| temp-email.dev *(默认)* | `temp-email-dev` | 在浏览器中驱动该站点界面，由站点生成地址。 |
| 自定义 REST | `custom` | 通用临时邮箱 JSON API（`/domains`、`/accounts`、`/messages`）。 |

## 限流

Token Harbor 设有软性反滥用限流。若注册返回 *"You're doing that a bit fast — take a
breath and try again."*，程序会退避 45 秒后重试一次；若仍失败，则将该账号标记为
`rate-limit` 失败。大批量时请将 `--concurrency` 保持在 1–2。

## 输出

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

## 许可证

基于 [MIT 许可证](../LICENSE) 发布。
