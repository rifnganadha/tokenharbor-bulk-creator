#!/usr/bin/env node
/**
 * tokenharbor-bulk-creator — CLI entry point.
 *
 * Bulk, end-to-end provisioning of Token Harbor (tokenharbor.ai) accounts and
 * API keys, using temp-email.dev disposable inboxes for the emailed verification
 * link.
 *
 * Exit codes: 0 = every requested account succeeded, 1 = at least one failed,
 * 2 = bad arguments.
 *
 * @module index
 */

import { writeFile } from "node:fs/promises";
import { provisionOne } from "./core/provision.mjs";
import { connectAccount } from "./ninerouter/client.mjs";
import { buildOptions, parseProxy } from "./utils/config.mjs";
import { log, color } from "./utils/logger.mjs";

const VERSION = "1.0.0";

function help() {
  process.stdout.write(`
  ${color.bold("tokenharbor-bulk-creator")} v${VERSION}

  Bulk-provision Token Harbor (tokenharbor.ai) accounts + API keys.

  Usage:
    node src/index.mjs [options]

  Options:
    -n, --count N               number of accounts              (default 1)
    -c, --concurrency N         accounts in parallel             (default 1)
    -o, --out FILE              output JSON file                (default tokenharbor-accounts-<ts>.json)
    -t, --timeout MS            max wait for the verification email (default 180000)
        --turnstile-timeout MS  max wait for Cloudflare (no-op; kept for parity) (default 150000)
        --retries N             retries per account              (default 3)
        --inbox-provider NAME   temp-email-dev | smtp-dev | custom (default temp-email-dev)
        --mail-base-url URL     base URL for the 'smtp-dev' / 'custom' inbox provider
        --mailbox-domain D      pin an inbox domain (smtp-dev / custom)
        --inbox-api-key KEY     API key for the 'smtp-dev' provider (or TH_INBOX_API_KEY)
        --password PW           fixed password (>=12 chars; default random)
        --key-name NAME         fixed API-key label (default random)
        --connect-9router       add each created key to 9Router   (or TH_CONNECT_9ROUTER)
        --9router-url URL       9Router base URL                  (default http://localhost:20128)
        --9router-password PW   9Router dashboard password        (default 123456)
        --proxy URL             proxy for the browser            (or TH_PROXY)
        --headful               show the browser
        --keep-browser          leave the browser open at the end (debugging)
    -q, --quiet                 print only the final summary
        --doctor                check the environment and exit
    -v, --version               print the version
    -h, --help                  show this help

  Examples:
    node src/index.mjs
    node src/index.mjs -n 5 --concurrency 2
    node src/index.mjs -n 3 --connect-9router
    node src/index.mjs -n 3 --proxy http://user:pass@host:port
    TH_PROXY=socks5://127.0.0.1:1080 node src/index.mjs -n 2 --retries 5
`);
}

/**
 * Load Playwright lazily so `--help`, `--version` and `--doctor` work even
 * before `npm install`, with a clear message instead of a stack trace.
 */
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    log.error(
      "playwright is not installed — run `npm install` and " +
        "`npx playwright install --with-deps chromium`",
    );
    process.exit(1);
  }
}

/** Environment self-check for `--doctor`. */
async function doctor() {
  const checks = [];
  const major = parseInt(process.versions.node.split(".")[0], 10);
  checks.push(["node >= 18", major >= 18, `v${process.versions.node}`]);

  try {
    const { chromium: c } = await loadPlaywright();
    const b = await c.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await b.newPage();
    await page.goto("about:blank");
    await b.close();
    checks.push(["playwright chromium", true, "launch ok"]);
  } catch (e) {
    checks.push(["playwright chromium", false, e.message.slice(0, 80)]);
  }

  try {
    const res = await fetch("https://tokenharbor.ai/login?mode=signup", { method: "GET" });
    checks.push(["tokenharbor.ai reachable", res.ok, `HTTP ${res.status}`]);
  } catch (e) {
    checks.push(["tokenharbor.ai reachable", false, e.message.slice(0, 80)]);
  }

  try {
    const res = await fetch("https://www.temp-email.dev/en", { method: "GET" });
    checks.push(["temp-email.dev reachable", res.ok, `HTTP ${res.status}`]);
  } catch (e) {
    checks.push(["temp-email.dev reachable", false, e.message.slice(0, 80)]);
  }

  let allOk = true;
  for (const [name, ok, detail] of checks) {
    if (!ok) allOk = false;
    log.raw(`${ok ? color.green("✔") : color.red("✘")} ${name}  ${color.dim(detail)}`);
  }
  process.exit(allOk ? 0 : 1);
}

async function main() {
  let opts;
  try {
    opts = buildOptions(process.argv);
  } catch (e) {
    log.error(e.message);
    process.exit(2);
  }
  if (opts.help) return help();
  if (opts.version) return log.raw(VERSION);
  if (opts.doctor) return doctor();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = opts.out || `tokenharbor-accounts-${stamp}.json`;
  const proxy = parseProxy(opts.proxy);

  log.raw(color.cyan("tokenharbor-bulk-creator") + color.dim(` v${VERSION}`));
  log.info(
    `accounts=${opts.count}  concurrency=${opts.concurrency}  retries=${opts.retries}  out=${outFile}`,
  );
  log.info(`inbox=${opts.inboxProvider}`);
  log.info(proxy ? `proxy: ${proxy.server}` : "proxy: none (direct)");
  if (opts.connectNineRouter) log.info(`9router: ${opts.nineRouterUrl}`);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    headless: !opts.headful,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(proxy ? { proxy } : {}),
  });

  const baseContextOpts = {
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
    ...(proxy ? { proxy } : {}),
  };

  const results = [];
  const flush = async () => writeFile(outFile, JSON.stringify(results.filter(Boolean), null, 2));

  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= opts.count) return;
      if (!opts.quiet) log.raw(color.dim(`\n── account ${i + 1}/${opts.count} ──`));

      // One isolated browser context per account: separate cookie jars and
      // storage keep concurrent workers from sharing a signed-in session, and
      // let us destroy everything (session included) once the account is done.
      const platformContext = await browser.newContext(baseContextOpts);
      const inboxContext = await browser.newContext(baseContextOpts);
      try {
        const r = await provisionOne(platformContext, inboxContext, {
          inboxProvider: opts.inboxProvider,
          mailBaseUrl: opts.mailBaseUrl,
          mailboxDomain: opts.mailboxDomain,
          inboxApiKey: opts.inboxApiKey,
          timeout: opts.timeout,
          turnstileTimeout: opts.turnstileTimeout,
          retries: opts.retries,
          password: opts.password,
          keyName: opts.keyName,
        });

        // Optionally connect the freshly created key to 9Router. This runs on
        // the (now signed-out) platform context, so each account logs into
        // 9Router in its own cookie jar and never shares a session.
        if (r.ok && opts.connectNineRouter) {
          const page = await platformContext.newPage();
          try {
            r.nine_router = await connectAccount(page, r, {
              baseUrl: opts.nineRouterUrl,
              password: opts.nineRouterPassword,
              retries: 2,
            });
          } catch (err) {
            r.nine_router = {
              ok: false,
              url: opts.nineRouterUrl,
              error: err.message,
              error_kind: "other",
            };
            log.warn(`9Router connect failed for ${r.email}: ${err.message}`);
          } finally {
            await page.close().catch(() => {});
          }
        }

        results[i] = r;
        await flush();
      } finally {
        await platformContext.close().catch(() => {});
        await inboxContext.close().catch(() => {});
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(opts.concurrency, opts.count) }, () => worker()),
    );
  } finally {
    if (!opts.keepBrowser) await browser.close().catch(() => {});
    else log.warn("--keep-browser set: browser left open (stop the process to exit)");
  }

  const done = results.filter(Boolean);
  const ok = done.filter((r) => r.ok).length;
  log.raw("");
  log.info(`done: ${ok}/${done.length || 0} succeeded -> ${outFile}`);
  for (const r of done) {
    if (r.ok) log.raw(`  ${color.green("✔")} ${r.email}  ${color.dim(`key=${r.api_key}`)}`);
    else log.raw(`  ${color.red("✘")} ${r.email || "?"}  ${color.dim(`${r.error_kind}: ${r.error}`)}`);
  }
  if (opts.connectNineRouter && ok > 0) {
    const connected = done.filter((r) => r.ok && r.nine_router?.ok).length;
    const failed = ok - connected;
    const detail = failed > 0 ? color.dim(` (${failed} failed)`) : "";
    const line = `${connected}/${ok} connected to 9Router @ ${opts.nineRouterUrl}${detail}`;
    if (failed > 0) log.warn(`9router: ${line}`);
    else log.info(`9router: ${line}`);
  }
  process.exit(ok === opts.count ? 0 : 1);
}

main().catch((e) => {
  log.error(e.stack || e.message);
  process.exit(1);
});
